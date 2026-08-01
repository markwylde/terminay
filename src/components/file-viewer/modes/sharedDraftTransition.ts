import type { FileViewerClient } from '@terminay/client-core';
import { MAX_FILE_CONTENT_RANGE_BYTES } from '@terminay/protocol';
import {
	applySparseEdits,
	decodeSparseEdit,
} from '../../../services/fileViewer/sparseProjection';
import type { FileViewerSparseFileEdit } from '../../../types/terminay';

const MONACO_RANGE_BYTES = MAX_FILE_CONTENT_RANGE_BYTES;
const MONACO_RANGE_CONCURRENCY = 2;
const MAX_MONACO_MATERIALIZE_BYTES = 128 * 1024 * 1024;
const MONACO_DECODE_YIELD_CHUNKS = 8;

export interface MaterializedTextDraft {
	readonly dirty: boolean;
	readonly text: string;
}

export interface CanonicalMaterializedTextDraft extends MaterializedTextDraft {
	readonly originalText: string;
}

/** Materialize the bounded Performant sparse draft into the full-text model
 * used by Monaco without ever replacing it with the unedited disk contents. */
export function materializePerformantDraft(
	originalText: string,
	edits: readonly FileViewerSparseFileEdit[],
): MaterializedTextDraft {
	const originalBytes = new TextEncoder().encode(originalText);
	const projectedBytes = applySparseEdits(originalBytes, edits);
	const text = new TextDecoder('utf-8', {
		fatal: true,
		ignoreBOM: true,
	}).decode(projectedBytes);
	return {
		dirty: text !== originalText,
		text,
	};
}

/** Fetch an explicit bounded Monaco baseline through canonical ranged reads.
 * Requests are pipelined, but decoded only after ordered byte reassembly so a
 * multi-byte UTF-8 sequence may safely straddle any transport chunk boundary. */
export async function materializeCanonicalPerformantDraft(
	client: FileViewerClient,
	path: string,
	projectId: string,
	size: number,
	edits: readonly FileViewerSparseFileEdit[],
	signal: AbortSignal,
): Promise<CanonicalMaterializedTextDraft> {
	if (
		!Number.isSafeInteger(size) ||
		size < 0 ||
		size > MAX_MONACO_MATERIALIZE_BYTES
	) {
		throw new RangeError(
			'file is outside the bounded Monaco materialization limit',
		);
	}
	const operationController = new AbortController();
	const onParentAbort = () => operationController.abort(signal.reason);
	signal.addEventListener('abort', onParentAbort, { once: true });
	const operationSignal = operationController.signal;
	const requests = Array.from(
		{ length: Math.ceil(size / MONACO_RANGE_BYTES) },
		(_, index) => ({
			length: Math.min(MONACO_RANGE_BYTES, size - index * MONACO_RANGE_BYTES),
			offset: index * MONACO_RANGE_BYTES,
		}),
	);
	const preparedEdits = edits.map((edit, index) => {
		const previous = edits[index - 1];
		if (
			edit.start < 0 ||
			edit.end < edit.start ||
			edit.end > size ||
			(previous && edit.start < previous.end)
		) {
			throw new RangeError('sparse Monaco edits must be ordered and disjoint');
		}
		return { ...edit, replacement: decodeSparseEdit(edit) };
	});
	const baselineDecoder = new TextDecoder('utf-8', {
		fatal: true,
		ignoreBOM: true,
	});
	const projectedDecoder = new TextDecoder('utf-8', {
		fatal: true,
		ignoreBOM: true,
	});
	const baselineParts: string[] = [];
	const projectedParts: string[] = [];
	let editIndex = 0;
	let projectedCursor = 0;
	let decodedChunks = 0;
	const append = (parts: string[], decoder: TextDecoder, bytes: Uint8Array) => {
		const value = decoder.decode(bytes, { stream: true });
		if (value.length > 0) {
			parts.push(value);
		}
	};

	try {
		for (
			let batchStart = 0;
			batchStart < requests.length;
			batchStart += MONACO_RANGE_CONCURRENCY
		) {
			operationSignal.throwIfAborted();
			const batchRequests = requests.slice(
				batchStart,
				batchStart + MONACO_RANGE_CONCURRENCY,
			);
			const pending = batchRequests.map((request) =>
				client.readContentRange(
					path,
					request.offset,
					request.length,
					projectId,
					{ signal: operationSignal },
				),
			);
			let batch: Awaited<ReturnType<FileViewerClient['readContentRange']>>[];
			try {
				batch = await Promise.all(pending);
			} catch (error) {
				operationController.abort(error);
				await Promise.allSettled(pending);
				throw error;
			}
			for (let index = 0; index < batch.length; index += 1) {
				const request = batchRequests[index];
				const chunk = batch[index].bytes;
				if (chunk.byteLength !== request.length) {
					throw new Error('file changed during Monaco draft materialization');
				}
				const chunkStart = request.offset;
				const chunkEnd = chunkStart + chunk.byteLength;
				append(baselineParts, baselineDecoder, chunk);

				let cursor = Math.max(chunkStart, projectedCursor);
				while (
					editIndex < preparedEdits.length &&
					preparedEdits[editIndex].start < chunkEnd
				) {
					const edit = preparedEdits[editIndex];
					if (edit.start > cursor) {
						append(
							projectedParts,
							projectedDecoder,
							chunk.subarray(cursor - chunkStart, edit.start - chunkStart),
						);
					}
					append(projectedParts, projectedDecoder, edit.replacement);
					projectedCursor = edit.end;
					cursor = Math.max(chunkStart, projectedCursor);
					editIndex += 1;
				}
				if (cursor < chunkEnd) {
					append(
						projectedParts,
						projectedDecoder,
						chunk.subarray(cursor - chunkStart),
					);
				}
				projectedCursor = Math.max(projectedCursor, chunkEnd);
				decodedChunks += 1;
				if (decodedChunks % MONACO_DECODE_YIELD_CHUNKS === 0) {
					await new Promise<void>((resolve) =>
						globalThis.setTimeout(resolve, 0),
					);
					operationSignal.throwIfAborted();
				}
			}
		}
		while (
			editIndex < preparedEdits.length &&
			preparedEdits[editIndex].start === size
		) {
			append(
				projectedParts,
				projectedDecoder,
				preparedEdits[editIndex].replacement,
			);
			editIndex += 1;
		}
		if (editIndex !== preparedEdits.length) {
			throw new RangeError('sparse Monaco edit is outside the file');
		}
		baselineParts.push(baselineDecoder.decode());
		projectedParts.push(projectedDecoder.decode());
		const originalText = baselineParts.join('');
		const text =
			preparedEdits.length === 0 ? originalText : projectedParts.join('');
		return {
			dirty: text !== originalText,
			originalText,
			text,
		};
	} finally {
		signal.removeEventListener('abort', onParentAbort);
	}
}
