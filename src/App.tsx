import type { FileViewerClient } from '@terminay/client-core';
import type { JsonValue } from '@terminay/protocol';
import {
	type ActivitySessionSnapshot,
	MacroClient,
	type ProjectEnvironmentClientProfile,
	type ProjectEnvironmentProviderDescriptor,
	ProjectEnvironmentsClient,
	SettingsClient,
	type ShellProfileCatalogueEntry,
	ShellProfilesClient,
	TerminayAiClient,
	TerminayClientFacade,
} from '@terminay/client-core';
import type { DockviewApi } from 'dockview';
import { DockviewReact } from 'dockview';
import { AnimatePresence, motion } from 'framer-motion';
import {
	Eraser,
	FolderPlus,
	FolderSync,
	GitBranch,
	GitBranchPlus,
	GitPullRequestArrow,
	History,
	Mic,
	Play,
	Plug,
	RefreshCw,
	Search,
	Settings,
	Sidebar,
	Sparkles,
	Terminal,
} from 'lucide-react';
import {
	CSSProperties,
	type FormEvent,
	forwardRef,
	type MouseEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	EMPTY_AGENT_STATUS_SNAPSHOT,
	selectLiveAgentStatusesForTerminal,
} from './agentStatusStore';
import {
	AgentsSidebar,
	type AgentsSidebarItem,
} from './components/AgentsSidebar';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import { DocumentationTree } from './components/DocumentationTree';
import type {
	FilePanelInstanceParams,
	FilePanelSaveHandler,
} from './components/file-viewer';
import {
	FilePanel,
	FilePanelSaveRegistryProvider,
	FileTab,
} from './components/file-viewer';
import type { FolderPanelInstanceParams } from './components/folder-viewer';
import { FolderPanel, FolderTab } from './components/folder-viewer';
import { WorktreesPanel } from './components/git-panel/WorktreesPanel';
import { McpInstallModal } from './components/McpInstallModal';
import {
	SidebarPanelStack,
	type SidebarPanelStackItem,
} from './components/sidebar/SidebarPanelStack';
import {
	TERMINAL_PANEL_EXIT_EVENT,
	TERMINAL_PANEL_INPUT_EVENT,
	TERMINAL_PANEL_OUTPUT_EVENT,
	TerminalPanel,
	TerminalPanelClientContext,
	type TerminalPanelClientContextValue,
} from './components/TerminalPanel';
import type {
	TerminalActivityState,
	TerminalContextReader,
	TerminalPanelParams,
	TerminalTabMoveProject,
} from './components/TerminalTab';
import { TerminalTab } from './components/TerminalTab';
import {
	createServerMacroSettingsClient,
	useMacroSettings,
} from './hooks/useMacroSettings';
import {
	createServerTerminalSettingsClient,
	useTerminalSettings,
} from './hooks/useTerminalSettings';
import { checkForAppUpdate, openExternalUrl } from './host/nativeActions';
import {
	findCommandForKeyboardEvent,
	getCommandShortcut,
	getCommandShortcutLabel,
} from './keyboardShortcuts';
import { tryRenderMacroTemplate } from './macroSettings';
import { getPathRelativeToRoot } from './pathUtils';
import { ProjectEnvironmentSplitButton } from './projectEnvironments/ProjectEnvironmentSplitButton';
import type { ProjectEnvironmentSummaryDto } from './projectEnvironments/uiModel';
import {
	createServerMcpInstallClient,
	createServerRemoteAccessClients,
} from './services/serverApplicationFeatureClients';
import {
	type AuxiliaryRouteController,
	createAuxiliaryRouteController,
} from './shared/auxiliaryRoutes';
import {
	clearSucceededFeatureFailure,
	describeFeatureFailure,
	describeServerFeatureFailure,
	featureProjectRoot,
	isCancelledFeatureFailure,
	isOptionalObservationFailure,
	resolveProjectFeatureAuthority,
} from './shared/featureQueryAuthority';
import { composeProjectTerminalClientContext } from './shared/projectTerminalClientContext';
import { RemotePairingModal } from './shared/RemotePairingModal';
import {
	adaptServerAgentSnapshot,
	subscribeServerAgentSnapshots,
} from './shared/rendererAgentConnection';
import { recordBoundedRendererRender } from './shared/renderLoopGuard';
import {
	hasTerminalPresentation,
	type ServerWorkspacePanel,
} from './shared/serverWorkspaceReconciliation';
import { WorkspaceSplitLayout } from './shared/WorkspaceSplitLayout';
import {
	type TerminalActivityEvaluation,
	TerminalActivityStore,
} from './terminalActivityStore';
import { defaultTerminalSettings } from './terminalSettings';
import type {
	AgentState,
	AgentStatusEntry,
	AgentStatusSnapshot,
} from './types/agentStatus';
import type { FileViewerMode } from './types/fileViewer';
import type { MacroDefinition, MacroFieldValue } from './types/macros';
import type { SidebarPanelId } from './types/settings';
import type {
	AiTabMetadataTarget,
	AppCommand,
	AppUpdateStatus,
	FileSearchResult,
	QuickPushAction,
	TerminalRecordingStartMetadata,
	TerminalRecordingState,
} from './types/terminay';
import {
	confirmTerminalClose,
	observeTerminalClosePreflight,
} from './workspace/closeProtection';
import { FileExplorerTree } from './workspace/FileExplorerTree';
import { ProjectTabList } from './workspace/ProjectTabList';
import {
	createProjectTab,
	type ProjectTab,
	withProjectSidebarVisibility,
} from './workspace/projectTabModel';
import {
	type ConnectionSwitcherEntry,
	RemoteAccessConnectionMenu,
} from './workspace/RemoteAccessConnectionMenu';
import {
	buildTerminalActivityOverview,
	TerminalActivityOverview,
	type TerminalActivityOverviewItem,
	type TerminalPresentationActivityState,
} from './workspace/TerminalActivityOverview';
import {
	activateTerminalPanel,
	findTerminalFocusTarget,
	findTerminalPanel,
	getActiveTerminalSessionId,
	saveActiveDockviewPanel,
} from './workspace/terminalDockviewCommands';
import {
	exportProjectPresentationsForMove,
	exportTerminalPresentationForMove,
	type MovedProject,
	type MovedTerminalTab,
} from './workspace/terminalTransferOrchestration';
import { useDictationController } from './workspace/useDictationController';
import { useDockviewPanelLifecycle } from './workspace/useDockviewPanelLifecycle';
import { useDocumentationController } from './workspace/useDocumentationController';
import { useFileExplorerController } from './workspace/useFileExplorerController';
import {
	type GitPushMenuTarget,
	useGitPushMenuController,
} from './workspace/useGitPushMenuController';
import { useMacroLauncherController } from './workspace/useMacroLauncherController';
import { useMacroRunController } from './workspace/useMacroRunController';
import { useProjectCollection } from './workspace/useProjectCollection';
import { useProjectEditor } from './workspace/useProjectEditor';
import { useProjectTabTransfer } from './workspace/useProjectTabTransfer';
import { useProjectTerminalCwd } from './workspace/useProjectTerminalCwd';
import { useRemoteAccessController } from './workspace/useRemoteAccessController';
import { useTerminalActivityController } from './workspace/useTerminalActivityController';
import { useTerminalAdoptionController } from './workspace/useTerminalAdoptionController';
import {
	type ControlHandlerResult,
	clearTerminalControlActivity,
	createTerminalControlState,
	recordTerminalControlActivity,
	recordTerminalControlExit,
	useTerminalControlController,
} from './workspace/useTerminalControlController';
import {
	scheduleCreatedTerminalFocus,
	useTerminalCreationController,
} from './workspace/useTerminalCreationController';
import { useTerminalDockviewWindowController } from './workspace/useTerminalDockviewWindowController';
import { useTerminalRecordingController } from './workspace/useTerminalRecordingController';
import { useTerminalSwitcherController } from './workspace/useTerminalSwitcherController';
import './App.css';
import { recordBootstrapDiagnostic } from './shared/rendererDiagnostics';

type GitPushAgentAction = QuickPushAction;
type GitPushAgentActionGroup = 'current' | 'new' | 'default';

type PendingProjectCreation = Readonly<{
	initialActiveProjectId: string;
	projectId?: string;
	tab: ProjectTab;
}>;

const GIT_PUSH_AGENT_ACTIONS: Array<{
	action: GitPushAgentAction;
	group: GitPushAgentActionGroup;
	label: string;
	task: string;
	quickPush?: boolean;
}> = [
	{
		action: 'current',
		group: 'current',
		label: 'Push to current branch',
		task: 'Commit all of my current changes and push them to the current branch.',
		quickPush: true,
	},
	{
		action: 'current-pr',
		group: 'current',
		label: 'Push to current branch + create PR',
		task: 'Commit all of my current changes, push them to the current branch, and open a pull request.',
		quickPush: true,
	},
	{
		action: 'new',
		group: 'new',
		label: 'Push to new branch',
		task: 'Commit all of my current changes onto a new, descriptively named branch and push it.',
		quickPush: true,
	},
	{
		action: 'new-pr',
		group: 'new',
		label: 'Push to new branch + create PR',
		task: 'Commit all of my current changes onto a new, descriptively named branch, push it, and open a pull request.',
		quickPush: true,
	},
	{
		action: 'default',
		group: 'default',
		label: 'Push to default branch',
		task: 'Commit all of my current changes onto the default branch and push it.',
		quickPush: true,
	},
];

function formatGitPushBranchLabel(branch: string | null | undefined): string {
	return branch?.trim() || 'unknown';
}

function getGitPushActionIcon(action: GitPushAgentAction): ReactNode {
	if (action === 'new') {
		return <GitBranchPlus size={14} aria-hidden="true" />;
	}

	if (action === 'current-pr' || action === 'new-pr') {
		return <GitPullRequestArrow size={14} aria-hidden="true" />;
	}

	return <GitBranch size={14} aria-hidden="true" />;
}

function buildGitPushMenuItems(options: {
	target: GitPushMenuTarget;
	onLaunchAgent: (
		action: GitPushAgentAction,
		target: GitPushMenuTarget,
	) => void;
}): ContextMenuItem[] {
	const { target, onLaunchAgent } = options;
	const currentBranch = formatGitPushBranchLabel(target.branch);
	const defaultBranch = formatGitPushBranchLabel(
		target.defaultBranch ?? 'main',
	);

	const headings: Record<GitPushAgentActionGroup, string> = {
		current: `Current Branch (${currentBranch})`,
		new: 'New Branch',
		default: `Default Branch (${defaultBranch})`,
	};
	const items: ContextMenuItem[] = [];

	for (const group of [
		'current',
		'new',
		'default',
	] as GitPushAgentActionGroup[]) {
		if (items.length > 0) {
			items.push({ key: `${group}-separator`, label: '', separator: true });
		}
		items.push({
			key: `${group}-heading`,
			label: headings[group],
			heading: true,
		});

		for (const entry of GIT_PUSH_AGENT_ACTIONS.filter(
			(action) => action.group === group,
		)) {
			items.push({
				key: entry.action,
				label: entry.label,
				icon: getGitPushActionIcon(entry.action),
				onClick: () => onLaunchAgent(entry.action, target),
			});
		}
	}

	return items;
}

function buildGitPushAgentPrompt(
	template: string,
	task: string,
	branch: string | null | undefined,
	defaultBranch: string | null | undefined,
): string {
	const safeBranch = branch?.trim() ? branch.trim() : 'the current branch';
	const safeDefaultBranch = defaultBranch?.trim()
		? defaultBranch.trim()
		: 'the default branch';
	const withTask = template.includes('{{task}}')
		? template.replace(/\{\{task\}\}/g, () => task)
		: `${template.trim()}\n\nTask: ${task}`;
	return withTask
		.replace(/\{\{branch\}\}/g, () => safeBranch)
		.replace(/\{\{defaultBranch\}\}/g, () => safeDefaultBranch);
}

function buildGitPushAgentCommand(
	provider: 'codex' | 'claudeCode',
	model: string,
	prompt: string,
): string {
	const binary = provider === 'claudeCode' ? 'claude' : 'codex';
	const trimmedModel = model.trim();
	const modelFlag = trimmedModel ? ` --model ${trimmedModel}` : '';
	const quotedPrompt = `'${prompt.replace(/'/g, "'\\''")}'`;
	return `${binary}${modelFlag} ${quotedPrompt}`;
}

type OpenFileOptions = {
	initialMode?: FileViewerMode;
	presentation?: 'file-viewer' | 'documentation';
};

type MacroLauncherGroup = 'Terminal' | 'Workspace' | 'Macros';

type MacroLauncherItem = {
	description: string;
	group: MacroLauncherGroup;
	icon: ReactNode;
	id: string;
	onSelect: () => void;
	searchText: string;
	shortcutLabel?: string;
	title: string;
};

type MacroLauncherGroupedItem = {
	index: number;
	item: MacroLauncherItem;
};

type DockPanelTabAppearance = {
	activityIndicatorsEnabled?: boolean;
	agentNeedsAttention?: boolean;
	agentState?: AgentState;
	agentUnread?: boolean;
	color?: string;
	emoji?: string;
	inheritsProjectColor?: boolean;
	projectColor?: string;
	showActiveTabActivityIndicator?: boolean;
	showFinishedTabActivityIndicator?: boolean;
	terminalNote?: string;
};

type ProjectWorkspaceHandle = {
	acceptMovedTerminal: (terminal: MovedTerminalTab) => boolean;
	acceptServerTerminal: (
		panelId: string,
		sessionId: string,
		title?: string,
		cwd?: string,
		terminalSessionStatus?: 'running' | 'exited' | 'interrupted',
	) => boolean;
	reconcileServerPanels: (panels: readonly ServerWorkspacePanel[]) => void;
	activateTerminal: (panelId: string, sessionId: string) => void;
	executeCommand: (command: AppCommand) => Promise<void>;
	exportTerminalForMove: (panelId: string) => MovedTerminalTab | null;
	/**
	 * Export every terminal in this project for a cross-window move, flagging
	 * their sessions as "moving" so the later workspace unmount does not kill the
	 * live PTYs. Does not remove the project — the caller does that once the
	 * sessions have been re-homed to the receiving window.
	 */
	exportProjectForMove: () => MovedProject | null;
	focusActiveTerminal: () => void;
	/** True when the given terminal session lives in this workspace's project. */
	ownsControlSession: (sessionId: string) => boolean;
	/** Handle an MCP control request scoped to a terminal in this project. */
	handleControlRequest: (
		op: string,
		params: unknown,
		scopeSessionId: string,
	) => Promise<ControlHandlerResult>;
};

type ProjectWorkspaceProps = {
	auxiliaryRoutes: AuxiliaryRouteController;
	isActive: boolean;
	isMac: boolean;
	macros: MacroDefinition[];
	onAddProject: () => Promise<void>;
	onCloseProject: (
		projectId: string,
		options?: { skipConfirmation?: boolean },
	) => void;
	onEditProject: (projectId: string) => Promise<void>;
	onMoveTerminalToProject: (
		sourceProjectId: string,
		panelId: string,
		targetProjectId: string,
	) => void;
	onPopoutProject: (projectId: string) => Promise<void>;
	onTerminalActivityOverviewChange: (
		projectId: string,
		items: TerminalActivityOverviewItem[],
	) => void;
	onCommitProjectSidebar: (
		projectId: string,
		patch: Partial<
			Pick<
				ProjectTab,
				| 'fileExplorerWidth'
				| 'sidebarExplorerHeight'
				| 'sidebarAgentsHeight'
				| 'sidebarGitHeight'
				| 'sidebarDocumentationHeight'
			>
		>,
	) => Promise<void>;
	onUpdateProject: (projectId: string, updates: Partial<ProjectTab>) => void;
	agentStatusSnapshot: AgentStatusSnapshot;
	popoutUrl: string;
	project: ProjectTab;
	projects: ProjectTab[];
	/** Optional connection-scoped client used by migrated terminal panels. */
	terminalClientContext?: Omit<TerminalPanelClientContextValue, 'projectId'>;
	/** Terminals to reattach instead of seeding a fresh terminal (adopted project). */
	adoptedTerminals?: MovedTerminalTab[];
};

const DOCKVIEW_SASH_ACTIVITY_DEFER_MS = 300;
const PROJECT_DEACTIVATION_ACTIVITY_SETTLE_MS = 1_500;

/** Terminal input is delivered only to the matching server-backed panel
 * attachment.  The renderer never falls back to a host-side terminal IPC
 * channel when a panel is unavailable. */
function sendTerminalPanelInput(sessionId: string, data: string): void {
	if (!sessionId || data.length === 0) return;
	window.dispatchEvent(
		new CustomEvent(TERMINAL_PANEL_INPUT_EVENT, {
			detail: { data, sessionId },
		}),
	);
}

/** Presentation only: canonical activity has already been reduced by the
 * server. This mapping must not infer a transition or write local state. */
function serverActivityEvaluation(
	snapshot: ActivitySessionSnapshot,
): TerminalActivityEvaluation {
	if (snapshot.attention && !snapshot.acknowledged) {
		return { nextDeadline: null, state: 'attention' };
	}
	if (snapshot.status === 'working') {
		return { nextDeadline: null, state: 'recent' };
	}
	return {
		nextDeadline: null,
		state: snapshot.acknowledged ? 'viewed' : 'unviewed',
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function getEffectiveTerminalTabColor(
	params: DockPanelTabAppearance | undefined,
	fallbackProjectColor: string,
): string {
	if (params?.inheritsProjectColor) {
		return params.projectColor ?? fallbackProjectColor;
	}

	return params?.color ?? fallbackProjectColor;
}

function areTerminalActivityIndicatorsEnabled(
	params: DockPanelTabAppearance | undefined,
): boolean {
	return params?.activityIndicatorsEnabled !== false;
}

function isTerminalActivityIndicatorStateVisible(
	state: TerminalActivityState | undefined,
	params: DockPanelTabAppearance | undefined,
): state is TerminalPresentationActivityState {
	if (!areTerminalActivityIndicatorsEnabled(params)) {
		return false;
	}

	if (state === 'attention') {
		return true;
	}

	if (state === 'recent') {
		return params?.showActiveTabActivityIndicator === true;
	}

	if (state === 'unviewed') {
		return params?.showFinishedTabActivityIndicator !== false;
	}

	return false;
}

type AggregatedAgentStatus = {
	entries: readonly AgentStatusEntry[];
	state: AgentState;
	unread: boolean;
};

function aggregateAgentStatusForTerminal(
	snapshot: AgentStatusSnapshot,
	terminalSessionId: string,
): AggregatedAgentStatus | null {
	const entries = selectLiveAgentStatusesForTerminal(
		snapshot,
		terminalSessionId,
	);
	if (entries.length === 0) {
		return null;
	}

	let state: AgentState = 'idle';
	if (entries.some((entry) => entry.state === 'blocked')) {
		state = 'blocked';
	} else if (entries.some((entry) => entry.state === 'waiting')) {
		state = 'waiting';
	} else if (entries.some((entry) => entry.state === 'working')) {
		state = 'working';
	} else if (entries.some((entry) => entry.state === 'done')) {
		state = 'done';
	}

	return {
		entries,
		state,
		unread: entries.some((entry) => entry.unread),
	};
}

function isAgentAttentionState(state: AgentState): boolean {
	return state === 'waiting' || state === 'blocked';
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCommandSearchScore(
	item: {
		title: string;
		description: string;
		searchText: string;
	},
	query: string,
): number {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return 0;
	}

	const title = item.title.toLowerCase();
	const description = item.description.toLowerCase();
	const searchText = item.searchText.toLowerCase();
	const boundaryQueryPattern = new RegExp(
		`\\b${escapeRegExp(normalizedQuery)}`,
	);
	const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
	const titleWords = title.split(/[^a-z0-9]+/).filter(Boolean);
	let score = 0;

	if (title === normalizedQuery) {
		score += 1_000;
	}
	if (title.startsWith(normalizedQuery)) {
		score += 700;
	}
	if (boundaryQueryPattern.test(title)) {
		score += 500;
	}
	if (title.includes(normalizedQuery)) {
		score += 300;
	}
	if (
		queryWords.length > 0 &&
		queryWords.every((word) =>
			titleWords.some((titleWord) => titleWord.startsWith(word)),
		)
	) {
		score += 250;
	}
	if (boundaryQueryPattern.test(description)) {
		score += 120;
	}
	if (description.includes(normalizedQuery)) {
		score += 80;
	}
	if (boundaryQueryPattern.test(searchText)) {
		score += 40;
	}
	if (searchText.includes(normalizedQuery)) {
		score += 20;
	}

	return score;
}

function ModalBackdrop({
	children,
	onClose,
}: {
	children: ReactNode;
	onClose: () => void;
}) {
	const pointerStartedOnBackdropRef = useRef(false);

	return (
		<div
			className="project-edit-modal-backdrop"
			onMouseDown={(event) => {
				pointerStartedOnBackdropRef.current =
					event.target === event.currentTarget;
			}}
			onMouseUp={(event) => {
				const shouldClose =
					pointerStartedOnBackdropRef.current &&
					event.target === event.currentTarget;
				pointerStartedOnBackdropRef.current = false;

				if (shouldClose) {
					onClose();
				}
			}}
		>
			{children}
		</div>
	);
}

function ModalTitlebar({
	title,
	titleId,
	onClose,
	onMouseDown,
}: {
	title: string;
	titleId: string;
	onClose: () => void;
	onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
	return (
		<div className="project-edit-modal-titlebar" onMouseDown={onMouseDown}>
			<h2 id={titleId} className="project-edit-modal-title">
				{title}
			</h2>
			<button
				type="button"
				className="project-edit-modal-close"
				onClick={onClose}
				aria-label={`Close ${title}`}
				title={`Close ${title}`}
			>
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 12 12"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M9 3L3 9M3 3L9 9"
						stroke="currentColor"
						strokeWidth="1.8"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>
		</div>
	);
}

type MacroFileFieldInputProps = {
	fileViewerClient?: FileViewerClient;
	id?: string;
	onChange: (value: string) => void;
	placeholder: string;
	projectId: string;
	projectRoot: string;
	rootPath: string;
	value: string;
};

const MacroFileFieldInput = forwardRef<
	HTMLInputElement,
	MacroFileFieldInputProps
>(
	(
		{
			fileViewerClient,
			id,
			onChange,
			placeholder,
			projectId,
			projectRoot,
			rootPath,
			value,
		},
		ref,
	) => {
		const [suggestions, setSuggestions] = useState<FileSearchResult[]>([]);
		const [highlightedIndex, setHighlightedIndex] = useState(0);
		const [isOpen, setIsOpen] = useState(false);
		const [isLoading, setIsLoading] = useState(false);
		const requestIdRef = useRef(0);
		const normalizedValue = value.trim();

		useEffect(() => {
			requestIdRef.current += 1;
			const requestId = requestIdRef.current;

			if (!isOpen || normalizedValue.length === 0 || !rootPath.trim()) {
				setSuggestions([]);
				setIsLoading(false);
				return;
			}

			setIsLoading(true);
			const timeoutId = window.setTimeout(() => {
				if (fileViewerClient === undefined) {
					setSuggestions([]);
					setIsLoading(false);
					return;
				}
				void fileViewerClient
					.searchFolder(
						getPathRelativeToRoot(rootPath, projectRoot),
						normalizedValue,
						projectId,
						{ limit: 60 },
					)
					.then((results) => {
						if (requestIdRef.current !== requestId) {
							return;
						}

						setSuggestions(
							results.results.map((entry) => ({
								isDirectory: entry.kind === 'directory',
								path: joinFileExplorerPath(projectRoot, entry.relativePath),
								relativePath: entry.relativePath,
							})),
						);
						setHighlightedIndex(0);
					})
					.catch(() => {
						if (requestIdRef.current === requestId) {
							setSuggestions([]);
						}
					})
					.finally(() => {
						if (requestIdRef.current === requestId) {
							setIsLoading(false);
						}
					});
			}, 120);

			return () => {
				window.clearTimeout(timeoutId);
			};
		}, [
			fileViewerClient,
			isOpen,
			normalizedValue,
			projectId,
			projectRoot,
			rootPath,
		]);

		const commitSuggestion = useCallback(
			(result: FileSearchResult) => {
				onChange(result.relativePath);
				setSuggestions([]);
				setHighlightedIndex(0);
				setIsOpen(result.isDirectory);
			},
			[onChange],
		);

		const handleKeyDown = useCallback(
			(event: ReactKeyboardEvent<HTMLInputElement>) => {
				if (event.key === 'ArrowDown') {
					event.preventDefault();
					setIsOpen(true);
					setHighlightedIndex((current) =>
						suggestions.length === 0 ? 0 : (current + 1) % suggestions.length,
					);
					return;
				}

				if (event.key === 'ArrowUp') {
					event.preventDefault();
					setIsOpen(true);
					setHighlightedIndex((current) =>
						suggestions.length === 0
							? 0
							: (current - 1 + suggestions.length) % suggestions.length,
					);
					return;
				}

				if (
					(event.key === 'Enter' || event.key === 'Tab') &&
					isOpen &&
					suggestions[highlightedIndex]
				) {
					event.preventDefault();
					commitSuggestion(suggestions[highlightedIndex]);
					return;
				}

				if (event.key === 'Escape' && isOpen) {
					event.stopPropagation();
					setIsOpen(false);
				}
			},
			[commitSuggestion, highlightedIndex, isOpen, suggestions],
		);

		return (
			<div className="macro-file-field">
				<input
					id={id}
					ref={ref}
					type="text"
					value={value}
					placeholder={placeholder || 'Start typing a file path...'}
					onChange={(event) => {
						onChange(event.target.value);
						setIsOpen(true);
					}}
					onFocus={() => setIsOpen(true)}
					onBlur={() => {
						window.setTimeout(() => setIsOpen(false), 100);
					}}
					onKeyDown={handleKeyDown}
					spellCheck={false}
					autoComplete="off"
				/>
				{isOpen && normalizedValue.length > 0 ? (
					<div className="macro-file-field-menu" role="listbox">
						{isLoading ? (
							<div className="macro-file-field-empty">Searching files...</div>
						) : suggestions.length === 0 ? (
							<div className="macro-file-field-empty">No matching files</div>
						) : (
							suggestions.map((result, index) => (
								<button
									key={result.path}
									type="button"
									className={`macro-file-field-option${index === highlightedIndex ? ' macro-file-field-option--active' : ''}`}
									onMouseDown={(event) => event.preventDefault()}
									onMouseEnter={() => setHighlightedIndex(index)}
									onClick={() => commitSuggestion(result)}
									role="option"
									aria-selected={index === highlightedIndex}
								>
									{result.relativePath}
								</button>
							))
						)}
					</div>
				) : null}
			</div>
		);
	},
);

MacroFileFieldInput.displayName = 'MacroFileFieldInput';

function useDraggableModal(isOpen: boolean) {
	const modalRef = useRef<HTMLElement | null>(null);
	const positionRef = useRef({ x: 0, y: 0 });
	const [position, setPosition] = useState({ x: 0, y: 0 });

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		const resetPosition = { x: 0, y: 0 };
		positionRef.current = resetPosition;
		setPosition(resetPosition);
	}, [isOpen]);

	const handleTitlebarPointerDown = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			const target = event.target as HTMLElement;
			if (target.closest('button, input, select, textarea, a')) {
				return;
			}

			const modal = modalRef.current;
			if (!modal) {
				return;
			}

			event.preventDefault();

			const startPointerX = event.clientX;
			const startPointerY = event.clientY;
			const startPosition = positionRef.current;

			const handlePointerMove = (moveEvent: globalThis.MouseEvent) => {
				const rect = modal.getBoundingClientRect();
				const centeredLeft = (window.innerWidth - rect.width) / 2;
				const centeredTop = (window.innerHeight - rect.height) / 2;
				const margin = 16;

				const nextX = clamp(
					startPosition.x + (moveEvent.clientX - startPointerX),
					margin - centeredLeft,
					window.innerWidth - margin - rect.width - centeredLeft,
				);
				const nextY = clamp(
					startPosition.y + (moveEvent.clientY - startPointerY),
					margin - centeredTop,
					window.innerHeight - margin - rect.height - centeredTop,
				);
				const nextPosition = { x: nextX, y: nextY };

				positionRef.current = nextPosition;
				setPosition(nextPosition);
			};

			const handlePointerUp = () => {
				window.removeEventListener('mousemove', handlePointerMove);
				window.removeEventListener('mouseup', handlePointerUp);
			};

			window.addEventListener('mousemove', handlePointerMove);
			window.addEventListener('mouseup', handlePointerUp);
		},
		[],
	);

	return {
		handleTitlebarPointerDown,
		modalRef,
		modalStyle: {
			transform:
				position.x === 0 && position.y === 0
					? undefined
					: `translate(${position.x}px, ${position.y}px)`,
		} as CSSProperties,
	};
}

