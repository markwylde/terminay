import type { FileViewerClient } from '@terminay/client-core';
import type { JsonValue } from '@terminay/protocol';
import {
	type ActivitySessionSnapshot,
	MacroClient,
	SettingsClient,
	type ShellProfileCatalogueEntry,
	ShellProfilesClient,
	TerminayAiClient,
	TerminayClientFacade,
} from '@terminay/client-core';
import type { DockviewApi, IDockviewPanel } from 'dockview';
import { DockviewReact } from 'dockview';
import {
	CircleStop,
	Eraser,
	FolderPlus,
	FolderSync,
	GitBranch,
	GitBranchPlus,
	GitPullRequestArrow,
	History,
	House,
	LayoutDashboard,
	Loader2,
	Mic,
	Play,
	Plug,
	PanelBottom,
	RefreshCw,
	Trash2,
	Settings,
	Sidebar,
	Sparkles,
	Terminal,
	Workflow,
	X,
} from 'lucide-react';
import {
	CSSProperties,
	type FormEvent,
	forwardRef,
	type MouseEvent,
	type MutableRefObject,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
	FocusedFileSummary,
	FocusedTerminalSummary,
	useFocusedFileStatus,
	useFocusedTerminalStatus,
	WorkspaceStatusBar,
} from './workspace/WorkspaceStatusBar';
import { remoteIndicatorState } from './workspace/workspaceStatusBarModel';
import { publishStatusBarVisibility } from './shared/statusBarVisibility';
import {
	aggregateAgentStatusForTerminal,
	EMPTY_AGENT_STATUS_SNAPSHOT,
	selectLiveAgentStatusEntries,
	selectLiveAgentStatusesForProject,
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
import { resolveOpenPresentation } from './components/file-viewer/openFilePresentation';
import { presentationForFolder } from './components/file-viewer/projectRootFileServices';
import { FolderPanel, FolderTab } from './components/folder-viewer';
import {
	EmptyFolderContext,
	type EmptyFolderDescription,
	EmptyFolderPlaceholder,
} from './components/folders/EmptyFolderPlaceholder';
import { FoldersColumn } from './components/folders/FoldersColumn';
import { WorktreeSignInDialog } from './components/git-panel/WorktreeSignInDialog';
import { ChangesPane } from './components/git-panel/ChangesPane';
import { AppUpdateDialog } from './components/AppUpdateDialog';
import { McpInstallModal } from './components/McpInstallModal';
import { SidebarGroupTabs } from './components/sidebar/SidebarGroupTabs';
import {
	applySidebarGroupReorder,
	panelsInSidebarGroup,
	resolveVisibleSidebarGroup,
} from './components/sidebar/sidebarGroups';
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
import {
	checkForAppUpdate,
	installAppUpdate,
	openExternalUrl,
	setApplicationBadgeCount,
} from './host/nativeActions';
import {
	subscribeAppUpdateStatusChanged,
	subscribeWindowFullScreenState,
} from './host/nativeEvents';
import {
	findCommandForKeyboardEvent,
	getCommandShortcut,
	getCommandShortcutLabel,
} from './keyboardShortcuts';
import { tryRenderMacroTemplate } from './macroSettings';
import { getPathRelativeToRoot } from './pathUtils';
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
	clearTransportFeatureFailure,
	describeFeatureFailure,
	describeServerFeatureFailure,
	featureProjectRoot,
	isCancelledFeatureFailure,
	isOptionalObservationFailure,
	isTransportFeatureFailure,
	resolveProjectFeatureAuthority,
} from './shared/featureQueryAuthority';
import { isConnectionReconnecting } from './shared/connections/connectionRegistry';
import { composeProjectTerminalClientContext } from './shared/projectTerminalClientContext';
import { RemotePairingModal } from './shared/RemotePairingModal';
import {
	adaptServerAgentSnapshot,
	subscribeServerAgentSnapshots,
} from './shared/rendererAgentConnection';
import { recordBoundedRendererRender } from './shared/renderLoopGuard';
import {
	hasTerminalPresentation,
	isReservedWorkspaceProject,
	projectReorderInOwnView,
	type ServerWorkspaceFolder,
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
import type {
	SidebarGroupId,
	SidebarPanelId,
	SidebarSettings,
} from './types/settings';
import type {
	AiTabMetadataTarget,
	AppCommand,
	AppUpdateStatus,
	FileSearchResult,
	QuickPushAction,
	TerminalRecordingStartMetadata,
	TerminalRecordingState,
	WorktreePanelStatus,
} from './types/terminay';
import {
	confirmTerminalClose,
	observeTerminalClosePreflight,
} from './workspace/closeProtection';
import { FileExplorerTree } from './workspace/FileExplorerTree';
import { requestFrameOrTimeout } from './workspace/frameOrTimeout';
import {
	createTerminalNoteSync,
	decideTerminalNoteReconcile,
	type TerminalNoteSync,
} from './workspace/terminalNoteSync';
import { CompactChromeRow } from './workspace/CompactChromeRow';
import { CompactSwitcher } from './workspace/CompactSwitcher';
import { serverRows } from './workspace/ConnectionsControl';
import type {
	CompactSwitcherPanelRow,
	CompactSwitcherProjectGroup,
} from './workspace/compactSwitcherModel';
import {
	buildCompactSwitcherGroups,
	filterCompactSwitcherGroups,
} from './workspace/compactSwitcherModel';
import { ProjectTabList } from './workspace/ProjectTabList';
import {
	createProjectAcrossReconnects,
	isConnectionLoss,
	type ResynchronisedProject,
} from './workspace/projectCreationRecovery';
import { useCompactChrome } from './workspace/useCompactChrome';
import {
	createProjectTab,
	isProjectFoldersTreeOpenOnDevice,
	type ProjectTab,
	projectFoldersTreeWidthOnDevice,
	projectSidebarVisibilityKey,
	withProjectFoldersTreeVisibility,
	withProjectFoldersTreeWidth,
	withProjectSidebarActiveGroup,
	withProjectSidebarVisibility,
} from './workspace/projectTabModel';
import {
	activeSessionMemoryKey,
	commandFolderId,
	type FolderInventories,
	FolderWorkspaceRegistry,
	folderIdOfInventoryPanel,
	folderOfSession,
	foldersToMount,
	folderWorkspaceKey,
	mergeProjectInventories,
	withFolderInventory,
} from './workspace/folderWorkspaces';
import {
	activePanelIdFromInventory,
	buildProjectFolderTree,
	folderNameFromStatus,
} from './workspace/folderTreeSources';
import {
	type FolderTerminalCapture,
	type FrontPanelHistory,
	recordFrontPanel,
	wasLookingAt,
} from './workspace/folderCapture';
import { folderChanges, isGitProject } from './workspace/folderWorktree';
import { ProjectTabPeek } from './workspace/ProjectTabPeek';
import { openTerminalTabMenuOnceDrawn } from './workspace/terminalTabMenu';
import { useFolderCaptureEvents } from './workspace/useFolderCaptureEvents';
import { useFolderMenuController } from './workspace/useFolderMenuController';
import {
	composeProjectTabs,
	type ComposedProjectTab,
	panelMoveTargets,
	projectTabAcceptsTerminalDrop,
	projectTabSourceFor,
	shouldNameServers,
} from './workspace/projectTabComposition';
import { useConnectionProjectTabs } from './workspace/useConnectionProjectTabs';
import {
	agentBadgesForOtherServers,
	useConnectionAgentSnapshots,
} from './workspace/useConnectionAgentSnapshots';
import {
	useConnections,
	useServerConnection,
} from './shared/connections/ConnectionsContext';
import {
	type CompositionTabHandle,
	compositionTabKey,
	insertCompositionTabBefore,
	parseCompositionTabKey,
} from './shared/connections/composition';
import {
	type ConnectionSwitcherEntry,
	RemoteAccessConnectionMenu,
} from './workspace/RemoteAccessConnectionMenu';
import {
	type ActivityCountBadge,
	summarizeActivityBadge,
} from './workspace/activityCountBadge';
import { shouldAcknowledgeInteractedActivity } from './workspace/terminalActivityAcknowledgement';
import {
	buildTerminalActivityOverview,
	TerminalActivityOverview,
	type TerminalActivityOverviewItem,
} from './workspace/TerminalActivityOverview';
import {
	areTerminalActivityIndicatorsEnabled,
	buildProjectInventoryEntries,
	getEffectiveTerminalTabColor,
	type InventoryPanelParams,
	type InventoryPanelSource,
	type PanelTabAppearance,
	selectNotableEntries,
	type WorkspaceInventoryEntry,
} from './workspace/workspaceInventory';
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
import { shouldAutoExpandDocumentationPane } from './workspace/documentationAutoExpand';
import { useDocumentationController } from './workspace/useDocumentationController';
import { useFileExplorerController } from './workspace/useFileExplorerController';
import {
	type GitPushMenuTarget,
	useGitPushMenuController,
} from './workspace/useGitPushMenuController';
import { useMacroLauncherController } from './workspace/useMacroLauncherController';
import { useMacroRunController } from './workspace/useMacroRunController';
import { useProjectCollection } from './workspace/useProjectCollection';
import { WorkspaceDashboard } from './workspace/WorkspaceDashboard';
import type {
	AutomationsData,
	AutomationsSectionServer,
} from './workspace/automations/AutomationPanels';
import {
	describeTrigger as describeAutomationTrigger,
	nextRunAt as nextAutomationRunAt,
	overviewOutcome as automationOverviewOutcome,
	selectAutomationServer,
} from './workspace/automations/automationsModel';
import { MissedRunsNotice } from './workspace/automations/MissedRunsNotice';
import {
	McpApprovalsContext,
	useServerMcpApprovals,
} from './workspace/mcpApprovals/useServerMcpApprovals';
import {
	APP_WINDOW_LAYOUT_EVENT,
	AppWindowHost,
} from './workspace/appWindows/AppWindowHost';
import {
	AppWindowsContext,
	useServerAppWindows,
} from './workspace/appWindows/useServerAppWindows';
import {
	type AutomationConnectionEntry,
	useServerAutomations,
} from './workspace/automations/useServerAutomations';
import {
	HomeOverview,
	type HomeOverviewAutomationTarget,
} from './workspace/HomeOverview';
import {
	HomeWorkspace,
	type HomeWorkspaceHandle,
} from './workspace/HomeWorkspace';
import {
	type CommandBarItem,
	CommandBarDialog,
	commandBarPlaceItems,
	filterCommandBarItems,
	useCommandBarNavigation,
	ViewCommandBar,
} from './workspace/CommandBar';
import { buildCrossServerDashboardGroups } from './workspace/crossServerRows';
import {
	type HomeSearchAutomation,
	type HomeSearchResult,
	searchHome,
} from './workspace/homeSearchModel';
import { buildHomeOverview } from './workspace/homeOverviewModel';
import {
	recallHomeSidebarVisible,
	recallSelectedFolder,
	rememberHomeSidebarVisible,
	rememberSelectedFolder,
} from './workspace/localViewState';
import {
	type DashboardActivation,
	type DashboardAgent,
	type DashboardRow,
	resolveAgentActivation,
	resolveDashboardActivation,
} from './workspace/dashboardRows';
import type { DashboardServerSource } from './workspace/crossServerRows';
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
import {
	type TerminalTabDrag,
	useTerminalDockviewWindowController,
} from './workspace/useTerminalDockviewWindowController';
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

type ProjectWorkspaceHandle = {
	acceptMovedTerminal: (
		terminal: MovedTerminalTab,
		options?: { activate?: boolean },
	) => boolean;
	acceptServerTerminal: (
		panelId: string,
		sessionId: string,
		title?: string,
		cwd?: string,
		terminalSessionStatus?: 'running' | 'exited' | 'interrupted',
	) => boolean;
	/**
	 * `canHandOver` says whether the workspace that now owns a panel can take
	 * its presentation. A panel that has left this folder is let go only once
	 * it can, so a terminal is never without a workspace presenting it.
	 */
	reconcileServerPanels: (
		panels: readonly ServerWorkspacePanel[],
		canHandOver?: (panel: ServerWorkspacePanel) => boolean,
	) => void;
	activatePanel: (panelId: string) => void;
	activateTerminal: (panelId: string, sessionId: string) => void;
	/** Acknowledge a terminal exactly as selecting its tab does, without selecting it. */
	acknowledgeTerminal: (sessionId: string) => void;
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
	/** True once this workspace's panel host exists and can be given a panel. */
	isReady: () => boolean;
	/** True when the given terminal session lives in this workspace's project. */
	ownsControlSession: (sessionId: string) => boolean;
	/** The session behind one of this workspace's terminal panels, if any. */
	terminalSessionForPanel: (panelId: string) => string | undefined;
	/** The panel through which this workspace presents a session, if any. */
	terminalPanelForSession: (sessionId: string) => string | undefined;
	/** Show a failure in this project's own error banner. */
	reportError: (message: string) => void;
	/**
	 * Close one of this workspace's panels as closing its tab does: with close
	 * protection for a busy terminal and a save for an unsaved document. It
	 * resolves once the panel has closed or the user has kept it.
	 */
	requestClosePanel: (panelId: string) => Promise<void>;
	/** Create a terminal in this workspace's folder, starting in its root. */
	openShellAtFolderRoot: () => Promise<void>;
	/** The repository's worktree listing as this workspace last read it. */
	worktreeStatus: () => WorktreePanelStatus | null;
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
	onShowDashboard: () => void;
	/** The places the Command Bar offers for what has been typed. */
	searchPlaces: (query: string) => readonly CommandBarItem[];
	/** Toggles the device-local status bar; a window-wide preference. */
	onToggleStatusBar: () => void;
	isStatusBarVisible: boolean;
	/** Where the active project renders its focused-terminal summary. */
	statusBarSlot: HTMLElement | null;
	onEditProject: (projectId: string) => Promise<void>;
	onMoveTerminalToProject: (
		sourceProjectId: string,
		panelId: string,
		targetProjectId: string,
	) => void;
	/** Move a terminal to another folder of this project. */
	onMoveTerminalToFolder: (
		projectId: string,
		panelId: string,
		targetFolderId: string,
	) => void;
	onPopoutProject: (projectId: string) => Promise<void>;
	/** A terminal tab of this project started being dragged, or a drag ended. */
	onTerminalTabDrag?: (projectId: string, drag: TerminalTabDrag | null) => void;
	onWorkspaceInventoryChange: (
		projectId: string,
		folderId: string,
		entries: WorkspaceInventoryEntry[],
	) => void;
	/**
	 * The folder this workspace presents. A workspace is exactly one folder
	 * scope: its panel area, its Files pane, and its new-terminal action all
	 * mean this folder, and it presents no panel of any other.
	 */
	folder: ServerWorkspaceFolder;
	/** Every panel of the project, whichever folder holds it: what the Folders
	 * tree and the Agents pane show beyond this workspace's own panels. */
	projectInventory: readonly WorkspaceInventoryEntry[];
	/** Device-local; the same for every folder of the project. */
	isFoldersTreeOpen: boolean;
	foldersTreeWidth: number;
	onFoldersTreeWidthCommit: (projectId: string, width: number) => void;
	/** True while a terminal of this project is being dragged. */
	acceptsFolderTerminalDrop: boolean;
	onSelectFolder: (projectId: string, folderId: string) => void;
	/** Select a folder of this project and bring one of its panels to the front. */
	onActivateFolderPanel: (
		projectId: string,
		folderId: string,
		panelId: string,
	) => void;
	/** The terminal being dragged was released on a folder of this project. */
	onDropTerminalOnFolder: (projectId: string, folderId: string) => void;
	/** Accept or decline a folder's offer to take the terminal that created
	 * its worktree. The device that accepts follows the terminal there. */
	onAnswerFolderOffer: (
		projectId: string,
		folderId: string,
		answer: 'accept' | 'decline',
	) => void;
	/** Create a terminal in a folder of this project, starting in its root. */
	onOpenShellInFolder: (projectId: string, folderId: string) => void;
	/** Create a terminal in a folder of this project as New terminal does. */
	onNewTerminalInFolder: (projectId: string, folderId: string) => void;
	/** Close a panel of another folder's workspace the ordinary way. */
	onCloseFolderPanel: (
		projectId: string,
		folderId: string,
		panelId: string,
	) => Promise<void>;
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
	/** Decided once by the shell; hides the panel tab strip at phone width. */
	isCompactChrome?: boolean;
	/** Window-wide registry so surfaces outside this project can read a buffer
	 * this window already renders. Never a protocol read. */
	sharedTerminalContextReaders?: MutableRefObject<
		Map<string, TerminalContextReader>
	>;
	/** Optional connection-scoped client used by migrated terminal panels. */
	terminalClientContext?: Omit<TerminalPanelClientContextValue, 'projectId'>;
	/** Terminals to reattach instead of seeding a fresh terminal (adopted project). */
	adoptedTerminals?: MovedTerminalTab[];
};

const DOCKVIEW_SASH_ACTIVITY_DEFER_MS = 300;
/** Home's sidebar is a short menu, so it starts narrower than a project's. */
const HOME_SIDEBAR_DEFAULT_WIDTH = 220;
/** Home's chrome: a neutral slate, never any project's colour. */
const HOME_CHROME_COLOR = '#5f6b7e';
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

function isAgentAttentionState(state: AgentState): boolean {
	return state === 'waiting' || state === 'blocked';
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

const NO_TERMINAL_DROP_TARGETS: readonly string[] = Object.freeze([]);
const NO_WORKSPACE_FOLDERS: Readonly<Record<string, ServerWorkspaceFolder>> =
	Object.freeze({});
const NO_INVENTORY: readonly WorkspaceInventoryEntry[] = Object.freeze([]);
const NO_MOUNTED_FOLDERS: ReadonlySet<string> = new Set();

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
			acceptsFolderTerminalDrop,
			agentStatusSnapshot,
			auxiliaryRoutes,
			folder,
			foldersTreeWidth,
			isActive,
			isCompactChrome = false,
			isFoldersTreeOpen,
			isMac,
			macros,
			onActivateFolderPanel,
			onAddProject,
			onAnswerFolderOffer,
			onCloseFolderPanel,
			onDropTerminalOnFolder,
			onNewTerminalInFolder,
			onOpenShellInFolder,
			onEditProject,
			onFoldersTreeWidthCommit,
			onSelectFolder,
			onMoveTerminalToFolder,
			onMoveTerminalToProject,
			onPopoutProject,
			onTerminalTabDrag,
			onShowDashboard,
			searchPlaces,
			onToggleStatusBar,
			isStatusBarVisible,
			statusBarSlot,
			onWorkspaceInventoryChange,
			onCommitProjectSidebar,
			onUpdateProject,
			popoutUrl,
			project,
			projectInventory,
			projects,
			sharedTerminalContextReaders,
			terminalClientContext,
		},
		ref,
	) => {
		// One count per workspace: a project's folders render together, and
		// sharing a key would read that as one workspace rendering in a loop.
		recordBoundedRendererRender(
			`project-workspace:${project.id}:${folder.id}`,
			`${terminalClientContext?.serverId ?? 'none'}:${terminalClientContext?.workspaceSnapshotStore?.snapshot?.revision ?? 'none'}:${project.rootFolder}`,
		);
		const workspaceSnapshot =
			terminalClientContext?.workspaceSnapshotStore?.snapshot ?? null;
		// The folder as the server knows it. A project no projection describes
		// yet is shown through a stand-in, which is never named to the server.
		const projectedFolderId =
			workspaceSnapshot?.folders[folder.id]?.projectId === project.id
				? folder.id
				: undefined;
		// Only a linked folder has a root of its own. The server resolves it
		// from the folder id; the path here is for showing and for making the
		// paths this workspace sends relative to it.
		const linkedFolderId =
			projectedFolderId !== undefined &&
			folder.kind === 'linked' &&
			folder.worktree !== undefined
				? projectedFolderId
				: undefined;
		const linkedFolderRoot =
			linkedFolderId === undefined ? undefined : folder.worktree?.path;
		/** What this workspace's file and folder panels are rooted at. */
		const folderRootPath = linkedFolderRoot ?? project.rootFolder;
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
		const explorerProjectRoot =
			linkedFolderRoot ??
			featureProjectRoot(featureAvailability, project.rootFolder);
		const explorerProject = useMemo(
			() =>
				explorerProjectRoot === project.rootFolder
					? project
					: { ...project, rootFolder: explorerProjectRoot },
			[explorerProjectRoot, project],
		);
		// Everything a file or folder panel of a linked folder reads goes through
		// clients that name the folder, so it reads that folder's worktree. Any
		// other folder uses the connection's clients unchanged.
		const terminalPanelClientContext =
			useMemo<TerminalPanelClientContextValue | null>(
				() =>
					terminalClientContext === undefined
						? null
						: composeProjectTerminalClientContext(
								linkedFolderId === undefined
									? terminalClientContext
									: {
											...terminalClientContext,
											...(terminalClientContext.fileViewerClient === undefined
												? {}
												: {
														fileViewerClient:
															terminalClientContext.fileViewerClient.forFolder(
																linkedFolderId,
															),
													}),
											...(terminalClientContext.fileObservationClient ===
											undefined
												? {}
												: {
														fileObservationClient:
															terminalClientContext.fileObservationClient.forFolder(
																linkedFolderId,
															),
													}),
											// Documentation, MDX, and language intelligence
											// are still bound to the project root; a file
											// panel that knows it is in a linked folder
											// leaves them alone.
											linkedFolderId,
										},
								project.id,
								folderRootPath,
							),
				[folderRootPath, linkedFolderId, project.id, terminalClientContext],
			);
		const serverActivityClient = terminalClientContext?.activityClient;
		// Agent status is a selected-server projection, not a project-scoped
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
		// The macro launcher searches the project, so it keeps the project's
		// client; the Files pane follows the folder.
		const projectFileViewerClient = featureAuthority?.fileViewerClient;
		const serverFileViewerClient = useMemo(
			() => projectFileViewerClient?.forFolder(linkedFolderId),
			[linkedFolderId, projectFileViewerClient],
		);
		const explorerFileObservationClient = useMemo(
			() => featureAuthority?.fileObservationClient?.forFolder(linkedFolderId),
			[featureAuthority?.fileObservationClient, linkedFolderId],
		);
		const activeSidebarGroup = resolveVisibleSidebarGroup(
			project.sidebarActiveGroup,
			settings.agentIntegration.enabled,
		);
		const isDocumentationGroupVisible =
			project.isFileExplorerOpen && activeSidebarGroup === 'documentation';
		// Indexing latches on at the first visit and then belongs to the project:
		// collapsing the pane or switching sidebar group must not cancel a build.
		const [isDocumentationIndexingStarted, setDocumentationIndexingStarted] =
			useState(false);
		useEffect(() => {
			if (!isDocumentationGroupVisible) return;
			setDocumentationIndexingStarted(true);
			if (
				!shouldAutoExpandDocumentationPane(
					project.id,
					project.isDocumentationPaneCollapsed,
				)
			)
				return;
			onUpdateProject(project.id, { isDocumentationPaneCollapsed: false });
		}, [
			isDocumentationGroupVisible,
			onUpdateProject,
			project.id,
			project.isDocumentationPaneCollapsed,
		]);
		const documentation = useDocumentationController({
			enabled: isDocumentationIndexingStarted,
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
		const ownTerminalContextReadersRef = useRef<
			Map<string, TerminalContextReader>
		>(new Map());
		const terminalContextReadersRef =
			sharedTerminalContextReaders ?? ownTerminalContextReadersRef;
		const terminalControlStateRef = useRef(createTerminalControlState());
		const aiGenerationInFlightRef = useRef<Set<string>>(new Set());
		const workspaceSnapshotStoreRef = useRef(
			terminalClientContext?.workspaceSnapshotStore,
		);
		workspaceSnapshotStoreRef.current =
			terminalClientContext?.workspaceSnapshotStore;
		const terminalNoteSyncRef = useRef<TerminalNoteSync | null>(null);
		if (terminalNoteSyncRef.current === null)
			terminalNoteSyncRef.current = createTerminalNoteSync({
				send: async (panelId, note) => {
					await workspaceSnapshotStoreRef.current?.updatePanel({
						panelId,
						patch: { note },
					});
				},
				onError: (error) =>
					setErrorText(
						`Unable to save the terminal note: ${error instanceof Error ? error.message : String(error)}`,
					),
			});
		const terminalNoteSync = terminalNoteSyncRef.current;
		// The debounce must not outlive the edit: leaving the note field or the
		// page sends whatever is still waiting.
		useEffect(() => {
			const flushOnNoteBlur = (event: FocusEvent) => {
				if (
					event.target instanceof Element &&
					event.target.closest('.terminal-note-editor')
				)
					terminalNoteSync.flushAll();
			};
			const flushOnPageHide = () => terminalNoteSync.flushAll();
			document.addEventListener('focusout', flushOnNoteBlur);
			window.addEventListener('pagehide', flushOnPageHide);
			return () => {
				document.removeEventListener('focusout', flushOnNoteBlur);
				window.removeEventListener('pagehide', flushOnPageHide);
			};
		}, [terminalNoteSync]);
		const movingTerminalSessionIdsRef = useRef<Set<string>>(new Set());
		const [isMcpInstallModalOpen, setIsMcpInstallModalOpen] = useState(false);
		const terminalActivityStoreRef = useRef(new TerminalActivityStore());
		const terminalActivityTimersRef = useRef<Map<string, number>>(new Map());
		const evaluateTerminalActivityStateRef = useRef<
			(sessionId: string, now?: number) => void
		>(() => {});
		const focusedSessionIdRef = useRef<string | null>(null);
		const interactedSessionIdRef = useRef<string | null>(null);
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
		// While the connection that owns this project is between transports,
		// the reconnecting surface is the one message. A refresh that hit the
		// dead transport is that same outage, not a feature failure to report.
		const connectionReconnecting = isConnectionReconnecting(
			useServerConnection(terminalClientContext?.serverId)?.phase,
		);
		const connectionReconnectingRef = useRef(connectionReconnecting);
		connectionReconnectingRef.current = connectionReconnecting;
		// A folder whose worktree directory is gone has nothing to list. Its
		// Files pane says so, and a listing that failed for that reason is not
		// reported a second time as an error.
		const worktreeMissingRef = useRef(false);
		const reportFeatureFailure = useCallback(
			(
				feature: 'Explorer' | 'Agents' | 'Git' | 'Settings',
				error: unknown,
				source: 'action' | 'refresh' = 'action',
			) => {
				if (feature === 'Explorer' && worktreeMissingRef.current) return '';
				if (featureAvailability.state === 'unavailable') {
					setErrorText(featureAvailability.reason);
					return featureAvailability.reason;
				}
				if (isCancelledFeatureFailure(error)) return '';
				if (isOptionalObservationFailure(error)) return '';
				const transport = isTransportFeatureFailure(error);
				if (transport && connectionReconnectingRef.current) return '';
				const failure = describeFeatureFailure(
					feature,
					error,
					featureAvailability.authority.scope,
				);
				const message = `${failure.title}. ${failure.detail}`;
				featureFailureRef.current = {
					feature,
					message,
					transport,
					refresh: source === 'refresh',
				};
				setErrorText(message);
				return message;
			},
			[featureAvailability],
		);
		useEffect(() => {
			// The transport can reject an in-flight refresh before the registry
			// has flipped to reconnecting. Once it has, that notice is stale.
			if (!connectionReconnecting) return;
			const failure = featureFailureRef.current;
			if (failure === null || !failure.transport) return;
			setErrorText((current) => {
				const next = clearTransportFeatureFailure(failure, current);
				featureFailureRef.current = next;
				return next === null ? null : current;
			});
		}, [connectionReconnecting]);
		const clearFeatureFailure = useCallback((feature: 'Explorer' | 'Git') => {
			const failure = featureFailureRef.current;
			if (failure === null) return;
			setErrorText((current) => {
				const next = clearSucceededFeatureFailure(failure, feature, current);
				featureFailureRef.current = next;
				return next === null ? null : current;
			});
		}, []);
		const dismissError = useCallback(() => {
			featureFailureRef.current = null;
			setErrorText(null);
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
			// Agents are the project's, not one folder's: a terminal in another
			// folder is still one of this project's terminals.
			for (const entry of projectInventory) {
				if (entry.sessionId === undefined) continue;
				terminalSessionIds.add(entry.sessionId);
				if (!terminalTitlesBySession.has(entry.sessionId))
					terminalTitlesBySession.set(entry.sessionId, entry.title);
			}
			const priority: Record<AgentState, number> = {
				blocked: 0,
				waiting: 1,
				working: 2,
				done: 3,
				idle: 4,
			};
			// The server scopes each session to projects by directory and worktree,
			// including sessions started outside Terminay; a session bound to one of
			// this project's terminals belongs here wherever its directory is.
			return selectLiveAgentStatusesForProject(
				agentStatusSnapshot,
				project.id,
				terminalSessionIds,
			)
				.slice()
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
					terminalTitle:
						entry.activationTerminalSessionId === null
							? undefined
							: terminalTitlesBySession.get(entry.activationTerminalSessionId),
				}));
		}, [
			agentStatusSnapshot,
			focusedSessionId,
			isDockviewReady,
			project.id,
			projectInventory,
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
				// Same server only. A panel cannot move to a project another server
				// owns, and that is enforced by never offering it as a target.
				return panelMoveTargets(project, projects).map((candidate) => ({
					emoji: candidate.emoji,
					id: candidate.id,
					title: candidate.title,
				}));
			}, [project, projects]);

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

		const getWorkspaceInventoryItems =
			useCallback((): WorkspaceInventoryEntry[] => {
				const api = dockviewApiRef.current;
				if (!api) {
					return [];
				}

				const panels: InventoryPanelSource[] = [];
				for (const group of api.groups) {
					for (const panel of group.panels) {
						panels.push({
							id: panel.id,
							params: panel.params as InventoryPanelParams | undefined,
							...(panel.title === undefined ? {} : { title: panel.title }),
						});
					}
				}

				// Each entry names its folder, so a project's merged inventory can
				// still say where every panel is.
				return buildProjectInventoryEntries({
					agentIntegrationEnabled: settings.agentIntegration.enabled,
					panels,
					project: {
						color: project.color,
						emoji: project.emoji,
						id: project.id,
						title: project.title,
					},
				}).map((entry) => ({ ...entry, folderId: folder.id }));
			}, [
				folder.id,
				project.color,
				project.emoji,
				project.id,
				project.title,
				settings.agentIntegration.enabled,
			]);

		const publishWorkspaceInventory = useCallback(() => {
			onWorkspaceInventoryChange(
				project.id,
				folder.id,
				getWorkspaceInventoryItems(),
			);
		}, [
			folder.id,
			getWorkspaceInventoryItems,
			onWorkspaceInventoryChange,
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
					terminalActivitySince: Date.now(),
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
			onOverviewChanged: publishWorkspaceInventory,
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
				const nextStateSince = aggregate?.stateSince;
				if (
					panel.params?.agentState === nextState &&
					panel.params?.agentNeedsAttention === nextNeedsAttention &&
					panel.params?.agentUnread === nextUnread &&
					panel.params?.agentStateSince === nextStateSince
				) {
					continue;
				}

				panel.api.updateParameters({
					agentState: nextState,
					agentNeedsAttention: nextNeedsAttention,
					agentStateSince: nextStateSince,
					agentUnread: nextUnread,
				});
				didChange = true;
			}

			if (didChange) {
				requestFrameOrTimeout(publishWorkspaceInventory);
			}
		}, [
			agentStatusSnapshot,
			isDockviewReady,
			publishWorkspaceInventory,
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
			// Sessions outside every terminal still belong to this project when the
			// server scoped them to it by directory or worktree.
			serverAgentStatusClient.mergeProjectScope([project.id]);
		}, [focusedSessionId, isDockviewReady, project.id, serverAgentStatusClient]);

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
					if (
						shouldAcknowledgeInteractedActivity({
							acknowledged: snapshot.acknowledged,
							focusedSessionId: focusedSessionIdRef.current,
							interactedSessionId: interactedSessionIdRef.current,
							sessionId: snapshot.sessionId,
							status: snapshot.status,
						})
					) {
						// Finished or attention on a terminal the user is clicking or
						// typing in is acknowledgement, including claimed sessions.
						// Working stays live so the amber indicator remains. A project
						// becoming active is not interaction.
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
			if (!isActive) interactedSessionIdRef.current = null;
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
			window.requestAnimationFrame(() => {
				window.dispatchEvent(
					new CustomEvent('terminay-focus-terminal', {
						detail: { sessionId },
					}),
				);
			});
		}, []);

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
			(
				panelId: string,
				sessionId: string,
				// Going to a terminal dismisses the error on screen. Being put
				// back on one is not that: an error raised meanwhile stays.
				options: { keepError?: boolean } = {},
			) => {
				const panel = activateTerminalPanel({
					api: dockviewApiRef.current,
					panelId,
					sessionId,
				});
				if (!panel) {
					return;
				}
				focusedSessionIdRef.current = sessionId;
				interactedSessionIdRef.current = sessionId;
				setFocusedSessionId(sessionId);
				markTerminalActivityViewed(sessionId);
				if (options.keepError !== true) setErrorText(null);
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
		const activatePanel = useCallback((panelId: string) => {
			dockviewApiRef.current?.getPanel(panelId)?.api.setActive();
		}, []);
		const activateAgentTerminal = useCallback(
			(terminalSessionId: string) => {
				const panel = getPanelForSession(terminalSessionId);
				if (panel) {
					activateTerminal(panel.id, terminalSessionId);
					return;
				}
				// The agent's terminal is in another folder of this project: go
				// to that folder first, then to the terminal.
				const elsewhere = projectInventory.find(
					(entry) => entry.sessionId === terminalSessionId,
				);
				if (elsewhere?.folderId !== undefined)
					onActivateFolderPanel(
						project.id,
						elsewhere.folderId,
						elsewhere.panelId,
					);
			},
			[
				activateTerminal,
				getPanelForSession,
				onActivateFolderPanel,
				project.id,
				projectInventory,
			],
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
						const presentation = presentationForFolder(
							resolveOpenPresentation(
								filePath,
								options,
								existingPanel.params?.presentation ?? 'file-viewer',
							),
							linkedFolderId,
						);
						if (
							existingPanel.params?.presentation === 'documentation' &&
							presentation === 'file-viewer'
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
							presentation &&
							existingPanel.params?.presentation !== presentation
						) {
							existingPanel.api.updateParameters({
								...(existingPanel.params ?? {}),
								presentation,
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
						presentation: presentationForFolder(
							resolveOpenPresentation(filePath, options),
							linkedFolderId,
						),
						initialMode: options?.initialMode,
						inheritsProjectColor: true,
						isFocused: false,
						preferredEngine: 'auto',
						projectColor: project.color,
						projectRoot: folderRootPath,
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
			[folderRootPath, linkedFolderId, project.color, syncPanelFocusState],
		);
		useEffect(() => {
			// A link is followed where it was clicked. Every folder of the project
			// hears this, and only the one on screen can have been clicked in.
			if (!isActive) return;
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
		}, [isActive, openFile]);

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
							...(projectedFolderId === undefined
								? {}
								: { folderId: projectedFolderId }),
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
								requestFrameOrTimeout(publishWorkspaceInventory);
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
				projectedFolderId,
				publishWorkspaceInventory,
				hydrateRecordingStateForSession,
				settings.recording.recordNewTerminals,
				startRecordingForSession,
				terminalPanelClientContext,
				suppressInitialTerminalActivity,
			],
		);

		const {
			cancelFileExplorerNameDialog,
			cleanWorktreeDeleteCount,
			deletingWorktreePaths,
			directoryChildren,
			directoryErrors,
			expandedPaths,
			fileExplorerNameDialog,
			gitStatuses,
			handleCopyPath,
			handleCopyRelativePath,
			handleDelete,
			handleDeleteCleanWorktrees,
			handleDeleteWorktree,
			handleRespondWorktreeSignIn,
			handleNewFile,
			handleNewFolder,
			handleOpenGitEntry,
			handlePullWorktreeFromOrigin,
			handleRename,
			handleRenameWorktree,
			handleLoadWorktreeChecks,
			handleRevealFolder,
			loadingPaths,
			pullingWorktreePaths,
			refreshFileExplorerTree,
			refreshGitStatusesForRoot,
			submitFileExplorerNameDialog,
			toggleDirectory,
			worktreePanelStatus,
		} = useFileExplorerController({
			fileObservationClient: explorerFileObservationClient,
			fileViewerClient,
			gitClient: featureAuthority?.gitClient,
			isServerFileViewer: true,
			onOpenFile: openFile,
			onOperationError: reportFeatureFailure,
			onOperationSucceeded: clearFeatureFailure,
			onSetError: setErrorText,
			project: explorerProject,
		});
		const worktreePanelStatusRef = useRef(worktreePanelStatus);
		worktreePanelStatusRef.current = worktreePanelStatus;
		// The one worktree this folder stands for: what Changes reports.
		const changes = useMemo(
			() => folderChanges(folder, project.rootFolder, worktreePanelStatus),
			[folder, project.rootFolder, worktreePanelStatus],
		);
		const isWorktreeMissing =
			changes.kind === 'worktree' && changes.worktree.isPrunable === true;
		worktreeMissingRef.current = isWorktreeMissing;
		// The directory can vanish, and a listing fail for it, before Git has
		// reported the worktree missing. That failure is the same news the Files
		// pane now gives, so it is withdrawn rather than left standing beside it.
		useEffect(() => {
			if (!isWorktreeMissing) return;
			const failure = featureFailureRef.current;
			if (failure?.feature !== 'Explorer') return;
			setErrorText((current) => {
				if (current !== failure.message) return current;
				featureFailureRef.current = null;
				return null;
			});
		}, [isWorktreeMissing]);
		const isRenderingStatusBar =
			isActive && isStatusBarVisible && statusBarSlot !== null;
		const focusedTerminalStatus = useFocusedTerminalStatus({
			apiRef: dockviewApiRef,
			focusedSessionId,
			getCwd: getServerTerminalCwd,
			isActive: isRenderingStatusBar,
			isDockviewReady,
			titleRevision: terminalTitleRevision,
		});
		const focusedFileStatus = useFocusedFileStatus({
			apiRef: dockviewApiRef,
			isActive: isRenderingStatusBar,
			isDockviewReady,
		});
		// The Folders column's own menu: what is done to the folders as a list.
		const [foldersMenuPosition, setFoldersMenuPosition] = useState<{
			x: number;
			y: number;
		} | null>(null);
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
						projectRootPath: folderRootPath,
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
				folderRootPath,
				project.color,
				project.id,
				syncPanelFocusState,
			],
		);
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
					void refreshGitStatusesForRoot(nextRootFolder, true, undefined, 'root');
				} else {
					const committed = await workspaceSnapshotStore.setProjectRoot({
						projectId: project.id,
						root: nextRootFolder,
					});
					void refreshGitStatusesForRoot(committed.root, true, undefined, 'root');
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
					const params = panel.params as PanelTabAppearance | undefined;
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

			requestFrameOrTimeout(publishWorkspaceInventory);
		}, [
			project.id,
			project.title,
			project.emoji,
			project.color,
			publishWorkspaceInventory,
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

			requestFrameOrTimeout(publishWorkspaceInventory);
		}, [
			publishWorkspaceInventory,
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

					requestFrameOrTimeout(publishWorkspaceInventory);
				} finally {
					// Closing the editor returns the person to their terminal; it
					// must not dismiss an error that arrived while it was open.
					window.requestAnimationFrame(() => {
						if (sessionId) {
							activateTerminal(panelId, sessionId, { keepError: true });
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
				publishWorkspaceInventory,
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

				aiGenerationInFlightRef.current.add(inFlightKey);
				setErrorText(null);
				// The title itself is the server's. Show progress beside it rather
				// than writing a placeholder a reconcile would replace.
				if (target === 'title')
					activePanel.api.updateParameters({ aiTitlePending: true });

				try {
					if (
						serverAiClient === undefined ||
						terminalClientContext === undefined
					)
						throw new Error(
							'AI metadata is unavailable on the selected server.',
						);
					// A note still being typed must reach the server first, so the
					// revision this generation is checked against includes it.
					if (target === 'note')
						await terminalNoteSync.flush(activePanel.id);
					// The server applies the result to the panel; it arrives here as
					// workspace state, like a title or note set anywhere else.
					await serverAiClient.generateMetadata({
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
					setErrorText(null);
				} catch (error) {
					const cause =
						error instanceof Error &&
						typeof error.cause === 'object' &&
						error.cause !== null
							? (error.cause as { code?: unknown })
							: null;
					if (cause?.code === 'conflict') {
						setErrorText(
							`The tab ${target} was changed while AI was generating, so your edit was kept. Run the command again to generate a new ${target}.`,
						);
					} else {
						const message =
							error instanceof Error ? error.message : String(error);
						setErrorText(`Unable to generate tab ${target}: ${message}`);
					}
				} finally {
					if (target === 'title')
						activePanel.api.updateParameters({ aiTitlePending: false });
					aiGenerationInFlightRef.current.delete(inFlightKey);
				}
			},
			[
				project.id,
				serverAiClient,
				settings.aiTabMetadata,
				terminalClientContext,
				terminalNoteSync,
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
			...(projectedFolderId === undefined
				? {}
				: { folderId: projectedFolderId }),
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

		const folderSessionMemoryKey = activeSessionMemoryKey(project.id, folder);
		const { acceptMovedTerminal, acceptServerTerminal } =
			useTerminalAdoptionController({
				activeSessionMemoryKey: folderSessionMemoryKey,
				apiRef: dockviewApiRef,
				cancelMacroRun,
				clearFinishedMacroRuns: clearFinishedMacroRunsForSession,
				clearMacroRun: clearMacroRunForSession,
				getProjectsForMove: getProjectsForTerminalMove,
				hydrateRecording: hydrateRecordingStateForSession,
				onError: setErrorText,
				onMoveToProject: onMoveTerminalToProject,
				onUpdateNote: terminalNoteSync.edit,
				panelSessionsRef: panelSessionMapRef,
				project,
				publishWorkspaceInventory,
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
			(
				panels: readonly ServerWorkspacePanel[],
				canHandOver?: (panel: ServerWorkspacePanel) => boolean,
			) => {
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
						terminalNoteSync.forget(panelId);
						if (panel) api.removePanel(panel);
						continue;
					}
					if (!panel) continue;
					// The server moved this terminal to another project, which now
					// presents it. Letting go of it here closes nothing: the panel
					// and its session stay live under the project that owns them.
					if (canonical.projectId !== project.id) {
						movingTerminalSessionIdsRef.current.add(sessionId);
						api.removePanel(panel);
						continue;
					}
					// Likewise for another folder of this project, which changes
					// nothing about the terminal but where it is shown. It is kept
					// here until that folder's workspace can show it, so it is never
					// shown by neither.
					if (
						projectedFolderId !== undefined &&
						canonical.folderId !== projectedFolderId
					) {
						if (canHandOver?.(canonical) === false) continue;
						movingTerminalSessionIdsRef.current.add(sessionId);
						api.removePanel(panel);
						continue;
					}
					if (canonical.title !== undefined && panel.title !== canonical.title) {
						panel.api.setTitle(canonical.title);
						setTerminalTitleRevision((revision) => revision + 1);
						requestFrameOrTimeout(publishWorkspaceInventory);
					}
					const localNote = panel.params?.terminalNote;
					const noteAction = decideTerminalNoteReconcile({
						canonicalNote: canonical.note,
						localNote,
						firstSeen: terminalNoteSync.markSeen(panelId),
						hasPendingEdit: terminalNoteSync.hasPendingEdit(panelId),
					});
					if (noteAction === 'adopt') terminalNoteSync.edit(panelId, localNote);
					else if (noteAction === 'apply')
						panel.api.updateParameters({ terminalNote: canonical.note });
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
			[
				project.id,
				projectedFolderId,
				publishWorkspaceInventory,
				terminalNoteSync,
			],
		);

		const filteredMacros = useMemo(() => {
			const commandItems: CommandBarItem[] = [
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
						'Let Claude Code, Codex, Cursor CLI, Gemini CLI, Grok, or OpenCode control sibling terminals in this project.',
					searchText:
						'install terminay mcp model context protocol claude codex cursor gemini grok opencode terminal control',
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
					searchText: `edit tab settings rename emoji color file folder terminal ${getCommandShortcut(settings.keyboardShortcuts, 'edit-active-tab')}`,
					shortcutLabel: getCommandShortcutLabel(
						settings.keyboardShortcuts,
						'edit-active-tab',
						isMac,
					),
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
					searchText: `edit project settings project tab root folder emoji color ${getCommandShortcut(settings.keyboardShortcuts, 'edit-active-project')}`,
					shortcutLabel: getCommandShortcutLabel(
						settings.keyboardShortcuts,
						'edit-active-project',
						isMac,
					),
					onSelect: () => {
						openProjectSettings();
					},
				},
				{
					group: 'Workspace',
					icon: <LayoutDashboard size={18} strokeWidth={2.1} />,
					id: 'show-dashboard',
					title: 'Show dashboard',
					description:
						'See every project and tab in this workspace at a glance.',
					searchText: `show dashboard home overview projects tabs status at a glance ${getCommandShortcut(settings.keyboardShortcuts, 'show-dashboard')}`,
					shortcutLabel: getCommandShortcutLabel(
						settings.keyboardShortcuts,
						'show-dashboard',
						isMac,
					),
					onSelect: () => {
						onShowDashboard();
					},
				},
				{
					group: 'Workspace',
					icon: <PanelBottom size={18} strokeWidth={2.1} />,
					id: 'toggle-status-bar',
					title: isStatusBarVisible ? 'Hide status bar' : 'Show status bar',
					description: isStatusBarVisible
						? 'Hide the status bar along the bottom of the window.'
						: 'Show the status bar along the bottom of the window.',
					searchText: `toggle show hide status bar footer working directory branch devices ${getCommandShortcut(settings.keyboardShortcuts, 'toggle-status-bar')}`,
					shortcutLabel: getCommandShortcutLabel(
						settings.keyboardShortcuts,
						'toggle-status-bar',
						isMac,
					),
					onSelect: () => {
						onToggleStatusBar();
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
					(macro): CommandBarItem => ({
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

			// Places come after commands and macros, and only once something is
			// typed. Choosing one leaves the Command Bar.
			return [
				...filterCommandBarItems(commandItems, macroQuery),
				...searchPlaces(macroQuery).map((place) => ({
					...place,
					onSelect: () => {
						setIsMacroLauncherOpen(false);
						setMacroQuery('');
						place.onSelect();
					},
				})),
			];
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
			onShowDashboard,
			onToggleStatusBar,
			isStatusBarVisible,
			openProfileChooser,
			searchPlaces,
			startDictation,
			toggleFileExplorerSidebar,
		]);
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
					case 'edit-active-tab':
						openActiveTerminalSettings();
						break;
					case 'edit-active-project':
						openProjectSettings();
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
					// The dashboard is a view of the whole workspace, so a project
					// hands this one back up rather than answering it itself.
					case 'show-dashboard':
						onShowDashboard();
						break;
					// The status bar belongs to the window, so it is handed back up too.
					case 'toggle-status-bar':
						onToggleStatusBar();
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
				onShowDashboard,
				onToggleStatusBar,
				openActiveTerminalSettings,
				openProjectSettings,
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
				activatePanel,
				activateTerminal,
				acknowledgeTerminal: markTerminalActivityViewed,
				executeCommand(command: AppCommand) {
					return executeAppCommand(command);
				},
				exportTerminalForMove,
				exportProjectForMove,
				focusActiveTerminal,
				isReady: () => dockviewApiRef.current !== null,
				ownsControlSession,
				terminalSessionForPanel: (panelId: string) =>
					panelSessionMapRef.current.get(panelId),
				terminalPanelForSession: (sessionId: string) =>
					[...panelSessionMapRef.current].find(
						([, mapped]) => mapped === sessionId,
					)?.[0],
				reportError: setErrorText,
				requestClosePanel,
				openShellAtFolderRoot: async () => {
					setErrorText(null);
					await addTerminal({ atFolderRoot: true });
				},
				worktreeStatus: () => worktreePanelStatusRef.current,
				handleControlRequest,
			}),
			[
				addTerminal,
				requestClosePanel,
				acceptMovedTerminal,
				acceptServerTerminal,
				reconcileServerPanels,
				activatePanel,
				activateTerminal,
				markTerminalActivityViewed,
				executeAppCommand,
				exportTerminalForMove,
				exportProjectForMove,
				focusActiveTerminal,
				ownsControlSession,
				handleControlRequest,
			],
		);

		// Every rename path — the edit sheet, an AI title, an MCP rename, and
		// canonical reconciliation from the server — bumps this revision, so one
		// effect republishes the inventory for all of them.
		useEffect(() => {
			publishWorkspaceInventory();
		}, [publishWorkspaceInventory, terminalTitleRevision]);

		useEffect(() => {
			focusedSessionIdRef.current = focusedSessionId;
			for (const sessionId of panelSessionMapRef.current.values()) {
				evaluateTerminalActivityState(sessionId);
			}
		}, [evaluateTerminalActivityState, focusedSessionId]);

		useEffect(() => {
			syncFocusedTerminalTabs(focusedSessionId);
			// The panel in front is what the compact breadcrumb names, so a focus
			// change has to reach the published inventory too.
			publishWorkspaceInventory();
		}, [focusedSessionId, publishWorkspaceInventory, syncFocusedTerminalTabs]);

		useEffect(() => {
			syncRunningMacroTabs();
		}, [syncRunningMacroTabs]);

		const closeServerPanel = useCallback(
			(panelId: string) => {
				const store = terminalClientContext?.workspaceSnapshotStore;
				const panel = store?.snapshot?.panels[panelId];
				if (store === undefined || panel?.projectId !== project.id) return;
				// A panel the server has placed in another folder is that folder's.
				// Whatever removed it from this layout, it is not being closed.
				if (panel.folderId !== projectedFolderId) return;
				void store.closePanel(panelId).catch((error: unknown) => {
					const message =
						error instanceof Error
							? error.message
							: 'Unable to close this panel on the server.';
					setErrorText(message);
				});
			},
			[
				project.id,
				projectedFolderId,
				terminalClientContext?.workspaceSnapshotStore,
			],
		);

		const commitServerPanelOrder = useCallback(
			(panelIds: readonly string[]) => {
				const store = terminalClientContext?.workspaceSnapshotStore;
				// A reorder is of this folder's own panels and of no other's.
				const canonicalIds =
					projectedFolderId === undefined
						? undefined
						: store?.snapshot?.folders[projectedFolderId]?.panelIds;
				if (
					store === undefined ||
					canonicalIds === undefined ||
					panelIds.length !== canonicalIds.length ||
					panelIds.some((panelId) => !canonicalIds.includes(panelId)) ||
					panelIds.every((panelId, index) => panelId === canonicalIds[index])
				)
					return;
				void store
					.reorderPanels({
						projectId: project.id,
						...(projectedFolderId === undefined
							? {}
							: { folderId: projectedFolderId }),
						panelIds,
					})
					.catch((error: unknown) => {
						setErrorText(
							error instanceof Error
								? error.message
								: 'Unable to reorder these tabs on the server.',
						);
					});
			},
			[
				project.id,
				projectedFolderId,
				terminalClientContext?.workspaceSnapshotStore,
			],
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
			activeSessionMemoryKey: folderSessionMemoryKey,
			publishWorkspaceInventory,
			setFocusedSessionId,
			setIsDockviewReady,
			syncPanelFocusState,
			terminalActivityTimersRef,
		});

		useEffect(() => {
			// As with a documentation link: opened in the folder on screen.
			if (!isActive) return;
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
		}, [isActive, openFile]);

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
				// Focus moving to another terminal ends the interaction with the one
				// the user was typing in; its later activity is news again.
				if (interactedSessionIdRef.current !== sessionId) {
					interactedSessionIdRef.current = null;
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

				interactedSessionIdRef.current = sessionId;
				markTerminalActivityViewed(sessionId);
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
		}, [getPanelForSession, markTerminalActivityViewed]);

		useEffect(() => {
			return () => {
				onWorkspaceInventoryChange(project.id, folder.id, []);
				for (const timer of terminalActivityTimersRef.current.values()) {
					window.clearTimeout(timer);
				}
				terminalActivityTimersRef.current.clear();
				terminalActivityStoreRef.current.clear();
			};
		}, [folder.id, onWorkspaceInventoryChange, project.id]);

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

		const reportTerminalTabDrag = useCallback(
			(drag: TerminalTabDrag | null) => onTerminalTabDrag?.(project.id, drag),
			[onTerminalTabDrag, project.id],
		);
		useTerminalDockviewWindowController({
			addTerminal,
			apiRef: dockviewApiRef,
			draggingTransferRef,
			isActive,
			onTerminalTabDrag: reportTerminalTabDrag,
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
		}, [
			foldersTreeWidth,
			isActive,
			isFoldersTreeOpen,
			project.fileExplorerWidth,
			project.isFileExplorerOpen,
		]);

		useCommandBarNavigation({
			inputRef: macroLauncherInputRef,
			isOpen: isMacroLauncherOpen,
			itemRefs: macroLauncherItemRefs,
			items: filteredMacros,
			listRef: macroLauncherListRef,
			onClose: closeMacroLauncher,
			selectedIndex: selectedMacroIndex,
			setSelectedIndex: setSelectedMacroIndex,
		});

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

		// The Folders tree is drawn by the workspace on screen. It reads the
		// projection, the project's whole inventory, and the worktree listing
		// the Changes pane already keeps; a workspace behind another builds nothing.
		const folderTreeRows = useMemo(
			() =>
				!isActive || workspaceSnapshot === null
					? []
					: buildProjectFolderTree({
							project: workspaceSnapshot.projects[project.id],
							folders: workspaceSnapshot.folders,
							panels: workspaceSnapshot.panels,
							selectedFolderId: folder.id,
							inventory: projectInventory,
							worktreeStatus: worktreePanelStatus,
						}),
			[
				folder.id,
				isActive,
				project.id,
				projectInventory,
				workspaceSnapshot,
				worktreePanelStatus,
			],
		);
		// A panel's menu offers the other folders of its project. They are named
		// by a key, so a new projection with the same folders changes no tab.
		const foldersForMoveKey = useMemo(() => {
			const projected = workspaceSnapshot?.projects[project.id];
			if (projected === undefined || workspaceSnapshot === null) return '[]';
			return JSON.stringify(
				projected.folderIds.flatMap((folderId) => {
					const candidate = workspaceSnapshot.folders[folderId];
					return candidate === undefined || folderId === folder.id
						? []
						: [
								{
									id: folderId,
									name: folderNameFromStatus(candidate, worktreePanelStatus),
								},
							];
				}),
			);
		}, [folder.id, project.id, workspaceSnapshot, worktreePanelStatus]);
		useEffect(() => {
			const api = dockviewApiRef.current;
			if (api === null || !isDockviewReady) return;
			const foldersForMove = JSON.parse(foldersForMoveKey) as {
				id: string;
				name: string;
			}[];
			const offer = (panel: IDockviewPanel) =>
				panel.api.updateParameters({
					foldersForMove,
					onMoveToFolder: (targetFolderId: string) =>
						onMoveTerminalToFolder(project.id, panel.id, targetFolderId),
				});
			for (const panel of api.panels) offer(panel);
			// A panel that arrives later is offered the same folders.
			const added = api.onDidAddPanel(offer);
			return () => added.dispose();
		}, [foldersForMoveKey, isDockviewReady, onMoveTerminalToFolder, project.id]);
		const [newFolderDialog, setNewFolderDialog] =
			useState<FileExplorerNameDialogState | null>(null);
		const newFolderModal = useDraggableModal(newFolderDialog !== null);
		const newFolderDialogIdRef = useRef(0);
		const cancelNewFolderDialog = useCallback(
			() => setNewFolderDialog(null),
			[],
		);
		const requestNewFolder = useCallback(() => {
			newFolderDialogIdRef.current += 1;
			setNewFolderDialog({
				id: newFolderDialogIdRef.current,
				label: 'Folder name',
				// The modal reports through its own submit and cancel handlers.
				resolve: () => undefined,
				submitLabel: 'Create',
				title: 'New Folder',
			});
		}, []);
		const submitNewFolderDialog = useCallback(
			(name: string) => {
				setNewFolderDialog(null);
				const store = terminalClientContext?.workspaceSnapshotStore;
				if (store === undefined) {
					setErrorText('The selected server workspace is not ready.');
					return;
				}
				// The folder is shown once the server has created it.
				void store
					.createFolder({ projectId: project.id, name })
					.catch((error: unknown) => {
						setErrorText(
							`Unable to create the folder: ${error instanceof Error ? error.message : String(error)}`,
						);
					});
			},
			[project.id, terminalClientContext?.workspaceSnapshotStore],
		);
		// The folder menu runs each worktree action on the worktree of whichever
		// folder was right-clicked, which need not be the one on screen.
		const {
			cancelFolderNameDialog,
			folderMenuElement,
			folderNameDialog,
			openFolderMenu,
			submitFolderNameDialog,
		} = useFolderMenuController({
			project: { id: project.id, rootFolder: project.rootFolder },
			snapshot: workspaceSnapshot,
			store: terminalClientContext?.workspaceSnapshotStore,
			projectInventory,
			worktreeStatus: worktreePanelStatus,
			deletingWorktreePaths,
			pullingWorktreePaths,
			onCommitAndPush: handleOpenWorktreePushMenu,
			onPullFromOrigin: handlePullWorktreeFromOrigin,
			onRenameWorktree: handleRenameWorktree,
			onDeleteWorktree: handleDeleteWorktree,
			onRevealFolder: handleRevealFolder,
			onOpenShell: (folderId) => onOpenShellInFolder(project.id, folderId),
			onClosePanel: (folderId, panelId) =>
				onCloseFolderPanel(project.id, folderId, panelId),
			onError: setErrorText,
		});
		const folderNameModal = useDraggableModal(folderNameDialog !== null);
		// The order is the server's. The tree shows what it asked for until the
		// server answers, and goes back to the server's order if it refuses.
		const reorderFolders = useCallback(
			async (folderIds: string[]) => {
				const store = terminalClientContext?.workspaceSnapshotStore;
				try {
					if (store === undefined)
						throw new Error('The selected server workspace is not ready.');
					await store.reorderFolders({ projectId: project.id, folderIds });
				} catch (error) {
					setErrorText(
						`Unable to reorder the folders: ${error instanceof Error ? error.message : String(error)}`,
					);
					throw error;
				}
			},
			[project.id, terminalClientContext?.workspaceSnapshotStore],
		);
		// What the panel area says while this folder holds no panels.
		const newTerminalShortcutLabel = getCommandShortcutLabel(
			settings.keyboardShortcuts,
			'new-terminal',
			isMac,
		);
		const folderName = folderNameFromStatus(folder, worktreePanelStatus);
		const emptyFolderDescription = useMemo<EmptyFolderDescription>(
			() => ({
				name: folderName,
				...(linkedFolderRoot === undefined
					? {}
					: { worktreePath: linkedFolderRoot }),
				onNewTerminal: () => {
					setErrorText(null);
					void addTerminal({});
				},
				...(newTerminalShortcutLabel
					? { newTerminalShortcutLabel }
					: {}),
			}),
			[addTerminal, folderName, linkedFolderRoot, newTerminalShortcutLabel],
		);

		const sidebarPanelItemsById: Record<SidebarPanelId, SidebarPanelStackItem> =
			{
				explorer: {
					id: 'explorer',
					// Named when the root shown is a folder's worktree, not the project's.
					title:
						linkedFolderId === undefined ? 'Files' : `Files — ${folderName}`,
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
							onClick={() => {
								refreshFileExplorerTree();
								// The user asked: measure Git rather than trust the
								// server's cached listing.
								if (folderRootPath)
									void refreshGitStatusesForRoot(
										folderRootPath,
										true,
										undefined,
										'refresh',
									);
							}}
							aria-label="Reload explorer"
							title="Reload explorer"
						>
							<RefreshCw size={14} aria-hidden="true" />
						</button>
					),
					children:
						featureAvailability.state === 'unavailable' ? (
							<FeatureUnavailableState reason={featureAvailability.reason} />
						) : isWorktreeMissing ? (
							<div className="git-panel__message">
								This worktree&apos;s directory is missing.
							</div>
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
									if (
										entry !== undefined &&
										!entry.external &&
										entry.activationTerminalSessionId !== null
									) {
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
					// The pane keeps the id it has always been stored under, so its
					// place, height, and collapse state carry over. What it shows
					// is the changes of this folder's worktree and of no other.
					title: 'Changes',
					height: project.sidebarGitHeight,
					collapsed: project.isGitPaneCollapsed,
					onToggleCollapsed: () => {
						const next = !project.isGitPaneCollapsed;
						onUpdateProject(project.id, {
							isGitPaneCollapsed: next,
						});
					},
					count:
						changes.kind === 'worktree'
							? changes.worktree.entries.length
							: undefined,
					children:
						featureAvailability.state === 'unavailable' ? (
							<FeatureUnavailableState reason={featureAvailability.reason} />
						) : (
							<ChangesPane
								changes={changes}
								viewMode={settings.sidebar.gitPanelViewMode}
								isDeleting={
									changes.kind === 'worktree' &&
									deletingWorktreePaths.has(changes.worktree.path)
								}
								isPulling={
									changes.kind === 'worktree' &&
									pullingWorktreePaths.has(changes.worktree.path)
								}
								onDelete={handleDelete}
								onNewFile={handleNewFile}
								onNewFolder={handleNewFolder}
								onOpenEntry={handleOpenGitEntry}
								// Every row is in this folder's own worktree, so a
								// changed directory opens as a panel of this folder.
								onOpenFolder={openFolder}
								onOpenTerminal={handleOpenTerminalAt}
								onRename={handleRename}
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
					actions: documentation.loading ? (
						<>
							<span
								className="sidebar-pane__action-spinner"
								role="status"
								aria-label="Indexing documentation"
								title="Indexing documentation"
							>
								<Loader2 size={14} aria-hidden="true" />
							</span>
							<button
								type="button"
								className="sidebar-pane__action-button"
								onClick={documentation.stop}
								aria-label="Stop indexing documentation"
								title="Stop indexing documentation"
							>
								<CircleStop size={14} aria-hidden="true" />
							</button>
						</>
					) : (
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
		const visibleSidebarGroups = (
			['explorer', 'documentation', 'agents'] as const
		).filter(
			(groupId) => settings.agentIntegration.enabled || groupId !== 'agents',
		);
		const groupedSidebarPanelIds = panelsInSidebarGroup(
			activeSidebarGroup,
			visibleSidebarPanelIds,
		);
		const sidebarPanelItems = groupedSidebarPanelIds.map(
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
				data-terminay-folder-id={folder.id}
				data-terminay-folder-kind={folder.kind}
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
					<div className="error-banner">
						<span className="error-banner__message">
							Operation failed: {errorText}
						</span>
						<button
							type="button"
							className="error-banner__dismiss"
							aria-label="Dismiss error"
							title="Dismiss"
							onClick={dismissError}
						>
							<X size={14} aria-hidden="true" />
						</button>
					</div>
				) : null}
				{isRenderingStatusBar && focusedFileStatus !== null
					? createPortal(
							<FocusedFileSummary
								status={focusedFileStatus}
								worktrees={worktreePanelStatus?.worktrees ?? []}
							/>,
							statusBarSlot,
						)
					: isRenderingStatusBar && focusedTerminalStatus !== null
						? createPortal(
								<FocusedTerminalSummary
									status={focusedTerminalStatus}
									worktrees={worktreePanelStatus?.worktrees ?? []}
								/>,
								statusBarSlot,
							)
						: null}

				<WorkspaceSplitLayout
					className="project-workspace-body"
					navigationSide="trailing"
					isFoldersVisible={isFoldersTreeOpen}
					foldersWidth={foldersTreeWidth}
					onFoldersWidthCommit={(width) =>
						onFoldersTreeWidthCommit(project.id, width)
					}
					// A workspace behind another keeps the column's width without
					// drawing the tree, so its terminals are not resized when it
					// comes to the front.
					folders={
						isActive ? (
							<FoldersColumn
								folders={folderTreeRows}
								acceptsTerminalDrop={acceptsFolderTerminalDrop}
								isMenuOpen={foldersMenuPosition !== null}
								onOpenMenu={setFoldersMenuPosition}
								onOpenLink={(url) => void openExternalUrl(url)}
								onLoadChecks={handleLoadWorktreeChecks}
								onAnswerOffer={(folderId, answer) =>
									onAnswerFolderOffer(project.id, folderId, answer)
								}
								onCreateFolder={requestNewFolder}
								onNewTerminal={(folderId) =>
									onNewTerminalInFolder(project.id, folderId)
								}
								onReorderFolders={reorderFolders}
								onFolderMenu={openFolderMenu}
								onDropTerminal={(folderId) =>
									onDropTerminalOnFolder(project.id, folderId)
								}
								onSelectFolder={(folderId) =>
									onSelectFolder(project.id, folderId)
								}
								onSelectTerminal={(folderId, panelId) =>
									onActivateFolderPanel(project.id, folderId, panelId)
								}
								onTerminalMenu={(folderId, panelId, anchor) =>
									openTerminalTabMenuOnceDrawn(panelId, anchor, () =>
										onActivateFolderPanel(project.id, folderId, panelId),
									)
								}
								onTerminalDrag={(drag) =>
									reportTerminalTabDrag(
										drag === null ? null : { panelId: drag.panelId },
									)
								}
							/>
						) : (
							<div className="folders-column" />
						)
					}
					isNavigationVisible={project.isFileExplorerOpen}
					onNavigationDismiss={() => {
						onUpdateProject(project.id, { isFileExplorerOpen: false });
					}}
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
								<SidebarGroupTabs
									activeGroup={activeSidebarGroup}
									groups={visibleSidebarGroups}
									idPrefix={`sidebar-group-${project.id}`}
									onSelect={(groupId) =>
										onUpdateProject(project.id, {
											sidebarActiveGroup: groupId,
										})
									}
								/>
								<div
									className="file-explorer-sidebar__group"
									id={`sidebar-group-${project.id}-panel`}
									role="tabpanel"
									aria-labelledby={`sidebar-group-${project.id}-tab-${activeSidebarGroup}`}
								>
									<SidebarPanelStack
										items={sidebarPanelItems}
										onHeightsCommit={commitSidebarHeights}
										onReorder={(orderedIds) => {
											const reorderedVisibleIds = orderedIds.filter(
												(id): id is SidebarPanelId =>
													groupedSidebarPanelIds.includes(id as SidebarPanelId),
											);
											closeGitPushMenu();
											onUpdateProject(project.id, {
												sidebarPanelOrder: applySidebarGroupReorder(
													project.sidebarPanelOrder,
													activeSidebarGroup,
													reorderedVisibleIds,
												),
											});
										}}
									/>
								</div>

							</div>
						) : null
					}
					content={
						<div
							ref={(element) => {
								workspaceRef.current = element;
							}}
							className={`workspace dockview-theme-dark${isCompactChrome ? ' workspace--compact-chrome' : ''}`}
						>
							<TerminalPanelClientContext.Provider
								value={terminalPanelClientContext}
							>
								<FilePanelSaveRegistryProvider registry={filePanelSaveRegistry}>
									<EmptyFolderContext.Provider value={emptyFolderDescription}>
									<DockviewReact
										components={dockviewComponents}
										tabComponents={dockviewTabComponents}
										watermarkComponent={EmptyFolderPlaceholder}
										popoutUrl={popoutUrl}
										onReady={(event) => {
											handleDockviewReady(event);
											// App windows follow their pane; a layout change can
											// move a pane without resizing it.
											const notify = (): void => {
												window.dispatchEvent(new Event(APP_WINDOW_LAYOUT_EVENT));
											};
											event.api.onDidLayoutChange(notify);
											event.api.onDidActivePanelChange(notify);
										}}
										floatingGroupBounds="boundedWithinViewport"
									/>
									</EmptyFolderContext.Provider>
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
				<CommandBarDialog
					inputRef={macroLauncherInputRef}
					isOpen={isMacroLauncherOpen}
					itemRefs={macroLauncherItemRefs}
					items={filteredMacros}
					listRef={macroLauncherListRef}
					onClose={closeMacroLauncher}
					onQueryChange={setMacroQuery}
					onSelectIndex={setSelectedMacroIndex}
					query={macroQuery}
					selectedIndex={selectedMacroIndex}
				/>

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

				{newFolderDialog ? (
					<FileExplorerNameModal
						dialog={newFolderDialog}
						modal={newFolderModal}
						onCancel={cancelNewFolderDialog}
						onSubmit={submitNewFolderDialog}
					/>
				) : null}

				{folderNameDialog ? (
					<FileExplorerNameModal
						dialog={folderNameDialog}
						modal={folderNameModal}
						onCancel={cancelFolderNameDialog}
						onSubmit={submitFolderNameDialog}
					/>
				) : null}
				{folderMenuElement}
				{/* A forge an extension recognised asks to be signed in to. The
				    pull requests and checks it would bring are shown on the Folders
				    tree, so the question does not wait for the sidebar to be open.
				    One prompt for the window, asked by the workspace on screen;
				    every folder of a project hears of the same one. */}
				{isActive && worktreePanelStatus?.signIn !== undefined ? (
					<WorktreeSignInDialog
						key={worktreePanelStatus.signIn.origin}
						prompt={worktreePanelStatus.signIn}
						onRespond={handleRespondWorktreeSignIn}
					/>
				) : null}
				{foldersMenuPosition ? (
					<ContextMenu
						x={foldersMenuPosition.x}
						y={foldersMenuPosition.y}
						onClose={() => setFoldersMenuPosition(null)}
						items={[
							{
								label: 'New folder',
								icon: <FolderPlus size={14} aria-hidden="true" />,
								onClick: requestNewFolder,
							},
							// A project outside a repository has no worktrees to sweep.
							...(isGitProject(worktreePanelStatus)
								? [
										{ separator: true, label: '', onClick: () => {} },
										{
											label: 'Delete all clean worktrees',
											icon: <Trash2 size={14} aria-hidden="true" />,
											danger: true,
											disabled: cleanWorktreeDeleteCount === 0,
											onClick: () => void handleDeleteCleanWorktrees(),
										},
									]
								: []),
						]}
					/>
				) : null}
				{/* Opened from a folder's menu, so it is drawn whether or not the
				    sidebar is. */}
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
														fileViewerClient={projectFileViewerClient}
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

/** Set by the host for a window that presents a view of its own on a server
 * another window is already showing: the window creates the view if the
 * server does not have it, and stays open while it is empty. */
const requestedOwnWorkspaceView =
	requestedWorkspaceViewId !== null &&
	new URLSearchParams(window.location.search).get('ownView') === '1';

export type AppProps = {
	auxiliaryRoutes?: AuxiliaryRouteController;
	hostPresentation?: Readonly<{
		nativeMenus: boolean;
		nativeWindowControls: boolean;
		/**
		 * Drawn by hosts that render their own application menu in-page, so the
		 * compact row can hold it without the shared workspace learning any
		 * host-only command. Absent on hosts with native menus.
		 */
		renderCompactApplicationMenu?: () => ReactNode;
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
	terminalClientContext: primaryClientContext,
}: AppProps) {
	const {
		connections,
		byServerId,
		primary,
		profiles: connectionProfiles,
		tabOrder: rememberedTabOrder,
		setTabOrder,
		setActiveServerId,
		currentProfileId: windowProfileId,
		selectServer: switchWindowServer,
	} = useConnections();
	// At phone width the header's connection menu is not drawn, so the compact
	// switcher lists the servers and switches between them.
	const [compactSwitchingProfileId, setCompactSwitchingProfileId] =
		useState<string>();
	const compactSwitcherServers = useMemo(
		() =>
			serverRows(
				connectionProfiles,
				windowProfileId,
				compactSwitchingProfileId,
			),
		[compactSwitchingProfileId, connectionProfiles, windowProfileId],
	);
	// The window works in one server at a time: the one whose tab is active.
	// Every surface below reads its client from here, so switching tabs across
	// servers rebinds the whole workspace to the server that owns what is
	// shown, and nothing has to be told twice.
	const [requestedServerId, setRequestedServerId] = useState<string>();
	const activeConnection =
		(requestedServerId === undefined
			? undefined
			: byServerId.get(requestedServerId)) ?? primary;
	// The registry's context is the raw client context; the workspace also needs
	// the connection's label and retry so the header and terminal banners name
	// the server the active tab belongs to instead of a generic remote.
	const terminalClientContext = useMemo<
		typeof primaryClientContext
	>(() => {
		if (activeConnection?.context === undefined) return primaryClientContext;
		if (activeConnection === primary && primaryClientContext !== undefined)
			return primaryClientContext;
		return Object.freeze({
			...activeConnection.context,
			connectionLabel: activeConnection.label,
			retryConnection: () => activeConnection.retry(),
			canRetryConnection: () => true,
		});
	}, [activeConnection, primary, primaryClientContext]);
	const activeServerId = activeConnection?.serverId ?? terminalClientContext?.serverId;
	// A pending activation survives the remount that switching servers causes:
	// the target project only exists once its collection has mounted.
	const pendingServerActivationRef = useRef<CompositionTabHandle | null>(null);
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
	// Fullscreen hides the traffic lights and squares the window corners, so the
	// macOS title-bar adjustments no longer apply.
	const [isWindowFullScreen, setIsWindowFullScreen] = useState(false);
	useEffect(() => subscribeWindowFullScreenState(setIsWindowFullScreen), []);
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
	const [statusBarSlot, setStatusBarSlot] = useState<HTMLDivElement | null>(
		null,
	);
	const persistProjectSidebarActiveGroup = useCallback(
		(projectId: string, groupId: SidebarGroupId) => {
			const nextSettings = {
				...settingsRef.current,
				sidebar: withProjectSidebarActiveGroup(
					settingsRef.current.sidebar,
					currentServerId,
					projectId,
					groupId,
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
	/**
	 * The Folders tree's open state and width, per server and project, on this
	 * device. They are kept with the sidebar's device preferences and are
	 * independent of the sidebar's own visibility. What this window has changed
	 * is shown at once from here rather than after the settings round trip.
	 */
	const [foldersTreeChanges, setFoldersTreeChanges] = useState<
		Readonly<{
			visibility: Readonly<Record<string, boolean>>;
			width: Readonly<Record<string, number>>;
		}>
	>({ visibility: {}, width: {} });
	const persistFoldersTree = useCallback(
		(update: (sidebar: SidebarSettings) => SidebarSettings) => {
			const nextSettings = {
				...settingsRef.current,
				sidebar: update(settingsRef.current.sidebar),
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
		[settingsClient],
	);
	const isFoldersTreeOpenFor = (projectId: string): boolean =>
		foldersTreeChanges.visibility[
			projectSidebarVisibilityKey(currentServerId, projectId)
		] ??
		isProjectFoldersTreeOpenOnDevice(
			settings.sidebar,
			currentServerId,
			projectId,
		);
	const foldersTreeWidthFor = (projectId: string): number =>
		foldersTreeChanges.width[
			projectSidebarVisibilityKey(currentServerId, projectId)
		] ??
		projectFoldersTreeWidthOnDevice(settings.sidebar, currentServerId, projectId);
	const setFoldersTreeOpen = useCallback(
		(projectId: string, isOpen: boolean) => {
			const key = projectSidebarVisibilityKey(currentServerId, projectId);
			setFoldersTreeChanges((current) => ({
				...current,
				visibility: { ...current.visibility, [key]: isOpen },
			}));
			persistFoldersTree((sidebar) =>
				withProjectFoldersTreeVisibility(
					sidebar,
					currentServerId,
					projectId,
					isOpen,
				),
			);
		},
		[currentServerId, persistFoldersTree],
	);
	const commitFoldersTreeWidth = useCallback(
		(projectId: string, width: number) => {
			const key = projectSidebarVisibilityKey(currentServerId, projectId);
			const rounded = Math.round(width);
			setFoldersTreeChanges((current) => ({
				...current,
				width: { ...current.width, [key]: rounded },
			}));
			persistFoldersTree((sidebar) =>
				withProjectFoldersTreeWidth(
					sidebar,
					currentServerId,
					projectId,
					rounded,
				),
			);
		},
		[currentServerId, persistFoldersTree],
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
	// One workspace per folder of each project, found by project and folder.
	const workspaceRefs = useRef(
		new FolderWorkspaceRegistry<ProjectWorkspaceHandle>(),
	);
	/**
	 * Terminal moves this device asked the server for and has not yet seen in a
	 * confirmed projection, by session id, with the project each is headed to
	 * and, for a move between folders, the folder.
	 * It decides one thing: whether this device follows the terminal there.
	 */
	const pendingTerminalMovesRef = useRef(
		new Map<string, Readonly<{ projectId: string; folderId?: string }>>(),
	);
	/**
	 * The folder each project shows on this device. Which folder is in front is
	 * this device's own business, exactly as the tab in front is: it is kept
	 * here and in local storage, and never sent to the server. A project with
	 * no answer shows General.
	 */
	const [selectedFolders, setSelectedFolders] = useState<
		Readonly<Record<string, string>>
	>({});
	const selectedFoldersRef = useRef(selectedFolders);
	const recalledFoldersRef = useRef(new Map<string, string | undefined>());
	const rememberedFolderId = useCallback(
		(projectId: string): string | undefined => {
			const selected = selectedFoldersRef.current[projectId];
			if (selected !== undefined) return selected;
			// Read from storage once per project; what this window selects
			// afterwards is in the map above.
			if (!recalledFoldersRef.current.has(projectId))
				recalledFoldersRef.current.set(
					projectId,
					recallSelectedFolder(projectId),
				);
			return recalledFoldersRef.current.get(projectId);
		},
		[],
	);
	const selectFolder = useCallback((projectId: string, folderId: string) => {
		if (selectedFoldersRef.current[projectId] === folderId) return;
		// The ref is what a callback run after this one reads; the state is what
		// makes the selection render.
		selectedFoldersRef.current = {
			...selectedFoldersRef.current,
			[projectId]: folderId,
		};
		setSelectedFolders(selectedFoldersRef.current);
		rememberSelectedFolder(projectId, folderId);
	}, []);
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
	// A folder can appear, empty, or go without any project tab changing, so
	// the window renders for every projection, not only those that move a tab.
	const [, setWorkspaceRevision] = useState(-1);
	useEffect(() => {
		const store = terminalClientContext?.workspaceSnapshotStore;
		if (store === undefined) return;
		const unsubscribe = store.subscribe((snapshot) =>
			setWorkspaceRevision(snapshot.revision),
		);
		return () => {
			unsubscribe();
		};
	}, [terminalClientContext?.workspaceSnapshotStore]);
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
		isHomeSelected,
		isWorkspaceHydrating,
		projectCreationError,
		projects,
		projectsRef,
		selectHome,
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
		onProjectSidebarActiveGroupChange: persistProjectSidebarActiveGroup,
		projectColorScope: currentServerId,
		sidebarSettings: settings.sidebar,
		sidebarVisibilityScope: currentServerId,
		// The main window shows the workspace's first view; it stays open on
		// Home when its last project closes. A popped-out view's window does not.
		stayOpenWhenEmpty:
			requestedWorkspaceViewId === null ||
			requestedOwnWorkspaceView ||
			requestedWorkspaceViewId === workspaceSnapshot?.viewOrder[0],
		// Only Desktop has several windows; a browser holds every view's projects.
		presentsEveryView: !hasNativeWindowControls,
		workspaceSnapshotStore: terminalClientContext?.workspaceSnapshotStore,
		workspaceViewId: boundWorkspaceViewId,
	});
	const activateProjectRef = useRef(activateProject);
	activateProjectRef.current = activateProject;
	// A window with a view of its own makes that view on the server the first
	// time it is needed. It starts with no projects; they are dragged in.
	const ownViewRequestedRef = useRef(false);
	const ownViewStore = terminalClientContext?.workspaceSnapshotStore;
	const ownViewMissing =
		requestedOwnWorkspaceView &&
		requestedWorkspaceViewId !== null &&
		workspaceSnapshot !== null &&
		workspaceSnapshot !== undefined &&
		workspaceSnapshot.views[requestedWorkspaceViewId] === undefined;
	useEffect(() => {
		if (
			!ownViewMissing ||
			ownViewStore === undefined ||
			requestedWorkspaceViewId === null ||
			ownViewRequestedRef.current
		)
			return;
		ownViewRequestedRef.current = true;
		void ownViewStore
			.createView({ viewId: requestedWorkspaceViewId, name: 'Window' })
			.catch(() => {
				// Another window may have made it first; if it is still missing
				// the next snapshot asks again.
				ownViewRequestedRef.current = false;
			});
	}, [ownViewMissing, ownViewStore]);
	// The host titles the window by its server and adds what the page says it
	// holds: the projects in this window.
	// A window with no projects is showing Home.
	const windowTitleDetail =
		projects.map((project) => project.title).join(', ') || 'Home';
	const hostTitlesWindow = hostPresentation?.nativeWindowControls === true;
	useEffect(() => {
		// A browser tab keeps the page's own title.
		if (hostTitlesWindow) document.title = windowTitleDetail;
	}, [hostTitlesWindow, windowTitleDetail]);
	const [pendingProjectCreation, setPendingProjectCreation] =
		useState<PendingProjectCreation | null>(null);
	// A failed creation is a tab like any other: shown while it is the one
	// selected, and left behind the moment another project is. It records the
	// project it was selected over, so activating any other project by any
	// route deselects it without that route knowing it exists.
	const [failedCreationSelectedOver, setFailedCreationSelectedOver] = useState<
		string | null
	>(null);
	// Home's sidebar is this device's, and it is nobody's project: its
	// visibility is kept apart from every project's sidebar, so toggling one
	// never moves the other.
	const [isHomeSidebarVisible, setIsHomeSidebarVisible] = useState(
		recallHomeSidebarVisible,
	);
	const homeRef = useRef<HomeWorkspaceHandle | null>(null);
	// Home is mounted the first time it is shown and kept from then on, so a
	// window that never visits Home never builds it. A tab asked for before
	// that is opened as soon as Home exists.
	const pendingHomeOpensRef = useRef<
		Parameters<HomeWorkspaceHandle['open']>[0][]
	>([]);
	const openInHome = useCallback(
		(target: Parameters<HomeWorkspaceHandle['open']>[0]) => {
			if (homeRef.current === null) pendingHomeOpensRef.current.push(target);
			else homeRef.current.open(target);
		},
		[],
	);
	const attachHome = useCallback((handle: HomeWorkspaceHandle | null) => {
		homeRef.current = handle;
		if (handle === null) return;
		for (const target of pendingHomeOpensRef.current.splice(0))
			handle.open(target);
	}, []);
	// The Command Bar as the workspace view draws it: with Home in front, or
	// with no project in the window to draw it.
	const [isViewCommandBarOpen, setIsViewCommandBarOpen] = useState(false);
	const [homeSidebarWidth, setHomeSidebarWidth] = useState(
		HOME_SIDEBAR_DEFAULT_WIDTH,
	);
	const setHomeSidebarVisibility = useCallback((visible: boolean) => {
		setIsHomeSidebarVisible(visible);
		rememberHomeSidebarVisible(visible);
	}, []);
	const toggleHomeSidebar = useCallback(() => {
		setHomeSidebarVisibility(!isHomeSidebarVisible);
	}, [isHomeSidebarVisible, setHomeSidebarVisibility]);
	// Switching servers rebinds every workspace surface, so the project the
	// person clicked is only reachable once this server's collection has it.
	useEffect(() => {
		const pending = pendingServerActivationRef.current;
		if (pending === null || pending.serverId !== currentServerId) return;
		if (!projects.some((project) => project.id === pending.projectId)) return;
		pendingServerActivationRef.current = null;
		activateProject(pending.projectId);
	}, [activateProject, currentServerId, projects]);
	const ownProjects = (pendingProjectCreation
		? [
				...projects.filter(
					(project) => project.id !== pendingProjectCreation.projectId,
				),
				pendingProjectCreation.tab,
			]
		: projects
	).map((project) => {
		return { ...project, hydrating: false, serverId: currentServerId };
	});
	// The strip is one composition over every attached server: this server's
	// live collection, plus each other connection's projects read from its own
	// workspace projection.
	const activeTabSource = useMemo(
		() =>
			activeConnection === undefined
				? undefined
				: projectTabSourceFor(activeConnection, ownProjects),
		// `ownProjects` is rebuilt every render by design; the identity of what
		// it describes is the project list and the pending creation.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[activeConnection, projects, pendingProjectCreation],
	);
	const projectTabSources = useConnectionProjectTabs(
		connections,
		activeServerId,
		activeTabSource,
		settings.sidebar,
	);
	const namesServers = shouldNameServers(projectTabSources);
	// Every per-server surface — Settings, Macros, Recordings, Shell profiles,
	// Extensions — defaults to the server the window is working in.
	useEffect(() => {
		setActiveServerId(currentServerId);
	}, [currentServerId, setActiveServerId]);
	// Creating a project chooses which attached server will own it. The
	// default is the active tab's server; choosing another one goes there
	// first, because a project is created in the workspace of its own server.
	const pendingServerCreationRef = useRef<string | null>(null);
	const [projectServerMenu, setProjectServerMenu] = useState<
		Readonly<{ x: number; y: number }> | null
	>(null);
	const createProjectOnServer = useCallback(
		(serverId: string) => {
			setProjectServerMenu(null);
			if (serverId === currentServerId) {
				void createServerProjectRef.current();
				return;
			}
			if (byServerId.get(serverId)?.context === undefined) return;
			pendingServerCreationRef.current = serverId;
			setRequestedServerId(serverId);
		},
		[byServerId, currentServerId],
	);
	useEffect(() => {
		if (pendingServerCreationRef.current !== currentServerId) return;
		pendingServerCreationRef.current = null;
		void createServerProjectRef.current();
	}, [currentServerId]);
	// A detached server takes its tabs with it. The window falls back to the
	// connection it always has, rather than showing an empty workspace bound to
	// a server that is gone.
	useEffect(() => {
		if (requestedServerId === undefined) return;
		if (byServerId.has(requestedServerId)) return;
		pendingServerActivationRef.current = null;
		setRequestedServerId(undefined);
	}, [byServerId, requestedServerId]);
	const {
		clearIncomingProjectDrop,
		draggingProjectId,
		handleProjectTabDragEnd,
		handleProjectTabDragMove,
		handleProjectTabDragStart,
		incomingProjectDrop,
		isDraggingTabTornOff,
		popoutProject,
		projectTabBarRef,
	} = useProjectTabTransfer({
		draggingProjectIdRef,
		projectsRef,
		workspaceSnapshotStore: terminalClientContext?.workspaceSnapshotStore,
		workspaceViewId: boundWorkspaceViewId,
	});
	const {
		approveDevice: approvePairingDevice,
		busyApprovalId: busyPairingApprovalId,
		closePairingModal,
		denyDevice: denyPairingDevice,
		isMenuOpen: isRemoteMenuOpen,
		isPairingModalOpen,
		isToggling: isTogglingRemoteAccess,
		menuRef: remoteMenuRef,
		openPairingQr,
		pairingExpiresAt: selectedPairingExpiresAt,
		pairingOutcome,
		pairingUrl: selectedPairingUrl,
		pendingApproval: pendingPairingApproval,
		setIsMenuOpen: setIsRemoteMenuOpen,
		status: remoteStatus,
		toggleExposure: toggleRemoteAccess,
		tone: remoteButtonTone,
		visibleQrCodeDataUrl: visiblePairingQrCodeDataUrl,
	} = useRemoteAccessController(
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
	const [appUpdateStatus, setAppUpdateStatus] =
		useState<AppUpdateStatus | null>(null);
	const [isAppUpdateDialogOpen, setIsAppUpdateDialogOpen] = useState(false);
	const [isInstallingAppUpdate, setIsInstallingAppUpdate] = useState(false);
	const [appUpdateInstallError, setAppUpdateInstallError] = useState<
		string | null
	>(null);
	const closeAppUpdateDialog = useCallback(() => {
		setIsAppUpdateDialogOpen(false);
		setAppUpdateInstallError(null);
	}, []);
	const activityMenuRef = useRef<HTMLDivElement | null>(null);
	const [isActivityMenuOpen, setIsActivityMenuOpen] = useState(false);
	// One observation of the bar decides compact chrome for every surface that
	// changes at phone width, so a row and the strip under it cannot disagree.
	const isCompactChrome = useCompactChrome(projectTabBarRef);
	// Each layout keeps its own preference: phones default to hidden, and
	// toggling one layout never changes what the other shows. Optimistic, so
	// the bar changes the moment the command runs rather than after the
	// device-settings round trip; settings changes reconcile it.
	const statusBarPreferenceKey = isCompactChrome
		? 'showStatusBarCompact'
		: 'showStatusBar';
	const [statusBarPreference, setStatusBarPreference] = useState({
		showStatusBar: settings.showStatusBar,
		showStatusBarCompact: settings.showStatusBarCompact,
	});
	useEffect(() => {
		setStatusBarPreference({
			showStatusBar: settings.showStatusBar,
			showStatusBarCompact: settings.showStatusBarCompact,
		});
	}, [settings.showStatusBar, settings.showStatusBarCompact]);
	const isStatusBarVisible = statusBarPreference[statusBarPreferenceKey];
	useEffect(() => {
		publishStatusBarVisibility(isStatusBarVisible);
	}, [isStatusBarVisible]);
	const toggleStatusBar = useCallback(() => {
		const nextSettings = {
			...settingsRef.current,
			[statusBarPreferenceKey]: !settingsRef.current[statusBarPreferenceKey],
		};
		settingsRef.current = nextSettings;
		setStatusBarPreference({
			showStatusBar: nextSettings.showStatusBar,
			showStatusBarCompact: nextSettings.showStatusBarCompact,
		});
		void settingsClient
			.update<typeof nextSettings>(nextSettings as unknown as JsonValue)
			.then((updated) => {
				settingsRef.current = updated;
			})
			.catch(() => {
				// The local presentation already reflects the interaction. A later
				// device-settings update or reload reconciles a failed persistence.
			});
	}, [settingsClient, statusBarPreferenceKey]);
	const remoteIndicator = useMemo(
		() =>
			remoteIndicatorState({
				// Only this machine's own server can be "not exposed"; any other
				// server is one this window already reached remotely.
				isDesktopLocal:
					hasNativeWindowControls &&
					(currentServerId === 'desktop-local' ||
						connectionProfiles.some(
							(profile) =>
								profile.isLocal === true &&
								profile.serverId === currentServerId,
						)),
				isExposed: Boolean(remoteStatus?.isRunning),
				connections: remoteStatus?.connections ?? [],
			}),
		[connectionProfiles, currentServerId, hasNativeWindowControls, remoteStatus],
	);
	// Every mounted terminal panel in this window registers its buffer reader
	// here. The switcher reads it; nothing leaves the window.
	const sharedTerminalContextReadersRef = useRef<
		Map<string, TerminalContextReader>
	>(new Map());
	const pendingCompactTerminalRef = useRef<{
		projectId: string;
		serverId: string;
	} | null>(null);
	const [isCompactSwitcherOpen, setIsCompactSwitcherOpen] = useState(false);
	const [compactSwitcherQuery, setCompactSwitcherQuery] = useState('');
	const compactBreadcrumbRef = useRef<HTMLButtonElement | null>(null);
	const compactConnectionRef = useRef<HTMLButtonElement | null>(null);
	const compactSwitcherTriggerRef = useRef<HTMLButtonElement | null>(null);
	const openCompactSwitcher = useCallback(
		(source: 'breadcrumb' | 'connection') => {
			compactSwitcherTriggerRef.current =
				source === 'breadcrumb'
					? compactBreadcrumbRef.current
					: compactConnectionRef.current;
			setIsRemoteMenuOpen(false);
			setIsActivityMenuOpen(false);
			setCompactSwitcherQuery('');
			setIsCompactSwitcherOpen(true);
		},
		[setIsRemoteMenuOpen],
	);
	const closeCompactSwitcher = useCallback(() => {
		setIsCompactSwitcherOpen(false);
		compactSwitcherTriggerRef.current?.focus();
	}, []);
	// Two overlays must never stack: opening either header menu closes this one.
	useEffect(() => {
		if (isRemoteMenuOpen || isActivityMenuOpen) setIsCompactSwitcherOpen(false);
	}, [isActivityMenuOpen, isRemoteMenuOpen]);
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
		const openExtensions = () => {
			void auxiliaryRouteController.openSettings('extensions');
		};
		window.addEventListener('terminay-open-extensions', openExtensions);
		return () => {
			window.removeEventListener('terminay-open-extensions', openExtensions);
		};
	}, [auxiliaryRouteController]);
	// A creation outlives the connection it began on. These let it read the
	// connection that is current when it resumes, and be woken when that changes.
	const creationConnectionRef = useRef({
		context: terminalClientContext,
		phase: activeConnection?.phase,
		version: 0,
	});
	const creationConnectionWaitersRef = useRef(new Set<() => void>());
	const activeConnectionPhase = activeConnection?.phase;
	useEffect(() => {
		creationConnectionRef.current = {
			context: terminalClientContext,
			phase: activeConnectionPhase,
			version: creationConnectionRef.current.version + 1,
		};
		const waiters = [...creationConnectionWaitersRef.current];
		creationConnectionWaitersRef.current.clear();
		for (const wake of waiters) wake();
	}, [terminalClientContext, activeConnectionPhase]);
	const createInitialTerminalForProjectRef = useRef(
		createInitialTerminalForProject,
	);
	createInitialTerminalForProjectRef.current = createInitialTerminalForProject;
	const resynchroniseCreatedProject = useCallback(
		async (projectId: string): Promise<ResynchronisedProject> => {
			for (;;) {
				const { context, phase, version } = creationConnectionRef.current;
				if (phase === 'unreachable' || phase === 'incompatible') return null;
				const store = context?.workspaceSnapshotStore;
				if (store !== undefined && (phase === undefined || phase === 'ready')) {
					try {
						const snapshot = await store.refresh();
						const terminal = Object.values(snapshot.terminalSessions).find(
							(session) => session.projectId === projectId,
						);
						return {
							exists: snapshot.projects[projectId] !== undefined,
							...(terminal === undefined
								? {}
								: { terminalSessionId: terminal.id }),
						};
					} catch (error) {
						if (!isConnectionLoss(error)) throw error;
					}
					// The connection moved on while that was being read.
					if (creationConnectionRef.current.version !== version) continue;
				}
				await new Promise<void>((resolve) => {
					creationConnectionWaitersRef.current.add(resolve);
				});
			}
		},
		[],
	);
	const createServerProjectRef = useRef<() => Promise<void>>(async () => undefined);
	const createServerProject = useCallback(async () => {
		const workspaceStore = terminalClientContext?.workspaceSnapshotStore;
		if (workspaceStore === undefined || boundWorkspaceViewId === null) {
			// Disconnected workspaces retain their existing local-only
			// creation path; authenticated server workspaces never bypass validation.
			addProject();
			return;
		}
		if (projectCreationInFlightRef.current) return;
		if (pendingProjectCreation !== null) {
			if (pendingProjectCreation.tab.creationStatus !== 'failed') return;
			// Starting again replaces the failed attempt, along with any
			// project it got as far as creating.
			if (pendingProjectCreation.projectId !== undefined) {
				closeProject(pendingProjectCreation.projectId, {
					skipConfirmation: true,
				});
			}
			setFailedCreationSelectedOver(null);
		}
		projectCreationInFlightRef.current = true;
		const initialActiveProjectId = activeProjectIdRef.current;
		heldActiveProjectIdRef.current = initialActiveProjectId;
		const projectNumber =
			Object.keys(workspaceStore.snapshot?.projects ?? {}).length + 1;
		const pendingId = `pending-project-${Date.now().toString(36)}`;
		const projectId = `project-${Date.now().toString(36)}-${projectNumber}`;
		const presentation = createProjectTab(
			projectNumber,
			homePath,
			projectsRef.current.map((project) => project.color),
			settings.sidebar,
			currentServerId,
			Math.random,
		);
		const pendingTab: ProjectTab = {
			...presentation,
			creationStatus: 'loading',
			id: pendingId,
			title: `Project ${projectNumber}`,
		};
		const pending: PendingProjectCreation = {
			initialActiveProjectId,
			tab: pendingTab,
		};
		setPendingProjectCreation(pending);
		try {
			const currentStore = () => {
				const store =
					creationConnectionRef.current.context?.workspaceSnapshotStore;
				if (store === undefined)
					throw new Error('The selected server workspace is not ready.');
				return store;
			};
			// A connection lost underneath either step is not a failure: the
			// tab keeps loading and the creation resumes once the workspace
			// has resynchronised, from what the server says it already has.
			const sessionId = await createProjectAcrossReconnects({
				create: () =>
					currentStore().createProject({
						projectId,
						viewId: boundWorkspaceViewId,
						// A window with no project has no folder to reuse; the
						// server then creates the project in its own default folder.
						...(homePath.trim().length > 0 ? { root: homePath } : {}),
						color: presentation.color,
						icon: presentation.emoji,
					}),
				launchTerminal: () =>
					createInitialTerminalForProjectRef.current(projectId),
				resynchronise: () => resynchroniseCreatedProject(projectId),
				onProjectCreated: () =>
					setPendingProjectCreation({ ...pending, projectId }),
			});
			await currentStore()
				.refresh()
				.catch((error: unknown) => {
					// A reconnect resynchronises the workspace on its own.
					if (!isConnectionLoss(error)) throw error;
				});
			const desiredProjectId = heldActiveProjectIdRef.current;
			heldActiveProjectIdRef.current = null;
			projectCreationInFlightRef.current = false;
			setPendingProjectCreation(null);
			if (desiredProjectId === initialActiveProjectId) {
				// Show the project just created, including when it was created
				// from Home.
				activateProject(projectId);
				window.requestAnimationFrame(() =>
					scheduleCreatedTerminalFocus(sessionId),
				);
			} else if (desiredProjectId !== null) {
				activateProject(desiredProjectId);
			}
		} catch (error) {
			heldActiveProjectIdRef.current = null;
			projectCreationInFlightRef.current = false;
			setPendingProjectCreation((current) => ({
				...(current ?? pending),
				tab: {
					...(current?.tab ?? pendingTab),
					creationError:
						error instanceof Error ? error.message : String(error),
					creationStatus: 'failed',
				},
			}));
			// A failure is shown where the person will see it: its own tab.
			setFailedCreationSelectedOver(activeProjectIdRef.current);
			// Leaves Home, if that is where the creation was started from.
			activateProject(activeProjectIdRef.current);
		}
	}, [
		activateProject,
		activeProjectIdRef,
		addProject,
		boundWorkspaceViewId,
		closeProject,
		currentServerId,
		homePath,
		pendingProjectCreation,
		resynchroniseCreatedProject,
		projectsRef,
		settings.sidebar,
		setActiveProjectId,
		terminalClientContext?.workspaceSnapshotStore,
	]);
	createServerProjectRef.current = createServerProject;
	// Each folder's workspace publishes its own panels. The dashboard, the
	// switcher, and the badges read a project as one list, so the folders'
	// inventories are merged per project, in folder order, below.
	const [inventoryByFolder, setInventoryByFolder] = useState<FolderInventories>(
		{},
	);
	// A projection is a new object every revision; the folder order within it
	// rarely changes. Keying on the order keeps the merged inventory, and
	// everything derived from it, from being rebuilt for an unrelated change.
	const folderOrderKey = JSON.stringify(
		projects.map((project) => [
			project.id,
			workspaceSnapshot?.projects[project.id]?.folderIds ?? null,
		]),
	);
	const inventoryByProject = useMemo(() => {
		const folderOrder = new Map(
			JSON.parse(folderOrderKey) as [string, string[] | null][],
		);
		return mergeProjectInventories(
			inventoryByFolder,
			(projectId) => folderOrder.get(projectId) ?? undefined,
			rememberedFolderId,
		);
		// `selectedFolders` is what `rememberedFolderId` reads.
	}, [folderOrderKey, inventoryByFolder, rememberedFolderId, selectedFolders]);
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
		const cancelPendingPass = () => {
			if (reconcileFrame !== null) {
				window.cancelAnimationFrame(reconcileFrame);
				reconcileFrame = null;
			}
			if (reconcileRetryTimer !== null) {
				window.clearTimeout(reconcileRetryTimer);
				reconcileRetryTimer = null;
			}
		};
		// A published projection decides only *that* a pass is due. What the pass
		// sees is read here, when it runs. A pass that replayed the projection it
		// was scheduled with would remove panels this client has since adopted
		// from a newer one — and removing a canonical panel closes the terminal
		// session behind it, so a stale pass would destroy live shells.
		const runPass = () => {
			recordBootstrapDiagnostic('app.workspace.reconcile-frame');
			reconcileFrame = null;
			if (disposed) return;
			const snapshot = store.snapshot;
			if (snapshot === null) return;
			let pendingPresentations = 0;
			const panelBySessionId = new Map(
				Object.values(snapshot.panels).flatMap((panel) =>
					panel.type === 'terminal' && panel.sessionId !== undefined
						? [[panel.sessionId, panel] as const]
						: [],
				),
			);
			for (const session of Object.values(snapshot.terminalSessions)) {
				// The automation space's terminals are the Automations section's to
				// render; no project workspace will ever present them.
				if (isReservedWorkspaceProject(snapshot.projects[session.projectId]))
					continue;
				const panel = panelBySessionId.get(session.id);
				if (panel === undefined) {
					pendingPresentations += 1;
					continue;
				}
				// A terminal is presented by the workspace of the folder the server
				// places it in. A folder that has just gained its first panel has
				// no workspace until the next render; the pass is retried.
				const workspace = workspaceRefs.current.get(
					session.projectId,
					panel.folderId,
				);
				if (workspace === undefined || !workspace.isReady()) {
					pendingPresentations += 1;
					continue;
				}
				if (workspace.ownsControlSession(session.id)) {
					continue;
				}
				// Another project, or another folder of this one, still presents a
				// terminal the server has moved. Hand the same presentation over,
				// so the terminal is shown once and keeps what is local to its tab.
				const pendingMove = pendingTerminalMovesRef.current.get(session.id);
				const requestedHere =
					pendingMove !== undefined &&
					pendingMove.projectId === session.projectId &&
					(pendingMove.folderId === undefined ||
						pendingMove.folderId === panel.folderId);
				pendingTerminalMovesRef.current.delete(session.id);
				let relocated: MovedTerminalTab | null = null;
				for (const presenter of workspaceRefs.current.all()) {
					if (presenter === workspace) continue;
					const presentedPanelId = presenter.terminalPanelForSession(
						session.id,
					);
					if (presentedPanelId === undefined) continue;
					relocated = presenter.exportTerminalForMove(presentedPanelId);
					break;
				}
				// Only the device that asked for the move follows the terminal: to
				// its project, and to the folder it is now in.
				if (requestedHere) {
					selectFolder(session.projectId, panel.folderId);
					activateProjectRef.current(session.projectId);
				}
				const accepted =
					relocated === null
						? workspace.acceptServerTerminal(
								panel.id,
								session.id,
								panel.title,
								panel.cwd,
								session.status,
							)
						: workspace.acceptMovedTerminal(
								{
									...relocated,
									panelId: panel.id,
									serverProjectId: session.projectId,
									terminalSessionStatus: session.status,
									title: panel.title ?? relocated.title,
								},
								{ activate: requestedHere },
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
			// A panel that has changed folder is let go by its old workspace only
			// once the new folder's workspace exists to show it.
			const canHandOver = (panel: ServerWorkspacePanel) =>
				workspaceRefs.current.get(panel.projectId, panel.folderId)?.isReady() ===
				true;
			for (const workspace of workspaceRefs.current.all()) {
				workspace.reconcileServerPanels(canonicalTerminalPanels, canHandOver);
			}
			if (
				pendingPresentations > 0 &&
				reconcileRetryTimer === null &&
				performance.now() < reconcileRetryDeadline
			) {
				reconcileRetryTimer = window.setTimeout(() => {
					reconcileRetryTimer = null;
					schedulePass();
				}, 50);
			}
		};
		const schedulePass = () => {
			if (disposed) return;
			reconcileFrame = window.requestAnimationFrame(runPass);
		};
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
			// A newer projection supersedes every pass still pending from an older
			// one, retries included. One pass is pending at a time, and it reads
			// the projection this client has confirmed.
			cancelPendingPass();
			schedulePass();
			recordBootstrapDiagnostic('app.workspace.reconcile.end');
		};
		const unsubscribe = store.subscribe(reconcile);
		return () => {
			disposed = true;
			unsubscribe();
			cancelPendingPass();
		};
	}, [selectFolder, terminalClientContext?.workspaceSnapshotStore]);

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
			const snapshot = store.snapshot;
			if (snapshot === null) return;
			const reorder = projectReorderInOwnView(
				snapshot,
				projectsRef.current.map((project) => project.id),
				movedId,
			);
			if (reorder === null) return;
			void store.moveProject({ ...reorder, projectId: movedId });
		},
		[
			boundWorkspaceViewId,
			projectsRef,
			terminalClientContext?.workspaceSnapshotStore,
		],
	);

	const workspaceSnapshotStoreRef = useRef(
		terminalClientContext?.workspaceSnapshotStore,
	);
	workspaceSnapshotStoreRef.current =
		terminalClientContext?.workspaceSnapshotStore;
	const inventoryByProjectRef = useRef(inventoryByProject);
	inventoryByProjectRef.current = inventoryByProject;
	/**
	 * The workspace that answers a project-level command, such as the
	 * new-terminal shortcut: the one for the folder this device has selected.
	 */
	const commandWorkspace = useCallback(
		(projectId: string): ProjectWorkspaceHandle | undefined => {
			const snapshot = workspaceSnapshotStoreRef.current?.snapshot;
			return workspaceRefs.current.get(
				projectId,
				commandFolderId(
					snapshot?.projects[projectId],
					snapshot?.folders ?? NO_WORKSPACE_FOLDERS,
					rememberedFolderId(projectId),
				),
			);
		},
		[rememberedFolderId],
	);
	/**
	 * The folder that holds a panel. The projection knows every terminal; a
	 * file or folder opened on this device is known only to the inventory.
	 */
	const folderIdOfPanel = useCallback(
		(projectId: string, panelId: string): string | undefined => {
			const panel = workspaceSnapshotStoreRef.current?.snapshot?.panels[panelId];
			return panel?.projectId === projectId
				? panel.folderId
				: folderIdOfInventoryPanel(
						inventoryByProjectRef.current[projectId],
						panelId,
					);
		},
		[],
	);
	/** The workspace presenting a panel: its folder's, whichever is selected. */
	const workspaceOfPanel = useCallback(
		(projectId: string, panelId: string): ProjectWorkspaceHandle | undefined =>
			workspaceRefs.current.get(projectId, folderIdOfPanel(projectId, panelId)) ??
			workspaceRefs.current
				.ofProject(projectId)
				.find(
					(workspace) => workspace.terminalSessionForPanel(panelId) !== undefined,
				),
		[folderIdOfPanel],
	);
	/**
	 * Bring a panel to the front from anywhere: select its folder, show its
	 * project, then activate it. Every route that activates a panel from
	 * outside its folder goes through here, so none can focus a panel behind
	 * the folder on screen.
	 */
	const activatePanelInProject = useCallback(
		(projectId: string, panelId: string, knownFolderId?: string) => {
			const folderId = knownFolderId ?? folderIdOfPanel(projectId, panelId);
			if (folderId !== undefined) selectFolder(projectId, folderId);
			activateProjectRef.current(projectId);
			window.requestAnimationFrame(() => {
				const workspace =
					workspaceRefs.current.get(projectId, folderId) ??
					workspaceOfPanel(projectId, panelId);
				if (workspace === undefined) return;
				const sessionId = workspace.terminalSessionForPanel(panelId);
				if (sessionId === undefined) workspace.activatePanel(panelId);
				else workspace.activateTerminal(panelId, sessionId);
			});
		},
		[folderIdOfPanel, selectFolder, workspaceOfPanel],
	);
	const activateFolderPanel = useCallback(
		(projectId: string, folderId: string, panelId: string) =>
			activatePanelInProject(projectId, panelId, folderId),
		[activatePanelInProject],
	);
	const focusProjectTerminal = useCallback(
		(projectId: string) => commandWorkspace(projectId)?.focusActiveTerminal(),
		[commandWorkspace],
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

			// The target shows the terminal in its General folder, whose workspace
			// exists once it holds a panel; the project only has to be here.
			const sourceWorkspace = workspaceOfPanel(sourceProjectId, panelId);
			if (
				!sourceWorkspace ||
				!projectsRef.current.some((project) => project.id === targetProjectId)
			) {
				return;
			}

			const store = terminalClientContext?.workspaceSnapshotStore;
			const sessionId = sourceWorkspace.terminalSessionForPanel(panelId);
			const canonicalPanel =
				sessionId === undefined
					? undefined
					: Object.values(store?.snapshot?.panels ?? {}).find(
							(candidate) => candidate.sessionId === sessionId,
						);
			if (
				store === undefined ||
				sessionId === undefined ||
				canonicalPanel === undefined
			) {
				return;
			}

			// The server moves the terminal. Nothing changes here until it has:
			// reconciliation relocates the tab once the move is the confirmed
			// projection, and a refused move leaves the tab exactly where it is.
			const pendingMove = { projectId: targetProjectId };
			pendingTerminalMovesRef.current.set(sessionId, pendingMove);
			void store
				.movePanel({ panelId: canonicalPanel.id, targetProjectId })
				.catch((error: unknown) => {
					if (pendingTerminalMovesRef.current.get(sessionId) === pendingMove)
						pendingTerminalMovesRef.current.delete(sessionId);
					(commandWorkspace(sourceProjectId) ?? sourceWorkspace).reportError(
						error instanceof Error
							? error.message
							: 'Unable to move this terminal to that project.',
					);
				});
		},
		[
			commandWorkspace,
			projectsRef,
			terminalClientContext?.workspaceSnapshotStore,
			workspaceOfPanel,
		],
	);
	/**
	 * Move a terminal to another folder of its own project.
	 *
	 * As with a move between projects, the server makes the move and nothing
	 * changes here until it has. Unlike one, nothing about the terminal changes
	 * but where it is shown: its session, scrollback, and process are untouched.
	 */
	const moveTerminalToFolder = useCallback(
		(projectId: string, panelId: string, targetFolderId: string) => {
			const sourceWorkspace = workspaceOfPanel(projectId, panelId);
			const store = terminalClientContext?.workspaceSnapshotStore;
			const sessionId = sourceWorkspace?.terminalSessionForPanel(panelId);
			const canonicalPanel =
				sessionId === undefined || store?.snapshot == null
					? undefined
					: folderOfSession(store.snapshot.panels, sessionId);
			if (
				sourceWorkspace === undefined ||
				store === undefined ||
				sessionId === undefined ||
				canonicalPanel === undefined ||
				canonicalPanel.projectId !== projectId ||
				canonicalPanel.folderId === targetFolderId
			) {
				return;
			}
			const pendingMove = { projectId, folderId: targetFolderId };
			pendingTerminalMovesRef.current.set(sessionId, pendingMove);
			void store
				.movePanelToFolder({
					panelId: canonicalPanel.id,
					folderId: targetFolderId,
				})
				.catch((error: unknown) => {
					if (pendingTerminalMovesRef.current.get(sessionId) === pendingMove)
						pendingTerminalMovesRef.current.delete(sessionId);
					// Refused: the terminal stays where it is, and the folder on screen
					// says why.
					(commandWorkspace(projectId) ?? sourceWorkspace).reportError(
						error instanceof Error
							? error.message
							: 'Unable to move this terminal to that folder.',
					);
				});
		},
		[
			commandWorkspace,
			terminalClientContext?.workspaceSnapshotStore,
			workspaceOfPanel,
		],
	);
	/**
	 * The terminal being dragged toward the project bar or a folder, if any:
	 * a panel tab, or a row of the Folders tree.
	 *
	 * A drop on a project tab or a folder row only names the target. The move itself waits for
	 * the drag to end: moving the terminal removes the very tab being dragged,
	 * and a drag whose source has left the document never reports its end to
	 * the window, which would strand Dockview's drag bookkeeping.
	 */
	const [terminalTabDrag, setTerminalTabDrag] = useState<{
		panelId: string;
		sourceProjectId: string;
	} | null>(null);
	const terminalTabDragRef = useRef<typeof terminalTabDrag>(null);
	const terminalDropTargetProjectIdRef = useRef<string | null>(null);
	const terminalDropTargetFolderIdRef = useRef<string | null>(null);
	const reportTerminalTabDrag = useCallback(
		(sourceProjectId: string, drag: TerminalTabDrag | null) => {
			if (drag !== null) {
				const started = { panelId: drag.panelId, sourceProjectId };
				terminalDropTargetProjectIdRef.current = null;
				terminalDropTargetFolderIdRef.current = null;
				terminalTabDragRef.current = started;
				setTerminalTabDrag(started);
				return;
			}
			const ended = terminalTabDragRef.current;
			const targetProjectId = terminalDropTargetProjectIdRef.current;
			const targetFolderId = terminalDropTargetFolderIdRef.current;
			terminalTabDragRef.current = null;
			terminalDropTargetProjectIdRef.current = null;
			terminalDropTargetFolderIdRef.current = null;
			setTerminalTabDrag(null);
			if (ended === null) return;
			if (targetProjectId !== null) {
				moveTerminalToProject(
					ended.sourceProjectId,
					ended.panelId,
					targetProjectId,
				);
			} else if (targetFolderId !== null) {
				moveTerminalToFolder(
					ended.sourceProjectId,
					ended.panelId,
					targetFolderId,
				);
			}
		},
		[moveTerminalToFolder, moveTerminalToProject],
	);
	/** A folder takes a terminal only from its own project. Like a project tab,
	 * it names the target and leaves the move to the end of the drag. */
	const dropTerminalOnFolder = useCallback(
		(projectId: string, folderId: string) => {
			if (terminalTabDragRef.current?.sourceProjectId !== projectId) return;
			terminalDropTargetProjectIdRef.current = null;
			terminalDropTargetFolderIdRef.current = folderId;
			setTerminalTabDrag(null);
		},
		[],
	);

	const toggleActiveProjectExplorer = useCallback(() => {
		// On Home the toggle is Home's own; the project kept as command target
		// behind Home keeps its sidebar exactly as it was.
		if (isHomeSelected) {
			toggleHomeSidebar();
			return;
		}
		const project = projectsRef.current.find(
			(candidate) => candidate.id === activeProjectId,
		);
		if (project === undefined) return;
		updateProject(project.id, {
			isFileExplorerOpen: !project.isFileExplorerOpen,
		});
	}, [
		activeProjectId,
		isHomeSelected,
		projectsRef,
		toggleHomeSidebar,
		updateProject,
	]);

	const toggleActiveProjectFolders = () => {
		const project = projectsRef.current.find(
			(candidate) => candidate.id === activeProjectId,
		);
		if (project === undefined) return;
		setFoldersTreeOpen(project.id, !isFoldersTreeOpenFor(project.id));
	};
	/**
	 * Answer a folder's offer to take the terminal that created its worktree.
	 * Accepting is a move this device asked for, so it follows the terminal to
	 * its folder once the server has made the move, as with any other.
	 */
	const answerFolderOffer = useCallback(
		(projectId: string, folderId: string, answer: 'accept' | 'decline') => {
			const store = terminalClientContext?.workspaceSnapshotStore;
			if (store === undefined) return;
			const offeredPanelId =
				store.snapshot?.folders[folderId]?.captureOffer?.panelId;
			const sessionId =
				offeredPanelId === undefined
					? undefined
					: store.snapshot?.panels[offeredPanelId]?.sessionId;
			const pendingMove = { projectId, folderId };
			if (answer === 'accept' && sessionId !== undefined)
				pendingTerminalMovesRef.current.set(sessionId, pendingMove);
			void store
				.answerFolderOffer(folderId, answer)
				.catch((error: unknown) => {
					if (
						sessionId !== undefined &&
						pendingTerminalMovesRef.current.get(sessionId) === pendingMove
					)
						pendingTerminalMovesRef.current.delete(sessionId);
					commandWorkspace(projectId)?.reportError(
						error instanceof Error
							? error.message
							: 'Unable to answer that offer.',
					);
				});
		},
		[commandWorkspace, terminalClientContext?.workspaceSnapshotStore],
	);
	/**
	 * Bring a folder forward and act on its workspace once it is ready.
	 *
	 * A folder's own workspace creates its terminals, naming the folder by id,
	 * and a folder with no panels has no workspace until it is the one selected.
	 */
	const runInFolderWorkspace = useCallback(
		(
			projectId: string,
			folderId: string,
			act: (workspace: ProjectWorkspaceHandle) => void,
		) => {
			selectFolder(projectId, folderId);
			activateProjectRef.current(projectId);
			const startedAt = performance.now();
			const dispatch = () => {
				const workspace = workspaceRefs.current.get(projectId, folderId);
				if (workspace?.isReady() === true) {
					act(workspace);
					return;
				}
				if (performance.now() - startedAt >= 2_000) {
					commandWorkspace(projectId)?.reportError(
						'That folder is not ready for a new terminal.',
					);
					return;
				}
				window.requestAnimationFrame(dispatch);
			};
			dispatch();
		},
		[commandWorkspace, selectFolder],
	);
	/** Create a terminal in a folder, starting in that folder's root. */
	const openShellInFolder = useCallback(
		(projectId: string, folderId: string) =>
			runInFolderWorkspace(projectId, folderId, (workspace) => {
				void workspace.openShellAtFolderRoot();
			}),
		[runInFolderWorkspace],
	);
	/** New terminal, in a folder chosen from the tree instead of the one on
	 * screen: the folder comes forward and its own new-terminal command runs. */
	const newTerminalInFolder = useCallback(
		(projectId: string, folderId: string) =>
			runInFolderWorkspace(projectId, folderId, (workspace) => {
				void workspace.executeCommand('new-terminal');
			}),
		[runInFolderWorkspace],
	);
	/** Close a panel through its own workspace, as closing its tab does. */
	const closeFolderPanel = useCallback(
		async (projectId: string, folderId: string, panelId: string) => {
			const workspace =
				workspaceRefs.current.get(projectId, folderId) ??
				workspaceOfPanel(projectId, panelId);
			if (workspace === undefined)
				throw new Error('That panel is not open on this device.');
			await workspace.requestClosePanel(panelId);
		},
		[workspaceOfPanel],
	);
	// The panel in front of this window, and the one it replaced: a capture
	// can be heard of just after the terminal has left the folder on screen.
	const frontPanelHistoryRef = useRef<FrontPanelHistory>({});
	useEffect(() => {
		const panelId =
			isHomeSelected || !activeProjectId
				? undefined
				: activePanelIdFromInventory(
						inventoryByProject[activeProjectId] ?? NO_INVENTORY,
					);
		frontPanelHistoryRef.current = recordFrontPanel(
			frontPanelHistoryRef.current,
			panelId === undefined || !activeProjectId
				? undefined
				: { projectId: activeProjectId, panelId },
			performance.now(),
		);
	}, [activeProjectId, inventoryByProject, isHomeSelected]);
	const handleTerminalCaptured = useCallback(
		(capture: FolderTerminalCapture) => {
			if (
				!projectsRef.current.some((project) => project.id === capture.projectId)
			)
				return;
			// The device that was looking at the terminal goes on looking at it.
			// On every other device the tree alone shows that it moved.
			if (
				!wasLookingAt(frontPanelHistoryRef.current, capture, performance.now())
			)
				return;
			const sessionId =
				workspaceSnapshotStoreRef.current?.snapshot?.panels[capture.panelId]
					?.sessionId;
			const hasArrived =
				sessionId !== undefined &&
				workspaceRefs.current
					.get(capture.projectId, capture.folderId)
					?.terminalPanelForSession(sessionId) !== undefined;
			if (hasArrived) {
				activatePanelInProject(
					capture.projectId,
					capture.panelId,
					capture.folderId,
				);
				return;
			}
			// The move is not on screen yet. Following it is what reconciliation
			// already does for a move this device is waiting on: it brings the
			// folder forward and hands the tab over focused.
			if (sessionId !== undefined)
				pendingTerminalMovesRef.current.set(sessionId, {
					projectId: capture.projectId,
					folderId: capture.folderId,
				});
			selectFolder(capture.projectId, capture.folderId);
		},
		[activatePanelInProject, projectsRef, selectFolder],
	);
	useFolderCaptureEvents(
		terminalClientContext?.applicationClient,
		handleTerminalCaptured,
	);
	const executeCommandOnActiveProject = useCallback(
		(command: AppCommand): Promise<void> => {
			// The dashboard belongs to the workspace view, not to a project, so it
			// runs with no active panel and with no projects open at all.
			if (command === 'show-dashboard') {
				selectHome();
				return Promise.resolve();
			}
			// The status bar belongs to the window, not to a project.
			if (command === 'toggle-status-bar') {
				toggleStatusBar();
				return Promise.resolve();
			}
			// The sidebar command, like the toggle, answers for Home's sidebar
			// while Home is shown rather than for the project behind it.
			if (command === 'toggle-file-explorer-sidebar' && isHomeSelected) {
				toggleHomeSidebar();
				return Promise.resolve();
			}
			// With Home in front, or no project to draw it, the Command Bar is the
			// workspace view's own.
			if (
				command === 'open-command-bar' &&
				(isHomeSelected || !commandWorkspace(activeProjectId))
			) {
				setIsViewCommandBarOpen(true);
				return Promise.resolve();
			}
			// Closing the tab in front means Home's tab while Home is in front,
			// never a panel of the project behind it.
			if (command === 'close-active' && isHomeSelected) {
				homeRef.current?.requestCloseActiveTab();
				return Promise.resolve();
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
			if (command === 'open-performance-log') {
				return auxiliaryRouteController.openPerformanceLog();
			}
			return (
				commandWorkspace(activeProjectId)?.executeCommand(command) ??
				Promise.resolve()
			);
		},
		[
			activeProjectId,
			auxiliaryRouteController,
			commandWorkspace,
			isHomeSelected,
			selectHome,
			toggleHomeSidebar,
			toggleStatusBar,
		],
	);

	const updateWorkspaceInventory = useCallback(
		(projectId: string, folderId: string, entries: WorkspaceInventoryEntry[]) => {
			setInventoryByFolder((current) =>
				withFolderInventory(current, projectId, folderId, entries),
			);
		},
		[],
	);

	const terminalActivityItems = useMemo(() => {
		const items = projects.flatMap((project) =>
			selectNotableEntries(inventoryByProject[project.id] ?? []),
		);
		return buildTerminalActivityOverview(items);
	}, [inventoryByProject, projects]);

	// The application icon carries the same number as the Notifications control.
	const notificationCount = terminalActivityItems.notificationCount;
	useEffect(() => {
		void setApplicationBadgeCount(notificationCount);
	}, [notificationCount]);

	// Which project a terminal belongs to, on any attached server. Session ids
	// are per-server, so the server has to be part of the question.
	const projectForSession = useCallback(
		(serverId: string, sessionId: string): string | undefined =>
			byServerId.get(serverId)?.context?.workspaceSnapshotStore?.snapshot
				?.terminalSessions[sessionId]?.projectId,
		[byServerId],
	);
	// One subscription to every attached server's agent projection, read by two
	// surfaces: the tab badges for the servers this window is not working in,
	// and the dashboard, which shows every server's agents.
	const agentSnapshotsByServer = useConnectionAgentSnapshots(connections);
	// Another attached server has no live panel inventory in this window, but
	// its agent projection still says which of its projects are waiting on a
	// person — which is the thing worth showing across a server boundary.
	const otherServerBadges = useMemo(
		() =>
			agentBadgesForOtherServers(
				agentSnapshotsByServer,
				currentServerId,
				projectForSession,
			),
		[agentSnapshotsByServer, currentServerId, projectForSession],
	);
	/**
	 * Every server's live agents, assigned to the project that owns the terminal
	 * they were started in. Keyed by server first: an agent entry id is unique
	 * only inside one server's projection, and two servers restored from one
	 * data root produce the same project ids for different projects.
	 */
	const agentsByServerProject = useMemo(() => {
		const byServer: Record<
			string,
			Record<string, AgentStatusEntry[]>
		> = {};
		for (const [serverId, snapshot] of Object.entries(agentSnapshotsByServer)) {
			const byProject: Record<string, AgentStatusEntry[]> = {};
			for (const entry of selectLiveAgentStatusEntries(snapshot)) {
				// A bound agent belongs to its terminal's project; an external one to
				// the projects the server scoped it to by directory or worktree.
				const terminalProjectId =
					entry.activationTerminalSessionId === null
						? undefined
						: projectForSession(serverId, entry.activationTerminalSessionId);
				// An agent this window cannot place in a project is not dropped into
				// the wrong one.
				const projectIds =
					terminalProjectId !== undefined
						? [terminalProjectId]
						: entry.external
							? entry.projectIds
							: [];
				for (const projectId of projectIds) {
					const bucket = byProject[projectId] ?? [];
					bucket.push(entry);
					byProject[projectId] = bucket;
				}
			}
			byServer[serverId] = byProject;
		}
		return byServer;
	}, [agentSnapshotsByServer, projectForSession]);
	// Badges are keyed by `(serverId, projectId)`: the strip holds tabs from
	// several servers whose project ids can be the same string.
	const activityBadgesByProject = useMemo(() => {
		const badges: Record<string, ActivityCountBadge> = {
			...otherServerBadges,
		};
		for (const [projectId, entries] of Object.entries(inventoryByProject)) {
			const badge = summarizeActivityBadge(
				selectNotableEntries(entries).map((item) => item.state),
			);
			if (badge) badges[compositionTabKey(currentServerId, projectId)] = badge;
		}
		return badges;
	}, [currentServerId, inventoryByProject, otherServerBadges]);

	/**
	 * Home aggregates every attached server.
	 *
	 * The server the window is working in contributes its live inventory —
	 * what each panel is doing right now. Every attached server, that one
	 * included, contributes its agents: a server whose panels this window does
	 * not hold can still say which of its projects has an agent waiting.
	 * Nothing is summed across servers: each row still belongs to one.
	 */
	const dashboardSources = useMemo<readonly DashboardServerSource[]>(
		() =>
			projectTabSources.map((source) => ({
				serverId: source.serverId,
				serverLabel: source.serverLabel,
				projects: source.projects,
				inventoryByProject:
					source.serverId === currentServerId ? inventoryByProject : {},
				agentsByProject: agentsByServerProject[source.serverId] ?? {},
			})),
		[
			agentsByServerProject,
			currentServerId,
			inventoryByProject,
			projectTabSources,
		],
	);
	/**
	 * Home's overview counts from the same sources the dashboard renders, so a
	 * number there can never disagree with a row here.
	 */
	/** Every attached server that serves automations, kept current. */
	const automationEntries = useMemo<readonly AutomationConnectionEntry[]>(
		() =>
			connections.flatMap((connection) => {
				const context =
					connection === primary && primaryClientContext !== undefined
						? primaryClientContext
						: connection.context;
				const serverId = connection.serverId ?? context?.serverId;
				if (serverId === undefined || context === undefined) return [];
				return [
					{
						serverId,
						label: connection.label,
						...(context.applicationClient === undefined
							? {}
							: { applicationClient: context.applicationClient }),
						...(context.serverCapabilities === undefined
							? {}
							: { capabilities: context.serverCapabilities }),
					},
				];
			}),
		[connections, primary, primaryClientContext],
	);
	const serverAutomations = useServerAutomations(automationEntries);
	// One projection per server; every terminal pane and tab reads its own
	// pending approvals from it.
	const serverMcpApprovals = useServerMcpApprovals(automationEntries);
	// Likewise one projection of app windows per server; the host below lays
	// them out over the terminal panes that own them.
	const serverAppWindows = useServerAppWindows(automationEntries);
	useEffect(() => {
		window.dispatchEvent(new Event(APP_WINDOW_LAYOUT_EVENT));
	}, [activeProjectId, isHomeSelected]);
	const automationSectionServers = useMemo<
		readonly AutomationsSectionServer[]
	>(
		() =>
			connections.map((connection) => {
				const context =
					connection === primary && primaryClientContext !== undefined
						? primaryClientContext
						: connection.context;
				const serverId = connection.serverId ?? context?.serverId;
				return {
					label: connection.label,
					usable: context !== undefined,
					...(serverId === undefined ? {} : { serverId }),
					...(context?.serverCapabilities === undefined
						? {}
						: { capabilities: context.serverCapabilities }),
					...(context === undefined ? {} : { context }),
				};
			}),
		[connections, primary, primaryClientContext],
	);
	// Next-run times and "today" phrasing move with the clock, not with state.
	// Presentation driven only by the passage of time, and only while Home is
	// shown (ADR-0028 allows it; it reads no external state).
	const [automationClock, setAutomationClock] = useState(() => Date.now());
	useEffect(() => {
		if (!isHomeSelected) return;
		setAutomationClock(Date.now());
		const timer = window.setInterval(
			() => setAutomationClock(Date.now()),
			30_000,
		);
		return () => window.clearInterval(timer);
	}, [isHomeSelected]);
	const automationSources = useMemo(
		() =>
			[...serverAutomations.values()].map((server) => {
				const names = new Map(
					server.automations.map((automation) => [
						automation.id,
						automation.name,
					]),
				);
				return {
					serverId: server.serverId,
					serverLabel: server.label,
					available: server.status === 'ready',
					automations: server.automations.map((automation) => {
						const next = nextAutomationRunAt(
							automation,
							automationClock,
							server.timeZone,
						);
						return {
							automationId: automation.id,
							name: automation.name,
							enabled: automation.enabled,
							...(next === undefined ? {} : { nextRunAt: next }),
						};
					}),
					runs: server.runs.map((run) => ({
						runId: run.runId,
						automationId: run.automationId,
						automationName: names.get(run.automationId) ?? 'Deleted automation',
						startedAt: run.startedAt,
						outcome: automationOverviewOutcome(run),
					})),
				};
			}),
		[automationClock, serverAutomations],
	);
	const homeOverview = useMemo(
		() =>
			buildHomeOverview({
				automationSources,
				sources: dashboardSources.map((source, index) => ({
					...source,
					available: projectTabSources[index]?.usable === true,
					hasInventory: source.serverId === currentServerId,
				})),
				remoteAccess:
					remoteStatus === null || remoteStatus === undefined
						? null
						: {
								connections: remoteStatus.connections,
								isRunning: remoteStatus.isRunning,
								pairedDeviceCount: remoteStatus.pairedDeviceCount,
							},
			}),
		[
			automationSources,
			currentServerId,
			dashboardSources,
			projectTabSources,
			remoteStatus,
		],
	);
	// Something elsewhere — an overview widget, the Command Bar, the missed-run
	// notice — asking Home to show an automation, a run, or a new automation.
	// It opens that tab, or brings it to the front, and shows Home.
	const openAutomationsFromOverview = useCallback(
		(target: HomeOverviewAutomationTarget) => {
			selectHome();
			if (target.kind !== 'create') {
				openInHome(target);
				return;
			}
			const serverId = selectAutomationServer(
				automationSectionServers,
				undefined,
				currentServerId,
			).selected?.serverId;
			openInHome(
				serverId === undefined ? { kind: 'list' } : { kind: 'new', serverId },
			);
		},
		[automationSectionServers, currentServerId, openInHome, selectHome],
	);
	const openHomeSection = useCallback(
		(section: 'home' | 'tabs' | 'automations') => {
			selectHome();
			openInHome({ kind: 'section', section });
		},
		[openInHome, selectHome],
	);
	const automationsData = useMemo<AutomationsData>(
		() => ({
			automations: serverAutomations,
			now: automationClock,
			servers: automationSectionServers,
			...(currentServerId === undefined
				? {}
				: { workingServerId: currentServerId }),
		}),
		[
			automationClock,
			automationSectionServers,
			currentServerId,
			serverAutomations,
		],
	);
	const homeSearchAutomations = useMemo<readonly HomeSearchAutomation[]>(
		() =>
			[...serverAutomations.values()].flatMap((server) =>
				server.automations.map((automation) => ({
					serverId: server.serverId,
					id: automation.id,
					name: automation.name,
					detail: describeAutomationTrigger(automation.trigger),
				})),
			),
		[serverAutomations],
	);
	/**
	 * A dashboard activation on another server is a place to go: bind the
	 * workspace there first, and let the tab activation land once its projects
	 * arrive. Returns whether it took the activation.
	 */
	const activateAnotherServer = useCallback(
		(serverId: string, projectId: string): boolean => {
			if (serverId === currentServerId) return false;
			const connection = byServerId.get(serverId);
			if (connection?.context !== undefined) {
				pendingServerActivationRef.current = { serverId, projectId };
				setRequestedServerId(serverId);
			}
			return true;
		},
		[byServerId, currentServerId],
	);
	const applyDashboardActivation = useCallback(
		(activation: DashboardActivation) => {
			if (activation.kind === 'stale') return;
			if (activation.kind === 'project') {
				activateProject(activation.projectId);
				return;
			}
			activatePanelInProject(activation.projectId, activation.panelId);
		},
		[activatePanelInProject, activateProject],
	);
	// At phone width there is no Folders column; the switcher lists each
	// project's folders instead. Named from every attached server's own
	// projection, and keyed like the badges, by server and project.
	const compactSwitcherFolderKey = JSON.stringify(
		// Only the compact layout draws the switcher.
		(isCompactChrome ? connections : []).flatMap((connection) => {
			const snapshot = connection.context?.workspaceSnapshotStore?.snapshot;
			const serverId = connection.serverId ?? connection.context?.serverId;
			if (snapshot == null || serverId === undefined) return [];
			return Object.values(snapshot.projects).map((project) => {
				// A worktree listing is held only for a project this window has
				// open on its own server; elsewhere a linked folder is named by
				// its worktree's directory.
				const worktreeStatus =
					serverId === currentServerId
						? commandWorkspace(project.id)?.worktreeStatus()
						: undefined;
				return [
					compositionTabKey(serverId, project.id),
					project.folderIds.flatMap((folderId) => {
						const folder = snapshot.folders[folderId];
						return folder === undefined
							? []
							: [
									{
										id: folder.id,
										name: folderNameFromStatus(folder, worktreeStatus),
									},
								];
					}),
				];
			});
		}),
	);
	const compactSwitcherFolders = useMemo(
		() =>
			Object.fromEntries(
				JSON.parse(compactSwitcherFolderKey) as [
					string,
					{ id: string; name: string }[],
				][],
			),
		[compactSwitcherFolderKey],
	);
	/**
	 * The compact switcher's list. Built from the same sources the dashboard
	 * renders, with preview text read from buffers this window already holds —
	 * a terminal on another connection simply has none.
	 */
	const compactSwitcherGroups = useMemo(
		() =>
			buildCompactSwitcherGroups({
				foldersByProject: compactSwitcherFolders,
				previewForSession: (sessionId) =>
					sharedTerminalContextReadersRef.current
						.get(sessionId)
						?.().recentOutput,
				sources: dashboardSources,
			}),
		[compactSwitcherFolders, dashboardSources],
	);
	const compactSwitcherFilteredGroups = useMemo(
		() =>
			filterCompactSwitcherGroups(compactSwitcherGroups, compactSwitcherQuery),
		[compactSwitcherGroups, compactSwitcherQuery],
	);
	const activeCompactTerminal = useMemo(() => {
		if (isHomeSelected || activeProjectId === undefined) return undefined;
		const entries = inventoryByProject[activeProjectId] ?? [];
		return entries.find(
			(entry) => entry.kind === 'terminal' && entry.isActivePanel === true,
		);
	}, [activeProjectId, inventoryByProject, isHomeSelected]);
	const activeCompactPanel = useMemo(() => {
		if (isHomeSelected || activeProjectId === undefined) return undefined;
		const entries = inventoryByProject[activeProjectId] ?? [];
		return entries.find((entry) => entry.isActivePanel === true);
	}, [activeProjectId, inventoryByProject, isHomeSelected]);
	const currentServerReachable =
		byServerId.get(currentServerId)?.context !== undefined;
	const activateDashboardRow = useCallback(
		(serverId: string, row: DashboardRow) => {
			if (activateAnotherServer(serverId, row.projectId)) return;
			// Resolve at click time: a row rendered before a project or panel went
			// away must not act on it.
			applyDashboardActivation(
				resolveDashboardActivation(
					row,
					projectsRef.current,
					inventoryByProject,
				),
			);
		},
		[
			activateAnotherServer,
			applyDashboardActivation,
			inventoryByProject,
			projectsRef,
		],
	);
	// Activating an agent is activating the panel it runs in, resolved the same
	// way and at the same moment, so a finished agent is as safe as a stale row.
	/**
	 * A switcher row activates exactly the way a dashboard row does — the path
	 * that already knows how to cross to another server and select the project
	 * before the panel. There is no second activation route to keep honest.
	 */
	const activateCompactSwitcherPanel = useCallback(
		(row: CompactSwitcherPanelRow) => {
			activateDashboardRow(row.serverId, {
				agents: [],
				color: '',
				emoji: '',
				isAgentStatus: row.isAgentStatus,
				kind: 'panel',
				panelId: row.panelId,
				panelKind: row.panelKind,
				projectId: row.projectId,
				status: row.state,
				title: row.title,
				...(row.sessionId === undefined ? {} : { sessionId: row.sessionId }),
			});
			if (row.panelKind === 'terminal' || row.serverId !== currentServerId)
				return;
			// A file or folder panel has no session for the dashboard path to
			// activate, so it is brought to the front by its panel id.
			activatePanelInProject(row.projectId, row.panelId, row.folderId);
		},
		[activateDashboardRow, activatePanelInProject, currentServerId],
	);
	/**
	 * Editing a panel from the switcher names the panel rather than relying
	 * on it having become active: a project whose dockview does not hold that
	 * panel ignores the event, so exactly one panel answers and no ordering
	 * between activation and edit has to hold. That also draws the same line
	 * the hidden tab strip drew — it only ever showed this window's own panels,
	 * so a row on another server activates, as a press always did, and its
	 * editor opens once this window is working in that server.
	 */
	const editCompactSwitcherPanel = useCallback(
		(row: CompactSwitcherPanelRow) => {
			activateCompactSwitcherPanel(row);
			window.dispatchEvent(
				new CustomEvent('terminay-edit-terminal', {
					detail: { panelId: row.panelId },
				}),
			);
		},
		[activateCompactSwitcherPanel],
	);
	/**
	 * Close is the path the hidden tab already used: terminals go through
	 * `terminay-request-close-terminal`, files and folders through
	 * `terminay-request-close-file`, both of which land in requestClosePanel.
	 * A row on another server activates first, the same as create and edit.
	 */
	const closeCompactSwitcherPanel = useCallback(
		(row: CompactSwitcherPanelRow) => {
			if (row.serverId !== currentServerId) {
				activateCompactSwitcherPanel(row);
				return;
			}
			if (row.panelKind === 'terminal' && row.sessionId !== undefined) {
				window.dispatchEvent(
					new CustomEvent('terminay-request-close-terminal', {
						detail: { panelId: row.panelId, sessionId: row.sessionId },
					}),
				);
				return;
			}
			window.dispatchEvent(
				new CustomEvent('terminay-request-close-file', {
					detail: { panelId: row.panelId },
				}),
			);
		},
		[activateCompactSwitcherPanel, currentServerId],
	);
	/**
	 * A switcher create is the project's own new-terminal command, so the
	 * terminal it makes is shown and focused like any other. The workspace of a
	 * project that was just selected may mount a frame or more later, so the
	 * dispatch waits for its handle rather than dropping the request.
	 */
	const createTerminalInProject = useCallback((projectId: string) => {
		const startedAt = performance.now();
		const dispatch = () => {
			const workspace = commandWorkspace(projectId);
			if (workspace) {
				void workspace.executeCommand('new-terminal');
				return;
			}
			if (performance.now() - startedAt >= 1_000) return;
			window.requestAnimationFrame(dispatch);
		};
		dispatch();
	}, [commandWorkspace]);
	/**
	 * Creating in a project the window is not working in means going to its
	 * server first; the intent is held until that binding lands, the same way a
	 * cross-server tab activation waits for its projects to arrive.
	 */
	const createCompactSwitcherTerminal = useCallback(
		(group: CompactSwitcherProjectGroup) => {
			if (group.serverId !== currentServerId) {
				pendingCompactTerminalRef.current = {
					projectId: group.projectId,
					serverId: group.serverId,
				};
				activateAnotherServer(group.serverId, group.projectId);
				return;
			}
			activateProject(group.projectId);
			window.requestAnimationFrame(() => {
				createTerminalInProject(group.projectId);
			});
		},
		[
			activateAnotherServer,
			activateProject,
			createTerminalInProject,
			currentServerId,
		],
	);
	useEffect(() => {
		const pending = pendingCompactTerminalRef.current;
		if (pending === null || pending.serverId !== currentServerId) return;
		if (!projects.some((project) => project.id === pending.projectId)) return;
		pendingCompactTerminalRef.current = null;
		activateProject(pending.projectId);
		window.requestAnimationFrame(() => {
			createTerminalInProject(pending.projectId);
		});
	}, [activateProject, createTerminalInProject, currentServerId, projects]);
	const activateDashboardAgent = useCallback(
		(serverId: string, projectId: string, agent: DashboardAgent) => {
			// External agents run outside Terminay: nothing to activate.
			if (agent.external) return;
			if (activateAnotherServer(serverId, projectId)) return;
			applyDashboardActivation(
				resolveAgentActivation(
					agent,
					projectId,
					projectsRef.current,
					inventoryByProject,
				),
			);
		},
		[
			activateAnotherServer,
			applyDashboardActivation,
			inventoryByProject,
			projectsRef,
		],
	);
	// A search result is a place to go: it opens the thing it names, exactly
	// as activating it in the Tabs or Automations section would.
	const chooseHomeSearchResult = useCallback(
		(result: HomeSearchResult) => {
			switch (result.kind) {
				case 'section':
					openHomeSection(result.section);
					return;
				case 'project':
				case 'panel':
					activateDashboardRow(result.serverId, result.row);
					return;
				case 'agent':
					activateDashboardAgent(result.serverId, result.projectId, result.agent);
					return;
				case 'automation':
					openAutomationsFromOverview({
						kind: 'automation',
						serverId: result.serverId,
						automationId: result.automationId,
					});
					return;
			}
		},
		[
			activateDashboardAgent,
			activateDashboardRow,
			openAutomationsFromOverview,
			openHomeSection,
		],
	);
	const dashboardGroups = useMemo(
		() => buildCrossServerDashboardGroups(dashboardSources),
		[dashboardSources],
	);
	const placeServerLabels = useMemo(
		() =>
			new Map(
				dashboardSources.map((source) => [
					source.serverId,
					source.serverLabel ?? source.serverId,
				]),
			),
		[dashboardSources],
	);
	// The places the Command Bar offers for what has been typed: nothing until
	// something is.
	const searchPlaces = useCallback(
		(query: string) =>
			commandBarPlaceItems(
				searchHome(dashboardGroups, homeSearchAutomations, query),
				chooseHomeSearchResult,
				placeServerLabels,
			),
		[
			chooseHomeSearchResult,
			dashboardGroups,
			homeSearchAutomations,
			placeServerLabels,
		],
	);
	const closeViewCommandBar = useCallback(
		() => setIsViewCommandBarOpen(false),
		[],
	);
	const searchViewPlaces = useCallback(
		(query: string) =>
			searchPlaces(query).map((place) => ({
				...place,
				onSelect: () => {
					setIsViewCommandBarOpen(false);
					place.onSelect();
				},
			})),
		[searchPlaces],
	);

	// The compact row's only route into the command set. It takes the same
	// dispatch as the accelerator and the native menu rather than reaching for
	// the launcher state directly, so there stays one definition of what
	// opening the Command Bar means.
	const openCompactCommandBar = useCallback(() => {
		void executeCommandOnActiveProject('open-command-bar');
	}, [executeCommandOnActiveProject]);

	const activateTerminalFromOverview = useCallback(
		(item: TerminalActivityOverviewItem) => {
			setIsActivityMenuOpen(false);
			activatePanelInProject(item.projectId, item.panelId);
		},
		[activatePanelInProject],
	);

	// Dismissing is the acknowledgement selecting the tab would report, routed
	// to the workspace that owns the terminal; nothing is selected or activated.
	const dismissNotification = useCallback(
		(item: TerminalActivityOverviewItem) => {
			const workspace = workspaceOfPanel(item.projectId, item.panelId);
			workspace?.acknowledgeTerminal(item.sessionId);
		},
		[workspaceOfPanel],
	);
	const dismissAllNotifications = useCallback(() => {
		for (const item of terminalActivityItems.notifications)
			dismissNotification(item);
	}, [dismissNotification, terminalActivityItems.notifications]);

	useEffect(() => {
		const unsubscribeCommand = subscribeAppCommands?.(
			executeCommandOnActiveProject,
		);

		return () => {
			unsubscribeCommand?.();
		};
	}, [executeCommandOnActiveProject, subscribeAppCommands]);

	// A host that draws its menu in-page has no accelerator to lean on for a
	// command that ships unbound, and synthesising a keystroke for one would
	// invent a binding the user never chose. It names the command instead, and
	// lands on the same dispatch the native menu and the accelerator take.
	useEffect(() => {
		const onHostCommand = (event: Event) => {
			const { command } = (event as CustomEvent<{ command: AppCommand }>)
				.detail;
			if (!command) return;
			void executeCommandOnActiveProject(command);
		};
		window.addEventListener('terminay-app-command', onHostCommand);
		return () => {
			window.removeEventListener('terminay-app-command', onHostCommand);
		};
	}, [executeCommandOnActiveProject]);

	useEffect(() => {
		let isMounted = true;

		let timeoutId: number | undefined;

		// The host paces its own network checks and downloads in the background;
		// this only reads its status, often while a download is in progress.
		const refreshUpdateStatus = async () => {
			let status: AppUpdateStatus | null = null;
			try {
				status = await checkForAppUpdate();
			} catch {
				status = null;
			}
			if (!isMounted) return;
			if (status) setAppUpdateStatus(status);
			const isBusy =
				status?.state === 'checking' || status?.state === 'downloading';
			window.clearTimeout(timeoutId);
			timeoutId = window.setTimeout(
				() => void refreshUpdateStatus(),
				isBusy ? 5_000 : 5 * 60 * 1000,
			);
		};

		void refreshUpdateStatus();
		const unsubscribe = subscribeAppUpdateStatusChanged(
			() => void refreshUpdateStatus(),
		);

		return () => {
			isMounted = false;
			unsubscribe();
			window.clearTimeout(timeoutId);
		};
	}, []);

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

	const [hasShownHome, setHasShownHome] = useState(isHomeSelected);
	if (isHomeSelected && !hasShownHome) setHasShownHome(true);
	const renderHomeSection = useCallback(
		(section: 'home' | 'tabs') =>
			section === 'home' ? (
				<HomeOverview
					now={automationClock}
					overview={homeOverview}
					onOpenAutomations={openAutomationsFromOverview}
					onOpenTabs={() => openHomeSection('tabs')}
				/>
			) : (
				<WorkspaceDashboard
					onActivate={activateDashboardRow}
					onActivateAgent={activateDashboardAgent}
					sources={dashboardSources}
				/>
			),
		[
			activateDashboardAgent,
			activateDashboardRow,
			automationClock,
			dashboardSources,
			homeOverview,
			openAutomationsFromOverview,
			openHomeSection,
		],
	);
	// The commands that are the workspace view's own. None needs a project, so
	// these are what the Command Bar lists with Home in front or with no
	// project in the window.
	const viewCommands = useMemo<readonly CommandBarItem[]>(() => {
		const run = (work: () => void) => () => {
			setIsViewCommandBarOpen(false);
			work();
		};
		return [
			{
				group: 'Workspace',
				icon: <FolderPlus size={18} strokeWidth={2.1} />,
				id: 'new-project',
				title: 'New project',
				description: 'Open a new project in this window.',
				searchText: `new project create open ${getCommandShortcut(settings.keyboardShortcuts, 'new-project')}`,
				shortcutLabel: getCommandShortcutLabel(
					settings.keyboardShortcuts,
					'new-project',
					isMac,
				),
				onSelect: run(() => void createServerProject()),
			},
			{
				group: 'Workspace',
				icon: <Workflow size={18} strokeWidth={2.1} />,
				id: 'new-automation',
				title: 'New automation',
				description: 'Run something on a schedule or when something happens.',
				searchText: 'new automation create schedule trigger cron',
				onSelect: run(() => openAutomationsFromOverview({ kind: 'create' })),
			},
			{
				group: 'Workspace',
				icon: <LayoutDashboard size={18} strokeWidth={2.1} />,
				id: 'show-dashboard',
				title: 'Show dashboard',
				description: 'See every project and tab in this workspace at a glance.',
				searchText: `show dashboard home overview projects tabs status at a glance ${getCommandShortcut(settings.keyboardShortcuts, 'show-dashboard')}`,
				shortcutLabel: getCommandShortcutLabel(
					settings.keyboardShortcuts,
					'show-dashboard',
					isMac,
				),
				onSelect: run(() => openHomeSection('tabs')),
			},
			{
				group: 'Workspace',
				icon: <Sidebar size={18} strokeWidth={2.1} />,
				id: 'toggle-home-sidebar',
				title: isHomeSidebarVisible ? 'Hide sidebar' : 'Show sidebar',
				description: 'Show or hide the Home sidebar.',
				searchText: `toggle sidebar show hide home sections ${getCommandShortcut(settings.keyboardShortcuts, 'toggle-file-explorer-sidebar')}`,
				shortcutLabel: getCommandShortcutLabel(
					settings.keyboardShortcuts,
					'toggle-file-explorer-sidebar',
					isMac,
				),
				onSelect: run(() => {
					selectHome();
					toggleHomeSidebar();
				}),
			},
			{
				group: 'Workspace',
				icon: <PanelBottom size={18} strokeWidth={2.1} />,
				id: 'toggle-status-bar',
				title: isStatusBarVisible ? 'Hide status bar' : 'Show status bar',
				description: 'Show or hide the status bar at the bottom of the window.',
				searchText: `toggle status bar show hide ${getCommandShortcut(settings.keyboardShortcuts, 'toggle-status-bar')}`,
				shortcutLabel: getCommandShortcutLabel(
					settings.keyboardShortcuts,
					'toggle-status-bar',
					isMac,
				),
				onSelect: run(toggleStatusBar),
			},
			{
				group: 'Workspace',
				icon: <Settings size={18} strokeWidth={2.1} />,
				id: 'open-settings',
				title: 'Open settings',
				description: 'Change how Terminay looks and behaves.',
				searchText: `open settings preferences ${getCommandShortcut(settings.keyboardShortcuts, 'open-settings')}`,
				shortcutLabel: getCommandShortcutLabel(
					settings.keyboardShortcuts,
					'open-settings',
					isMac,
				),
				onSelect: run(() => void auxiliaryRouteController.openSettings()),
			},
		];
	}, [
		auxiliaryRouteController,
		createServerProject,
		isHomeSidebarVisible,
		isMac,
		isStatusBarVisible,
		openAutomationsFromOverview,
		openHomeSection,
		selectHome,
		settings.keyboardShortcuts,
		toggleHomeSidebar,
		toggleStatusBar,
	]);

	// A project workspace owns the keyboard while it is on screen. When none is —
	// the dashboard is showing, or this view holds no projects — the workspace
	// view answers for the commands that are its own rather than a project's.
	// A project is presented by one workspace per folder: the folder this
	// device has selected, and every folder that holds a panel. An empty folder
	// nobody is looking at has none, so a repository with dozens of worktrees
	// costs what its open folders cost.
	const mountedFoldersRef = useRef(new Map<string, ReadonlySet<string>>());
	const nextMountedFolders = new Map<string, ReadonlySet<string>>();
	const projectFolderWorkspaces = projects.map((project) => {
		const canonical = workspaceSnapshot?.projects[project.id];
		const folders = workspaceSnapshot?.folders ?? NO_WORKSPACE_FOLDERS;
		const remembered = rememberedFolderId(project.id);
		const mounted = foldersToMount({
			projectId: project.id,
			project: canonical,
			folders,
			rememberedFolderId: remembered,
			mounted: mountedFoldersRef.current.get(project.id) ?? NO_MOUNTED_FOLDERS,
			holdsLocalPanels: (folderId) =>
				(inventoryByFolder[project.id]?.[folderId]?.length ?? 0) > 0,
		});
		nextMountedFolders.set(project.id, new Set(mounted.map(({ id }) => id)));
		return {
			project,
			folders: mounted,
			selectedFolderId: commandFolderId(canonical, folders, remembered),
		};
	});
	mountedFoldersRef.current = nextMountedFolders;

	const hasActiveProjectWorkspace =
		!isHomeSelected &&
		projects.some((project) => project.id === activeProjectId);

	useEffect(() => {
		if (hasActiveProjectWorkspace) return;

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			const command = findCommandForKeyboardEvent(
				event,
				settings.keyboardShortcuts,
				isMac,
			);
			if (
				command !== 'show-dashboard' &&
				command !== 'toggle-status-bar' &&
				command !== 'open-command-bar' &&
				!(
					isHomeSelected &&
					(command === 'toggle-file-explorer-sidebar' ||
						command === 'close-active')
				)
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			if (!event.repeat) void executeCommandOnActiveProject(command);
		};

		window.addEventListener('keydown', onKeyDown, true);
		return () => {
			window.removeEventListener('keydown', onKeyDown, true);
		};
	}, [
		executeCommandOnActiveProject,
		hasActiveProjectWorkspace,
		isHomeSelected,
		isMac,
		settings.keyboardShortcuts,
	]);

	const failedProjectCreation =
		pendingProjectCreation?.tab.creationStatus === 'failed'
			? pendingProjectCreation
			: null;
	// The failed tab is in front only while it is the selected one. Every
	// other tab and Home stay selectable, and selecting one shows it.
	const isPendingProjectFailure =
		failedProjectCreation !== null &&
		!isHomeSelected &&
		failedCreationSelectedOver === activeProjectId;
	const activeProject = isPendingProjectFailure
		? null
		: (projects.find((project) => project.id === activeProjectId) ?? null);
	// Where the compact switcher's create bar will put a terminal: the project in
	// front and the folder this device shows in it.
	const compactSwitcherFrontFolderId =
		activeProject === null
			? undefined
			: projectFolderWorkspaces.find(
					({ project }) => project.id === activeProject.id,
				)?.selectedFolderId;
	const compactSwitcherFrontFolder =
		compactSwitcherFrontFolderId === undefined
			? undefined
			: workspaceSnapshot?.folders[compactSwitcherFrontFolderId];
	const compactSwitcherFrontFolderName =
		compactSwitcherFrontFolder === undefined || activeProject === null
			? undefined
			: folderNameFromStatus(
					compactSwitcherFrontFolder,
					commandWorkspace(activeProject.id)?.worktreeStatus(),
				);
	const displayedActiveProjectId =
		isPendingProjectFailure && failedProjectCreation !== null
			? failedProjectCreation.tab.id
			: activeProjectId;
	const displayedProjects: ComposedProjectTab[] = useMemo(
		() => [...composeProjectTabs(projectTabSources, rememberedTabOrder)],
		[projectTabSources, rememberedTabOrder],
	);
	const displayedActiveHandle = compositionTabKey(
		currentServerId,
		displayedActiveProjectId,
	);
	/** The tabs that take the terminal tab being dragged: the projects its
	 * move menu offers, and nothing while no terminal tab is in flight. */
	const terminalDropTargetIds = useMemo(() => {
		if (terminalTabDrag === null) return NO_TERMINAL_DROP_TARGETS;
		const from = {
			id: terminalTabDrag.sourceProjectId,
			serverId: currentServerId,
		};
		return displayedProjects
			.filter((candidate) =>
				projectTabAcceptsTerminalDrop(from, displayedProjects, candidate),
			)
			.map((candidate) => candidate.handle);
	}, [currentServerId, displayedProjects, terminalTabDrag]);
	const displayedActiveProject =
		displayedProjects.find(
			(project) => project.handle === displayedActiveHandle,
		) ?? activeProject;
	/** Going to a tab on another server is what binds the workspace to it. */
	/** A strip control always hands back a `(serverId, projectId)` handle. A
	 * caller that still speaks a bare project id means one on this server,
	 * which is the only server it could have been looking at. */
	const resolveTabHandle = (handle: string): CompositionTabHandle =>
		parseCompositionTabKey(handle) ?? {
			serverId: currentServerId,
			projectId: handle,
		};
	/** Go to a server the window already holds, without naming a project: the
	 * connections list does this, and it is the same binding a cross-server tab
	 * activation performs. */
	const goToServer = (serverId: string) => {
		if (serverId === currentServerId) return;
		const connection = byServerId.get(serverId);
		// An unreachable or incompatible server takes no operations.
		if (connection?.context === undefined) return;
		setRequestedServerId(serverId);
	};
	const dropTerminalOnComposedTab = (handle: string) => {
		const target = resolveTabHandle(handle);
		if (target.serverId !== currentServerId) return;
		if (terminalTabDragRef.current === null) return;
		terminalDropTargetProjectIdRef.current = target.projectId;
		setTerminalTabDrag(null);
	};
	const activateComposedTab = (handle: string) => {
		const target = resolveTabHandle(handle);
		if (target.projectId === pendingProjectCreation?.tab.id) {
			// A creation still in flight has nothing to show yet; a failed
			// one shows its error.
			if (failedProjectCreation === null) return;
			setFailedCreationSelectedOver(activeProjectId);
			activateProject(activeProjectId);
			return;
		}
		setFailedCreationSelectedOver(null);
		if (target.serverId !== currentServerId) {
			const connection = byServerId.get(target.serverId);
			// An unreachable or incompatible server takes no operations, so its
			// tabs are visible and inert rather than a way to a blank workspace.
			if (connection?.context === undefined) return;
			pendingServerActivationRef.current = target;
			setRequestedServerId(target.serverId);
			return;
		}
		activateProject(target.projectId);
	};
	/**
	 * The Folders tree a tab's peek shows: the one that project's own Folders
	 * column draws, from the same projection, inventory, and worktree listing.
	 * A tab of another attached server reads that server's projection, which
	 * names its folders and terminals; their status and branches are known only
	 * to the server the window is working in.
	 */
	const peekFoldersOf = (handle: string) => {
		const target = resolveTabHandle(handle);
		const isOwn = target.serverId === currentServerId;
		const snapshot = isOwn
			? workspaceSnapshot
			: byServerId.get(target.serverId)?.context?.workspaceSnapshotStore
					?.snapshot;
		const project = snapshot?.projects[target.projectId];
		if (snapshot == null || project === undefined) return null;
		return buildProjectFolderTree({
			project,
			folders: snapshot.folders,
			panels: snapshot.panels,
			selectedFolderId: isOwn ? rememberedFolderId(target.projectId) : undefined,
			inventory: isOwn
				? (inventoryByProject[target.projectId] ?? NO_INVENTORY)
				: NO_INVENTORY,
			worktreeStatus: isOwn
				? commandWorkspace(target.projectId)?.worktreeStatus()
				: undefined,
		});
	};
	const choosePeekFolder = (handle: string, folderId: string) => {
		const target = resolveTabHandle(handle);
		setFailedCreationSelectedOver(null);
		// A folder on another server is reached by going there; which folder is
		// in front is then that visit's own choice.
		if (activateAnotherServer(target.serverId, target.projectId)) return;
		selectFolder(target.projectId, folderId);
		activateProject(target.projectId);
	};
	const choosePeekTerminal = (
		handle: string,
		folderId: string,
		panelId: string,
	) => {
		const target = resolveTabHandle(handle);
		setFailedCreationSelectedOver(null);
		if (activateAnotherServer(target.serverId, target.projectId)) return;
		activatePanelInProject(target.projectId, panelId, folderId);
	};
	/** A handle that belongs to the server the window is currently working in,
	 * or nothing: an operation on another server's tab has to go there first. */
	const ownProjectIdFor = (handle: string): string | undefined => {
		const target = resolveTabHandle(handle);
		return target.serverId === currentServerId ? target.projectId : undefined;
	};
	const openEditComposedTab = async (handle: string) => {
		const projectId = ownProjectIdFor(handle);
		if (projectId === undefined) {
			activateComposedTab(handle);
			return;
		}
		await openEditProjectWindow(projectId);
	};
	// Tearing a tab into its own native window binds that window to one
	// profile, so it is offered only for the server this window is working in.
	const startComposedTabDrag = (handle: string) => {
		const projectId = ownProjectIdFor(handle);
		if (projectId !== undefined) handleProjectTabDragStart(projectId);
	};
	const moveComposedTabDrag = (handle: string, offsetY: number) => {
		const projectId = ownProjectIdFor(handle);
		if (projectId !== undefined) handleProjectTabDragMove(projectId, offsetY);
	};
	const endComposedTabDrag = async (handle: string) => {
		const projectId = ownProjectIdFor(handle);
		if (projectId !== undefined) await handleProjectTabDragEnd(projectId);
	};
	/**
	 * Reordering writes the window's composition, which is client-owned and
	 * spans servers. When the window is showing one server, the same order is
	 * also the server's own project order, so it keeps being persisted there.
	 */
	const onReorderComposed = (nextTabs: readonly ProjectTab[]) => {
		const order = nextTabs.map((tab) => ({
			serverId: tab.serverId,
			projectId: tab.id,
		}));
		setTabOrder(order);
		if (namesServers) return;
		onReorder(
			nextTabs.filter((tab) => tab.serverId === currentServerId) as ProjectTab[],
		);
	};
	const persistMovedComposedTab = (handle: string) => {
		const projectId = ownProjectIdFor(handle);
		if (projectId === undefined || namesServers) return;
		persistMovedProject(projectId);
	};
	// A project tab from another window, held over or released on this bar.
	// It is shown where it will land; once released and arrived it takes that
	// place by the path a strip reorder takes, and becomes the active tab.
	const isProjectDropTarget = incomingProjectDrop !== null;
	const incomingDropBeforeIndex =
		incomingProjectDrop?.before == null
			? -1
			: displayedProjects.findIndex(
					(tab) =>
						tab.serverId === incomingProjectDrop.before?.serverId &&
						tab.id === incomingProjectDrop.before?.projectId,
				);
	const dropPreview =
		incomingProjectDrop === null
			? null
			: {
					index:
						incomingDropBeforeIndex < 0
							? displayedProjects.length
							: incomingDropBeforeIndex,
					preview: incomingProjectDrop.preview,
				};
	const placeDroppedProject = () => {
		if (incomingProjectDrop === null || !incomingProjectDrop.dropped) return;
		const moved = {
			serverId: incomingProjectDrop.serverId,
			projectId: incomingProjectDrop.projectId,
		};
		const byHandle = new Map(displayedProjects.map((tab) => [tab.handle, tab]));
		const movedHandle = compositionTabKey(moved.serverId, moved.projectId);
		if (!byHandle.has(movedHandle)) return;
		clearIncomingProjectDrop();
		onReorderComposed(
			insertCompositionTabBefore(
				displayedProjects.map((tab) => ({
					serverId: tab.serverId,
					projectId: tab.id,
				})),
				moved,
				incomingProjectDrop.before,
			).flatMap((handle) => {
				const tab = byHandle.get(
					compositionTabKey(handle.serverId, handle.projectId),
				);
				return tab === undefined || tab.creationStatus !== undefined
					? []
					: [tab];
			}),
		);
		persistMovedComposedTab(movedHandle);
		activateComposedTab(movedHandle);
	};
	const placeDroppedProjectRef = useRef(placeDroppedProject);
	placeDroppedProjectRef.current = placeDroppedProject;
	// The drop and the tabs it waits for are the triggers; the placement reads
	// everything else fresh.
	useEffect(() => {
		placeDroppedProjectRef.current();
	}, [incomingProjectDrop, displayedProjects]);
	const closeComposedTab = (handle: string) => {
		const target = resolveTabHandle(handle);
		// Closing belongs to the server that owns the project; go there first.
		if (target.serverId !== currentServerId) {
			activateComposedTab(handle);
			return;
		}
		const projectId = target.projectId;
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
		setFailedCreationSelectedOver(null);
		setPendingProjectCreation(null);
	};
	const hasAppUpdate =
		appUpdateStatus?.hasUpdate === true &&
		typeof appUpdateStatus.releaseUrl === 'string';
	const isAppUpdateReady = appUpdateStatus?.state === 'ready';
	// An older host reports no state; it can only link to the release page.
	const canShowWhatsNew = appUpdateStatus?.state !== undefined;
	const updateVersionSuffix = appUpdateStatus?.latestVersion
		? ` (${appUpdateStatus.latestVersion})`
		: '';
	const updateLabel = isAppUpdateReady
		? `Restart to Update${updateVersionSuffix}`
		: `Update Available${updateVersionSuffix}`;
	const installDownloadedUpdate = async () => {
		setIsInstallingAppUpdate(true);
		setAppUpdateInstallError(null);
		try {
			await installAppUpdate();
		} catch (error) {
			setAppUpdateInstallError(
				error instanceof Error ? error.message : 'The update could not be installed.',
			);
		} finally {
			// Cancelling the quit confirmation leaves the app running.
			setIsInstallingAppUpdate(false);
		}
	};
	const appUpdateAction = hasAppUpdate ? (
		<div className="app-update-status">
			<button
				type="button"
				className="app-update-button"
				onClick={() => {
					if (canShowWhatsNew) setIsAppUpdateDialogOpen(true);
					else void openExternalUrl(appUpdateStatus.releaseUrl as string);
				}}
				title={
					canShowWhatsNew
						? `See what's new in ${appUpdateStatus?.latestVersion}`
						: `Open release page for v${appUpdateStatus?.latestVersion}`
				}
				data-terminay-app-update-state={appUpdateStatus?.state ?? 'available'}
			>
				<span className="app-update-button__dot" aria-hidden="true" />
				<span className="app-update-button__label">{updateLabel}</span>
			</button>
			{appUpdateStatus !== null ? (
				<AppUpdateDialog
					status={appUpdateStatus}
					open={isAppUpdateDialogOpen}
					isInstalling={isInstallingAppUpdate}
					installError={appUpdateInstallError}
					onClose={closeAppUpdateDialog}
					onInstall={() => void installDownloadedUpdate()}
				/>
			) : null}
		</div>
	) : null;

	return (
		<AppWindowsContext.Provider value={serverAppWindows}>
		<div
			className={`app-shell${isMac && hasNativeWindowControls && !isWindowFullScreen ? ' app-shell--macos' : ''}`}
			data-terminay-app-component={TERMINAY_APP_COMPONENT_ID}
			data-terminay-compact-chrome={isCompactChrome ? 'true' : 'false'}
			data-terminay-active-project-id={displayedActiveProjectId}
			data-terminay-selected-view={isHomeSelected ? 'home' : 'project'}
			data-terminay-server-id={terminalClientContext?.serverId}
			data-terminay-workspace-revision={
				terminalClientContext?.workspaceSnapshotStore?.snapshot?.revision
			}
			style={
				{
					'--terminal-panel-surface': settings.theme.background,
					...(isHomeSelected
						? { '--project-color': HOME_CHROME_COLOR }
						: !displayedActiveProject?.color
							? {}
							: { '--project-color': displayedActiveProject.color }),
				} as CSSProperties
			}
		>
			<header
				ref={projectTabBarRef}
				className={`project-tabbar${isProjectDropTarget ? ' project-tabbar--drop-target' : ''}${isCompactChrome ? ' project-tabbar--compact' : ''}`}
			>
				{isCompactChrome ? (
					<CompactChromeRow
						applicationMenu={hostPresentation?.renderCompactApplicationMenu?.()}
						breadcrumbButtonRef={compactBreadcrumbRef}
						connection={{
							isExposed: Boolean(remoteStatus?.isRunning),
							isReachable: currentServerReachable,
							serverLabel: currentServerLabel,
							tone: remoteButtonTone,
						}}
						connectionButtonRef={compactConnectionRef}
						isExplorerOpen={
							isHomeSelected
								? isHomeSidebarVisible
								: activeProject?.isFileExplorerOpen === true
						}
						isHomeSelected={isHomeSelected}
						isSwitcherOpen={isCompactSwitcherOpen}
						onOpenCommandBar={openCompactCommandBar}
						onOpenSwitcher={openCompactSwitcher}
						onShowDashboard={selectHome}
						onToggleExplorer={toggleActiveProjectExplorer}
						projectTitle={
							isHomeSelected
								? 'Home'
								: (displayedActiveProject?.title ?? 'No project')
						}
						updateAction={appUpdateAction}
						{...(displayedActiveProject?.color === undefined
							? {}
							: { projectColor: displayedActiveProject.color })}
						{...(activeCompactTerminal === undefined
							? {}
							: { terminalTitle: activeCompactTerminal.title })}
					/>
				) : (
					<>
				{/* The leading toggle answers for the column on the leading side: a
				    project's Folders tree, or Home's own sidebar while Home is shown. */}
				<div className="project-tab-sidebar-toggle-box">
					<button
						type="button"
						className={
							isHomeSelected
								? `project-tab-sidebar-toggle${isHomeSidebarVisible ? ' project-tab-sidebar-toggle--active' : ''}`
								: `project-tab-folders-toggle${activeProject && isFoldersTreeOpenFor(activeProject.id) ? ' project-tab-folders-toggle--active' : ''}`
						}
						onClick={
							isHomeSelected ? toggleHomeSidebar : toggleActiveProjectFolders
						}
						disabled={!isHomeSelected && !activeProject}
						aria-label={isHomeSelected ? 'Toggle file explorer' : 'Toggle folders'}
						title={isHomeSelected ? 'Toggle file explorer' : 'Toggle folders'}
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
				<div className="project-tab-home-box">
					<button
						type="button"
						className={`project-tab-home${isHomeSelected ? ' project-tab-home--active' : ''}`}
						onClick={selectHome}
						aria-label="Home"
						aria-pressed={isHomeSelected}
						title="Home"
						data-terminay-home-control="true"
					>
						<House size={14} aria-hidden="true" />
					</button>
				</div>
				<ProjectTabList
					activeProjectId={isHomeSelected ? '' : displayedActiveHandle}
					activityBadgesByProject={activityBadgesByProject}
					draggingProjectId={
						draggingProjectId === null
							? null
							: compositionTabKey(currentServerId, draggingProjectId)
					}
					dropPreview={dropPreview}
					isDraggingTabTornOff={isDraggingTabTornOff}
					onActivate={activateComposedTab}
					onClose={closeComposedTab}
					onDragEnd={endComposedTabDrag}
					onDragMove={moveComposedTabDrag}
					onDragStart={startComposedTabDrag}
					onEdit={openEditComposedTab}
					onReorder={(nextProjects) =>
						onReorderComposed(
							nextProjects.filter(
								(project) => project.creationStatus === undefined,
							),
						)
					}
					onReorderCommit={persistMovedComposedTab}
					onSwitcherOpen={() => {
						setIsRemoteMenuOpen(false);
						setIsActivityMenuOpen(false);
					}}
					onTerminalDrop={dropTerminalOnComposedTab}
					terminalDropTargetIds={terminalDropTargetIds}
					canCreateProject={
						canAddProject &&
						(pendingProjectCreation === null || failedProjectCreation !== null)
					}
					onCreateProject={() => void createServerProject()}
					projects={displayedProjects}
				/>
				<ProjectTabPeek
					activeTabId={isHomeSelected ? null : displayedActiveHandle}
					isDragging={draggingProjectId !== null || terminalTabDrag !== null}
					foldersOf={peekFoldersOf}
					onChooseFolder={choosePeekFolder}
					onChooseTerminal={choosePeekTerminal}
				/>
				<div className="project-tab-add-box">
					<button
						type="button"
						className="project-tab-add"
						aria-label={
							namesServers ? 'Create project on a server' : 'Create project'
						}
						title={
							namesServers
								? 'Create project — choose a server'
								: 'Create project'
						}
						aria-haspopup={namesServers ? 'menu' : undefined}
						disabled={
							!canAddProject ||
							(pendingProjectCreation !== null &&
								failedProjectCreation === null)
						}
						onClick={(event) => {
							// A project belongs to one server. With several attached the
							// window asks which, defaulting to the tab in front.
							if (!namesServers) {
								void createServerProject();
								return;
							}
							const rect = event.currentTarget.getBoundingClientRect();
							setProjectServerMenu({ x: rect.left, y: rect.bottom });
						}}
					>
						+
					</button>
					{projectServerMenu === null ? null : (
						<ContextMenu
							x={projectServerMenu.x}
							y={projectServerMenu.y}
							onClose={() => setProjectServerMenu(null)}
							items={[
								{ label: 'New project on', heading: true, key: 'heading' },
								...projectTabSources.map((source) => ({
									key: source.serverId,
									label:
										source.serverId === currentServerId
											? `${source.serverLabel} (current)`
											: source.serverLabel,
									disabled: !source.usable,
									onClick: () => createProjectOnServer(source.serverId),
								})),
							]}
						/>
					)}
				</div>
				<div className="header-actions">
					{appUpdateAction}
					<TerminalActivityOverview
						activityMenuRef={activityMenuRef}
						isOpen={isActivityMenuOpen}
						notifications={terminalActivityItems.notifications}
						onActivate={activateTerminalFromOverview}
						onDismiss={dismissNotification}
						onDismissAll={dismissAllNotifications}
						onToggle={() => {
							setIsRemoteMenuOpen(false);
							setIsActivityMenuOpen((current) => !current);
						}}
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
						onSelectServer={goToServer}
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
				{/* A project's sidebar is on the trailing side, and so is its toggle.
				    Home has one column, toggled from the leading end. */}
				{isHomeSelected ? null : (
					<div className="project-tab-sidebar-toggle-box project-tab-sidebar-toggle-box--trailing">
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
								<path d="M9 2.25V11.75" stroke="currentColor" strokeWidth="1.4" />
							</svg>
						</button>
					</div>
				)}
					</>
				)}
			</header>
			{isCompactChrome && isCompactSwitcherOpen ? (
				<CompactSwitcher
					groups={compactSwitcherFilteredGroups}
					onActivatePanel={(row) => {
						closeCompactSwitcher();
						activateCompactSwitcherPanel(row);
					}}
					onAddConnection={() => {
						closeCompactSwitcher();
						if (onOpenConnectionManager === undefined) {
							setConnectionSwitcherError(
								'Connection management is unavailable in this host.',
							);
							return;
						}
						onOpenConnectionManager();
					}}
					onClosePanel={closeCompactSwitcherPanel}
					onCloseProject={(group) => {
						closeComposedTab(
							compositionTabKey(group.serverId, group.projectId),
						);
					}}
					onDismiss={closeCompactSwitcher}
					{...(switchWindowServer === undefined
						? {}
						: {
								servers: compactSwitcherServers,
								onSwitchServer: (profileId: string) => {
									setConnectionSwitcherError(null);
									setCompactSwitchingProfileId(profileId);
									// A switch that succeeds replaces this document; only a
									// failure comes back here.
									void switchWindowServer(profileId)
										.catch((cause: unknown) => {
											closeCompactSwitcher();
											setConnectionSwitcherError(
												cause instanceof Error
													? cause.message
													: 'Terminay could not switch to that server.',
											);
										})
										.finally(() => setCompactSwitchingProfileId(undefined));
								},
							})}
					onEditProject={(group) => {
						closeCompactSwitcher();
						void openEditComposedTab(
							compositionTabKey(group.serverId, group.projectId),
						);
					}}
					onEditPanel={(row) => {
						closeCompactSwitcher();
						editCompactSwitcherPanel(row);
					}}
					onNewProject={() => {
						closeCompactSwitcher();
						void createProjectOnServer(currentServerId);
					}}
					onNewTerminal={(group) => {
						closeCompactSwitcher();
						void createCompactSwitcherTerminal(group);
					}}
					onNewTerminalInFolder={(group, folder) => {
						closeCompactSwitcher();
						// The project's new-terminal command creates in the folder this
						// device has selected, so selecting first is what places it.
						selectFolder(group.projectId, folder.folderId);
						void createCompactSwitcherTerminal(group);
					}}
					onActivateFolder={(group, folder) => {
						closeCompactSwitcher();
						// A folder on another server is reached by going there; which
						// folder is in front is then that visit's own choice.
						if (activateAnotherServer(group.serverId, group.projectId)) return;
						selectFolder(group.projectId, folder.folderId);
						activateProject(group.projectId);
					}}
					{...(isHomeSelected || activeProjectId === undefined
						? {}
						: {
								onNewTerminalHere: () => {
									closeCompactSwitcher();
									createTerminalInProject(activeProjectId);
								},
								...(activeProject === null
									? {}
									: {
											front: {
												color: activeProject.color,
												projectTitle: activeProject.title,
												...(compactSwitcherFrontFolderName === undefined
													? {}
													: { folderName: compactSwitcherFrontFolderName }),
											},
										}),
							})}
					onQueryChange={setCompactSwitcherQuery}
					query={compactSwitcherQuery}
					{...(activeCompactPanel === undefined
						? {}
						: {
								activePanelKey: compositionTabKey(
									currentServerId,
									activeCompactPanel.panelId,
								),
							})}
				/>
			) : null}

			<div className="workspace-stack">
				{isPendingProjectFailure && failedProjectCreation !== null ? (
					<div
						className="workspace-empty-state workspace-empty-state--error workspace-empty-state--actionable"
						role="alert"
					>
						<span>
							{failedProjectCreation.tab.creationError ??
								'Project creation failed.'}
						</span>
						<span className="workspace-empty-state__actions">
							<button type="button" onClick={() => void createServerProject()}>
								Retry
							</button>
							<button
								type="button"
								onClick={() =>
									closeComposedTab(
										compositionTabKey(
											currentServerId,
											failedProjectCreation.tab.id,
										),
									)
								}
							>
								Dismiss
							</button>
						</span>
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
				<McpApprovalsContext.Provider value={serverMcpApprovals}>
					{hasShownHome ? (
					<HomeWorkspace
						ref={attachHome}
						automations={automationsData}
						commandBarShortcutLabel={getCommandShortcutLabel(
							settings.keyboardShortcuts,
							'open-command-bar',
							isMac,
						)}
						isActive={isHomeSelected}
						isCompact={isCompactChrome}
						isSidebarVisible={isHomeSidebarVisible}
						onDismissSidebar={() => setHomeSidebarVisibility(false)}
						onOpenCommandBar={() => setIsViewCommandBarOpen(true)}
						onSectionChosenInDrawer={() => setIsHomeSidebarVisible(false)}
						onSidebarWidthCommit={setHomeSidebarWidth}
						renderSection={renderHomeSection}
						sidebarWidth={homeSidebarWidth}
					/>
					) : null}
					<ViewCommandBar
						commands={viewCommands}
						isOpen={isViewCommandBarOpen}
						onClose={closeViewCommandBar}
						searchPlaces={searchViewPlaces}
					/>
					<MissedRunsNotice automations={serverAutomations} />
					{projectFolderWorkspaces.flatMap(
						({ project, folders, selectedFolderId }) =>
							folders.map((folder) => (
						<ProjectWorkspace
							key={folderWorkspaceKey(project.id, folder.id)}
							ref={(instance) => {
								workspaceRefs.current.set(project.id, folder.id, instance);
							}}
							agentStatusSnapshot={agentStatusSnapshot}
							auxiliaryRoutes={auxiliaryRouteController}
							folder={folder}
							// On screen only as the selected folder of the project in front.
							// Every other workspace keeps its terminals running behind it.
							isActive={
								!isHomeSelected &&
								!isPendingProjectFailure &&
								project.id === activeProjectId &&
								folder.id === selectedFolderId
							}
							projectInventory={inventoryByProject[project.id] ?? NO_INVENTORY}
							isFoldersTreeOpen={isFoldersTreeOpenFor(project.id)}
							foldersTreeWidth={foldersTreeWidthFor(project.id)}
							onFoldersTreeWidthCommit={commitFoldersTreeWidth}
							acceptsFolderTerminalDrop={
								terminalTabDrag?.sourceProjectId === project.id
							}
							onSelectFolder={selectFolder}
							onActivateFolderPanel={activateFolderPanel}
							onDropTerminalOnFolder={dropTerminalOnFolder}
							onAnswerFolderOffer={answerFolderOffer}
							onOpenShellInFolder={openShellInFolder}
							onNewTerminalInFolder={newTerminalInFolder}
							onCloseFolderPanel={closeFolderPanel}
							isCompactChrome={isCompactChrome}
							sharedTerminalContextReaders={sharedTerminalContextReadersRef}
							isMac={isMac}
							macros={macros}
							onAddProject={createServerProject}
							onShowDashboard={selectHome}
							searchPlaces={searchPlaces}
							onToggleStatusBar={toggleStatusBar}
							isStatusBarVisible={isStatusBarVisible}
							statusBarSlot={statusBarSlot}
							onEditProject={openEditProjectWindow}
							onMoveTerminalToFolder={moveTerminalToFolder}
							onMoveTerminalToProject={moveTerminalToProject}
							onPopoutProject={popoutProject}
							onTerminalTabDrag={reportTerminalTabDrag}
							onWorkspaceInventoryChange={updateWorkspaceInventory}
							onCommitProjectSidebar={commitProjectSidebar}
							onUpdateProject={updateProject}
							popoutUrl={popoutUrl}
							project={project}
							projects={projects}
							terminalClientContext={terminalClientContext}
							adoptedTerminals={adoptedTerminalsByProject[project.id]}
						/>
							)),
					)}
				<AppWindowHost />
				</McpApprovalsContext.Provider>
			</div>
			{isStatusBarVisible ? (
				<WorkspaceStatusBar
					onToggleConnectionMenu={() => {
						setIsActivityMenuOpen(false);
						setConnectionSwitcherError(null);
						refreshConnectionSwitcherEntries();
						setIsRemoteMenuOpen((current) => !current);
					}}
					remote={remoteIndicator}
					slotRef={setStatusBarSlot}
				/>
			) : null}

			{isPairingModalOpen ? (
				<RemotePairingModal
					expiresAt={selectedPairingExpiresAt}
					busy={busyPairingApprovalId !== null}
					onApprove={(approvalId) => void approvePairingDevice(approvalId)}
					onClose={closePairingModal}
					onDeny={(approvalId) => void denyPairingDevice(approvalId)}
					pairingUrl={selectedPairingUrl}
					pendingApproval={pendingPairingApproval}
					qrCodeDataUrl={visiblePairingQrCodeDataUrl}
					statusMessage={remoteStatus?.webRtcStatusMessage}
					success={pairingOutcome === 'success'}
				/>
			) : null}
		</div>
		</AppWindowsContext.Provider>
	);
}

export default App;
