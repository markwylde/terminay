import type { McpPermissionGroup } from '@terminay/server-core';
import {
	APP_CONTROL_OPERATIONS,
	type AppControlAdapter,
	isAppControlParamFailure,
	PROJECT_REACH_UPDATE_PROJECT_FIELDS,
	parseCloseProject,
	parseCloseWorkspaceWindow,
	parseCreateProject,
	parseListProjects,
	parseListWorkspaceWindows,
	parseMoveProject,
	parseOpenWorkspaceWindow,
	parseRenameWorkspaceWindow,
	parseUpdateProject,
} from './appControlTools.js';
import {
	type AppWindowControlAdapter,
	isAppWindowParamFailure,
	parseCallConnectedTool,
	parseCloseWindow,
	parseListConnectedTools,
	parseShowWindow,
} from './appWindowTools.js';
import {
	type AutomationControlAdapter,
	isAutomationParamFailure,
	parseAutomationId,
	parseCreateAutomation,
	parseDeleteAutomation,
	parseListAutomationRuns,
	parseRunAutomation,
	parseSetAutomationEnabled,
	parseDismissMissedRuns,
	parsePruneAutomationRuns,
	parseRemoveAutomationRun,
	parseStopAutomationRun,
	parseUpdateAutomation,
} from './automationTools.js';
import {
	isMacroParamFailure,
	MACRO_CONTROL_OPERATIONS,
	type MacroControlAdapter,
	parseCancelMacro,
	parseListMacros,
	parseRunMacro,
} from './macroTools.js';
import {
	isSettingsParamFailure,
	parseGetSettings,
	parseListShellProfiles,
	parseReorderShellProfiles,
	parseSaveShellProfile,
	parseShellProfileId,
	parseUpdateSettings,
	SETTINGS_CONTROL_OPERATIONS,
	type SettingsControlAdapter,
} from './settingsTools.js';
import type {
	ControlDispatcher,
	ControlDispatchResult,
	ControlError,
	ControlOperation,
	ControlRequestContext,
	ControlScope,
} from './controlEndpoint.js';
import {
	CONTROL_LARGE_FRAME_OPERATIONS,
	CONTROL_MAX_LARGE_FRAME_BYTES,
	ControlEndpointError,
	MAX_MODEL_CONTEXT_BYTES,
} from './controlEndpoint.js';
import {
	isWorkspaceViewParamFailure,
	parseArrangeTabs,
	parseCloseTab,
	parseCreateFolder,
	parseDeleteFolder,
	parseFocusHome,
	parseFocusProject,
	parseFocusTab,
	parseGetLayout,
	parseMoveTab,
	parseMoveTabToFolder,
	parseOpenFile,
	parsePlacementFields,
	parseRenameFolder,
	parseReorderFolders,
	parseResizePane,
	parseSelectFolder,
	type WorkspaceViewControlAdapter,
} from './workspaceViewTools.js';
import {
	isNotificationParamFailure,
	type NotificationControlAdapter,
	parseDismissNotification,
	parseListNotifications,
	parseSendNotification,
} from './notificationTools.js';

/** A host binding for one operation, already past reach and the gate. */
type OperationHandler = (
	params: Record<string, unknown>,
	context: ControlRequestContext,
	signal: AbortSignal,
) => unknown | Promise<unknown>;