function createAbortError(): Error {
	const error = new Error('Macro execution canceled.');
	error.name = 'AbortError';
	return error;
}

function waitForSessionInactivity(
	sessionId: string,
	durationMs: number,
	signal: AbortSignal,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(createAbortError());
			return;
		}

		let timeout = 0;

		const cleanup = () => {
			window.clearTimeout(timeout);
			dispose();
			signal.removeEventListener('abort', onAbort);
		};

		const finish = () => {
			cleanup();
			resolve();
		};

		const onAbort = () => {
			cleanup();
			reject(createAbortError());
		};

		const restartTimer = () => {
			window.clearTimeout(timeout);
			timeout = window.setTimeout(finish, durationMs);
		};

		const onTerminalOutput = (event: Event) => {
			const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
			if (detail?.sessionId !== sessionId) {
				return;
			}

			restartTimer();
		};
		window.addEventListener(TERMINAL_PANEL_OUTPUT_EVENT, onTerminalOutput);
		const dispose = () =>
			window.removeEventListener(TERMINAL_PANEL_OUTPUT_EVENT, onTerminalOutput);

		signal.addEventListener('abort', onAbort, { once: true });
		restartTimer();
	});
}

type FileExplorerNameDialogOptions = {
	description?: string;
	initialValue?: string;
	label: string;
	submitLabel: string;
	title: string;
};

type FileExplorerNameDialogState = FileExplorerNameDialogOptions & {
	id: number;
	resolve: (value: string | null) => void;
};

function FileExplorerNameModal({
	dialog,
	modal,
	onCancel,
	onSubmit,
}: {
	dialog: FileExplorerNameDialogState;
	modal: ReturnType<typeof useDraggableModal>;
	onCancel: () => void;
	onSubmit: (value: string) => void;
}) {
	const [value, setValue] = useState(dialog.initialValue ?? '');
	const inputRef = useRef<HTMLInputElement | null>(null);
	const titleId = `file-explorer-name-modal-title-${dialog.id}`;
	const trimmedValue = value.trim();

	useEffect(() => {
		setValue(dialog.initialValue ?? '');
		window.requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onCancel();
			}
		};

		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [dialog.initialValue, onCancel]);

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!trimmedValue) {
			return;
		}
		onSubmit(trimmedValue);
	};

	return (
		<ModalBackdrop onClose={onCancel}>
			<form
				className="project-edit-modal"
				ref={(element) => {
					modal.modalRef.current = element;
				}}
				style={modal.modalStyle}
				onSubmit={handleSubmit}
				onClick={(event) => event.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
			>
				<ModalTitlebar
					title={dialog.title}
					titleId={titleId}
					onClose={onCancel}
					onMouseDown={modal.handleTitlebarPointerDown}
				/>
				{dialog.description ? (
					<p className="file-explorer-name-modal-description">
						{dialog.description}
					</p>
				) : null}
				<label>
					<span>{dialog.label}</span>
					<input
						ref={inputRef}
						type="text"
						value={value}
						onChange={(event) => setValue(event.target.value)}
						spellCheck={false}
					/>
				</label>
				<div className="project-edit-actions">
					<button type="button" onClick={onCancel}>
						Cancel
					</button>
					<button type="submit" disabled={!trimmedValue}>
						{dialog.submitLabel}
					</button>
				</div>
			</form>
		</ModalBackdrop>
	);
}

function joinFileExplorerPath(dirPath: string, name: string): string {
	if (dirPath.endsWith('/') || dirPath.endsWith('\\')) {
		return `${dirPath}${name}`;
	}

	return `${dirPath}/${name}`;
}

function FeatureUnavailableState({ reason }: Readonly<{ reason: string }>) {
	return (
		<div className="sidebar-feature-unavailable" role="status">
			<strong>Unavailable</strong>
			<span>{reason}</span>
		</div>
	);
}

function unavailableFileViewerClient(reason: string): FileViewerClient {
	return new Proxy({} as FileViewerClient, {
		get: () => () => Promise.reject(new Error(reason)),
	});
}

const ProjectWorkspace = forwardRef<
	ProjectWorkspaceHandle,
	ProjectWorkspaceProps
