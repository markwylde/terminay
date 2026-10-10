import {
	FEATURE_CAPABILITIES,
	type JsonValue,
	type ProtocolId,
} from '@terminay/protocol';

export const WORKSPACE_SCHEMA_VERSION = 6;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** A persisted record is rejected when it carries a field this server does not
 * define, so a state file written by a different shape is never half-read. */
const PROJECT_KEYS = Object.freeze([
	'id',
	'serverId',
	'viewId',
	'root',
	'rootOrigin',
	'name',
	'color',
	'icon',
	'defaultShellProfileId',
	'sidebar',
	'folderIds',
	'panelIds',
	'activePanelId',
	'layout',
	'kind',
]);
const FOLDER_KEYS = Object.freeze([
	'id',
	'projectId',
	'name',
	'kind',
	'worktree',
	'panelIds',
	'activePanelId',
	'layout',
	'captureOffer',
	'createdByPanelId',
]);
const TERMINAL_SESSION_KEYS = Object.freeze([
	'id',
	'serverId',
	'projectId',
	'status',
	'createdAt',
	'outputPosition',
	'launch',
	'exitCode',
	'interruptedAt',
]);
function assertOnlyKnownKeys(
	record: object,
	known: readonly string[],
	label: string,
): void {
	for (const key of Object.keys(record))
		if (!known.includes(key))
			throw new TypeError(`${label} has an unknown field: ${key}`);
}

export type PanelType = 'terminal' | 'file' | 'folder';
export type TerminalStatus = 'running' | 'exited' | 'interrupted';
export type SplitDirection = 'horizontal' | 'vertical';
export type ProjectRootOrigin =
	| 'explicit'
	| 'server-default'
	| 'legacy-unverified';

export interface PanelBase {
	readonly id: ProtocolId;
	readonly projectId: ProtocolId;
	/** The folder of the panel's project that holds it. A folder groups panels
	 * and carries no authority (ADR-0049). */
	readonly folderId: ProtocolId;
	readonly type: PanelType;
	readonly title?: string;
	readonly emoji?: string;
	readonly color?: string;
	readonly inheritsProjectColor?: boolean;
	readonly activityIndicatorsEnabled?: boolean;
	readonly createdAt: number;
}
export interface TerminalPanel extends PanelBase {
	readonly type: 'terminal';
	readonly sessionId: ProtocolId;
	readonly cwd?: string;
	/** `Terminal N`, assigned by the server at creation. A terminal's `title`
	 * here is the named title, else this. What its tab displays may instead be
	 * a title its program set, which is live state and not part of this model
	 * (ADR-0058). */
	readonly defaultTitle?: string;
	/** A name a person gave the terminal: the tab editor, AI, or MCP. */
	readonly namedTitle?: string;
	/** Absent means the terminal has no note; an empty string is a present,
	 * empty note. */
	readonly note?: string;
	/** Advances whenever the named title or note changes; a program title
	 * never advances it. Server-assigned; a client patch can never set it.
	 * Absent means 0. */
	readonly metadataRevision?: number;
}
export interface FilePanel extends PanelBase {
	readonly type: 'file';
	readonly path: string;
	readonly mode?: string;
	readonly presentation?: 'file-viewer' | 'documentation';
}
export interface FolderPanel extends PanelBase {
	readonly type: 'folder';
	readonly path: string;
	readonly expanded?: boolean;
}
export type WorkspacePanel = TerminalPanel | FilePanel | FolderPanel;
/** A panel as a command supplies it: the folder may be left out, in which case
 * the panel lands in the project's General folder. */
export type WorkspacePanelInput = WorkspacePanel extends infer Panel
	? Panel extends WorkspacePanel
		? Omit<Panel, 'folderId'> & { readonly folderId?: ProtocolId }
		: never
	: never;

export interface StackLayout {
	readonly kind: 'stack';
	readonly panelIds: readonly ProtocolId[];
	readonly activePanelId?: ProtocolId;
}
export interface SplitLayout {
	readonly kind: 'split';
	readonly direction: SplitDirection;
	readonly weight: number;
	readonly first: LayoutNode;
	readonly second: LayoutNode;
}
export type LayoutNode = StackLayout | SplitLayout;

/** `general` is the one folder every project has and where panels land by
 * default. `linked` stands for one Git worktree; `plain` is a group the user
 * made. */
export type WorkspaceFolderKind = 'general' | 'plain' | 'linked';
export const GENERAL_FOLDER_NAME = 'General';
/** Written only by the server, from its own worktree listing (ADR-0050). */
export interface WorkspaceFolderWorktreeLink {
	readonly repositoryId: string;
	readonly path: string;
}
export interface WorkspaceFolder {
	readonly id: ProtocolId;
	readonly projectId: ProtocolId;
	readonly name: string;
	readonly kind: WorkspaceFolderKind;
	/** Present exactly when the kind is `linked`. */
	readonly worktree?: WorkspaceFolderWorktreeLink;
	readonly panelIds: readonly ProtocolId[];
	readonly activePanelId?: ProtocolId;
	readonly layout: LayoutNode;
	/** The panel whose terminal created this folder's worktree, while it is in
	 * another folder of the project. */
	readonly createdByPanelId?: ProtocolId;
	/** An unanswered offer to move a panel into this folder. */
	readonly captureOffer?: { readonly panelId: ProtocolId };
}

export interface WorkspaceView {
	readonly id: ProtocolId;
	readonly serverId: ProtocolId;
	readonly name: string;
	readonly projectIds: readonly ProtocolId[];
	readonly activeProjectId?: ProtocolId;
}
export type WorkspaceSidebarPanelId =
	| 'explorer'
	| 'agents'
	| 'git'
	| 'documentation';
export interface WorkspaceSidebarState {
	readonly fileExplorerWidth: number;
	readonly isFileExplorerOpen: boolean;
	readonly isExplorerPaneCollapsed: boolean;
	readonly isAgentsPaneCollapsed: boolean;
	readonly isGitPaneCollapsed: boolean;
	readonly isDocumentationPaneCollapsed: boolean;
	readonly expandedAgentEntryIds: readonly string[];
	readonly expandedDocumentationFolderIds: readonly string[];
	readonly sidebarAgentsHeight: number;
	readonly sidebarExplorerHeight: number;
	readonly sidebarGitHeight: number;
	readonly sidebarDocumentationHeight: number;
	readonly sidebarPanelOrder: readonly WorkspaceSidebarPanelId[];
}
export type WorkspaceSidebarPatch = Partial<WorkspaceSidebarState>;
const SIDEBAR_PANEL_IDS: readonly WorkspaceSidebarPanelId[] = [
	'explorer',
	'agents',
	'git',
	'documentation',
];

export function defaultWorkspaceSidebarState(): WorkspaceSidebarState {
	return {
		fileExplorerWidth: 280,
		isFileExplorerOpen: false,
		isExplorerPaneCollapsed: false,
		isAgentsPaneCollapsed: false,
		isGitPaneCollapsed: false,
		isDocumentationPaneCollapsed: true,
		expandedAgentEntryIds: [],
		expandedDocumentationFolderIds: [],
		sidebarAgentsHeight: 200,
		sidebarExplorerHeight: 320,
		sidebarGitHeight: 240,
		sidebarDocumentationHeight: 220,
		sidebarPanelOrder: [...SIDEBAR_PANEL_IDS],
	};
}
/** A reserved, server-owned project kind. Ordinary user projects carry no
 * kind. See ADR-0030: the `automations` kind is the automation terminal space,
 * which is never presented, ordered, or selected as a project. */
export type WorkspaceProjectKind = 'automations';
export const AUTOMATION_PROJECT_KIND = 'automations' as const;
/** Deterministic identity of the automation terminal space on every server. */
export const AUTOMATION_SPACE_PROJECT_ID = 'system:automations';
export const AUTOMATION_SPACE_NAME = 'Automations';
/** Live (running) terminals the automation space may hold at once. */
export const AUTOMATION_SPACE_TERMINAL_LIMIT = 50;
/** Feature capability a connection must negotiate to see the automation space. */
export const AUTOMATIONS_FEATURE_CAPABILITY = FEATURE_CAPABILITIES.automations;

export interface WorkspaceProject {
	readonly id: ProtocolId;
	/** Absent for every ordinary project. */
	readonly kind?: WorkspaceProjectKind;
	readonly serverId: ProtocolId;
	readonly viewId: ProtocolId;
	readonly root: string;
	readonly rootOrigin: ProjectRootOrigin;
	readonly name: string;
	readonly color?: string;
	readonly icon?: string;
	readonly defaultShellProfileId?: ProtocolId;
	readonly sidebar: WorkspaceSidebarState;
	/** The project's folders in order. Exactly one of them is General. */
	readonly folderIds: readonly ProtocolId[];
	/** Derived by the server from the folders: every panel of the project, in
	 * folder order. No command sets it directly. */
	readonly panelIds: readonly ProtocolId[];
	readonly activePanelId?: ProtocolId;
	/** Derived by the server from the folders. */
	readonly layout: LayoutNode;
}
export interface TerminalSession {
	readonly id: ProtocolId;
	readonly serverId: ProtocolId;
	readonly projectId: ProtocolId;
	readonly status: TerminalStatus;
	readonly createdAt: number;
	readonly outputPosition: number;
	readonly launch?: TerminalLaunchMetadata;
	readonly exitCode?: number;
	readonly interruptedAt?: number;
}
export interface TerminalLaunchMetadata {
	readonly profileId: ProtocolId;
	readonly profileRevision: number;
	readonly profileName: string;
	readonly targetSummary: string;
	readonly workspaceRevision: number;
	readonly settingsRevision: number;
	readonly icon?: string;
	readonly color?: string;
}

export interface WorkspaceState {
	readonly schemaVersion: number;
	readonly serverId: ProtocolId;
	readonly revision: number;
	readonly cursor: string;
	readonly viewOrder: readonly ProtocolId[];
	readonly views: Readonly<Record<ProtocolId, WorkspaceView>>;
	readonly projects: Readonly<Record<ProtocolId, WorkspaceProject>>;
	readonly folders: Readonly<Record<ProtocolId, WorkspaceFolder>>;
	readonly panels: Readonly<Record<ProtocolId, WorkspacePanel>>;
	readonly terminalSessions: Readonly<Record<ProtocolId, TerminalSession>>;
}

/** Return the exact persisted workspace shape. Runtime callers may receive
 * objects assembled by older renderers or host adapters with transient UI
 * fields attached; those fields are deliberately discarded before a snapshot
 * can cross the repository boundary. Terminal output, modal/hover/drag state,
 * search text, and native window geometry have no representation here. */
