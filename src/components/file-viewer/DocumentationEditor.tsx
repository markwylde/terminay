import {
	AdmonitionDirectiveDescriptor,
	BlockTypeSelect,
	BoldItalicUnderlineToggles,
	CodeToggle,
	CreateLink,
	codeBlockPlugin,
	codeMirrorPlugin,
	DiffSourceToggleWrapper,
	diffSourcePlugin,
	directivesPlugin,
	frontmatterPlugin,
	headingsPlugin,
	InsertAdmonition,
	InsertCodeBlock,
	InsertFrontmatter,
	InsertImage,
	InsertTable,
	InsertThematicBreak,
	imagePlugin,
	jsxPlugin,
	ListsToggle,
	linkPlugin,
	listsPlugin,
	MDXEditor,
	type MDXEditorMethods,
	markdownShortcutPlugin,
	lexicalTheme as mdxEditorLexicalTheme,
	quotePlugin,
	tablePlugin,
	thematicBreakPlugin,
	toolbarPlugin,
	UndoRedo,
} from '@mdxeditor/editor';
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
import { DocumentationAutosaveController } from './DocumentationAutosaveController';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-600.css';
import '@fontsource/open-sans/latin-700.css';
import '@mdxeditor/editor/style.css';

const documentationLexicalTheme = {
	...mdxEditorLexicalTheme,
	admonition: {
		caution:
			'documentation-editor__admonition documentation-editor__admonition--caution',
		danger:
			'documentation-editor__admonition documentation-editor__admonition--danger',
		info: 'documentation-editor__admonition documentation-editor__admonition--info',
		note: 'documentation-editor__admonition documentation-editor__admonition--note',
		tip: 'documentation-editor__admonition documentation-editor__admonition--tip',
	},
};

const editorPlugins = [
	headingsPlugin(),
	listsPlugin(),
	quotePlugin(),
	thematicBreakPlugin(),
	linkPlugin(),
	imagePlugin(),
	tablePlugin(),
	codeBlockPlugin(),
	codeMirrorPlugin({
		codeBlockLanguages: {
			'': 'Plain text',
			bash: 'Shell',
			css: 'CSS',
			html: 'HTML',
			javascript: 'JavaScript',
			json: 'JSON',
			jsx: 'JavaScript (React)',
			markdown: 'Markdown',
			tsx: 'TypeScript (React)',
			typescript: 'TypeScript',
			yaml: 'YAML',
		},
	}),
	frontmatterPlugin(),
	directivesPlugin({
		directiveDescriptors: [AdmonitionDirectiveDescriptor],
	}),
	jsxPlugin(),
	markdownShortcutPlugin(),
	diffSourcePlugin({ viewMode: 'rich-text' }),
	toolbarPlugin({
		toolbarContents: () => (
			<DiffSourceToggleWrapper>
				<UndoRedo />
				<BlockTypeSelect />
				<BoldItalicUnderlineToggles />
				<CodeToggle />
				<ListsToggle />
				<CreateLink />
				<InsertImage />
				<InsertTable />
				<InsertCodeBlock />
				<InsertAdmonition />
				<InsertFrontmatter />
				<InsertThematicBreak />
			</DiffSourceToggleWrapper>
		),
	}),
];

type DocumentationEditorProps = Readonly<{
	markdown: string;
	onChange: (value: string) => void;
	onFlush: () => Promise<void>;
	path: string;
	projectId: string;
	serverId: string;
	runtimeClient?: MdxRuntimeClient;
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
	onFlush,
	path,
	projectId,
	serverId,
	runtimeClient,
}: DocumentationEditorProps) {
	const [state, setState] = useState<
		'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'failed'
	>('idle');
	const [message, setMessage] = useState<string | undefined>(undefined);
	const [compiled, setCompiled] = useState<
		{ runtimeId: string; code: Uint8Array } | undefined
	>(undefined);
	const [previewGeneration, setPreviewGeneration] = useState(0);
	const [downloadInFlight, setDownloadInFlight] = useState(false);
	const valueRef = useRef(markdown);
	const editorRef = useRef<MDXEditorMethods>(null);
	const suppressModeChangeRef = useRef(false);
	const suppressModeChangeTimerRef = useRef<number | undefined>(undefined);
	const flushRef = useRef(onFlush);
	flushRef.current = onFlush;
	const autosaveRef = useRef<DocumentationAutosaveController | undefined>(
		undefined,
	);
	const runtimeRef = useRef<string | undefined>(undefined);
	const downloadAbortRef = useRef<AbortController | undefined>(undefined);
	const resourceUrlsRef = useRef<string[]>([]);
	if (autosaveRef.current === undefined)
		autosaveRef.current = new DocumentationAutosaveController(
			async () => flushRef.current(),
			(next, error) => {
				setState(next);
				if (error !== undefined)
					setMessage(error instanceof Error ? error.message : String(error));
				else if (next === 'saved') setMessage(undefined);
			},
		);
	const handleChange = useCallback(
		(next: string, initial: boolean) => {
			if (initial || suppressModeChangeRef.current || next === valueRef.current)
				return;
			valueRef.current = next;
			onChange(next);
			autosaveRef.current?.changed();
		},
		[onChange],
	);
	const flush = useCallback(() => {
		void autosaveRef.current?.flush();
	}, []);
	useEffect(() => {
		if (markdown === valueRef.current) return;
		valueRef.current = markdown;
		editorRef.current?.setMarkdown(markdown);
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
					onMessage={(event) => {
						if (event.kind === 'diagnostic')
							setMessage(`Preview: ${event.message}`);
						if (event.kind === 'open-document')
							window.dispatchEvent(
								new CustomEvent('terminay-documentation-open', {
									detail: { path: event.path },
								}),
							);
						if (event.kind === 'open-external') void openExternalUrl(event.url);
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
				</div>
			) : null}
			<MDXEditor
				ref={editorRef}
				markdown={markdown}
				trim={false}
				className="documentation-editor__surface mdxeditor-full-height"
				contentEditableClassName="documentation-editor__content"
				lexicalTheme={documentationLexicalTheme}
				plugins={editorPlugins}
				onChange={handleChange}
				onError={(error) => setMessage(`Editor parser error: ${error.error}`)}
			/>
			{preview ? (
				<section
					className="documentation-editor__preview"
					aria-label="Live MDX preview"
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
