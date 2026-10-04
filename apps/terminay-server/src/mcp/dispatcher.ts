import type {
	ControlDispatcher,
	ControlDispatchResult,
	ControlError,
	ControlOperation,
	ControlRequestContext,
	ControlScope,
} from './controlEndpoint.js';
import type { McpPermissionGroup } from '@terminay/server-core';
import {
	type AutomationControlAdapter,
	isAutomationParamFailure,
	parseAutomationId,
	parseCreateAutomation,
	parseDeleteAutomation,
	parseListAutomationRuns,
	parseRunAutomation,
	parseSetAutomationEnabled,
	parseStopAutomationRun,
	parseUpdateAutomation,
} from './automationTools.js';
import {
	type AppWindowControlAdapter,
	isAppWindowParamFailure,
	parseCallConnectedTool,
	parseCloseWindow,
	parseListConnectedTools,
	parseShowWindow,
} from './appWindowTools.js';
import {
	CONTROL_LARGE_FRAME_OPERATIONS,
	CONTROL_MAX_LARGE_FRAME_BYTES,
	ControlEndpointError,
	MAX_MODEL_CONTEXT_BYTES,
} from './controlEndpoint.js';

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
	split_terminal: 'terminalsManage',
	list_automations: 'automationsRead',
	get_automation: 'automationsRead',
	list_automation_runs: 'automationsRead',
	create_automation: 'automationsManage',
	update_automation: 'automationsManage',
	delete_automation: 'automationsManage',
	set_automation_enabled: 'automationsManage',
	run_automation: 'automationsManage',
	stop_automation_run: 'automationsManage',
	show_window: 'appWindows',
	close_window: 'appWindows',
	list_windows: 'appWindows',
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
	readonly split?: SplitDirection;
	/** Opaque project handle from a workspace-reach `list_terminals` row. */
	readonly project?: string;
}

/** Shape of an opaque project handle (see `workspaceReach.ts`). */
export const PROJECT_HANDLE_PATTERN = /^prj_[A-Za-z0-9_-]{22}$/;
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
}

export interface TerminalControlAdapterOptions {
	readonly adapter: TerminalControlAdapter;
	/** Host binding for the automation tools; absent hosts report them unsupported. */
	readonly automations?: AutomationControlAdapter;
	/** Host binding for the app-window and connected-server tools. */
	readonly appWindows?: AppWindowControlAdapter;
	/** Model context the calling terminal's views left for the next result. */
	readonly takeModelContext?: (
		context: ControlRequestContext,
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
	split_terminal: 'write',
	list_automations: 'read',
	get_automation: 'read',
	list_automation_runs: 'read',
	create_automation: 'write',
	update_automation: 'write',
	delete_automation: 'write',
	set_automation_enabled: 'write',
	run_automation: 'write',
	stop_automation_run: 'write',
	show_window: 'write',
	close_window: 'write',
	list_windows: 'read',
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
	split_terminal: 'splitTerminal',
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
	show_window: 'showWindow',
	close_window: 'closeWindow',
	list_windows: 'listWindows',
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
				return capabilitiesHandler(context, context.signal);
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
						invoke(signal, () =>
							options.adapter.getMcpCapabilities!(context, signal),
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
			invoke(signal, () => {
				const parsed = parseOpenTerminal(params);
				return isControlFailure(parsed)
					? parsed
					: options.adapter.openTerminal(parsed, context, signal);
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
			invoke(signal, () => {
				const parsed = parseTerminalOnly(params);
				return isControlFailure(parsed)
					? parsed
					: options.adapter.focusTerminal(parsed, context, signal);
			}),
		renameTerminal: (params, context, signal) =>
			invoke(signal, () => {
				const parsed = parseRenameTerminal(params);
				return isControlFailure(parsed)
					? parsed
					: options.adapter.renameTerminal(parsed, context, signal);
			}),
		splitTerminal: (params, context, signal) =>
			invoke(signal, () => {
				const parsed = parseSplitTerminal(params);
				return isControlFailure(parsed)
					? parsed
					: options.adapter.splitTerminal(parsed, context, signal);
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
	const dispatcherOptions: ServerControlDispatcherOptions = {
		handlers: { ...handlers, ...automationHandlers, ...appWindowHandlers },
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
		const notes = takeModelContext(context);
		if (notes.length === 0) return outcome;
		const result =
			isRecord(outcome) && outcome.ok === true && 'result' in outcome
				? outcome.result
				: outcome;
		// The adapter accepts a bounded amount. Whole notes are kept while they
		// fit, so the model never gets half of one.
		let modelContext = '';
		let dropped = 0;
		for (const note of notes) {
			const text = `Context from the open window "${note.title}":\n${note.text}`;
			const next = modelContext === '' ? text : `${modelContext}\n\n${text}`;
			if (Buffer.byteLength(next, 'utf8') > MAX_MODEL_CONTEXT_BYTES - 256) dropped += 1;
			else modelContext = next;
		}
		if (dropped > 0)
			modelContext += `${modelContext === '' ? '' : '\n\n'}(Context from ${dropped} more open window${dropped === 1 ? ' was' : 's were'} too long to include.)`;
		return { ok: true, result, modelContext };
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
	return {
		...(name === undefined ? {} : { name }),
		...(cwd === undefined ? {} : { cwd }),
		...(split === undefined ? {} : { split: split as SplitDirection }),
		...(project === undefined ? {} : { project }),
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
	return { ...terminal, direction: direction as SplitDirection };
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