export function canonicalizeWorkspaceState(
	state: WorkspaceState,
): WorkspaceState {
	validateWorkspace(state);
	const views: Record<string, WorkspaceView> = {};
	for (const [id, view] of Object.entries(state.views)) {
		views[id] = {
			id: view.id,
			serverId: view.serverId,
			name: view.name,
			projectIds: [...view.projectIds],
			...(view.activeProjectId === undefined
				? {}
				: { activeProjectId: view.activeProjectId }),
		};
	}
	const projects: Record<string, WorkspaceProject> = {};
	for (const [id, project] of Object.entries(state.projects)) {
		projects[id] = {
			id: project.id,
			serverId: project.serverId,
			viewId: project.viewId,
			root: project.root,
			rootOrigin: project.rootOrigin,
			name: project.name,
			...(project.kind === undefined ? {} : { kind: project.kind }),
			...(project.color === undefined ? {} : { color: project.color }),
			...(project.icon === undefined ? {} : { icon: project.icon }),
			...(project.defaultShellProfileId === undefined
				? {}
				: { defaultShellProfileId: project.defaultShellProfileId }),
			sidebar: normalizeWorkspaceSidebarState(project.sidebar),
			folderIds: [...project.folderIds],
			panelIds: [...project.panelIds],
			...(project.activePanelId === undefined
				? {}
				: { activePanelId: project.activePanelId }),
			layout: canonicalizeLayout(project.layout),
		};
	}
	const folders: Record<string, WorkspaceFolder> = {};
	for (const [id, folder] of Object.entries(state.folders)) {
		folders[id] = {
			id: folder.id,
			projectId: folder.projectId,
			name: folder.name,
			kind: folder.kind,
			...(folder.worktree === undefined
				? {}
				: {
						worktree: {
							repositoryId: folder.worktree.repositoryId,
							path: folder.worktree.path,
						},
					}),
			panelIds: [...folder.panelIds],
			...(folder.activePanelId === undefined
				? {}
				: { activePanelId: folder.activePanelId }),
			layout: canonicalizeLayout(folder.layout),
			...(folder.createdByPanelId === undefined
				? {}
				: { createdByPanelId: folder.createdByPanelId }),
			...(folder.captureOffer === undefined
				? {}
				: { captureOffer: { panelId: folder.captureOffer.panelId } }),
		};
	}
	const panels: Record<string, WorkspacePanel> = {};
	for (const [id, panel] of Object.entries(state.panels)) {
		const base = {
			id: panel.id,
			projectId: panel.projectId,
			folderId: panel.folderId,
			type: panel.type,
			...(panel.title === undefined ? {} : { title: panel.title }),
			...(panel.emoji === undefined ? {} : { emoji: panel.emoji }),
			...(panel.color === undefined ? {} : { color: panel.color }),
			...(panel.inheritsProjectColor === undefined
				? {}
				: { inheritsProjectColor: panel.inheritsProjectColor }),
			...(panel.activityIndicatorsEnabled === undefined
				? {}
				: { activityIndicatorsEnabled: panel.activityIndicatorsEnabled }),
			createdAt: panel.createdAt,
		};
		if (panel.type === 'terminal')
			panels[id] = {
				...base,
				type: 'terminal',
				sessionId: panel.sessionId,
				...(panel.cwd === undefined ? {} : { cwd: panel.cwd }),
				...(panel.defaultTitle === undefined
					? {}
					: { defaultTitle: panel.defaultTitle }),
				...(panel.namedTitle === undefined
					? {}
					: { namedTitle: panel.namedTitle }),
				...(panel.note === undefined ? {} : { note: panel.note }),
				...(panel.metadataRevision === undefined
					? {}
					: { metadataRevision: panel.metadataRevision }),
			};
		else if (panel.type === 'file')
			panels[id] = {
				...base,
				type: 'file',
				path: panel.path,
				...(panel.mode === undefined ? {} : { mode: panel.mode }),
				...(panel.presentation === 'documentation' ||
				panel.presentation === 'file-viewer'
					? { presentation: panel.presentation }
					: {}),
			};
		else
			panels[id] = {
				...base,
				type: 'folder',
				path: panel.path,
				...(panel.expanded === undefined ? {} : { expanded: panel.expanded }),
			};
	}
	const terminalSessions: Record<string, TerminalSession> = {};
	for (const [id, session] of Object.entries(state.terminalSessions)) {
		terminalSessions[id] = {
			id: session.id,
			serverId: session.serverId,
			projectId: session.projectId,
			status: session.status,
			createdAt: session.createdAt,
			outputPosition: session.outputPosition,
			...(session.launch === undefined
				? {}
				: { launch: structuredClone(session.launch) }),
			...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
			...(session.interruptedAt === undefined
				? {}
				: { interruptedAt: session.interruptedAt }),
		};
	}
	const result: WorkspaceState = {
		schemaVersion: state.schemaVersion,
		serverId: state.serverId,
		revision: state.revision,
		cursor: state.cursor,
		viewOrder: [...state.viewOrder],
		views,
		projects,
		folders,
		panels,
		terminalSessions,
	};
	validateWorkspace(result);
	return result;
}

function canonicalizeLayout(node: LayoutNode): LayoutNode {
	if (node.kind === 'stack')
		return {
			kind: 'stack',
			panelIds: [...node.panelIds],
			...(node.activePanelId === undefined
				? {}
				: { activePanelId: node.activePanelId }),
		};
	return {
		kind: 'split',
		direction: node.direction,
		weight: node.weight,
		first: canonicalizeLayout(node.first),
		second: canonicalizeLayout(node.second),
	};
}
type MutableWorkspaceState = {
	schemaVersion: number;
	serverId: ProtocolId;
	revision: number;
	cursor: string;
	viewOrder: ProtocolId[];
	views: Record<ProtocolId, WorkspaceView>;
	projects: Record<ProtocolId, WorkspaceProject>;
	folders: Record<ProtocolId, WorkspaceFolder>;
	panels: Record<ProtocolId, WorkspacePanel>;
	terminalSessions: Record<ProtocolId, TerminalSession>;
};

export type WorkspaceCommand =
	| {
			readonly type: 'view.create';
			readonly viewId: ProtocolId;
			readonly name: string;
	  }
	| {
			readonly type: 'view.rename';
			readonly viewId: ProtocolId;
			readonly name: string;
	  }
	| { readonly type: 'view.close'; readonly viewId: ProtocolId }
	| {
			readonly type: 'project.create';
			readonly projectId: ProtocolId;
			readonly viewId: ProtocolId;
			readonly root: string;
			readonly rootOrigin?: Exclude<ProjectRootOrigin, 'legacy-unverified'>;
			/** Absent or blank means the server assigns the next unique default. */
			readonly name?: string;
			readonly color?: string;
			readonly icon?: string;
			readonly sidebar?: WorkspaceSidebarState;
	  }
	| {
			readonly type: 'project.sidebar.update';
			readonly projectId: ProtocolId;
			readonly sidebar: WorkspaceSidebarPatch;
	  }
	| {
			readonly type: 'project.root.update';
			readonly projectId: ProtocolId;
			readonly root: string;
	  }
	| {
			readonly type: 'project.shellProfile.set';
			readonly projectId: ProtocolId;
			readonly profileId: ProtocolId;
	  }
	| {
			readonly type: 'project.shellProfile.clear';
			readonly projectId: ProtocolId;
	  }
	| {
			readonly type: 'project.shellProfile.replace';
			readonly fromProfileId: ProtocolId;
			readonly toProfileId?: ProtocolId;
	  }
	| { readonly type: 'project.activate'; readonly projectId: ProtocolId }
	| {
			readonly type: 'project.rename';
			readonly projectId: ProtocolId;
			readonly name: string;
	  }
	| {
			readonly type: 'project.update';
			readonly projectId: ProtocolId;
			readonly name: string;
			readonly root: string;
			readonly color?: string;
			readonly icon?: string;
	  }
	| {
			readonly type: 'project.move';
			readonly projectId: ProtocolId;
			readonly targetViewId: ProtocolId;
			readonly index?: number;
	  }
	| { readonly type: 'project.close'; readonly projectId: ProtocolId }
	| {
			readonly type: 'folder.create';
			readonly projectId: ProtocolId;
			readonly name: string;
			/** Host-only. Makes the folder a linked folder for this worktree. */
			readonly worktree?: WorkspaceFolderWorktreeLink;
			/** Host-only. The panel whose terminal created the worktree. */
			readonly createdByPanelId?: ProtocolId;
	  }
	| {
			readonly type: 'folder.rename';
			readonly folderId: ProtocolId;
			readonly name: string;
	  }
	| {
			readonly type: 'folder.reorder';
			readonly projectId: ProtocolId;
			readonly folderIds: readonly ProtocolId[];
	  }
	| { readonly type: 'folder.delete'; readonly folderId: ProtocolId }
	| {
			/** Host-only. Follows a worktree that Terminay renamed or moved. */
			readonly type: 'folder.link.update';
			readonly folderId: ProtocolId;
			readonly worktree: WorkspaceFolderWorktreeLink;
	  }
	| {
			/** Host-only. Records an unanswered offer to move a panel here. */
			readonly type: 'folder.offer.set';
			readonly folderId: ProtocolId;
			readonly panelId: ProtocolId;
	  }
	| { readonly type: 'folder.offer.accept'; readonly folderId: ProtocolId }
	| { readonly type: 'folder.offer.decline'; readonly folderId: ProtocolId }
	| { readonly type: 'panel.create'; readonly panel: WorkspacePanelInput }
	| {
			readonly type: 'panel.update';
			readonly panelId: ProtocolId;
			readonly patch: JsonValue;
	  }
	| {
			readonly type: 'panel.reorder';
			readonly projectId: ProtocolId;
			/** Absent means the one folder that holds every listed panel. */
			readonly folderId?: ProtocolId;
			readonly panelIds: readonly ProtocolId[];
	  }
	| {
			/** Moves a panel between folders of one project. It changes no
			 * terminal identity and never re-homes a session (ADR-0049). */
			readonly type: 'panel.moveToFolder';
			readonly panelId: ProtocolId;
			readonly folderId: ProtocolId;
			readonly index?: number;
	  }
	| {
			readonly type: 'panel.split';
			readonly projectId: ProtocolId;
			readonly panelId: ProtocolId;
			readonly direction: SplitDirection;
			readonly weight?: number;
	  }
	| {
			readonly type: 'panel.activate';
			readonly projectId: ProtocolId;
			readonly panelId: ProtocolId;
	  }
	| {
			readonly type: 'panel.move';
			readonly panelId: ProtocolId;
			readonly targetProjectId: ProtocolId;
			readonly index?: number;
	  }
	| { readonly type: 'panel.close'; readonly panelId: ProtocolId }
	| {
			readonly type: 'terminal.create';
			readonly sessionId: ProtocolId;
			readonly projectId: ProtocolId;
			readonly createdAt?: number;
			readonly launch?: TerminalLaunchMetadata;
	  }
	| {
			readonly type: 'terminal.createPanel';
			readonly sessionId: ProtocolId;
			readonly projectId: ProtocolId;
			/** Absent means the project's General folder. */
			readonly folderId?: ProtocolId;
			readonly panelId: ProtocolId;
			readonly title?: string;
			readonly cwd?: string;
			readonly createdAt?: number;
			readonly launch?: TerminalLaunchMetadata;
	  }
	| {
			readonly type: 'terminal.markInterrupted';
			readonly sessionId: ProtocolId;
			readonly at?: number;
	  }
	| {
			readonly type: 'terminal.markExited';
			readonly sessionId: ProtocolId;
			readonly exitCode?: number;
			readonly at?: number;
	  };

export interface WorkspaceCommandEnvelope {
	readonly commandId: ProtocolId;
	readonly expectedRevision?: number;
	readonly command: WorkspaceCommand;
}
export interface WorkspaceConflict {
	readonly code: 'conflict';
	readonly currentRevision: number;
	readonly currentCursor: string;
	readonly message: string;
}
export interface WorkspaceEvent {
	readonly revision: number;
	readonly cursor: string;
	readonly commandId: ProtocolId;
	readonly type: WorkspaceCommand['type'];
	readonly changedIds: readonly ProtocolId[];
}
/** The collections of a workspace state whose members are objects with ids. */
export const WORKSPACE_COLLECTIONS = Object.freeze([
	'views',
	'projects',
	'folders',
	'panels',
	'terminalSessions',
] as const);
export type WorkspaceCollection = (typeof WORKSPACE_COLLECTIONS)[number];
type WorkspaceCollectionObject = WorkspaceState[WorkspaceCollection][string];

/**
 * What one commit changed (ADR-0059): every object whose content differs
 * between the two revisions, in full, and the id of every object that is gone.
 * The store derives it by comparing the states; a command does not declare it.
 */
export interface WorkspaceChangeRecord {
	readonly fromRevision: number;
	readonly revision: number;
	readonly cursor: string;
	readonly type: WorkspaceCommand['type'];
	readonly changed: {
		readonly [K in WorkspaceCollection]?: Readonly<
			Record<ProtocolId, WorkspaceState[K][string]>
		>;
	};
	readonly removed: {
		readonly [K in WorkspaceCollection]?: readonly ProtocolId[];
	};
	/** Present when the order of views changed. */
	readonly viewOrder?: readonly ProtocolId[];
}
export interface WorkspaceSnapshot {
	readonly state: WorkspaceState;
	readonly events: readonly WorkspaceEvent[];
}
/**
 * One retained commit: its record, and the states on either side of it. The
 * two states share every object the commit left alone, so holding both costs
 * what the record does. A reader that may see only part of the workspace
 * derives its own record from them (`workspaceStateDifference`).
 */
export interface WorkspaceCommittedChange {
	readonly record: WorkspaceChangeRecord;
	readonly previous: WorkspaceState;
	readonly state: WorkspaceState;
}
/** The answer to "what happened since revision N": the commits, when the
 * store still holds them all, and the state they lead to. */
export interface WorkspaceDelta extends WorkspaceSnapshot {
	/** Absent when history no longer reaches the requested revision, in which
	 * case `state` is the only way forward. */
	readonly records?: readonly WorkspaceChangeRecord[];
	readonly changes?: readonly WorkspaceCommittedChange[];
}
export type WorkspaceApplyResult =
	| {
			readonly ok: true;
			readonly revision: number;
			readonly cursor: string;
			readonly event: WorkspaceEvent;
			readonly state: WorkspaceState;
	  }
	| { readonly ok: false; readonly conflict: WorkspaceConflict };

export function createInitialWorkspace(serverId: ProtocolId): WorkspaceState {
	assertId(serverId, 'serverId');
	const viewId = `${serverId}:view:default`.slice(0, 128);
	const view: WorkspaceView = {
		id: viewId,
		serverId,
		name: 'Workspace',
		projectIds: [],
	};
	return {
		schemaVersion: WORKSPACE_SCHEMA_VERSION,
		serverId,
		revision: 0,
		cursor: '0',
		viewOrder: [viewId],
		views: { [viewId]: view },
		projects: {},
		folders: {},
		panels: {},
		terminalSessions: {},
	};
}