export interface ServerControlHandlers {
	readonly getMcpCapabilities?: (
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly listTerminals?: (
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly readTerminal?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly searchTerminal?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly getTerminalStatus?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly openTerminal?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly writeTerminal?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly runCommand?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly closeTerminal?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly focusTerminal?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly renameTerminal?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly splitTerminal?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly getLayout?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly focusTab?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly moveTab?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly resizePane?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly arrangeTabs?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly focusProject?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly selectFolder?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly createFolder?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly renameFolder?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly moveTabToFolder?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly openFile?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly closeTab?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly waitForIdle?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly waitForCommand?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly waitForAttention?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly listAutomations?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly getAutomation?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly listAutomationRuns?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly createAutomation?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly updateAutomation?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly deleteAutomation?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly setAutomationEnabled?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly runAutomation?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly stopAutomationRun?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly listProjects?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly createProject?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly updateProject?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly moveProject?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly closeProject?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly listWorkspaceWindows?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly openWorkspaceWindow?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly renameWorkspaceWindow?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly closeWorkspaceWindow?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly showWindow?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly closeWindow?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly listWindows?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly sendNotification?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly dismissNotification?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly listConnectedTools?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly callConnectedTool?: (
		params: Record<string, unknown>,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly updateTerminal?: OperationHandler;
	readonly moveTerminalToProject?: OperationHandler;
	readonly focusHome?: OperationHandler;
	readonly deleteFolder?: OperationHandler;
	readonly reorderFolders?: OperationHandler;
	readonly removeAutomationRun?: OperationHandler;
	readonly pruneAutomationRuns?: OperationHandler;
	readonly dismissMissedRuns?: OperationHandler;
	readonly getSettings?: OperationHandler;
	readonly updateSettings?: OperationHandler;
	readonly listShellProfiles?: OperationHandler;
	readonly saveShellProfile?: OperationHandler;
	readonly deleteShellProfile?: OperationHandler;
	readonly reorderShellProfiles?: OperationHandler;
	readonly setDefaultShellProfile?: OperationHandler;
	readonly listMacros?: OperationHandler;
	readonly runMacro?: OperationHandler;
	readonly cancelMacro?: OperationHandler;
	readonly listNotifications?: OperationHandler;
}

/**
 * The MCP permission gate (ADR-0031). It sees only the operation, its fixed
 * permission group, the retained request, and the resolved capability; it
 * resolves once the operation may run, or returns the failure that refuses
 * it. Under an `ask` policy it waits on a user's decision.
 */
export interface ControlPermissionGate {
	authorize(request: {
		readonly op: ControlOperation;
		readonly group: McpPermissionGroup;
		readonly params: Readonly<Record<string, unknown>>;
		readonly context: ControlRequestContext;
	}): Promise<ControlFailure | undefined> | ControlFailure | undefined;
}

export interface ServerControlDispatcherOptions {
	readonly handlers: ServerControlHandlers;
	readonly operationScopes?: Partial<Record<ControlOperation, ControlScope>>;
	readonly maxParamsBytes?: number;
	/** Absent only in hosts and tests that predate the permission policy. */
	readonly permissions?: ControlPermissionGate;
}

/**
 * Each operation's permission group, fixed here and never derived from its
 * parameters, caller, or scope. Capability discovery belongs to none.
 */
export const CONTROL_PERMISSION_GROUPS: Readonly<
	Record<ControlOperation, McpPermissionGroup | undefined>
> = Object.freeze({
	get_mcp_capabilities: undefined,
	list_terminals: 'terminalsRead',
	read_terminal: 'terminalsRead',
	search_terminal: 'terminalsRead',
	get_terminal_status: 'terminalsRead',
	wait_for_idle: 'terminalsRead',
	wait_for_command: 'terminalsRead',
	wait_for_attention: 'terminalsRead',
	open_terminal: 'terminalsManage',
	write_terminal: 'terminalsManage',
	run_command: 'terminalsManage',
	close_terminal: 'terminalsManage',
	focus_terminal: 'terminalsManage',
	rename_terminal: 'terminalsManage',
	update_terminal: 'terminalsManage',
	move_terminal_to_project: 'terminalsManage',
	split_terminal: 'terminalsManage',
	get_layout: 'terminalsRead',
	focus_tab: 'terminalsManage',
	move_tab: 'terminalsManage',
	resize_pane: 'terminalsManage',
	arrange_tabs: 'terminalsManage',
	focus_project: 'terminalsManage',
	focus_home: 'terminalsManage',
	select_folder: 'terminalsManage',
	create_folder: 'terminalsManage',
	rename_folder: 'terminalsManage',
	delete_folder: 'terminalsManage',
	reorder_folders: 'terminalsManage',
	move_tab_to_folder: 'terminalsManage',
	open_file: 'terminalsManage',
	close_tab: 'terminalsManage',
	list_automations: 'automationsRead',
	get_automation: 'automationsRead',
	list_automation_runs: 'automationsRead',
	create_automation: 'automationsManage',
	update_automation: 'automationsManage',
	delete_automation: 'automationsManage',
	set_automation_enabled: 'automationsManage',
	run_automation: 'automationsManage',
	stop_automation_run: 'automationsManage',
	remove_automation_run: 'automationsManage',
	prune_automation_runs: 'automationsManage',
	dismiss_missed_runs: 'automationsManage',
	list_projects: 'projectsWindows',
	create_project: 'projectsWindows',
	update_project: 'projectsWindows',
	move_project: 'projectsWindows',
	close_project: 'projectsWindows',
	list_workspace_windows: 'projectsWindows',
	open_workspace_window: 'projectsWindows',
	rename_workspace_window: 'projectsWindows',
	close_workspace_window: 'projectsWindows',
	get_settings: 'settingsRead',
	update_settings: 'settingsChange',
	list_shell_profiles: 'settingsRead',
	save_shell_profile: 'settingsChange',
	delete_shell_profile: 'settingsChange',
	reorder_shell_profiles: 'settingsChange',
	set_default_shell_profile: 'settingsChange',
	list_macros: 'terminalsManage',
	run_macro: 'terminalsManage',
	cancel_macro: 'terminalsManage',
	show_window: 'appWindows',
	close_window: 'appWindows',
	list_windows: 'appWindows',
	send_notification: 'notifications',
	list_notifications: 'notifications',
	dismiss_notification: 'notifications',
	// Listing never prompts: a tool the policy refuses stays listed and
	// refuses when called.
	list_connected_tools: undefined,
	call_connected_tool: 'connectedServerTools',
});

/** Typed parameter contracts for the server-owned MCP operation boundary. */
export type TerminalRef = string;
export type SplitDirection = 'right' | 'left' | 'above' | 'below';
export type TerminalReadFormat = 'text' | 'ansi' | 'raw';

/**
 * Read controls are deliberately expressed in output bytes/positions rather
 * than JavaScript characters. `after` is meaningful only for raw PTY data:
 * text and ANSI are terminal presentations whose visual rows cannot be
 * safely addressed by a raw stream position.
 */
export interface ReadTerminalParams {
	readonly terminal: TerminalRef;
	readonly format: TerminalReadFormat;
	readonly maxBytes: number;
	readonly lines?: number;
	readonly after?: number;
}
export interface SearchTerminalParams {
	readonly terminal: TerminalRef;
	/** Literal Unicode query; it is never evaluated as a regular expression. */
	readonly query: string;
	readonly caseSensitive: boolean;
	readonly contextLines: number;
	readonly maxMatches: number;
	readonly maxBytes: number;
}
export interface TerminalParams {
	readonly terminal: TerminalRef;
}
export interface OpenTerminalParams {
	readonly name?: string;
	readonly cwd?: string;
	/** Where the new terminal goes, beside `beside`, on the agent's client. */
	readonly split?: SplitDirection;
	/** The tab `split` is relative to; defaults to the calling terminal. */
	readonly beside?: string;
	/** Bring the new terminal to the front on the agent's client. */
	readonly focus?: boolean;
	/** Opaque project handle from a workspace-reach `list_terminals` row. */
	readonly project?: string;
	/** A shell profile id from `list_shell_profiles`, resolved as the New
	 * Terminal action resolves a chosen profile. */
	readonly shellProfile?: string;
}
export interface UpdateTerminalParams {
	readonly terminal: TerminalRef;
	/** The tab's icon; empty clears it. */
	readonly icon?: string;
	/** The tab's colour; empty follows the project's colour. */
	readonly color?: string;
	/** The tab's note; null removes it. */
	readonly note?: string | null;
	/** Whether the tab shows activity. */
	readonly activityTracking?: boolean;
}
export interface MoveTerminalToProjectParams {
	readonly terminal: TerminalRef;
	/** Opaque handle of the project it moves to. */
	readonly project: string;
	readonly position?: number;
}

/** Shape of an opaque project handle (see `workspaceReach.ts`). */
export const PROJECT_HANDLE_PATTERN = /^prj_[A-Za-z0-9_-]{22}$/;
/** Shape of an opaque workspace window handle (see `workspaceReach.ts`). */
export const WINDOW_HANDLE_PATTERN = /^win_[A-Za-z0-9_-]{22}$/;
export interface WriteTerminalParams {
	readonly terminal: TerminalRef;
	readonly text: string;
	readonly submit?: boolean;
}
export interface RunCommandParams {
	readonly terminal: TerminalRef;
	readonly command: string;
}
export interface RenameTerminalParams {
	readonly terminal: TerminalRef;
	readonly name: string;
}
export interface SplitTerminalParams {
	readonly terminal: TerminalRef;
	readonly direction: SplitDirection;
	readonly name?: string;
	readonly focus?: boolean;
}
export interface WaitForIdleParams {
	readonly terminal: TerminalRef;
	readonly seconds: number;
	readonly timeout?: number;
}
export interface WaitParams {
	readonly terminal: TerminalRef;
	readonly timeout?: number;
}

/**
 * Concrete server operation boundary. Hosts bind these methods to
 * TerminalService/workspace/activity services; no method receives a token,
 * renderer id, or caller-supplied project. Every call receives the immutable
 * capability context and abort signal from the local endpoint.
 */
export interface TerminalControlAdapter {
	/** Adapter-global operation availability; omitted adapters report unsupported. */
	readonly getMcpCapabilities?: (
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly listTerminals: (
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly readTerminal: (
		params: ReadTerminalParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	/** Bounded literal search over the current text presentation; omitted adapters report unsupported. */
	readonly searchTerminal?: (
		params: SearchTerminalParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly getTerminalStatus: (
		params: TerminalParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly openTerminal: (
		params: OpenTerminalParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly writeTerminal: (
		params: WriteTerminalParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly runCommand: (
		params: RunCommandParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly closeTerminal: (
		params: TerminalParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly focusTerminal: (
		params: TerminalParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly renameTerminal: (
		params: RenameTerminalParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly splitTerminal: (
		params: SplitTerminalParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly waitForIdle: (
		params: WaitForIdleParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly waitForCommand: (
		params: WaitParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly waitForAttention: (
		params: WaitParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	/** A tab's icon, colour, note, and activity tracking; omitted hosts report
	 * it unsupported. */
	readonly updateTerminal?: (
		params: UpdateTerminalParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	/** The server-committed move of a terminal to another project; omitted
	 * hosts report it unsupported. */
	readonly moveTerminalToProject?: (
		params: MoveTerminalToProjectParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
}

export interface TerminalControlAdapterOptions {
	readonly adapter: TerminalControlAdapter;
	/** Host binding for the automation tools; absent hosts report them unsupported. */
	readonly automations?: AutomationControlAdapter;
	/** Host binding for the app-window and connected-server tools. */
	readonly appWindows?: AppWindowControlAdapter;
	/** Host binding for the notification tools. */
	readonly notifications?: NotificationControlAdapter;
	/** Host binding for the project and workspace window tools (ADR-0072). */
	readonly appControl?: AppControlAdapter;
	/** Host binding for the settings and shell profile tools (ADR-0072). */
	readonly settings?: SettingsControlAdapter;
	/** Host binding for the macro tools (ADR-0072). */
	readonly macros?: MacroControlAdapter;
	/**
	 * The view of the client the agent is talking from (ADR-0070). With it,
	 * `split_terminal`, `open_terminal`'s `split` and `focus`, and
	 * `focus_terminal` act on that client; without it they are unavailable.
	 */
	readonly workspaceView?: WorkspaceViewControlAdapter;
	/** Model context the calling terminal's views left for the next result. */
	readonly takeModelContext?: (
		context: ControlRequestContext,
		/** The most bytes of notes to take; what does not fit is left for later. */
		maxBytes: number,
	) => readonly { readonly title: string; readonly text: string }[];
	readonly permissions?: ControlPermissionGate;
	readonly operationScopes?: Partial<Record<ControlOperation, ControlScope>>;
	readonly maxParamsBytes?: number;
	readonly maxTextBytes?: number;
	readonly maxWaitSeconds?: number;
}

const DEFAULT_SCOPES: Readonly<
	Partial<Record<ControlOperation, ControlScope>>
> = Object.freeze({
	get_mcp_capabilities: 'read',
	list_terminals: 'read',
	read_terminal: 'read',
	search_terminal: 'read',
	get_terminal_status: 'read',
	wait_for_idle: 'read',
	wait_for_command: 'read',
	wait_for_attention: 'read',
	open_terminal: 'write',
	write_terminal: 'write',
	run_command: 'write',
	close_terminal: 'write',
	focus_terminal: 'write',
	rename_terminal: 'write',
	update_terminal: 'write',
	move_terminal_to_project: 'write',
	split_terminal: 'write',
	get_layout: 'read',
	focus_tab: 'write',
	move_tab: 'write',
	resize_pane: 'write',
	arrange_tabs: 'write',
	focus_project: 'write',
	focus_home: 'write',
	select_folder: 'write',
	create_folder: 'write',
	rename_folder: 'write',
	delete_folder: 'write',
	reorder_folders: 'write',
	move_tab_to_folder: 'write',
	open_file: 'write',
	close_tab: 'write',
	list_automations: 'read',
	get_automation: 'read',
	list_automation_runs: 'read',
	create_automation: 'write',
	update_automation: 'write',
	delete_automation: 'write',
	set_automation_enabled: 'write',
	run_automation: 'write',
	stop_automation_run: 'write',
	remove_automation_run: 'write',
	prune_automation_runs: 'write',
	dismiss_missed_runs: 'write',
	list_projects: 'read',
	create_project: 'write',
	update_project: 'write',
	move_project: 'write',
	close_project: 'write',
	list_workspace_windows: 'read',
	open_workspace_window: 'write',
	rename_workspace_window: 'write',
	close_workspace_window: 'write',
	get_settings: 'read',
	update_settings: 'write',
	list_shell_profiles: 'read',
	save_shell_profile: 'write',
	delete_shell_profile: 'write',
	reorder_shell_profiles: 'write',
	set_default_shell_profile: 'write',
	list_macros: 'read',
	run_macro: 'write',
	cancel_macro: 'write',
	show_window: 'write',
	close_window: 'write',
	list_windows: 'read',
	send_notification: 'write',
	list_notifications: 'read',
	dismiss_notification: 'write',
	list_connected_tools: 'read',
	call_connected_tool: 'write',
});

const HANDLER_BY_OPERATION: Readonly<
	Record<ControlOperation, keyof ServerControlHandlers>
> = Object.freeze({
	get_mcp_capabilities: 'getMcpCapabilities',
	list_terminals: 'listTerminals',
	read_terminal: 'readTerminal',
	search_terminal: 'searchTerminal',
	get_terminal_status: 'getTerminalStatus',
	open_terminal: 'openTerminal',
	write_terminal: 'writeTerminal',
	run_command: 'runCommand',
	close_terminal: 'closeTerminal',
	focus_terminal: 'focusTerminal',
	rename_terminal: 'renameTerminal',
	update_terminal: 'updateTerminal',
	move_terminal_to_project: 'moveTerminalToProject',
	split_terminal: 'splitTerminal',
	get_layout: 'getLayout',
	focus_tab: 'focusTab',
	move_tab: 'moveTab',
	resize_pane: 'resizePane',
	arrange_tabs: 'arrangeTabs',
	focus_project: 'focusProject',
	focus_home: 'focusHome',
	select_folder: 'selectFolder',
	create_folder: 'createFolder',
	rename_folder: 'renameFolder',
	delete_folder: 'deleteFolder',
	reorder_folders: 'reorderFolders',
	move_tab_to_folder: 'moveTabToFolder',
	open_file: 'openFile',
	close_tab: 'closeTab',
	wait_for_idle: 'waitForIdle',
	wait_for_command: 'waitForCommand',
	wait_for_attention: 'waitForAttention',
	list_automations: 'listAutomations',
	get_automation: 'getAutomation',
	list_automation_runs: 'listAutomationRuns',
	create_automation: 'createAutomation',
	update_automation: 'updateAutomation',
	delete_automation: 'deleteAutomation',
	set_automation_enabled: 'setAutomationEnabled',
	run_automation: 'runAutomation',
	stop_automation_run: 'stopAutomationRun',
	remove_automation_run: 'removeAutomationRun',
	prune_automation_runs: 'pruneAutomationRuns',
	dismiss_missed_runs: 'dismissMissedRuns',
	list_projects: 'listProjects',
	create_project: 'createProject',
	update_project: 'updateProject',
	move_project: 'moveProject',
	close_project: 'closeProject',
	list_workspace_windows: 'listWorkspaceWindows',
	open_workspace_window: 'openWorkspaceWindow',
	rename_workspace_window: 'renameWorkspaceWindow',
	close_workspace_window: 'closeWorkspaceWindow',
	get_settings: 'getSettings',
	update_settings: 'updateSettings',
	list_shell_profiles: 'listShellProfiles',
	save_shell_profile: 'saveShellProfile',
	delete_shell_profile: 'deleteShellProfile',
	reorder_shell_profiles: 'reorderShellProfiles',
	set_default_shell_profile: 'setDefaultShellProfile',
	list_macros: 'listMacros',
	run_macro: 'runMacro',
	cancel_macro: 'cancelMacro',
	show_window: 'showWindow',
	close_window: 'closeWindow',
	list_windows: 'listWindows',
	send_notification: 'sendNotification',
	list_notifications: 'listNotifications',
	dismiss_notification: 'dismissNotification',
	list_connected_tools: 'listConnectedTools',
	call_connected_tool: 'callConnectedTool',
});

/** Build the server-owned dispatcher consumed by the local socket. It never
 * receives a raw capability token and has no renderer/window fallback. */
export function createServerControlDispatcher(
	options: ServerControlDispatcherOptions,
): ControlDispatcher {
	const maxParamsBytes = positive(
		options.maxParamsBytes ?? 64 * 1024,
		'maxParamsBytes',
	);
	const scopes = { ...DEFAULT_SCOPES, ...options.operationScopes };
	return async (request, context) => {
		const params = request.params;
		let encodedParams: string;
		try {
			encodedParams = JSON.stringify(params);
		} catch {
			return {
				ok: false,
				error: {
					code: 'bad_request',
					message: 'control parameters are not serializable',
				},
			};
		}
		if (typeof encodedParams !== 'string') {
			return {
				ok: false,
				error: {
					code: 'bad_request',
					message: 'control parameters are not serializable',
				},
			};
		}
		if (
			Buffer.byteLength(encodedParams, 'utf8') >
			(CONTROL_LARGE_FRAME_OPERATIONS.has(request.op)
				? Math.max(maxParamsBytes, CONTROL_MAX_LARGE_FRAME_BYTES)
				: maxParamsBytes)
		) {
			return {
				ok: false,
				error: {
					code: 'limit_exceeded',
					message: 'control parameters exceed the server limit',
				},
			};
		}
		const required = scopes[request.op] ?? 'read';
		if (!hasScope(context.scope ?? 'none', required)) {
			return {
				ok: false,
				error: {
					code: 'forbidden',
					message: 'control capability scope is insufficient',
				},
			};
		}
		// Reach is decided before the policy, so a call the caller's reach
		// cannot make never asks the user (ADR-0072).
		const outOfReach = reachRefusal(request.op, params, context);
		if (outOfReach !== undefined) return outOfReach;
		// A chat has no terminal for a window to open in or a notification to be
		// held for, so those tools are unavailable to it (ADR-0068).
		if (
			context.chat !== undefined &&
			CALLING_TERMINAL_OPERATIONS.has(request.op)
		)
			return {
				ok: false,
				error: {
					code: 'unsupported_op',
					message: `control operation ${request.op} needs a calling terminal`,
				},
			};
		const handler = options.handlers[HANDLER_BY_OPERATION[request.op]];
		if (handler === undefined) {
			return {
				ok: false,
				error: {
					code: 'unsupported_op',
					message: `control operation ${request.op} is unavailable`,
				},
			};
		}
		// Approve exactly what runs: the gate and the handler share one frozen
		// copy of the request, so nothing the caller holds can change it later.
		const retained = deepFreeze(structuredClone(params));
		const group = CONTROL_PERMISSION_GROUPS[request.op];
		if (group !== undefined && options.permissions !== undefined) {
			const refusal = await options.permissions.authorize({
				op: request.op,
				group,
				params: retained,
				context,
			});
			if (refusal !== undefined) return refusal;
			if (context.signal.aborted) return cancelledResult();
		}
		if (
			request.op === 'get_mcp_capabilities' ||
			request.op === 'list_terminals' ||
			request.op === 'list_automations'
		) {
			if (request.op === 'list_automations') {
				const listAutomations = options.handlers.listAutomations;
				if (listAutomations === undefined)
					return {
						ok: false,
						error: {
							code: 'unsupported_op',
							message: 'control operation list_automations is unavailable',
						},
					};
				return listAutomations(retained, context, context.signal);
			}
			if (request.op === 'get_mcp_capabilities') {
				const capabilitiesHandler = options.handlers.getMcpCapabilities;
				if (capabilitiesHandler === undefined)
					return {
						ok: false,
						error: {
							code: 'unsupported_op',
							message: 'control operation get_mcp_capabilities is unavailable',
						},
					};
				// A tool the caller's reach cannot use is unavailable to it.
				const reported = withAvailability(
					await capabilitiesHandler(context, context.signal),
					(tool) =>
						context.reach === 'workspace' ||
						!WORKSPACE_REACH_OPERATIONS.has(tool),
				);
				return context.chat === undefined
					? reported
					: withoutCallingTerminalTools(reported);
			}
			const listHandler = options.handlers.listTerminals;
			if (listHandler === undefined)
				return {
					ok: false,
					error: {
						code: 'unsupported_op',
						message: 'control operation list_terminals is unavailable',
					},
				};
			return listHandler(context, context.signal);
		}
		const operationHandler = handler as (
			params: Record<string, unknown>,
			context: ControlRequestContext,
			signal: AbortSignal,
		) => unknown | Promise<unknown>;
		return operationHandler(retained, context, context.signal);
	};
}

/**
 * Operations only workspace reach may use (ADR-0072), fixed per operation and
 * never inferred from parameters. Project reach may use every other one, and
 * `update_project` for its own project's name, icon and colour only.
 */
export const WORKSPACE_REACH_OPERATIONS: ReadonlySet<ControlOperation> =
	new Set<ControlOperation>([
		'create_project',
		'move_project',
		'close_project',
		'list_workspace_windows',
		'open_workspace_window',
		'rename_workspace_window',
		'close_workspace_window',
		'get_settings',
		'update_settings',
		'save_shell_profile',
		'delete_shell_profile',
		'reorder_shell_profiles',
		'set_default_shell_profile',
		'move_terminal_to_project',
		'focus_home',
	]);

/** Why the caller's reach cannot make this call, or undefined when it can. */
export function reachRefusal(
	op: ControlOperation,
	params: Readonly<Record<string, unknown>>,
	context: Pick<ControlRequestContext, 'reach'>,
): ControlFailure | undefined {
	if (context.reach === 'workspace') return undefined;
	if (WORKSPACE_REACH_OPERATIONS.has(op))
		return {
			ok: false,
			error: {
				code: 'out_of_scope',
				message: `${op} needs workspace reach. An agent in a project terminal acts only on its own project; run it from a terminal under Home or from Pixel.`,
			},
		};
	if (
		op === 'update_project' &&
		Object.keys(params).some(
			(field) => !PROJECT_REACH_UPDATE_PROJECT_FIELDS.has(field),
		)
	)
		return {
			ok: false,
			error: {
				code: 'out_of_scope',
				message:
					"From a project terminal, update_project changes only your own project's name, icon, and colour.",
			},
		};
	return undefined;
}

/** Report each tool unavailable where `available` says so, whatever the host said. */
function withAvailability(
	reported: ControlDispatchResult,
	available: (tool: ControlOperation) => boolean,
): ControlDispatchResult {
	const patch = (value: unknown): unknown => {
		if (typeof value !== 'object' || value === null) return value;
		const tools = (value as { tools?: unknown }).tools;
		if (!Array.isArray(tools)) return value;
		return {
			...value,
			tools: tools.map((entry) => {
				if (typeof entry !== 'object' || entry === null) return entry;
				const tool = (entry as { tool?: unknown }).tool;
				return typeof tool === 'string' &&
					Object.hasOwn(HANDLER_BY_OPERATION, tool) &&
					!available(tool as ControlOperation)
					? { ...entry, available: false }
					: entry;
			}),
		};
	};
	if (
		typeof reported === 'object' &&
		reported !== null &&
		(reported as { ok?: unknown }).ok === true &&
		'result' in reported
	)
		return {
			ok: true,
			result: patch((reported as { result: unknown }).result),
		};
	return patch(reported);
}

/** Operations that act for, or in, the calling terminal itself. Listing and
 * dismissing notifications are addressed by reach, so a chat may use them. */
export const CALLING_TERMINAL_OPERATIONS: ReadonlySet<ControlOperation> =
	new Set<ControlOperation>([
		'show_window',
		'close_window',
		'list_windows',
		'send_notification',
	]);

/** Report the calling-terminal tools unavailable, whatever the host said. */
function withoutCallingTerminalTools(
	reported: ControlDispatchResult,
): ControlDispatchResult {
	const patch = (value: unknown): unknown => {
		if (typeof value !== 'object' || value === null) return value;
		const tools = (value as { tools?: unknown }).tools;
		if (!Array.isArray(tools)) return value;
		return {
			...value,
			tools: tools.map((entry) =>
				typeof entry === 'object' &&
				entry !== null &&
				CALLING_TERMINAL_OPERATIONS.has(
					(entry as { tool?: unknown }).tool as ControlOperation,
				)
					? { ...entry, available: false }
					: entry,
			),
		};
	};
	if (
		typeof reported === 'object' &&
		reported !== null &&
		(reported as { ok?: unknown }).ok === true &&
		'result' in reported
	)
		return {
			ok: true,
			result: patch((reported as { result: unknown }).result),
		};
	return patch(reported);
}

function deepFreeze<T>(value: T): T {
	if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

const DEFAULT_MAX_TEXT_BYTES = 64 * 1024;
const DEFAULT_MAX_WAIT_SECONDS = 15 * 60;
export const DEFAULT_READ_MAX_BYTES = 16 * 1024;
export const MAX_READ_MAX_BYTES = 64 * 1024;
export const DEFAULT_SEARCH_CONTEXT_LINES = 2;
export const MAX_SEARCH_CONTEXT_LINES = 20;
export const DEFAULT_SEARCH_MAX_MATCHES = 20;
export const MAX_SEARCH_MAX_MATCHES = 100;
export const DEFAULT_SEARCH_MAX_BYTES = DEFAULT_READ_MAX_BYTES;
export const MAX_SEARCH_MAX_BYTES = MAX_READ_MAX_BYTES;
export const MAX_SEARCH_QUERY_CHARS = 4 * 1024;
const MAX_PUBLIC_ERROR_BYTES = 4 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SPLIT_DIRECTIONS = new Set<SplitDirection>([
	'right',
	'left',
	'above',
	'below',
]);

/**
 * Adapt a typed operation implementation to the wire dispatcher. Parameter
 * validation happens before the host callback, and callback failures are
 * converted to stable public errors. This makes the adapter safe to use from
 * both a local socket and a future stdio MCP process.
 */
export function createTerminalControlAdapter(
	options: TerminalControlAdapterOptions,
): ControlDispatcher {
	if (options.adapter === undefined || options.adapter === null)
		throw new TypeError('a terminal control adapter is required');
	const maxTextBytes = positive(
		options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES,
		'maxTextBytes',
	);
	const maxWaitSeconds = positive(
		options.maxWaitSeconds ?? DEFAULT_MAX_WAIT_SECONDS,
		'maxWaitSeconds',
	);
	const invoke = <T>(
		signal: AbortSignal,
		work: () => T | Promise<T>,
	): Promise<ControlDispatchResult> => invokeAdapter(signal, work);
	const handlers: ServerControlHandlers = {
		...(options.adapter.getMcpCapabilities === undefined
			? {}
			: {
					getMcpCapabilities: (context, signal) =>
						invoke(signal, async () =>
							withBoundAvailability(
								withViewAvailability(
									await options.adapter.getMcpCapabilities!(context, signal),
									options.workspaceView !== undefined,
								),
								new Set<string>([
									...(options.appControl === undefined ? APP_CONTROL_OPERATIONS : []),
									...(options.settings === undefined
										? SETTINGS_CONTROL_OPERATIONS
										: []),
									...(options.macros === undefined ? MACRO_CONTROL_OPERATIONS : []),
									...(options.adapter.updateTerminal === undefined
										? ['update_terminal']
										: []),
									...(options.adapter.moveTerminalToProject === undefined
										? ['move_terminal_to_project']
										: []),
								]),
							),
						),
				}),
		listTerminals: (context, signal) =>
			invoke(signal, () => options.adapter.listTerminals(context, signal)),
		readTerminal: (params, context, signal) =>
			invoke(signal, () => {
				const parsed = parseTerminalRead(params);
				return isControlFailure(parsed)
					? parsed
					: options.adapter.readTerminal(parsed, context, signal);
			}),
		...(options.adapter.searchTerminal === undefined
			? {}
			: {
					searchTerminal: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseTerminalSearch(params);
							return isControlFailure(parsed)
								? parsed
								: options.adapter.searchTerminal!(parsed, context, signal);
						}),
				}),
		getTerminalStatus: (params, context, signal) =>
			invoke(signal, () => {
				const parsed = parseTerminalOnly(params);
				return isControlFailure(parsed)
					? parsed
					: options.adapter.getTerminalStatus(parsed, context, signal);
			}),
		openTerminal: (params, context, signal) =>
			invoke(signal, async () => {
				const parsed = parseOpenTerminal(params);
				if (isControlFailure(parsed)) return parsed;
				const { split, beside, focus, ...open } = parsed;
				const view = options.workspaceView;
				const placing = split !== undefined;
				if (!placing && focus !== true)
					return options.adapter.openTerminal(open, context, signal);
				// Where it goes decides where it opens: beside a tab, the new
				// terminal opens in that tab's project.
				let anchor: { readonly beside?: string; readonly project?: string } =
					{};
				if (view !== undefined)
					try {
						anchor = await view.anchorFor(
							{
								...(beside === undefined ? {} : { beside }),
								...(open.project === undefined ? {} : { project: open.project }),
								placing,
							},
							context,
							signal,
						);
					} catch (error) {
						// Only an unknown tab is the caller's mistake; anything else
						// leaves the terminal to open unplaced.
						if (beside !== undefined) throw error;
					}
				const opened = await options.adapter.openTerminal(
					{
						...open,
						...(anchor.project === undefined ? {} : { project: anchor.project }),
					},
					context,
					signal,
				);
				const terminal = openedTerminal(opened);
				if (terminal === undefined) return opened;
				if (view === undefined)
					return { ...(opened as object), ...UNPLACED };
				if (placing && anchor.beside === undefined)
					return {
						...(opened as object),
						placed: false,
						reason: 'There is no tab to open it beside.',
					};
				return {
					...(opened as object),
					...(await view.placeTerminal(
						{
							terminal,
							...(placing && anchor.beside !== undefined
								? { beside: anchor.beside, position: split }
								: {}),
							focus: focus === true,
						},
						context,
						signal,
					)),
				};
			}),
		writeTerminal: (params, context, signal) =>
			invoke(signal, () => {
				const parsed = parseWriteTerminal(params, maxTextBytes);
				return isControlFailure(parsed)
					? parsed
					: options.adapter.writeTerminal(parsed, context, signal);
			}),
		runCommand: (params, context, signal) =>
			invoke(signal, () => {
				const parsed = parseRunCommand(params, maxTextBytes);
				return isControlFailure(parsed)
					? parsed
					: options.adapter.runCommand(parsed, context, signal);
			}),
		closeTerminal: (params, context, signal) =>
			invoke(signal, () => {
				const parsed = parseTerminalOnly(params);
				return isControlFailure(parsed)
					? parsed
					: options.adapter.closeTerminal(parsed, context, signal);
			}),
		focusTerminal: (params, context, signal) =>
			invoke(signal, async () => {
				const parsed = parseTerminalOnly(params);
				if (isControlFailure(parsed)) return parsed;
				// The host resolves the terminal within scope; the agent's client
				// shows it.
				const resolved = await options.adapter.focusTerminal(
					parsed,
					context,
					signal,
				);
				const terminal = openedTerminal(resolved);
				if (terminal === undefined) return resolved;
				const view = options.workspaceView;
				if (view === undefined) return noView();
				const focused = (await view.focusTab(
					{ tab: terminal },
					context,
					signal,
				)) as Record<string, unknown>;
				return { terminal, focused: true, layout: focused.layout };
			}),
		renameTerminal: (params, context, signal) =>
			invoke(signal, () => {
				const parsed = parseRenameTerminal(params);
				return isControlFailure(parsed)
					? parsed
					: options.adapter.renameTerminal(parsed, context, signal);
			}),
		splitTerminal: (params, context, signal) =>
			invoke(signal, async () => {
				const parsed = parseSplitTerminal(params);
				if (isControlFailure(parsed)) return parsed;
				// The host opens exactly one terminal in the target's project and
				// folder; the agent's client puts it beside the target.
				const opened = await options.adapter.splitTerminal(
					parsed,
					context,
					signal,
				);
				const terminal = openedTerminal(opened);
				if (terminal === undefined) return opened;
				const view = options.workspaceView;
				const placement =
					view === undefined
						? UNPLACED
						: await view.placeTerminal(
								{
									terminal,
									beside: parsed.terminal,
									position: parsed.direction,
									focus: parsed.focus === true,
								},
								context,
								signal,
							);
				return {
					...(opened as object),
					terminal,
					beside: parsed.terminal,
					opened: 1,
					...placement,
				};
			}),
		waitForIdle: (params, context, signal) =>
			invoke(signal, () => {
				const parsed = parseWaitForIdle(params, maxWaitSeconds);
				return isControlFailure(parsed)
					? parsed
					: options.adapter.waitForIdle(parsed, context, signal);
			}),
		waitForCommand: (params, context, signal) =>
			invoke(signal, () => {
				const parsed = parseWait(params, maxWaitSeconds);
				return isControlFailure(parsed)
					? parsed
					: options.adapter.waitForCommand(parsed, context, signal);
			}),
		waitForAttention: (params, context, signal) =>
			invoke(signal, () => {
				const parsed = parseWait(params, maxWaitSeconds);
				return isControlFailure(parsed)
					? parsed
					: options.adapter.waitForAttention(parsed, context, signal);
			}),
		...(options.adapter.updateTerminal === undefined
			? {}
			: {
					updateTerminal: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseUpdateTerminal(params);
							return isControlFailure(parsed)
								? parsed
								: options.adapter.updateTerminal!(parsed, context, signal);
						}),
				}),
		...(options.adapter.moveTerminalToProject === undefined
			? {}
			: {
					moveTerminalToProject: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseMoveTerminalToProject(params);
							return isControlFailure(parsed)
								? parsed
								: options.adapter.moveTerminalToProject!(
										parsed,
										context,
										signal,
									);
						}),
				}),
	};
	const automations = options.automations;
	const automationHandlers: Partial<ServerControlHandlers> =
		automations === undefined
			? {}
			: {
					listAutomations: (_params, context, signal) =>
						invoke(signal, () => automations.listAutomations(context, signal)),
					getAutomation: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseAutomationId(params);
							return isAutomationParamFailure(parsed)
								? parsed
								: automations.getAutomation(parsed, context, signal);
						}),
					listAutomationRuns: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseListAutomationRuns(params);
							return isAutomationParamFailure(parsed)
								? parsed
								: automations.listAutomationRuns(parsed, context, signal);
						}),
					createAutomation: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseCreateAutomation(params);
							return isAutomationParamFailure(parsed)
								? parsed
								: automations.createAutomation(parsed, context, signal);
						}),
					updateAutomation: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseUpdateAutomation(params);
							return isAutomationParamFailure(parsed)
								? parsed
								: automations.updateAutomation(parsed, context, signal);
						}),
					deleteAutomation: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseDeleteAutomation(params);
							return isAutomationParamFailure(parsed)
								? parsed
								: automations.deleteAutomation(parsed, context, signal);
						}),
					setAutomationEnabled: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseSetAutomationEnabled(params);
							return isAutomationParamFailure(parsed)
								? parsed
								: automations.setAutomationEnabled(parsed, context, signal);
						}),
					runAutomation: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseRunAutomation(params);
							return isAutomationParamFailure(parsed)
								? parsed
								: automations.runAutomation(parsed, context, signal);
						}),
					stopAutomationRun: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseStopAutomationRun(params);
							return isAutomationParamFailure(parsed)
								? parsed
								: automations.stopAutomationRun(parsed, context, signal);
						}),
					removeAutomationRun: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseRemoveAutomationRun(params);
							return isAutomationParamFailure(parsed)
								? parsed
								: automations.removeAutomationRun(parsed, context, signal);
						}),
					pruneAutomationRuns: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parsePruneAutomationRuns(params);
							return isAutomationParamFailure(parsed)
								? parsed
								: automations.pruneAutomationRuns(parsed, context, signal);
						}),
					dismissMissedRuns: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseDismissMissedRuns(params);
							return isAutomationParamFailure(parsed)
								? parsed
								: automations.dismissMissedRuns(parsed, context, signal);
						}),
				};
	const appWindows = options.appWindows;
	const permissions = options.permissions;
	const appWindowHandlers: Partial<ServerControlHandlers> =
		appWindows === undefined
			? {}
			: {
					showWindow: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseShowWindow(params);
							return isAppWindowParamFailure(parsed)
								? parsed
								: appWindows.showWindow(parsed, context, signal);
						}),
					closeWindow: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseCloseWindow(params);
							return isAppWindowParamFailure(parsed)
								? parsed
								: appWindows.closeWindow(parsed, context, signal);
						}),
					listWindows: (_params, context, signal) =>
						invoke(signal, () => appWindows.listWindows(context, signal)),
					listConnectedTools: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseListConnectedTools(params);
							return isAppWindowParamFailure(parsed)
								? parsed
								: appWindows.listConnectedTools(context, signal, parsed.after);
						}),
					callConnectedTool: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseCallConnectedTool(params);
							if (isAppWindowParamFailure(parsed)) return parsed;
							// The tool has passed Connected Server Tools. Showing its view
							// is a second question, asked of App Windows; a refusal there
							// leaves the tool to run without one.
							const mayShowWindow = async (): Promise<boolean> =>
								permissions === undefined ||
								(await permissions.authorize({
									op: 'call_connected_tool',
									group: 'appWindows',
									params,
									context,
								})) === undefined;
							return appWindows.callConnectedTool(
								parsed,
								context,
								signal,
								mayShowWindow,
							);
						}),
				};
	const workspaceView = options.workspaceView;
	const viewHandler =
		<P>(
			parse: (params: Record<string, unknown>) => P | ControlFailure,
			run: (
				view: WorkspaceViewControlAdapter,
				parsed: P,
				context: ControlRequestContext,
				signal: AbortSignal,
			) => unknown,
		) =>
		(
			params: Record<string, unknown>,
			context: ControlRequestContext,
			signal: AbortSignal,
		) =>
			invoke(signal, () => {
				const parsed = parse(params);
				if (isWorkspaceViewParamFailure(parsed)) return parsed;
				return workspaceView === undefined
					? noView()
					: run(workspaceView, parsed as P, context, signal);
			});
	const workspaceViewHandlers: Partial<ServerControlHandlers> = {
		getLayout: viewHandler(parseGetLayout, (view, p, c, s) => view.getLayout(p, c, s)),
		focusTab: viewHandler(parseFocusTab, (view, p, c, s) => view.focusTab(p, c, s)),
		moveTab: viewHandler(parseMoveTab, (view, p, c, s) => view.moveTab(p, c, s)),
		resizePane: viewHandler(parseResizePane, (view, p, c, s) => view.resizePane(p, c, s)),
		arrangeTabs: viewHandler(parseArrangeTabs, (view, p, c, s) => view.arrangeTabs(p, c, s)),
		focusProject: viewHandler(parseFocusProject, (view, p, c, s) => view.focusProject(p, c, s)),
		selectFolder: viewHandler(parseSelectFolder, (view, p, c, s) => view.selectFolder(p, c, s)),
		createFolder: viewHandler(parseCreateFolder, (view, p, c, s) => view.createFolder(p, c, s)),
		renameFolder: viewHandler(parseRenameFolder, (view, p, c, s) => view.renameFolder(p, c, s)),
		deleteFolder: viewHandler(parseDeleteFolder, (view, p, c, s) => view.deleteFolder(p, c, s)),
		reorderFolders: viewHandler(parseReorderFolders, (view, p, c, s) => view.reorderFolders(p, c, s)),
		focusHome: viewHandler(parseFocusHome, (view, p, c, s) => view.focusHome(p, c, s)),
		moveTabToFolder: viewHandler(parseMoveTabToFolder, (view, p, c, s) => view.moveTabToFolder(p, c, s)),
		openFile: viewHandler(parseOpenFile, (view, p, c, s) => view.openFile(p, c, s)),
		closeTab: viewHandler(parseCloseTab, (view, p, c, s) => view.closeTab(p, c, s)),
	};
	const notifications = options.notifications;
	const notificationHandlers: Partial<ServerControlHandlers> =
		notifications === undefined
			? {}
			: {
					sendNotification: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseSendNotification(params);
							return isNotificationParamFailure(parsed)
								? parsed
								: notifications.sendNotification(parsed, context, signal);
						}),
					dismissNotification: (params, context, signal) =>
						invoke(signal, () => {
							const parsed = parseDismissNotification(params);
							return isNotificationParamFailure(parsed)
								? parsed
								: notifications.dismissNotification(parsed, context, signal);
						}),
					listNotifications: (_params, context, signal) =>
						invoke(signal, () =>
							notifications.listNotifications(
								parseListNotifications() as Record<string, never>,
								context,
								signal,
							),
						),
				};
	const appControl = options.appControl;
	const appControlHandler =
		<P>(
			parse: (params: Record<string, unknown>) => P | ControlFailure,
			run: (
				adapter: AppControlAdapter,
				parsed: P,
				context: ControlRequestContext,
				signal: AbortSignal,
			) => unknown,
		) =>
		(
			params: Record<string, unknown>,
			context: ControlRequestContext,
			signal: AbortSignal,
		) =>
			invoke(signal, () => {
				const parsed = parse(params);
				if (isAppControlParamFailure(parsed)) return parsed;
				return run(appControl!, parsed as P, context, signal);
			});
	const appControlHandlers: Partial<ServerControlHandlers> =
		appControl === undefined
			? {}
			: {
					listProjects: appControlHandler(parseListProjects, (a, p, c, s) => a.listProjects(p, c, s)),
					createProject: appControlHandler(parseCreateProject, (a, p, c, s) => a.createProject(p, c, s)),
					updateProject: appControlHandler(parseUpdateProject, (a, p, c, s) => a.updateProject(p, c, s)),
					moveProject: appControlHandler(parseMoveProject, (a, p, c, s) => a.moveProject(p, c, s)),
					closeProject: appControlHandler(parseCloseProject, (a, p, c, s) => a.closeProject(p, c, s)),
					listWorkspaceWindows: appControlHandler(parseListWorkspaceWindows, (a, p, c, s) => a.listWorkspaceWindows(p, c, s)),
					openWorkspaceWindow: appControlHandler(parseOpenWorkspaceWindow, (a, p, c, s) => a.openWorkspaceWindow(p, c, s)),
					renameWorkspaceWindow: appControlHandler(parseRenameWorkspaceWindow, (a, p, c, s) => a.renameWorkspaceWindow(p, c, s)),
					closeWorkspaceWindow: appControlHandler(parseCloseWorkspaceWindow, (a, p, c, s) => a.closeWorkspaceWindow(p, c, s)),
				};
	const settings = options.settings;
	const settingsHandler =
		<P>(
			parse: (params: Record<string, unknown>) => P | ControlFailure,
			run: (
				adapter: SettingsControlAdapter,
				parsed: P,
				context: ControlRequestContext,
				signal: AbortSignal,
			) => unknown,
		) =>
		(
			params: Record<string, unknown>,
			context: ControlRequestContext,
			signal: AbortSignal,
		) =>
			invoke(signal, () => {
				const parsed = parse(params);
				if (isSettingsParamFailure(parsed)) return parsed;
				return run(settings!, parsed as P, context, signal);
			});
	const settingsHandlers: Partial<ServerControlHandlers> =
		settings === undefined
			? {}
			: {
					getSettings: settingsHandler(parseGetSettings, (a, p, c, s) => a.getSettings(p, c, s)),
					updateSettings: settingsHandler(parseUpdateSettings, (a, p, c, s) => a.updateSettings(p, c, s)),
					listShellProfiles: settingsHandler(parseListShellProfiles, (a, p, c, s) => a.listShellProfiles(p, c, s)),
					saveShellProfile: settingsHandler(parseSaveShellProfile, (a, p, c, s) => a.saveShellProfile(p, c, s)),
					deleteShellProfile: settingsHandler(parseShellProfileId, (a, p, c, s) => a.deleteShellProfile(p, c, s)),
					reorderShellProfiles: settingsHandler(parseReorderShellProfiles, (a, p, c, s) => a.reorderShellProfiles(p, c, s)),
					setDefaultShellProfile: settingsHandler(parseShellProfileId, (a, p, c, s) => a.setDefaultShellProfile(p, c, s)),
				};
	const macros = options.macros;
	const macroHandler =
		<P>(
			parse: (params: Record<string, unknown>) => P | ControlFailure,
			run: (
				adapter: MacroControlAdapter,
				parsed: P,
				context: ControlRequestContext,
				signal: AbortSignal,
			) => unknown,
		) =>
		(
			params: Record<string, unknown>,
			context: ControlRequestContext,
			signal: AbortSignal,
		) =>
			invoke(signal, () => {
				const parsed = parse(params);
				if (isMacroParamFailure(parsed)) return parsed;
				return run(macros!, parsed as P, context, signal);
			});
	const macroHandlers: Partial<ServerControlHandlers> =
		macros === undefined
			? {}
			: {
					listMacros: macroHandler(parseListMacros, (a, p, c, s) => a.listMacros(p, c, s)),
					runMacro: macroHandler(parseRunMacro, (a, p, c, s) => a.runMacro(p, c, s)),
					cancelMacro: macroHandler(parseCancelMacro, (a, p, c, s) => a.cancelMacro(p, c, s)),
				};
	const dispatcherOptions: ServerControlDispatcherOptions = {
		handlers: {
			...handlers,
			...automationHandlers,
			...appWindowHandlers,
			...notificationHandlers,
			...workspaceViewHandlers,
			...appControlHandlers,
			...settingsHandlers,
			...macroHandlers,
		},
		...(options.permissions === undefined
			? {}
			: { permissions: options.permissions }),
		...(options.operationScopes === undefined
			? {}
			: { operationScopes: options.operationScopes }),
		...(options.maxParamsBytes === undefined
			? {}
			: { maxParamsBytes: options.maxParamsBytes }),
	};
	const dispatch = createServerControlDispatcher(dispatcherOptions);
	const takeModelContext = options.takeModelContext;
	if (takeModelContext === undefined) return dispatch;
	// Whatever a view asked the model to know rides on the next successful
	// result from its terminal, once.
	return async (request, context) => {
		const outcome = await dispatch(request, context);
		if (isControlFailure(outcome)) return outcome;
		// Listing the connected tools is the adapter's own housekeeping: its
		// answer never reaches the model, so context taken here would be lost.
		if (request.op === 'list_connected_tools') return outcome;
		// The adapter accepts a bounded amount, so only as many whole notes are
		// taken as fit. The rest stay with their windows for the next result.
		const notes = takeModelContext(context, MAX_MODEL_CONTEXT_BYTES - 1024);
		if (notes.length === 0) return outcome;
		const result =
			isRecord(outcome) && outcome.ok === true && 'result' in outcome
				? outcome.result
				: outcome;
		return {
			ok: true,
			result,
			modelContext: notes
				.map(
					(note) =>
						`Context from the open window "${note.title}":\n${note.text}`,
				)
				.join('\n\n'),
		};
	};
}

