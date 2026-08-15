import type {
	ActivityClient,
	AgentStatusClient,
	FileObservationClient,
	FileViewerClient,
	RecordingsClient,
	TerminalClientIdentity,
	TerminalPanelAttachment,
	TerminalPresentationState,
	TerminalStreamEvent,
	TerminalStreamResyncEvent,
	TerminayClient,
	TerminayGitClient,
} from '@terminay/client-core';
import {
	TerminayTerminalClient,
	TerminayTerminalPanelClient,
} from '@terminay/client-core';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { ILinkHandler } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import type { IDockviewPanelProps } from 'dockview';
import type { CSSProperties } from 'react';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { useTerminalSettings } from '../hooks/useTerminalSettings';
import {
	canReadTerminalClipboard,
	canUseDesktopTerminalClipboard,
	openExternalUrl,
	readTerminalClipboard,
	resolveDesktopDroppedFilePath,
	writeClipboardText,
} from '../host/nativeActions';
import { subscribeTerminalZoom } from '../host/nativeEvents';
import { recordRendererDiagnostic } from '../shared/rendererDiagnostics';
import type { WorkspaceSnapshotStore } from '../shared/WorkspaceSnapshotStore';
import { formatBracketedPaste } from '../terminalInput';
import {
	buildTerminalOptions,
	resolveTerminalTheme,
} from '../terminalSettings';
import type { TerminalSettings } from '../types/settings';
import { ContextMenu } from './ContextMenu';
import type { DictationOverlayProps } from './DictationOverlay';
import { DictationOverlay } from './DictationOverlay';
import type { TerminalPanelParams } from './TerminalTab';
import {
	clearTerminalViewport,
	shouldClearTerminalForSession,
} from './terminalClearInteraction';
import { copyTerminalSelection } from './terminalClipboardInteraction';
import {
	escapeTerminalPathForShell,
	getTerminalDropText,
	shouldInterceptTerminalDrop,
	uploadBrowserTerminalDrop,
} from './terminalDropInteraction';
import { formatTerminalExitNotice } from './terminalExitInteraction';
import { shouldRestoreTerminalFocusAfterWindowActivation } from './terminalFocusInteraction';
import { createTerminalLinkInteraction } from './terminalLinkInteraction';
import { shouldInsertTerminalMultilineNewline } from './terminalMultilineInteraction';
import { shouldReturnFocusToTerminalFromNote } from './terminalNoteInteraction';
import {
	isTerminalRetryActionable,
	type TerminalPanelBinding,
	TerminalPanelBindingFence,
} from './terminalPanelBindingFence';
import {
	isTerminalPresentationOwnershipError,
	ServerTerminalInputQueue,
} from './terminalPanelInputQueue';
import {
	pasteTerminalClipboard,
	shouldHandleTerminalPasteShortcut,
} from './terminalPasteInteraction';
import { buildTerminalPresentationOptions } from './terminalPresentationInteraction';
import { getTerminalScrollbackAction } from './terminalScrollbackInteraction';
import { isTerminalSearchShortcut } from './terminalSearchInteraction';
import { getTerminalSwitcherDirection } from './terminalSwitcherInteraction';
import { bindTerminalTouchScroll } from './terminalTouchScrollInteraction';
import { resolveTerminalZoomedFontSize } from './terminalZoomInteraction';

/**
 * Connection-scoped terminal authority supplied by a host shell. The client
 * must be stable for the lifetime of the connection so its attachment cursor
 * and reconnect high-water marks remain meaningful across panels.
 */
export interface TerminalPanelClientContextValue {
	readonly applicationClient?: TerminayClient;
	readonly client: TerminayTerminalClient;
	/** Optional canonical activity projection for this connection. It is kept
	 * separate from the panel stream so non-terminal routes can share it. */
	readonly activityClient?: ActivityClient;
	/** Optional reduced server-owned agent projection for this connection. */
	readonly agentStatusClient?: AgentStatusClient;
	/** Authenticated connection-wide workspace projection. */
	readonly workspaceSnapshotStore?: WorkspaceSnapshotStore;
	/** Closes all connection-scoped subscriptions before the protocol transport. */
	readonly dispose?: () => Promise<void>;
	/** Server-backed catalog client shared with folder/file panels. */
	readonly fileViewerClient?: FileViewerClient;
	/** Server-owned project-scoped filesystem watch and folder-size events. */
	readonly fileObservationClient?: FileObservationClient;
	readonly recordingsClient?: RecordingsClient;
	/** Server-owned Git/worktree and reviewed Quick Push commands. */
	readonly gitClient?: TerminayGitClient;
	readonly serverId: string;
	readonly projectId: string;
	readonly projectRoot?: string;
	readonly clientId: string;
	/** Host-owned display metadata for the authenticated current server. */
	readonly connectionLabel?: string;
	/** Stable action on the owning connection controller. It never captures a client. */
	readonly retryConnection?: () => void;
	readonly canRetryConnection?: () => boolean;
	/** Reports that this mounted panel rendered and attached the replacement client. */
	readonly reportConnectionHydrated?: () => void;
	readonly reportConnectionHydrationFailed?: (error: unknown) => void;
	/** Changes when a recovered connection needs a fresh workspace tree. */
	readonly connectionGeneration?: string;
	readonly serverCapabilities?: readonly string[];
}

export const TerminalPanelClientContext =
	createContext<TerminalPanelClientContextValue | null>(null);

export type TerminalPanelClientResolution = {
	readonly panelClient?: TerminayTerminalPanelClient;
	readonly identity?: Pick<TerminalClientIdentity, 'serverId' | 'projectId'>;
	readonly clientId?: string;
};

/**
 * The terminal attachment only needs connection identity. Keep this deliberately
 * narrower than the workspace context: project-root and file-upload changes are
 * presentation concerns and must not reconnect an already mounted terminal.
 */
type TerminalPanelConnectionContext = Pick<
	TerminalPanelClientContextValue,
	| 'client'
	| 'serverId'
	| 'projectId'
	| 'clientId'
	| 'retryConnection'
	| 'canRetryConnection'
	| 'reportConnectionHydrated'
	| 'reportConnectionHydrationFailed'
>;

export function createReplaceableTerminalPanelClient(
	current: () => TerminayTerminalPanelClient | undefined,
): TerminayTerminalPanelClient {
	return new Proxy({} as TerminayTerminalPanelClient, {
		get: (_target, property) => {
			const delegate = current();
			if (delegate === undefined)
				throw new Error('The server terminal client is unavailable.');
			const value = Reflect.get(delegate, property);
			return typeof value === 'function' ? value.bind(delegate) : value;
		},
	});
}

/** Resolve panel params from canonical server context or an explicit moved /
 * embedded panel binding. There is no preload-owned terminal fallback. */
export function resolveTerminalPanelClient(
	params: Pick<
		TerminalPanelParams,
		'terminalPanelClient' | 'terminalClientIdentity' | 'terminalClientId'
	>,
	context: TerminalPanelConnectionContext | null,
	contextPanelClient?: TerminayTerminalPanelClient,
): TerminalPanelClientResolution {
	return {
		panelClient:
			params.terminalPanelClient ??
			contextPanelClient ??
			(context === null
				? undefined
				: new TerminayTerminalPanelClient(context.client)),
		identity:
			params.terminalClientIdentity ??
			(context === null
				? undefined
				: { serverId: context.serverId, projectId: context.projectId }),
		clientId: params.terminalClientId ?? context?.clientId,
	};
}

const OPEN_TERMINAL_SWITCHER_EVENT = 'terminay-open-terminal-switcher';
const DROP_FILE_EXPLORER_PATH_EVENT = 'terminay-drop-file-explorer-path';
const CLEAR_TERMINAL_EVENT = 'terminay-clear-terminal';
const COPY_TERMINAL_EVENT = 'terminay-copy-terminal';
export const TERMINAL_PANEL_INPUT_EVENT = 'terminay-terminal-panel-input';
export const TERMINAL_PANEL_OUTPUT_EVENT = 'terminay-terminal-panel-output';
export const TERMINAL_PANEL_EXIT_EVENT = 'terminay-terminal-panel-exit';
const TERMINAL_CONTEXT_MAX_LINES = 200;
const TERMINAL_CONTEXT_MAX_CHARS = 20_000;
// Replay is base64 in a protocol header; leave room for the result envelope.
const MAX_INITIAL_SERVER_TERMINAL_REPLAY_BYTES = 32 * 1024;
const TERMINAL_RECOVERY_RETRY_DELAY_MS = 100;
const TERMINAL_RECOVERY_ATTEMPT_DEADLINE_MS = 15_000;
const REMOTE_TERMINAL_SCALE_PROPERTY = '--terminal-remote-scale';
const EMPTY_TERMINAL_ROOT_SIZE = { height: 0, width: 0 };

