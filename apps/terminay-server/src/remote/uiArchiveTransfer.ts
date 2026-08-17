export const UI_ARCHIVE_FORMAT_VERSION = 1;
export const UI_ARCHIVE_CHUNK_BYTES = 64 * 1024;
export const UI_ARCHIVE_CHUNK_WINDOW = 4;
export const UI_ARCHIVE_TRANSFER_TIMEOUT_MS = 15_000;
export const UI_ARCHIVE_FRAME_HEADER_BYTES = 8;
export const UI_ARCHIVE_FRAME_MAGIC = [0x54, 0x42, 0x01, 0x01] as const;
export const DEFAULT_SCTP_MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_ACTIVE_UI_ARCHIVE_REQUESTS = 1;

export type UiArchiveBundleErrorCode =
	| 'cancelled'
	| 'internal'
	| 'invalid-request'
	| 'timeout'
	| 'unavailable';

export type UiArchiveBytes = Readonly<{
	bundleId: string;
	bytes: Uint8Array;
}>;

export type UiArchiveDataChannel = {
	readonly maxMessageSize?: number | (() => number);
	readonly readyState: string;
	addEventListener(type: string, listener: (event: Record<string, unknown>) => void): void;
	removeEventListener(type: string, listener: (event: Record<string, unknown>) => void): void;
	send(data: string | Uint8Array): void;
};

type UiArchiveTransfer = {
	acknowledged: Set<number>;
	cancelled: boolean;
	notify: Set<() => void>;
	sent: number;
};

export function messagePayloadBytes(data: string | Uint8Array): number {
	return typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
}

export function readSctpMaxMessageBytes(channel: UiArchiveDataChannel): number {
	const raw = typeof channel.maxMessageSize === 'function' ? channel.maxMessageSize() : channel.maxMessageSize;
	if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > UI_ARCHIVE_FRAME_HEADER_BYTES) {
		return raw;
	}
	return DEFAULT_SCTP_MAX_MESSAGE_BYTES;
}

export function archiveChunkBytes(channel: UiArchiveDataChannel): number {
	const maxPayload = readSctpMaxMessageBytes(channel) - UI_ARCHIVE_FRAME_HEADER_BYTES;
	return Math.min(UI_ARCHIVE_CHUNK_BYTES, Math.max(1024, maxPayload));
}