>(
	(
		{
			agentStatusSnapshot,
			auxiliaryRoutes,
			isActive,
			isMac,
			macros,
			onAddProject,
			onCloseProject,
			onEditProject,
			onMoveTerminalToProject,
			onPopoutProject,
			onTerminalActivityOverviewChange,
			onCommitProjectSidebar,
			onUpdateProject,
			popoutUrl,
			project,
			projects,
			terminalClientContext,
		},
		ref,
	) => {
		const [pendingGitFolderOpen, setPendingGitFolderOpen] = useState<{
			path: string;
			worktreeRoot: string;
		} | null>(null);
		recordBoundedRendererRender(
			`project-workspace:${project.id}`,
			`${terminalClientContext?.serverId ?? 'none'}:${terminalClientContext?.workspaceSnapshotStore?.snapshot?.revision ?? 'none'}:${project.rootFolder}`,
		);
		const featureAvailability = useMemo(
			() => resolveProjectFeatureAuthority(terminalClientContext, project.id),
			[
				project.id,
				terminalClientContext,
				terminalClientContext?.workspaceSnapshotStore?.snapshot?.revision,
			],
		);
		const featureAuthority =
			featureAvailability.state === 'available'
				? featureAvailability.authority
				: undefined;
		const explorerProjectRoot = featureProjectRoot(
			featureAvailability,
			project.rootFolder,
		);
		const explorerProject = useMemo(
			() =>
				explorerProjectRoot === project.rootFolder
					? project
					: { ...project, rootFolder: explorerProjectRoot },
			[explorerProjectRoot, project],
		);
		const terminalPanelClientContext =
			useMemo<TerminalPanelClientContextValue | null>(
				() =>
					terminalClientContext === undefined
						? null
						: composeProjectTerminalClientContext(
								terminalClientContext,
								project.id,
								project.rootFolder,
							),
				[project.id, project.rootFolder, terminalClientContext],
			);
		const serverActivityClient = terminalClientContext?.activityClient;
		// Agent status is a selected-server projection, not a project-environment
		// feature. A newly-created terminal can emit journal records before its
		// project feature snapshot is hydrated, so bind its presentation scope to
		// the canonical server client directly.
		const serverAgentStatusClient = terminalClientContext?.agentStatusClient;
		const serverMacroClient = useMemo(
			() =>
				terminalClientContext?.applicationClient === undefined
					? undefined
					: new MacroClient(
							new TerminayClientFacade(terminalClientContext.applicationClient),
						),
			[terminalClientContext?.applicationClient],
		);
		const mcpInstallClient = useMemo(
			() =>
				terminalClientContext?.applicationClient === undefined
					? undefined
					: createServerMcpInstallClient(
							terminalClientContext.applicationClient,
						),
			[terminalClientContext?.applicationClient],
		);
		const getServerTerminalCwd = useProjectTerminalCwd(
			terminalPanelClientContext,
		);
		const serverSettingsClient = useMemo(() => {
			if (terminalClientContext?.applicationClient === undefined)
				throw new Error('The selected server settings client is unavailable.');
			return createServerTerminalSettingsClient(
				new SettingsClient(
					new TerminayClientFacade(terminalClientContext.applicationClient),
				),
			);
		}, [terminalClientContext?.applicationClient]);
		const { settings, error: settingsError } =
			useTerminalSettings(serverSettingsClient);
		const serverFileViewerClient = featureAuthority?.fileViewerClient;
		const documentation = useDocumentationController({
			enabled: !project.isDocumentationPaneCollapsed,
			client: featureAuthority?.documentationClient,
			observationClient: featureAuthority?.fileObservationClient,
			projectId: project.id,
			scopeKey: featureAuthority?.scope.projectRoot ?? project.rootFolder,
			expandedFolderIds: project.expandedDocumentationFolderIds,
			onExpandedFolderIdsChange: (expandedDocumentationFolderIds) =>
				onUpdateProject(project.id, { expandedDocumentationFolderIds }),
		});
		const fileViewerClient = useMemo(
			() =>
				serverFileViewerClient ??
				unavailableFileViewerClient(
					featureAvailability.state === 'unavailable'
						? featureAvailability.reason
						: 'Explorer is unavailable on the selected server.',
				),
			[featureAvailability, serverFileViewerClient],
		);
		const fileClientPath = useCallback(
			(path: string) => getPathRelativeToRoot(path, explorerProjectRoot),
			[explorerProjectRoot],
		);
		const fileClientProjectId = project.id;
		const serverRecordingsClient = featureAuthority?.recordingsClient;
		const serverAiClient = useMemo(
			() =>
				terminalClientContext?.applicationClient === undefined
					? undefined
					: new TerminayAiClient(
							new TerminayClientFacade(terminalClientContext.applicationClient),
						),
			[terminalClientContext?.applicationClient],
		);
		const settingsRef = useRef(settings);
		useEffect(() => {
			settingsRef.current = settings;
		}, [settings]);
		const dockviewApiRef = useRef<DockviewApi | null>(null);
		const panelSessionMapRef = useRef<Map<string, string>>(new Map());
		const terminalContextReadersRef = useRef<
			Map<string, TerminalContextReader>
		>(new Map());
		const terminalControlStateRef = useRef(createTerminalControlState());
		const aiGenerationInFlightRef = useRef<Set<string>>(new Set());
		const movingTerminalSessionIdsRef = useRef<Set<string>>(new Set());
		const [isMcpInstallModalOpen, setIsMcpInstallModalOpen] = useState(false);
		const terminalActivityStoreRef = useRef(new TerminalActivityStore());
		const terminalActivityTimersRef = useRef<Map<string, number>>(new Map());
		const evaluateTerminalActivityStateRef = useRef<
			(sessionId: string, now?: number) => void
		>(() => {});
		const focusedSessionIdRef = useRef<string | null>(null);
		const filePathPanelMapRef = useRef<Map<string, string>>(new Map());
		const filePanelSaveHandlersRef = useRef<Map<string, FilePanelSaveHandler>>(
			new Map(),
		);
		const filePanelSaveRegistry = useMemo(
			() => ({
				register: (panelId: string, handler: FilePanelSaveHandler) => {
					filePanelSaveHandlersRef.current.set(panelId, handler);
					return () => {
						if (filePanelSaveHandlersRef.current.get(panelId) === handler)
							filePanelSaveHandlersRef.current.delete(panelId);
					};
				},
			}),
			[],
		);
		const folderPathPanelMapRef = useRef<Map<string, string>>(new Map());
		const terminalCounterRef = useRef(0);
		const filePanelCounterRef = useRef(0);
		const folderPanelCounterRef = useRef(0);
		const draggingTransferRef = useRef<{
			panelId?: string;
			groupId: string;
		} | null>(null);
		const workspaceRef = useRef<HTMLElement | null>(null);
		const isDockviewSashDraggingRef = useRef(false);
		const deferredTerminalActivitySessionIdsRef = useRef<Set<string>>(
			new Set(),
		);
		const deferredTerminalActivityFlushTimerRef = useRef<number | null>(null);
		const [errorText, setErrorText] = useState<string | null>(null);
		const featureFailureRef = useRef<
			import('./shared/featureQueryAuthority').VisibleFeatureFailure | null
		>(null);
		const reportFeatureFailure = useCallback(
			(feature: 'Explorer' | 'Agents' | 'Git' | 'Settings', error: unknown) => {
				if (featureAvailability.state === 'unavailable') {
					setErrorText(featureAvailability.reason);
					return featureAvailability.reason;
				}
				if (isCancelledFeatureFailure(error)) return '';
				if (isOptionalObservationFailure(error)) return '';
				const failure = describeFeatureFailure(
					feature,
					error,
					featureAvailability.authority.scope,
				);
				const message = `${failure.title}. ${failure.detail}`;
				featureFailureRef.current = { feature, message };
				setErrorText(message);
				return message;
			},
			[featureAvailability],
		);
		const clearFeatureFailure = useCallback((feature: 'Explorer' | 'Git') => {
			const failure = featureFailureRef.current;
			if (failure === null) return;
			setErrorText((current) => {
				const next = clearSucceededFeatureFailure(failure, feature, current);
				featureFailureRef.current = next;
				return next === null ? null : current;
			});
		}, []);
		useEffect(() => {
			if (settingsError !== null)
				reportFeatureFailure('Settings', settingsError);
		}, [reportFeatureFailure, settingsError]);
		const [focusedSessionId, setFocusedSessionId] = useState<string | null>(
			null,
		);
		const [terminalTitleRevision, setTerminalTitleRevision] = useState(0);
		const [isDockviewReady, setIsDockviewReady] = useState(false);
		// Dockview treats its component registries as configuration. Keep their
		// identities stable across ordinary workspace state changes (for example,
		// opening the Explorer) so it does not recreate the layout and orphan the
		// terminal-to-agent ownership map.
		const dockviewComponents = useMemo(
			() => ({
				file: FilePanel,
				folder: FolderPanel,
				terminal: TerminalPanel,
			}),
			[],
		);
		const dockviewTabComponents = useMemo(
			() => ({
				fileTab: FileTab,
				folderTab: FolderTab,
				terminalTab: TerminalTab,
			}),
			[],
		);
		const projectAgentItems = useMemo<AgentsSidebarItem[]>(() => {
			if (!settings.agentIntegration.enabled) {
				return [];
			}

			const terminalSessionIds = new Set<string>();
			const terminalTitlesBySession = new Map<string, string>();
			const dockviewApi = dockviewApiRef.current;
			for (const panel of dockviewApi?.panels ?? []) {
				const sessionId = panel.params?.sessionId;
				if (typeof sessionId !== 'string' || sessionId.length === 0) {
					continue;
				}
				terminalSessionIds.add(sessionId);
				// The index can lag during panel adoption/moves. Keep it in sync
				// from Dockview's live immutable terminal identity.
				panelSessionMapRef.current.set(panel.id, sessionId);
				const title =
					typeof panel.title === 'string' && panel.title.trim().length > 0
						? panel.title
						: panel.params?.title;
				if (typeof title === 'string' && title.trim()) {
					terminalTitlesBySession.set(sessionId, title.trim());
				}
			}
			const priority: Record<AgentState, number> = {
				blocked: 0,
				waiting: 1,
				working: 2,
				done: 3,
				idle: 4,
			};
			return [...terminalSessionIds]
				.flatMap((terminalSessionId) =>
					selectLiveAgentStatusesForTerminal(
						agentStatusSnapshot,
						terminalSessionId,
					),
				)
				.sort(
					(left, right) =>
						priority[left.state] - priority[right.state] ||
						right.updatedAt - left.updatedAt ||
						left.entryId.localeCompare(right.entryId),
				)
				.map((entry) => ({
					entry,
					projectId: project.id,
					model: entry.model?.displayName ?? entry.model?.id,
					prompt: entry.promptText,
					terminalTitle: terminalTitlesBySession.get(
						entry.activationTerminalSessionId,
					),
				}));
		}, [
			agentStatusSnapshot,
			focusedSessionId,
			isDockviewReady,
			project.id,
			settings.agentIntegration.enabled,
			terminalTitleRevision,
		]);

		useEffect(() => {
			terminalActivityStoreRef.current.configure(
				{
					amberDelayMs: settings.activityIndicators.amberDelaySeconds * 1000,
					greenDelayMs: settings.activityIndicators.greenDelaySeconds * 1000,
					tabSwitchSuppressionMs:
						settings.activityIndicators.tabSwitchSuppressionSeconds * 1000,
				},
				{ signalDetectionEnabled: settings.activityIndicators.signalDetection },
			);

			const now = Date.now();
			for (const sessionId of panelSessionMapRef.current.values()) {
				evaluateTerminalActivityStateRef.current(sessionId, now);
			}
		}, [
			settings.activityIndicators.amberDelaySeconds,
			settings.activityIndicators.greenDelaySeconds,
			settings.activityIndicators.tabSwitchSuppressionSeconds,
			settings.activityIndicators.signalDetection,
		]);

		const getProjectsForTerminalMove =
			useCallback((): TerminalTabMoveProject[] => {
				return projects
					.filter((candidate) => candidate.id !== project.id)
					.map((candidate) => ({
						emoji: candidate.emoji,
						id: candidate.id,
						title: candidate.title,
					}));
			}, [project.id, projects]);

		const getActiveSessionId = useCallback(() => {
			return getActiveTerminalSessionId(dockviewApiRef.current);
		}, []);

		const getPanelForSession = useCallback(
			(sessionId: string) =>
				findTerminalPanel(
					dockviewApiRef.current,
					panelSessionMapRef.current,
					sessionId,
				),
			[],
		);

		const { start: startDictation } = useDictationController({
			aiClient: serverAiClient,
			closeLauncher: () => {
				setIsMacroLauncherOpen(false);
				setMacroQuery('');
			},
			defaultLanguage: defaultTerminalSettings.dictation.language,
			focusTargetSession: (sessionId) => {
				const panel = getPanelForSession(sessionId);
				if (!panel) return;
				panel.api.setActive();
				focusedSessionIdRef.current = sessionId;
				setFocusedSessionId(sessionId);
				window.requestAnimationFrame(() => {
					window.dispatchEvent(
						new CustomEvent('terminay-focus-terminal', {
							detail: { sessionId },
						}),
					);
				});
			},
			getActiveSessionId,
			getOverlayTargets: () =>
				[...panelSessionMapRef.current.entries()].flatMap(
					([panelId, sessionId]) => {
						const panel = dockviewApiRef.current?.getPanel(panelId);
						return panel
							? [{ color: panel.params?.color ?? project.color, sessionId }]
							: [];
					},
				),
			getSettings: () => settingsRef.current.dictation,
			getDisclosure: () => {
				if (terminalClientContext === undefined) {
					throw new Error('The connected dictation server is unavailable.');
				}
				const provider = settingsRef.current.dictation.provider;
				return {
					audioDestination:
						provider === 'openai' ? 'openai' : 'selected-server',
					confirmed: true,
					credentialStatus: 'configured',
					provider,
					serverLabel:
						terminalClientContext.connectionLabel ??
						terminalClientContext.serverId,
				};
			},
			getTargetIdentity: (sessionId) => {
				const panel = getPanelForSession(sessionId);
				if (panel === null || terminalClientContext === undefined) {
					throw new Error('The connected dictation target is unavailable.');
				}
				return {
					serverId: terminalClientContext.serverId,
					projectId: project.id,
					panelId: panel.id,
					sessionId,
				};
			},
			hasTargetSession: (sessionId) => getPanelForSession(sessionId) !== null,
			openSettings: auxiliaryRoutes.openSettings,
			sendTerminalInput: sendTerminalPanelInput,
			setErrorText,
		});

		const getRecordingStartMetadataForSession = useCallback(
			(sessionId: string): TerminalRecordingStartMetadata => {
				const panel = getPanelForSession(sessionId);
				const params = panel?.params as TerminalPanelParams | undefined;
				const title =
					typeof panel?.title === 'string' && panel.title.trim().length > 0
						? panel.title
						: 'Terminal';

				return {
					color:
						typeof params?.color === 'string' ? params.color : project.color,
					emoji: typeof params?.emoji === 'string' ? params.emoji : '',
					inheritsProjectColor: params?.inheritsProjectColor === true,
					projectColor: project.color,
					projectEmoji: project.emoji,
					projectId: project.id,
					projectTitle: project.title,
					title,
				};
			},
			[
				getPanelForSession,
				project.color,
				project.emoji,
				project.id,
				project.title,
			],
		);

		const applyTerminalRecordingState = useCallback(
			(state: TerminalRecordingState) => {
				const panel = getPanelForSession(state.sessionId);
				if (!panel) {
					return;
				}

				panel.api.updateParameters({
					recordingError: state.errorMessage,
					recordingId:
						state.recordingId ??
						(panel.params as TerminalPanelParams | undefined)?.recordingId ??
						null,
					recordingStatus: state.status,
					titleUpdateNonce: Date.now(),
				});
			},
			[getPanelForSession],
		);

		const {
			hydrateRecordingStateForSession,
			revealRecording,
			startRecordingForSession,
			stopRecordingForSession,
		} = useTerminalRecordingController({
			applyState: applyTerminalRecordingState,
			getStartMetadata: getRecordingStartMetadataForSession,
			projectId: project.id,
			serverClient: serverRecordingsClient,
			setErrorText,
		});

		const getActivityOverviewItems =
			useCallback((): TerminalActivityOverviewItem[] => {
				const api = dockviewApiRef.current;
				if (!api) {
					return [];
				}

				const items: TerminalActivityOverviewItem[] = [];
				for (const group of api.groups) {
					for (const panel of group.panels) {
						const sessionId = panel.params?.sessionId;
						const agentState = panel.params?.agentState;
						if (settings.agentIntegration.enabled && sessionId && agentState) {
							const agentUnread = panel.params?.agentUnread === true;
							const shouldIncludeAgent =
								agentState === 'working' ||
								isAgentAttentionState(agentState) ||
								(agentState === 'done' && agentUnread);
							if (shouldIncludeAgent) {
								items.push({
									color: getEffectiveTerminalTabColor(
										panel.params,
										project.color,
									),
									emoji: panel.params?.emoji ?? '',
									panelId: panel.id,
									projectEmoji: project.emoji,
									projectId: project.id,
									projectTitle: project.title,
									sessionId,
									state: agentState,
									isAgentStatus: true,
									title: panel.title ?? 'Terminal',
								});
							}
							// Once a native lifecycle hook has claimed this terminal, raw
							// output activity must never compete with that authority.
							continue;
						}
						const state = panel.params?.terminalActivityState;
						if (
							!sessionId ||
							!isTerminalActivityIndicatorStateVisible(state, panel.params)
						) {
							continue;
						}

						items.push({
							color: getEffectiveTerminalTabColor(panel.params, project.color),
							emoji: panel.params?.emoji ?? '',
							panelId: panel.id,
							projectEmoji: project.emoji,
							projectId: project.id,
							projectTitle: project.title,
							sessionId,
							state,
							isAgentStatus: false,
							title: panel.title ?? 'Terminal',
						});
					}
				}

				return items;
			}, [
				project.color,
				project.emoji,
				project.id,
				project.title,
				settings.agentIntegration.enabled,
			]);

		const publishTerminalActivityOverview = useCallback(() => {
			onTerminalActivityOverviewChange(project.id, getActivityOverviewItems());
		}, [
			getActivityOverviewItems,
			onTerminalActivityOverviewChange,
			project.id,
		]);

		const registerTerminalContextReader = useCallback(
			(sessionId: string, reader: TerminalContextReader) => {
				terminalContextReadersRef.current.set(sessionId, reader);

				return () => {
					if (terminalContextReadersRef.current.get(sessionId) === reader) {
						terminalContextReadersRef.current.delete(sessionId);
					}
				};
			},
			[],
		);

		const {
			applyEvaluation: applyTerminalActivityEvaluation,
			clearDeferredTimer: clearDeferredTerminalActivityFlushTimer,
			evaluate: evaluateTerminalActivityState,
			markViewed: markTerminalActivityViewed,
			scheduleDeferredFlush: scheduleDeferredTerminalActivityFlush,
		} = useTerminalActivityController({
			acknowledgeAgent: (sessionId) => {
				if (!settingsRef.current.agentIntegration.enabled) return;
				void serverAgentStatusClient
					?.acknowledge({ projectId: project.id, sessionId })
					.catch(() => undefined);
			},
			acknowledgeServerActivity:
				serverActivityClient === undefined
					? undefined
					: (sessionId) => {
							void serverActivityClient
								.acknowledge(
									{ projectId: project.id, sessionId },
									{ fence: false },
								)
								.catch(() => undefined);
						},
			applyPanelState: (sessionId, state) => {
				const panel = getPanelForSession(sessionId);
				if (!panel || panel.params?.terminalActivityState === state)
					return false;
				panel.api.updateParameters({
					terminalActivityState: state,
					titleUpdateNonce: Date.now(),
				});
				return true;
			},
			deferredFlushMs: DOCKVIEW_SASH_ACTIVITY_DEFER_MS,
			deferredSessionsRef: deferredTerminalActivitySessionIdsRef,
			deferredTimerRef: deferredTerminalActivityFlushTimerRef,
			evaluateRef: evaluateTerminalActivityStateRef,
			getEvaluation: (sessionId, now) => {
				if (!getPanelForSession(sessionId)) return null;
				const snapshot =
					serverActivityClient?.store.snapshot.sessions[sessionId];
				return snapshot === undefined
					? terminalActivityStoreRef.current.evaluate(sessionId, now)
					: serverActivityEvaluation(snapshot);
			},
			isSashDraggingRef: isDockviewSashDraggingRef,
			markLocalViewed: (sessionId) =>
				terminalActivityStoreRef.current.markViewed(sessionId),
			onOverviewChanged: publishTerminalActivityOverview,
			timersRef: terminalActivityTimersRef,
		});

		useEffect(() => {
			let didChange = false;
			const enabled = settings.agentIntegration.enabled;
			const dockviewApi = dockviewApiRef.current;

			for (const panel of dockviewApi?.panels ?? []) {
				const sessionId = panel.params?.sessionId;
				if (typeof sessionId !== 'string' || sessionId.length === 0) {
					continue;
				}

				const aggregate = enabled
					? aggregateAgentStatusForTerminal(agentStatusSnapshot, sessionId)
					: null;
				const nextState = aggregate?.state;
				const nextNeedsAttention =
					nextState !== undefined && isAgentAttentionState(nextState);
				const nextUnread = aggregate?.unread === true;
				if (
					panel.params?.agentState === nextState &&
					panel.params?.agentNeedsAttention === nextNeedsAttention &&
					panel.params?.agentUnread === nextUnread
				) {
					continue;
				}

				panel.api.updateParameters({
					agentState: nextState,
					agentNeedsAttention: nextNeedsAttention,
					agentUnread: nextUnread,
				});
				didChange = true;
			}

			if (didChange) {
				window.requestAnimationFrame(publishTerminalActivityOverview);
			}
		}, [
			agentStatusSnapshot,
			isDockviewReady,
			publishTerminalActivityOverview,
			settings.agentIntegration.enabled,
			project.id,
			serverAgentStatusClient,
		]);

		const suppressInitialTerminalActivity = useCallback(
			(sessionId: string) => {
				if (serverActivityClient !== undefined) {
					return;
				}
				terminalActivityStoreRef.current.recordInitialSuppression(sessionId);
			},
			[serverActivityClient],
		);

		useEffect(() => {
			if (serverAgentStatusClient === undefined || !isDockviewReady) {
				return;
			}

			// Desktop can create an initial terminal before the workspace snapshot
			// observes it. This shared client serves every project view in the
			// window, so a project with no panels must not clear another project's
			// already-rendered server-owned agent projection.
			serverAgentStatusClient.mergeSessionScope([
				...new Set(panelSessionMapRef.current.values()),
			]);
		}, [focusedSessionId, isDockviewReady, serverAgentStatusClient]);

		useEffect(() => {
			if (serverActivityClient === undefined) {
				return;
			}
			// Activity revisions belong to one server authority. A replacement
			// connection (including a server restart) begins from a fresh snapshot;
			// clear the old panel indicators and control facts before applying it so
			// an empty replacement snapshot cannot leave stale attention behind.
			for (const sessionId of panelSessionMapRef.current.values()) {
				applyTerminalActivityEvaluation(sessionId, {
					state: 'viewed',
					nextDeadline: null,
				});
				clearTerminalControlActivity(
					terminalControlStateRef.current,
					sessionId,
				);
			}
			const applySnapshot = () => {
				for (const snapshot of Object.values(
					serverActivityClient.store.snapshot.sessions,
				)) {
					if (
						snapshot.projectId !== project.id ||
						!getPanelForSession(snapshot.sessionId)
					) {
						continue;
					}
					const isFocusedSession =
						isActive &&
						dockviewApiRef.current?.activePanel?.params?.sessionId ===
							snapshot.sessionId;
					if (isFocusedSession && !snapshot.acknowledged && !snapshot.claimed) {
						// PTY output can arrive after the tab-selection acknowledgement.
						// While this project and panel remain visibly active, fold it back
						// into canonical acknowledgement instead of showing a phantom item.
						applyTerminalActivityEvaluation(snapshot.sessionId, {
							state: 'viewed',
							nextDeadline: null,
						});
						markTerminalActivityViewed(snapshot.sessionId);
					} else {
						applyTerminalActivityEvaluation(
							snapshot.sessionId,
							serverActivityEvaluation(snapshot),
						);
					}
					const exitCode =
						typeof snapshot.exitCode === 'number' ? snapshot.exitCode : null;
					recordTerminalControlActivity(
						terminalControlStateRef.current,
						snapshot.sessionId,
						{
							status: snapshot.status,
							attention: snapshot.attention,
							exitCode,
							at: snapshot.updatedAt,
						},
					);
				}
			};
			applySnapshot();
			const unsubscribe = serverActivityClient.store.subscribe(() =>
				applySnapshot(),
			);
			void serverActivityClient.refresh().catch(() => undefined);
			return unsubscribe;
		}, [
			applyTerminalActivityEvaluation,
			getPanelForSession,
			isActive,
			markTerminalActivityViewed,
			project.id,
			serverActivityClient,
		]);

		useEffect(() => {
			if (isActive || serverActivityClient === undefined) return;
			const sessionId = dockviewApiRef.current?.activePanel?.params?.sessionId;
			if (typeof sessionId !== 'string' || sessionId.length === 0) return;
			const acknowledgeVisibleFallback = () => {
				const snapshot =
					serverActivityClient.store.snapshot.sessions[sessionId];
				if (snapshot !== undefined && !snapshot.claimed) {
					markTerminalActivityViewed(sessionId);
				}
			};
			// Leaving a project is the last point at which its active shell was
			// visibly observed. Clear only fallback shell noise here; structured
			// completion remains meaningful and may still surface as finished. Shell
			// foreground detection can settle just after the project switch, so fold
			// that final lifecycle update into the same viewing acknowledgement.
			acknowledgeVisibleFallback();
			const settleTimer = window.setTimeout(
				acknowledgeVisibleFallback,
				PROJECT_DEACTIVATION_ACTIVITY_SETTLE_MS,
			);
			return () => window.clearTimeout(settleTimer);
		}, [isActive, markTerminalActivityViewed, serverActivityClient]);

		const focusActiveTerminal = useCallback(() => {
			const terminalPanel = findTerminalFocusTarget({
				api: dockviewApiRef.current,
				focusedSessionId: focusedSessionIdRef.current,
				panelSessions: panelSessionMapRef.current,
			});
			const sessionId = terminalPanel?.params?.sessionId ?? null;
			if (!terminalPanel || !sessionId) {
				return;
			}

			terminalPanel.api.setActive();
			focusedSessionIdRef.current = sessionId;
			setFocusedSessionId(sessionId);
			markTerminalActivityViewed(sessionId);
			window.requestAnimationFrame(() => {
				window.dispatchEvent(
					new CustomEvent('terminay-focus-terminal', {
						detail: { sessionId },
					}),
				);
			});
		}, [markTerminalActivityViewed]);

		const {
			cancelRun: cancelMacroRun,
			cancelSessionRuns: cancelMacroRunsForSession,
			clearFinishedSessionRuns: clearFinishedMacroRunsForSession,
			clearRun: clearMacroRunForSession,
			clearSessionRuns: clearMacroRunsForSession,
			executeMacro: executeMacroRun,
			replaceSessionRuns: replaceMacroRunsForSession,
			runningMacroRunsBySession,
		} = useMacroRunController({
			focusActiveTerminal,
			getActiveSessionId,
			getDecryptedSecret: async () => {
				throw new Error('Macro secrets are resolved by the selected server.');
			},
			sendInput: sendTerminalPanelInput,
			setErrorText,
			waitForInactivity: waitForSessionInactivity,
			serverMacroClient,
			serverTargetForSession: (sessionId) => ({
				serverId: terminalClientContext?.serverId ?? 'desktop-local',
				projectId: project.id,
				sessionId,
			}),
		});

		const activateTerminal = useCallback(
			(panelId: string, sessionId: string) => {
				const panel = activateTerminalPanel({
					api: dockviewApiRef.current,
					panelId,
					sessionId,
				});
				if (!panel) {
					return;
				}
				focusedSessionIdRef.current = sessionId;
				setFocusedSessionId(sessionId);
				markTerminalActivityViewed(sessionId);
				setErrorText(null);
				window.requestAnimationFrame(() => {
					window.dispatchEvent(
						new CustomEvent('terminay-focus-terminal', {
							detail: { sessionId },
						}),
					);
				});
			},
			[markTerminalActivityViewed],
		);
		const activateAgentTerminal = useCallback(
			(terminalSessionId: string) => {
				const panel = getPanelForSession(terminalSessionId);
				if (!panel) {
					return;
				}
				activateTerminal(panel.id, terminalSessionId);
			},
			[activateTerminal, getPanelForSession],
		);

		const syncPanelFocusState = useCallback(() => {
			const api = dockviewApiRef.current;
			if (!api) {
				return;
			}

			const activePanelId = api.activePanel?.id ?? null;

			for (const group of api.groups) {
				for (const panel of group.panels) {
					panel.api.updateParameters({
						...panel.params,
						isFocused: panel.id === activePanelId,
					});
				}
			}
		}, []);

		const openFile = useCallback(
			async (filePath: string, options?: OpenFileOptions) => {
				const api = dockviewApiRef.current;
				if (!api) {
					return;
				}

				const existingPanelId = filePathPanelMapRef.current.get(filePath);
				if (existingPanelId) {
					const existingPanel = api.getPanel(existingPanelId);
					if (existingPanel) {
						if (
							existingPanel.params?.presentation === 'documentation' &&
							options?.presentation === 'file-viewer'
						) {
							const flush = filePanelSaveHandlersRef.current.get(
								existingPanel.id,
							);
							if (flush !== undefined) {
								try {
									await flush();
								} catch {
									return;
								}
							}
						}
						if (
							options?.presentation &&
							existingPanel.params?.presentation !== options.presentation
						) {
							existingPanel.api.updateParameters({
								...(existingPanel.params ?? {}),
								presentation: options.presentation,
							});
						}
						if (options?.initialMode) {
							existingPanel.api.updateParameters({
								...existingPanel.params,
								initialMode: options.initialMode,
							});
						}
						existingPanel.api.setActive();
						syncPanelFocusState();
						if (options?.initialMode) {
							window.requestAnimationFrame(() => {
								window.dispatchEvent(
									new CustomEvent('terminay-file-mode-request', {
										detail: {
											mode: options.initialMode,
											path: filePath,
										},
									}),
								);
							});
						}
						return;
					}
				}

				filePanelCounterRef.current += 1;
				const panelId = `file-${filePanelCounterRef.current}`;
				const title = filePath.split(/[/\\]/).pop() || filePath;

				const panel = api.addPanel<FilePanelInstanceParams>({
					component: 'file',
					id: panelId,
					params: {
						color: project.color,
						filePath,
						presentation: options?.presentation ?? 'file-viewer',
						initialMode: options?.initialMode,
						inheritsProjectColor: true,
						isFocused: false,
						preferredEngine: 'auto',
						projectColor: project.color,
						projectRoot: project.rootFolder,
					},
					position: api.activePanel
						? {
								direction: 'within',
								referenceGroup: api.activePanel.group.id,
							}
						: undefined,
					tabComponent: 'fileTab',
					title,
				});

				filePathPanelMapRef.current.set(filePath, panel.id);
				panel.api.setActive();
				syncPanelFocusState();
			},
			[project.color, project.rootFolder, syncPanelFocusState],
		);
		useEffect(() => {
			const openDocumentationLink = (event: Event) => {
				const path = (event as CustomEvent<{ path?: unknown }>).detail?.path;
				if (
					typeof path !== 'string' ||
					!path ||
					path.startsWith('/') ||
					path.includes('\\') ||
					path.split('/').some((part) => !part || part === '.' || part === '..')
				)
					return;
				void openFile(path, { presentation: 'documentation' });
			};
			window.addEventListener(
				'terminay-documentation-open',
				openDocumentationLink,
			);
			return () =>
				window.removeEventListener(
					'terminay-documentation-open',
					openDocumentationLink,
				);
		}, [openFile]);

		const handleOpenTerminalAt = useCallback(
			async (path: string, isDirectory = false) => {
				const api = dockviewApiRef.current;
				if (!api) {
					return;
				}

				let cwd = path;
				if (!isDirectory) {
					// If it's a file, get the parent directory.
					try {
						const clientPath = fileClientPath(path);
						const info = await fileViewerClient.listFolder(
							clientPath,
							fileClientProjectId,
						);
						if (info.root !== clientPath) {
							cwd = path.substring(
								0,
								Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')),
							);
						}
					} catch {
						cwd = path.substring(
							0,
							Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')),
						);
					}
				}

				try {
					if (terminalPanelClientContext === null) {
						throw new Error('The server terminal client is unavailable.');
					}
					const sessionId = (
						await terminalPanelClientContext.client.create({
							cwd,
							projectId: project.id,
						})
					).sessionId;
					suppressInitialTerminalActivity(sessionId);
					if (settings.recording.recordNewTerminals) {
						void startRecordingForSession(sessionId);
					} else {
						hydrateRecordingStateForSession(sessionId);
					}
					const synchronized =
						await terminalPanelClientContext.workspaceSnapshotStore?.waitForSnapshot(
							(snapshot) => hasTerminalPresentation(snapshot, sessionId),
						);
					if (synchronized === null) {
						throw new Error(
							'Server did not publish a terminal panel for the created session.',
						);
					}
					const startedAt = performance.now();
					await new Promise<void>((resolve) => {
						const activateServerPanel = () => {
							const reconciledPanel = getPanelForSession(sessionId);
							if (reconciledPanel !== null) {
								reconciledPanel.api.setActive();
								setFocusedSessionId(sessionId);
								scheduleCreatedTerminalFocus(sessionId);
								window.requestAnimationFrame(publishTerminalActivityOverview);
								resolve();
								return;
							}
							if (performance.now() - startedAt >= 2_000) {
								resolve();
								return;
							}
							window.requestAnimationFrame(activateServerPanel);
						};
						activateServerPanel();
					});
				} catch (error) {
					setErrorText(`Failed to open terminal: ${String(error)}`);
				}
			},
			[
				fileClientPath,
				fileClientProjectId,
				fileViewerClient,
				getPanelForSession,
				project.id,
				publishTerminalActivityOverview,
				hydrateRecordingStateForSession,
				settings.recording.recordNewTerminals,
				startRecordingForSession,
				terminalPanelClientContext,
				suppressInitialTerminalActivity,
			],
		);

		const {
			cancelFileExplorerNameDialog,
			currentGitBranch,
			deletingWorktreePaths,
			directoryChildren,
			directoryErrors,
			expandedPaths,
			fileExplorerNameDialog,
			gitStatuses,
			handleCopyPath,
			handleCopyRelativePath,
			handleDelete,
			handleDeleteWorktree,
			handleNewFile,
			handleNewFolder,
			handleOpenGitEntry,
			handleOpenTerminalAtWorktree,
			handlePullWorktreeFromOrigin,
			handleRename,
			handleRenameWorktree,
			handleRevealWorktree,
			handleSwitchProjectRootToWorktree,
			loadingPaths,
			refreshFileExplorerTree,
			refreshGitStatusesForRoot,
			submitFileExplorerNameDialog,
			toggleDirectory,
			worktreePanelStatus,
		} = useFileExplorerController({
			fileObservationClient: featureAuthority?.fileObservationClient,
			fileViewerClient,
			gitClient: featureAuthority?.gitClient,
			isServerFileViewer: true,
			onOpenFile: openFile,
			onOpenTerminalAt: handleOpenTerminalAt,
			onOperationError: reportFeatureFailure,
			onOperationSucceeded: clearFeatureFailure,
			onSetError: setErrorText,
			onUpdateProject,
			project: explorerProject,
		});
		const openFolder = useCallback(
			(folderPath: string) => {
				const api = dockviewApiRef.current;
				if (!api) {
					return;
				}

				const existingPanelId = folderPathPanelMapRef.current.get(folderPath);
				if (existingPanelId) {
					const existingPanel = api.getPanel(existingPanelId);
					if (existingPanel) {
						existingPanel.api.setActive();
						syncPanelFocusState();
						return;
					}
				}

				folderPanelCounterRef.current += 1;
				const panelId = `folder-${folderPanelCounterRef.current}`;
				const title =
					folderPath.split(/[/\\]/).filter(Boolean).pop() || folderPath;

				const panel = api.addPanel<
					FolderPanelInstanceParams & {
						onRename?: (path: string) => void;
						onDelete?: (path: string) => void;
						onNewFile?: (dirPath: string) => void;
						onNewFolder?: (dirPath: string) => void;
						onOpenTerminal?: (path: string) => void;
						onCopyPath?: (path: string) => void;
						onCopyRelativePath?: (path: string) => void;
						projectRootPath?: string;
					}
				>({
					component: 'folder',
					id: panelId,
					params: {
						color: project.color,
						folderPath,
						inheritsProjectColor: true,
						isFocused: false,
						onRename: handleRename,
						onDelete: handleDelete,
						onNewFile: handleNewFile,
						onNewFolder: handleNewFolder,
						onOpenTerminal: handleOpenTerminalAt,
						onCopyPath: handleCopyPath,
						onCopyRelativePath: handleCopyRelativePath,
						projectColor: project.color,
						projectId: project.id,
						projectRootPath: project.rootFolder,
					},
					position: api.activePanel
						? {
								direction: 'within',
								referenceGroup: api.activePanel.group.id,
							}
						: undefined,
					tabComponent: 'folderTab',
					title,
				});

				folderPathPanelMapRef.current.set(folderPath, panel.id);
				panel.api.setActive();
				syncPanelFocusState();
			},
			[
				handleDelete,
				handleCopyPath,
				handleCopyRelativePath,
				handleNewFile,
				handleNewFolder,
				handleOpenTerminalAt,
				handleRename,
				project.color,
				project.rootFolder,
				syncPanelFocusState,
			],
		);
		const handleOpenGitFolder = useCallback(
			(folderPath: string, worktreeRoot: string) => {
				if (worktreeRoot !== project.rootFolder) {
					setPendingGitFolderOpen({ path: folderPath, worktreeRoot });
					onUpdateProject(project.id, { rootFolder: worktreeRoot });
					return;
				}
				openFolder(folderPath);
			},
			[onUpdateProject, openFolder, project.id, project.rootFolder],
		);
		useEffect(() => {
			if (
				pendingGitFolderOpen === null ||
				project.rootFolder !== pendingGitFolderOpen.worktreeRoot
			) {
				return;
			}
			openFolder(pendingGitFolderOpen.path);
			setPendingGitFolderOpen(null);
		}, [openFolder, pendingGitFolderOpen, project.rootFolder]);

		const setProjectRootFolderToWorkingDirectory = useCallback(async () => {
			const sessionId = getActiveSessionId();
			if (!sessionId) {
				setErrorText(
					'Open a terminal before setting the project root to its working directory.',
				);
				return;
			}

			try {
				const cwd = await getServerTerminalCwd(sessionId);
				if (!cwd) {
					setErrorText(
						'The active terminal does not have a working directory yet.',
					);
					return;
				}

				const nextRootFolder = cwd.trim();

				if (!nextRootFolder) {
					setErrorText(
						'The active terminal does not have a working directory yet.',
					);
					return;
				}

				const workspaceSnapshotStore =
					terminalPanelClientContext?.workspaceSnapshotStore;
				if (workspaceSnapshotStore === undefined) {
					onUpdateProject(project.id, { rootFolder: nextRootFolder });
					void refreshGitStatusesForRoot(nextRootFolder, true);
				} else {
					const committed = await workspaceSnapshotStore.setProjectRoot({
						projectId: project.id,
						root: nextRootFolder,
					});
					void refreshGitStatusesForRoot(committed.root, true);
				}
				setErrorText(null);
				setIsMacroLauncherOpen(false);
				setMacroQuery('');
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setErrorText(`Unable to set the project root folder: ${message}`);
			}
		}, [
			getActiveSessionId,
			getServerTerminalCwd,
			onUpdateProject,
			project.id,
			refreshGitStatusesForRoot,
			terminalPanelClientContext?.workspaceSnapshotStore,
		]);

		const executeMacro = useCallback(
			async (
				macro: MacroDefinition,
				values: Record<string, MacroFieldValue>,
			) => {
				setMacroToRun(null);
				setMacroFieldValues({});
				setMacroFileSearchRootPath('');
				setIsMacroLauncherOpen(false);
				setMacroQuery('');
				setSelectedMacroIndex(0);
				await executeMacroRun(macro, values);
			},
			[executeMacroRun],
		);

		const {
			closeMacroLauncher,
			closeMacroParameterModal,
			firstMacroFieldRef,
			isMacroLauncherOpen,
			macroFieldValues,
			macroFileSearchRootPath,
			macroLauncherInputRef,
			macroLauncherItemRefs,
			macroLauncherListRef,
			macroQuery,
			macroToRun,
			runMacro,
			selectedMacroIndex,
			setIsMacroLauncherOpen,
			setMacroFieldValues,
			setMacroFileSearchRootPath,
			setMacroQuery,
			setMacroToRun,
			setSelectedMacroIndex,
			validateMacroValues,
		} = useMacroLauncherController({
			executeMacro,
			focusActiveTerminal,
			getActiveSessionId,
			getServerTerminalCwd,
			projectRoot: project.rootFolder,
			setErrorText,
		});
		const shellProfilesClient = useMemo(
			() =>
				terminalPanelClientContext?.applicationClient === undefined
					? null
					: new ShellProfilesClient(
							new TerminayClientFacade(
								terminalPanelClientContext.applicationClient,
							),
						),
			[terminalPanelClientContext?.applicationClient],
		);
		const [profileChooserEntries, setProfileChooserEntries] = useState<
			readonly ShellProfileCatalogueEntry[] | null
		>(null);
		const [profileChooserQuery, setProfileChooserQuery] = useState('');
		const profileChooserRef = useRef<HTMLDivElement>(null);
		const profileChooserSearchRef = useRef<HTMLInputElement>(null);
		const profileChooserReturnFocusRef = useRef<HTMLElement | null>(null);
		const openProfileChooser = useCallback(async () => {
			if (!shellProfilesClient) {
				setErrorText('Shell profiles are unavailable on this server.');
				return;
			}
			profileChooserReturnFocusRef.current =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;
			setIsMacroLauncherOpen(false);
			setMacroQuery('');
			try {
				const catalogue = await shellProfilesClient.catalogue();
				setProfileChooserEntries(
					catalogue.entries.filter((entry) => entry.availability.available),
				);
				setProfileChooserQuery('');
				setErrorText(null);
			} catch (error) {
				setErrorText(
					`Unable to load shell profiles: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}, [setIsMacroLauncherOpen, setMacroQuery, shellProfilesClient]);
		const filteredProfileChooserEntries = useMemo(() => {
			const normalized = profileChooserQuery.trim().toLocaleLowerCase();
			return (profileChooserEntries ?? []).filter(
				(entry) =>
					!normalized ||
					`${entry.name} ${entry.source}`
						.toLocaleLowerCase()
						.includes(normalized),
			);
		}, [profileChooserEntries, profileChooserQuery]);
		useEffect(() => {
			if (profileChooserEntries === null) return;
			const focusFrame = window.requestAnimationFrame(() => {
				profileChooserSearchRef.current?.focus();
			});
			const onKeyDown = (event: KeyboardEvent) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					setProfileChooserEntries(null);
					return;
				}
				if (event.key !== 'Tab') return;
				const focusable = [
					...(profileChooserRef.current?.querySelectorAll<HTMLElement>(
						'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
					) ?? []),
				].filter((element) => element.offsetParent !== null);
				if (focusable.length === 0) return;
				const first = focusable[0]!;
				const last = focusable[focusable.length - 1]!;
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault();
					last.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first.focus();
				}
			};
			window.addEventListener('keydown', onKeyDown);
			return () => {
				window.cancelAnimationFrame(focusFrame);
				window.removeEventListener('keydown', onKeyDown);
				const target = profileChooserReturnFocusRef.current;
				profileChooserReturnFocusRef.current = null;
				window.requestAnimationFrame(() =>
					target?.isConnected &&
					target.offsetParent !== null &&
					target.closest(
						'[aria-hidden="true"], [inert], .macro-launcher-overlay',
					) === null
						? target.focus()
						: focusActiveTerminal(),
				);
			};
		}, [focusActiveTerminal, profileChooserEntries]);
		const {
			isOpen: isTerminalSwitcherOpen,
			items: terminalSwitcherItems,
			select: selectTerminalSwitcherItem,
			selectAndCommit: selectAndCommitTerminalSwitcherItem,
			selectedIndex: terminalSwitcherIndex,
		} = useTerminalSwitcherController({
			apiRef: dockviewApiRef,
			blocked: isMacroLauncherOpen || macroToRun !== null,
			isActive,
			onClearError: () => setErrorText(null),
		});
		const macroParameterModal = useDraggableModal(macroToRun !== null);
		const fileExplorerNameModal = useDraggableModal(
			fileExplorerNameDialog !== null,
		);

		const syncFocusedTerminalTabs = useCallback((sessionId: string | null) => {
			const api = dockviewApiRef.current;
			if (!api) {
				return;
			}

			for (const [
				panelId,
				panelSessionId,
			] of panelSessionMapRef.current.entries()) {
				const panel = api.getPanel(panelId);
				if (!panel) {
					continue;
				}

				const isFocused = panelSessionId === sessionId;
				if (panel.params?.isFocused === isFocused) {
					continue;
				}

				panel.api.updateParameters({ isFocused });
			}
		}, []);

		const syncRunningMacroTabs = useCallback(() => {
			const api = dockviewApiRef.current;
			if (!api) {
				return;
			}

			for (const [
				panelId,
				panelSessionId,
			] of panelSessionMapRef.current.entries()) {
				const panel = api.getPanel(panelId);
				if (!panel) {
					continue;
				}

				panel.api.updateParameters({
					macroRuns: runningMacroRunsBySession[panelSessionId] ?? [],
					onClearFinishedMacroRuns: () =>
						clearFinishedMacroRunsForSession(panelSessionId),
					onClearMacroRun: (runId: string) =>
						clearMacroRunForSession(panelSessionId, runId),
					onCancelMacroRun: cancelMacroRun,
					onMoveToProject: (targetProjectId: string) =>
						onMoveTerminalToProject(project.id, panelId, targetProjectId),
					projectsForMove: getProjectsForTerminalMove(),
				});
			}
		}, [
			cancelMacroRun,
			clearFinishedMacroRunsForSession,
			clearMacroRunForSession,
			getProjectsForTerminalMove,
			onMoveTerminalToProject,
			project.id,
			runningMacroRunsBySession,
		]);

		useEffect(() => {
			const api = dockviewApiRef.current;

			for (const group of api?.groups ?? []) {
				for (const panel of group.panels) {
					const params = panel.params as DockPanelTabAppearance | undefined;
					if (!params || !('inheritsProjectColor' in params)) {
						continue;
					}

					const inheritsProjectColor = params.inheritsProjectColor === true;
					panel.api.updateParameters({
						projectColor: project.color,
						...(inheritsProjectColor ? { color: project.color } : {}),
					});
				}
			}

			window.requestAnimationFrame(publishTerminalActivityOverview);
		}, [
			project.id,
			project.title,
			project.emoji,
			project.color,
			publishTerminalActivityOverview,
		]);

		useEffect(() => {
			const api = dockviewApiRef.current;
			if (!api) {
				return;
			}

			for (const [panelId] of panelSessionMapRef.current.entries()) {
				const panel = api.getPanel(panelId);
				if (!panel) {
					continue;
				}

				panel.api.updateParameters({
					showActiveTabActivityIndicator:
						settings.activityIndicators.showActiveTabs,
					showFinishedTabActivityIndicator:
						settings.activityIndicators.showFinishedTabs,
				});
			}

			window.requestAnimationFrame(publishTerminalActivityOverview);
		}, [
			publishTerminalActivityOverview,
			settings.activityIndicators.showActiveTabs,
			settings.activityIndicators.showFinishedTabs,
		]);

		const openTerminalEditWindow = useCallback(
			async (panelId: string) => {
				const api = dockviewApiRef.current;
				if (!api) {
					return;
				}

				const panel = api.getPanel(panelId);
				if (!panel) {
					return;
				}

				const sessionId = panel.params?.sessionId ?? null;

				try {
					const result = await auxiliaryRoutes.editTerminalTab({
						kind: 'terminal',
						draft: {
							activityIndicatorsEnabled: areTerminalActivityIndicatorsEnabled(
								panel.params,
							),
							color: getEffectiveTerminalTabColor(panel.params, project.color),
							emoji: panel.params?.emoji ?? '',
							inheritsProjectColor:
								panel.params?.inheritsProjectColor ??
								panel.params?.color === project.color,
							projectColor: project.color,
							title: panel.title ?? 'Tab',
						},
					});
					if (!result) {
						return;
					}

					const nextTitle =
						result.title.trim().length > 0
							? result.title.trim()
							: (panel.title ?? 'Tab');
					const nextEmoji = result.emoji.trim();
					const nextColor = result.color;
					const workspaceStore = terminalClientContext?.workspaceSnapshotStore;
					if (workspaceStore !== undefined) {
						await workspaceStore.updatePanel({
							panelId,
							patch: {
								title: nextTitle,
								emoji: nextEmoji,
								color: nextColor,
								inheritsProjectColor: result.inheritsProjectColor,
								activityIndicatorsEnabled: result.activityIndicatorsEnabled,
							},
						});
					}

					panel.api.setTitle(nextTitle);
					setTerminalTitleRevision((revision) => revision + 1);
					panel.api.updateParameters({
						activityIndicatorsEnabled: result.activityIndicatorsEnabled,
						emoji: nextEmoji,
						color: nextColor,
						inheritsProjectColor: result.inheritsProjectColor,
						projectColor: project.color,
					});

					window.requestAnimationFrame(publishTerminalActivityOverview);
				} finally {
					window.requestAnimationFrame(() => {
						if (sessionId) {
							activateTerminal(panelId, sessionId);
							return;
						}

						focusActiveTerminal();
					});
				}
			},
			[
				activateTerminal,
				auxiliaryRoutes,
				focusActiveTerminal,
				project.color,
				project.id,
				project.title,
				project.emoji,
				publishTerminalActivityOverview,
				terminalClientContext?.workspaceSnapshotStore,
			],
		);

		const clearActiveTerminal = useCallback(() => {
			const sessionId = getActiveSessionId();
			if (!sessionId) {
				setErrorText('Open a terminal before clearing it.');
				return;
			}

			setErrorText(null);
			window.dispatchEvent(
				new CustomEvent('terminay-clear-terminal', {
					detail: { sessionId },
				}),
			);
			setIsMacroLauncherOpen(false);
			setMacroQuery('');
		}, [getActiveSessionId]);

		const copyActiveTerminalSelection = useCallback(() => {
			const sessionId = getActiveSessionId();
			if (!sessionId) {
				document.execCommand('copy');
				return;
			}

			window.dispatchEvent(
				new CustomEvent('terminay-copy-terminal', {
					detail: { sessionId },
				}),
			);
		}, [getActiveSessionId]);

		const openActiveTerminalSettings = useCallback(() => {
			const activePanel = dockviewApiRef.current?.activePanel;
			if (!activePanel) {
				setErrorText('Open a tab before editing its settings.');
				return;
			}

			setErrorText(null);
			setIsMacroLauncherOpen(false);
			setMacroQuery('');
			void openTerminalEditWindow(activePanel.id);
		}, [openTerminalEditWindow]);

		const openProjectSettings = useCallback(() => {
			setErrorText(null);
			setIsMacroLauncherOpen(false);
			setMacroQuery('');
			void onEditProject(project.id);
		}, [onEditProject, project.id]);

		const runAiTabMetadata = useCallback(
			async (target: AiTabMetadataTarget, targetPanelId?: string) => {
				setIsMacroLauncherOpen(false);
				setMacroQuery('');

				const api = dockviewApiRef.current;
				const activePanel = targetPanelId
					? api?.getPanel(targetPanelId)
					: api?.activePanel;
				const sessionId = activePanel?.params?.sessionId;
				if (!activePanel || !sessionId) {
					setErrorText('Open a terminal before generating tab metadata.');
					return;
				}

				const targetSettings = settings.aiTabMetadata[target];
				if (targetSettings.provider === 'disabled') {
					setErrorText(
						`Enable an AI provider for tab ${target === 'title' ? 'titles' : 'notes'} in Settings first.`,
					);
					return;
				}

				const provider = targetSettings.provider;
				const providerLabel = provider === 'codex' ? 'Codex' : 'Claude Code';
				const model =
					provider === 'codex'
						? targetSettings.codexModel
						: targetSettings.claudeCodeModel;
				if (!model.trim()) {
					setErrorText(
						`Choose a ${providerLabel} model in Settings before generating tab metadata.`,
					);
					return;
				}

				const inFlightKey = `${sessionId}:${target}`;
				if (aiGenerationInFlightRef.current.has(inFlightKey)) {
					setErrorText(`Already generating a tab ${target} for this terminal.`);
					return;
				}

				const previousTitle = activePanel.title ?? 'Terminal';
				aiGenerationInFlightRef.current.add(inFlightKey);
				setErrorText(null);
				if (target === 'title') {
					activePanel.api.setTitle('Generating...');
					setTerminalTitleRevision((revision) => revision + 1);
					activePanel.api.updateParameters({ titleUpdateNonce: Date.now() });
				}

				try {
					if (
						serverAiClient === undefined ||
						terminalClientContext === undefined
					)
						throw new Error(
							'AI metadata is unavailable on the selected server.',
						);
					const result = await serverAiClient.generateMetadata({
						model,
						provider: provider === 'claudeCode' ? 'claude-code' : provider,
						requestId: crypto.randomUUID(),
						target: {
							panelId: activePanel.id,
							projectId: project.id,
							serverId: terminalClientContext.serverId,
							sessionId,
						},
						targetType: target === 'title' ? 'title' : 'note',
					});
					const text =
						typeof result === 'object' &&
						result !== null &&
						!Array.isArray(result) &&
						typeof result.text === 'string'
							? result.text.trim()
							: '';
					if (!text) {
						throw new Error(`${providerLabel} returned an empty result.`);
					}

					if (target === 'title') {
						activePanel.api.setTitle(text);
						setTerminalTitleRevision((revision) => revision + 1);
						activePanel.api.updateParameters({ titleUpdateNonce: Date.now() });
						window.requestAnimationFrame(publishTerminalActivityOverview);
					} else {
						activePanel.api.updateParameters({ terminalNote: text });
					}

					setErrorText(null);
				} catch (error) {
					if (target === 'title') {
						activePanel.api.setTitle(previousTitle);
						setTerminalTitleRevision((revision) => revision + 1);
						activePanel.api.updateParameters({ titleUpdateNonce: Date.now() });
					}
					const message =
						error instanceof Error ? error.message : String(error);
					setErrorText(`Unable to generate tab ${target}: ${message}`);
				} finally {
					aiGenerationInFlightRef.current.delete(inFlightKey);
				}
			},
			[
				project.color,
				project.emoji,
				project.id,
				project.rootFolder,
				project.title,
				serverAiClient,
				publishTerminalActivityOverview,
				settings.aiTabMetadata,
			],
		);

		const runAiTabMetadataRef = useRef(runAiTabMetadata);
		runAiTabMetadataRef.current = runAiTabMetadata;

		const createProject = useCallback(async () => {
			setErrorText(null);
			setIsMacroLauncherOpen(false);
			setMacroQuery('');
			await onAddProject();
		}, [onAddProject]);

		const toggleFileExplorerSidebar = useCallback(() => {
			setErrorText(null);
			setIsMacroLauncherOpen(false);
			setMacroQuery('');
			onUpdateProject(project.id, {
				isFileExplorerOpen: !project.isFileExplorerOpen,
			});
		}, [onUpdateProject, project.id, project.isFileExplorerOpen]);

		const addTerminal = useTerminalCreationController({
			apiRef: dockviewApiRef,
			createSession:
				terminalPanelClientContext === null
					? null
					: async (request) => {
							const session =
								await terminalPanelClientContext.client.create(request);
							// Admit the immutable server session before the creation command
							// resolves. Journal records may arrive as soon as the server creates
							// the PTY, before a focus-driven React effect observes its panel.
							serverAgentStatusClient?.mergeSessionScope([session.sessionId]);
							return session;
						},
			hydrateRecording: hydrateRecordingStateForSession,
			onError: setErrorText,
			projectId: project.id,
			recordNewTerminals: settings.recording.recordNewTerminals,
			sendInput: sendTerminalPanelInput,
			startRecording: startRecordingForSession,
			splitPanel:
				terminalPanelClientContext?.workspaceSnapshotStore === undefined
					? undefined
					: (request) =>
							terminalPanelClientContext.workspaceSnapshotStore!.splitPanel(
								request,
							),
			suppressInitialActivity: suppressInitialTerminalActivity,
			waitForCreatedTerminal:
				terminalPanelClientContext === null
					? undefined
					: async (sessionId) =>
							(await terminalPanelClientContext.workspaceSnapshotStore?.waitForSnapshot(
								(snapshot) => hasTerminalPresentation(snapshot, sessionId),
							)) !== null,
		});

		const runGitPushAgent = useCallback(
			(action: GitPushAgentAction, target: GitPushMenuTarget) => {
				const config = settings.gitPushAgent;
				if (config.provider === 'disabled') return;

				const actionMeta = GIT_PUSH_AGENT_ACTIONS.find(
					(entry) => entry.action === action,
				);
				if (!actionMeta) {
					return;
				}

				const task =
					actionMeta.action === 'default'
						? `Commit all of my current changes onto the default branch "${formatGitPushBranchLabel(target.defaultBranch ?? 'main')}" and push it. If that branch is already checked out in another worktree, make the commit from that worktree instead of checking it out here.`
						: actionMeta.task;
				const model =
					config.provider === 'claudeCode'
						? config.claudeCodeModel
						: config.codexModel;
				const prompt = buildGitPushAgentPrompt(
					config.prompt,
					task,
					target.branch,
					target.defaultBranch,
				);
				const command = buildGitPushAgentCommand(
					config.provider,
					model,
					prompt,
				);

				void addTerminal({
					cwd: target.cwd,
					title: 'Push agent',
					initialInput: command,
				});
			},
			[addTerminal, settings.gitPushAgent],
		);

		const {
			closeGitPushMenu,
			gitPushMenuPosition,
			handleOpenWorktreePushMenu,
			launchGitPushAgent,
		} = useGitPushMenuController({
			defaultBranch: worktreePanelStatus?.defaultBranch,
			isAgentEnabled: settings.gitPushAgent.provider !== 'disabled',
			onDisabled: () => {
				setErrorText(
					'Choose a Git Push agent in Settings → AI → Git Push Agent first.',
				);
				void auxiliaryRoutes.openSettings('git-push-agent');
			},
			onLaunchAgent: runGitPushAgent,
		});

		const exportTerminalForMove = useCallback(
			(panelId: string): MovedTerminalTab | null =>
				exportTerminalPresentationForMove({
					api: dockviewApiRef.current,
					context: {
						defaultServerProjectId: terminalPanelClientContext?.projectId,
						runningMacroRunsBySession,
					},
					movingSessionIds: movingTerminalSessionIdsRef.current,
					panelId,
				}),
			[runningMacroRunsBySession, terminalPanelClientContext?.projectId],
		);

		const exportProjectForMove = useCallback(
			(): MovedProject | null =>
				exportProjectPresentationsForMove({
					api: dockviewApiRef.current,
					context: {
						defaultServerProjectId: terminalPanelClientContext?.projectId,
						runningMacroRunsBySession,
					},
					movingSessionIds: movingTerminalSessionIdsRef.current,
				}),
			[runningMacroRunsBySession, terminalPanelClientContext?.projectId],
		);

		const { acceptMovedTerminal, acceptServerTerminal } =
			useTerminalAdoptionController({
				apiRef: dockviewApiRef,
				cancelMacroRun,
				clearFinishedMacroRuns: clearFinishedMacroRunsForSession,
				clearMacroRun: clearMacroRunForSession,
				getProjectsForMove: getProjectsForTerminalMove,
				hydrateRecording: hydrateRecordingStateForSession,
				onError: setErrorText,
				onMoveToProject: onMoveTerminalToProject,
				panelSessionsRef: panelSessionMapRef,
				project,
				publishActivityOverview: publishTerminalActivityOverview,
				registerTerminalContextReader,
				replaceMacroRuns: replaceMacroRunsForSession,
				revealRecording,
				setFocusedSessionId,
				showActiveTabActivityIndicator:
					settings.activityIndicators.showActiveTabs,
				showFinishedTabActivityIndicator:
					settings.activityIndicators.showFinishedTabs,
				startRecording: startRecordingForSession,
				stopRecording: stopRecordingForSession,
				syncPanelFocusState,
				terminalCounterRef,
				terminalServerIdentity: terminalPanelClientContext,
			});

		const reconcileServerPanels = useCallback(
			(panels: readonly ServerWorkspacePanel[]) => {
				const api = dockviewApiRef.current;
				if (!api) return;
				const canonicalById = new Map(panels.map((panel) => [panel.id, panel]));
				const canonicalBySessionId = new Map(
					panels.flatMap((panel) =>
						panel.sessionId === undefined
							? []
							: [[panel.sessionId, panel] as const],
					),
				);
				for (const [panelId, sessionId] of panelSessionMapRef.current) {
					const canonical =
						canonicalById.get(panelId) ?? canonicalBySessionId.get(sessionId);
					const panel = api.getPanel(panelId);
					if (canonical === undefined) {
						if (panel) api.removePanel(panel);
						continue;
					}
					if (!panel) continue;
					if (canonical.title !== undefined && panel.title !== canonical.title)
						panel.api.setTitle(canonical.title);
					panel.api.updateParameters({
						...(canonical.emoji === undefined
							? {}
							: { emoji: canonical.emoji }),
						...(canonical.color === undefined
							? {}
							: { color: canonical.color }),
						...(canonical.inheritsProjectColor === undefined
							? {}
							: { inheritsProjectColor: canonical.inheritsProjectColor }),
						...(canonical.activityIndicatorsEnabled === undefined
							? {}
							: {
									activityIndicatorsEnabled:
										canonical.activityIndicatorsEnabled,
								}),
					});
				}
			},
			[],
		);

		const filteredMacros = useMemo(() => {
			const normalizedQuery = macroQuery.trim().toLowerCase();
			const commandItems: MacroLauncherItem[] = [
				{
					group: 'Terminal',
					icon: <Terminal size={18} strokeWidth={2.1} />,
					id: 'create-terminal-tab',
					title: 'Create a new terminal tab',
					description: 'Open a fresh terminal tab in the current project.',
					searchText: `create new terminal tab open fresh terminal ${getCommandShortcut(settings.keyboardShortcuts, 'new-terminal')}`,
					shortcutLabel: getCommandShortcutLabel(
						settings.keyboardShortcuts,
						'new-terminal',
						isMac,
					),
					onSelect: () => {
						setErrorText(null);
						setIsMacroLauncherOpen(false);
						setMacroQuery('');
						void addTerminal({});
					},
				},
				{
					group: 'Terminal',
					icon: <Terminal size={18} strokeWidth={2.1} />,
					id: 'create-terminal-with-profile',
					title: 'New Terminal with Profile…',
					description:
						'Choose one shell profile for this terminal without changing defaults.',
					searchText: 'new terminal shell profile one time choose discovered',
					onSelect: () => {
						void openProfileChooser();
					},
				},
				{
					group: 'Workspace',
					icon: <Plug size={18} strokeWidth={2.1} />,
					id: 'install-terminay-mcp',
					title: 'Install Terminay MCP',
					description:
						'Let Claude Code, Codex, Cursor CLI, Gemini CLI, or OpenCode control sibling terminals in this project.',
					searchText:
						'install terminay mcp model context protocol claude codex cursor gemini opencode terminal control',
					onSelect: () => {
						setIsMacroLauncherOpen(false);
						setMacroQuery('');
						setIsMcpInstallModalOpen(true);
					},
				},
				{
					group: 'Workspace',
					icon: <FolderPlus size={18} strokeWidth={2.1} />,
					id: 'create-project',
					title: 'Create a new project',
					description: 'Add a new project tab and switch to it.',
					searchText: `create new project add project tab ${getCommandShortcut(settings.keyboardShortcuts, 'new-project')}`,
					shortcutLabel: getCommandShortcutLabel(
						settings.keyboardShortcuts,
						'new-project',
						isMac,
					),
					onSelect: () => {
						void createProject();
					},
				},
				{
					group: 'Terminal',
					icon: <Eraser size={18} strokeWidth={2.1} />,
					id: 'clear-terminal',
					title: 'Clear terminal',
					description: 'Clear the active terminal viewport and scrollback.',
					searchText: `clear terminal scrollback screen reset ${getCommandShortcut(settings.keyboardShortcuts, 'clear-terminal')}`,
					shortcutLabel: getCommandShortcutLabel(
						settings.keyboardShortcuts,
						'clear-terminal',
						isMac,
					),
					onSelect: () => {
						clearActiveTerminal();
					},
				},
				{
					group: 'Terminal',
					icon: <Mic size={18} strokeWidth={2.1} />,
					id: 'start-dictation',
					title: 'Start dictation',
					description:
						'Record speech and type the transcript into the active terminal.',
					searchText: `start dictation voice speech microphone audio transcribe terminal input ${getCommandShortcut(settings.keyboardShortcuts, 'start-dictation')}`,
					shortcutLabel: getCommandShortcutLabel(
						settings.keyboardShortcuts,
						'start-dictation',
						isMac,
					),
					onSelect: () => {
						void startDictation();
					},
				},
				{
					group: 'Terminal',
					icon: <Sparkles size={18} strokeWidth={2.1} />,
					id: 'set-tab-title-with-ai',
					title: 'Set tab title with AI',
					description: 'Generate a concise title for the active terminal tab.',
					searchText:
						'set tab title with ai codex rename generate terminal metadata',
					onSelect: () => {
						void runAiTabMetadata('title');
					},
				},
				{
					group: 'Terminal',
					icon: <Sparkles size={18} strokeWidth={2.1} />,
					id: 'set-tab-note-with-ai',
					title: 'Set tab note with AI',
					description: 'Generate a short note for the active terminal tab.',
					searchText:
						'set tab note with ai codex generate terminal note metadata',
					onSelect: () => {
						void runAiTabMetadata('note');
					},
				},
				{
					group: 'Terminal',
					icon: <Settings size={18} strokeWidth={2.1} />,
					id: 'edit-tab-settings',
					title: 'Edit tab settings',
					description: 'Open settings for the active tab.',
					searchText:
						'edit tab settings rename emoji color file folder terminal',
					onSelect: () => {
						openActiveTerminalSettings();
					},
				},
				{
					group: 'Workspace',
					icon: <History size={18} strokeWidth={2.1} />,
					id: 'open-recordings',
					title: 'Open recordings timeline',
					description: 'Browse and replay saved terminal recordings.',
					searchText: `open recordings timeline terminal replay asciinema cast history ${getCommandShortcut(settings.keyboardShortcuts, 'open-recordings')}`,
					shortcutLabel: getCommandShortcutLabel(
						settings.keyboardShortcuts,
						'open-recordings',
						isMac,
					),
					onSelect: () => {
						void auxiliaryRoutes.openRecordings();
					},
				},
				{
					group: 'Workspace',
					icon: <Settings size={18} strokeWidth={2.1} />,
					id: 'edit-project-settings',
					title: 'Edit project settings',
					description: 'Open settings for the current project tab.',
					searchText:
						'edit project settings project tab root folder emoji color',
					onSelect: () => {
						openProjectSettings();
					},
				},
				{
					group: 'Workspace',
					icon: <Sidebar size={18} strokeWidth={2.1} />,
					id: 'toggle-file-explorer-sidebar',
					title: project.isFileExplorerOpen
						? 'Hide file explorer sidebar'
						: 'Show file explorer sidebar',
					description: project.isFileExplorerOpen
						? 'Hide the file explorer sidebar for this project.'
						: 'Show the file explorer sidebar for this project.',
					searchText: `toggle file explorer sidebar show hide explorer sidebar project ${getCommandShortcut(settings.keyboardShortcuts, 'toggle-file-explorer-sidebar')}`,
					shortcutLabel: getCommandShortcutLabel(
						settings.keyboardShortcuts,
						'toggle-file-explorer-sidebar',
						isMac,
					),
					onSelect: () => {
						toggleFileExplorerSidebar();
					},
				},
				{
					group: 'Workspace',
					icon: <FolderSync size={18} strokeWidth={2.1} />,
					id: 'set-project-root-folder-to-working-directory',
					title: 'Set project root folder to working directory',
					description:
						'Use the active terminal working directory as this project root folder.',
					searchText: `set project root folder working directory cwd active terminal root folder ${getCommandShortcut(settings.keyboardShortcuts, 'set-project-root-folder-to-working-directory')}`,
					shortcutLabel: getCommandShortcutLabel(
						settings.keyboardShortcuts,
						'set-project-root-folder-to-working-directory',
						isMac,
					),
					onSelect: () => {
						void setProjectRootFolderToWorkingDirectory();
					},
				},
				...macros.map(
					(macro): MacroLauncherItem => ({
						group: 'Macros',
						icon: <Play size={18} strokeWidth={2.1} />,
						id: macro.id,
						title: macro.title,
						description:
							macro.description ||
							(macro.steps[0]?.type === 'type'
								? macro.steps[0].content
								: 'Multi-step macro'),
						searchText: [
							macro.title,
							macro.description,
							...macro.fields.map((field) => `${field.label} ${field.name}`),
							...macro.steps.map((step) =>
								step.type === 'type' ? step.content : '',
							),
						]
							.join(' ')
							.toLowerCase(),
						shortcutLabel: '',
						onSelect: () => runMacro(macro),
					}),
				),
			];

			if (!normalizedQuery) {
				return commandItems;
			}

			return commandItems
				.map((macro, index) => ({
					macro,
					index,
					score: getCommandSearchScore(macro, normalizedQuery),
				}))
				.filter(({ score }) => score > 0)
				.sort((left, right) => {
					if (left.macro.group === 'Macros' && right.macro.group === 'Macros') {
						return left.index - right.index;
					}

					if (right.score !== left.score) {
						return right.score - left.score;
					}

					return left.index - right.index;
				})
				.map(({ macro }) => macro);
		}, [
			addTerminal,
			auxiliaryRoutes,
			clearActiveTerminal,
			createProject,
			isMac,
			macroQuery,
			macros,
			openActiveTerminalSettings,
			openProjectSettings,
			project.isFileExplorerOpen,
			runAiTabMetadata,
			runMacro,
			settings.keyboardShortcuts,
			setProjectRootFolderToWorkingDirectory,
			openProfileChooser,
			startDictation,
			toggleFileExplorerSidebar,
		]);
		const activeMacroId = filteredMacros[selectedMacroIndex]?.id ?? null;
		const macroLauncherGroups = useMemo(() => {
			const groups = new Map<MacroLauncherGroup, MacroLauncherGroupedItem[]>();

			filteredMacros.forEach((item, index) => {
				const groupItems = groups.get(item.group) ?? [];
				groupItems.push({ index, item });
				groups.set(item.group, groupItems);
			});

			return (['Terminal', 'Workspace', 'Macros'] as const)
				.map((group) => ({
					group,
					items: groups.get(group) ?? [],
				}))
				.filter(({ items }) => items.length > 0);
		}, [filteredMacros]);

		const requestClosePanel = useCallback(
			async (panelId: string) => {
				window.terminayTest?.reportAppCommandStage(`close:${panelId}:started`);
				const api = dockviewApiRef.current;
				const panel = api?.getPanel(panelId);
				if (!api || !panel) return;
				const workspaceStore = terminalClientContext?.workspaceSnapshotStore;
				const canonicalPanel = workspaceStore?.snapshot?.panels[panelId];
				if (panel.params?.presentation === 'documentation') {
					const flush = filePanelSaveHandlersRef.current.get(panelId);
					if (flush !== undefined) {
						try {
							await flush();
						} catch (error) {
							setErrorText(
								error instanceof Error ? error.message : String(error),
							);
							return;
						}
					}
				}
				const sessionId = panelSessionMapRef.current.get(panelId);
				if (sessionId !== undefined) {
					const preflight = await observeTerminalClosePreflight(
						serverActivityClient,
						{ projectId: project.id, sessionId },
					);
					if (!(await confirmTerminalClose('terminal', preflight))) {
						return;
					}
				}
				if (api.panels.length === 1) {
					onCloseProject(project.id, { skipConfirmation: true });
					return;
				}
				if (
					workspaceStore !== undefined &&
					canonicalPanel?.projectId === project.id
				) {
					window.terminayTest?.reportAppCommandStage(
						`close:${panelId}:command-started`,
					);
					await workspaceStore.closePanel(panelId);
					window.terminayTest?.reportAppCommandStage(
						`close:${panelId}:command-completed`,
					);
					const reconciled = await workspaceStore.waitForSnapshot(
						(snapshot) => snapshot.panels[panelId] === undefined,
						{ timeoutMs: 10_000 },
					);
					window.terminayTest?.reportAppCommandStage(
						`close:${panelId}:snapshot-completed`,
					);
					if (reconciled === null) {
						const reconciliationError = workspaceStore.status.error;
						throw new Error(
							reconciliationError === undefined
								? 'Timed out waiting for the closed panel to reconcile.'
								: `Unable to reconcile the closed panel. ${reconciliationError.message}`,
						);
					}
					return;
				}
				panel.api.close();
			},
			[
				onCloseProject,
				project.id,
				serverActivityClient,
				terminalClientContext?.workspaceSnapshotStore,
			],
		);

		useEffect(() => {
			const listener = (event: Event) => {
				const detail = (event as CustomEvent).detail as
					| { panelId?: unknown; sessionId?: unknown }
					| undefined;
				if (
					typeof detail?.panelId !== 'string' ||
					typeof detail.sessionId !== 'string'
				)
					return;
				const api = dockviewApiRef.current;
				const panel = api?.getPanel(detail.panelId);
				const mappedSessionId = panelSessionMapRef.current.get(detail.panelId);
				const liveSessionId =
					typeof panel?.params?.sessionId === 'string'
						? panel.params.sessionId
						: mappedSessionId;
				if (liveSessionId !== detail.sessionId) return;
				void requestClosePanel(detail.panelId);
			};
			window.addEventListener('terminay-request-close-terminal', listener);
			return () =>
				window.removeEventListener('terminay-request-close-terminal', listener);
		}, [requestClosePanel]);

		useEffect(() => {
			const listener = (event: Event) => {
				const panelId = (event as CustomEvent<{ panelId?: unknown }>).detail
					?.panelId;
				if (typeof panelId === 'string') void requestClosePanel(panelId);
			};
			window.addEventListener('terminay-request-close-file', listener);
			return () =>
				window.removeEventListener('terminay-request-close-file', listener);
		}, [requestClosePanel]);

		const closeActivePanel = useCallback(async () => {
			const panelId = dockviewApiRef.current?.activePanel?.id;
			if (panelId === undefined) return;
			await requestClosePanel(panelId);
		}, [requestClosePanel]);

		const saveActivePanel = useCallback(async () => {
			const activePanel = dockviewApiRef.current?.activePanel;
			const registeredSave =
				activePanel === undefined
					? undefined
					: filePanelSaveHandlersRef.current.get(activePanel.id);
			if (registeredSave !== undefined) {
				try {
					await registeredSave();
				} catch (error) {
					setErrorText(error instanceof Error ? error.message : String(error));
				}
				return;
			}
			await saveActiveDockviewPanel({
				api: dockviewApiRef.current,
				onError: setErrorText,
				onSaved: () => undefined,
			});
		}, []);

		const popoutActivePanel = useCallback(
			() => onPopoutProject(project.id),
			[onPopoutProject, project.id],
		);

		const executeAppCommand = useCallback(
			async (command: AppCommand): Promise<void> => {
				switch (command) {
					case 'new-terminal':
						await addTerminal({});
						break;
					case 'new-project':
						await onAddProject();
						break;
					case 'split-horizontal':
						await addTerminal({ direction: 'below' });
						break;
					case 'split-vertical':
						await addTerminal({ direction: 'right' });
						break;
					case 'save-active':
						await saveActivePanel();
						break;
					case 'popout-active':
						await popoutActivePanel();
						break;
					case 'close-active':
						await closeActivePanel();
						break;
					case 'clear-terminal':
						clearActiveTerminal();
						break;
					case 'open-command-bar':
						setMacroQuery('');
						setSelectedMacroIndex(0);
						setIsMacroLauncherOpen(true);
						setMacroToRun(null);
						setMacroFieldValues({});
						break;
					case 'start-dictation':
						await startDictation();
						break;
					case 'open-recordings':
						await auxiliaryRoutes.openRecordings();
						break;
					case 'toggle-file-explorer-sidebar':
						toggleFileExplorerSidebar();
						break;
					case 'set-project-root-folder-to-working-directory':
						await setProjectRootFolderToWorkingDirectory();
						break;
					default:
						break;
				}
			},
			[
				addTerminal,
				auxiliaryRoutes,
				clearActiveTerminal,
				closeActivePanel,
				onAddProject,
				popoutActivePanel,
				saveActivePanel,
				setProjectRootFolderToWorkingDirectory,
				startDictation,
				toggleFileExplorerSidebar,
			],
		);

		useEffect(() => {
			if (!isActive) {
				return;
			}

			const onCopyRequest = () => copyActiveTerminalSelection();
			document.addEventListener('copy', onCopyRequest);

			return () => {
				document.removeEventListener('copy', onCopyRequest);
			};
		}, [copyActiveTerminalSelection, isActive]);

		useEffect(() => {
			if (!isActive) {
				return;
			}

			const onKeyDown = (event: KeyboardEvent) => {
				if (event.defaultPrevented) {
					return;
				}

				const command = findCommandForKeyboardEvent(
					event,
					settings.keyboardShortcuts,
					isMac,
				);
				if (!command) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();

				if (!event.repeat) {
					void executeAppCommand(command);
				}
			};

			window.addEventListener('keydown', onKeyDown, true);
			return () => {
				window.removeEventListener('keydown', onKeyDown, true);
			};
		}, [executeAppCommand, isActive, isMac, settings.keyboardShortcuts]);

		const {
			handleRequest: handleControlRequest,
			ownsSession: ownsControlSession,
		} = useTerminalControlController({
			addTerminal,
			apiRef: dockviewApiRef,
			getTerminalCwd: getServerTerminalCwd,
			projectId: project.id,
			sendInput: sendTerminalPanelInput,
			setTerminalTitleRevision,
			state: terminalControlStateRef.current,
			terminalContextReadersRef,
			waitForInactivity:
				terminalPanelClientContext === null
					? null
					: (projectId, sessionId, idleMs) =>
							terminalPanelClientContext.client.waitForInactivity(
								projectId,
								sessionId,
								idleMs,
							),
		});
		useImperativeHandle(
			ref,
			() => ({
				acceptMovedTerminal,
				acceptServerTerminal,
				reconcileServerPanels,
				activateTerminal,
				executeCommand(command: AppCommand) {
					return executeAppCommand(command);
				},
				exportTerminalForMove,
				exportProjectForMove,
				focusActiveTerminal,
				ownsControlSession,
				handleControlRequest,
			}),
			[
				acceptMovedTerminal,
				acceptServerTerminal,
				reconcileServerPanels,
				activateTerminal,
				executeAppCommand,
				exportTerminalForMove,
				exportProjectForMove,
				focusActiveTerminal,
				ownsControlSession,
				handleControlRequest,
			],
		);

		useEffect(() => {
			publishTerminalActivityOverview();
		}, [publishTerminalActivityOverview]);

		useEffect(() => {
			focusedSessionIdRef.current = focusedSessionId;
			for (const sessionId of panelSessionMapRef.current.values()) {
				evaluateTerminalActivityState(sessionId);
			}
		}, [evaluateTerminalActivityState, focusedSessionId]);

		useEffect(() => {
			syncFocusedTerminalTabs(focusedSessionId);
		}, [focusedSessionId, syncFocusedTerminalTabs]);

		useEffect(() => {
			syncRunningMacroTabs();
		}, [syncRunningMacroTabs]);

		const closeServerPanel = useCallback(
			(panelId: string) => {
				const store = terminalClientContext?.workspaceSnapshotStore;
				const panel = store?.snapshot?.panels[panelId];
				if (store === undefined || panel?.projectId !== project.id) return;
				void store.closePanel(panelId).catch((error: unknown) => {
					const message =
						error instanceof Error
							? error.message
							: 'Unable to close this panel on the server.';
					setErrorText(message);
				});
			},
			[project.id, terminalClientContext?.workspaceSnapshotStore],
		);

		const commitServerPanelOrder = useCallback(
			(panelIds: readonly string[]) => {
				const store = terminalClientContext?.workspaceSnapshotStore;
				const canonicalIds = store?.snapshot?.projects[project.id]?.panelIds;
				if (
					store === undefined ||
					canonicalIds === undefined ||
					panelIds.length !== canonicalIds.length ||
					panelIds.some((panelId) => !canonicalIds.includes(panelId)) ||
					panelIds.every((panelId, index) => panelId === canonicalIds[index])
				)
					return;
				void store
					.reorderPanels({ projectId: project.id, panelIds })
					.catch((error: unknown) => {
						setErrorText(
							error instanceof Error
								? error.message
								: 'Unable to reorder these tabs on the server.',
						);
					});
			},
			[project.id, terminalClientContext?.workspaceSnapshotStore],
		);

		const handleDockviewReady = useDockviewPanelLifecycle({
			apiRef: dockviewApiRef,
			cancelMacroRunsForSession,
			clearActivitySession: (sessionId) =>
				terminalActivityStoreRef.current.deleteSession(sessionId),
			clearMacroRunsForSession,
			closeServerPanel,
			commitPanelOrder: commitServerPanelOrder,
			filePathPanelMapRef,
			focusedSessionIdRef,
			folderPathPanelMapRef,
			markTerminalActivityViewed,
			movingTerminalSessionIdsRef,
			panelSessionMapRef,
			publishTerminalActivityOverview,
			setFocusedSessionId,
			setIsDockviewReady,
			syncPanelFocusState,
			terminalActivityTimersRef,
		});

		useEffect(() => {
			const onOpenFileEvent = (event: Event) => {
				const customEvent = event as CustomEvent<{
					initialMode?: FileViewerMode;
					path?: string;
				}>;
				const filePath = customEvent.detail?.path;
				if (!filePath) {
					return;
				}
				void openFile(filePath, {
					initialMode: customEvent.detail.initialMode,
				});
			};

			window.addEventListener('terminay-open-file', onOpenFileEvent);
			return () => {
				window.removeEventListener('terminay-open-file', onOpenFileEvent);
			};
		}, [openFile]);

		useEffect(() => {
			const handlePointerDown = (event: PointerEvent) => {
				const target = event.target;
				const workspace = workspaceRef.current;
				if (
					!(target instanceof Element) ||
					!workspace?.contains(target) ||
					!target.closest('.dv-sash') ||
					isDockviewSashDraggingRef.current
				) {
					return;
				}

				isDockviewSashDraggingRef.current = true;
				clearDeferredTerminalActivityFlushTimer();

				const ownerWindow = target.ownerDocument.defaultView ?? window;
				const ownerDocument = target.ownerDocument;
				let didEnd = false;

				const endSashDrag = () => {
					if (didEnd) {
						return;
					}

					didEnd = true;
					isDockviewSashDraggingRef.current = false;
					ownerDocument.removeEventListener('pointerup', endSashDrag, true);
					ownerDocument.removeEventListener('pointercancel', endSashDrag, true);
					ownerDocument.removeEventListener('contextmenu', endSashDrag, true);
					ownerWindow.removeEventListener('blur', endSashDrag);
					scheduleDeferredTerminalActivityFlush();
				};

				ownerDocument.addEventListener('pointerup', endSashDrag, true);
				ownerDocument.addEventListener('pointercancel', endSashDrag, true);
				ownerDocument.addEventListener('contextmenu', endSashDrag, true);
				ownerWindow.addEventListener('blur', endSashDrag);
			};

			window.addEventListener('pointerdown', handlePointerDown, true);
			return () => {
				window.removeEventListener('pointerdown', handlePointerDown, true);
				isDockviewSashDraggingRef.current = false;
				clearDeferredTerminalActivityFlushTimer();
				deferredTerminalActivitySessionIdsRef.current.clear();
			};
		}, [
			clearDeferredTerminalActivityFlushTimer,
			scheduleDeferredTerminalActivityFlush,
		]);

		useEffect(() => {
			const onTerminalFocused = (event: Event) => {
				if (!isActive) {
					return;
				}
				const customEvent = event as CustomEvent<{ sessionId?: string }>;
				const sessionId = customEvent.detail?.sessionId ?? null;
				if (sessionId !== null && !getPanelForSession(sessionId)) {
					return;
				}
				const previousSessionId = focusedSessionIdRef.current;
				if (
					serverActivityClient === undefined &&
					previousSessionId &&
					previousSessionId !== sessionId &&
					getPanelForSession(previousSessionId)
				) {
					applyTerminalActivityEvaluation(
						previousSessionId,
						terminalActivityStoreRef.current.suppressTerminalActivity(
							previousSessionId,
						),
					);
				}
				focusedSessionIdRef.current = sessionId;
				setFocusedSessionId(sessionId);
			};

			window.addEventListener('terminay-terminal-focused', onTerminalFocused);
			return () => {
				window.removeEventListener(
					'terminay-terminal-focused',
					onTerminalFocused,
				);
			};
		}, [
			applyTerminalActivityEvaluation,
			getPanelForSession,
			isActive,
			serverActivityClient,
		]);

		useEffect(() => {
			if (serverActivityClient !== undefined) {
				return;
			}
			const onTerminalOutput = (event: Event) => {
				const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail
					?.sessionId;
				if (!sessionId || !getPanelForSession(sessionId)) {
					return;
				}

				const now = Date.now();
				terminalActivityStoreRef.current.recordTerminalActivity(sessionId, now);
				if (
					isDockviewSashDraggingRef.current ||
					deferredTerminalActivityFlushTimerRef.current !== null
				) {
					deferredTerminalActivitySessionIdsRef.current.add(sessionId);
					scheduleDeferredTerminalActivityFlush();
					return;
				}

				applyTerminalActivityEvaluation(
					sessionId,
					terminalActivityStoreRef.current.evaluate(sessionId, now),
				);
			};
			window.addEventListener(TERMINAL_PANEL_OUTPUT_EVENT, onTerminalOutput);
			return () =>
				window.removeEventListener(
					TERMINAL_PANEL_OUTPUT_EVENT,
					onTerminalOutput,
				);
		}, [
			applyTerminalActivityEvaluation,
			getPanelForSession,
			scheduleDeferredTerminalActivityFlush,
			serverActivityClient,
		]);

		useEffect(() => {
			if (serverActivityClient !== undefined) {
				return;
			}
			// Server activity is required by the connected workspace. There is no
			// renderer subscription to a host terminal-activity IPC fallback.
			return;
		}, [
			applyTerminalActivityEvaluation,
			getPanelForSession,
			serverActivityClient,
		]);

		useEffect(() => {
			const onTerminalUserInput = (event: Event) => {
				const customEvent = event as CustomEvent<{ sessionId?: string }>;
				const sessionId = customEvent.detail?.sessionId;
				if (!sessionId || !getPanelForSession(sessionId)) {
					return;
				}

				if (serverActivityClient !== undefined) {
					void serverActivityClient
						.acknowledge({ projectId: project.id, sessionId })
						.catch(() => undefined);
				} else {
					applyTerminalActivityEvaluation(
						sessionId,
						terminalActivityStoreRef.current.recordUserInput(sessionId),
					);
				}
			};

			window.addEventListener(
				'terminay-terminal-user-input',
				onTerminalUserInput,
			);
			return () => {
				window.removeEventListener(
					'terminay-terminal-user-input',
					onTerminalUserInput,
				);
			};
		}, [
			applyTerminalActivityEvaluation,
			getPanelForSession,
			project.id,
			serverActivityClient,
		]);

		useEffect(() => {
			return () => {
				onTerminalActivityOverviewChange(project.id, []);
				for (const timer of terminalActivityTimersRef.current.values()) {
					window.clearTimeout(timer);
				}
				terminalActivityTimersRef.current.clear();
				terminalActivityStoreRef.current.clear();
			};
		}, [onTerminalActivityOverviewChange, project.id]);

		useEffect(() => {
			const onTerminalExit = (event: Event) => {
				const detail = (
					event as CustomEvent<{
						autoCloseOnSuccessfulExit?: boolean;
						exitCode?: number;
						sessionId?: string;
						signal?: number | null;
					}>
				).detail;
				if (!detail?.sessionId || typeof detail.exitCode !== 'number') return;
				cancelMacroRunsForSession(detail.sessionId);

				recordTerminalControlExit(
					terminalControlStateRef.current,
					detail.sessionId,
					detail.exitCode,
				);

				const panel = getPanelForSession(detail.sessionId);
				panel?.api.updateParameters({ terminalSessionStatus: 'exited' });

				if (
					detail.autoCloseOnSuccessfulExit === true &&
					detail.exitCode === 0 &&
					detail.signal == null
				) {
					if (panel !== null && panel !== undefined) {
						// The session has already exited, so this is not a destructive user
						// close and must not wait for the activity/confirmation path.  Persist
						// the canonical panel removal directly; a Dockview-only close would
						// immediately be restored by workspace reconciliation.
						const store = terminalClientContext?.workspaceSnapshotStore;
						const canonicalPanel = store?.snapshot?.panels[panel.id];
						if (
							store !== undefined &&
							canonicalPanel?.projectId === project.id
						) {
							void store
								.closePanel(panel.id)
								.catch((error: unknown) =>
									setErrorText(
										error instanceof Error
											? error.message
											: 'Unable to close the completed terminal tab.',
									),
								);
						} else {
							panel.api.close();
						}
					}
				}
			};
			window.addEventListener(TERMINAL_PANEL_EXIT_EVENT, onTerminalExit);
			return () =>
				window.removeEventListener(TERMINAL_PANEL_EXIT_EVENT, onTerminalExit);
		}, [
			cancelMacroRunsForSession,
			getPanelForSession,
			project.id,
			terminalClientContext?.workspaceSnapshotStore,
		]);

		useTerminalDockviewWindowController({
			addTerminal,
			apiRef: dockviewApiRef,
			draggingTransferRef,
			isActive,
			openTerminalEditWindow,
			openProfileChooser,
			popoutUrl,
			runAiTabMetadataRef,
		});
		useEffect(() => {
			if (!isActive) {
				return;
			}

			const api = dockviewApiRef.current;
			const workspace = workspaceRef.current;
			if (!api || !workspace) {
				return;
			}

			const { clientWidth, clientHeight } = workspace;
			if (clientWidth > 0 && clientHeight > 0) {
				api.layout(clientWidth, clientHeight);
			}

			if (isMacroLauncherOpen || macroToRun || isTerminalSwitcherOpen) {
				return;
			}

			const frame = window.requestAnimationFrame(() => {
				focusActiveTerminal();
			});

			return () => {
				window.cancelAnimationFrame(frame);
			};
		}, [
			focusActiveTerminal,
			isActive,
			isMacroLauncherOpen,
			isTerminalSwitcherOpen,
			macroToRun,
		]);

		useEffect(() => {
			if (!isActive) {
				return;
			}

			const frame = window.requestAnimationFrame(() => {
				const api = dockviewApiRef.current;
				const workspace = workspaceRef.current;
				if (!api || !workspace) {
					return;
				}

				const { clientWidth, clientHeight } = workspace;
				if (clientWidth > 0 && clientHeight > 0) {
					api.layout(clientWidth, clientHeight);
				}
			});

			return () => {
				window.cancelAnimationFrame(frame);
			};
		}, [isActive, project.fileExplorerWidth, project.isFileExplorerOpen]);

		useEffect(() => {
			if (!isMacroLauncherOpen) {
				return;
			}

			window.requestAnimationFrame(() => {
				macroLauncherInputRef.current?.focus();
				macroLauncherInputRef.current?.select();
			});
		}, [isMacroLauncherOpen]);

		useEffect(() => {
			if (filteredMacros.length === 0) {
				setSelectedMacroIndex(0);
				return;
			}

			setSelectedMacroIndex((current) =>
				Math.min(current, filteredMacros.length - 1),
			);
		}, [filteredMacros.length]);

		useEffect(() => {
			if (!isMacroLauncherOpen) {
				return;
			}

			const onKeyDown = (event: KeyboardEvent) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					closeMacroLauncher();
					return;
				}

				if (event.key === 'ArrowDown') {
					event.preventDefault();
					setSelectedMacroIndex((current) =>
						filteredMacros.length === 0
							? 0
							: (current + 1) % filteredMacros.length,
					);
					return;
				}

				if (event.key === 'ArrowUp') {
					event.preventDefault();
					setSelectedMacroIndex((current) =>
						filteredMacros.length === 0
							? 0
							: (current - 1 + filteredMacros.length) % filteredMacros.length,
					);
					return;
				}

				if (event.key === 'Enter') {
					event.preventDefault();
					const macro = filteredMacros[selectedMacroIndex];
					if (macro) {
						macro.onSelect();
					}
				}
			};

			window.addEventListener('keydown', onKeyDown);
			return () => {
				window.removeEventListener('keydown', onKeyDown);
			};
		}, [
			closeMacroLauncher,
			filteredMacros,
			isMacroLauncherOpen,
			selectedMacroIndex,
		]);

		useEffect(() => {
			if (!isMacroLauncherOpen) {
				return;
			}

			const list = macroLauncherListRef.current;
			const activeItem = activeMacroId
				? macroLauncherItemRefs.current.get(activeMacroId)
				: null;
			if (!list || !activeItem) {
				return;
			}

			const animationFrameId = window.requestAnimationFrame(() => {
				const listRect = list.getBoundingClientRect();
				const activeRect = activeItem.getBoundingClientRect();
				const padding = 12;
				if (activeRect.top < listRect.top + padding) {
					list.scrollTop = Math.max(
						0,
						list.scrollTop + activeRect.top - listRect.top - padding,
					);
				} else if (activeRect.bottom > listRect.bottom - padding) {
					list.scrollTop =
						list.scrollTop + activeRect.bottom - listRect.bottom + padding;
				}
			});

			return () => {
				window.cancelAnimationFrame(animationFrameId);
			};
		}, [activeMacroId, isMacroLauncherOpen]);

		useEffect(() => {
			if (!macroToRun) {
				return;
			}

			window.requestAnimationFrame(() => {
				firstMacroFieldRef.current?.focus();
			});

			const onKeyDown = (event: KeyboardEvent) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					closeMacroParameterModal();
				}
			};

			window.addEventListener('keydown', onKeyDown);
			return () => {
				window.removeEventListener('keydown', onKeyDown);
			};
		}, [closeMacroParameterModal, macroToRun]);

		const sidebarPanelItemsById: Record<SidebarPanelId, SidebarPanelStackItem> =
			{
				explorer: {
					id: 'explorer',
					title: 'Explorer',
					height: project.sidebarExplorerHeight,
					collapsed: project.isExplorerPaneCollapsed,
					onToggleCollapsed: () => {
						const next = !project.isExplorerPaneCollapsed;
						onUpdateProject(project.id, {
							isExplorerPaneCollapsed: next,
						});
					},
					actions: (
						<button
							type="button"
							className="sidebar-pane__action-button"
							onClick={refreshFileExplorerTree}
							aria-label="Reload explorer"
							title="Reload explorer"
						>
							<RefreshCw size={14} aria-hidden="true" />
						</button>
					),
					children:
						featureAvailability.state === 'unavailable' ? (
							<FeatureUnavailableState reason={featureAvailability.reason} />
						) : (
							<FileExplorerTree
								directoryChildren={directoryChildren}
								directoryErrors={directoryErrors}
								expandedPaths={expandedPaths}
								gitStatuses={gitStatuses}
								loadingPaths={loadingPaths}
								onOpenFile={openFile}
								onOpenFolder={openFolder}
								onToggleDirectory={toggleDirectory}
								onRename={handleRename}
								onDelete={handleDelete}
								onNewFile={handleNewFile}
								onNewFolder={handleNewFolder}
								onOpenTerminal={handleOpenTerminalAt}
								onCopyPath={handleCopyPath}
								onCopyRelativePath={handleCopyRelativePath}
								rootPath={explorerProjectRoot}
							/>
						),
				},
				agents: {
					id: 'agents',
					title: 'Agents',
					height: project.sidebarAgentsHeight,
					collapsed: project.isAgentsPaneCollapsed,
					onToggleCollapsed: () => {
						onUpdateProject(project.id, {
							isAgentsPaneCollapsed: !project.isAgentsPaneCollapsed,
						});
					},
					count: projectAgentItems.length,
					children:
						featureAvailability.state === 'unavailable' ? (
							<FeatureUnavailableState reason={featureAvailability.reason} />
						) : (
							<AgentsSidebar
								projectId={project.id}
								agents={projectAgentItems}
								expandedEntryIds={project.expandedAgentEntryIds}
								onToggleEntryExpanded={(entryId) => {
									const expanded =
										project.expandedAgentEntryIds.includes(entryId);
									onUpdateProject(project.id, {
										expandedAgentEntryIds: expanded
											? project.expandedAgentEntryIds.filter(
													(candidate) => candidate !== entryId,
												)
											: [...project.expandedAgentEntryIds, entryId],
									});
								}}
								onActivateTerminal={activateAgentTerminal}
								onAcknowledgeEntry={(entryId) => {
									const entry = agentStatusSnapshot.entries[entryId];
									if (entry !== undefined) {
										void serverAgentStatusClient
											?.acknowledge({
												projectId: project.id,
												sessionId: entry.activationTerminalSessionId,
												entryId,
											})
											.catch((error) => reportFeatureFailure('Agents', error));
									}
								}}
							/>
						),
				},
				git: {
					id: 'git',
					title: 'Git',
					height: project.sidebarGitHeight,
					collapsed: project.isGitPaneCollapsed,
					onToggleCollapsed: () => {
						const next = !project.isGitPaneCollapsed;
						onUpdateProject(project.id, {
							isGitPaneCollapsed: next,
						});
					},
					count: worktreePanelStatus?.worktrees.length,
					accessory: currentGitBranch ? (
						<span className="sidebar-pane__branch">{currentGitBranch}</span>
					) : null,
					children:
						featureAvailability.state === 'unavailable' ? (
							<FeatureUnavailableState reason={featureAvailability.reason} />
						) : (
							<WorktreesPanel
								activePushMenuWorktreePath={
									gitPushMenuPosition?.target?.worktreePath ?? null
								}
								deletingWorktreePaths={deletingWorktreePaths}
								status={worktreePanelStatus}
								viewMode={settings.sidebar.gitPanelViewMode}
								onDeletePath={handleDelete}
								onNewFile={handleNewFile}
								onNewFolder={handleNewFolder}
								onDeleteWorktree={handleDeleteWorktree}
								onOpenEntry={handleOpenGitEntry}
								onOpenFolder={handleOpenGitFolder}
								onOpenPushMenu={handleOpenWorktreePushMenu}
								onOpenTerminal={handleOpenTerminalAtWorktree}
								onOpenTerminalAtPath={handleOpenTerminalAt}
								onPullFromOrigin={handlePullWorktreeFromOrigin}
								onRenameWorktree={handleRenameWorktree}
								onRenamePath={handleRename}
								onRevealWorktree={handleRevealWorktree}
								onSwitchProjectRoot={handleSwitchProjectRootToWorktree}
							/>
						),
				},
				documentation: {
					id: 'documentation',
					title: 'Documentation',
					height: project.sidebarDocumentationHeight,
					collapsed: project.isDocumentationPaneCollapsed,
					onToggleCollapsed: () =>
						onUpdateProject(project.id, {
							isDocumentationPaneCollapsed:
								!project.isDocumentationPaneCollapsed,
						}),
					actions: (
						<button
							type="button"
							className="sidebar-pane__action-button"
							onClick={documentation.refresh}
							aria-label="Reload documentation"
							title="Reload documentation"
						>
							<RefreshCw size={14} aria-hidden="true" />
						</button>
					),
					count: documentation.catalog?.documents.length,
					children: (
						<DocumentationTree
							catalog={documentation.catalog}
							error={documentation.error}
							expandedFolders={documentation.expandedFolders}
							loading={documentation.loading}
							onToggleFolder={documentation.toggleFolder}
							onOpen={(path) =>
								openFile(path, { presentation: 'documentation' })
							}
						/>
					),
				},
			};
		const visibleSidebarPanelIds = project.sidebarPanelOrder.filter(
			(id) => settings.agentIntegration.enabled || id !== 'agents',
		);
		const sidebarPanelItems = visibleSidebarPanelIds.map(
			(id) => sidebarPanelItemsById[id],
		);
		const commitSidebarHeights = (
			heights: Readonly<Record<string, number>>,
		): Promise<void> => {
			const patch: Partial<
				Pick<
					ProjectTab,
					| 'sidebarExplorerHeight'
					| 'sidebarAgentsHeight'
					| 'sidebarGitHeight'
					| 'sidebarDocumentationHeight'
				>
			> = {};
			for (const [id, height] of Object.entries(heights)) {
				const persistedHeight = Math.min(
					2_000,
					Math.max(30, Math.round(height)),
				);
				if (id === 'explorer') patch.sidebarExplorerHeight = persistedHeight;
				else if (id === 'agents') patch.sidebarAgentsHeight = persistedHeight;
				else if (id === 'git') patch.sidebarGitHeight = persistedHeight;
				else if (id === 'documentation')
					patch.sidebarDocumentationHeight = persistedHeight;
			}
			if (Object.keys(patch).length === 0) return Promise.resolve();
			return onCommitProjectSidebar(project.id, patch).catch((error) => {
				setErrorText(
					`Unable to save sidebar size: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				throw error;
			});
		};

		return (
			<section
				className={`project-workspace${isActive ? ' project-workspace--active' : ''}${isMac ? ' project-workspace--macos' : ''}`}
				data-terminay-project-id={project.id}
				data-terminay-git-client={
					featureAuthority?.gitClient === undefined ? 'unavailable' : 'server'
				}
				data-terminay-project-root={project.rootFolder}
				data-new-terminal-shortcut={getCommandShortcut(
					settings.keyboardShortcuts,
					'new-terminal',
				)}
				style={{ '--project-color': project.color } as CSSProperties}
			>
				{errorText ? (
					<div className="error-banner">Operation failed: {errorText}</div>
				) : null}

				<WorkspaceSplitLayout
					className="project-workspace-body"
					isNavigationVisible={project.isFileExplorerOpen}
					navigationWidth={project.fileExplorerWidth}
					onNavigationWidthCommit={(width) => {
						void onCommitProjectSidebar(project.id, {
							fileExplorerWidth: Math.min(
								2_000,
								Math.max(30, Math.round(width)),
							),
						}).catch((error) => {
							setErrorText(
								`Unable to save sidebar width: ${
									error instanceof Error ? error.message : String(error)
								}`,
							);
						});
					}}
					navigation={
						project.isFileExplorerOpen ? (
							<div className="file-explorer-sidebar">
								<SidebarPanelStack
									items={sidebarPanelItems}
									onHeightsCommit={commitSidebarHeights}
									onReorder={(orderedIds) => {
										const reorderedVisibleIds = orderedIds.filter(
											(id): id is SidebarPanelId =>
												project.sidebarPanelOrder.includes(
													id as SidebarPanelId,
												),
										);
										const visibleIds = new Set(reorderedVisibleIds);
										const orderedIterator =
											reorderedVisibleIds[Symbol.iterator]();
										const nextOrder = project.sidebarPanelOrder.map((id) =>
											visibleIds.has(id)
												? (orderedIterator.next().value ?? id)
												: id,
										);
										closeGitPushMenu();
										onUpdateProject(project.id, {
											sidebarPanelOrder: nextOrder,
										});
									}}
								/>

								{gitPushMenuPosition ? (
									<ContextMenu
										x={gitPushMenuPosition.x}
										y={gitPushMenuPosition.y}
										onClose={closeGitPushMenu}
										items={buildGitPushMenuItems({
											target: gitPushMenuPosition.target,
											onLaunchAgent: launchGitPushAgent,
										})}
									/>
								) : null}
							</div>
						) : null
					}
					content={
						<div
							ref={(element) => {
								workspaceRef.current = element;
							}}
							className="workspace dockview-theme-dark"
						>
							<TerminalPanelClientContext.Provider
								value={terminalPanelClientContext}
							>
								<FilePanelSaveRegistryProvider registry={filePanelSaveRegistry}>
									<DockviewReact
										components={dockviewComponents}
										tabComponents={dockviewTabComponents}
										popoutUrl={popoutUrl}
										onReady={handleDockviewReady}
										floatingGroupBounds="boundedWithinViewport"
									/>
								</FilePanelSaveRegistryProvider>
							</TerminalPanelClientContext.Provider>
						</div>
					}
				/>
				<McpInstallModal
					client={mcpInstallClient}
					open={isMcpInstallModalOpen}
					onClose={() => setIsMcpInstallModalOpen(false)}
				/>
				{profileChooserEntries ? (
					<div
						className="macro-launcher-overlay"
						onClick={() => setProfileChooserEntries(null)}
					>
						<div
							ref={profileChooserRef}
							className="shell-profile-chooser"
							role="dialog"
							aria-modal="true"
							aria-labelledby="shell-profile-chooser-title"
							onClick={(event) => event.stopPropagation()}
						>
							<header>
								<div>
									<h2 id="shell-profile-chooser-title">
										New Terminal with Profile
									</h2>
									<p>
										This choice applies once and does not change the server or
										project default.
									</p>
								</div>
								<button
									type="button"
									aria-label="Close shell profile chooser"
									onClick={() => setProfileChooserEntries(null)}
								>
									×
								</button>
							</header>
							<label>
								<span className="sr-only">Search shell profiles</span>
								<input
									ref={profileChooserSearchRef}
									type="search"
									autoFocus
									value={profileChooserQuery}
									onChange={(event) =>
										setProfileChooserQuery(event.target.value)
									}
									placeholder="Search shell profiles"
								/>
							</label>
							<div className="shell-profile-chooser__list">
								{filteredProfileChooserEntries.map((entry) => (
									<button
										type="button"
										key={entry.id}
										onClick={() => {
											setProfileChooserEntries(null);
											void addTerminal({ profileId: entry.id });
										}}
									>
										<span aria-hidden="true">{entry.icon || '›_'}</span>
										<span>
											<strong>{entry.name}</strong>
											<small>
												{entry.kind === 'discovered'
													? `Discovered · ${entry.source}`
													: entry.kind === 'system'
														? 'System default'
														: 'Custom profile'}
											</small>
										</span>
									</button>
								))}
								{filteredProfileChooserEntries.length === 0 ? (
									<p>No available profiles match your search.</p>
								) : null}
							</div>
						</div>
					</div>
				) : null}
				<AnimatePresence>
					{isMacroLauncherOpen && (
						<div
							className="macro-launcher-overlay"
							onClick={closeMacroLauncher}
						>
							<motion.div
								initial={{ opacity: 0, scale: 0.98, y: -20 }}
								animate={{ opacity: 1, scale: 1, y: 0 }}
								exit={{ opacity: 0, scale: 0.98, y: -10 }}
								transition={{ duration: 0.15, ease: 'easeOut' }}
								className="macro-launcher"
								role="dialog"
								aria-modal="true"
								aria-label="Command bar"
								onClick={(e) => e.stopPropagation()}
							>
								<div className="macro-launcher-search-container">
									<div className="macro-launcher-search-icon">
										<Search size={20} strokeWidth={2.5} aria-hidden="true" />
									</div>
									<input
										ref={macroLauncherInputRef}
										type="search"
										className="macro-launcher-input"
										value={macroQuery}
										onChange={(event) => {
											setMacroQuery(event.target.value);
											setSelectedMacroIndex(0);
										}}
										aria-label="Search commands"
										placeholder="Search commands..."
										spellCheck={false}
										autoComplete="off"
									/>
									<div className="macro-launcher-shortcut">
										<span>ESC</span>
									</div>
								</div>

								<div ref={macroLauncherListRef} className="macro-launcher-list">
									{filteredMacros.length === 0 ? (
										<div className="macro-launcher-empty">
											<p>No commands match your search.</p>
										</div>
									) : (
										macroLauncherGroups.map(({ group, items }) => (
											<section className="macro-launcher-group" key={group}>
												<div className="macro-launcher-group-label">
													{group}
												</div>
												<div className="macro-launcher-group-items">
													{items.map(({ item: macro, index }) => (
														<button
															key={macro.id}
															type="button"
															ref={(element) => {
																if (element) {
																	macroLauncherItemRefs.current.set(
																		macro.id,
																		element,
																	);
																	return;
																}

																macroLauncherItemRefs.current.delete(macro.id);
															}}
															className={`macro-launcher-item ${index === selectedMacroIndex ? 'macro-launcher-item--active' : ''}`}
															onMouseEnter={() => setSelectedMacroIndex(index)}
															onClick={() => macro.onSelect()}
														>
															<span className="macro-launcher-item-icon">
																{macro.icon}
															</span>
															<div className="macro-launcher-item-content">
																<span className="macro-launcher-item-title">
																	{macro.title}
																</span>
																<span className="macro-launcher-item-description">
																	{macro.description}
																</span>
															</div>
															<div className="macro-launcher-item-actions">
																{macro.shortcutLabel ? (
																	<span className="macro-launcher-command-shortcut">
																		{macro.shortcutLabel}
																	</span>
																) : null}
																{index === selectedMacroIndex && (
																	<div className="macro-launcher-item-hint">
																		<span>⏎</span>
																	</div>
																)}
															</div>
														</button>
													))}
												</div>
											</section>
										))
									)}
								</div>

								<div className="macro-launcher-footer">
									<div className="macro-launcher-footer-hint">
										<span className="macro-launcher-key">↑↓</span> to navigate
									</div>
									<div className="macro-launcher-footer-hint">
										<span className="macro-launcher-key">⏎</span> to run
									</div>
								</div>
							</motion.div>
						</div>
					)}
				</AnimatePresence>

				{isTerminalSwitcherOpen ? (
					<div
						className="terminal-switcher"
						role="dialog"
						aria-modal="true"
						aria-label="Terminal switcher"
					>
						<div className="terminal-switcher-panel">
							<div className="terminal-switcher-header">
								<p className="terminal-switcher-kicker">Alt+Tab</p>
								<span className="terminal-switcher-hint">
									Release Alt to switch
								</span>
							</div>
							<div className="terminal-switcher-list">
								{terminalSwitcherItems.map((item, index) => (
									<button
										key={item.panelId}
										type="button"
										className={`terminal-switcher-item${index === terminalSwitcherIndex ? ' terminal-switcher-item--active' : ''}`}
										onMouseEnter={() => selectTerminalSwitcherItem(index)}
										onClick={() => selectAndCommitTerminalSwitcherItem(index)}
									>
										<span
											className="terminal-switcher-item-preview"
											style={{ '--tab-color': item.color } as CSSProperties}
										>
											<span className="terminal-switcher-item-dot" />
											<span
												className="terminal-switcher-item-emoji"
												aria-hidden="true"
											>
												{item.emoji || '>'}
											</span>
										</span>
										<span className="terminal-switcher-item-title">
											{item.title}
										</span>
									</button>
								))}
							</div>
						</div>
					</div>
				) : null}

				{fileExplorerNameDialog ? (
					<FileExplorerNameModal
						dialog={fileExplorerNameDialog}
						modal={fileExplorerNameModal}
						onCancel={cancelFileExplorerNameDialog}
						onSubmit={submitFileExplorerNameDialog}
					/>
				) : null}

				{macroToRun ? (
					<ModalBackdrop onClose={closeMacroParameterModal}>
						<form
							className="project-edit-modal project-edit-modal--wide macro-parameter-modal"
							ref={(element) => {
								macroParameterModal.modalRef.current = element;
							}}
							style={macroParameterModal.modalStyle}
							onSubmit={(event) => {
								event.preventDefault();
								if (!validateMacroValues(macroToRun, macroFieldValues)) {
									return;
								}
								executeMacro(macroToRun, macroFieldValues);
							}}
							onClick={(event) => event.stopPropagation()}
							role="dialog"
							aria-modal="true"
							aria-labelledby="macro-parameter-modal-title"
						>
							<ModalTitlebar
								title={macroToRun.title}
								titleId="macro-parameter-modal-title"
								onClose={closeMacroParameterModal}
								onMouseDown={macroParameterModal.handleTitlebarPointerDown}
							/>
							<div className="macro-parameter-content">
								{macroToRun.description ? (
									<p className="macro-parameter-description">
										{macroToRun.description}
									</p>
								) : null}

								<div className="macro-parameter-fields">
									{macroToRun.fields.map((field, index) => {
										const value = macroFieldValues[field.name];
										const fieldInputId = `macro-field-input-${field.id}`;
										const firstFieldRef =
											index === 0
												? (
														element:
															| HTMLInputElement
															| HTMLTextAreaElement
															| HTMLSelectElement
															| null,
													) => {
														firstMacroFieldRef.current = element;
													}
												: undefined;
										return (
											<div key={field.id} className="macro-parameter-field">
												<label
													className="macro-parameter-field__label"
													htmlFor={fieldInputId}
												>
													{field.label}
												</label>
												{field.type === 'textarea' ? (
													<textarea
														id={fieldInputId}
														ref={firstFieldRef}
														className="project-edit-textarea"
														value={String(value ?? '')}
														placeholder={field.placeholder}
														onChange={(event) =>
															setMacroFieldValues((current) => ({
																...current,
																[field.name]: event.target.value,
															}))
														}
														rows={4}
													/>
												) : field.type === 'select' ? (
													<select
														id={fieldInputId}
														ref={firstFieldRef}
														className="project-edit-select"
														value={String(value ?? '')}
														onChange={(event) =>
															setMacroFieldValues((current) => ({
																...current,
																[field.name]: event.target.value,
															}))
														}
													>
														{field.options.map((option) => (
															<option
																key={`${field.id}-${option.value}`}
																value={option.value}
															>
																{option.label}
															</option>
														))}
													</select>
												) : field.type === 'file' ? (
													<MacroFileFieldInput
														fileViewerClient={serverFileViewerClient}
														id={fieldInputId}
														projectId={project.id}
														projectRoot={project.rootFolder}
														ref={firstFieldRef}
														rootPath={
															macroFileSearchRootPath || project.rootFolder
														}
														value={String(value ?? '')}
														placeholder={field.placeholder}
														onChange={(nextValue) =>
															setMacroFieldValues((current) => ({
																...current,
																[field.name]: nextValue,
															}))
														}
													/>
												) : field.type === 'checkbox' ? (
													<input
														id={fieldInputId}
														ref={firstFieldRef}
														type="checkbox"
														checked={Boolean(value)}
														onChange={(event) =>
															setMacroFieldValues((current) => ({
																...current,
																[field.name]: event.target.checked,
															}))
														}
													/>
												) : (
													<input
														id={fieldInputId}
														ref={firstFieldRef}
														type={field.type === 'number' ? 'number' : 'text'}
														value={String(value ?? '')}
														placeholder={field.placeholder}
														onChange={(event) =>
															setMacroFieldValues((current) => ({
																...current,
																[field.name]:
																	field.type === 'number'
																		? Number(event.target.value || 0)
																		: event.target.value,
															}))
														}
													/>
												)}
											</div>
										);
									})}
								</div>

								<div className="macro-parameter-preview">
									<div className="macro-parameter-preview__label">Preview</div>
									<div className="project-edit-preview project-edit-preview--multiline">
										<pre>
											{tryRenderMacroTemplate(
												macroToRun.template,
												macroFieldValues,
											)}
										</pre>
									</div>
								</div>
							</div>

							<div className="project-edit-actions">
								<button type="button" onClick={closeMacroParameterModal}>
									Cancel
								</button>
								<button type="submit">Type Macro</button>
							</div>
						</form>
					</ModalBackdrop>
				) : null}
			</section>
		);
	},
);

ProjectWorkspace.displayName = 'ProjectWorkspace';

const requestedWorkspaceViewId =
	new URLSearchParams(window.location.search).get('view') ??
	new URLSearchParams(window.location.hash.slice(1)).get('view');

export type AppProps = {
	auxiliaryRoutes?: AuxiliaryRouteController;
	hostPresentation?: Readonly<{
		nativeMenus: boolean;
		nativeWindowControls: boolean;
	}>;
	subscribeAppCommands?: (
		listener: (command: AppCommand) => Promise<void> | void,
	) => () => void;
	/** Connection-scoped shared client supplied by a migrated host shell. */
	terminalClientContext?: Omit<TerminalPanelClientContextValue, 'projectId'>;
	onDisconnect?: () => void;
	onOpenConnectionManager?: () => void;
	onSwitchConnections?: () => void;
};

export const TERMINAY_APP_COMPONENT_ID =
	'src/App.tsx#App/ProjectWorkspace/Dockview@1';

function normalizeConnectionSwitcherEntries(
	value: unknown,
): ConnectionSwitcherEntry[] {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return [];
	}
	const context = value as {
		profile?: { id?: unknown };
		profiles?: readonly unknown[];
	};
	const selectedId =
		typeof context.profile?.id === 'string' ? context.profile.id : null;
	if (!Array.isArray(context.profiles)) return [];
	return context.profiles
		.flatMap((profile): ConnectionSwitcherEntry[] => {
			if (
				typeof profile !== 'object' ||
				profile === null ||
				Array.isArray(profile)
			) {
				return [];
			}
			const candidate = profile as {
				id?: unknown;
				isLocal?: unknown;
				label?: unknown;
				selected?: unknown;
				status?: unknown;
			};
			if (
				typeof candidate.id !== 'string' ||
				typeof candidate.label !== 'string'
			) {
				return [];
			}
			return [
				{
					id: candidate.id,
					isLocal: candidate.isLocal === true,
					label: candidate.isLocal === true ? 'Local' : candidate.label,
					selected:
						candidate.selected === true ||
						(selectedId !== null && candidate.id === selectedId),
					status:
						typeof candidate.status === 'string' ? candidate.status : 'known',
				},
			];
		})
		.sort(
			(left, right) =>
				Number(right.isLocal) - Number(left.isLocal) ||
				left.label.localeCompare(right.label),
		);
}

