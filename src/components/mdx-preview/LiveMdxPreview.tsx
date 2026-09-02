import type { MdxRuntimeClient } from '@terminay/client-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openExternalUrl, savePreviewDownload } from '../../host/nativeActions';
import { MdxPreview } from './MdxPreview';

export function LiveMdxPreview({
	path,
	projectId,
	serverId,
	runtimeClient,
	paused = false,
	generation = 0,
}: {
	readonly path: string;
	readonly projectId: string;
	readonly serverId: string;
	readonly runtimeClient?: MdxRuntimeClient;
	readonly paused?: boolean;
	readonly generation?: number;
}) {
	const [compiled, setCompiled] = useState<
		{ runtimeId: string; code: Uint8Array } | undefined
	>(undefined);
	const runtimeRef = useRef<string | undefined>(undefined);
	const downloadAbortRef = useRef<AbortController | undefined>(undefined);
	const resourceUrlsRef = useRef<string[]>([]);
	useEffect(
		() => () => {
			downloadAbortRef.current?.abort();
		},
		[],
	);
	useEffect(() => {
		if (!runtimeClient || !/\.mdx$/iu.test(path) || paused) return;
		let cancelled = false;
		void within(
			runtimeClient.compile(projectId, path),
			15_000,
			'MDX compilation',
		)
			.then(async (result) => {
				if (cancelled) {
					await runtimeClient.dispose(projectId, result.runtimeId);
					return;
				}
				const objectUrls: string[] = [];
				let source = new TextDecoder().decode(result.code);
				for (const resource of result.resources) {
					const bytes = await readResource(
						runtimeClient,
						projectId,
						result.runtimeId,
						resource.resourceId,
						resource.totalLength,
					);
					const copy = bytes.buffer.slice(
						bytes.byteOffset,
						bytes.byteOffset + bytes.byteLength,
					) as ArrayBuffer;
					const url = URL.createObjectURL(
						new Blob([copy], { type: resource.mimeType }),
					);
					objectUrls.push(url);
					source = source.replaceAll(
						`__terminay_resource_${resource.resourceId}__`,
						url,
					);
				}
				if (cancelled) {
					objectUrls.forEach((url) => {
						URL.revokeObjectURL(url);
					});
					await runtimeClient.dispose(projectId, result.runtimeId);
					return;
				}
				resourceUrlsRef.current.forEach((url) => {
					URL.revokeObjectURL(url);
				});
				resourceUrlsRef.current = objectUrls;
				runtimeRef.current = result.runtimeId;
				setCompiled({
					runtimeId: result.runtimeId,
					code: new TextEncoder().encode(source),
				});
			})
			.catch(() => {
				if (!cancelled) setCompiled(undefined);
			});
		return () => {
			cancelled = true;
			resourceUrlsRef.current.forEach((url) => {
				URL.revokeObjectURL(url);
			});
			resourceUrlsRef.current = [];
			if (runtimeRef.current) {
				void runtimeClient.dispose(projectId, runtimeRef.current);
				runtimeRef.current = undefined;
			}
		};
	}, [generation, path, paused, projectId, runtimeClient]);
	const startDownload = useCallback((url: string, filename?: string) => {
		downloadAbortRef.current?.abort();
		const controller = new AbortController();
		downloadAbortRef.current = controller;
		void downloadPreview(url, filename, controller.signal).finally(() => {
			if (downloadAbortRef.current === controller)
				downloadAbortRef.current = undefined;
		});
	}, []);
	if (!compiled) {
		return (
			<div className="mdx-live-preview">
				<iframe
					title="MDX preview"
					sandbox="allow-scripts"
					referrerPolicy="no-referrer"
				/>
			</div>
		);
	}
	return (
		<div className="mdx-live-preview">
			<MdxPreview
				runtimeId={compiled.runtimeId}
				bundle={compiled.code}
				storageKey={`${serverId}:${projectId}`}
				onExternalUrl={(url) => {
					void openExternalUrl(url);
				}}
				onMessage={(event) => {
					if (event.kind === 'open-document')
						window.dispatchEvent(
							new CustomEvent('terminay-documentation-open', {
								detail: { path: event.path },
							}),
						);
					if (event.kind === 'download')
						startDownload(event.url, event.filename);
				}}
			/>
		</div>
	);
}

async function downloadPreview(
	url: string,
	requestedFilename?: string,
	signal?: AbortSignal,
): Promise<void> {
	const response = await fetch(url, { credentials: 'include', signal });
	if (!response.ok)
		throw new Error(`The download request failed (${response.status}).`);
	const contentLength = Number(response.headers.get('content-length'));
	if (Number.isFinite(contentLength) && contentLength > 16 * 1024 * 1024)
		throw new Error('Preview downloads are limited to 16 MiB.');
	const blob = await response.blob();
	if (blob.size > 16 * 1024 * 1024)
		throw new Error('Preview downloads are limited to 16 MiB.');
	const filename =
		requestedFilename ||
		filenameFromDisposition(response.headers.get('content-disposition')) ||
		filenameFromUrl(url);
	await savePreviewDownload({
		bytes: new Uint8Array(await blob.arrayBuffer()),
		filename,
		mimeType: blob.type || 'application/octet-stream',
	});
}

function filenameFromDisposition(value: string | null): string | undefined {
	const match = value?.match(/filename\*?=(?:UTF-8''|")?([^;"]+)/iu);
	return match?.[1]
		? decodeURIComponent(match[1].replace(/"/gu, ''))
		: undefined;
}

function filenameFromUrl(value: string): string {
	try {
		const name = new URL(value).pathname.split('/').filter(Boolean).pop();
		return name && name.length <= 128 ? name : 'download';
	} catch {
		return 'download';
	}
}

async function readResource(
	client: MdxRuntimeClient,
	projectId: string,
	runtimeId: string,
	resourceId: string,
	totalLength: number,
): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let offset = 0;
	while (offset < totalLength) {
		const part = await within(
			client.resource(
				projectId,
				runtimeId,
				resourceId,
				offset,
				Math.min(1024 * 1024, totalLength - offset),
			),
			15_000,
			'MDX resource transfer',
		);
		if (
			part.offset !== offset ||
			part.totalLength !== totalLength ||
			part.bytes.byteLength === 0
		)
			throw new Error('MDX resource transfer is incomplete.');
		chunks.push(part.bytes);
		offset += part.bytes.byteLength;
	}
	const output = new Uint8Array(totalLength);
	let cursor = 0;
	for (const chunk of chunks) {
		output.set(chunk, cursor);
		cursor += chunk.byteLength;
	}
	return output;
}

function within<T>(
	value: Promise<T>,
	timeoutMs: number,
	operation: string,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeout = window.setTimeout(
			() => reject(new Error(`${operation} timed out.`)),
			timeoutMs,
		);
		void value.then(
			(result) => {
				window.clearTimeout(timeout);
				resolve(result);
			},
			(error: unknown) => {
				window.clearTimeout(timeout);
				reject(error);
			},
		);
	});
}