function normalizeWorkspaceSidebarState(value: unknown): WorkspaceSidebarState {
	if (value === undefined) return defaultWorkspaceSidebarState();
	validateWorkspaceSidebarState(value);
	const sidebar = value as WorkspaceSidebarState;
	return {
		fileExplorerWidth: sidebar.fileExplorerWidth,
		isFileExplorerOpen: sidebar.isFileExplorerOpen,
		isExplorerPaneCollapsed: sidebar.isExplorerPaneCollapsed,
		isAgentsPaneCollapsed: sidebar.isAgentsPaneCollapsed,
		isGitPaneCollapsed: sidebar.isGitPaneCollapsed,
		isDocumentationPaneCollapsed: sidebar.isDocumentationPaneCollapsed,
		expandedAgentEntryIds: [...sidebar.expandedAgentEntryIds],
		expandedDocumentationFolderIds: [...sidebar.expandedDocumentationFolderIds],
		sidebarAgentsHeight: sidebar.sidebarAgentsHeight,
		sidebarExplorerHeight: sidebar.sidebarExplorerHeight,
		sidebarGitHeight: sidebar.sidebarGitHeight,
		sidebarDocumentationHeight: sidebar.sidebarDocumentationHeight,
		sidebarPanelOrder: [...sidebar.sidebarPanelOrder],
	};
}

function patchWorkspaceSidebarState(
	current: WorkspaceSidebarState,
	patch: unknown,
): WorkspaceSidebarState {
	if (typeof patch !== 'object' || patch === null || Array.isArray(patch))
		throw new TypeError('sidebar patch is invalid');
	const input = patch as Record<string, unknown>;
	const allowed = new Set<keyof WorkspaceSidebarState>([
		'fileExplorerWidth',
		'isFileExplorerOpen',
		'isExplorerPaneCollapsed',
		'isAgentsPaneCollapsed',
		'isGitPaneCollapsed',
		'isDocumentationPaneCollapsed',
		'expandedAgentEntryIds',
		'expandedDocumentationFolderIds',
		'sidebarAgentsHeight',
		'sidebarExplorerHeight',
		'sidebarGitHeight',
		'sidebarDocumentationHeight',
		'sidebarPanelOrder',
	]);
	if (
		Object.keys(input).length === 0 ||
		Object.keys(input).some(
			(key) => !allowed.has(key as keyof WorkspaceSidebarState),
		)
	)
		throw new TypeError('sidebar patch is invalid');
	return normalizeWorkspaceSidebarState({ ...current, ...input });
}

function validateWorkspaceSidebarState(
	value: unknown,
): asserts value is WorkspaceSidebarState {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('project sidebar is invalid');
	const sidebar = value as Record<string, unknown>;
	const booleans = [
		'isFileExplorerOpen',
		'isExplorerPaneCollapsed',
		'isAgentsPaneCollapsed',
		'isGitPaneCollapsed',
		'isDocumentationPaneCollapsed',
	];
	if (booleans.some((key) => typeof sidebar[key] !== 'boolean'))
		throw new TypeError('project sidebar is invalid');
	const dimensions = [
		'fileExplorerWidth',
		'sidebarAgentsHeight',
		'sidebarExplorerHeight',
		'sidebarGitHeight',
		'sidebarDocumentationHeight',
	];
	if (
		dimensions.some(
			(key) =>
				!Number.isSafeInteger(sidebar[key]) ||
				(sidebar[key] as number) < 30 ||
				(sidebar[key] as number) > 2_000,
		)
	)
		throw new TypeError('project sidebar dimensions are invalid');
	for (const key of [
		'expandedAgentEntryIds',
		'expandedDocumentationFolderIds',
	] as const) {
		const entries = sidebar[key];
		if (
			!Array.isArray(entries) ||
			entries.length > 256 ||
			entries.some(
				(entry) =>
					typeof entry !== 'string' ||
					entry.length === 0 ||
					entry.length > 4_096 ||
					entry.includes('\0'),
			)
		)
			throw new TypeError('project sidebar navigation state is invalid');
	}
	const order = sidebar.sidebarPanelOrder;
	if (
		!Array.isArray(order) ||
		order.length !== SIDEBAR_PANEL_IDS.length ||
		new Set(order).size !== SIDEBAR_PANEL_IDS.length ||
		SIDEBAR_PANEL_IDS.some((id) => !order.includes(id))
	)
		throw new TypeError('project sidebar panel order is invalid');
}

export function validateWorkspace(state: WorkspaceState): void {
	assertId(state.serverId, 'serverId');
	if (
		state.schemaVersion !== WORKSPACE_SCHEMA_VERSION ||
		!Number.isSafeInteger(state.revision) ||
		state.revision < 0 ||
		state.cursor !== String(state.revision)
	)
		throw new TypeError('invalid workspace revision/schema');
	const viewIds = new Set(state.viewOrder);
	if (
		viewIds.size !== state.viewOrder.length ||
		state.viewOrder.some((id) => state.views[id] === undefined)
	)
		throw new TypeError('invalid view order');
	for (const [id, view] of Object.entries(state.views)) {
		assertId(id, 'viewId');
		if (view.id !== id || view.serverId !== state.serverId)
			throw new TypeError('view crosses server boundary');
		if (
			view.projectIds.some(
				(projectId) => state.projects[projectId]?.viewId !== id,
			)
		)
			throw new TypeError('view/project ownership mismatch');
		if (
			view.activeProjectId !== undefined &&
			!view.projectIds.includes(view.activeProjectId)
		)
			throw new TypeError('active project is outside view');
	}
	let automationSpaces = 0;
	for (const [id, project] of Object.entries(state.projects)) {
		assertId(id, 'projectId');
		if (
			project.id !== id ||
			project.serverId !== state.serverId ||
			state.views[project.viewId] === undefined
		)
			throw new TypeError('project crosses server/view boundary');
		assertOnlyKnownKeys(project, PROJECT_KEYS, 'project');
		if (
			project.rootOrigin !== 'explicit' &&
			project.rootOrigin !== 'server-default' &&
			project.rootOrigin !== 'legacy-unverified'
		)
			throw new TypeError('project root origin is invalid');
		if (project.kind !== undefined) {
			if (project.kind !== AUTOMATION_PROJECT_KIND)
				throw new TypeError('project kind is invalid');
			automationSpaces += 1;
			if (automationSpaces > 1)
				throw new TypeError('workspace has more than one automation space');
			if (
				Object.values(state.views).some((view) => view.projectIds.includes(id))
			)
				throw new TypeError('automation space cannot be a listed project');
		}
		if (project.defaultShellProfileId !== undefined)
			assertId(project.defaultShellProfileId, 'defaultShellProfileId');
		validateWorkspaceSidebarState(project.sidebar);
		if (
			project.panelIds.some(
				(panelId) => state.panels[panelId]?.projectId !== id,
			)
		)
			throw new TypeError('project/panel ownership mismatch');
		if (
			project.activePanelId !== undefined &&
			!project.panelIds.includes(project.activePanelId)
		)
			throw new TypeError('active panel is outside project');
		validateLayout(project.layout, new Set(project.panelIds));
		validateProjectFolders(state, project);
	}
	for (const [id, folder] of Object.entries(state.folders)) {
		assertId(id, 'folderId');
		const project = state.projects[folder.projectId];
		if (
			folder.id !== id ||
			project === undefined ||
			!project.folderIds.includes(id)
		)
			throw new TypeError('folder crosses project boundary');
		assertOnlyKnownKeys(folder, FOLDER_KEYS, 'folder');
		boundedName(folder.name);
		if (
			folder.kind !== 'general' &&
			folder.kind !== 'plain' &&
			folder.kind !== 'linked'
		)
			throw new TypeError('folder kind is invalid');
		if ((folder.kind === 'linked') !== (folder.worktree !== undefined))
			throw new TypeError('folder worktree link does not match its kind');
		if (folder.worktree !== undefined) validateWorktreeLink(folder.worktree);
		if (
			new Set(folder.panelIds).size !== folder.panelIds.length ||
			folder.panelIds.some((panelId) => state.panels[panelId]?.folderId !== id)
		)
			throw new TypeError('folder/panel ownership mismatch');
		if (
			folder.activePanelId !== undefined &&
			!folder.panelIds.includes(folder.activePanelId)
		)
			throw new TypeError('active panel is outside folder');
		validateLayout(folder.layout, new Set(folder.panelIds));
		if (
			folder.createdByPanelId !== undefined &&
			state.panels[folder.createdByPanelId]?.projectId !== folder.projectId
		)
			throw new TypeError('folder creator is outside its project');
		if (folder.captureOffer !== undefined) {
			const offered = state.panels[folder.captureOffer.panelId];
			if (
				offered === undefined ||
				offered.projectId !== folder.projectId ||
				offered.folderId === id
			)
				throw new TypeError('folder offers a panel it cannot capture');
		}
	}
	for (const [id, panel] of Object.entries(state.panels)) {
		assertId(id, 'panelId');
		if (panel.id !== id || state.projects[panel.projectId] === undefined)
			throw new TypeError('panel crosses project boundary');
		const folder = state.folders[panel.folderId];
		if (
			folder === undefined ||
			folder.projectId !== panel.projectId ||
			!folder.panelIds.includes(id)
		)
			throw new TypeError('panel is outside its folder');
		if (
			panel.type === 'terminal' &&
			state.terminalSessions[panel.sessionId]?.projectId !== panel.projectId
		)
			throw new TypeError('terminal panel/session ownership mismatch');
		if (panel.type === 'terminal') {
			if (panel.note !== undefined) assertPanelNote(panel.note);
			for (const source of [panel.defaultTitle, panel.namedTitle])
				if (source !== undefined) boundedName(source);
			if (panel.defaultTitle !== undefined && panel.title !== shownTitle(panel))
				throw new TypeError('terminal panel title is not its resolved title');
			if (
				panel.metadataRevision !== undefined &&
				(!Number.isSafeInteger(panel.metadataRevision) ||
					panel.metadataRevision < 0)
			)
				throw new TypeError('terminal panel metadata revision is invalid');
		}
	}
	for (const [id, session] of Object.entries(state.terminalSessions)) {
		assertId(id, 'sessionId');
		if (
			session.id !== id ||
			session.serverId !== state.serverId ||
			state.projects[session.projectId] === undefined ||
			!Number.isSafeInteger(session.outputPosition) ||
			session.outputPosition < 0
		)
			throw new TypeError('invalid terminal session');
		assertOnlyKnownKeys(session, TERMINAL_SESSION_KEYS, 'terminal session');
		if (session.launch !== undefined) validateLaunchMetadata(session.launch);
	}
}

/** Every project has exactly one General folder, anywhere in its order; every
 * folder a project lists is its own; and the project's panel list is exactly
 * its folders' panels in folder order. */
function validateProjectFolders(
	state: WorkspaceState,
	project: WorkspaceProject,
): void {
	const folders = project.folderIds.map((folderId) => state.folders[folderId]);
	if (
		new Set(project.folderIds).size !== project.folderIds.length ||
		folders.some(
			(folder) => folder === undefined || folder.projectId !== project.id,
		)
	)
		throw new TypeError('project/folder ownership mismatch');
	if (folders.filter((folder) => folder?.kind === 'general').length !== 1)
		throw new TypeError('project must have one General folder');
	const derived = folders.flatMap((folder) => folder?.panelIds ?? []);
	if (
		derived.length !== project.panelIds.length ||
		derived.some((panelId, index) => project.panelIds[index] !== panelId)
	)
		throw new TypeError('project panel list does not match its folders');
	const links = new Set<string>();
	for (const folder of folders) {
		if (folder?.worktree === undefined) continue;
		const key = `${folder.worktree.repositoryId}\0${folder.worktree.path}`;
		if (links.has(key))
			throw new TypeError('a worktree has more than one folder');
		links.add(key);
	}
}

function validateWorktreeLink(
	link: WorkspaceFolderWorktreeLink,
): WorkspaceFolderWorktreeLink {
	if (
		typeof link !== 'object' ||
		link === null ||
		typeof link.repositoryId !== 'string' ||
		link.repositoryId.length === 0 ||
		link.repositoryId.length > 256
	)
		throw new TypeError('folder worktree link is invalid');
	return { repositoryId: link.repositoryId, path: boundedPath(link.path) };
}

/** Schema 5 had no folders: a project held its panels directly. Put each
 * project's panels, in order and with their layout, in a General folder. A pure
 * function of its input, so an interrupted start reruns it unchanged. */