/** The tools that need the agent's client (ADR-0070). */
export const WORKSPACE_VIEW_OPERATIONS: ReadonlySet<ControlOperation> =
	new Set<ControlOperation>([
		'focus_terminal',
		'get_layout',
		'focus_tab',
		'move_tab',
		'resize_pane',
		'arrange_tabs',
		'focus_project',
		'focus_home',
		'select_folder',
		'create_folder',
		'rename_folder',
		'delete_folder',
		'reorder_folders',
		'move_tab_to_folder',
		'open_file',
		'close_tab',
	]);

/** Report the view tools available exactly when a view adapter is bound. */
function withViewAvailability(reported: unknown, available: boolean): unknown {
	if (!isRecord(reported) || !Array.isArray(reported.tools)) return reported;
	return {
		...reported,
		tools: reported.tools.map((entry) =>
			isRecord(entry) &&
			WORKSPACE_VIEW_OPERATIONS.has(entry.tool as ControlOperation)
				? { ...entry, available }
				: entry,
		),
	};
}

/** Report unavailable every tool whose host binding is absent. */
function withBoundAvailability(
	reported: unknown,
	unbound: ReadonlySet<string>,
): unknown {
	if (unbound.size === 0 || !isRecord(reported) || !Array.isArray(reported.tools))
		return reported;
	const tools = unbound;
	return {
		...reported,
		tools: reported.tools.map((entry) =>
			isRecord(entry) && typeof entry.tool === 'string' && tools.has(entry.tool)
				? { ...entry, available: false }
				: entry,
		),
	};
}