function reportTerminalRebindDiagnostic(
	sessionId: string,
	phase: 'started' | 'attached' | 'failed',
	error?: unknown,
): void {
	try {
		(
			globalThis as typeof globalThis & {
				__terminayTerminalRebindDiagnostic?: (
					event: Readonly<{ sessionId: string; phase: string; error?: string }>,
				) => void;
			}
		).__terminayTerminalRebindDiagnostic?.(
			Object.freeze({
				sessionId,
				phase,
				...(error === undefined
					? {}
					: { error: error instanceof Error ? error.message : String(error) }),
			}),
		);
	} catch {
		// Metadata-only diagnostics cannot affect terminal attachment lifecycle.
	}
}
const searchOptions = {
	incremental: true,
	decorations: {
		matchBackground: '#24415f',
		matchBorder: '#4db5ff',
		matchOverviewRuler: '#4db5ff',
		activeMatchBackground: '#ffd76a',
		activeMatchBorder: '#ffb11a',
		activeMatchColorOverviewRuler: '#ffb11a',
	},
} as const;

function applyTerminalSettings(
	terminal: Terminal,
	settings: TerminalSettings,
	tabColor?: string,
	zoomLevel = 0,
) {
	Object.assign(
		terminal.options,
		buildTerminalPresentationOptions(settings, tabColor, zoomLevel),
	);
}

function updateTerminalGridMetadata(
	root: HTMLElement,
	cols: number,
	rows: number,
) {
	root.dataset.terminalCols = String(cols);
	root.dataset.terminalRows = String(rows);
}

function clearRemoteTerminalElementSize(root: HTMLElement, terminal: Terminal) {
	root.style.removeProperty(REMOTE_TERMINAL_SCALE_PROPERTY);

	if (!terminal.element) {
		return;
	}

	terminal.element.style.height = '';
	terminal.element.style.width = '';
}

function syncRemoteTerminalElementSize(root: HTMLElement, terminal: Terminal) {
	const element = terminal.element;
	if (!element) {
		return;
	}

	const screen = root.querySelector<HTMLElement>('.xterm-screen');
	const viewport = root.querySelector<HTMLElement>('.xterm-viewport');
	const measuredWidth =
		screen?.offsetWidth ??
		viewport?.offsetWidth ??
		screen?.getBoundingClientRect().width ??
		viewport?.getBoundingClientRect().width ??
		0;
	const measuredHeight =
		screen?.offsetHeight ??
		viewport?.offsetHeight ??
		screen?.getBoundingClientRect().height ??
		viewport?.getBoundingClientRect().height ??
		0;

	if (measuredWidth > 0) {
		element.style.width = `${Math.ceil(measuredWidth)}px`;
	}

	if (measuredHeight > 0) {
		element.style.height = `${Math.ceil(measuredHeight)}px`;
	}

	const availableWidth = root.clientWidth;
	const availableHeight = root.clientHeight;
	const scale =
		measuredWidth > 0 &&
		measuredHeight > 0 &&
		availableWidth > 0 &&
		availableHeight > 0
			? Math.min(
					1,
					availableWidth / measuredWidth,
					availableHeight / measuredHeight,
				)
			: 1;

	root.style.setProperty(REMOTE_TERMINAL_SCALE_PROPERTY, String(scale));
}

function applyRemoteTerminalSize(
	root: HTMLElement,
	terminal: Terminal,
	cols: number,
	rows: number,
	shouldSyncAfterFrame: () => boolean,
) {
	terminal.resize(cols, rows);
	updateTerminalGridMetadata(root, cols, rows);
	syncRemoteTerminalElementSize(root, terminal);
	window.requestAnimationFrame(() => {
		if (!shouldSyncAfterFrame()) {
			return;
		}

		syncRemoteTerminalElementSize(root, terminal);
	});
}

function getTerminalRootSize(root: HTMLElement) {
	return {
		height: Math.round(root.clientHeight),
		width: Math.round(root.clientWidth),
	};
}

function getRecentTerminalOutput(terminal: Terminal): string {
	const buffer = terminal.buffer.active;
	const startLine = Math.max(0, buffer.length - TERMINAL_CONTEXT_MAX_LINES);
	const lines: string[] = [];

	for (let lineIndex = startLine; lineIndex < buffer.length; lineIndex += 1) {
		const line = buffer.getLine(lineIndex);
		if (line) {
			lines.push(line.translateToString(true));
		}
	}

	return lines.join('\n').trim().slice(-TERMINAL_CONTEXT_MAX_CHARS);
}