function migrateSchema5To6(
	value: Record<string, unknown>,
): Record<string, unknown> {
	const record = (candidate: unknown): Record<string, Record<string, unknown>> =>
		typeof candidate === 'object' &&
		candidate !== null &&
		!Array.isArray(candidate)
			? (candidate as Record<string, Record<string, unknown>>)
			: {};
	const projects = record(value.projects);
	const panels = record(value.panels);
	const folders: Record<string, unknown> = {};
	const nextProjects: Record<string, unknown> = {};
	const nextPanels: Record<string, unknown> = { ...panels };
	Object.keys(projects)
		.sort()
		.forEach((projectId, index) => {
			const project = projects[projectId];
			if (project === undefined) return;
			const folderId = migratedGeneralFolderId(index);
			const panelIds = Array.isArray(project.panelIds)
				? (project.panelIds as string[])
				: [];
			folders[folderId] = {
				id: folderId,
				projectId,
				name: GENERAL_FOLDER_NAME,
				kind: 'general',
				panelIds: [...panelIds],
				...(project.activePanelId === undefined
					? {}
					: { activePanelId: project.activePanelId }),
				layout: project.layout ?? stack(panelIds),
			};
			nextProjects[projectId] = { ...project, folderIds: [folderId] };
			for (const panelId of panelIds) {
				const panel = panels[panelId];
				if (panel !== undefined) nextPanels[panelId] = { ...panel, folderId };
			}
		});
	return {
		...value,
		schemaVersion: 6,
		projects: nextProjects,
		folders,
		panels: nextPanels,
	};
}

/** Folder ids are issued by the server. Ones made while upgrading a stored
 * workspace and ones made by a command use different prefixes, so they can
 * never collide. */
function migratedGeneralFolderId(index: number): ProtocolId {
	return `folder:m${index}`;
}
function issuedFolderId(state: WorkspaceState): ProtocolId {
	let serial = state.revision + 1;
	while (state.folders[`folder:r${serial}`] !== undefined) serial += 1;
	return `folder:r${serial}`;
}

/** Idempotent migration boundary for persisted workspace shapes. A legacy v0
 * snapshot may contain only server identity and project roots; it is upgraded
 * without inventing panels or terminal content. A schema 5 snapshot gains
 * folders. */
/**
 * A program-set title is live state and is never stored (ADR-0058). A
 * workspace written while it was a panel field has it dropped here, and the
 * terminal's stored title goes back to its named title or default name.
 */
function forgetStoredProgramTitles(
	value: Record<string, unknown>,
): Record<string, unknown> {
	const panels = value.panels;
	if (typeof panels !== 'object' || panels === null || Array.isArray(panels))
		return value;
	let forgotten = false;
	const next: Record<string, unknown> = {};
	for (const [id, panel] of Object.entries(panels)) {
		if (
			typeof panel !== 'object' ||
			panel === null ||
			!('programTitle' in panel)
		) {
			next[id] = panel;
			continue;
		}
		const { programTitle: _programTitle, ...rest } = panel as Record<
			string,
			unknown
		>;
		const stored =
			typeof rest.namedTitle === 'string' ? rest.namedTitle : rest.defaultTitle;
		next[id] = typeof stored === 'string' ? { ...rest, title: stored } : rest;
		forgotten = true;
	}
	return forgotten ? { ...value, panels: next } : value;
}

export function migrateWorkspaceState(
	input: unknown,
	fallbackServerId: ProtocolId,
): WorkspaceState {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		throw new TypeError('workspace snapshot must be an object');
	let value = input as Record<string, unknown>;
	if (value.schemaVersion === 5) value = migrateSchema5To6(value);
	value = forgetStoredProgramTitles(value);
	if (value.schemaVersion === WORKSPACE_SCHEMA_VERSION) {
		return adoptTerminalTitleSources(
			canonicalizeWorkspaceState(value as unknown as WorkspaceState),
		);
	}
	if (value.schemaVersion !== 0)
		throw new Error('unsupported workspace schema');
	const serverId =
		typeof value.serverId === 'string' ? value.serverId : fallbackServerId;
	const result = createInitialWorkspace(serverId);
	const defaultViewId = result.viewOrder[0];
	if (defaultViewId === undefined)
		throw new Error('workspace has no default view');
	const legacyProjects =
		typeof value.projects === 'object' &&
		value.projects !== null &&
		!Array.isArray(value.projects)
			? (value.projects as Record<string, unknown>)
			: {};
	for (const [id, raw] of Object.entries(legacyProjects)) {
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
		const project = raw as Record<string, unknown>;
		if (typeof project.root !== 'string') continue;
		const name =
			typeof project.name === 'string' && project.name.length > 0
				? project.name
				: id;
		const created: WorkspaceProject = {
			id,
			serverId,
			viewId: defaultViewId,
			root: project.root,
			rootOrigin: 'legacy-unverified',
			name,
			sidebar: defaultWorkspaceSidebarState(),
			folderIds: [],
			panelIds: [],
			layout: stack([]),
		};
		const general = generalFolder(
			migratedGeneralFolderId(Object.keys(result.projects).length),
			id,
		);
		(result.folders as Record<string, WorkspaceFolder>)[general.id] = general;
		(result.projects as Record<string, WorkspaceProject>)[id] = {
			...created,
			folderIds: [general.id],
		};
		const view = result.views[defaultViewId];
		if (view === undefined) throw new Error('default view missing');
		(result.views as Record<string, WorkspaceView>)[defaultViewId] = {
			...view,
			projectIds: [...view.projectIds, id],
			activeProjectId: id,
		};
	}
	validateWorkspace(result);
	return result;
}

const DEFAULT_TERMINAL_TITLE = /^Terminal \d+$/u;

interface TerminalTitleSources {
	readonly defaultTitle: string;
	readonly namedTitle?: string;
}

/** The title workspace state holds for a terminal: a person's name for it,
 * else its default name. A title its program set is resolved over this by
 * the title service and is never stored here (ADR-0058). */
function shownTitle(sources: {
	readonly defaultTitle?: string;
	readonly namedTitle?: string;
}): string | undefined {
	return sources.namedTitle ?? sources.defaultTitle;
}

function nextDefaultTerminalTitle(
	state: WorkspaceState,
	projectId: ProtocolId,
	exceptPanelId?: ProtocolId,
): string {
	const others = Object.values(state.panels).filter(
		(panel) =>
			panel.projectId === projectId &&
			panel.type === 'terminal' &&
			panel.id !== exceptPanelId,
	).length;
	return `Terminal ${others + 1}`;
}

/** A terminal's title sources. A panel stored before they existed has only
 * `title`: a `Terminal N` there is its default name, anything else is a name
 * someone gave it. */
function terminalTitleSources(
	state: WorkspaceState,
	panel: TerminalPanel,
): TerminalTitleSources {
	if (panel.defaultTitle !== undefined)
		return {
			defaultTitle: panel.defaultTitle,
			...(panel.namedTitle === undefined
				? {}
				: { namedTitle: panel.namedTitle }),
		};
	const title = panel.title?.trim();
	if (title !== undefined && DEFAULT_TERMINAL_TITLE.test(title))
		return { defaultTitle: title };
	const defaultTitle = nextDefaultTerminalTitle(
		state,
		panel.projectId,
		panel.id,
	);
	return title === undefined || title.length === 0
		? { defaultTitle }
		: { defaultTitle, namedTitle: title.slice(0, 256).trim() };
}

/** The title a terminal is created with: a `Terminal N` or no title at all is
 * its default name, anything else is a name it was asked to carry. */
function terminalTitlesAtCreation(
	state: WorkspaceState,
	projectId: ProtocolId,
	title: string | undefined,
): TerminalTitleSources {
	if (title === undefined)
		return { defaultTitle: nextDefaultTerminalTitle(state, projectId) };
	const name = boundedName(title);
	return DEFAULT_TERMINAL_TITLE.test(name)
		? { defaultTitle: name }
		: {
				defaultTitle: nextDefaultTerminalTitle(state, projectId),
				namedTitle: name,
			};
}

function withTitleSources(
	panel: TerminalPanel,
	sources: TerminalTitleSources,
): TerminalPanel {
	const {
		title: _title,
		defaultTitle: _defaultTitle,
		namedTitle: _namedTitle,
		// Never a field of the model (ADR-0058): dropped if an input carries one.
		programTitle: _programTitle,
		...rest
	} = panel as TerminalPanel & { readonly programTitle?: unknown };
	return {
		...rest,
		title: shownTitle(sources) ?? sources.defaultTitle,
		defaultTitle: sources.defaultTitle,
		...(sources.namedTitle === undefined
			? {}
			: { namedTitle: sources.namedTitle }),
	};
}

/** Give every terminal panel its title sources. Idempotent, and it leaves
 * `title` as it was, so an older server reading the result sees no change. */
function adoptTerminalTitleSources(state: WorkspaceState): WorkspaceState {
	const panels: Record<string, WorkspacePanel> = {};
	let adopted = false;
	for (const [id, panel] of Object.entries(state.panels)) {
		if (panel.type !== 'terminal' || panel.defaultTitle !== undefined) {
			panels[id] = panel;
			continue;
		}
		panels[id] = withTitleSources(panel, terminalTitleSources(state, panel));
		adopted = true;
	}
	return adopted ? { ...state, panels } : state;
}

function validateLayout(node: LayoutNode, panelIds: Set<string>): void {
	if (node.kind === 'stack') {
		const seen = new Set(node.panelIds);
		if (
			seen.size !== node.panelIds.length ||
			node.panelIds.some((id) => !panelIds.has(id)) ||
			(node.activePanelId !== undefined && !seen.has(node.activePanelId))
		)
			throw new TypeError('invalid stack layout');
		return;
	}
	if (
		node.kind !== 'split' ||
		!['horizontal', 'vertical'].includes(node.direction) ||
		!Number.isFinite(node.weight) ||
		node.weight <= 0 ||
		node.weight >= 1
	)
		throw new TypeError('invalid split layout');
	validateLayout(node.first, panelIds);
	validateLayout(node.second, panelIds);
}

/** Longest terminal note the server stores, in UTF-16 code units. */
export const MAX_PANEL_NOTE_CHARS = 1200;

function assertPanelNote(value: unknown): asserts value is string {
	if (
		typeof value !== 'string' ||
		value.length > MAX_PANEL_NOTE_CHARS ||
		value.includes('\0')
	)
		throw new TypeError('terminal panel note is invalid');
}

function assertId(value: string, name: string): void {
	if (typeof value !== 'string' || !ID_PATTERN.test(value))
		throw new TypeError(`invalid ${name}`);
}
function clone<T>(value: T): T {
	return structuredClone(value);
}

/** Structural equality of two JSON values. */
function sameJson(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (
		left === null ||
		right === null ||
		typeof left !== 'object' ||
		typeof right !== 'object'
	)
		return false;
	if (Array.isArray(left)) {
		if (!Array.isArray(right) || left.length !== right.length) return false;
		for (let index = 0; index < left.length; index += 1)
			if (!sameJson(left[index], right[index])) return false;
		return true;
	}
	if (Array.isArray(right)) return false;
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const keys = Object.keys(leftRecord);
	if (keys.length !== Object.keys(rightRecord).length) return false;
	for (const key of keys) {
		if (!Object.hasOwn(rightRecord, key)) return false;
		if (!sameJson(leftRecord[key], rightRecord[key])) return false;
	}
	return true;
}

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== 'object' || Object.isFrozen(value))
		return value;
	Object.freeze(value);
	for (const member of Object.values(value)) deepFreeze(member);
	return value;
}

/**
 * Make `next` share with `previous` every object the commit left the same, and
 * say what it did not. An object a command did not change is then the same
 * object before and after, which is how every reader downstream knows nothing
 * happened to it (ADR-0059). `next` is frozen on return.
 */
function settleCommittedState(
	previous: WorkspaceState,
	next: MutableWorkspaceState,
): Pick<WorkspaceChangeRecord, 'changed' | 'removed' | 'viewOrder'> {
	const changed: {
		[K in WorkspaceCollection]?: Record<ProtocolId, WorkspaceCollectionObject>;
	} = {};
	const removed: { [K in WorkspaceCollection]?: ProtocolId[] } = {};
	for (const collection of WORKSPACE_COLLECTIONS) {
		const before = previous[collection] as Readonly<
			Record<ProtocolId, WorkspaceCollectionObject>
		>;
		const after = next[collection] as Record<
			ProtocolId,
			WorkspaceCollectionObject
		>;
		let differs = false;
		for (const [id, object] of Object.entries(after)) {
			const held = before[id];
			if (held !== undefined && sameJson(held, object)) {
				after[id] = held;
				continue;
			}
			differs = true;
			(changed[collection] ??= {})[id] = object;
		}
		for (const id of Object.keys(before)) {
			if (Object.hasOwn(after, id)) continue;
			differs = true;
			(removed[collection] ??= []).push(id);
		}
		// Nothing in the collection changed, so the collection itself did not.
		if (!differs)
			(next as Record<WorkspaceCollection, unknown>)[collection] = before;
	}
	const viewOrderChanged = !sameJson(previous.viewOrder, next.viewOrder);
	if (!viewOrderChanged) next.viewOrder = previous.viewOrder as ProtocolId[];
	deepFreeze(next);
	return {
		changed: changed as WorkspaceChangeRecord['changed'],
		removed,
		...(viewOrderChanged ? { viewOrder: next.viewOrder } : {}),
	};
}