/** The terminal handle a host's open or focus result names. */
function openedTerminal(result: unknown): string | undefined {
	if (!isRecord(result) || result.ok === false) return undefined;
	const value =
		result.ok === true && isRecord(result.result) ? result.result : result;
	return typeof value.terminal === 'string' ? value.terminal : undefined;
}

const UNPLACED = Object.freeze({
	placed: false,
	reason: 'This host cannot place terminals in a window.',
});

function noView(): ControlFailure {
	return {
		ok: false,
		error: {
			code: 'unsupported_op',
			message: 'Reading and changing the window layout is unavailable on this host.',
		},
	};
}

async function invokeAdapter<T>(
	signal: AbortSignal,
	work: () => T | Promise<T>,
): Promise<ControlDispatchResult> {
	if (signal.aborted) return cancelledResult();
	try {
		const result = await work();
		return signal.aborted ? cancelledResult() : result;
	} catch (error) {
		return { ok: false, error: publicControlError(error) };
	}
}

function cancelledResult(): ControlDispatchResult {
	return {
		ok: false,
		error: {
			code: 'cancelled',
			message: 'The control operation was cancelled.',
		},
	};
}

type ControlFailure = { readonly ok: false; readonly error: ControlError };

function isControlFailure(value: unknown): value is ControlFailure {
	return isRecord(value) && value.ok === false && isRecord(value.error);
}