export function safeChannelSend(channel: UiArchiveDataChannel, data: string | Uint8Array): void {
	const bytes = messagePayloadBytes(data);
	const max = readSctpMaxMessageBytes(channel);
	if (bytes > max) {
		throw new Error(`WebRTC data-channel message is ${bytes} bytes; negotiated SCTP max is ${max}.`);
	}
	if (channel.readyState !== 'open') {
		throw new Error('WebRTC data channel is not open.');
	}
	try {
		channel.send(data);
	} catch (error) {
		throw new Error(
			`WebRTC data-channel send failed: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error instanceof Error ? error : undefined },
		);
	}
}

export function encodeUiArchiveChunk(index: number, bytes: Uint8Array): Uint8Array {
	const frame = new Uint8Array(UI_ARCHIVE_FRAME_HEADER_BYTES + bytes.byteLength);
	frame.set(UI_ARCHIVE_FRAME_MAGIC, 0);
	new DataView(frame.buffer, frame.byteOffset, frame.byteLength).setUint32(4, index, false);
	frame.set(bytes, UI_ARCHIVE_FRAME_HEADER_BYTES);
	return frame;
}

export function sendUiArchiveError(
	channel: UiArchiveDataChannel,
	id: string,
	code: UiArchiveBundleErrorCode,
	message: string,
): void {
	try {
		if (channel.readyState !== 'open') return;
		safeChannelSend(channel, JSON.stringify({ code, id, message, type: 'asset:bundle-error' }));
	} catch {
		/* Best-effort: a closed or size-limited channel must not take down the host. */
	}
}

export function bindUiArchiveChannels(
	channels: ReadonlyArray<UiArchiveDataChannel>,
	archive: UiArchiveBytes,
): { readonly dispose: () => void } {
	const transfers = new Map<string, UiArchiveTransfer>();
	const activeIds = new Set<string>();
	const removers = channels.map((channel) =>
		bindUiArchiveChannel(channel, archive, transfers, activeIds),
	);
	return {
		dispose() {
			for (const remove of removers) remove();
		},
	};
}

function bindUiArchiveChannel(
	channel: UiArchiveDataChannel,
	archive: UiArchiveBytes,
	transfers: Map<string, UiArchiveTransfer>,
	activeIds: Set<string>,
): () => void {
	const onMessage = (event: Record<string, unknown>) => {
		void handleUiArchiveMessage(channel, archive, transfers, activeIds, event).catch((error) => {
			const id = parseJsonMessage(event.data)?.id;
			if (typeof id === 'string') {
				sendUiArchiveError(
					channel,
					id,
					'internal',
					error instanceof Error ? error.message : 'UI archive transfer failed.',
				);
			}
		});
	};
	channel.addEventListener('message', onMessage);
	return () => channel.removeEventListener('message', onMessage);
}

async function handleUiArchiveMessage(
	channel: UiArchiveDataChannel,
	archive: UiArchiveBytes,
	transfers: Map<string, UiArchiveTransfer>,
	activeIds: Set<string>,
	event: Record<string, unknown>,
): Promise<void> {
	const request = parseJsonMessage(event.data);
	if (!request || typeof request.id !== 'string') return;
	if (request.type === 'asset:bundle-ack') {
		acknowledgeUiArchiveChunk(transfers.get(request.id), request.index);
		return;
	}
	if (request.type === 'asset:bundle-cancel') {
		const transfer = transfers.get(request.id);
		if (transfer) {
			transfer.cancelled = true;
			notifyUiArchiveTransfer(transfer);
		}
		return;
	}
	if (request.type === 'asset:get-manifest' || request.type === 'asset:get') {
		sendUiArchiveError(channel, request.id, 'invalid-request', 'The requested UI archive format is unsupported.');
		return;
	}
	if (request.type !== 'asset:get-bundle') return;
	if (activeIds.has(request.id) || activeIds.size >= MAX_ACTIVE_UI_ARCHIVE_REQUESTS) {
		sendUiArchiveError(
			channel,
			request.id,
			'unavailable',
			'A UI archive transfer is already active for this peer.',
		);
		return;
	}
	if (request.archiveFormatVersion !== UI_ARCHIVE_FORMAT_VERSION) {
		sendUiArchiveError(channel, request.id, 'invalid-request', 'The requested UI archive format is unsupported.');
		return;
	}
	activeIds.add(request.id);
	try {
		await sendUiArchive(channel, transfers, request.id, archive);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'UI archive transfer failed.';
		const code: UiArchiveBundleErrorCode = /cancelled/iu.test(message)
			? 'cancelled'
			: /timed out/iu.test(message)
				? 'timeout'
				: 'internal';
		sendUiArchiveError(channel, request.id, code, message);
	} finally {
		activeIds.delete(request.id);
	}
}

export async function sendUiArchive(
	channel: UiArchiveDataChannel,
	transfers: Map<string, UiArchiveTransfer>,
	id: string,
	archive: UiArchiveBytes,
): Promise<void> {
	if (archive.bytes.byteLength < 1 || typeof archive.bundleId !== 'string' || archive.bundleId.length < 1) {
		throw new TypeError('Server UI archive is invalid.');
	}
	const chunkBytes = archiveChunkBytes(channel);
	const chunks = Math.ceil(archive.bytes.byteLength / chunkBytes);
	if (chunks < 1 || chunks > 0xffff_ffff) throw new RangeError('Server UI archive chunk count is invalid.');
	const transfer: UiArchiveTransfer = {
		acknowledged: new Set(),
		cancelled: false,
		notify: new Set(),
		sent: 0,
	};
	transfers.set(id, transfer);
	try {
		safeChannelSend(
			channel,
			JSON.stringify({
				archiveFormatVersion: UI_ARCHIVE_FORMAT_VERSION,
				bundleId: archive.bundleId,
				chunkBytes,
				chunks,
				compressedBytes: archive.bytes.byteLength,
				id,
				type: 'asset:bundle-start',
			}),
		);
		for (let index = 0; index < chunks; index += 1) {
			await waitForUiArchiveTransfer(
				transfer,
				() => transfer.sent - transfer.acknowledged.size < UI_ARCHIVE_CHUNK_WINDOW,
			);
			if (channel.readyState !== 'open') {
				throw new Error('UI archive channel closed during transfer.');
			}
			const offset = index * chunkBytes;
			transfer.sent += 1;
			safeChannelSend(channel, encodeUiArchiveChunk(index, archive.bytes.subarray(offset, offset + chunkBytes)));
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		}
		await waitForUiArchiveTransfer(transfer, () => transfer.acknowledged.size === chunks);
		if (channel.readyState === 'open') {
			safeChannelSend(channel, JSON.stringify({ id, type: 'asset:bundle-complete' }));
		}
	} finally {
		transfers.delete(id);
	}
}

function acknowledgeUiArchiveChunk(transfer: UiArchiveTransfer | undefined, indexValue: unknown): void {
	const index = Number(indexValue);
	if (
		!transfer ||
		!Number.isInteger(index) ||
		index < 0 ||
		index >= transfer.sent
	) {
		return;
	}
	transfer.acknowledged.add(index);
	notifyUiArchiveTransfer(transfer);
}

function notifyUiArchiveTransfer(transfer: UiArchiveTransfer): void {
	for (const notify of transfer.notify) notify();
	transfer.notify.clear();
}

async function waitForUiArchiveTransfer(transfer: UiArchiveTransfer, predicate: () => boolean): Promise<void> {
	while (!predicate()) {
		if (transfer.cancelled) throw new Error('UI archive transfer was cancelled.');
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				transfer.notify.delete(onProgress);
				reject(new Error('UI archive transfer acknowledgement timed out.'));
			}, UI_ARCHIVE_TRANSFER_TIMEOUT_MS);
			const onProgress = () => {
				clearTimeout(timeout);
				resolve();
			};
			transfer.notify.add(onProgress);
		});
	}
}

function parseJsonMessage(data: unknown): Record<string, unknown> | undefined {
	const text =
		typeof data === 'string'
			? data
			: data instanceof ArrayBuffer
				? new TextDecoder().decode(data)
				: ArrayBuffer.isView(data)
					? new TextDecoder().decode(data)
					: undefined;
	if (text === undefined) return undefined;
	try {
		const parsed: unknown = JSON.parse(text);
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}
