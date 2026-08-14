import type { IDockviewPanelProps } from 'dockview';
import {
	type CSSProperties,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { useTerminalSettings } from '../../hooks/useTerminalSettings';
import {
	createFileDraftBuffer,
	createFileSessionStore,
	createServerFileGateway,
	detectFileCapabilities,
	isFileViewerModeAvailable,
	LARGE_FILE_THRESHOLD_BYTES,
	resolveFileViewerEngine,
	resolveFileViewerMode,
} from '../../services/fileViewer';
import { toProjectRelativePath } from '../../services/fileViewer/serverFileGateway';
import {
	decodeSparseEdit,
	mapProjectedOffset,
} from '../../services/fileViewer/sparseProjection';
import type {
	FileInfo,
	FileViewerEngine,
	FileViewerMode,
	GitFileDiff,
} from '../../types/fileViewer';
import type {
	FileViewerDefaultMode,
	TerminalSettings,
} from '../../types/settings';
import type {
	FileViewerGitRepoInfo,
	FileViewerSparseFileEdit,
} from '../../types/terminay';
import {
	TerminalPanelClientContext,
	type TerminalPanelClientContextValue,
} from '../TerminalPanel';
import { FileAuthorityUnavailableState } from './FileAuthorityUnavailableState';
import { FileConflictBanner } from './FileConflictBanner';
import { FileLargeFileChooser } from './FileLargeFileChooser';
import { FileModeSwitcher } from './FileModeSwitcher';
import { useFilePanelSaveRegistration } from './FilePanelSaveRegistry';
import { FileStatusBar } from './FileStatusBar';
import { DiffViewer } from './modes/DiffViewer';
import { HexViewer } from './modes/HexViewer';
import { PerformantTextViewer } from './modes/PerformantTextViewer';
import { PreviewViewer } from './modes/PreviewViewer';
import {
	materializeCanonicalPerformantDraft,
	materializePerformantDraft,
} from './modes/sharedDraftTransition';
import { TasksViewer } from './modes/TasksViewer';
import { TextViewer } from './modes/TextViewer';
import type { FilePanelInstanceParams } from './types';
import './fileViewer.css';

function hasFileInfoChanged(
	currentInfo: FileInfo | null,
	nextInfo: FileInfo,
): boolean {
	return (
		currentInfo === null ||
		currentInfo.exists !== nextInfo.exists ||
		currentInfo.isBinary !== nextInfo.isBinary ||
		currentInfo.isDirectory !== nextInfo.isDirectory ||
		currentInfo.isFile !== nextInfo.isFile ||
		currentInfo.isSymbolicLink !== nextInfo.isSymbolicLink ||
		currentInfo.mtimeMs !== nextInfo.mtimeMs ||
		currentInfo.size !== nextInfo.size
	);
}

function decodeBase64ToUint8Array(base64: string): Uint8Array {
	return Uint8Array.from(window.atob(base64), (character) =>
		character.charCodeAt(0),
	);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

function encodeUint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return window.btoa(binary);
}

function getCustomDefaultMode(
	file: FileInfo,
	customExtensions: { defaultMode: FileViewerDefaultMode; extension: string }[],
) {
	return customExtensions.find((entry) => entry.extension === file.extension)
		?.defaultMode;
}

export function FilePanel(props: IDockviewPanelProps<FilePanelInstanceParams>) {
	const terminalClientContext = useContext(TerminalPanelClientContext);
	if (
		terminalClientContext?.fileViewerClient === undefined ||
		terminalClientContext.fileObservationClient === undefined ||
		terminalClientContext.projectId.length === 0
	) {
		return <FileAuthorityUnavailableState feature="File viewer" />;
	}
	return (
		<CanonicalFilePanel
			{...props}
			terminalClientContext={{
				...terminalClientContext,
				fileObservationClient: terminalClientContext.fileObservationClient,
				fileViewerClient: terminalClientContext.fileViewerClient,
			}}
		/>
	);
}

function CanonicalFilePanel(
	props: IDockviewPanelProps<FilePanelInstanceParams> & {
		terminalClientContext: TerminalPanelClientContextValue & {
			fileObservationClient: NonNullable<
				TerminalPanelClientContextValue['fileObservationClient']
			>;
			fileViewerClient: NonNullable<
				TerminalPanelClientContextValue['fileViewerClient']
			>;
		};
	},
) {
	const { terminalClientContext } = props;
	const {
		filePath,
		initialMode,
		preferredEngine = 'auto',
		projectRoot,
	} = props.params;
	const baseParamsRef = useRef(props.params);
	const panelApiRef = useRef(props.api);
	const containerApiRef = useRef(props.containerApi);
	const { settings, setSettings, settingsClient } = useTerminalSettings();
	const fileViewerClient = terminalClientContext.fileViewerClient;
	const contentFileViewerClient = fileViewerClient;
	const fileGateway = useMemo(
		() =>
			createServerFileGateway({
				client: terminalClientContext.fileViewerClient,
				observationClient: terminalClientContext.fileObservationClient,
				projectId: terminalClientContext.projectId,
				projectRoot,
			}),
		[
			projectRoot,
			terminalClientContext.fileObservationClient,
			terminalClientContext.fileViewerClient,
			terminalClientContext.projectId,
		],
	);
	const [fileInfo, setFileInfo] = useState<FileInfo | null>(
		props.params.fileInfo ?? null,
	);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [loadRequest, setLoadRequest] = useState(0);
	const [draftText, setDraftText] = useState('');
	const [engine, setEngine] = useState<FileViewerEngine>(preferredEngine);
	const [mode, setMode] = useState(initialMode ?? 'preview');
	const [diff, setDiff] = useState<GitFileDiff | null>(null);
	const [diffError, setDiffError] = useState<string | null>(null);
	const [diffStatus, setDiffStatus] = useState<
		'idle' | 'loading' | 'ready' | 'error'
	>('idle');
	const [gitRepoInfo, setGitRepoInfo] = useState<FileViewerGitRepoInfo | null>(
		null,
	);
	const [isDirty, setIsDirty] = useState(false);
	const [isHexValid, setIsHexValid] = useState(true);
	const [conflict, setConflict] = useState(false);
	const [showEngineChoice, setShowEngineChoice] = useState(false);
	const [hexDraftBase64, setHexDraftBase64] = useState<string | null>(null);
	const [sparseEdits, setSparseEdits] = useState<
		Map<string, FileViewerSparseFileEdit>
	>(() => new Map());
	const [sparseLineDeltas, setSparseLineDeltas] = useState<Map<string, number>>(
		() => new Map(),
	);
	const [previewSourceUrl, setPreviewSourceUrl] = useState<string | null>(null);
	const previewObjectUrlRef = useRef<string | null>(null);
	const draftBufferRef = useRef(createFileDraftBuffer({ text: '' }));
	const currentTextGetterRef = useRef<(() => string) | null>(null);
	const sparseEditsRef = useRef<Map<string, FileViewerSparseFileEdit>>(
		new Map(),
	);
	const sparseLineDeltasRef = useRef<Map<string, number>>(new Map());
	const sparseOriginalBytesRef = useRef<Map<string, number>>(new Map());
	const hasAppliedDefaultModeRef = useRef(initialMode !== undefined);
	const isMountedRef = useRef(true);
	const skipNextMonacoContentLoadRef = useRef(false);
	const monacoTransitionAbortRef = useRef<AbortController | null>(null);
	const acknowledgedWatchRevisionRef = useRef<{
		mtimeMs: number | null;
		path: string;
		size: number;
	} | null>(null);

	const sessionStore = useMemo(
		() =>
			fileInfo
				? createFileSessionStore(fileInfo, {
						engine,
						mode,
					})
				: null,
		[engine, fileInfo, mode],
	);
	const fileInfoRef = useRef<FileInfo | null>(fileInfo);
	const engineRef = useRef<FileViewerEngine>(engine);
	const isDirtyRef = useRef(isDirty);
	const conflictRef = useRef(conflict);
	const isHexValidRef = useRef(isHexValid);
	const modeRef = useRef(mode);
	const sessionStoreRef = useRef(sessionStore);

	fileInfoRef.current = fileInfo;
	engineRef.current = engine;
	isDirtyRef.current = isDirty;
	conflictRef.current = conflict;
	isHexValidRef.current = isHexValid;
	modeRef.current = mode;
	sessionStoreRef.current = sessionStore;
	const watchedFilePath = fileInfo?.path ?? null;
	const orderedSparseEntries = useMemo(
		() =>
			[...sparseEdits.entries()].sort(
				(left, right) => left[1].start - right[1].start,
			),
		[sparseEdits],
	);
	const orderedSparseEdits = useMemo(
		() => orderedSparseEntries.map(([, edit]) => edit),
		[orderedSparseEntries],
	);

	const handleHexValidationChange = useCallback((isValid: boolean) => {
		setIsHexValid(isValid);
	}, []);

	const handleCurrentTextGetterChange = useCallback(
		(getter: (() => string) | null) => {
			currentTextGetterRef.current = getter;
		},
		[],
	);

	const handleSparseEditChange = useCallback(
		(owner: string, edit: FileViewerSparseFileEdit | null, lineDelta = 0) => {
			const next = new Map(sparseEditsRef.current);
			const nextLineDeltas = new Map(sparseLineDeltasRef.current);
			if (edit) {
				for (const [existingOwner, existing] of next) {
					if (
						existingOwner !== owner &&
						edit.start < existing.end &&
						existing.start < edit.end
					) {
						next.delete(existingOwner);
						nextLineDeltas.delete(existingOwner);
						sparseOriginalBytesRef.current.delete(existingOwner);
					}
				}
				next.set(owner, edit);
				nextLineDeltas.set(owner, lineDelta);
			} else {
				next.delete(owner);
				nextLineDeltas.delete(owner);
				sparseOriginalBytesRef.current.delete(owner);
			}
			sparseEditsRef.current = next;
			sparseLineDeltasRef.current = nextLineDeltas;
			setSparseEdits(next);
			setSparseLineDeltas(nextLineDeltas);
			setIsDirty(next.size > 0);
			sessionStoreRef.current?.setDirty(next.size > 0);
		},
		[],
	);

	const handleSparseByteChange = useCallback(
		async (projectedOffset: number, value: number, currentValue: number) => {
			const currentInfo = fileInfoRef.current;
			if (!currentInfo) {
				return;
			}
			const entries = [...sparseEditsRef.current.entries()].sort(
				(left, right) => left[1].start - right[1].start,
			);
			const location = mapProjectedOffset(
				currentInfo.size,
				entries.map(([, edit]) => edit),
				projectedOffset,
			);
			if (!location) {
				return;
			}
			const newlineDelta =
				Number(value === 0x0a) - Number(currentValue === 0x0a);
			if (location.kind === 'original') {
				let page: number | null = null;
				if (newlineDelta !== 0) {
					try {
						let metadata = await fileViewerClient.getServerTextMetadata(
							toProjectRelativePath(projectRoot, currentInfo.path),
							terminalClientContext.projectId,
						);
						while (page === null) {
							let low = 0;
							let high = Math.max(0, metadata.lineCount - 1);
							while (low <= high) {
								const middle = Math.floor((low + high) / 2);
								const line = (
									await fileViewerClient.readServerTextLines(
										toProjectRelativePath(projectRoot, currentInfo.path),
										middle,
										1,
										terminalClientContext.projectId,
									)
								).lines[0];
								if (!line) {
									break;
								}
								const lineEnd =
									line.end + new TextEncoder().encode(line.eol).byteLength;
								if (location.originalOffset < line.start) {
									high = middle - 1;
								} else if (location.originalOffset >= lineEnd) {
									low = middle + 1;
								} else {
									page = Math.floor(line.lineNumber / 128);
									break;
								}
							}
							if (page !== null || metadata.isComplete) {
								break;
							}
							// Index only another bounded chunk when the edited byte lies
							// beyond the currently indexed prefix. Completing a very large
							// file before mapping an early byte creates avoidable renderer
							// pressure during HEX/Text transitions.
							metadata = await fileViewerClient.getServerTextMetadata(
								toProjectRelativePath(projectRoot, currentInfo.path),
								terminalClientContext.projectId,
							);
						}
					} catch {
						// Binary files have no UTF-8 line projection; their byte draft remains valid.
					}
				}
				const owner =
					page === null
						? `hex-byte:${location.originalOffset}`
						: `hex-byte:${location.originalOffset}:page:${page}`;
				sparseOriginalBytesRef.current.set(owner, currentValue);
				handleSparseEditChange(
					owner,
					{
						dataBase64: encodeUint8ArrayToBase64(Uint8Array.of(value)),
						end: location.originalOffset + 1,
						start: location.originalOffset,
					},
					newlineDelta,
				);
				return;
			}

			const [owner, edit] = entries[location.editIndex];
			const replacement = decodeSparseEdit(edit);
			replacement[location.replacementOffset] = value;
			if (
				replacement.byteLength === 1 &&
				sparseOriginalBytesRef.current.get(owner) === value
			) {
				handleSparseEditChange(owner, null);
				return;
			}
			handleSparseEditChange(
				owner,
				{
					...edit,
					dataBase64: encodeUint8ArrayToBase64(replacement),
				},
				(sparseLineDeltasRef.current.get(owner) ?? 0) + newlineDelta,
			);
		},
		[
			fileViewerClient,
			handleSparseEditChange,
			projectRoot,
			terminalClientContext.projectId,
		],
	);

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
			monacoTransitionAbortRef.current?.abort();
		};
	}, []);

	useEffect(() => {
		const onModeRequest = (event: Event) => {
			const customEvent = event as CustomEvent<{
				mode?: FileViewerMode;
				path?: string;
			}>;
			if (customEvent.detail?.path !== filePath || !customEvent.detail.mode) {
				return;
			}

			hasAppliedDefaultModeRef.current = true;
			setMode(customEvent.detail.mode);
			sessionStoreRef.current?.setMode(customEvent.detail.mode);
		};

		window.addEventListener('terminay-file-mode-request', onModeRequest);
		return () => {
			window.removeEventListener('terminay-file-mode-request', onModeRequest);
		};
	}, [filePath]);

	const refreshDiff = useCallback(
		async (targetPath: string, options?: { keepPrevious?: boolean }) => {
			if (!isMountedRef.current) {
				return;
			}
			if (!options?.keepPrevious) {
				setDiff(null);
			}
			setDiffError(null);
			setDiffStatus('loading');

			try {
				const [nextRepoInfo, nextDiff] = await Promise.all([
					fileGateway.getGitRepoInfo(targetPath),
					fileGateway.getFileDiff(targetPath),
				]);
				if (!isMountedRef.current) {
					return;
				}
				setGitRepoInfo(nextRepoInfo);
				setDiff(nextDiff);
				setDiffStatus('ready');
			} catch (error) {
				if (!isMountedRef.current) {
					return;
				}
				setGitRepoInfo(null);
				if (!options?.keepPrevious) {
					setDiff(null);
				}
				setDiffError(error instanceof Error ? error.message : String(error));
				setDiffStatus('error');
			}
		},
		[fileGateway],
	);

	const saveSparseDraft = useCallback(async (): Promise<FileInfo> => {
		const currentFileInfo = fileInfoRef.current;
		const edits = [...sparseEditsRef.current.values()].sort(
			(left, right) => left.start - right.start,
		);
		if (!currentFileInfo) {
			throw new Error('The sparse draft no longer has a file revision.');
		}
		if (edits.length === 0) {
			return currentFileInfo;
		}
		// The server-owned catalog DTO may not expose host inode identity. In
		// connected mode, do not fall back to the disconnected Desktop preload
		// gateway; fail closed until sparse-save revision authority is composed
		// into the server protocol.
		const mutationRevision =
			currentFileInfo.ino === null || currentFileInfo.mtimeMs === null
				? await fileGateway.getMutationRevision(currentFileInfo.path)
				: currentFileInfo;
		if (mutationRevision === undefined) {
			throw new Error(
				'Sparse saves are unavailable without disconnected file compatibility.',
			);
		}
		if (mutationRevision.ino === null || mutationRevision.mtimeMs === null) {
			throw new Error(
				'The file revision cannot be verified for a sparse save.',
			);
		}
		const expectedIno = mutationRevision.ino;
		const expectedMtimeMs = mutationRevision.mtimeMs;

		try {
			await fileViewerClient.saveSparseFile({
				edits,
				expectedIno,
				expectedMtimeMs,
				expectedSize: mutationRevision.size,
				path: currentFileInfo.path,
				projectRoot,
			});
			const nextInfo = await fileGateway.getFileInfo(currentFileInfo.path);
			acknowledgedWatchRevisionRef.current = {
				mtimeMs: nextInfo.mtimeMs,
				path: nextInfo.path,
				size: nextInfo.size,
			};
			sparseEditsRef.current = new Map();
			sparseLineDeltasRef.current = new Map();
			sparseOriginalBytesRef.current = new Map();
			setSparseEdits(new Map());
			setSparseLineDeltas(new Map());
			setFileInfo(nextInfo);
			setIsDirty(false);
			sessionStoreRef.current?.setDirty(false);
			conflictRef.current = false;
			setConflict(false);
			sessionStoreRef.current?.setConflict({ kind: 'none' });
			// A sparse save must remain sparse. Building an eager Git diff for a
			// 100+ MiB file defeats the bounded editor path and can exhaust the
			// renderer even when the Diff/Tasks presentation is not open.
			if (modeRef.current === 'diff' || modeRef.current === 'tasks') {
				await refreshDiff(nextInfo.path);
			}
			return nextInfo;
		} catch (error) {
			conflictRef.current = true;
			setConflict(true);
			sessionStoreRef.current?.setConflict({
				diskMtimeMs: expectedMtimeMs,
				kind: 'external-change',
			});
			throw error;
		}
	}, [fileGateway, fileViewerClient, projectRoot, refreshDiff]);

	const saveCurrentFile = useCallback(async (): Promise<boolean> => {
		const currentFileInfo = fileInfoRef.current;
		if (!currentFileInfo) return false;
		if (conflictRef.current)
			throw new Error(
				'Choose Reload from disk or Keep local edits before saving.',
			);
		if (sparseEditsRef.current.size > 0) {
			await saveSparseDraft();
			return true;
		}
		if (modeRef.current === 'hex' && !isHexValidRef.current)
			throw new Error('Fix invalid HEX byte values before saving.');
		if (modeRef.current === 'text') {
			const currentText = currentTextGetterRef.current?.();
			if (currentText !== undefined) {
				setDraftText(currentText);
				draftBufferRef.current.setText(currentText);
			}
		}
		const payload = draftBufferRef.current.getPayload();
		const nextInfo = await fileGateway.saveFile(currentFileInfo.path, payload);
		if (payload.kind === 'text') {
			if ((await fileGateway.readFileText(nextInfo.path)) !== payload.text)
				throw new Error(
					'Save failed: disk contents did not match the editor contents.',
				);
		} else if (
			(
				await fileGateway.readFileBytes(nextInfo.path, {
					length: nextInfo.size,
					offset: 0,
				})
			).base64 !== payload.base64
		) {
			throw new Error(
				'Save failed: disk bytes did not match the editor contents.',
			);
		}
		if (payload.kind === 'text')
			draftBufferRef.current.replaceText(payload.text);
		else draftBufferRef.current.replaceBytes(payload.base64);
		acknowledgedWatchRevisionRef.current = {
			mtimeMs: nextInfo.mtimeMs,
			path: nextInfo.path,
			size: nextInfo.size,
		};
		setFileInfo(nextInfo);
		setIsDirty(false);
		sessionStoreRef.current?.setDirty(false);
		conflictRef.current = false;
		setConflict(false);
		sessionStoreRef.current?.setConflict({ kind: 'none' });
		if (modeRef.current === 'diff' || modeRef.current === 'tasks')
			void refreshDiff(nextInfo.path);
		return true;
	}, [fileGateway, refreshDiff, saveSparseDraft]);

	useFilePanelSaveRegistration(props.api.id, saveCurrentFile);

	const handleSwitchToMonaco = useCallback(async () => {
		const currentInfo = fileInfoRef.current;
		if (!currentInfo) {
			throw new Error('The file is no longer available.');
		}
		if (!detectFileCapabilities(currentInfo).canUseMonaco) {
			return;
		}
		const edits = [...sparseEditsRef.current.values()].sort(
			(left, right) => left.start - right.start,
		);
		const sparseSnapshot = sparseEditsRef.current;
		monacoTransitionAbortRef.current?.abort();
		const controller = new AbortController();
		monacoTransitionAbortRef.current = controller;
		const canonicalDraft = await materializeCanonicalPerformantDraft(
			contentFileViewerClient,
			toProjectRelativePath(projectRoot, currentInfo.path),
			terminalClientContext.projectId,
			currentInfo.size,
			edits,
			controller.signal,
		);
		const originalText = canonicalDraft.originalText;
		let projectedDraft: ReturnType<typeof materializePerformantDraft> =
			canonicalDraft;
		if (controller.signal.aborted || !isMountedRef.current) {
			return;
		}
		if (sparseEditsRef.current !== sparseSnapshot) {
			projectedDraft = materializePerformantDraft(
				originalText,
				[...sparseEditsRef.current.values()].sort(
					(left, right) => left.start - right.start,
				),
			);
		}
		const projectedText = projectedDraft.text;

		draftBufferRef.current.replaceText(originalText);
		draftBufferRef.current.setText(projectedText);
		setDraftText(projectedText);
		setIsDirty(projectedDraft.dirty);
		sessionStoreRef.current?.setDirty(projectedDraft.dirty);
		skipNextMonacoContentLoadRef.current = true;
		engineRef.current = 'monaco';
		setEngine('monaco');
		sessionStoreRef.current?.setEngine('monaco');
	}, [
		contentFileViewerClient,
		fileGateway,
		projectRoot,
		terminalClientContext.projectId,
	]);

	useEffect(() => {
		let isMounted = true;

		const load = async () => {
			let info: FileInfo;
			try {
				info = await fileGateway.getFileInfo(filePath);
			} catch (error) {
				if (isMounted) {
					setLoadError(error instanceof Error ? error.message : String(error));
				}
				return;
			}
			if (!isMounted) {
				return;
			}

			setLoadError(null);
			setFileInfo(info);
			props.api.setTitle(info.name);
			const capabilities = detectFileCapabilities(info);
			const resolvedEngine = resolveFileViewerEngine(
				info,
				capabilities,
				// An explicit choice made in this mounted panel is authoritative.
				// Settings hydration and metadata refreshes can rerun this effect
				// after the large-file chooser has closed; resolving from the
				// original "auto" parameter would otherwise reopen the chooser and
				// replace the performant viewer before it renders.
				engineRef.current === 'auto' ? preferredEngine : engineRef.current,
			);
			setEngine(resolvedEngine);
			if (!hasAppliedDefaultModeRef.current) {
				const currentSettings = await settingsClient.get<TerminalSettings>();
				if (!isMounted) {
					return;
				}
				const defaultMode =
					getCustomDefaultMode(
						info,
						currentSettings.fileViewer.customFileExtensions,
					) ?? capabilities.defaultMode;
				hasAppliedDefaultModeRef.current = true;
				setMode(defaultMode);
			}
			if (previewObjectUrlRef.current) {
				URL.revokeObjectURL(previewObjectUrlRef.current);
				previewObjectUrlRef.current = null;
			}
			if (
				capabilities.previewKind === 'image' ||
				capabilities.previewKind === 'pdf'
			) {
				try {
					const byteRange = await fileGateway.readFileBytes(filePath, {
						length: info.size,
						offset: 0,
					});
					const byteArray = decodeBase64ToUint8Array(byteRange.base64);
					const objectUrl = URL.createObjectURL(
						new Blob([toArrayBuffer(byteArray)], {
							type:
								info.mimeType ??
								(capabilities.previewKind === 'pdf'
									? 'application/pdf'
									: 'application/octet-stream'),
						}),
					);
					if (isMounted) {
						previewObjectUrlRef.current = objectUrl;
						setPreviewSourceUrl(objectUrl);
					} else {
						URL.revokeObjectURL(objectUrl);
					}
				} catch {
					if (isMounted) {
						setPreviewSourceUrl(null);
					}
				}
			} else if (isMounted) {
				setPreviewSourceUrl(null);
			}

			if (
				capabilities.shouldPromptForEngineChoice &&
				resolvedEngine === 'auto' &&
				preferredEngine === 'auto'
			) {
				setShowEngineChoice(true);
				return;
			}

			setShowEngineChoice(false);

			if (isMounted) {
				void refreshDiff(filePath);
			}
		};

		void load();

		return () => {
			isMounted = false;
			if (previewObjectUrlRef.current) {
				URL.revokeObjectURL(previewObjectUrlRef.current);
				previewObjectUrlRef.current = null;
			}
		};
	}, [
		fileGateway,
		filePath,
		loadRequest,
		preferredEngine,
		props.api,
		refreshDiff,
		settingsClient,
	]);

	useEffect(() => {
		if (!fileInfo) {
			return;
		}

		if (showEngineChoice && engine === 'auto') {
			return;
		}

		let isMounted = true;

		const loadContent = async () => {
			if (engine === 'monaco' && skipNextMonacoContentLoadRef.current) {
				skipNextMonacoContentLoadRef.current = false;
				return;
			}
			if (
				engine === 'monaco' &&
				fileInfo.size > LARGE_FILE_THRESHOLD_BYTES &&
				draftBufferRef.current.isDirty()
			) {
				return;
			}
			if (!fileInfo.isBinary) {
				if (
					engine === 'performant' &&
					fileInfo.size > LARGE_FILE_THRESHOLD_BYTES
				) {
					setDraftText('');
					return;
				}

				const text = await fileGateway.readFileText(fileInfo.path);
				if (!isMounted) {
					return;
				}
				setDraftText(text);
				draftBufferRef.current.replaceText(text);
			} else {
				if (fileInfo.size <= LARGE_FILE_THRESHOLD_BYTES) {
					const response = await fileGateway.readFileBytes(fileInfo.path, {
						length: fileInfo.size,
						offset: 0,
					});
					if (!isMounted) {
						return;
					}
					draftBufferRef.current.replaceBytes(response.base64);
					setHexDraftBase64(response.base64);
				}
			}
		};

		void loadContent();

		return () => {
			isMounted = false;
		};
	}, [engine, fileGateway, fileInfo, showEngineChoice]);

	useEffect(() => {
		if (
			mode !== 'text' ||
			!fileInfo?.isBinary ||
			fileInfo.size > LARGE_FILE_THRESHOLD_BYTES ||
			hexDraftBase64 === null
		) {
			return;
		}

		const nextText = draftBufferRef.current.getText();
		setDraftText(nextText);
		draftBufferRef.current.setText(nextText);
	}, [fileInfo, hexDraftBase64, mode]);

	useEffect(() => {
		if (!watchedFilePath) {
			return;
		}

		const watchedPath = watchedFilePath;
		let refreshTimeoutId: number | null = null;
		let refreshVersion = 0;
		let disposed = false;
		const runRefresh = (force = false) => {
			refreshTimeoutId = null;
			const requestVersion = ++refreshVersion;

			void (async () => {
				const nextInfo = await fileGateway.getFileInfo(watchedPath);
				if (
					disposed ||
					requestVersion !== refreshVersion ||
					(!force && !hasFileInfoChanged(fileInfoRef.current, nextInfo))
				) {
					return;
				}

				setFileInfo(nextInfo);
				sessionStoreRef.current?.setFile(nextInfo);

				if (modeRef.current === 'diff' || modeRef.current === 'tasks') {
					void refreshDiff(nextInfo.path, { keepPrevious: true });
				}
			})();
		};

		const scheduleRefresh = () => {
			if (refreshTimeoutId !== null) {
				return;
			}

			// Canonical observation events already coalesce host noise. The user
			// refresh interval is a polling fallback, not a throttle: applying it
			// here can defer the second atomic rename for the full assertion
			// window after the first replacement was rendered.
			refreshTimeoutId = window.setTimeout(() => runRefresh(true), 0);
		};

		void fileGateway.watchFile(watchedPath);
		const dispose = fileGateway.onFileWatchEvent(async (event) => {
			if (event.path !== watchedPath) {
				return;
			}
			const acknowledged = acknowledgedWatchRevisionRef.current;
			if (
				acknowledged &&
				acknowledged.path === event.path &&
				acknowledged.mtimeMs === event.mtimeMs &&
				acknowledged.size === event.size
			) {
				acknowledgedWatchRevisionRef.current = null;
				return;
			}

			if (isDirtyRef.current) {
				conflictRef.current = true;
				setConflict(true);
				sessionStoreRef.current?.setConflict({
					diskMtimeMs: event.mtimeMs ?? 0,
					kind: 'external-change',
				});
				return;
			}

			scheduleRefresh();
		});

		return () => {
			disposed = true;
			refreshVersion += 1;
			if (refreshTimeoutId !== null) {
				window.clearTimeout(refreshTimeoutId);
			}
			dispose();
			void fileGateway.unwatchFile(watchedPath);
		};
	}, [fileGateway, watchedFilePath, refreshDiff]);

	useEffect(() => {
		if ((mode !== 'diff' && mode !== 'tasks') || !watchedFilePath) {
			return;
		}

		void refreshDiff(watchedFilePath, { keepPrevious: true });
	}, [mode, refreshDiff, watchedFilePath]);

	useEffect(() => {
		const panelApi = panelApiRef.current;
		const containerApi = containerApiRef.current;
		panelApi.updateParameters({
			...baseParamsRef.current,
			fileInfo: fileInfo ?? undefined,
			isDirty,
			isFocused: containerApi.activePanel?.id === panelApi.id,
			onSave: saveCurrentFile,
			preferredEngine: engine,
		});
	}, [engine, fileInfo, isDirty, saveCurrentFile]);

	const handleModeChange = useCallback(async (nextMode: FileViewerMode) => {
		const nextInfo = fileInfoRef.current;
		hasAppliedDefaultModeRef.current = true;
		if (
			nextMode === 'hex' &&
			nextInfo &&
			nextInfo.size <= LARGE_FILE_THRESHOLD_BYTES
		) {
			setHexDraftBase64(draftBufferRef.current.getBase64());
		}
		if (
			nextMode === 'text' &&
			nextInfo &&
			nextInfo.size <= LARGE_FILE_THRESHOLD_BYTES
		) {
			const nextText = draftBufferRef.current.getText();
			setDraftText(nextText);
			draftBufferRef.current.setText(nextText);
		}
		setMode(nextMode);
		sessionStoreRef.current?.setMode(nextMode);
	}, []);

	if (!fileInfo && loadError) {
		return (
			<div className="file-panel file-panel--load-error" role="alert">
				<strong>Unable to load file</strong>
				<span>{loadError}</span>
				<button
					type="button"
					onClick={() => {
						setLoadError(null);
						setLoadRequest((request) => request + 1);
					}}
				>
					Retry
				</button>
			</div>
		);
	}

	if (!fileInfo) {
		return <div className="file-panel file-panel--loading">Loading file…</div>;
	}

	const capabilities = detectFileCapabilities(fileInfo);
	const canDiff =
		gitRepoInfo?.canDiff === true ||
		diff?.isTracked === true ||
		diffStatus === 'loading';
	const availableModes: FileViewerMode[] = capabilities.canTasks
		? ['preview', 'tasks', 'text', 'hex', 'diff']
		: ['preview', 'text', 'hex', 'diff'];
	const effectiveMode =
		mode === 'diff' && !canDiff
			? capabilities.fallbackMode
			: resolveFileViewerMode(capabilities, mode);

	return (
		<div
			className="file-panel"
			style={
				{
					'--tab-color':
						props.params.color ?? props.params.projectColor ?? '#717b85',
				} as CSSProperties
			}
		>
			{conflict ? (
				<FileConflictBanner
					onKeepLocal={() => {
						conflictRef.current = false;
						setConflict(false);
						sessionStore?.setConflict({ kind: 'none' });
					}}
					onReload={async () => {
						const nextInfo = await fileGateway.getFileInfo(fileInfo.path);
						sparseEditsRef.current = new Map();
						sparseLineDeltasRef.current = new Map();
						sparseOriginalBytesRef.current = new Map();
						setSparseEdits(new Map());
						setSparseLineDeltas(new Map());
						setFileInfo(nextInfo);
						if (!nextInfo.isBinary) {
							setDraftText(await fileGateway.readFileText(nextInfo.path));
						}
						setIsDirty(false);
						conflictRef.current = false;
						setConflict(false);
						sessionStore?.setDirty(false);
						sessionStore?.setConflict({ kind: 'none' });
					}}
				/>
			) : null}

			<div className="file-panel__toolbar">
				<FileModeSwitcher
					activeMode={effectiveMode}
					modes={availableModes}
					disabledModes={{
						diff: !canDiff || !isFileViewerModeAvailable(capabilities, 'diff'),
						hex: !isFileViewerModeAvailable(capabilities, 'hex'),
						preview: !isFileViewerModeAvailable(capabilities, 'preview'),
						tasks: !isFileViewerModeAvailable(capabilities, 'tasks'),
						text: !isFileViewerModeAvailable(capabilities, 'text'),
					}}
					onChangeMode={(nextMode) => {
						void handleModeChange(nextMode);
					}}
				/>
				{capabilities.shouldPromptForEngineChoice && showEngineChoice ? (
					<FileLargeFileChooser
						fileName={fileInfo.name}
						fileSize={fileInfo.size}
						onChoose={(choice) => {
							engineRef.current = choice;
							setEngine(choice);
							setShowEngineChoice(false);
							sessionStore?.setEngine(choice);
						}}
					/>
				) : null}
			</div>

			<div className="file-panel__body">
				{effectiveMode === 'preview' ? (
					<PreviewViewer
						file={fileInfo}
						previewSourceUrl={previewSourceUrl}
						text={draftText}
					/>
				) : null}
				{effectiveMode === 'tasks' ? (
					<TasksViewer text={draftText} diff={diff} />
				) : null}
				{engine === 'performant' &&
				fileInfo.size > LARGE_FILE_THRESHOLD_BYTES ? (
					<div className="file-panel__viewer" hidden={effectiveMode !== 'text'}>
						<PerformantTextViewer
							key={`${fileInfo.path}:${fileInfo.size}:${fileInfo.mtimeMs ?? 'unknown'}`}
							canSwitchToMonaco={capabilities.canUseMonaco}
							fileViewerClient={contentFileViewerClient}
							filePath={fileInfo.path}
							projectId={terminalClientContext.projectId}
							projectRoot={projectRoot}
							onSparseEditChange={handleSparseEditChange}
							onSwitchToMonaco={handleSwitchToMonaco}
							sparseEdits={orderedSparseEntries}
							sparseLineDeltas={sparseLineDeltas}
						/>
					</div>
				) : effectiveMode === 'text' ? (
					!fileInfo.isDirectory ? (
						<TextViewer
							engine={engine}
							filePath={fileInfo.path}
							language={fileInfo.extension.replace(/^\./, '')}
							text={draftText}
							onCurrentTextGetterChange={handleCurrentTextGetterChange}
							onChangeText={(text) => {
								setDraftText(text);
								draftBufferRef.current.setText(text);
								const dirty = draftBufferRef.current.isDirty();
								setIsDirty(dirty);
								sessionStore?.setDirty(dirty);
							}}
						/>
					) : (
						<div className="file-preview-unsupported">
							Text view is not available for this binary file. Use HEX instead.
						</div>
					)
				) : null}
				{effectiveMode === 'hex' ? (
					<HexViewer
						draftBase64={
							fileInfo.size <= LARGE_FILE_THRESHOLD_BYTES
								? hexDraftBase64
								: null
						}
						filePath={fileInfo.path}
						fileSize={fileInfo.size}
						sparseEdits={
							fileInfo.size > LARGE_FILE_THRESHOLD_BYTES
								? orderedSparseEdits
								: undefined
						}
						onValidationChange={handleHexValidationChange}
						readFileBytes={async (offset, length) =>
							(
								await fileGateway.readFileBytes(fileInfo.path, {
									offset,
									length,
								})
							).base64
						}
						onChangeByte={(offset, value, originalValue) => {
							if (fileInfo.size > LARGE_FILE_THRESHOLD_BYTES) {
								handleSparseByteChange(offset, value, originalValue);
							} else {
								draftBufferRef.current.setByte(offset, value);
								const dirty = draftBufferRef.current.isDirty();
								setIsDirty(dirty);
								sessionStore?.setDirty(dirty);
							}
						}}
					/>
				) : null}
				{effectiveMode === 'diff' ? (
					<DiffViewer
						diff={diff}
						error={diffError}
						filePath={fileInfo.path}
						isLoading={diffStatus === 'loading'}
						layout={settings.fileViewer.diffLayout}
						onChangeLayout={(diffLayout) => {
							const nextSettings = {
								...settings,
								fileViewer: {
									...settings.fileViewer,
									diffLayout,
								},
							};
							setSettings(nextSettings);
							void settingsClient.update(
								nextSettings as unknown as import('@terminay/protocol').JsonValue,
							);
						}}
					/>
				) : null}
			</div>

			<FileStatusBar
				file={fileInfo}
				engine={engine}
				isDirty={isDirty}
				isValid={effectiveMode !== 'hex' || isHexValid}
			/>
		</div>
	);
}