function publicControlError(error: unknown): ControlError {
	const endpointError =
		error instanceof ControlEndpointError
			? error
			: error instanceof Error &&
					isControlErrorCode(
						(error as Error & { readonly code?: unknown }).code,
					)
				? {
						code: (error as Error & { readonly code: ControlError['code'] })
							.code,
						message: error.message,
						candidates: (error as Error & { readonly candidates?: unknown })
							.candidates,
					}
				: undefined;
	if (endpointError !== undefined) {
		const candidates = Array.isArray(endpointError.candidates)
			? endpointError.candidates
					.filter(
						(candidate): candidate is string =>
							typeof candidate === 'string' && ID_PATTERN.test(candidate),
					)
					.slice(0, 32)
			: undefined;
		return {
			code: endpointError.code,
			message: endpointError.message.slice(0, MAX_PUBLIC_ERROR_BYTES),
			...(candidates === undefined || candidates.length === 0
				? {}
				: { candidates }),
		};
	}
	const code =
		isRecord(error) && typeof error.code === 'string'
			? error.code
			: error instanceof Error &&
					typeof (error as Error & { readonly code?: unknown }).code ===
						'string'
				? (error as Error & { readonly code: string }).code
				: 'internal';
	const mapped: Record<string, ControlError['code']> = {
		forbidden: 'forbidden',
		session_not_found: 'terminal_not_found',
		session_exited: 'terminal_not_found',
		session_interrupted: 'terminal_not_found',
		input_too_large: 'limit_exceeded',
		output_too_large: 'limit_exceeded',
		replay_gap: 'limit_exceeded',
		subscriber_limit: 'limit_exceeded',
		session_limit: 'limit_exceeded',
		service_shutdown: 'cancelled',
		invalid_identity: 'bad_request',
		invalid_dimensions: 'bad_request',
		invalid_position: 'bad_request',
		invalid_bytes: 'bad_request',
	};
	const publicCode = mapped[code] ?? 'internal';
	const messageByCode: Record<ControlError['code'], string> = {
		invalid_token:
			'The Terminay terminal capability is missing, invalid, stale, or revoked.',
		not_in_terminay:
			'The control operation requires a Terminay terminal capability.',
		terminal_not_found: 'The requested terminal is unavailable.',
		ambiguous_terminal: 'The terminal reference is ambiguous.',
		renderer_unavailable: 'The terminal host is unavailable.',
		cancelled: 'The control operation was cancelled.',
		limit_exceeded: 'The control operation exceeded a configured limit.',
		timeout: 'The control operation exceeded its deadline.',
		unsupported_op: 'The control operation is unavailable.',
		bad_request: 'The control operation parameters are invalid.',
		forbidden: 'The control capability is not permitted for this operation.',
		not_found: 'The requested control resource was not found.',
		conflict: 'The resource changed since it was read.',
		permission_denied: 'This operation is set to Never Allow for Terminay MCP.',
		permission_declined: 'The user declined this request.',
		approval_queue_full:
			'This terminal already has the maximum number of requests waiting for approval.',
		out_of_scope:
			'This operation needs workspace reach; an agent in a project terminal acts only on its own project.',
		busy: 'A terminal is running a program.',
		internal: 'The control operation failed.',
	};
	return { code: publicCode, message: messageByCode[publicCode] };
}