/**
 * What differs between two states: every object of `next` whose content is
 * not that of `previous`, and the id of every object `previous` had that
 * `next` does not. Objects the two states share are skipped by identity, so
 * comparing the states on either side of a commit costs what the commit
 * changed plus one pass over the ids.
 */
export function workspaceStateDifference(
	previous: WorkspaceState,
	next: WorkspaceState,
): Pick<WorkspaceChangeRecord, 'changed' | 'removed' | 'viewOrder'> {
	const changed: {
		[K in WorkspaceCollection]?: Record<ProtocolId, WorkspaceCollectionObject>;
	} = {};
	const removed: { [K in WorkspaceCollection]?: ProtocolId[] } = {};
	for (const collection of WORKSPACE_COLLECTIONS) {
		const before = previous[collection] as Readonly<
			Record<ProtocolId, WorkspaceCollectionObject>
		>;
		const after = next[collection] as Readonly<
			Record<ProtocolId, WorkspaceCollectionObject>
		>;
		if (before === after) continue;
		for (const [id, object] of Object.entries(after)) {
			const held = before[id];
			if (held !== undefined && sameJson(held, object)) continue;
			(changed[collection] ??= {})[id] = object;
		}
		for (const id of Object.keys(before))
			if (!Object.hasOwn(after, id)) (removed[collection] ??= []).push(id);
	}
	return {
		changed: changed as WorkspaceChangeRecord['changed'],
		removed,
		...(sameJson(previous.viewOrder, next.viewOrder)
			? {}
			: { viewOrder: next.viewOrder }),
	};
}

/** UTF-16 units a change record serialises to: what retaining it costs. */
function recordBytes(record: WorkspaceChangeRecord): number {
	return JSON.stringify(record).length;
}
function indexAt(index: number | undefined, length: number): number {
	return Math.max(0, Math.min(length, index ?? length));
}
function stack(
	panelIds: readonly ProtocolId[],
	activePanelId?: ProtocolId,
): StackLayout {
	return {
		kind: 'stack',
		panelIds: [...panelIds],
		...(activePanelId === undefined ? {} : { activePanelId }),
	};
}

function withActiveProject(
	view: WorkspaceView,
	projectIds: readonly ProtocolId[],
	activeProjectId: ProtocolId | undefined,
): WorkspaceView {
	const { activeProjectId: _previousActiveProjectId, ...rest } = view;
	return {
		...rest,
		projectIds: [...projectIds],
		...(activeProjectId === undefined ? {} : { activeProjectId }),
	};
}

function generalFolder(id: ProtocolId, projectId: ProtocolId): WorkspaceFolder {
	return {
		id,
		projectId,
		name: GENERAL_FOLDER_NAME,
		kind: 'general',
		panelIds: [],
		layout: stack([]),
	};
}

/** The folder with this panel list and active panel, as one stack. */
function withFolderPanels(
	folder: WorkspaceFolder,
	panelIds: readonly ProtocolId[],
	activePanelId: ProtocolId | undefined,
): WorkspaceFolder {
	const { activePanelId: _previousActivePanelId, ...rest } = folder;
	const active =
		activePanelId !== undefined && panelIds.includes(activePanelId)
			? activePanelId
			: panelIds[0];
	return {
		...rest,
		panelIds: [...panelIds],
		...(active === undefined ? {} : { activePanelId: active }),
		layout: stack(panelIds, active),
	};
}

/** Take a panel out of its folder, keeping the folder's other panels. */
function removeFromFolder(
	state: MutableWorkspaceState,
	folderId: ProtocolId,
	panelId: ProtocolId,
): void {
	const folder = requireFolder(state, folderId);
	state.folders[folder.id] = withFolderPanels(
		folder,
		folder.panelIds.filter((id) => id !== panelId),
		folder.activePanelId === panelId ? undefined : folder.activePanelId,
	);
}

/** Move a panel to another folder of its own project. The source folder keeps
 * its other panels; the target shows the panel as its active one. */
function movePanelToFolder(
	state: MutableWorkspaceState,
	panelId: ProtocolId,
	folderId: ProtocolId,
	index: number | undefined,
): void {
	const panel = requirePanel(state, panelId);
	const target = requireFolder(state, folderId);
	if (target.projectId !== panel.projectId)
		throw new Error('folder is outside the panel project');
	if (target.id !== panel.folderId) removeFromFolder(state, panel.folderId, panelId);
	const current = requireFolder(state, folderId);
	const ids = current.panelIds.filter((id) => id !== panelId);
	ids.splice(indexAt(index, ids.length), 0, panelId);
	const { captureOffer, ...rest } = current;
	state.folders[folderId] = withFolderPanels(
		{
			...rest,
			...(captureOffer === undefined || captureOffer.panelId === panelId
				? {}
				: { captureOffer }),
		},
		ids,
		panelId,
	);
	state.panels[panelId] = { ...panel, folderId } as WorkspacePanel;
	syncProject(state, panel.projectId, panelId);
}

/** The folder a new panel lands in: the one named, or General. */
function folderForNewPanel(
	state: WorkspaceState,
	project: WorkspaceProject,
	folderId: ProtocolId | undefined,
): WorkspaceFolder {
	const folder = requireFolder(
		state,
		folderId ?? generalFolderId(state, project.id) ?? '',
	);
	if (folder.projectId !== project.id)
		throw new Error('folder is outside project');
	return folder;
}

/** Drop every folder's reference to a panel that is closing or leaving the
 * project. */
function forgetPanelReferences(
	state: MutableWorkspaceState,
	projectId: ProtocolId,
	panelId: ProtocolId,
): void {
	const project = state.projects[projectId];
	for (const folderId of project?.folderIds ?? []) {
		const folder = state.folders[folderId];
		if (folder === undefined) continue;
		if (
			folder.createdByPanelId !== panelId &&
			folder.captureOffer?.panelId !== panelId
		)
			continue;
		const {
			createdByPanelId: creator,
			captureOffer: offer,
			...rest
		} = folder;
		state.folders[folderId] = {
			...rest,
			...(creator === undefined || creator === panelId
				? {}
				: { createdByPanelId: creator }),
			...(offer === undefined || offer.panelId === panelId
				? {}
				: { captureOffer: offer }),
		};
	}
}

/** Recompute what a project derives from its folders: its panel list in folder
 * order, an active panel that still exists, and its layout. Every command that
 * changes a folder's panels ends here. */
function syncProject(
	state: MutableWorkspaceState,
	projectId: ProtocolId,
	activePanelId?: ProtocolId,
): void {
	const project = state.projects[projectId];
	if (project === undefined) return;
	const folders = project.folderIds
		.map((folderId) => state.folders[folderId])
		.filter((folder): folder is WorkspaceFolder => folder !== undefined);
	const panelIds = folders.flatMap((folder) => folder.panelIds);
	const wanted = activePanelId ?? project.activePanelId;
	const active =
		wanted !== undefined && panelIds.includes(wanted)
			? wanted
			: folders.find((folder) => folder.activePanelId !== undefined)
					?.activePanelId;
	const occupied = folders.filter((folder) => folder.panelIds.length > 0);
	const { activePanelId: _previousActivePanelId, ...rest } = project;
	state.projects[projectId] = {
		...rest,
		panelIds,
		...(active === undefined ? {} : { activePanelId: active }),
		layout:
			occupied.length === 1 && occupied[0] !== undefined
				? occupied[0].layout
				: stack(panelIds, active),
	};
}

/** One commit as the store remembers it. */
interface CommittedChange extends WorkspaceCommittedChange {
	readonly event: WorkspaceEvent;
	readonly bytes: number;
}

type WorkspaceApplyOutcome =
	| {
			readonly ok: true;
			readonly revision: number;
			readonly cursor: string;
			readonly event: WorkspaceEvent;
	  }
	| { readonly ok: false; readonly conflict: WorkspaceConflict };

export type WorkspaceChangeListener = (
	event: WorkspaceEvent,
	record: WorkspaceChangeRecord,
) => void;

/** Retained change records are bounded in total size as well as in number. */
const DEFAULT_MAX_HISTORY_BYTES = 8 * 1024 * 1024;

/**
 * In-memory authoritative workspace reducer. Persistence adapters can commit
 * the returned state atomically; no renderer/window identity is involved.
 *
 * The committed state is one frozen value that every reader shares. A commit
 * copies it once, into the draft a command is reduced on, and the state that
 * results shares every object the command left alone (ADR-0059).
 */
export class WorkspaceStore {
	private current: WorkspaceState;
	private readonly outcomes = new Map<ProtocolId, WorkspaceApplyOutcome>();
	private readonly history: CommittedChange[] = [];
	private historyBytes = 0;
	private readonly maxHistory: number;
	private readonly maxHistoryBytes: number;

	constructor(
		initial: WorkspaceState,
		options: {
			readonly maxHistory?: number;
			/** Bound, in UTF-16 units of their serialised form, on the change
			 * records retained for deltas and for replaying a command id. */
			readonly maxHistoryBytes?: number;
			/** Transaction hook invoked before a reducer result becomes visible.
			 * Production repositories use this to atomically replace durable state;
			 * throwing leaves the previous in-memory revision authoritative. The
			 * state it is given is the shared, frozen one. */
			readonly commit?: (state: WorkspaceState) => void;
		} = {},
	) {
		this.current = deepFreeze(clone(canonicalizeWorkspaceState(initial)));
		this.maxHistory = options.maxHistory ?? 1024;
		this.maxHistoryBytes = options.maxHistoryBytes ?? DEFAULT_MAX_HISTORY_BYTES;
		this.commit = options.commit;
		if (!Number.isSafeInteger(this.maxHistory) || this.maxHistory <= 0)
			throw new RangeError('maxHistory must be positive');
		if (
			!Number.isSafeInteger(this.maxHistoryBytes) ||
			this.maxHistoryBytes <= 0
		)
			throw new RangeError('maxHistoryBytes must be positive');
	}
	private readonly commit: ((state: WorkspaceState) => void) | undefined;
	private readonly listeners = new Set<WorkspaceChangeListener>();