function describeConnectionHostError(cause: unknown): string {
	return cause instanceof Error
		? cause.message
		: 'Unable to switch Terminay servers.';
}

function App({
	auxiliaryRoutes,
	hostPresentation,
	onOpenConnectionManager,
	onSwitchConnections,
	subscribeAppCommands,
	terminalClientContext,
}: AppProps) {
	const auxiliaryRouteController = useMemo(
		() => auxiliaryRoutes ?? createAuxiliaryRouteController(),
		[auxiliaryRoutes],
	);
	recordBoundedRendererRender(
		'app',
		`${terminalClientContext?.serverId ?? 'none'}:${terminalClientContext?.workspaceSnapshotStore?.snapshot?.revision ?? 'none'}`,
	);
	recordBootstrapDiagnostic('app.render');
	useEffect(() => {
		recordBootstrapDiagnostic('app.commit');
	}, []);
	const isMac = useMemo(() => navigator.userAgent.includes('Mac'), []);
	const hasNativeWindowControls =
		hostPresentation?.nativeWindowControls ?? false;
	const currentServerId = terminalClientContext?.serverId ?? 'desktop-local';
	const currentServerLabel =
		terminalClientContext?.connectionLabel ??
		(currentServerId === 'desktop-local'
			? 'Local'
			: `Remote · ${currentServerId}`);
	const [workspaceSynchronizationError, setWorkspaceSynchronizationError] =
		useState<string | null>(null);
	const popoutUrl = useMemo(
		() => new URL('popout.html', window.location.href).toString(),
		[],
	);
	const serverMacroSettingsClient = useMemo(() => {
		if (terminalClientContext?.applicationClient === undefined)
			throw new Error('The selected server macro client is unavailable.');
		return createServerMacroSettingsClient(
			new MacroClient(
				new TerminayClientFacade(terminalClientContext.applicationClient),
			),
		);
	}, [terminalClientContext?.applicationClient]);
	const { macros, error: macroSettingsError } = useMacroSettings(
		serverMacroSettingsClient,
	);
	const serverSettingsClient = useMemo(() => {
		if (terminalClientContext?.applicationClient === undefined)
			throw new Error('The selected server settings client is unavailable.');
		return createServerTerminalSettingsClient(
			new SettingsClient(
				new TerminayClientFacade(terminalClientContext.applicationClient),
			),
		);
	}, [terminalClientContext?.applicationClient]);
	const remoteAccessClients = useMemo(
		() =>
			terminalClientContext?.applicationClient === undefined
				? undefined
				: createServerRemoteAccessClients(
						terminalClientContext.applicationClient,
					),
		[terminalClientContext?.applicationClient],
	);
	const { settings, error: terminalSettingsError, settingsClient } =
		useTerminalSettings(serverSettingsClient);
	const settingsRef = useRef(settings);
	useEffect(() => {
		settingsRef.current = settings;
	}, [settings]);
	const persistProjectSidebarVisibility = useCallback(
		(projectId: string, isOpen: boolean) => {
			const nextSettings = {
				...settingsRef.current,
				sidebar: withProjectSidebarVisibility(
					settingsRef.current.sidebar,
					currentServerId,
					projectId,
					isOpen,
				),
			};
			settingsRef.current = nextSettings;
			void settingsClient
				.update<typeof nextSettings>(nextSettings as unknown as JsonValue)
				.then((updated) => {
					settingsRef.current = updated;
				})
				.catch(() => {
					// The local presentation already reflects the interaction. A later
					// device-settings update or reload reconciles a failed persistence.
				});
		},
		[currentServerId, settingsClient],
	);
	const connectionFeatureError = useMemo(() => {
		const failed =
			macroSettingsError === null
				? terminalSettingsError === null
					? null
					: (['Settings', terminalSettingsError] as const)
				: (['Macros', macroSettingsError] as const);
		if (failed === null) return null;
		const failure = describeServerFeatureFailure(
			failed[0],
			failed[1],
			currentServerId,
		);
		return `${failure.title}. ${failure.detail}`;
	}, [currentServerId, macroSettingsError, terminalSettingsError]);
	const workspaceRefs = useRef(
		new Map<string, ProjectWorkspaceHandle | null>(),
	);
	const draggingProjectIdRef = useRef<string | null>(null);
	const heldActiveProjectIdRef = useRef<string | null>(null);
	const projectCreationInFlightRef = useRef(false);
	const confirmProjectClose = useCallback(
		async (projectId: string) => {
			const preflight = await observeTerminalClosePreflight(
				terminalClientContext?.activityClient,
				{ projectId },
			);
			return confirmTerminalClose('project', preflight);
		},
		[terminalClientContext?.activityClient],
	);
	const workspaceSnapshot =
		terminalClientContext?.workspaceSnapshotStore?.snapshot;
	const boundWorkspaceViewId =
		requestedWorkspaceViewId ?? workspaceSnapshot?.viewOrder[0] ?? null;
	const {
		activeProjectId,
		activeProjectIdRef,
		activateProject,
		addProject,
		adoptedTerminalsByProject,
		canAddProject,
		closeProject,
		commitProjectSidebar,
		homePath,
		isWorkspaceHydrating,
		projectCreationError,
		projects,
		projectsRef,
		setActiveProjectId,
		setProjects,
		updateProject,
	} = useProjectCollection<MovedTerminalTab>({
		confirmProjectClose,
		defaultProjectRoot:
			workspaceSnapshot?.projects[
				workspaceSnapshot.views[boundWorkspaceViewId ?? '']?.projectIds[0] ?? ''
			]?.root ?? '',
		holdProjectOrderRef: draggingProjectIdRef,
		holdActiveProjectIdRef: heldActiveProjectIdRef,
		isAdoptWindow: false,
		onProjectSidebarVisibilityChange: persistProjectSidebarVisibility,
		projectColorScope: currentServerId,
		sidebarSettings: settings.sidebar,
		sidebarVisibilityScope: currentServerId,
		workspaceSnapshotStore: terminalClientContext?.workspaceSnapshotStore,
		workspaceViewId: boundWorkspaceViewId,
	});
	const [pendingProjectCreation, setPendingProjectCreation] =
		useState<PendingProjectCreation | null>(null);
	const {
		draggingProjectId,
		dropPreview,
		handleProjectTabDragEnd,
		handleProjectTabDragMove,
		handleProjectTabDragStart,
		isDraggingTabTornOff,
		isProjectDropTarget,
		popoutProject,
		projectTabBarRef,
	} = useProjectTabTransfer({
		draggingProjectIdRef,
		projectsRef,
		workspaceSnapshotStore: terminalClientContext?.workspaceSnapshotStore,
		workspaceViewId: boundWorkspaceViewId,
	});
	const {
		closePinModal: closePairingPinModal,
		closePairingModal,
		isMenuOpen: isRemoteMenuOpen,
		isPairingModalOpen,
		isPinModalOpen: isPairingPinModalOpen,
		isSavingPin: isSavingPairingPin,
		isToggling: isTogglingRemoteAccess,
		menuRef: remoteMenuRef,
		openPairingQr,
		pairingExpiresAt: selectedPairingExpiresAt,
		pairingOutcome,
		pairingUrl: selectedPairingUrl,
		pinError: pairingPinError,
		pinInput: pairingPinInput,
		setIsMenuOpen: setIsRemoteMenuOpen,
		setPinError: setPairingPinError,
		setPinInput: setPairingPinInput,
		status: remoteStatus,
		submitPin: submitPairingPin,
		toggleExposure: toggleRemoteAccess,
		tone: remoteButtonTone,
		visibleQrCodeDataUrl: visiblePairingQrCodeDataUrl,
	} = useRemoteAccessController(
		remoteAccessClients?.pairingPin,
		remoteAccessClients?.status,
		auxiliaryRouteController.openSettings,
	);
	const [connectionSwitcherEntries, setConnectionSwitcherEntries] = useState<
		ConnectionSwitcherEntry[]
	>([]);
	const [connectionSwitcherError, setConnectionSwitcherError] = useState<
		string | null
	>(null);
	const refreshConnectionSwitcherEntries = useCallback(() => {
		void (async () => {
			try {
				if (window.terminayHost !== undefined) {
					const entries = normalizeConnectionSwitcherEntries(
						await window.terminayHost.getContext(),
					);
					if (entries.length > 0) {
						setConnectionSwitcherEntries(entries);
						return;
					}
				}
			} catch {
				// Fall through to the empty web/unsupported state.
			}
			setConnectionSwitcherEntries([]);
		})();
	}, []);
	useEffect(() => {
		if (!isRemoteMenuOpen) return;
		refreshConnectionSwitcherEntries();
	}, [isRemoteMenuOpen, refreshConnectionSwitcherEntries]);
	const selectConnectionProfile = useCallback(
		(profileId: string) => {
			setConnectionSwitcherError(null);
			const select = (id: string) =>
				window.terminayHost?.requestAction({
					type: 'connection.select',
					profileId: id,
				}) ??
				Promise.reject(
					new Error('Connection switching is unavailable in this host.'),
				);
			void select(profileId)
				.then(() => {
					setIsRemoteMenuOpen(false);
					setConnectionSwitcherError(null);
					refreshConnectionSwitcherEntries();
				})
				.catch((cause: unknown) => {
					setConnectionSwitcherError(describeConnectionHostError(cause));
					setIsRemoteMenuOpen(true);
					refreshConnectionSwitcherEntries();
				});
		},
		[refreshConnectionSwitcherEntries, setIsRemoteMenuOpen],
	);
	const pairingModal = useDraggableModal(isPairingModalOpen);
	const [appUpdateStatus, setAppUpdateStatus] =
		useState<AppUpdateStatus | null>(null);
	const activityMenuRef = useRef<HTMLDivElement | null>(null);
	const [isActivityMenuOpen, setIsActivityMenuOpen] = useState(false);
	const projectEnvironmentsClient = useMemo(
		() =>
			terminalClientContext?.applicationClient === undefined
				? null
				: new ProjectEnvironmentsClient(
						new TerminayClientFacade(terminalClientContext.applicationClient),
					),
		[terminalClientContext?.applicationClient],
	);
	const [projectEnvironmentChoices, setProjectEnvironmentChoices] = useState<
		readonly ProjectEnvironmentSummaryDto[]
	>([]);
	const [projectEnvironmentProviders, setProjectEnvironmentProviders] =
		useState<readonly ProjectEnvironmentProviderDescriptor[]>([]);
	const [projectEnvironmentProfiles, setProjectEnvironmentProfiles] = useState<
		readonly ProjectEnvironmentClientProfile[]
	>([]);
	const applyProjectEnvironmentSnapshot = useCallback(
		(snapshot: Awaited<ReturnType<ProjectEnvironmentsClient['snapshot']>>) => {
			setProjectEnvironmentChoices(snapshot.environments);
			setProjectEnvironmentProviders(snapshot.providers);
			setProjectEnvironmentProfiles(snapshot.profiles);
		},
		[],
	);
	const refreshProjectEnvironmentChoices = useCallback(async () => {
		if (projectEnvironmentsClient === null) return;
		try {
			const snapshot = await projectEnvironmentsClient.snapshot();
			applyProjectEnvironmentSnapshot(snapshot);
		} catch {
			// Preserve the last authenticated inventory during connection recovery.
			// Opening the chooser retries against the current server transport.
		}
	}, [applyProjectEnvironmentSnapshot, projectEnvironmentsClient]);
	const createInitialTerminalForProject = useCallback(
		async (projectId: string) => {
			const terminalClient = terminalClientContext?.client;
			const workspace = terminalClientContext?.workspaceSnapshotStore;
			if (terminalClient === undefined || workspace === undefined) {
				throw new Error('The selected server workspace is not ready.');
			}
			const { sessionId } = await terminalClient.create({ projectId });
			const snapshot = await workspace.waitForSnapshot((candidate) =>
				hasTerminalPresentation(candidate, sessionId),
			);
			if (snapshot === null) {
				throw new Error('The server did not publish the new project terminal.');
			}
			const startedAt = performance.now();
			await new Promise<void>((resolve, reject) => {
				const waitForCreatedPresentation = () => {
					const terminalPanel = document.querySelector(
						`.project-workspace[data-terminay-project-id="${CSS.escape(projectId)}"] .terminal-panel[data-terminay-terminal-session-id="${CSS.escape(sessionId)}"]`,
					);
					const attachmentError = terminalPanel?.querySelector(
						'.terminal-panel-connection-error',
					);
					if (attachmentError?.textContent) {
						reject(new Error(attachmentError.textContent.trim()));
						return;
					}
					if (
						terminalPanel?.querySelector('.xterm-helper-textarea') &&
						!terminalPanel.querySelector('.terminal-panel-loading')
					) {
						resolve();
						return;
					}
					if (performance.now() - startedAt >= 30_000) {
						reject(new Error('The new project terminal did not become ready.'));
						return;
					}
					window.requestAnimationFrame(waitForCreatedPresentation);
				};
				waitForCreatedPresentation();
			});
			return sessionId;
		},
		[
			terminalClientContext?.client,
			terminalClientContext?.workspaceSnapshotStore,
		],
	);
	useEffect(() => {
		let active = true;
		if (projectEnvironmentsClient === null) return;
		void projectEnvironmentsClient.snapshot().then(
			(snapshot) => {
				if (active) applyProjectEnvironmentSnapshot(snapshot);
			},
			() => undefined,
		);
		return () => {
			active = false;
		};
	}, [applyProjectEnvironmentSnapshot, projectEnvironmentsClient]);
	useEffect(() => {
		const openEnvironments = () => {
			void auxiliaryRouteController.openProjectEnvironments();
		};
		const openExtensions = () => {
			void auxiliaryRouteController.openSettings('extensions');
		};
		window.addEventListener(
			'terminay-open-project-environments',
			openEnvironments,
		);
		window.addEventListener('terminay-open-extensions', openExtensions);
		return () => {
			window.removeEventListener(
				'terminay-open-project-environments',
				openEnvironments,
			);
			window.removeEventListener('terminay-open-extensions', openExtensions);
		};
	}, [auxiliaryRouteController]);
	const createProjectForEnvironment = useCallback(
		async (environment: ProjectEnvironmentSummaryDto) => {
			if (projectEnvironmentsClient === null || boundWorkspaceViewId === null) {
				return;
			}
			if (
				pendingProjectCreation !== null ||
				projectCreationInFlightRef.current
			) {
				return;
			}
			projectCreationInFlightRef.current = true;
			const initialActiveProjectId = activeProjectIdRef.current;
			heldActiveProjectIdRef.current = initialActiveProjectId;
			const projectNumber =
				Object.keys(
					terminalClientContext?.workspaceSnapshotStore?.snapshot?.projects ?? {},
				).length + 1;
			const pendingId = `pending-project-${Date.now().toString(36)}`;
			const pendingTab: ProjectTab = {
				...createProjectTab(
					projectNumber,
					environment.defaultRoot ?? '',
					projectsRef.current.map((project) => project.color),
					settings.sidebar,
					currentServerId,
				),
				creationStatus: 'loading',
				environmentLabel: environment.name,
				environmentStatus: 'connecting',
				id: pendingId,
				projectEnvironmentId: environment.id,
				title: `Project ${projectNumber}`,
			};
			const pending: PendingProjectCreation = {
				initialActiveProjectId,
				tab: pendingTab,
			};
			setPendingProjectCreation(pending);
			try {
				const operation = await projectEnvironmentsClient.createProject({
					environmentId: environment.id,
					viewId: boundWorkspaceViewId,
					...(environment.defaultRoot === undefined
						? {}
						: { root: environment.defaultRoot }),
				});
				if (operation.projectId === undefined) {
					throw new Error(
						'The selected server did not return the new project identity.',
					);
				}
				setPendingProjectCreation({
					...pending,
					projectId: operation.projectId,
				});
				const sessionId = await createInitialTerminalForProject(
					operation.projectId,
				);
				await terminalClientContext?.workspaceSnapshotStore?.refresh();
				const desiredProjectId = heldActiveProjectIdRef.current;
				heldActiveProjectIdRef.current = null;
				projectCreationInFlightRef.current = false;
				setPendingProjectCreation(null);
				if (desiredProjectId === initialActiveProjectId) {
					activeProjectIdRef.current = operation.projectId;
					setActiveProjectId(operation.projectId);
					window.requestAnimationFrame(() =>
						scheduleCreatedTerminalFocus(sessionId),
					);
				} else if (desiredProjectId !== null) {
					activateProject(desiredProjectId);
				}
			} catch (error) {
				heldActiveProjectIdRef.current = null;
				setPendingProjectCreation((current) => ({
					...(current ?? pending),
					tab: {
						...(current?.tab ?? pendingTab),
						creationError:
							error instanceof Error ? error.message : String(error),
						creationStatus: 'failed',
					},
				}));
			}
		},
		[
			activateProject,
			activeProjectIdRef,
			boundWorkspaceViewId,
			createInitialTerminalForProject,
			currentServerId,
			pendingProjectCreation,
			projectEnvironmentsClient,
			projectsRef,
			settings.sidebar,
			setActiveProjectId,
			terminalClientContext?.workspaceSnapshotStore,
		],
	);
	const chooseProjectEnvironment = useCallback(
		(environment: ProjectEnvironmentSummaryDto) => {
			void createProjectForEnvironment(environment);
		},
		[createProjectForEnvironment],
	);
	const createThisServerProject = useCallback(async () => {
		if (projectEnvironmentsClient === null || boundWorkspaceViewId === null) {
			// Disconnected workspaces retain their existing local-only
			// creation path; authenticated server workspaces never bypass validation.
			addProject();
			return;
		}
		const thisServer = projectEnvironmentChoices.find(
			(environment) => environment.id === 'terminay:this-server',
		) ?? {
			endpointSummary: 'Local embedded server',
			id: 'terminay:this-server',
			isThisServer: true,
			name: 'This server',
			providerId: 'terminay:this-server',
			providerLabel: 'This Terminay Server',
			referencedProjectCount: 0,
			status: 'ready' as const,
		};
		await createProjectForEnvironment(thisServer);
	}, [
		addProject,
		boundWorkspaceViewId,
		createProjectForEnvironment,
		projectEnvironmentChoices,
		projectEnvironmentsClient,
	]);
	const [terminalActivityItemsByProject, setTerminalActivityItemsByProject] =
		useState<Record<string, TerminalActivityOverviewItem[]>>({});
	const [agentStatusSnapshot, setAgentStatusSnapshot] =
		useState<AgentStatusSnapshot>(EMPTY_AGENT_STATUS_SNAPSHOT);

	useEffect(() => {
		let disposed = false;
		const acceptSnapshot = (snapshot: AgentStatusSnapshot) => {
			if (!disposed) setAgentStatusSnapshot(snapshot);
		};
		const agentStatusClient = terminalClientContext?.agentStatusClient;
		if (agentStatusClient === undefined) {
			setAgentStatusSnapshot(EMPTY_AGENT_STATUS_SNAPSHOT);
			return () => {
				disposed = true;
			};
		}
		const unsubscribe = subscribeServerAgentSnapshots(
			agentStatusClient,
			acceptSnapshot,
		);
		void agentStatusClient.refresh().then(
			() =>
				acceptSnapshot(adaptServerAgentSnapshot(agentStatusClient.snapshot)),
			() => {},
		);
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, [terminalClientContext?.agentStatusClient]);

	useEffect(() => {
		const store = terminalClientContext?.workspaceSnapshotStore;
		if (store === undefined) return;

		let disposed = false;
		let reconcileFrame: number | null = null;
		let reconcileRetryTimer: number | null = null;
		let reconcileRetryRevision = -1;
		let reconcileRetryDeadline = 0;
		const reconcile = (snapshot: NonNullable<typeof store.snapshot>) => {
			if (disposed) return;
			if (snapshot.revision !== reconcileRetryRevision) {
				reconcileRetryRevision = snapshot.revision;
				reconcileRetryDeadline = performance.now() + 2_000;
			}
			recordBootstrapDiagnostic(
				'app.workspace.reconcile',
				Object.keys(snapshot.terminalSessions).length,
			);
			if (reconcileFrame !== null) window.cancelAnimationFrame(reconcileFrame);
			reconcileFrame = window.requestAnimationFrame(() => {
				recordBootstrapDiagnostic('app.workspace.reconcile-frame');
				reconcileFrame = null;
				if (disposed) return;
				let pendingPresentations = 0;
				for (const session of Object.values(snapshot.terminalSessions)) {
					const workspace = workspaceRefs.current.get(session.projectId);
					if (workspace == null) {
						pendingPresentations += 1;
						continue;
					}
					if (workspace.ownsControlSession(session.id)) {
						continue;
					}
					const panel = Object.values(snapshot.panels).find(
						(candidate) => candidate.sessionId === session.id,
					);
					if (panel === undefined) {
						pendingPresentations += 1;
						continue;
					}
					const accepted = workspace.acceptServerTerminal(
						panel.id,
						session.id,
						panel.title,
						panel.cwd,
						session.status,
					);
					if (!accepted) {
						pendingPresentations += 1;
					}
				}
				const canonicalTerminalPanels = Object.values(snapshot.panels).filter(
					(panel) => panel.type === 'terminal',
				);
				// Desktop moves and popouts can present a live server panel in another
				// local workspace without changing its canonical project ownership.
				// Reconcile against global panel existence so those presentations survive;
				// a real close removes the canonical panel from this complete list.
				for (const workspace of workspaceRefs.current.values()) {
					if (workspace == null) continue;
					workspace.reconcileServerPanels(canonicalTerminalPanels);
				}
				if (
					pendingPresentations > 0 &&
					reconcileRetryTimer === null &&
					performance.now() < reconcileRetryDeadline
				) {
					reconcileRetryTimer = window.setTimeout(() => {
						reconcileRetryTimer = null;
						reconcile(snapshot);
					}, 50);
				}
			});
			recordBootstrapDiagnostic('app.workspace.reconcile.end');
		};
		const unsubscribe = store.subscribe(reconcile);
		return () => {
			disposed = true;
			unsubscribe();
			if (reconcileFrame !== null) window.cancelAnimationFrame(reconcileFrame);
			if (reconcileRetryTimer !== null) {
				window.clearTimeout(reconcileRetryTimer);
			}
		};
	}, [terminalClientContext?.workspaceSnapshotStore]);

	useEffect(() => {
		const store = terminalClientContext?.workspaceSnapshotStore;
		if (store === undefined) return;
		return store.subscribeStatus((status) => {
			if (status.state === 'current') {
				setWorkspaceSynchronizationError(null);
				return;
			}
			setWorkspaceSynchronizationError(
				status.state === 'stale'
					? 'Workspace synchronization is stale while Terminay securely resynchronizes it.'
					: 'Workspace synchronization failed. The last confirmed workspace remains visible; reconnect to retry.',
			);
		});
	}, [terminalClientContext?.workspaceSnapshotStore]);

	const onReorder = (newOrder: ProjectTab[]) => {
		projectsRef.current = newOrder;
		setProjects(newOrder);
	};
	const persistMovedProject = useCallback(
		(movedId: string) => {
			const store = terminalClientContext?.workspaceSnapshotStore;
			if (store === undefined || boundWorkspaceViewId === null) return;
			const index = projectsRef.current.findIndex(
				(project) => project.id === movedId,
			);
			if (index < 0) return;
			const current =
				store.snapshot?.views[boundWorkspaceViewId]?.projectIds ?? [];
			const next = projectsRef.current.map((project) => project.id);
			if (
				current.length === next.length &&
				current.every((id, position) => id === next[position])
			) {
				return;
			}
			void store.moveProject({
				index,
				projectId: movedId,
				targetViewId: boundWorkspaceViewId,
			});
		},
		[
			boundWorkspaceViewId,
			projectsRef,
			terminalClientContext?.workspaceSnapshotStore,
		],
	);

	const focusProjectTerminal = useCallback(
		(projectId: string) =>
			workspaceRefs.current.get(projectId)?.focusActiveTerminal(),
		[],
	);
	const openEditProjectWindow = useProjectEditor({
		applicationClient: terminalClientContext?.applicationClient,
		auxiliaryRoutes: auxiliaryRouteController,
		focusProject: focusProjectTerminal,
		homePath,
		projects,
		updateProject,
		workspaceSnapshotStore: terminalClientContext?.workspaceSnapshotStore,
	});
	const moveTerminalToProject = useCallback(
		(sourceProjectId: string, panelId: string, targetProjectId: string) => {
			if (sourceProjectId === targetProjectId) {
				return;
			}

			const sourceWorkspace = workspaceRefs.current.get(sourceProjectId);
			const targetWorkspace = workspaceRefs.current.get(targetProjectId);
			if (!sourceWorkspace || !targetWorkspace) {
				return;
			}

			const movedTerminal = sourceWorkspace.exportTerminalForMove(panelId);
			if (!movedTerminal) {
				return;
			}

			activateProject(targetProjectId);
			window.requestAnimationFrame(() => {
				targetWorkspace.acceptMovedTerminal(movedTerminal);
			});
		},
		[activateProject],
	);

	const toggleActiveProjectExplorer = useCallback(() => {
		const project = projectsRef.current.find(
			(candidate) => candidate.id === activeProjectId,
		);
		if (project === undefined) return;
		updateProject(project.id, {
			isFileExplorerOpen: !project.isFileExplorerOpen,
		});
	}, [activeProjectId, projectsRef, updateProject]);

	const executeCommandOnActiveProject = useCallback(
		(command: AppCommand): Promise<void> => {
			if (command === 'open-project-environments') {
				return auxiliaryRouteController.openProjectEnvironments();
			}
			if (command === 'open-extensions') {
				return auxiliaryRouteController.openSettings('extensions');
			}
			if (command === 'open-settings') {
				return auxiliaryRouteController.openSettings();
			}
			if (command === 'open-macros') {
				return auxiliaryRouteController.openMacros();
			}
			if (command === 'open-remote-control') {
				return auxiliaryRouteController.openRemoteControl();
			}
			return (
				workspaceRefs.current.get(activeProjectId)?.executeCommand(command) ??
				Promise.resolve()
			);
		},
		[activeProjectId, auxiliaryRouteController],
	);

	const updateTerminalActivityOverview = useCallback(
		(projectId: string, items: TerminalActivityOverviewItem[]) => {
			setTerminalActivityItemsByProject((current) => {
				if (items.length === 0) {
					if (!(projectId in current)) {
						return current;
					}

					const { [projectId]: _removed, ...next } = current;
					void _removed;
					return next;
				}

				return {
					...current,
					[projectId]: items,
				};
			});
		},
		[],
	);

	const terminalActivityItems = useMemo(() => {
		const items = projects.flatMap(
			(project) => terminalActivityItemsByProject[project.id] ?? [],
		);
		return buildTerminalActivityOverview(items);
	}, [projects, terminalActivityItemsByProject]);

	const hasTerminalActivityOverview = terminalActivityItems.items.length > 0;

	const activateTerminalFromOverview = useCallback(
		(item: TerminalActivityOverviewItem) => {
			setIsActivityMenuOpen(false);
			activateProject(item.projectId);
			window.requestAnimationFrame(() => {
				workspaceRefs.current
					.get(item.projectId)
					?.activateTerminal(item.panelId, item.sessionId);
			});
		},
		[activateProject],
	);

	useEffect(() => {
		const unsubscribeCommand = subscribeAppCommands?.(
			executeCommandOnActiveProject,
		);

		return () => {
			unsubscribeCommand?.();
		};
	}, [executeCommandOnActiveProject, subscribeAppCommands]);

	useEffect(() => {
		let isMounted = true;

		const refreshUpdateStatus = async (force = false) => {
			const status = force ? await checkForAppUpdate() : null;
			if (!status) {
				return;
			}
			if (isMounted) {
				setAppUpdateStatus(status);
			}
		};

		void refreshUpdateStatus(true);
		const intervalId = window.setInterval(
			() => {
				void refreshUpdateStatus(true);
			},
			60 * 60 * 1000,
		);

		return () => {
			isMounted = false;
			window.clearInterval(intervalId);
		};
	}, []);

	useEffect(() => {
		if (!hasTerminalActivityOverview) {
			setIsActivityMenuOpen(false);
		}
	}, [hasTerminalActivityOverview]);

	useEffect(() => {
		if (!isActivityMenuOpen) {
			return;
		}

		const onPointerDown = (event: globalThis.MouseEvent) => {
			const container = activityMenuRef.current;
			if (!container) {
				return;
			}

			const target = event.target as Node;
			if (container.contains(target)) {
				return;
			}

			setIsActivityMenuOpen(false);
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setIsActivityMenuOpen(false);
			}
		};

		window.addEventListener('mousedown', onPointerDown);
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('mousedown', onPointerDown);
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [isActivityMenuOpen]);

	const isPendingProjectFailure =
		pendingProjectCreation?.tab.creationStatus === 'failed';
	const activeProject = isPendingProjectFailure
		? null
		: (projects.find((project) => project.id === activeProjectId) ?? null);
	const displayedActiveProjectId = isPendingProjectFailure
		? pendingProjectCreation.tab.id
		: activeProjectId;
	const displayedProjects = (pendingProjectCreation
		? [
				...projects.filter(
					(project) => project.id !== pendingProjectCreation.projectId,
				),
				pendingProjectCreation.tab,
			]
		: projects
	).map((project) => {
		const environment = projectEnvironmentChoices.find(
			(candidate) => candidate.id === project.projectEnvironmentId,
		);
		const serverProject = workspaceSnapshot?.projects[project.id];
		const hasTerminal =
			serverProject !== undefined &&
			serverProject.panelIds.some(
				(panelId) => workspaceSnapshot?.panels[panelId]?.type === 'terminal',
			);
		const remote =
			project.projectEnvironmentId !== undefined &&
			project.projectEnvironmentId !== 'terminay:this-server';
		return {
			...project,
			...(environment === undefined
				? {}
				: {
						environmentLabel: environment.name,
						environmentStatus: environment.status,
					}),
			hydrating:
				project.creationStatus !== 'loading' &&
				project.creationStatus !== 'failed' &&
				remote &&
				!hasTerminal,
		};
	});
	const displayedActiveProject =
		displayedProjects.find(
			(project) => project.id === displayedActiveProjectId,
		) ?? activeProject;
	const activateDisplayedProject = (projectId: string) => {
		if (projectId === pendingProjectCreation?.tab.id) return;
		activateProject(projectId);
	};
	const closeDisplayedProject = (projectId: string) => {
		if (projectId !== pendingProjectCreation?.tab.id) {
			closeProject(projectId);
			return;
		}
		if (pendingProjectCreation.projectId !== undefined) {
			closeProject(pendingProjectCreation.projectId, {
				skipConfirmation: true,
			});
		}
		heldActiveProjectIdRef.current = null;
		projectCreationInFlightRef.current = false;
		setPendingProjectCreation(null);
	};
	const hasAppUpdate =
		appUpdateStatus?.hasUpdate === true &&
		typeof appUpdateStatus.releaseUrl === 'string';
	const updateLabel = appUpdateStatus?.latestVersion
		? `Update Now (${appUpdateStatus.latestVersion})`
		: 'Update Now';

	return (
		<div
			className={`app-shell${isMac && hasNativeWindowControls ? ' app-shell--macos' : ''}`}
			data-terminay-app-component={TERMINAY_APP_COMPONENT_ID}
			data-terminay-active-project-id={displayedActiveProjectId}
			data-terminay-server-id={terminalClientContext?.serverId}
			data-terminay-workspace-revision={
				terminalClientContext?.workspaceSnapshotStore?.snapshot?.revision
			}
			style={
				{
					'--terminal-panel-surface': settings.theme.background,
					...(displayedActiveProject?.color
						? { '--project-color': displayedActiveProject.color }
						: {}),
				} as CSSProperties
			}
		>
			<header
				ref={projectTabBarRef}
				className={`project-tabbar${isProjectDropTarget ? ' project-tabbar--drop-target' : ''}`}
			>
				<div className="project-tab-sidebar-toggle-box">
					<button
						type="button"
						className={`project-tab-sidebar-toggle${activeProject?.isFileExplorerOpen ? ' project-tab-sidebar-toggle--active' : ''}`}
						onClick={toggleActiveProjectExplorer}
						disabled={!activeProject}
						aria-label="Toggle file explorer"
						title="Toggle file explorer"
					>
						<svg
							aria-hidden="true"
							width="14"
							height="14"
							viewBox="0 0 14 14"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M2.25 2.25H11.75V11.75H2.25V2.25Z"
								stroke="currentColor"
								strokeWidth="1.4"
							/>
							<path d="M5 2.25V11.75" stroke="currentColor" strokeWidth="1.4" />
						</svg>
					</button>
				</div>
				<ProjectTabList
					activeProjectId={displayedActiveProjectId}
					draggingProjectId={draggingProjectId}
					dropPreview={dropPreview}
					isDraggingTabTornOff={isDraggingTabTornOff}
					onActivate={activateDisplayedProject}
					onClose={closeDisplayedProject}
					onDragEnd={handleProjectTabDragEnd}
					onDragMove={handleProjectTabDragMove}
					onDragStart={handleProjectTabDragStart}
					onEdit={openEditProjectWindow}
					onReorder={(nextProjects) =>
						onReorder(
							nextProjects.filter(
								(project) => project.creationStatus === undefined,
							),
						)
					}
					onReorderCommit={persistMovedProject}
					onSwitcherOpen={() => {
						setIsRemoteMenuOpen(false);
						setIsActivityMenuOpen(false);
					}}
					canCreateProject={
						canAddProject && pendingProjectCreation === null
					}
					onCreateProject={() => void createThisServerProject()}
					projects={displayedProjects}
				/>
				<div className="project-tab-add-box">
					<ProjectEnvironmentSplitButton
						canCreate={canAddProject && pendingProjectCreation === null}
						environments={projectEnvironmentChoices}
						connectionOwnerLabels={Object.fromEntries(
							projectEnvironmentChoices.flatMap((environment) => {
								if (environment.profileId === undefined) return [];
								const profile = projectEnvironmentProfiles.find(
									(candidate) => candidate.id === environment.profileId,
								);
								return profile === undefined
									? []
									: [[environment.id, `${profile.name} · ${environment.providerLabel}`]];
							}),
						)}
					createActions={[
						...projectEnvironmentProviders
							.filter(
								(provider) =>
									provider.profileForm !== undefined &&
									provider.createForm !== undefined,
							)
							.map((provider) => ({
								providerId: provider.providerId,
								mode: 'profile' as const,
								label: provider.displayName.toLocaleLowerCase().includes('puzed')
									? 'New Puzed provider…'
									: `New ${provider.displayName} provider…`,
								description: 'Manage provider credentials and connections.',
							})),
						...projectEnvironmentProviders.flatMap((provider) =>
							projectEnvironmentProfiles
								.filter(
									(profile) =>
										profile.providerId === provider.providerId &&
										provider.createForm !== undefined,
								)
								.map((profile) => ({
									providerId: provider.providerId,
									profileId: profile.id,
									mode: 'environment' as const,
									label: provider.displayName
										.toLocaleLowerCase()
										.includes('puzed')
										? `Create VM in ${profile.name}…`
										: `New ${provider.displayName} connection…`,
									description: profile.name,
								})),
						),
					]}
						onCreateProvider={(action) =>
							void auxiliaryRouteController.openProjectEnvironments({
								providerId: action.providerId,
							mode: action.mode,
								...(action.profileId === undefined
									? {}
									: { profileId: action.profileId }),
							})
						}
						onCreateThisServer={() => void createThisServerProject()}
						onChoose={chooseProjectEnvironment}
						onOpen={() => void refreshProjectEnvironmentChoices()}
						onManageEnvironments={() =>
							void auxiliaryRouteController.openProjectEnvironments()
						}
						onManageExtensions={() =>
							void auxiliaryRouteController.openSettings('extensions')
						}
					/>
				</div>
				<div className="header-actions">
					{hasAppUpdate ? (
						<div className="app-update-status">
							<button
								type="button"
								className="app-update-button"
								onClick={() =>
									void openExternalUrl(appUpdateStatus.releaseUrl as string)
								}
								title={`Open release page for v${appUpdateStatus?.latestVersion}`}
							>
								<span className="app-update-button__dot" aria-hidden="true" />
								<span className="app-update-button__label">{updateLabel}</span>
							</button>
						</div>
					) : null}
					<TerminalActivityOverview
						activityMenuRef={activityMenuRef}
						attentionCount={terminalActivityItems.attentionCount}
						isOpen={isActivityMenuOpen}
						items={terminalActivityItems.items}
						onActivate={activateTerminalFromOverview}
						onToggle={() => {
							setIsRemoteMenuOpen(false);
							setIsActivityMenuOpen((current) => !current);
						}}
						recentCount={terminalActivityItems.recentCount}
						unviewedCount={terminalActivityItems.unviewedCount}
					/>
					<RemoteAccessConnectionMenu
						connectionSwitcherEntries={connectionSwitcherEntries}
						currentServerLabel={currentServerLabel}
						errorMessage={connectionSwitcherError}
						isOpen={isRemoteMenuOpen}
						isToggling={isTogglingRemoteAccess}
						menuRef={remoteMenuRef}
						onOpenConnection={
							onOpenConnectionManager ??
							(() =>
								setConnectionSwitcherError(
									'Connection management is unavailable in this host.',
								))
						}
						onOpenPairingQr={() => void openPairingQr()}
						onSelectConnection={selectConnectionProfile}
						onSwitchConnections={onSwitchConnections}
						onToggleExposure={() => void toggleRemoteAccess()}
						onToggleMenu={() => {
							setIsActivityMenuOpen(false);
							setConnectionSwitcherError(null);
							refreshConnectionSwitcherEntries();
							setIsRemoteMenuOpen((current) => !current);
						}}
						status={remoteStatus}
						tone={remoteButtonTone}
					/>
				</div>
			</header>

			<div className="workspace-stack">
				{isPendingProjectFailure ? (
					<div
						className="workspace-empty-state workspace-empty-state--error"
						role="alert"
					>
						{pendingProjectCreation.tab.creationError ??
							'Project creation failed.'}
					</div>
				) : null}
				{isWorkspaceHydrating ? (
					<div className="workspace-empty-state" role="status">
						Loading workspace...
					</div>
				) : null}
				{projectCreationError !== null ? (
					<div
						className="workspace-empty-state workspace-empty-state--error"
						role="alert"
					>
						{projectCreationError}
					</div>
				) : null}
				{workspaceSynchronizationError !== null ? (
					<div
						className="workspace-empty-state workspace-empty-state--error"
						role="alert"
					>
						{workspaceSynchronizationError}
					</div>
				) : null}
				{connectionFeatureError !== null ? (
					<div
						className="workspace-empty-state workspace-empty-state--error"
						role="alert"
					>
						{connectionFeatureError}
					</div>
				) : null}
				{projects.map((project) => (
					<ProjectWorkspace
						key={project.id}
						ref={(instance) => {
							workspaceRefs.current.set(project.id, instance);
						}}
						agentStatusSnapshot={agentStatusSnapshot}
						auxiliaryRoutes={auxiliaryRouteController}
						isActive={
							!isPendingProjectFailure && project.id === activeProjectId
						}
						isMac={isMac}
						macros={macros}
						onAddProject={createThisServerProject}
						onCloseProject={closeProject}
						onEditProject={openEditProjectWindow}
						onMoveTerminalToProject={moveTerminalToProject}
						onPopoutProject={popoutProject}
						onTerminalActivityOverviewChange={updateTerminalActivityOverview}
						onCommitProjectSidebar={commitProjectSidebar}
						onUpdateProject={updateProject}
						popoutUrl={popoutUrl}
						project={project}
						projects={projects}
						terminalClientContext={terminalClientContext}
						adoptedTerminals={adoptedTerminalsByProject[project.id]}
					/>
				))}
			</div>

			{isPairingPinModalOpen ? (
				<ModalBackdrop onClose={() => closePairingPinModal(false)}>
					<form
						className="project-edit-modal remote-pin-modal"
						onSubmit={submitPairingPin}
						onClick={(event) => event.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-labelledby="remote-pin-modal-title"
					>
						<ModalTitlebar
							title="Remote Pairing PIN"
							titleId="remote-pin-modal-title"
							onClose={() => closePairingPinModal(false)}
						/>
						<p className="file-explorer-name-modal-description">
							Choose a 6-digit PIN. Your browser will use this after scanning a
							Remote Access QR code.
						</p>
						<label>
							<span>Pairing PIN</span>
							<input
								type="password"
								value={pairingPinInput}
								onChange={(event) => {
									setPairingPinInput(
										event.target.value.replace(/\D/g, '').slice(0, 6),
									);
									setPairingPinError(null);
								}}
								inputMode="numeric"
								pattern="[0-9]{6}"
								autoComplete="off"
								spellCheck={false}
								autoFocus
							/>
						</label>
						{pairingPinError ? (
							<p className="remote-pin-modal__error">{pairingPinError}</p>
						) : null}
						<div className="project-edit-actions">
							<button
								type="button"
								onClick={() => closePairingPinModal(false)}
								disabled={isSavingPairingPin}
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={isSavingPairingPin || pairingPinInput.length !== 6}
							>
								{isSavingPairingPin ? 'Saving...' : 'Save PIN'}
							</button>
						</div>
					</form>
				</ModalBackdrop>
			) : null}

			{isPairingModalOpen ? (
				<RemotePairingModal
					dialogRef={(element) => {
						pairingModal.modalRef.current = element;
					}}
					dialogStyle={pairingModal.modalStyle}
					expiresAt={selectedPairingExpiresAt}
					onClose={closePairingModal}
					onTitleMouseDown={pairingModal.handleTitlebarPointerDown}
					pairingUrl={selectedPairingUrl}
					qrCodeDataUrl={visiblePairingQrCodeDataUrl}
					statusMessage={remoteStatus?.webRtcStatusMessage}
					success={pairingOutcome === 'success'}
				/>
			) : null}
		</div>
	);
}

export default App;