function isControlErrorCode(value: unknown): value is ControlError['code'] {
	return (
		value === 'invalid_token' ||
		value === 'not_in_terminay' ||
		value === 'terminal_not_found' ||
		value === 'ambiguous_terminal' ||
		value === 'renderer_unavailable' ||
		value === 'cancelled' ||
		value === 'limit_exceeded' ||
		value === 'timeout' ||
		value === 'unsupported_op' ||
		value === 'bad_request' ||
		value === 'forbidden' ||
		value === 'not_found' ||
		value === 'conflict' ||
		value === 'permission_denied' ||
		value === 'permission_declined' ||
		value === 'approval_queue_full' ||
		value === 'out_of_scope' ||
		value === 'busy' ||
		value === 'internal'
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

type ParseResult<T> = T | ControlFailure;

function parseTerminalOnly(
	value: Record<string, unknown>,
): ParseResult<TerminalParams> {
	if (!isRecord(value))
		return badRequest('terminal parameters must be an object');
	const terminal = boundedString(value.terminal, 'terminal', 256);
	return typeof terminal === 'string' ? { terminal } : terminal;
}

function parseTerminalRead(
	value: Record<string, unknown>,
): ParseResult<ReadTerminalParams> {
	const terminal = parseTerminalOnly(value);
	if (isControlFailure(terminal)) return terminal;
	const format = parseReadFormat(value.format);
	if (isControlFailure(format)) return format;
	const maxBytes = optionalPositiveSafeInteger(
		value.max_bytes,
		'max_bytes',
		MAX_READ_MAX_BYTES,
	);
	if (isControlFailure(maxBytes)) return maxBytes;
	const lines = optionalPositiveSafeInteger(value.lines, 'lines', 4096);
	if (isControlFailure(lines)) return lines;
	const after = optionalOutputPosition(value.after);
	if (isControlFailure(after)) return after;
	if (format !== 'text' && lines !== undefined)
		return badRequest('lines is available only for text reads');
	if (format !== 'raw' && after !== undefined)
		return badRequest('after is available only for raw reads');
	return {
		...terminal,
		format,
		maxBytes: maxBytes ?? DEFAULT_READ_MAX_BYTES,
		...(lines === undefined ? {} : { lines }),
		...(after === undefined ? {} : { after }),
	};
}

function parseTerminalSearch(
	value: Record<string, unknown>,
): ParseResult<SearchTerminalParams> {
	const terminal = parseTerminalOnly(value);
	if (isControlFailure(terminal)) return terminal;
	const query = boundedString(value.query, 'query', MAX_SEARCH_QUERY_CHARS);
	if (isControlFailure(query)) return query;
	if (Buffer.byteLength(query, 'utf8') > DEFAULT_MAX_TEXT_BYTES)
		return badRequest('query exceeds the configured limit');
	const caseSensitive = optionalBoolean(value.case_sensitive, 'case_sensitive');
	if (isControlFailure(caseSensitive)) return caseSensitive;
	const contextLines = optionalNonNegativeSafeInteger(
		value.context_lines,
		'context_lines',
		MAX_SEARCH_CONTEXT_LINES,
	);
	if (isControlFailure(contextLines)) return contextLines;
	const maxMatches = optionalPositiveSafeInteger(
		value.max_matches,
		'max_matches',
		MAX_SEARCH_MAX_MATCHES,
	);
	if (isControlFailure(maxMatches)) return maxMatches;
	const maxBytes = optionalPositiveSafeInteger(
		value.max_bytes,
		'max_bytes',
		MAX_SEARCH_MAX_BYTES,
	);
	if (isControlFailure(maxBytes)) return maxBytes;
	return {
		...terminal,
		query,
		caseSensitive: caseSensitive ?? true,
		contextLines: contextLines ?? DEFAULT_SEARCH_CONTEXT_LINES,
		maxMatches: maxMatches ?? DEFAULT_SEARCH_MAX_MATCHES,
		maxBytes: maxBytes ?? DEFAULT_SEARCH_MAX_BYTES,
	};
}

function parseReadFormat(value: unknown): TerminalReadFormat | ControlFailure {
	if (value === undefined) return 'text';
	return value === 'text' || value === 'ansi' || value === 'raw'
		? value
		: badRequest('format must be text, ansi, or raw');
}

function optionalOutputPosition(
	value: unknown,
): number | undefined | ControlFailure {
	if (value === undefined) return undefined;
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
		return badRequest(
			'after must be a non-negative safe integer output position',
		);
	return value;
}

function parseOpenTerminal(
	value: Record<string, unknown>,
): ParseResult<OpenTerminalParams> {
	if (!isRecord(value))
		return badRequest('open terminal parameters must be an object');
	const name = optionalString(value.name, 'name', 256);
	if (isControlFailure(name)) return name;
	const cwd = optionalString(value.cwd, 'cwd', 4096);
	if (isControlFailure(cwd)) return cwd;
	const split = value.split;
	if (
		split !== undefined &&
		(typeof split !== 'string' ||
			!SPLIT_DIRECTIONS.has(split as SplitDirection))
	)
		return badRequest('split direction is invalid');
	const project = value.project;
	if (
		project !== undefined &&
		(typeof project !== 'string' || !PROJECT_HANDLE_PATTERN.test(project))
	)
		return badRequest('project handle is invalid');
	const placement = parsePlacementFields(value);
	if (isControlFailure(placement)) return placement;
	if (placement.beside !== undefined && split === undefined)
		return badRequest('beside needs split, the side to open on');
	const shellProfile = value.shell_profile;
	if (
		shellProfile !== undefined &&
		(typeof shellProfile !== 'string' || !ID_PATTERN.test(shellProfile))
	)
		return badRequest(
			'shell_profile must be a shell profile id from list_shell_profiles',
		);
	return {
		...(name === undefined ? {} : { name }),
		...(cwd === undefined ? {} : { cwd }),
		...(shellProfile === undefined
			? {}
			: { shellProfile: shellProfile as string }),
		...(split === undefined ? {} : { split: split as SplitDirection }),
		...(project === undefined ? {} : { project }),
		...placement,
	};
}

/** The longest note a tab holds, as the tab editor allows. */
export const MAX_TERMINAL_NOTE_CHARS = 1200;

function parseUpdateTerminal(
	value: Record<string, unknown>,
): ParseResult<UpdateTerminalParams> {
	const terminal = parseTerminalOnly(value);
	if (isControlFailure(terminal)) return terminal;
	for (const [key, max] of [
		['icon', 64],
		['color', 128],
	] as const) {
		const field = value[key];
		if (
			field !== undefined &&
			(typeof field !== 'string' || field.length > max || field.includes('\0'))
		)
			return badRequest(`${key} must be at most ${max} characters`);
	}
	const note = value.note;
	if (
		note !== undefined &&
		note !== null &&
		(typeof note !== 'string' ||
			note.length > MAX_TERMINAL_NOTE_CHARS ||
			note.includes('\0'))
	)
		return badRequest(
			`note must be at most ${MAX_TERMINAL_NOTE_CHARS} characters, or null to remove it`,
		);
	const tracking = optionalBoolean(value.activity_tracking, 'activity_tracking');
	if (isControlFailure(tracking)) return tracking;
	if (
		value.icon === undefined &&
		value.color === undefined &&
		note === undefined &&
		tracking === undefined
	)
		return badRequest('icon, color, note, or activity_tracking must be given');
	return {
		...terminal,
		...(value.icon === undefined ? {} : { icon: value.icon as string }),
		...(value.color === undefined ? {} : { color: value.color as string }),
		...(note === undefined ? {} : { note: note as string | null }),
		...(tracking === undefined ? {} : { activityTracking: tracking }),
	};
}

function parseMoveTerminalToProject(
	value: Record<string, unknown>,
): ParseResult<MoveTerminalToProjectParams> {
	const terminal = parseTerminalOnly(value);
	if (isControlFailure(terminal)) return terminal;
	if (
		typeof value.project !== 'string' ||
		!PROJECT_HANDLE_PATTERN.test(value.project)
	)
		return badRequest('project must be a project handle from list_projects');
	const position = value.position;
	if (
		position !== undefined &&
		(typeof position !== 'number' ||
			!Number.isSafeInteger(position) ||
			position < 0)
	)
		return badRequest('position must be a non-negative integer');
	return {
		...terminal,
		project: value.project,
		...(position === undefined ? {} : { position: position as number }),
	};
}

function parseWriteTerminal(
	value: Record<string, unknown>,
	maxTextBytes: number,
): ParseResult<WriteTerminalParams> {
	const terminal = parseTerminalOnly(value);
	if (isControlFailure(terminal)) return terminal;
	const text = boundedText(value.text, 'text', maxTextBytes);
	if (isControlFailure(text)) return text;
	if (value.submit !== undefined && typeof value.submit !== 'boolean')
		return badRequest('submit must be a boolean');
	return {
		...terminal,
		text,
		...(value.submit === undefined ? {} : { submit: value.submit }),
	};
}

function parseRunCommand(
	value: Record<string, unknown>,
	maxTextBytes: number,
): ParseResult<RunCommandParams> {
	const terminal = parseTerminalOnly(value);
	if (isControlFailure(terminal)) return terminal;
	const command = boundedText(value.command, 'command', maxTextBytes);
	if (isControlFailure(command)) return command;
	return { ...terminal, command };
}

function parseRenameTerminal(
	value: Record<string, unknown>,
): ParseResult<RenameTerminalParams> {
	const terminal = parseTerminalOnly(value);
	if (isControlFailure(terminal)) return terminal;
	const name = boundedString(value.name, 'name', 256);
	return typeof name === 'string' ? { ...terminal, name } : name;
}

function parseSplitTerminal(
	value: Record<string, unknown>,
): ParseResult<SplitTerminalParams> {
	const terminal = parseTerminalOnly(value);
	if (isControlFailure(terminal)) return terminal;
	const direction = value.direction;
	if (
		typeof direction !== 'string' ||
		!SPLIT_DIRECTIONS.has(direction as SplitDirection)
	)
		return badRequest('split direction is invalid');
	const name = optionalString(value.name, 'name', 256);
	if (isControlFailure(name)) return name;
	if (value.focus !== undefined && typeof value.focus !== 'boolean')
		return badRequest('focus must be a boolean');
	return {
		...terminal,
		direction: direction as SplitDirection,
		...(name === undefined ? {} : { name }),
		...(value.focus === undefined ? {} : { focus: value.focus as boolean }),
	};
}

function parseWaitForIdle(
	value: Record<string, unknown>,
	maxWaitSeconds: number,
): ParseResult<WaitForIdleParams> {
	const terminal = parseTerminalOnly(value);
	if (isControlFailure(terminal)) return terminal;
	// A zero-duration idle wait is meaningful: it asks whether the canonical
	// terminal is idle now, without adding an artificial delay.  The MCP stdio
	// schema advertises zero as valid, so the server dispatcher must accept the
	// same bounded contract rather than rejecting the request after validation.
	const seconds = requiredNonNegative(value.seconds, 'seconds', maxWaitSeconds);
	if (isControlFailure(seconds)) return seconds;
	const timeout = optionalPositive(value.timeout, 'timeout', maxWaitSeconds);
	if (isControlFailure(timeout)) return timeout;
	return {
		...terminal,
		seconds,
		...(timeout === undefined ? {} : { timeout }),
	};
}

function requiredNonNegative(
	value: unknown,
	name: string,
	maximum: number,
): number | ControlFailure {
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > maximum
	) {
		return badRequest(
			`${name} must be a finite number between 0 and ${maximum}`,
		);
	}
	return value;
}
function parseWait(
	value: Record<string, unknown>,
	maxWaitSeconds: number,
): ParseResult<WaitParams> {
	const terminal = parseTerminalOnly(value);
	if (isControlFailure(terminal)) return terminal;
	const timeout = optionalPositive(value.timeout, 'timeout', maxWaitSeconds);
	if (isControlFailure(timeout)) return timeout;
	return timeout === undefined ? terminal : { ...terminal, timeout };
}

function boundedString(
	value: unknown,
	name: string,
	maxChars: number,
): string | ControlFailure {
	if (
		typeof value !== 'string' ||
		value.trim().length === 0 ||
		value.length > maxChars ||
		value.includes('\0')
	)
		return badRequest(`${name} is invalid`);
	return value;
}

function optionalString(
	value: unknown,
	name: string,
	maxChars: number,
): string | undefined | ControlFailure {
	if (value === undefined) return undefined;
	return boundedString(value, name, maxChars);
}

function boundedText(
	value: unknown,
	name: string,
	maxBytes: number,
): string | ControlFailure {
	if (
		typeof value !== 'string' ||
		value.includes('\0') ||
		new TextEncoder().encode(value).byteLength > maxBytes
	)
		return badRequest(`${name} exceeds the configured limit`);
	return value;
}

function requiredPositive(
	value: unknown,
	name: string,
	max: number,
): number | ControlFailure {
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		value <= 0 ||
		value > max
	)
		return badRequest(`${name} is outside the configured wait limit`);
	return value;
}