	/** Observe committed commands. Observers cannot affect the command. */
	subscribe(listener: WorkspaceChangeListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Projects that are the active project of some view. */
	activeProjectIds(): ReadonlySet<ProtocolId> {
		const ids = new Set<ProtocolId>();
		for (const view of Object.values(this.current.views))
			if (view.activeProjectId !== undefined) ids.add(view.activeProjectId);
		return ids;
	}

	/** The committed state. It is frozen and shared: read it, never change it. */
	get state(): WorkspaceState {
		return this.current;
	}
	snapshot(): WorkspaceSnapshot {
		return { state: this.current, events: [] };
	}
	delta(afterRevision: number): WorkspaceDelta {
		if (
			!Number.isSafeInteger(afterRevision) ||
			afterRevision < 0 ||
			afterRevision > this.current.revision
		)
			throw new RangeError('invalid revision');
		const oldest = this.history[0]?.event.revision;
		// Without history every revision but the current one is out of reach.
		const reachable =
			afterRevision === this.current.revision ||
			(oldest !== undefined && afterRevision >= oldest - 1);
		if (!reachable) return this.snapshot();
		const since = this.history.filter(
			(change) => change.event.revision > afterRevision,
		);
		return {
			state: this.current,
			events: since.map((change) => change.event),
			records: since.map((change) => change.record),
			changes: since,
		};
	}

	/** The change record that produced `revision`, while it is retained. */
	recordAt(revision: number): WorkspaceChangeRecord | undefined {
		return this.changeAt(revision)?.record;
	}

	/** The commit that produced `revision`, while it is retained. */
	changeAt(revision: number): WorkspaceCommittedChange | undefined {
		// The newest commit is the one asked for when a change is published.
		for (let index = this.history.length - 1; index >= 0; index -= 1) {
			const change = this.history[index];
			if (change === undefined || change.event.revision < revision) break;
			if (change.event.revision === revision) return change;
		}
		return undefined;
	}

	/** UTF-16 units of serialised change records currently retained. */
	get retainedHistoryBytes(): number {
		return this.historyBytes;
	}

	/**
	 * Make a validated draft the committed state: number it, share what it left
	 * unchanged, write it, and only then let anyone see it.
	 */
	private install(
		next: MutableWorkspaceState,
		commandId: ProtocolId,
		type: WorkspaceCommand['type'],
		changedIds: readonly ProtocolId[],
	): CommittedChange {
		const fromRevision = this.current.revision;
		next.revision = fromRevision + 1;
		next.cursor = String(next.revision);
		const settled = settleCommittedState(this.current, next);
		const record: WorkspaceChangeRecord = Object.freeze({
			fromRevision,
			revision: next.revision,
			cursor: next.cursor,
			type,
			...settled,
		});
		const event: WorkspaceEvent = Object.freeze({
			revision: next.revision,
			cursor: next.cursor,
			commandId,
			type,
			changedIds: Object.freeze([...changedIds]),
		});
		this.commit?.(next);
		const previous = this.current;
		this.current = next;
		const change: CommittedChange = {
			event,
			record,
			previous,
			state: next,
			bytes: recordBytes(record),
		};
		this.history.push(change);
		this.historyBytes += change.bytes;
		// The newest record is always kept: it is what the commit publishes.
		while (
			this.history.length > 1 &&
			(this.history.length > this.maxHistory ||
				this.historyBytes > this.maxHistoryBytes)
		) {
			const dropped = this.history.shift();
			if (dropped === undefined) break;
			this.historyBytes -= dropped.bytes;
			// A command id is replayed only while its record is retained.
			const outcome = this.outcomes.get(dropped.event.commandId);
			if (outcome?.ok === true && outcome.event === dropped.event)
				this.outcomes.delete(dropped.event.commandId);
		}
		return change;
	}

	private remember(commandId: ProtocolId, outcome: WorkspaceApplyOutcome): void {
		this.outcomes.set(commandId, outcome);
		// Refusals have no record to be dropped with, so they are bounded by
		// count: the oldest outcomes go first.
		for (const id of this.outcomes.keys()) {
			if (this.outcomes.size <= this.maxHistory * 2) break;
			this.outcomes.delete(id);
		}
	}

	private replay(outcome: WorkspaceApplyOutcome): WorkspaceApplyResult {
		return outcome.ok ? { ...outcome, state: this.current } : outcome;
	}

	apply(envelope: WorkspaceCommandEnvelope): WorkspaceApplyResult {
		assertId(envelope.commandId, 'commandId');
		const prior = this.outcomes.get(envelope.commandId);
		if (prior !== undefined) return this.replay(prior);
		const refuse = (message: string): WorkspaceApplyResult => {
			const conflict: WorkspaceApplyOutcome = Object.freeze({
				ok: false,
				conflict: Object.freeze({
					code: 'conflict',
					currentRevision: this.current.revision,
					currentCursor: this.current.cursor,
					message,
				}),
			});
			this.remember(envelope.commandId, conflict);
			return conflict;
		};
		if (
			envelope.expectedRevision !== undefined &&
			envelope.expectedRevision !== this.current.revision
		)
			return refuse('workspace revision is stale');
		const next = clone(this.current) as MutableWorkspaceState;
		const changedIds: ProtocolId[] = [];
		try {
			this.reduce(next, envelope.command, changedIds);
			validateWorkspace(next);
		} catch (error) {
			return refuse(
				error instanceof Error ? error.message : 'workspace command rejected',
			);
		}
		const { event, record } = this.install(
			next,
			envelope.commandId,
			envelope.command.type,
			changedIds,
		);
		const outcome: WorkspaceApplyOutcome = {
			ok: true,
			revision: event.revision,
			cursor: event.cursor,
			event,
		};
		this.remember(envelope.commandId, outcome);
		for (const listener of this.listeners) {
			try {
				listener(event, record);
			} catch {
				/* observers cannot roll back a committed command */
			}
		}
		return this.replay(outcome);
	}

	markInterruptedSessions(at = Date.now()): WorkspaceState {
		const next = clone(this.current) as MutableWorkspaceState;
		const changedIds: ProtocolId[] = [];
		for (const [id, session] of Object.entries(next.terminalSessions))
			if (session.status === 'running') {
				next.terminalSessions[id] = {
					...session,
					status: 'interrupted',
					interruptedAt: at,
				};
				changedIds.push(id);
			}
		if (changedIds.length === 0) return this.current;
		validateWorkspace(next);
		this.install(next, 'system:restart', 'terminal.markInterrupted', changedIds);
		return this.current;
	}

	/**
	 * Privileged server restart recovery when a session holder keeps PTYs
	 * running across restarts. A session the holder still has is running again
	 * under its original identity; one the holder saw exit is exited with its
	 * code; every other formerly live session stays interrupted. Panels are
	 * never touched: a session that is gone keeps its place in the layout.
	 */
	reconcileHeldTerminalSessions(
		live: ReadonlySet<ProtocolId>,
		exited: ReadonlyMap<ProtocolId, number | undefined>,
		at = Date.now(),
	): WorkspaceState {
		const next = clone(this.current) as MutableWorkspaceState;
		const changedIds: ProtocolId[] = [];
		for (const [id, session] of Object.entries(next.terminalSessions)) {
			if (live.has(id)) {
				if (session.status === 'exited') continue;
				if (session.status === 'running') continue;
				const { interruptedAt: _interruptedAt, ...rest } = session;
				next.terminalSessions[id] = { ...rest, status: 'running' };
				changedIds.push(id);
				continue;
			}
			if (session.status === 'exited') continue;
			if (exited.has(id)) {
				const exitCode = exited.get(id);
				const { interruptedAt: _interruptedAt, ...rest } = session;
				next.terminalSessions[id] = {
					...rest,
					status: 'exited',
					...(exitCode === undefined ? {} : { exitCode }),
				};
				changedIds.push(id);
				continue;
			}
			if (session.status === 'running') {
				next.terminalSessions[id] = {
					...session,
					status: 'interrupted',
					interruptedAt: at,
				};
				changedIds.push(id);
			}
		}
		if (changedIds.length === 0) return this.current;
		validateWorkspace(next);
		this.install(
			next,
			'system:terminal-reattach',
			'terminal.markInterrupted',
			changedIds,
		);
		return this.current;
	}

	/** Privileged server restart recovery. A persisted terminal describes a PTY
	 * owned by the server process that created it, so once that process is gone
	 * neither its panel nor an unpresented session record can be restored as live
	 * state. What makes them stale is the restart, not which host was running, so
	 * this applies equally to an embedded Desktop server and a standalone one.
	 * This deliberately is not a renderer command: it is used before the server
	 * starts its replacement terminals. */
	discardStaleTerminalState(): WorkspaceState {
		const next = clone(this.current) as MutableWorkspaceState;
		const changedIds: ProtocolId[] = [];
		const stalePanelIds = new Set(
			Object.values(next.panels)
				.filter((panel) => panel.type === 'terminal')
				.map((panel) => panel.id),
		);
		for (const panelId of stalePanelIds) {
			delete next.panels[panelId];
			changedIds.push(panelId);
		}
		for (const project of Object.values(next.projects)) {
			if (!project.panelIds.some((panelId) => stalePanelIds.has(panelId)))
				continue;
			for (const folderId of project.folderIds) {
				const folder = next.folders[folderId];
				if (folder === undefined) continue;
				const { createdByPanelId, captureOffer, ...rest } = folder;
				next.folders[folderId] = withFolderPanels(
					{
						...rest,
						...(createdByPanelId === undefined ||
						stalePanelIds.has(createdByPanelId)
							? {}
							: { createdByPanelId }),
						...(captureOffer === undefined ||
						stalePanelIds.has(captureOffer.panelId)
							? {}
							: { captureOffer }),
					},
					folder.panelIds.filter((panelId) => !stalePanelIds.has(panelId)),
					folder.activePanelId,
				);
			}
			syncProject(next, project.id);
			changedIds.push(project.id);
		}
		for (const sessionId of Object.keys(next.terminalSessions)) {
			delete next.terminalSessions[sessionId];
			changedIds.push(sessionId);
		}
		if (changedIds.length === 0) return this.current;
		validateWorkspace(next);
		this.install(
			next,
			'system:terminal-restart',
			'terminal.markInterrupted',
			changedIds,
		);
		return this.current;
	}

	/** Server-internal: return the automation terminal space's project id,
	 * creating it on first use. This is deliberately not a workspace command, so
	 * no client can create, recreate, or shape the reserved project. The space
	 * executes on this server's own local environment like every project
	 * (ADR-0017); `root` is the server's default working directory for it. */
	ensureAutomationSpace(options: { readonly root: string }): ProtocolId {
		const existing = findAutomationSpace(this.current);
		if (existing !== undefined) return existing.id;
		if (this.current.projects[AUTOMATION_SPACE_PROJECT_ID] !== undefined)
			throw new Error('automation space identity is already in use');
		const viewId = this.current.viewOrder[0];
		if (viewId === undefined) throw new Error('workspace has no view');
		const next = clone(this.current) as MutableWorkspaceState;
		const general = generalFolder(
			issuedFolderId(next),
			AUTOMATION_SPACE_PROJECT_ID,
		);
		next.folders[general.id] = general;
		next.projects[AUTOMATION_SPACE_PROJECT_ID] = {
			id: AUTOMATION_SPACE_PROJECT_ID,
			kind: AUTOMATION_PROJECT_KIND,
			serverId: next.serverId,
			viewId,
			root: boundedPath(options.root),
			rootOrigin: 'server-default',
			name: AUTOMATION_SPACE_NAME,
			sidebar: defaultWorkspaceSidebarState(),
			folderIds: [general.id],
			panelIds: [],
			layout: stack([]),
		};
		validateWorkspace(next);
		this.install(next, 'system:automation-space', 'project.create', [
			AUTOMATION_SPACE_PROJECT_ID,
		]);
		return AUTOMATION_SPACE_PROJECT_ID;
	}

	private reduce(
		state: MutableWorkspaceState,
		command: WorkspaceCommand,
		changed: ProtocolId[],
	): void {
		const refusal = automationSpaceRefusal(state, command);
		if (refusal !== undefined) throw new Error(refusal);
		switch (command.type) {
			case 'view.create': {
				assertId(command.viewId, 'viewId');
				if (state.views[command.viewId] !== undefined)
					throw new Error('view already exists');
				state.views[command.viewId] = {
					id: command.viewId,
					serverId: state.serverId,
					name: boundedName(command.name),
					projectIds: [],
				};
				state.viewOrder = [...state.viewOrder, command.viewId];
				changed.push(command.viewId);
				break;
			}
			case 'view.rename': {
				const view = requireView(state, command.viewId);
				state.views[command.viewId] = {
					...view,
					name: boundedName(command.name),
				};
				changed.push(command.viewId);
				break;
			}
			case 'view.close': {
				const view = requireView(state, command.viewId);
				if (view.projectIds.length > 0)
					throw new Error('view must be empty before close');
				if (state.viewOrder.length <= 1)
					throw new Error('cannot close the last view');
				delete state.views[command.viewId];
				state.viewOrder = state.viewOrder.filter((id) => id !== command.viewId);
				// The automation space is never listed in a view, so an otherwise
				// empty view may still be its home; move it rather than refuse.
				const home = state.viewOrder[0];
				for (const project of Object.values(state.projects))
					if (project.viewId === command.viewId && home !== undefined) {
						state.projects[project.id] = { ...project, viewId: home };
						changed.push(project.id);
					}
				changed.push(command.viewId);
				break;
			}
			case 'project.create': {
				assertId(command.projectId, 'projectId');
				if (state.projects[command.projectId] !== undefined)
					throw new Error('project already exists');
				const view = requireView(state, command.viewId);
				const general = generalFolder(issuedFolderId(state), command.projectId);
				state.folders[general.id] = general;
				changed.push(general.id);
				const project: WorkspaceProject = {
					id: command.projectId,
					serverId: state.serverId,
					viewId: command.viewId,
					root: boundedPath(command.root),
					rootOrigin: command.rootOrigin ?? 'explicit',
					name:
						command.name === undefined || command.name.trim().length === 0
							? nextDefaultProjectName(state)
							: boundedName(command.name),
					sidebar: normalizeWorkspaceSidebarState(command.sidebar),
					folderIds: [general.id],
					panelIds: [],
					layout: stack([]),
					...(command.color === undefined
						? {}
						: { color: boundedPresentation(command.color, 'color') }),
					...(command.icon === undefined
						? {}
						: { icon: boundedPresentation(command.icon, 'icon') }),
				};
				state.projects[command.projectId] = project;
				state.views[command.viewId] = {
					...view,
					projectIds: [...view.projectIds, command.projectId],
					activeProjectId: command.projectId,
				};
				changed.push(command.projectId, command.viewId);
				break;
			}
			case 'project.sidebar.update': {
				const project = requireProject(state, command.projectId);
				state.projects[command.projectId] = {
					...project,
					sidebar: patchWorkspaceSidebarState(project.sidebar, command.sidebar),
				};
				changed.push(command.projectId);
				break;
			}
			case 'project.root.update': {
				const project = requireProject(state, command.projectId);
				state.projects[command.projectId] = {
					...project,
					root: boundedPath(command.root),
				};
				changed.push(command.projectId);
				break;
			}
			case 'project.shellProfile.set': {
				assertId(command.profileId, 'profileId');
				const project = requireProject(state, command.projectId);
				state.projects[command.projectId] = {
					...project,
					defaultShellProfileId: command.profileId,
				};
				changed.push(command.projectId);
				break;
			}
			case 'project.shellProfile.clear': {
				const project = requireProject(state, command.projectId);
				const { defaultShellProfileId: _removed, ...withoutDefault } = project;
				state.projects[command.projectId] = withoutDefault;
				changed.push(command.projectId);
				break;
			}
			case 'project.shellProfile.replace': {
				assertId(command.fromProfileId, 'fromProfileId');
				if (command.toProfileId !== undefined)
					assertId(command.toProfileId, 'toProfileId');
				for (const [projectId, project] of Object.entries(state.projects)) {
					if (project.defaultShellProfileId !== command.fromProfileId) continue;
					if (command.toProfileId === undefined) {
						const { defaultShellProfileId: _removed, ...withoutDefault } =
							project;
						state.projects[projectId] = withoutDefault;
					} else
						state.projects[projectId] = {
							...project,
							defaultShellProfileId: command.toProfileId,
						};
					changed.push(projectId);
				}
				break;
			}
			case 'project.activate': {
				const project = requireProject(state, command.projectId);
				const view = requireView(state, project.viewId);
				state.views[view.id] = { ...view, activeProjectId: project.id };
				changed.push(project.id, view.id);
				break;
			}
			case 'project.rename': {
				const project = requireProject(state, command.projectId);
				state.projects[command.projectId] = {
					...project,
					name: boundedName(command.name),
				};
				changed.push(command.projectId);
				break;
			}
			case 'project.update': {
				const project = requireProject(state, command.projectId);
				state.projects[command.projectId] = {
					...project,
					name: boundedName(command.name),
					root: boundedPath(command.root),
					...(command.color === undefined
						? {}
						: { color: boundedPresentation(command.color, 'color') }),
					...(command.icon === undefined
						? {}
						: { icon: boundedPresentation(command.icon, 'icon') }),
				};
				changed.push(command.projectId);
				break;
			}
			case 'project.move': {
				const project = requireProject(state, command.projectId);
				const from = requireView(state, project.viewId);
				const to = requireView(state, command.targetViewId);
				const sourceProjectIds = from.projectIds.filter(
					(id) => id !== project.id,
				);
				state.views[project.viewId] = withActiveProject(
					from,
					sourceProjectIds,
					from.activeProjectId === project.id
						? sourceProjectIds[0]
						: from.activeProjectId,
				);
				const ids = to.projectIds.filter((id) => id !== project.id);
				ids.splice(indexAt(command.index, ids.length), 0, project.id);
				state.views[command.targetViewId] = {
					...to,
					projectIds: ids,
					activeProjectId: project.id,
				};
				state.projects[project.id] = {
					...project,
					viewId: command.targetViewId,
				};
				changed.push(project.id, from.id, to.id);
				break;
			}
			case 'project.close': {
				const project = requireProject(state, command.projectId);
				const view = requireView(state, project.viewId);
				for (const panelId of project.panelIds) {
					delete state.panels[panelId];
					changed.push(panelId);
				}
				for (const folderId of project.folderIds) {
					delete state.folders[folderId];
					changed.push(folderId);
				}
				for (const [sessionId, session] of Object.entries(
					state.terminalSessions,
				)) {
					if (session.projectId !== project.id) continue;
					delete state.terminalSessions[sessionId];
					changed.push(sessionId);
				}
				delete state.projects[project.id];
				const remainingProjectIds = view.projectIds.filter(
					(id) => id !== project.id,
				);
				state.views[view.id] = withActiveProject(
					view,
					remainingProjectIds,
					view.activeProjectId === project.id
						? remainingProjectIds[0]
						: view.activeProjectId,
				);
				changed.push(project.id, view.id);
				break;
			}
			case 'panel.create': {
				const panel = command.panel;
				assertId(panel.id, 'panelId');
				if (state.panels[panel.id] !== undefined)
					throw new Error('panel already exists');
				const project = requireProject(state, panel.projectId);
				if (panel.type === 'terminal') {
					const session = state.terminalSessions[panel.sessionId];
					if (session === undefined || session.projectId !== panel.projectId)
						throw new Error('terminal session is outside project');
				}
				const folder = folderForNewPanel(state, project, panel.folderId);
				const created = {
					...clone(panel),
					folderId: folder.id,
				} as WorkspacePanel;
				// Whatever title sources the input names, the server assigns them.
				state.panels[panel.id] =
					created.type === 'terminal'
						? withTitleSources(
								created,
								terminalTitlesAtCreation(state, project.id, panel.title),
							)
						: created;
				state.folders[folder.id] = withFolderPanels(
					folder,
					[...folder.panelIds, panel.id],
					panel.id,
				);
				syncProject(state, project.id, panel.id);
				changed.push(panel.id, folder.id, project.id);
				break;
			}
			case 'folder.create': {
				const project = requireProject(state, command.projectId);
				if (isAutomationSpace(project))
					throw new Error('the automation space has no other folders');
				const link =
					command.worktree === undefined
						? undefined
						: validateWorktreeLink(command.worktree);
				if (command.createdByPanelId !== undefined) {
					if (link === undefined)
						throw new Error('only a linked folder records its creator');
					if (
						requirePanel(state, command.createdByPanelId).projectId !== project.id
					)
						throw new Error('panel is outside project');
				}
				// A worktree's folder is named after its directory, whatever else
				// is called that. A folder someone names must be told apart.
				const name = boundedName(command.name);
				if (link === undefined) requireUnusedFolderName(state, project, name);
				const folder: WorkspaceFolder = {
					id: issuedFolderId(state),
					projectId: project.id,
					name,
					kind: link === undefined ? 'plain' : 'linked',
					...(link === undefined ? {} : { worktree: link }),
					panelIds: [],
					layout: stack([]),
					...(command.createdByPanelId === undefined
						? {}
						: { createdByPanelId: command.createdByPanelId }),
				};
				state.folders[folder.id] = folder;
				state.projects[project.id] = {
					...project,
					folderIds: [...project.folderIds, folder.id],
				};
				changed.push(folder.id, project.id);
				break;
			}
			case 'folder.rename': {
				const folder = requireFolder(state, command.folderId);
				if (folder.kind === 'general')
					throw new Error('the General folder cannot be renamed');
				const name = boundedName(command.name);
				requireUnusedFolderName(
					state,
					requireProject(state, folder.projectId),
					name,
					folder.id,
				);
				state.folders[folder.id] = { ...folder, name };
				changed.push(folder.id);
				break;
			}
			case 'folder.reorder': {
				const project = requireProject(state, command.projectId);
				if (
					command.folderIds.length !== project.folderIds.length ||
					new Set(command.folderIds).size !== project.folderIds.length ||
					command.folderIds.some((id) => !project.folderIds.includes(id))
				)
					throw new Error('folder reorder crosses project boundary');
				state.projects[project.id] = {
					...project,
					folderIds: [...command.folderIds],
				};
				syncProject(state, project.id);
				changed.push(project.id, ...command.folderIds);
				break;
			}
			case 'folder.delete': {
				const folder = requireFolder(state, command.folderId);
				if (folder.kind === 'general')
					throw new Error('the General folder cannot be deleted');
				if (folder.panelIds.length > 0)
					throw new Error('folder must be empty before delete');
				const project = requireProject(state, folder.projectId);
				delete state.folders[folder.id];
				state.projects[project.id] = {
					...project,
					folderIds: project.folderIds.filter((id) => id !== folder.id),
				};
				changed.push(folder.id, project.id);
				break;
			}
			case 'folder.link.update': {
				const folder = requireFolder(state, command.folderId);
				if (folder.kind !== 'linked')
					throw new Error('only a linked folder has a worktree');
				state.folders[folder.id] = {
					...folder,
					worktree: validateWorktreeLink(command.worktree),
				};
				changed.push(folder.id);
				break;
			}
			case 'folder.offer.set': {
				const folder = requireFolder(state, command.folderId);
				const panel = requirePanel(state, command.panelId);
				if (panel.projectId !== folder.projectId)
					throw new Error('panel is outside project');
				if (panel.folderId === folder.id)
					throw new Error('panel is already in the folder');
				state.folders[folder.id] = {
					...folder,
					captureOffer: { panelId: panel.id },
				};
				changed.push(folder.id, panel.id);
				break;
			}
			case 'folder.offer.accept': {
				const folder = requireFolder(state, command.folderId);
				if (folder.captureOffer === undefined)
					throw new Error('folder has no offer');
				const panelId = folder.captureOffer.panelId;
				movePanelToFolder(state, panelId, folder.id, undefined);
				changed.push(folder.id, panelId, folder.projectId);
				break;
			}
			case 'folder.offer.decline': {
				const folder = requireFolder(state, command.folderId);
				if (folder.captureOffer === undefined)
					throw new Error('folder has no offer');
				const { captureOffer: _declined, ...rest } = folder;
				state.folders[folder.id] = rest;
				changed.push(folder.id);
				break;
			}
			case 'panel.moveToFolder': {
				const panel = requirePanel(state, command.panelId);
				const from = panel.folderId;
				movePanelToFolder(state, panel.id, command.folderId, command.index);
				changed.push(panel.id, from, command.folderId, panel.projectId);
				break;
			}
			case 'panel.update': {
				const panel = requirePanel(state, command.panelId);
				if (
					typeof command.patch !== 'object' ||
					command.patch === null ||
					Array.isArray(command.patch)
				)
					throw new Error('panel patch must be an object');
				const patch = command.patch as Record<string, JsonValue>;
				if (
					'projectId' in patch ||
					'folderId' in patch ||
					'id' in patch ||
					'type' in patch
				)
					throw new Error('panel ownership/type is immutable');
				if ('metadataRevision' in patch)
					throw new Error('panel metadata revision is server-assigned');
				if (
					'defaultTitle' in patch ||
					'namedTitle' in patch ||
					'programTitle' in patch
				)
					throw new Error('panel title sources are server-assigned');
				const { note, ...rest } = patch;
				let next = {
					...panel,
					...(rest as Partial<WorkspacePanel>),
				} as WorkspacePanel & { note?: string; metadataRevision?: number };
				if ('note' in patch) {
					if (panel.type !== 'terminal')
						throw new Error('only a terminal panel has a note');
					if (note === null) delete next.note;
					else {
						assertPanelNote(note);
						next.note = note;
					}
				}
				if (panel.type === 'terminal') {
					// A patched title is a name someone gave the terminal; an empty
					// one takes that name away again.
					const sources = terminalTitleSources(state, panel);
					const { namedTitle: _named, ...unnamed } = sources;
					const title = patch.title;
					const renamed: TerminalTitleSources = !('title' in patch)
						? sources
						: title === null ||
								(typeof title === 'string' && title.trim().length === 0)
							? unnamed
							: { ...unnamed, namedTitle: boundedName(title as string) };
					next = withTitleSources(next as TerminalPanel, renamed);
					if (
						renamed.namedTitle !== sources.namedTitle ||
						next.note !== panel.note
					)
						next.metadataRevision = (panel.metadataRevision ?? 0) + 1;
				}
				state.panels[panel.id] = next;
				changed.push(panel.id);
				break;
			}
			case 'panel.reorder': {
				const project = requireProject(state, command.projectId);
				const folderId =
					command.folderId ??
					state.panels[command.panelIds[0] ?? '']?.folderId ??
					generalFolderId(state, project.id);
				const folder = requireFolder(state, folderId ?? '');
				if (folder.projectId !== project.id)
					throw new Error('folder is outside project');
				if (
					command.panelIds.length !== folder.panelIds.length ||
					new Set(command.panelIds).size !== folder.panelIds.length ||
					command.panelIds.some((id) => !folder.panelIds.includes(id))
				)
					throw new Error('panel reorder crosses folder boundary');
				state.folders[folder.id] = withFolderPanels(
					folder,
					command.panelIds,
					folder.activePanelId,
				);
				syncProject(state, project.id);
				changed.push(project.id, folder.id, ...command.panelIds);
				break;
			}
			case 'panel.split': {
				const project = requireProject(state, command.projectId);
				if (!project.panelIds.includes(command.panelId))
					throw new Error('panel is outside project');
				const folder = requireFolder(
					state,
					requirePanel(state, command.panelId).folderId,
				);
				state.folders[folder.id] = {
					...folder,
					layout: {
						kind: 'split',
						direction: command.direction,
						weight: command.weight ?? 0.5,
						first: stack([command.panelId], command.panelId),
						second: stack(
							folder.panelIds.filter((id) => id !== command.panelId),
						),
					},
				};
				syncProject(state, project.id);
				changed.push(project.id, folder.id, command.panelId);
				break;
			}
			case 'panel.activate': {
				const project = requireProject(state, command.projectId);
				if (!project.panelIds.includes(command.panelId))
					throw new Error('panel is outside project');
				const folder = requireFolder(
					state,
					requirePanel(state, command.panelId).folderId,
				);
				state.folders[folder.id] = {
					...folder,
					activePanelId: command.panelId,
					layout:
						folder.layout.kind === 'stack'
							? stack(folder.panelIds, command.panelId)
							: folder.layout,
				};
				syncProject(state, project.id, command.panelId);
				changed.push(project.id, folder.id, command.panelId);
				break;
			}
			case 'panel.move': {
				const panel = requirePanel(state, command.panelId);
				const from = requireProject(state, panel.projectId);
				const to = requireProject(state, command.targetProjectId);
				// A panel arriving from another project lands in General.
				const target = folderForNewPanel(state, to, undefined);
				if (from.id === to.id) {
					movePanelToFolder(state, panel.id, panel.folderId, command.index);
					changed.push(panel.id, from.id);
					break;
				}
				forgetPanelReferences(state, from.id, panel.id);
				removeFromFolder(state, panel.folderId, panel.id);
				const targetIds = [...target.panelIds];
				targetIds.splice(indexAt(command.index, targetIds.length), 0, panel.id);
				state.folders[target.id] = withFolderPanels(target, targetIds, panel.id);
				state.panels[panel.id] = {
					...panel,
					projectId: to.id,
					folderId: target.id,
				} as WorkspacePanel;
				syncProject(state, from.id);
				syncProject(state, to.id, panel.id);
				changed.push(panel.folderId, target.id);
				if (panel.type === 'terminal') {
					const session = state.terminalSessions[panel.sessionId];
					if (session === undefined)
						throw new Error('terminal session not found');
					state.terminalSessions[panel.sessionId] = {
						...session,
						projectId: to.id,
					};
				}
				changed.push(panel.id, from.id, to.id);
				if (panel.type === 'terminal') changed.push(panel.sessionId);
				break;
			}
			case 'panel.close': {
				const panel = requirePanel(state, command.panelId);
				const project = requireProject(state, panel.projectId);
				delete state.panels[panel.id];
				if (panel.type === 'terminal') {
					delete state.terminalSessions[panel.sessionId];
					changed.push(panel.sessionId);
				}
				forgetPanelReferences(state, project.id, panel.id);
				removeFromFolder(state, panel.folderId, panel.id);
				// Closing the active panel hands focus to its folder's next panel.
				syncProject(
					state,
					project.id,
					project.activePanelId === panel.id
						? state.folders[panel.folderId]?.activePanelId
						: undefined,
				);
				changed.push(panel.id, panel.folderId, project.id);
				break;
			}
			case 'terminal.create': {
				assertId(command.sessionId, 'sessionId');
				if (state.terminalSessions[command.sessionId] !== undefined)
					throw new Error('terminal session already exists');
				const project = requireProject(state, command.projectId);
				state.terminalSessions[command.sessionId] = {
					id: command.sessionId,
					serverId: state.serverId,
					projectId: project.id,
					status: 'running',
					createdAt: command.createdAt ?? Date.now(),
					outputPosition: 0,
					...(command.launch === undefined
						? {}
						: { launch: validateLaunchMetadata(command.launch) }),
				};
				changed.push(command.sessionId, project.id);
				break;
			}
			case 'terminal.createPanel': {
				assertId(command.sessionId, 'sessionId');
				assertId(command.panelId, 'panelId');
				if (state.terminalSessions[command.sessionId] !== undefined)
					throw new Error('terminal session already exists');
				if (state.panels[command.panelId] !== undefined)
					throw new Error('panel already exists');
				const project = requireProject(state, command.projectId);
				const folder = folderForNewPanel(state, project, command.folderId);
				const createdAt = command.createdAt ?? Date.now();
				state.terminalSessions[command.sessionId] = {
					id: command.sessionId,
					serverId: state.serverId,
					projectId: project.id,
					status: 'running',
					createdAt,
					outputPosition: 0,
					...(command.launch === undefined
						? {}
						: { launch: validateLaunchMetadata(command.launch) }),
				};
				const panel = withTitleSources(
					{
						id: command.panelId,
						projectId: project.id,
						folderId: folder.id,
						type: 'terminal',
						sessionId: command.sessionId,
						createdAt,
						...(command.cwd === undefined
							? {}
							: { cwd: boundedPath(command.cwd) }),
					},
					terminalTitlesAtCreation(state, project.id, command.title),
				);
				state.panels[panel.id] = panel;
				state.folders[folder.id] = withFolderPanels(
					folder,
					[...folder.panelIds, panel.id],
					panel.id,
				);
				syncProject(state, project.id, panel.id);
				changed.push(command.sessionId, panel.id, folder.id, project.id);
				break;
			}
			case 'terminal.markInterrupted': {
				const session = state.terminalSessions[command.sessionId];
				if (session === undefined)
					throw new Error('terminal session not found');
				if (session.status === 'running')
					state.terminalSessions[session.id] = {
						...session,
						status: 'interrupted',
						interruptedAt: command.at ?? Date.now(),
					};
				changed.push(session.id);
				break;
			}
			case 'terminal.markExited': {
				const session = state.terminalSessions[command.sessionId];
				if (session === undefined) break;
				if (session.status === 'running')
					state.terminalSessions[session.id] = {
						...session,
						status: 'exited',
						...(command.exitCode === undefined
							? {}
							: { exitCode: command.exitCode }),
					};
				changed.push(session.id);
				break;
			}
			default:
				// A type the reducer does not know changes nothing, and a commit
				// that changes nothing must not advance the revision for it.
				throw new Error('unknown workspace command');
		}
	}
}

export function isAutomationSpace(
	project: Pick<WorkspaceProject, 'kind'> | undefined,
): boolean {
	return project?.kind === AUTOMATION_PROJECT_KIND;
}

export function findAutomationSpace(
	state: WorkspaceState,
): WorkspaceProject | undefined {
	return Object.values(state.projects).find(isAutomationSpace);
}

export function liveAutomationTerminalCount(state: WorkspaceState): number {
	const space = findAutomationSpace(state);
	if (space === undefined) return 0;
	return Object.values(state.terminalSessions).filter(
		(session) => session.projectId === space.id && session.status === 'running',
	).length;
}

/** The bounded refusal for a command the automation space never accepts, or
 * undefined when the command is allowed. Shared by the reducer and the
 * protocol boundary so both give the same answer. */
export function automationSpaceRefusal(
	state: WorkspaceState,
	command: WorkspaceCommand,
): string | undefined {
	const reserved = (projectId: ProtocolId | undefined) =>
		projectId !== undefined && isAutomationSpace(state.projects[projectId]);
	switch (command.type) {
		case 'project.create':
			return command.projectId === AUTOMATION_SPACE_PROJECT_ID
				? 'project id is reserved'
				: undefined;
		case 'project.close':
			return reserved(command.projectId)
				? 'the automation space cannot be closed'
				: undefined;
		case 'project.rename':
		case 'project.update':
		case 'project.root.update':
			return reserved(command.projectId)
				? 'the automation space cannot be renamed or edited'
				: undefined;
		case 'project.move':
			return reserved(command.projectId)
				? 'the automation space cannot be reordered'
				: undefined;
		case 'project.activate':
			return reserved(command.projectId)
				? 'the automation space cannot be selected as a project'
				: undefined;
		case 'panel.move': {
			const panel = state.panels[command.panelId];
			return reserved(panel?.projectId) || reserved(command.targetProjectId)
				? 'panels cannot move into or out of the automation space'
				: undefined;
		}
		case 'terminal.create':
		case 'terminal.createPanel':
			return reserved(command.projectId) &&
				liveAutomationTerminalCount(state) >= AUTOMATION_SPACE_TERMINAL_LIMIT
				? `the automation space has reached its limit of ${AUTOMATION_SPACE_TERMINAL_LIMIT} live terminals`
				: undefined;
		default:
			return undefined;
	}
}

/** Whether a connection's negotiated feature capabilities include the
 * automations feature, and so whether it may see the automation space. */
export function canSeeAutomationSpace(
	capabilities: readonly string[] | undefined,
): boolean {
	return capabilities?.includes(AUTOMATIONS_FEATURE_CAPABILITY) === true;
}

/** Project a workspace for a connection that did not negotiate
 * `automations.v1`: the reserved project, its panels, and its terminal
 * sessions are absent, as though they had never existed. */
export function withholdAutomationSpace(state: WorkspaceState): WorkspaceState {
	const hidden = new Set(
		Object.values(state.projects)
			.filter(isAutomationSpace)
			.map((project) => project.id),
	);
	if (hidden.size === 0) return state;
	const keep = <T extends { readonly projectId: ProtocolId }>(
		record: Readonly<Record<ProtocolId, T>>,
	) =>
		Object.fromEntries(
			Object.entries(record).filter(
				([, value]) => !hidden.has(value.projectId),
			),
		);
	return {
		...state,
		projects: Object.fromEntries(
			Object.entries(state.projects).filter(([id]) => !hidden.has(id)),
		),
		folders: keep(state.folders),
		panels: keep(state.panels),
		terminalSessions: keep(state.terminalSessions),
	};
}

/** Lowest `Project N` no project holds. Derived here, inside the applied command,
 * so concurrent creations reading the same stale snapshot cannot collide. The
 * seeded default project is named plain `Project` and holds the first slot, so
 * the first project a user creates is `Project 2`. */
function nextDefaultProjectName(state: WorkspaceState): string {
	const taken = new Set<number>();
	for (const project of Object.values(state.projects)) {
		const match = /^Project(?: (\d+))?$/.exec(project.name ?? '');
		if (match === null) continue;
		taken.add(match[1] === undefined ? 1 : Number.parseInt(match[1], 10));
	}
	let candidate = 1;
	while (taken.has(candidate)) candidate += 1;
	return `Project ${candidate}`;
}

function boundedName(value: string): string {
	if (
		typeof value !== 'string' ||
		value.trim().length === 0 ||
		value.length > 256
	)
		throw new Error('name is invalid');
	return value.trim();
}
/** Folder names in one project differ by more than letter case. */
function requireUnusedFolderName(
	state: WorkspaceState,
	project: WorkspaceProject,
	name: string,
	exceptFolderId?: string,
): void {
	const wanted = name.toLowerCase();
	for (const folderId of project.folderIds) {
		if (folderId === exceptFolderId) continue;
		if (state.folders[folderId]?.name.toLowerCase() === wanted)
			throw new Error(`this project already has a folder named ${name}`);
	}
}
function boundedPath(value: string): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > 4096 ||
		value.includes('\0')
	)
		throw new Error('root/path is invalid');
	return value;
}
function boundedPresentation(value: string, name: string): string {
	if (typeof value !== 'string' || value.length > 128 || value.includes('\0'))
		throw new Error(`${name} is invalid`);
	return value;
}
function validateLaunchMetadata(
	value: TerminalLaunchMetadata,
): TerminalLaunchMetadata {
	assertId(value.profileId, 'profileId');
	for (const [name, revision] of [
		['profileRevision', value.profileRevision],
		['workspaceRevision', value.workspaceRevision],
		['settingsRevision', value.settingsRevision],
	] as const) {
		if (!Number.isSafeInteger(revision) || revision < 0)
			throw new Error(`${name} is invalid`);
	}
	return {
		profileId: value.profileId,
		profileRevision: value.profileRevision,
		profileName: boundedName(value.profileName),
		targetSummary: boundedName(value.targetSummary),
		workspaceRevision: value.workspaceRevision,
		settingsRevision: value.settingsRevision,
		...(value.icon === undefined
			? {}
			: { icon: boundedPresentation(value.icon, 'launch icon') }),
		...(value.color === undefined
			? {}
			: { color: boundedPresentation(value.color, 'launch color') }),
	};
}
function requireView(state: WorkspaceState, id: ProtocolId): WorkspaceView {
	assertId(id, 'viewId');
	const value = state.views[id];
	if (value === undefined) throw new Error('view not found');
	return value;
}
/** The project's General folder, wherever it is in the project's order. */
export function generalFolderId(
	state: WorkspaceState,
	projectId: ProtocolId,
): ProtocolId | undefined {
	return state.projects[projectId]?.folderIds.find(
		(folderId) => state.folders[folderId]?.kind === 'general',
	);
}
function requireProject(
	state: WorkspaceState,
	id: ProtocolId,
): WorkspaceProject {
	assertId(id, 'projectId');
	const value = state.projects[id];
	if (value === undefined) throw new Error('project not found');
	return value;
}
function requireFolder(state: WorkspaceState, id: ProtocolId): WorkspaceFolder {
	assertId(id, 'folderId');
	const value = state.folders[id];
	if (value === undefined) throw new Error('folder not found');
	return value;
}
function requirePanel(state: WorkspaceState, id: ProtocolId): WorkspacePanel {
	assertId(id, 'panelId');
	const value = state.panels[id];
	if (value === undefined) throw new Error('panel not found');
	return value;
}