export function TerminalPanel(props: IDockviewPanelProps<TerminalPanelParams>) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const noteRef = useRef<HTMLTextAreaElement | null>(null);
	const xtermRootRef = useRef<HTMLDivElement | null>(null);
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const searchAddonRef = useRef<SearchAddon | null>(null);
	const hoveredLinkRef = useRef<string | null>(null);
	const terminalPanelResizeRef = useRef<(cols: number, rows: number) => void>(
		() => {},
	);
	const terminalPresentationActionRef = useRef<() => Promise<void>>(() =>
		Promise.resolve(),
	);
	const retryServerAttachmentRef = useRef<() => void>(() => {});
	const rebindServerAttachmentRef = useRef<
		(
			binding: Readonly<{
				client: TerminayTerminalPanelClient;
				clientId: string;
			}>,
		) => void
	>(() => {});
	const terminalPresentationControllerRef = useRef(false);
	// This belongs to the mounted xterm, rather than to a connection attempt.
	// A retry can therefore resume a display that still contains its prior bytes.
	const renderedPositionRef = useRef<number | null>(null);
	const browserFileDropContextRef = useRef<
		| Pick<
				TerminalPanelClientContextValue,
				'fileViewerClient' | 'projectId' | 'projectRoot'
		  >
		| undefined
	>(undefined);
	const tabColorRef = useRef(props.params.color);
	const zoomLevelRef = useRef(0);
	const remoteSizeOverrideRef = useRef<{ cols: number; rows: number } | null>(
		null,
	);
	const { settings, settingsClient } = useTerminalSettings();
	const terminalClientContext = useContext(TerminalPanelClientContext);
	const connectionActionsRef = useRef(terminalClientContext);
	connectionActionsRef.current = terminalClientContext;
	const boundTerminalClientRef = useRef(terminalClientContext?.client);
	const boundHydrationReporterRef = useRef(
		terminalClientContext?.reportConnectionHydrated,
	);
	const panelClientDelegateRef = useRef<
		TerminayTerminalPanelClient | undefined
	>(undefined);
	panelClientDelegateRef.current =
		terminalClientContext === null
			? undefined
			: new TerminayTerminalPanelClient(terminalClientContext.client);
	browserFileDropContextRef.current =
		terminalClientContext === null
			? undefined
			: {
					fileViewerClient: terminalClientContext.fileViewerClient,
					projectId: terminalClientContext.projectId,
					projectRoot: terminalClientContext.projectRoot,
				};
	const contextPanelClient = useMemo(() => {
		if (terminalClientContext === null) return undefined;
		return createReplaceableTerminalPanelClient(
			() => panelClientDelegateRef.current,
		);
	}, [terminalClientContext?.serverId, terminalClientContext?.projectId]);
	const terminalPanelConnectionContext =
		useMemo<TerminalPanelConnectionContext | null>(
			() =>
				terminalClientContext === null
					? null
					: {
							get client() {
								return connectionActionsRef.current!.client;
							},
							get clientId() {
								return connectionActionsRef.current!.clientId;
							},
							get projectId() {
								return connectionActionsRef.current!.projectId;
							},
							get serverId() {
								return connectionActionsRef.current!.serverId;
							},
							retryConnection: () =>
								connectionActionsRef.current?.retryConnection?.(),
							canRetryConnection: () =>
								connectionActionsRef.current?.canRetryConnection?.() ?? false,
							reportConnectionHydrated: () =>
								connectionActionsRef.current?.reportConnectionHydrated?.(),
							reportConnectionHydrationFailed: (error) =>
								connectionActionsRef.current?.reportConnectionHydrationFailed?.(
									error,
								),
						},
			[terminalClientContext?.projectId, terminalClientContext?.serverId],
		);
	const resolvedTerminalClient = useMemo(
		() =>
			resolveTerminalPanelClient(
				props.params,
				terminalPanelConnectionContext,
				contextPanelClient,
			),
		[
			contextPanelClient,
			props.params.terminalClientId,
			props.params.terminalClientIdentity,
			props.params.terminalPanelClient,
			terminalPanelConnectionContext,
		],
	);
	const settingsRef = useRef(settings);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [isRemoteSizeOverrideActive, setIsRemoteSizeOverrideActive] =
		useState(false);
	const [isTerminalHydrating, setIsTerminalHydrating] = useState(true);
	const [serverTerminalError, setServerTerminalError] = useState<string | null>(
		null,
	);
	const [presentationUnavailable, setPresentationUnavailable] = useState(false);
	const [terminalPresentation, setTerminalPresentation] =
		useState<TerminalPresentationState | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [searchSummary, setSearchSummary] = useState<{
		index: number;
		count: number;
	}>({
		index: 0,
		count: 0,
	});
	const [dictationOverlay, setDictationOverlay] =
		useState<DictationOverlayProps | null>(null);
	const [terminalContextMenu, setTerminalContextMenu] = useState<{
		x: number;
		y: number;
		link: string | null;
		hasSelection: boolean;
	} | null>(null);
	const hasTerminalNote = typeof props.params.terminalNote === 'string';

	tabColorRef.current = props.params.color;

	useEffect(() => {
		const handleDictationOverlay = (event: Event) => {
			const detail = (
				event as CustomEvent<{
					overlay: DictationOverlayProps | null;
					sessionId: string;
				}>
			).detail;
			if (detail?.sessionId !== props.params.sessionId) {
				return;
			}

			setDictationOverlay(detail.overlay);
		};

		window.addEventListener(
			'terminay-dictation-overlay',
			handleDictationOverlay,
		);
		return () => {
			window.removeEventListener(
				'terminay-dictation-overlay',
				handleDictationOverlay,
			);
		};
	}, [props.params.sessionId]);

	const runSearchAction = useCallback(
		(action: (searchAddon: SearchAddon) => void) => {
			const searchAddon = searchAddonRef.current;
			if (!searchAddon) {
				return;
			}

			try {
				action(searchAddon);
			} catch (error) {
				console.error('Terminal search failed', error);
				setIsSearchOpen(false);
			}
		},
		[],
	);

	const announceTerminalFocus = useCallback(() => {
		window.dispatchEvent(
			new CustomEvent('terminay-terminal-focused', {
				detail: { sessionId: props.params.sessionId },
			}),
		);
	}, [props.params.sessionId]);

	useEffect(() => {
		const container = containerRef.current;
		const root = xtermRootRef.current;
		if (!container || !root) {
			return;
		}

		const sessionId = props.params.sessionId;

		root.innerHTML = '';

		const isMac = navigator.platform.toLowerCase().includes('mac');
		const terminalLinkInteraction = createTerminalLinkInteraction({
			isMac,
			// Opening a terminal link is an explicit operating-system action. Keep
			// it on the narrow, versioned host bridge rather than giving the
			// workspace's terminal renderer a broad preload API.
			openExternal: openExternalUrl,
			pointerTarget: document.body,
		});
		const openTerminalLink = terminalLinkInteraction.activate;
		const linkHover = (_event: MouseEvent, uri: string) => {
			hoveredLinkRef.current = uri;
			terminalLinkInteraction.hover();
		};
		const linkLeave = (_event: MouseEvent, uri: string) => {
			if (hoveredLinkRef.current === uri) {
				hoveredLinkRef.current = null;
			}
			terminalLinkInteraction.leave();
		};

		const oscLinkHandler: ILinkHandler = {
			activate: openTerminalLink,
			hover: linkHover,
			leave: linkLeave,
		};

		const terminal = new Terminal({
			...buildTerminalOptions(settingsRef.current),
			theme: resolveTerminalTheme(settingsRef.current, tabColorRef.current),
			allowProposedApi: true,
			linkHandler: oscLinkHandler,
		});
		terminalRef.current = terminal;
		renderedPositionRef.current = 0;

		const fitAddon = new FitAddon();
		const searchAddon = new SearchAddon();
		const unicode11Addon = new Unicode11Addon();
		fitAddonRef.current = fitAddon;
		searchAddonRef.current = searchAddon;
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(searchAddon);
		terminal.loadAddon(unicode11Addon);

		const announceTerminalUserInput = () => {
			window.dispatchEvent(
				new CustomEvent('terminay-terminal-user-input', {
					detail: { sessionId },
				}),
			);
		};

		terminal.loadAddon(
			new WebLinksAddon(openTerminalLink, {
				hover: linkHover,
				leave: linkLeave,
			}),
		);
		terminal.unicode.activeVersion = '11';
		terminal.open(root);
		const screenElement =
			terminal.element?.querySelector<HTMLElement>('.xterm-screen');
		const preventModifierLinkSelection = (event: MouseEvent) => {
			const modifierKey = isMac ? event.metaKey : event.ctrlKey;
			if (
				!modifierKey ||
				!screenElement?.classList.contains('xterm-cursor-pointer')
			) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
		};
		screenElement?.addEventListener('mousedown', preventModifierLinkSelection);

		const panelClient = resolvedTerminalClient.panelClient;
		const panelIdentity = resolvedTerminalClient.identity;
		const panelClientId = resolvedTerminalClient.clientId;
		const useServerTerminal =
			panelClient !== undefined &&
			panelIdentity !== undefined &&
			panelClientId !== undefined;
		const terminalSessionUnavailable =
			props.params.terminalSessionStatus !== undefined &&
			props.params.terminalSessionStatus !== 'running';
		const canUploadBrowserFiles = () => {
			const browserDropContext = browserFileDropContextRef.current;
			return (
				window.terminayHost?.resolveDroppedFilePath === undefined &&
				browserDropContext?.fileViewerClient !== undefined &&
				browserDropContext.projectRoot !== undefined
			);
		};
		let serverAttachmentFailed = false;
		if (terminalSessionUnavailable) {
			setServerTerminalError(
				props.params.terminalSessionStatus === 'interrupted'
					? 'This terminal was interrupted when the server stopped. Open a new terminal to continue.'
					: 'This terminal has exited. Open a new terminal to continue.',
			);
			setPresentationUnavailable(true);
			setTerminalPresentation(null);
			terminalPresentationControllerRef.current = false;
			setIsTerminalHydrating(false);
		} else if (useServerTerminal) {
			setServerTerminalError(null);
			setPresentationUnavailable(false);
			setTerminalPresentation(null);
			terminalPresentationControllerRef.current = false;
			setIsTerminalHydrating(true);
		} else {
			setIsTerminalHydrating(false);
		}
		let panelAttachment: TerminalPanelAttachment | null = null;
		const bindingFence = new TerminalPanelBindingFence();
		let activeBinding: TerminalPanelBinding | null = null;
		let presentationRenewTimer: number | null = null;
		let recoveryRetryTimer: number | null = null;
		let recoveryDeadlineTimer: number | null = null;
		let recoveryAttempt = 0;
		let recoveryStartedAt = 0;
		let recoveryFailureReason: 'attach-error' | 'deadline' = 'attach-error';
		let pendingPanelResize: { cols: number; rows: number } | null = null;
		let dataReplayDisposed = false;
		let panelEventDisposer: (() => void) | null = null;
		const reportTerminalRecovery = (
			phase: 'started' | 'retrying' | 'recovered' | 'failed',
			fields: {
				durationMs?: number;
				fromPosition?: number;
				outputPosition?: number;
				reason?: 'congestion' | 'attach-error' | 'deadline';
				replayFrom?: number;
			} = {},
		) => {
			recordRendererDiagnostic({
				kind: 'terminal-recovery',
				phase,
				attempt: Math.max(1, recoveryAttempt),
				...(fields.durationMs === undefined
					? {}
					: { durationMs: fields.durationMs }),
				...(fields.reason === undefined ? {} : { reason: fields.reason }),
			});
		};
		const failServerTransport = (error: unknown, binding = activeBinding) => {
			if (binding === null || !bindingFence.isCurrent(binding)) return;
			if (serverAttachmentFailed || dataReplayDisposed) return;
			serverAttachmentFailed = true;
			if (recoveryRetryTimer !== null) window.clearTimeout(recoveryRetryTimer);
			recoveryRetryTimer = null;
			if (recoveryDeadlineTimer !== null)
				window.clearTimeout(recoveryDeadlineTimer);
			recoveryDeadlineTimer = null;
			if (recoveryAttempt > 0)
				reportTerminalRecovery('failed', {
					durationMs: Math.max(0, Date.now() - recoveryStartedAt),
					reason: recoveryFailureReason,
				});
			serverInputQueue?.close();
			panelEventDisposer?.();
			panelEventDisposer = null;
			if (presentationRenewTimer !== null) {
				window.clearTimeout(presentationRenewTimer);
				presentationRenewTimer = null;
			}
			const attachmentToDetach = panelAttachment;
			panelAttachment = null;
			bindingFence.retire(binding);
			activeBinding = null;
			if (attachmentToDetach !== null)
				void attachmentToDetach.detach().catch(() => {});
			setIsTerminalHydrating(false);
			setServerTerminalError(
				error instanceof Error
					? error.message
					: 'The server terminal connection failed.',
			);
			terminalPanelConnectionContext?.reportConnectionHydrationFailed?.(error);
			reportTerminalRebindDiagnostic(sessionId, 'failed', error);
		};
		let serverInputQueue: ServerTerminalInputQueue | null = null;

		const writePanelInput = (data: string) => {
			if (
				!useServerTerminal ||
				serverAttachmentFailed ||
				!terminalPresentationControllerRef.current
			)
				return;
			serverInputQueue?.enqueue(data);
		};

		const resizePanel = (cols: number, rows: number) => {
			if (!useServerTerminal || serverAttachmentFailed) return;
			pendingPanelResize = { cols, rows };
			if (
				panelAttachment !== null &&
				terminalPresentationControllerRef.current
			) {
				const next = pendingPanelResize;
				pendingPanelResize = null;
				// Resize ownership can legitimately belong to another presentation.
				// A rejected viewport claim must not detach this terminal stream.
				void panelAttachment.resize(next).catch(() => {});
			}
		};

		terminalPanelResizeRef.current = resizePanel;

		const copySelectionToClipboard = () => {
			const selectedText = terminal.getSelection();
			if (selectedText.length === 0) {
				return false;
			}

			void copyTerminalSelection(selectedText, writeClipboardText);
			return true;
		};

		const openTerminalContextMenu = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			setTerminalContextMenu({
				x: event.clientX,
				y: event.clientY,
				link: hoveredLinkRef.current,
				hasSelection: terminal.hasSelection(),
			});
		};

		terminal.attachCustomKeyEventHandler((event) => {
			const key = event.key.toLowerCase();
			const isCopyShortcut =
				(event.ctrlKey &&
					event.shiftKey &&
					!event.altKey &&
					!event.metaKey &&
					key === 'c') ||
				(event.metaKey &&
					!event.ctrlKey &&
					!event.altKey &&
					!event.shiftKey &&
					key === 'c');

			if (isCopyShortcut) {
				if (terminal.hasSelection()) {
					event.preventDefault();
					event.stopPropagation();
					if (event.type === 'keydown') {
						copySelectionToClipboard();
					}
					return false;
				}

				return true;
			}

			if (
				shouldHandleTerminalPasteShortcut(
					event,
					isMac,
					canUseDesktopTerminalClipboard(),
				)
			) {
				event.preventDefault();
				event.stopPropagation();
				if (event.type !== 'keydown') {
					return false;
				}

				void pasteTerminalClipboard(readTerminalClipboard, {
					// xterm emits this paste through onData, so both local and
					// server-backed panels use writePanelInput below. Do not call a
					// terminal preload write method from this UI-only clipboard path.
					announceInput: announceTerminalUserInput,
					paste: (text) => terminal.paste(text),
					focus: () => terminal.focus(),
				});

				return false;
			}

			const terminalSwitcherDirection = getTerminalSwitcherDirection(event);
			if (terminalSwitcherDirection !== null) {
				event.preventDefault();
				event.stopPropagation();
				if (event.type !== 'keydown') {
					return false;
				}

				window.dispatchEvent(
					new CustomEvent(OPEN_TERMINAL_SWITCHER_EVENT, {
						detail: { direction: terminalSwitcherDirection },
					}),
				);
				return false;
			}

			const terminalScrollbackAction = getTerminalScrollbackAction(event);
			if (terminalScrollbackAction !== null) {
				event.preventDefault();
				event.stopPropagation();
				if (event.type !== 'keydown') {
					return false;
				}

				switch (terminalScrollbackAction) {
					case 'page-up':
						terminal.scrollPages(-1);
						break;
					case 'page-down':
						terminal.scrollPages(1);
						break;
					case 'top':
						terminal.scrollToTop();
						break;
					case 'bottom':
						terminal.scrollToBottom();
						break;
				}
				return false;
			}

			if (isTerminalSearchShortcut(event, { isMac })) {
				event.preventDefault();
				setIsSearchOpen(true);
				return false;
			}

			if (shouldInsertTerminalMultilineNewline(event)) {
				event.preventDefault();
				if (event.type !== 'keydown') {
					return false;
				}

				// Send the newline through bracketed paste so shells keep it in the
				// current command buffer instead of accepting the line.
				announceTerminalUserInput();
				writePanelInput(formatBracketedPaste('\n'));
				return false;
			}

			return true;
		});

		let pendingResizeForce = false;
		let resizeFrame: number | null = null;
		let lastFitSize = EMPTY_TERMINAL_ROOT_SIZE;
		let lastSentSize = { cols: 0, rows: 0 };

		const fitAndResizeNow = (force = false) => {
			resizeFrame = null;

			const nextRootSize = getTerminalRootSize(root);
			if (
				!force &&
				nextRootSize.width === lastFitSize.width &&
				nextRootSize.height === lastFitSize.height
			) {
				return;
			}

			lastFitSize = nextRootSize;

			const remoteSizeOverride = remoteSizeOverrideRef.current;
			if (remoteSizeOverride) {
				applyRemoteTerminalSize(
					root,
					terminal,
					remoteSizeOverride.cols,
					remoteSizeOverride.rows,
					() => {
						const currentOverride = remoteSizeOverrideRef.current;
						return (
							terminalRef.current === terminal &&
							currentOverride?.cols === remoteSizeOverride.cols &&
							currentOverride.rows === remoteSizeOverride.rows
						);
					},
				);
				return;
			}

			clearRemoteTerminalElementSize(root, terminal);
			fitAddon.fit();
			updateTerminalGridMetadata(root, terminal.cols, terminal.rows);
			if (
				force ||
				terminal.cols !== lastSentSize.cols ||
				terminal.rows !== lastSentSize.rows
			) {
				lastSentSize = { cols: terminal.cols, rows: terminal.rows };
				resizePanel(terminal.cols, terminal.rows);
			}
		};

		const fitAndResize = (force = false) => {
			pendingResizeForce = pendingResizeForce || force;
			if (resizeFrame !== null) {
				return;
			}

			resizeFrame = window.requestAnimationFrame(() => {
				const shouldForce = pendingResizeForce;
				pendingResizeForce = false;
				fitAndResizeNow(shouldForce);
			});
		};

		fitAndResize(true);

		const renderTerminalExit = (exitCode: number, signal: number | null) => {
			// A Settings auxiliary window has its own protocol connection.  Its
			// settings.changed event can arrive after this panel receives a fast
			// terminal exit, so settle the server-owned value before deciding whether
			// to persistently close the panel.
			void settingsClient
				.get<TerminalSettings>()
				.catch(() => settingsRef.current)
				.then((currentSettings) => {
					const autoCloseOnSuccessfulExit =
						currentSettings.autoCloseTerminalOnExitZero;
					window.dispatchEvent(
						new CustomEvent(TERMINAL_PANEL_EXIT_EVENT, {
							detail: {
								autoCloseOnSuccessfulExit,
								exitCode,
								sessionId,
								signal,
							},
						}),
					);
					const notice = formatTerminalExitNotice({
						autoCloseOnSuccessfulExit,
						exitCode,
						signal,
					});
					if (notice !== null) terminal.write(notice);
				});
		};

		const renderTerminalOutput = (
			bytes: Uint8Array,
			nextPosition: number,
			attachment: TerminalPanelAttachment,
		) =>
			new Promise<void>((resolve) => {
				terminal.write(bytes, () => {
					renderedPositionRef.current = nextPosition;
					window.dispatchEvent(
						new CustomEvent(TERMINAL_PANEL_OUTPUT_EVENT, {
							detail: { nextPosition, sessionId },
						}),
					);
					void attachment.ack(nextPosition).catch((error) => {
						// Acknowledgements from the retired attachment may reject after a
						// replacement is already mounted. They cannot fail the new
						// generation's hydration or dispose its connected client.
						if (panelAttachment === attachment) failServerTransport(error);
					});
					resolve();
				});
			});

		const writeTerminalPresentation = (bytes: Uint8Array) =>
			new Promise<void>((resolve) => {
				terminal.write(bytes, resolve);
			});

		if (
			useServerTerminal &&
			panelClient !== undefined &&
			panelIdentity !== undefined &&
			panelClientId !== undefined
		) {
			const mode = props.params.terminalClientMode ?? 'attach';
			const request = {
				serverId: panelIdentity.serverId,
				projectId: panelIdentity.projectId,
				sessionId,
				clientId: panelClientId,
				maxInitialReplayBytes: MAX_INITIAL_SERVER_TERMINAL_REPLAY_BYTES,
			};
			let resyncing = false;
			const attachServerTerminal = ({
				client,
				clientId,
				fromPosition,
				freshPresentation,
				forceResume,
				recovery,
			}: {
				client?: TerminayTerminalPanelClient;
				clientId?: string;
				fromPosition: number | undefined;
				freshPresentation: boolean;
				forceResume: boolean;
				recovery: boolean;
			}) => {
				const binding = bindingFence.begin();
				activeBinding = binding;
				serverInputQueue?.close();
				serverInputQueue = new ServerTerminalInputQueue((error) =>
					failServerTransport(error, binding),
				);
				const attachmentClient = client ?? panelClient;
				const nextRequest = {
					...request,
					...(clientId === undefined ? {} : { clientId }),
					...(fromPosition === undefined ? {} : { fromPosition }),
					...(freshPresentation ? { freshPresentation: true } : {}),
				};
				if (recovery) {
					recoveryDeadlineTimer = window.setTimeout(() => {
						recoveryDeadlineTimer = null;
						if (dataReplayDisposed || serverAttachmentFailed) return;
						recoveryFailureReason = 'deadline';
						failServerTransport(
							new Error(
								'Terminal recovery timed out. Retry the connection to continue.',
							),
							binding,
						);
					}, TERMINAL_RECOVERY_ATTEMPT_DEADLINE_MS);
				}
				void (
					forceResume || mode === 'resume'
						? attachmentClient.resume(nextRequest)
						: attachmentClient.attach(nextRequest)
				)
					.then((attachment) => {
						if (
							dataReplayDisposed ||
							serverAttachmentFailed ||
							!bindingFence.isCurrent(binding)
						) {
							void attachment.detach().catch(() => {});
							return;
						}

						panelAttachment = attachment;
						let currentPresentation = attachment.presentation;
						const applyPresentation = (state: TerminalPresentationState) => {
							if (!bindingFence.isCurrent(binding)) return;
							currentPresentation = state;
							const becameController =
								!terminalPresentationControllerRef.current &&
								state.role === 'controller';
							terminalPresentationControllerRef.current =
								state.role === 'controller';
							if (state.role !== 'controller')
								serverInputQueue?.discardPending();
							if (becameController) {
								remoteSizeOverrideRef.current = null;
								setIsRemoteSizeOverrideActive(false);
								clearRemoteTerminalElementSize(root, terminal);
							}
							setTerminalPresentation(state);
							if (presentationRenewTimer !== null)
								window.clearTimeout(presentationRenewTimer);
							presentationRenewTimer = null;
							if (state.role === 'controller') {
								if (becameController) fitAndResize(true);
								presentationRenewTimer = window.setTimeout(() => {
									void attachment
										.changePresentation('renew')
										.then(applyPresentation)
										.catch((error: unknown) => {
											if (!bindingFence.isCurrent(binding)) return;
											if (!isTerminalPresentationOwnershipError(error)) {
												failServerTransport(
													new Error(
														`terminal presentation renewal failed: ${error instanceof Error ? error.message : String(error)}`,
														{ cause: error },
													),
													binding,
												);
												return;
											}
											applyPresentation({
												serverId: state.serverId,
												projectId: state.projectId,
												sessionId: state.sessionId,
												revision: state.revision,
												role: 'read_only',
											});
										});
								}, 5_000);
							}
						};
						applyPresentation(attachment.presentation);
						terminalPresentationActionRef.current = async () => {
							let state: TerminalPresentationState;
							try {
								state = await attachment.changePresentation(
									currentPresentation.holder === undefined
										? 'acquire'
										: 'takeover',
								);
							} catch (error) {
								if (bindingFence.isCurrent(binding)) throw error;
								return;
							}
							if (!bindingFence.isCurrent(binding)) return;
							applyPresentation(state);
							if (state.role === 'controller') fitAndResize(true);
						};
						// Xterm serializes writes, but resize is synchronous. Keep one
						// explicit queue so a parser-safe snapshot is restored in its
						// original geometry before a tail resize or any subsequent output
						// reaches the emulator. The same queue also prevents live output
						// delivered during binary hydration from overtaking the tail.
						let terminalRenderQueue = Promise.resolve();
						const renderServerEvent = (event: TerminalStreamEvent) => {
							terminalRenderQueue = terminalRenderQueue
								.then(async () => {
									if (
										dataReplayDisposed ||
										panelAttachment !== attachment ||
										!bindingFence.isCurrent(binding)
									)
										return;

									if (event.type === 'checkpoint') {
										// Checkpoint bytes are xterm restoration input rather than
										// PTY output. SerializeAddon requires the geometry used to
										// create the checkpoint, and neither that resize nor the
										// restoration bytes may be acknowledged to the server.
										if (recovery) terminal.clear();
										terminal.resize(
											event.checkpointDimensions.cols,
											event.checkpointDimensions.rows,
										);
										await writeTerminalPresentation(event.bytes);
										renderedPositionRef.current = event.position;
									} else if (event.type === 'checkpoint_resize') {
										// A parser-safe checkpoint can have ordered resize
										// transitions in its C→H raw tail. Apply them between the
										// restoration and corresponding output, without claiming
										// viewport control or forwarding a resize to the PTY.
										terminal.resize(
											event.dimensions.cols,
											event.dimensions.rows,
										);
									} else if (event.type === 'output') {
										await renderTerminalOutput(
											event.bytes,
											event.nextPosition,
											attachment,
										);
									} else if (event.type === 'exit') {
										renderTerminalExit(event.exitCode, event.signal);
									} else if (event.type === 'dimensions') {
										if (!terminalPresentationControllerRef.current) {
											remoteSizeOverrideRef.current = {
												cols: event.cols,
												rows: event.rows,
											};
											setIsRemoteSizeOverrideActive(true);
											applyRemoteTerminalSize(
												root,
												terminal,
												event.cols,
												event.rows,
												() => {
													const currentOverride = remoteSizeOverrideRef.current;
													return (
														terminalRef.current === terminal &&
														currentOverride?.cols === event.cols &&
														currentOverride.rows === event.rows
													);
												},
											);
										}
									} else if (event.type === 'presentation') {
										applyPresentation(event);
									} else if (event.type === 'presentation_unavailable') {
										setPresentationUnavailable(true);
										setIsTerminalHydrating(false);
										setServerTerminalError(
											'Terminal presentation is unavailable because a complete safe recovery boundary is no longer retained.',
										);
									} else if (event.type === 'resync_required') {
										beginTerminalResync(event);
									}
								})
								.catch((error) =>
									failServerTransport(
										new Error(
											`terminal event render failed: ${error instanceof Error ? error.message : String(error)}`,
											{ cause: error },
										),
										binding,
									),
								);
						};
						// Install one catch-all listener before consuming initialEvents. Three
						// sequential filtered listeners leave a handoff window in which a fast
						// exit can be delivered to the output listener and discarded.
						panelEventDisposer = (
							attachment as TerminalPanelAttachment & {
								onEvent(
									listener: (event: TerminalStreamEvent) => void,
								): () => void;
							}
						).onEvent(renderServerEvent);
						for (const event of attachment.initialEvents) {
							renderServerEvent(event);
							if (
								event.type === 'resync_required' ||
								event.type === 'presentation_unavailable'
							)
								break;
						}
						const initialEventsRendered = terminalRenderQueue;
						void initialEventsRendered.then(() => {
							if (
								dataReplayDisposed ||
								panelAttachment !== attachment ||
								serverAttachmentFailed ||
								resyncing ||
								!bindingFence.isCurrent(binding)
							)
								return;
							if (recoveryDeadlineTimer !== null)
								window.clearTimeout(recoveryDeadlineTimer);
							recoveryDeadlineTimer = null;
							setIsTerminalHydrating(false);
							terminalPanelConnectionContext?.reportConnectionHydrated?.();
							reportTerminalRebindDiagnostic(sessionId, 'attached');

							if (recoveryAttempt > 0) {
								reportTerminalRecovery('recovered', {
									durationMs: Math.max(0, Date.now() - recoveryStartedAt),
									outputPosition: renderedPositionRef.current ?? undefined,
								});
								recoveryAttempt = 0;
								recoveryStartedAt = 0;
								recoveryFailureReason = 'attach-error';
							}

							serverInputQueue?.attach(attachment);
							if (
								pendingPanelResize !== null &&
								terminalPresentationControllerRef.current
							) {
								const resize = pendingPanelResize;
								pendingPanelResize = null;
								void attachment.resize(resize).catch(() => {});
							}
							// The initial focus call runs before the asynchronous attachment is ready.
							// During browser connection setup Dockview/layout work can return focus to
							// body, leaving xterm's hidden textarea unable to receive the first key.
							// Restore it only when focus is still unclaimed (or already in this panel)
							// so a user who deliberately selected another control is not interrupted.
							const activeElement = document.activeElement;
							if (
								props.api.isActive &&
								(activeElement === null ||
									activeElement === document.body ||
									root.contains(activeElement))
							) {
								terminal.focus();
								announceTerminalFocus();
							}
							resyncing = false;
						});
					})
					.catch((error: unknown) => {
						if (recoveryDeadlineTimer !== null)
							window.clearTimeout(recoveryDeadlineTimer);
						recoveryDeadlineTimer = null;
						if (dataReplayDisposed || !bindingFence.isCurrent(binding)) return;
						failServerTransport(
							new Error(
								`terminal attachment open failed: ${error instanceof Error ? error.message : String(error)}`,
								{ cause: error },
							),
							binding,
						);
					});
			};
			const beginTerminalResync = (_event: TerminalStreamResyncEvent) => {
				if (dataReplayDisposed || resyncing || serverAttachmentFailed) return;
				resyncing = true;
				if (recoveryDeadlineTimer !== null)
					window.clearTimeout(recoveryDeadlineTimer);
				recoveryDeadlineTimer = null;
				setIsTerminalHydrating(true);
				panelEventDisposer?.();
				panelEventDisposer = null;
				const staleAttachment = panelAttachment;
				panelAttachment = null;
				if (activeBinding !== null) bindingFence.retire(activeBinding);
				activeBinding = null;
				serverInputQueue?.close();
				void staleAttachment?.detach().catch(() => {});
				if (recoveryAttempt === 0) recoveryStartedAt = Date.now();
				recoveryAttempt += 1;
				reportTerminalRecovery(recoveryAttempt === 1 ? 'started' : 'retrying', {
					fromPosition: _event.fromPosition,
					replayFrom: _event.replayFrom,
					outputPosition: _event.outputPosition,
					reason: 'congestion',
				});
				// A progress display may never become idle. Keep the last completed
				// presentation visible and retry from a current bounded checkpoint.
				recoveryRetryTimer = window.setTimeout(() => {
					recoveryRetryTimer = null;
					if (dataReplayDisposed || !resyncing || panelAttachment !== null)
						return;
					resyncing = false;
					attachServerTerminal({
						fromPosition: 0,
						freshPresentation: true,
						forceResume: true,
						recovery: true,
					});
				}, TERMINAL_RECOVERY_RETRY_DELAY_MS);
			};
			// The first attachment hydrates the newly created emulator. Later
			// reconnects use the exact cursor xterm has already rendered.
			retryServerAttachmentRef.current = () => {
				if (dataReplayDisposed) return;
				if (terminalPanelConnectionContext?.retryConnection !== undefined) {
					serverInputQueue?.close();
					if (activeBinding !== null) bindingFence.retire(activeBinding);
					activeBinding = null;
					if (presentationRenewTimer !== null)
						window.clearTimeout(presentationRenewTimer);
					presentationRenewTimer = null;
					terminalPanelConnectionContext.retryConnection();
					return;
				}
				serverAttachmentFailed = false;
				resyncing = false;
				recoveryAttempt = 0;
				recoveryStartedAt = 0;
				recoveryFailureReason = 'attach-error';
				serverInputQueue?.close();
				setServerTerminalError(null);
				setPresentationUnavailable(false);
				setIsTerminalHydrating(true);
				attachServerTerminal({
					fromPosition: renderedPositionRef.current ?? 0,
					freshPresentation: false,
					forceResume: true,
					recovery: false,
				});
			};
			rebindServerAttachmentRef.current = ({
				client: replacementClient,
				clientId: replacementClientId,
			}) => {
				if (dataReplayDisposed) return;
				reportTerminalRebindDiagnostic(sessionId, 'started');
				serverAttachmentFailed = false;
				resyncing = false;
				if (presentationRenewTimer !== null)
					window.clearTimeout(presentationRenewTimer);
				presentationRenewTimer = null;
				terminalPresentationActionRef.current = () => Promise.resolve();
				panelEventDisposer?.();
				panelEventDisposer = null;
				const staleAttachment = panelAttachment;
				panelAttachment = null;
				if (activeBinding !== null) bindingFence.retire(activeBinding);
				activeBinding = null;
				serverInputQueue?.close();
				void staleAttachment?.detach().catch(() => {});
				setServerTerminalError(null);
				setPresentationUnavailable(false);
				setIsTerminalHydrating(true);
				attachServerTerminal({
					client: replacementClient,
					clientId: replacementClientId,
					fromPosition: renderedPositionRef.current ?? 0,
					freshPresentation: false,
					forceResume: true,
					recovery: false,
				});
			};
			if (terminalSessionUnavailable) {
				retryServerAttachmentRef.current = () => {};
				rebindServerAttachmentRef.current = () => {};
			} else {
				attachServerTerminal({
					fromPosition: 0,
					freshPresentation: true,
					forceResume: false,
					recovery: false,
				});
			}
		} else {
			// A terminal surface is a detachable server client. There is no Local
			// Electron IPC fallback: doing so would make the renderer a second PTY
			// authority when a server connection is absent or being replaced.
			setIsTerminalHydrating(false);
			setServerTerminalError('The server terminal client is unavailable.');
		}

		const zoomDisposer = subscribeTerminalZoom((zoomLevel) => {
			zoomLevelRef.current = zoomLevel;
			const baseFontSize = settingsRef.current.fontSize ?? 13;
			terminal.options.fontSize = resolveTerminalZoomedFontSize(
				baseFontSize,
				zoomLevel,
			);
			fitAndResize(true);
		});

		const keyDisposer = terminal.onKey(() => {
			announceTerminalUserInput();
		});

		const dataDisposer = terminal.onData((data) => {
			writePanelInput(data);
		});

		const touchScrollDisposer = bindTerminalTouchScroll(root, terminal);

		const resizeDisposer = props.api.onDidDimensionsChange(() => {
			fitAndResize();
		});

		let activeFocusFrame: number | null = null;

		const activeDisposer = props.api.onDidActiveChange((event) => {
			if (!event.isActive) {
				if (activeFocusFrame !== null) {
					window.cancelAnimationFrame(activeFocusFrame);
					activeFocusFrame = null;
				}
				return;
			}

			activeFocusFrame = window.requestAnimationFrame(() => {
				activeFocusFrame = null;
				terminal.focus();
				announceTerminalFocus();
			});
		});

		// Clicking a background tab while the whole window is unfocused is a two-part
		// macOS interaction: `acceptFirstMouse` (set on the BrowserWindow) delivers the
		// activating mousedown to this terminal, but Chromium then *restores* keyboard
		// focus to the previously focused terminal as the window activates
		// (electron/electron#212, #5900). That restore runs after the pointerdown, so
		// the clicked tab loses and keystrokes go to the old tab. The window 'focus'
		// event fires after the restore, so we re-assert focus there — but only for the
		// panel whose terminal actually received the activating click.
		let pointerDownInsideAt = 0;
		let refocusFrame: number | null = null;
		let refocusTimer: number | null = null;

		const markPointerDownInside = () => {
			pointerDownInsideAt = Date.now();
		};

		const reassertTerminalFocus = () => {
			props.api.setActive();
			terminal.focus();
			announceTerminalFocus();
		};

		const handleWindowRefocus = () => {
			// macOS delivers the activating pointerdown just before this focus event, so
			// a fresh timestamp means this panel is the one under the click.
			if (
				!shouldRestoreTerminalFocusAfterWindowActivation(
					pointerDownInsideAt,
					Date.now(),
				)
			) {
				return;
			}
			// Re-assert immediately and across the next frame/tick to beat the
			// focus-restore regardless of exactly when Chromium runs it.
			reassertTerminalFocus();
			if (refocusFrame !== null) {
				window.cancelAnimationFrame(refocusFrame);
			}
			refocusFrame = window.requestAnimationFrame(() => {
				refocusFrame = null;
				reassertTerminalFocus();
			});
			if (refocusTimer !== null) {
				window.clearTimeout(refocusTimer);
			}
			refocusTimer = window.setTimeout(() => {
				refocusTimer = null;
				reassertTerminalFocus();
			}, 0);
		};

		const repaintTerminalOnWindowFocus = () => {
			window.requestAnimationFrame(() => {
				if (terminalRef.current !== terminal) return;
				fitAndResize(true);
				if (terminal.rows > 0) terminal.refresh(0, terminal.rows - 1);
			});
		};

		const focusTerminal = (event: Event) => {
			const customEvent = event as CustomEvent<{ sessionId?: string }>;
			if (
				customEvent.detail?.sessionId &&
				customEvent.detail.sessionId !== sessionId
			) {
				return;
			}

			terminal.focus();
			announceTerminalFocus();
		};

		const clearTerminal = (event: Event) => {
			const customEvent = event as CustomEvent<{ sessionId?: string }>;
			if (
				!shouldClearTerminalForSession(customEvent.detail?.sessionId, sessionId)
			) {
				return;
			}

			clearTerminalViewport({
				clear: () => terminal.clear(),
				focus: () => terminal.focus(),
				announceFocus: announceTerminalFocus,
			});
		};

		const copyTerminal = (event: Event) => {
			const customEvent = event as CustomEvent<{ sessionId?: string }>;
			if (customEvent.detail?.sessionId !== sessionId) {
				return;
			}

			copySelectionToClipboard();
		};

		const focusTerminalNote = (event: Event) => {
			const customEvent = event as CustomEvent<{ sessionId?: string }>;
			if (customEvent.detail?.sessionId !== sessionId) {
				return;
			}

			const note = noteRef.current;
			if (!note) {
				return;
			}

			note.focus();
			note.setSelectionRange(note.value.length, note.value.length);
		};

		const handleExplorerPathDrop = (event: Event) => {
			const customEvent = event as CustomEvent<{
				path?: string;
				sessionId?: string;
			}>;
			if (
				customEvent.detail?.sessionId !== sessionId ||
				!customEvent.detail.path
			) {
				return;
			}

			writePanelInput(
				`${escapeTerminalPathForShell(customEvent.detail.path)} `,
			);
			terminal.focus();
			announceTerminalFocus();
		};

		const resizeObserver = new ResizeObserver(() => {
			fitAndResize();
		});

		const searchResultsDisposer = searchAddon.onDidChangeResults((event) => {
			setSearchSummary({
				index: event.resultCount > 0 ? event.resultIndex + 1 : 0,
				count: event.resultCount,
			});
		});

		const handleDragEnter = (event: DragEvent) => {
			if (
				!event.dataTransfer ||
				!shouldInterceptTerminalDrop(
					event.dataTransfer,
					resolveDesktopDroppedFilePath,
					canUploadBrowserFiles(),
				)
			) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = 'copy';
		};

		const handleDragOver = (event: DragEvent) => {
			if (
				!event.dataTransfer ||
				!shouldInterceptTerminalDrop(
					event.dataTransfer,
					resolveDesktopDroppedFilePath,
					canUploadBrowserFiles(),
				)
			) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = 'copy';
		};

		const handleDrop = async (event: DragEvent) => {
			if (
				!event.dataTransfer ||
				!shouldInterceptTerminalDrop(
					event.dataTransfer,
					resolveDesktopDroppedFilePath,
					canUploadBrowserFiles(),
				)
			) {
				return;
			}

			// Claim only terminal file/path drops. Dockview panel drags must reach
			// Dockview's own drop target so it can reorder and split groups.
			event.preventDefault();
			event.stopPropagation();

			let droppedText = getTerminalDropText(
				event.dataTransfer,
				resolveDesktopDroppedFilePath,
			);
			const browserDropContext = browserFileDropContextRef.current;
			if (
				!droppedText &&
				canUploadBrowserFiles() &&
				browserDropContext?.fileViewerClient &&
				browserDropContext.projectRoot
			) {
				try {
					droppedText = await uploadBrowserTerminalDrop(
						event.dataTransfer.files,
						browserDropContext.projectRoot,
						(path, bytes) =>
							browserDropContext.fileViewerClient!.createFile(
								path,
								bytes,
								browserDropContext.projectId,
							),
					);
				} catch (error) {
					console.error('Browser file drop upload failed', error);
					terminal.write(
						'\r\n\x1b[31m[file drop failed: the file could not be uploaded]\x1b[0m\r\n',
					);
					return;
				}
			}
			if (!droppedText) return;

			writePanelInput(`${droppedText} `);
			terminal.focus();
			announceTerminalFocus();
		};

		const handleNativeTerminalPaste = (event: ClipboardEvent) => {
			if (!canUseDesktopTerminalClipboard()) {
				announceTerminalUserInput();
				return;
			}

			// macOS Edit > Paste can bypass xterm's key handler. Intercept the
			// trusted native paste before xterm consumes only text clipboard data,
			// then use the same Desktop smart-paste path as Cmd+V.
			event.preventDefault();
			event.stopPropagation();
			void pasteTerminalClipboard(readTerminalClipboard, {
				announceInput: announceTerminalUserInput,
				paste: (text) => terminal.paste(text),
				focus: () => terminal.focus(),
			});
		};

		// Commands initiated by another renderer surface (for example dictation)
		// must use this panel's exact attachment when it is server-backed. The
		// panel owns the ordered input queue, so this cannot bypass its transport
		// failure handling or fall back to broad terminal IPC.
		const handlePanelInput = (event: Event) => {
			const detail = (
				event as CustomEvent<{ sessionId?: unknown; data?: unknown }>
			).detail;
			if (detail?.sessionId !== sessionId || typeof detail.data !== 'string') {
				return;
			}

			writePanelInput(detail.data);
		};

		const dragListenerOptions = { capture: true } as const;
		const pasteListenerOptions = { capture: true } as const;
		const contextReaderDisposer = props.params.registerTerminalContextReader?.(
			sessionId,
			() => ({
				recentOutput: getRecentTerminalOutput(terminal),
			}),
		);

		resizeObserver.observe(root);
		container.addEventListener(
			'dragenter',
			handleDragEnter,
			dragListenerOptions,
		);
		container.addEventListener('dragover', handleDragOver, dragListenerOptions);
		container.addEventListener('drop', handleDrop, dragListenerOptions);
		root.addEventListener('dragenter', handleDragEnter, dragListenerOptions);
		root.addEventListener('dragover', handleDragOver, dragListenerOptions);
		root.addEventListener('drop', handleDrop, dragListenerOptions);
		root.addEventListener(
			'paste',
			handleNativeTerminalPaste,
			pasteListenerOptions,
		);
		root.addEventListener('contextmenu', openTerminalContextMenu);
		root.addEventListener('pointerdown', announceTerminalUserInput);
		root.addEventListener('pointerdown', markPointerDownInside);
		window.addEventListener('focus', handleWindowRefocus);
		window.addEventListener('focus', repaintTerminalOnWindowFocus);
		window.addEventListener('terminay-focus-terminal', focusTerminal);
		window.addEventListener('terminay-focus-terminal-note', focusTerminalNote);
		window.addEventListener(CLEAR_TERMINAL_EVENT, clearTerminal);
		window.addEventListener(COPY_TERMINAL_EVENT, copyTerminal);
		window.addEventListener(
			DROP_FILE_EXPLORER_PATH_EVENT,
			handleExplorerPathDrop,
		);
		window.addEventListener(TERMINAL_PANEL_INPUT_EVENT, handlePanelInput);
		terminal.focus();
		announceTerminalFocus();

		return () => {
			searchResultsDisposer.dispose();
			resizeObserver.disconnect();
			container.removeEventListener(
				'dragenter',
				handleDragEnter,
				dragListenerOptions,
			);
			container.removeEventListener(
				'dragover',
				handleDragOver,
				dragListenerOptions,
			);
			container.removeEventListener('drop', handleDrop, dragListenerOptions);
			root.removeEventListener(
				'dragenter',
				handleDragEnter,
				dragListenerOptions,
			);
			root.removeEventListener('dragover', handleDragOver, dragListenerOptions);
			root.removeEventListener('drop', handleDrop, dragListenerOptions);
			root.removeEventListener(
				'paste',
				handleNativeTerminalPaste,
				pasteListenerOptions,
			);
			root.removeEventListener('contextmenu', openTerminalContextMenu);
			root.removeEventListener('pointerdown', announceTerminalUserInput);
			root.removeEventListener('pointerdown', markPointerDownInside);
			window.removeEventListener('focus', handleWindowRefocus);
			window.removeEventListener('focus', repaintTerminalOnWindowFocus);
			if (refocusFrame !== null) {
				window.cancelAnimationFrame(refocusFrame);
			}
			if (refocusTimer !== null) {
				window.clearTimeout(refocusTimer);
			}
			window.removeEventListener('terminay-focus-terminal', focusTerminal);
			window.removeEventListener(
				'terminay-focus-terminal-note',
				focusTerminalNote,
			);
			window.removeEventListener(CLEAR_TERMINAL_EVENT, clearTerminal);
			window.removeEventListener(COPY_TERMINAL_EVENT, copyTerminal);
			window.removeEventListener(
				DROP_FILE_EXPLORER_PATH_EVENT,
				handleExplorerPathDrop,
			);
			window.removeEventListener(TERMINAL_PANEL_INPUT_EVENT, handlePanelInput);
			activeDisposer.dispose();
			if (activeFocusFrame !== null) {
				window.cancelAnimationFrame(activeFocusFrame);
			}
			if (resizeFrame !== null) {
				window.cancelAnimationFrame(resizeFrame);
			}
			resizeDisposer.dispose();
			keyDisposer.dispose();
			dataDisposer.dispose();
			touchScrollDisposer();
			panelEventDisposer?.();
			if (presentationRenewTimer !== null)
				window.clearTimeout(presentationRenewTimer);
			if (recoveryRetryTimer !== null) window.clearTimeout(recoveryRetryTimer);
			if (recoveryDeadlineTimer !== null)
				window.clearTimeout(recoveryDeadlineTimer);
			dataReplayDisposed = true;
			bindingFence.retire();
			activeBinding = null;
			serverInputQueue?.close();
			const attachmentToDetach = panelAttachment;
			panelAttachment = null;
			terminalPanelResizeRef.current = () => {};
			terminalPresentationActionRef.current = () => Promise.resolve();
			retryServerAttachmentRef.current = () => {};
			rebindServerAttachmentRef.current = () => {};
			terminalPresentationControllerRef.current = false;
			pendingPanelResize = null;
			if (attachmentToDetach !== null)
				void attachmentToDetach.detach().catch(() => {});
			contextReaderDisposer?.();
			zoomDisposer?.();
			screenElement?.removeEventListener(
				'mousedown',
				preventModifierLinkSelection,
			);
			searchAddonRef.current = null;
			fitAddonRef.current = null;
			terminalRef.current = null;
			renderedPositionRef.current = null;
			hoveredLinkRef.current = null;
			terminal.dispose();
		};
	}, [
		announceTerminalFocus,
		props.api,
		props.params.registerTerminalContextReader,
		props.params.sessionId,
		props.params.terminalSessionStatus,
		props.params.terminalClientFromPosition,
		props.params.terminalClientId,
		props.params.terminalClientIdentity,
		props.params.terminalClientMode,
		props.params.terminalPanelClient,
		resolvedTerminalClient,
		settingsClient,
	]);

	useEffect(() => {
		if (terminalClientContext?.client === undefined) return;
		if (
			boundTerminalClientRef.current === terminalClientContext.client &&
			boundHydrationReporterRef.current ===
				terminalClientContext.reportConnectionHydrated
		)
			return;
		boundTerminalClientRef.current = terminalClientContext.client;
		boundHydrationReporterRef.current =
			terminalClientContext.reportConnectionHydrated;
		const replacementTerminalClient =
			terminalClientContext.applicationClient === undefined
				? terminalClientContext.client
				: new TerminayTerminalClient(terminalClientContext.applicationClient);
		const replacementClient = new TerminayTerminalPanelClient(
			replacementTerminalClient,
		);
		panelClientDelegateRef.current = replacementClient;
		rebindServerAttachmentRef.current({
			client: replacementClient,
			clientId: terminalClientContext.clientId,
		});
	}, [
		terminalClientContext?.applicationClient,
		terminalClientContext?.client,
		terminalClientContext?.clientId,
		terminalClientContext?.reportConnectionHydrated,
	]);

	useEffect(() => {
		settingsRef.current = settings;

		const terminal = terminalRef.current;
		const fitAddon = fitAddonRef.current;
		const root = xtermRootRef.current;
		if (!terminal || !fitAddon || !root) {
			return;
		}

		applyTerminalSettings(
			terminal,
			settings,
			props.params.color,
			zoomLevelRef.current,
		);
		const remoteSizeOverride = remoteSizeOverrideRef.current;
		if (remoteSizeOverride) {
			applyRemoteTerminalSize(
				root,
				terminal,
				remoteSizeOverride.cols,
				remoteSizeOverride.rows,
				() => {
					const currentOverride = remoteSizeOverrideRef.current;
					return (
						terminalRef.current === terminal &&
						currentOverride?.cols === remoteSizeOverride.cols &&
						currentOverride.rows === remoteSizeOverride.rows
					);
				},
			);
			return;
		}

		const refreshFrame = window.requestAnimationFrame(() => {
			if (
				terminalRef.current !== terminal ||
				root.clientWidth <= 0 ||
				root.clientHeight <= 0
			) {
				return;
			}
			// Font metrics settle asynchronously inside xterm. Refreshing in the
			// settings update turn can leave its retained buffer intact while the
			// row renderer remains empty. Re-fit and repaint after those metrics
			// have committed; this never replays server bytes.
			clearRemoteTerminalElementSize(root, terminal);
			fitAddon.fit();
			updateTerminalGridMetadata(root, terminal.cols, terminal.rows);
			if (terminal.rows > 0) terminal.refresh(0, terminal.rows - 1);
			const useServerTerminal =
				resolvedTerminalClient.panelClient !== undefined &&
				resolvedTerminalClient.identity !== undefined &&
				resolvedTerminalClient.clientId !== undefined;
			if (useServerTerminal) {
				terminalPanelResizeRef.current(terminal.cols, terminal.rows);
			}
		});
		return () => window.cancelAnimationFrame(refreshFrame);
	}, [
		props.params.color,
		props.params.sessionId,
		resolvedTerminalClient,
		settings,
	]);

	useEffect(() => {
		const note = noteRef.current;
		if (!note) {
			return;
		}

		const nextText = props.params.terminalNote ?? '';
		if (note.value !== nextText && note.ownerDocument.activeElement !== note) {
			note.value = nextText;
		}
		note.style.height = '0px';
		note.style.height = `${note.scrollHeight}px`;
	}, [props.params.terminalNote]);

	const resizeNote = () => {
		const note = noteRef.current;
		if (!note) {
			return;
		}

		note.style.height = '0px';
		note.style.height = `${note.scrollHeight}px`;
	};

	useEffect(() => {
		if (!isSearchOpen) {
			runSearchAction((searchAddon) => {
				searchAddon.clearDecorations();
				searchAddon.clearActiveDecoration();
			});
			setSearchSummary({ index: 0, count: 0 });
			terminalRef.current?.focus();
			return;
		}

		window.requestAnimationFrame(() => {
			searchInputRef.current?.focus();
			searchInputRef.current?.select();
		});
	}, [isSearchOpen, runSearchAction]);

	useEffect(() => {
		if (!searchQuery) {
			runSearchAction((searchAddon) => {
				searchAddon.clearDecorations();
				searchAddon.clearActiveDecoration();
			});
			setSearchSummary({ index: 0, count: 0 });
			return;
		}

		runSearchAction((searchAddon) => {
			searchAddon.findNext(searchQuery, searchOptions);
		});
	}, [searchQuery, runSearchAction]);

	const closeSearch = () => {
		setIsSearchOpen(false);
	};

	const goToNextResult = () => {
		if (!searchQuery) {
			return;
		}

		runSearchAction((searchAddon) => {
			searchAddon.findNext(searchQuery, searchOptions);
		});
	};

	const goToPreviousResult = () => {
		if (!searchQuery) {
			return;
		}

		runSearchAction((searchAddon) => {
			searchAddon.findPrevious(searchQuery, searchOptions);
		});
	};

	const terminalPanelStyle = {
		'--terminal-panel-surface': settings.theme.background,
		'--terminal-note-color': props.params.color || settings.theme.cursor,
	} as CSSProperties;

	const copyContextMenuSelection = () => {
		const selectedText = terminalRef.current?.getSelection() ?? '';
		void copyTerminalSelection(selectedText, writeClipboardText);
	};

	const pasteFromContextMenu = () => {
		const terminal = terminalRef.current;
		if (!terminal) {
			return;
		}

		void pasteTerminalClipboard(readTerminalClipboard, {
			announceInput: () => {
				window.dispatchEvent(
					new CustomEvent('terminay-terminal-user-input', {
						detail: { sessionId: props.params.sessionId },
					}),
				);
			},
			paste: (text) => terminal.paste(text),
			focus: () => terminal.focus(),
		});
	};

	const copyContextMenuLink = (link: string) => {
		void copyTerminalSelection(link, writeClipboardText);
	};

	return (
		<div
			className={`terminal-panel${hasTerminalNote ? ' terminal-panel--has-note' : ''}${
				isRemoteSizeOverrideActive
					? ' terminal-panel--remote-size-override'
					: ''
			}`}
			data-terminay-terminal-session-id={props.params.sessionId}
			ref={containerRef}
			style={terminalPanelStyle}
		>
			{hasTerminalNote ? (
				<div className="terminal-note-shell">
					<textarea
						ref={noteRef}
						className="terminal-note-editor"
						aria-label="Terminal note"
						placeholder="Add a note for this terminal..."
						rows={1}
						value={props.params.terminalNote ?? ''}
						onChange={(event) => {
							props.params.onUpdateNote?.(event.currentTarget.value);
						}}
						onInput={() => {
							resizeNote();
						}}
						onPaste={() => {
							window.requestAnimationFrame(resizeNote);
						}}
						onPointerDown={(event) => event.stopPropagation()}
						onKeyDown={(event) => {
							if (shouldReturnFocusToTerminalFromNote(event)) {
								event.preventDefault();
								event.stopPropagation();
								terminalRef.current?.focus();
								announceTerminalFocus();
								return;
							}

							// Notes are workspace metadata, never terminal input. Keep all
							// ordinary editor keystrokes out of Dockview/xterm as well.
							event.stopPropagation();
						}}
					/>
				</div>
			) : null}
			{isSearchOpen ? (
				<search className="terminal-search" aria-label="Search terminal output">
					<input
						ref={searchInputRef}
						type="search"
						className="terminal-search-input"
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						onBlur={() =>
							runSearchAction((searchAddon) => {
								searchAddon.clearActiveDecoration();
							})
						}
						onKeyDown={(event) => {
							if (event.key === 'Escape') {
								event.preventDefault();
								closeSearch();
								return;
							}

							if (event.key === 'Enter') {
								event.preventDefault();
								if (event.shiftKey) {
									goToPreviousResult();
									return;
								}

								goToNextResult();
							}
						}}
						placeholder="Find in terminal"
						aria-label="Find in terminal"
					/>
					<span className="terminal-search-count" aria-live="polite">
						{searchSummary.count > 0
							? `${searchSummary.index}/${searchSummary.count}`
							: '0 results'}
					</span>
					<button
						type="button"
						className="terminal-search-button"
						onClick={goToPreviousResult}
						aria-label="Previous match"
					>
						↑
					</button>
					<button
						type="button"
						className="terminal-search-button"
						onClick={goToNextResult}
						aria-label="Next match"
					>
						↓
					</button>
					<button
						type="button"
						className="terminal-search-button"
						onClick={closeSearch}
						aria-label="Close search"
					>
						✕
					</button>
				</search>
			) : null}
			{terminalPresentation?.role === 'read_only' &&
			!presentationUnavailable ? (
				<div
					className="terminal-presentation-control"
					role="status"
					aria-live="polite"
				>
					<span>
						{terminalPresentation.holder === undefined
							? 'No device currently controls this terminal.'
							: 'Another device is controlling this terminal.'}
					</span>
					<button
						type="button"
						aria-label={
							terminalPresentation.holder === undefined
								? 'Take control of terminal'
								: 'Take back control of terminal'
						}
						onClick={() =>
							void terminalPresentationActionRef
								.current()
								.catch((error: unknown) => {
									setServerTerminalError(
										error instanceof Error
											? error.message
											: 'Terminal control takeover failed.',
									);
								})
						}
					>
						{terminalPresentation.holder === undefined
							? 'Take control'
							: 'Take back control'}
					</button>
				</div>
			) : null}
			<div className="terminal-panel-root" ref={xtermRootRef} />
			{serverTerminalError ? (
				<div className="terminal-panel-connection-error" role="alert">
					<p>{serverTerminalError}</p>
					{isTerminalRetryActionable(
						presentationUnavailable,
						terminalPanelConnectionContext?.canRetryConnection?.(),
					) ? (
						<button
							type="button"
							onClick={() => retryServerAttachmentRef.current()}
						>
							Retry connection
						</button>
					) : null}
				</div>
			) : null}
			{isTerminalHydrating && serverTerminalError === null ? (
				<div className="terminal-panel-loading" role="status" aria-busy="true">
					<div className="terminal-panel-loading__content">
						<img
							className="terminal-panel-loading__logo"
							src="terminay.svg"
							alt=""
							aria-hidden="true"
						/>
						<p>Loading terminal…</p>
					</div>
				</div>
			) : null}
			{dictationOverlay ? <DictationOverlay {...dictationOverlay} /> : null}
			{terminalContextMenu ? (
				<ContextMenu
					x={terminalContextMenu.x}
					y={terminalContextMenu.y}
					items={[
						{
							key: 'terminal-copy',
							label: 'Copy',
							disabled: !terminalContextMenu.hasSelection,
							onClick: copyContextMenuSelection,
						},
						{
							key: 'terminal-paste',
							label: 'Paste',
							disabled: !canReadTerminalClipboard(),
							onClick: pasteFromContextMenu,
						},
						...(terminalContextMenu.link
							? [
									{
										key: 'terminal-copy-link',
										label: 'Copy Link',
										onClick: () =>
											copyContextMenuLink(terminalContextMenu.link as string),
									},
								]
							: []),
					]}
					onClose={() => {
						setTerminalContextMenu(null);
						terminalRef.current?.focus();
					}}
				/>
			) : null}
		</div>
	);
}