function optionalPositive(
	value: unknown,
	name: string,
	max: number,
): number | undefined | ControlFailure {
	if (value === undefined) return undefined;
	return requiredPositive(value, name, max);
}

function optionalPositiveSafeInteger(
	value: unknown,
	name: string,
	max: number,
): number | undefined | ControlFailure {
	if (value === undefined) return undefined;
	if (
		typeof value !== 'number' ||
		!Number.isSafeInteger(value) ||
		value <= 0 ||
		value > max
	)
		return badRequest(
			`${name} must be a positive safe integer no greater than ${max}`,
		);
	return value;
}

function optionalNonNegativeSafeInteger(
	value: unknown,
	name: string,
	max: number,
): number | undefined | ControlFailure {
	if (value === undefined) return undefined;
	if (
		typeof value !== 'number' ||
		!Number.isSafeInteger(value) ||
		value < 0 ||
		value > max
	)
		return badRequest(
			`${name} must be a non-negative safe integer no greater than ${max}`,
		);
	return value;
}

function optionalBoolean(
	value: unknown,
	name: string,
): boolean | undefined | ControlFailure {
	if (value === undefined) return undefined;
	return typeof value === 'boolean'
		? value
		: badRequest(`${name} must be a boolean`);
}

function badRequest(message: string): ControlFailure {
	return { ok: false, error: { code: 'bad_request', message } };
}

function hasScope(actual: ControlScope, required: ControlScope): boolean {
	const rank: Record<ControlScope, number> = {
		none: 0,
		read: 1,
		write: 2,
		admin: 3,
	};
	return rank[actual] >= rank[required];
}

function positive(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError(`${name} must be positive`);
	return value;
}
