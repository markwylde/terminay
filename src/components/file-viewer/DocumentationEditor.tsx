import { MDXEditor, type MDXEditorMethods } from '@mdxeditor/editor';
import type { MdxRuntimeClient } from '@terminay/client-core';
import {
	Component,
	type ErrorInfo,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { openExternalUrl, savePreviewDownload } from '../../host/nativeActions';
import { MdxPreview } from '../mdx-preview/MdxPreview';
import {
	DocumentationAutosaveController,
	type DocumentationAutosaveSession,
} from './DocumentationAutosaveController';
import {
	createDocumentationEditorPlugins,
	documentationLexicalTheme,
} from './documentationEditorPlugins';
import { selfCloseVoidHtmlElements } from './documentationMarkdownCompat';
import { viewDocumentSource } from './openFilePresentation';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-600.css';
import '@fontsource/open-sans/latin-700.css';
import '@mdxeditor/editor/style.css';

type DocumentationEditorProps = Readonly<{
	markdown: string;
	onChange: (value: string) => void;
	autosaveSession: DocumentationAutosaveSession;
	draftRevision?: number;
	diskRevision?: number;
	path: string;
	projectId: string;
	serverId: string;
	runtimeClient?: MdxRuntimeClient;
	/** Reads an image the document references, or undefined to leave its src as is. */
	loadImage?: (src: string) => Promise<Blob | undefined>;
	/** Switches this panel to the File Viewer once pending edits are saved. */
	onViewSource?: () => void;
}>;

export function DocumentationEditor(props: DocumentationEditorProps) {
	return (
		<DocumentationEditorBoundary>
			<DocumentationEditorSurface {...props} />
		</DocumentationEditorBoundary>
	);
}

class DocumentationEditorBoundary extends Component<
	Readonly<{ children: ReactNode }>,
	Readonly<{ failed: boolean }>
> {
	state = { failed: false };

	static getDerivedStateFromError(): Readonly<{ failed: boolean }> {
		return { failed: true };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error('Documentation editor failed', error, info.componentStack);
	}

	render(): ReactNode {
		if (!this.state.failed) return this.props.children;
		return (
			<section className="documentation-editor__failure" role="alert">
				<h2>Documentation editor unavailable</h2>
				<p>Your draft is still retained. Retry the editor to continue.</p>
				<button type="button" onClick={() => this.setState({ failed: false })}>
					Retry editor
				</button>
			</section>
		);
	}
}

function DocumentationEditorSurface({
	markdown,
	onChange,
	autosaveSession,
	draftRevision = 0,
	diskRevision = 0,
	path,
	projectId,
	serverId,
	runtimeClient,
	loadImage,
	onViewSource,
}: DocumentationEditorProps) {
	const [state, setState] = useState<
		'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'failed'
	>('idle');
	const [message, setMessage] = useState<string | undefined>(undefined);
	const [compiled, setCompiled] = useState<
		{ runtimeId: string; code: Uint8Array } | undefined
	>(undefined);
	const [previewHeight, setPreviewHeight] = useState<number | undefined>(
		undefined,
	);
	const [previewGeneration, setPreviewGeneration] = useState(0);
	const [downloadInFlight, setDownloadInFlight] = useState(false);
	const valueRef = useRef(markdown);
	const rootRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<MDXEditorMethods>(null);
	const suppressModeChangeRef = useRef(false);
	const suppressModeChangeTimerRef = useRef<number | undefined>(undefined);
	const autosaveRef = useRef<DocumentationAutosaveController | undefined>(
		undefined,
	);
	const runtimeRef = useRef<string | undefined>(undefined);
	const downloadAbortRef = useRef<AbortController | undefined>(undefined);
	const resourceUrlsRef = useRef<string[]>([]);
	const loadImageRef = useRef(loadImage);
	loadImageRef.current = loadImage;
	// The toolbar is built once, so its View source button reads the latest
	// callback through a ref.
	const onViewSourceRef = useRef(onViewSource);
	onViewSourceRef.current = onViewSource;
	const imageUrlsRef = useRef(new Map<string, Promise<string>>());
	const [plugins] = useState(() =>
		createDocumentationEditorPlugins((src) => {
			let url = imageUrlsRef.current.get(src);
			if (url === undefined) {
				url = (async () => {
					const blob = await loadImageRef.current?.(src).catch(() => undefined);
					return blob === undefined ? src : URL.createObjectURL(blob);
				})();
				imageUrlsRef.current.set(src, url);
			}
			return url;
		}, onViewSource === undefined
			? undefined
			: () => {
					void viewDocumentSource(
						() => autosaveRef.current?.flush() ?? Promise.resolve(true),
						() => onViewSourceRef.current?.(),
					);
				}),
	);
	if (autosaveRef.current === undefined)
		autosaveRef.current = new DocumentationAutosaveController(
			autosaveSession,
			(next, error) => {
				setState(next);
				if (error !== undefined)
					setMessage(error instanceof Error ? error.message : String(error));
				else if (next === 'saved' || next === 'idle') setMessage(undefined);
			},
			draftRevision,
			diskRevision,
		);
	const handleChange = useCallback(
		(next: string, initial: boolean) => {
			if (suppressModeChangeRef.current || next === valueRef.current) return;
			// Opening a document is not editing it. The editor reports the
			// normalized form of what it just parsed — soft line breaks collapsed
			// to the spaces they stand for, and whatever else its serializer spells
			// differently — and taking that as an edit would mark a file dirty and
			// rewrite it on disk for having been read. Keep the value so the
			// document is not re-imported, and wait for the user.
			valueRef.current = next;
			if (initial) return;
			onChange(next);
			autosaveRef.current?.changed(next, false);
		},
		[onChange],
	);
	const flush = useCallback(() => {
		void autosaveRef.current?.flush();
	}, []);
	useEffect(() => {
		if (markdown === valueRef.current) return;
		valueRef.current = markdown;
		editorRef.current?.setMarkdown(selfCloseVoidHtmlElements(markdown));
	}, [markdown]);
	useEffect(
		() => () => {
			autosaveRef.current?.dispose();
			if (suppressModeChangeTimerRef.current !== undefined)
				window.clearTimeout(suppressModeChangeTimerRef.current);
		},
		[],
	);
	useEffect(
		() => () => {
			downloadAbortRef.current?.abort();
		},
		[],
	);
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		// Dockview detaches an inactive tab's DOM, which drops every scroll
		// offset inside it; put them back when the tab is shown again.
		const offsets = new Map<Element, number>();
		let hidden = false;
		const onScroll = (event: Event) => {
			if (!hidden && event.target instanceof Element)
				offsets.set(event.target, event.target.scrollTop);
		};
		const observer = new ResizeObserver(() => {
			const visible = root.isConnected && root.clientHeight > 0;
			if (visible && hidden)
				for (const [element, scrollTop] of offsets) {
					if (element.isConnected) element.scrollTop = scrollTop;
					else offsets.delete(element);
				}
			hidden = !visible;
		});
		root.addEventListener('scroll', onScroll, { capture: true, passive: true });
		observer.observe(root);
		return () => {
			root.removeEventListener('scroll', onScroll, { capture: true });
			observer.disconnect();
		};
	}, []);
	useEffect(() => {
		const urls = imageUrlsRef.current;
		return () => {
			for (const [src, url] of urls)
				void url.then((value) => {
					if (value !== src) URL.revokeObjectURL(value);
				});
			urls.clear();
		};
	}, []);
	useEffect(() => {
		const listener = (event: Event) => {
			if (
				(event as CustomEvent<{ projectId?: unknown }>).detail?.projectId ===
				projectId
			)
				setPreviewGeneration((value) => value + 1);
		};
		window.addEventListener('terminay-documentation-change', listener);
		return () =>
			window.removeEventListener('terminay-documentation-change', listener);
	}, [projectId]);
	useEffect(() => {
		if (
			!runtimeClient ||
			!/\.mdx$/iu.test(path) ||
			state === 'saving' ||
			state === 'dirty'
		)
			return;
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
			.catch((error: unknown) => {
				if (!cancelled)
					setMessage(
						`Preview unavailable: ${error instanceof Error ? error.message : String(error)}`,
					);
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
	}, [path, previewGeneration, projectId, runtimeClient, state]);
	const startDownload = useCallback((url: string, filename?: string) => {
		downloadAbortRef.current?.abort();
		const controller = new AbortController();
		downloadAbortRef.current = controller;
		setDownloadInFlight(true);
		setMessage('Preview download in progress…');
		void downloadPreview(url, filename, controller.signal)
			.catch((error: unknown) => {
				if (!controller.signal.aborted)
					setMessage(
						`Preview download failed: ${error instanceof Error ? error.message : String(error)}`,
					);
			})
			.finally(() => {
				if (downloadAbortRef.current === controller) {
					downloadAbortRef.current = undefined;
					setDownloadInFlight(false);
				}
			});
	}, []);
	const preview = useMemo(
		() =>
			compiled && (
				<MdxPreview
					runtimeId={compiled.runtimeId}
					bundle={compiled.code}
					storageKey={`${serverId}:${projectId}`}
					onExternalUrl={(url) => {
						void openExternalUrl(url);
					}}
					onMessage={(event) => {
						if (event.kind === 'diagnostic')
							setMessage(`Preview: ${event.message}`);
						if (event.kind === 'resize') setPreviewHeight(event.height);
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
			),
		[compiled, projectId, serverId, startDownload],
	);
	const status =
		state === 'conflict' ? 'Conflict' : state === 'failed' ? 'Save failed' : '';
	const hasStatus = Boolean(status || message);
	return (
		<div
			ref={rootRef}
			className={`documentation-editor${preview ? ' documentation-editor--with-preview' : ''}${hasStatus ? ' documentation-editor--with-status' : ''}`}
			onBlur={flush}
			onPointerDownCapture={(event) => {
				const label = (event.target as Element)
					.closest('[aria-label]')
					?.getAttribute('aria-label');
				if (!['Rich text', 'Source mode', 'Diff mode'].includes(label ?? ''))
					return;
				suppressModeChangeRef.current = true;
				if (suppressModeChangeTimerRef.current !== undefined)
					window.clearTimeout(suppressModeChangeTimerRef.current);
				suppressModeChangeTimerRef.current = window.setTimeout(() => {
					suppressModeChangeRef.current = false;
					suppressModeChangeTimerRef.current = undefined;
				}, 250);
			}}
		>
			{status || message ? (
				<div className="documentation-editor__status" aria-live="polite">
					{status}
					{message ? `${status ? ' — ' : ''}${message}` : ''}
					{downloadInFlight ? (
						<button
							type="button"
							onClick={() => downloadAbortRef.current?.abort()}
						>
							Cancel download
						</button>
					) : null}
					{message?.startsWith('Preview') ? (
						<button
							type="button"
							onClick={() => {
								setMessage(undefined);
								setPreviewGeneration((value) => value + 1);
							}}
						>
							Restart preview
						</button>
					) : null}
					{state === 'failed' || state === 'conflict' ? (
						<button
							type="button"
							onClick={() => void autosaveRef.current?.flush()}
						>
							Retry save
						</button>
					) : null}
				</div>
			) : null}
			<MDXEditor
				ref={editorRef}
				markdown={selfCloseVoidHtmlElements(markdown)}
				trim={false}
				className="documentation-editor__surface mdxeditor-full-height"
				contentEditableClassName="documentation-editor__content"
				lexicalTheme={documentationLexicalTheme}
				plugins={plugins}
				onChange={handleChange}
				onError={(error) => setMessage(`Editor parser error: ${error.error}`)}
			/>
			{preview ? (
				<section
					className="documentation-editor__preview"
					aria-label="Live MDX preview"
					style={
						previewHeight === undefined
							? undefined
							: { minHeight: previewHeight }
					}
				>
					{preview}
				</section>
			) : null}
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
