import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname, isAbsolute } from 'node:path';
import type {
	AUTOMATION_PROJECT_KIND,
	AUTOMATION_SPACE_PROJECT_ID,
	ServerSettingsRepository,
	ServerSettingsState,
} from '@terminay/server-core';

/**
 * The local control endpoint is deliberately a small server boundary.  It
 * accepts only local stream sockets (Unix domain sockets, or named pipes on
 * Windows), resolves a per-terminal capability on every request, and invokes
 * a server-owned dispatcher.  There is no renderer/PID/process ancestry
 * fallback in this module.
 */

export const CONTROL_PROTOCOL_VERSION = 1 as const;
export const CONTROL_MAX_FRAME_BYTES = 64 * 1024;
export const CONTROL_MAX_RESPONSE_BYTES = 256 * 1024;
/**
 * A few operations carry a document or a connected server's payload. Only they
 * may exceed the ordinary frame and response bounds, up to these ceilings.
 */
/**
 * Enough for the largest document an agent may show however its JSON encoding
 * escapes it: a control character becomes six bytes, so 512 KiB can become
 * 3 MiB, plus the rest of the request.
 */
export const CONTROL_MAX_LARGE_FRAME_BYTES = 3328 * 1024;
export const CONTROL_MAX_LARGE_RESPONSE_BYTES = 1536 * 1024;
export const CONTROL_MAX_IN_FLIGHT_PER_CONNECTION = 8;
export const CONTROL_MAX_IN_FLIGHT_TOTAL = 64;
export const CONTROL_REQUEST_TIMEOUT_MS = 120_000;

export const CONTROL_SOCKET_ENV = 'TERMINAY_CONTROL_SOCKET';
export const CONTROL_TOKEN_ENV = 'TERMINAY_CONTROL_TOKEN';

export const CONTROL_OPERATIONS = [
	'get_mcp_capabilities',
	'list_terminals',
	'read_terminal',
	'search_terminal',
	'get_terminal_status',
	'open_terminal',
	'write_terminal',
	'run_command',
	'close_terminal',
	'focus_terminal',
	'rename_terminal',
	'update_terminal',
	'move_terminal_to_project',
	'split_terminal',
	'wait_for_idle',
	'wait_for_command',
	'wait_for_attention',
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
	'list_automations',
	'get_automation',
	'list_automation_runs',
	'create_automation',
	'update_automation',
	'delete_automation',
	'set_automation_enabled',
	'run_automation',
	'stop_automation_run',
	'remove_automation_run',
	'prune_automation_runs',
	'dismiss_missed_runs',
	'list_projects',
	'create_project',
	'update_project',
	'move_project',
	'close_project',
	'list_workspace_windows',
	'open_workspace_window',
	'rename_workspace_window',
	'close_workspace_window',
	'get_settings',
	'update_settings',
	'list_shell_profiles',
	'save_shell_profile',
	'delete_shell_profile',
	'reorder_shell_profiles',
	'set_default_shell_profile',
	'list_macros',
	'run_macro',
	'cancel_macro',
	'show_window',
	'close_window',
	'list_windows',
	'send_notification',
	'list_notifications',
	'dismiss_notification',
	'list_connected_tools',
	'call_connected_tool',
] as const;

/**
 * Operations the stdio adapter uses to carry connected servers' tools. They
 * are plumbing, not tools: an agent never sees them by these names.
 */
/** The most text a view's model context may add to one tool result. */
export const MAX_MODEL_CONTEXT_BYTES = 64 * 1024;

export const CONTROL_INTERNAL_OPERATIONS: ReadonlySet<string> = new Set([
	'list_connected_tools',
	'call_connected_tool',
]);
/** The operations that are Terminay's own MCP tools, in registration order. */
export const CONTROL_TOOL_OPERATIONS: readonly ControlOperation[] =
	CONTROL_OPERATIONS.filter((op) => !CONTROL_INTERNAL_OPERATIONS.has(op));

/** Operations whose request may be a large frame. */
export const CONTROL_LARGE_FRAME_OPERATIONS: ReadonlySet<string> = new Set([
	'show_window',
	'call_connected_tool',
]);
/** Operations whose response may be large. */
export const CONTROL_LARGE_RESPONSE_OPERATIONS: ReadonlySet<string> = new Set([
	'list_connected_tools',
	'call_connected_tool',
]);

export type ControlOperation = (typeof CONTROL_OPERATIONS)[number];
/** Compatibility spelling used by the pre-server control protocol. */
export type ControlOp = ControlOperation;
export type ControlScope = 'none' | 'read' | 'write' | 'admin';
/**
 * Which terminals a capability may address (ADR-0030), and which app-level
 * tools it may use (ADR-0072). `project` reaches the terminal's own project.
 * `workspace` reaches every project and the automation terminal space on the
 * same server, is held only by terminals in that space and workspace chats,
 * and alone may use the app-level tools. Reach never crosses servers.
 */
export type ControlReach = 'project' | 'workspace';

/**
 * Canonical placement of the terminal a capability is minted for. The minting
 * site reads it from the server's workspace state; it is never taken from a
 * request, title, cwd, environment, or any other caller-controlled value.
 */
export interface ControlPlacement {
	/** The canonical project's reserved kind; absent for ordinary projects. */
	readonly projectKind?: string;
}

// Type-only imports keep the stdio entry, which shares this module, free of
// server-core at runtime; `satisfies` pins the literals to their source.
const AUTOMATION_KIND =
	'automations' as const satisfies typeof AUTOMATION_PROJECT_KIND;
const AUTOMATION_SPACE_ID =
	'system:automations' as const satisfies typeof AUTOMATION_SPACE_PROJECT_ID;

/**
 * Project reach is the default and stays implicit, so every project-scope
 * lease, resolution, and dispatch context is exactly what it was before
 * workspace reach existed.
 */
function reachField(reach: ControlReach): { readonly reach?: 'workspace' } {
	return reach === 'workspace' ? { reach } : {};
}

/** The only derivation of reach: the terminal's canonical project kind. */
export function controlReachForPlacement(
	projectId: string,
	placement: ControlPlacement = {},
): ControlReach {
	if (placement.projectKind === undefined) return 'project';
	if (
		placement.projectKind !== AUTOMATION_KIND ||
		projectId !== AUTOMATION_SPACE_ID
	)
		throw new TypeError('invalid control placement');
	return 'workspace';
}

export interface ControlRequest {
	readonly id: string;
	readonly token: string;
	readonly version: typeof CONTROL_PROTOCOL_VERSION;
	readonly op: ControlOperation;
	readonly params: Record<string, unknown>;
}

/** Internal dispatch view; the raw capability token is intentionally omitted. */
export type ControlDispatchRequest = Omit<ControlRequest, 'token'>;

/**
 * A capability held by an agent chat rather than a terminal (ADR-0068). Its
 * `terminalSessionId` is the reserved key `chat:<chatId>`, which names no
 * terminal, so per-caller state such as approvals and session grants keys on
 * it exactly as it does for a terminal.
 */
export interface ControlChatPrincipal {
	readonly chatId: string;
}

/** What a chat's reach is, as the chat record holds it. */
export type ControlChatReach =
	| { readonly kind: 'workspace' }
	| { readonly kind: 'project'; readonly projectId: string };

const CHAT_CALLER_PREFIX = 'chat:';

/** The reserved caller key for a chat; never a terminal session id. */
export function chatCallerKey(chatId: string): string {
	return `${CHAT_CALLER_PREFIX}${chatId}`;
}

/** Whether a caller key names a chat rather than a terminal. */
export function isChatCallerKey(callerKey: string): boolean {
	return callerKey.startsWith(CHAT_CALLER_PREFIX);
}

export interface ControlCapabilityScope {
	/**
	 * Immutable server-owned caller identity, never supplied by a request: a
	 * terminal session id, or `chat:<chatId>` for a chat.
	 */
	readonly terminalSessionId: string;
	/** Immutable server-owned project identity, never supplied by a request. */
	readonly projectId: string;
	readonly scope?: ControlScope;
	/** Server-derived reach; absent means `project`. */
	readonly reach?: ControlReach;
	/** Present only when the caller is a chat, which has no terminal. */
	readonly chat?: ControlChatPrincipal;
}

export interface ControlCapabilityLease extends ControlCapabilityScope {
	/** The raw token is returned once at mint time and is never stored by the store. */
	readonly token: string;
	readonly issuedAt: number;
}

export interface ControlCapabilityStoreOptions {
	readonly now?: () => number;
	readonly tokenFactory?: () => string;
	readonly enabled?: boolean;
}

/**
 * A capability as it may be written to the server data root so a terminal that
 * outlives the server process keeps the authority it was started with. It holds
 * the token's SHA-256 digest and never the token: nothing here can be presented
 * to the control endpoint.
 */
export interface PersistedControlCapability {
	readonly digest: string;
	readonly terminalSessionId: string;
	readonly projectId: string;
	readonly scope: ControlScope;
	readonly reach: ControlReach;
	readonly issuedAt: number;
}

/** Told the digest of each revoked capability and the terminal it was
 * minted for, so per-capability state (such as MCP approvals) ends with it. */
export type CapabilityRevocationListener = (
	tokenDigest: string,
	terminalSessionId: string,
) => void;

export interface ControlCapabilityResolver {
	resolve(
		token: string,
	): ControlCapabilityScope | null | Promise<ControlCapabilityScope | null>;
	onRevoked?(listener: CapabilityRevocationListener): () => void;
	/** Optional lifecycle hook used to revoke every capability on server stop. */
	revokeAll?(): number;
}

export class ControlEndpointError extends Error {
	readonly code: ControlErrorCode;
	readonly candidates: readonly string[] | undefined;

	constructor(
		code: ControlErrorCode,
		message: string,
		candidates?: readonly string[],
	) {
		super(message);
		this.name = 'ControlEndpointError';
		this.code = code;
		this.candidates = candidates;
	}
}

export type ControlErrorCode =
	| 'invalid_token'
	| 'not_in_terminay'
	| 'terminal_not_found'
	| 'ambiguous_terminal'
	| 'renderer_unavailable'
	| 'cancelled'
	| 'limit_exceeded'
	| 'timeout'
	| 'unsupported_op'
	| 'bad_request'
	| 'forbidden'
	| 'not_found'
	| 'conflict'
	| 'permission_denied'
	| 'permission_declined'
	| 'approval_queue_full'
	| 'out_of_scope'
	| 'busy'
	| 'internal';

export interface ControlError {
	readonly code: ControlErrorCode;
	readonly message: string;
	readonly candidates?: readonly string[];
}

export type ControlResponse =
	| {
			readonly id: string;
			readonly ok: true;
			readonly result: unknown;
			/** Text a view in the calling terminal left for the model. */
			readonly modelContext?: string;
	  }
	| { readonly id: string; readonly ok: false; readonly error: ControlError };

export interface ControlRequestContext extends ControlCapabilityScope {
	readonly connectionId: string;
	readonly requestId: string;
	readonly signal: AbortSignal;
	/**
	 * Suspend the request deadline while the request waits on a user's
	 * approval, whose own lifecycle bounds it. Returns a function that
	 * restarts a full deadline for the work that follows.
	 */
	readonly holdDeadline?: () => () => void;
}

export type ControlDispatchResult =
	| unknown
	| { readonly ok: true; readonly result: unknown }
	| { readonly ok: false; readonly error: ControlError };

export type ControlDispatcher = (
	request: ControlDispatchRequest,
	context: ControlRequestContext,
) => ControlDispatchResult | Promise<ControlDispatchResult>;

/**
 * A server-owned handler for one operation.  The request has already passed
 * the wire-envelope and capability checks performed by the endpoint; the
 * handler still owns operation-specific parameter validation.
 */
export type ControlOperationHandler<
	TOperation extends ControlOperation = ControlOperation,
> = (
	request: ControlDispatchRequest & { readonly op: TOperation },
	context: ControlRequestContext,
) => ControlDispatchResult | Promise<ControlDispatchResult>;

/**
 * Operation dispatch is deliberately a table rather than a renderer or PID
 * callback.  Hosts may stage operations independently, so omitted entries are
 * reported as a stable `unsupported_op` result instead of becoming an
 * accidental success or an unbounded fallback.
 */
export type ControlOperationHandlers = Partial<{
	[TOperation in ControlOperation]: ControlOperationHandler<TOperation>;
}>;

export interface ControlEndpointLimits {
	readonly maxFrameBytes: number;
	readonly maxResponseBytes: number;
	/** Frame bound for the operations in `CONTROL_LARGE_FRAME_OPERATIONS`. */
	readonly maxLargeFrameBytes: number;
	/** Response bound for `CONTROL_LARGE_RESPONSE_OPERATIONS`. */
	readonly maxLargeResponseBytes: number;
	readonly maxInFlightPerConnection: number;
	readonly maxInFlightTotal: number;
	readonly requestTimeoutMs: number;
	/** Maximum queued bytes tolerated for a client which is not reading. */
	readonly maxQueuedResponseBytes: number;
}

/** Schedules and cancels a request's deadline. */
export interface ControlEndpointTimers {
	setTimeout(handler: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

const GLOBAL_CONTROL_TIMERS: ControlEndpointTimers = {
	setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
	clearTimeout: (handle) =>
		globalThis.clearTimeout(
			handle as ReturnType<typeof globalThis.setTimeout> | undefined,
		),
};

export interface ControlEndpointOptions extends Partial<ControlEndpointLimits> {
	/** Absolute Unix socket path, or a Windows named-pipe path. */
	readonly socketPath: string;
	/**
	 * Whether the socket's directory is closed to other users before listening.
	 * On by default, for a socket inside a data directory. Off for a runtime
	 * directory (ADR-0054), which was already required to be closed and is
	 * refused, never repaired, when it is not.
	 */
	readonly tightenParentDirectory?: boolean;
	readonly capabilities?: ControlCapabilityResolver;
	readonly resolveCapability?: ControlCapabilityResolver['resolve'];
	readonly dispatch: ControlDispatcher;
	/** Override the default authorization floor for an operation. */
	readonly operationScopes?: Partial<Record<ControlOperation, ControlScope>>;
	readonly onError?: (error: unknown) => void;
	/** What schedules request deadlines. Defaults to the global timers. */
	readonly timers?: ControlEndpointTimers;
}

export interface LocalControlEndpoint {
	readonly socketPath: string;
	readonly listening: boolean;
	start(): Promise<void>;
	stop(): Promise<void>;
}

export type ControlEndpoint = LocalControlEndpoint;

const INVALID_CAPABILITY_ERROR: ControlError = Object.freeze({
	code: 'invalid_token',
	message:
		'The Terminay terminal capability is missing, invalid, stale, or revoked.',
});

const DEFAULT_OPERATION_SCOPES: Readonly<
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
});

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const scopeRank: Record<ControlScope, number> = {
	none: 0,
	read: 1,
	write: 2,
	admin: 3,
};
const controlOperations = new Set<string>(CONTROL_OPERATIONS);
const controlErrorCodes = new Set<ControlErrorCode>([
	'invalid_token',
	'not_in_terminay',
	'terminal_not_found',
	'ambiguous_terminal',
	'renderer_unavailable',
	'cancelled',
	'limit_exceeded',
	'timeout',
	'unsupported_op',
	'bad_request',
	'forbidden',
	'not_found',
	'conflict',
	'permission_denied',
	'permission_declined',
	'approval_queue_full',
	'out_of_scope',
	'busy',
	'internal',
]);
const CONTROL_ERROR_MESSAGE_BYTES = 4 * 1024;
const CONTROL_ERROR_CANDIDATES = 32;
const textDecoder = new TextDecoder('utf-8', { fatal: true });

function assertScopeId(value: string, name: string): void {
	if (!idPattern.test(value)) throw new TypeError(`invalid ${name}`);
}

function isValidToken(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 512)
		return false;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === 0 || code === 10 || code === 13) return false;
	}
	return true;
}

function assertPositiveLimit(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError(`${name} must be a positive integer`);
}

function hashToken(token: string): Buffer {
	return createHash('sha256').update(token, 'utf8').digest();
}

const PRUNE_GRACE_MS = 60_000;

function defaultTokenFactory(): string {
	return `tc_${randomBytes(32).toString('base64url')}`;
}

interface StoredCapability {
	readonly digest: Buffer;
	readonly terminalSessionId: string;
	readonly projectId: string;
	readonly scope: ControlScope;
	readonly reach: ControlReach;
	readonly issuedAt: number;
	readonly chat?: ControlChatPrincipal;
}

/**
 * Server-owned capability storage. Only a SHA-256 digest is retained in
 * memory; the raw token is returned by mint/rotate and is not part of
 * metadata, diagnostics, or persistence APIs.
 *
 * A capability has no time limit. Its token reaches the terminal only through
 * the launch environment, which cannot be updated, so it lives exactly as long
 * as the terminal: revoked on exit, move, shutdown, or MCP disablement, and
 * pruned when its terminal is found no longer running.
 */
export class ControlCapabilityStore implements ControlCapabilityResolver {
	private readonly capabilities = new Map<string, StoredCapability>();
	private readonly now: () => number;
	private readonly tokenFactory: () => string;
	private enabled: boolean;
	private readonly revocationListeners =
		new Set<CapabilityRevocationListener>();
	private readonly changeListeners = new Set<() => void>();

	constructor(options: ControlCapabilityStoreOptions = {}) {
		this.now = options.now ?? Date.now;
		this.tokenFactory = options.tokenFactory ?? defaultTokenFactory;
		this.enabled = options.enabled ?? true;
	}

	/**
	 * Mint the terminal's single capability, replacing any it held. Reach is
	 * derived here from canonical placement alone (ADR-0030).
	 */
	mint(
		terminalSessionId: string,
		projectId: string,
		scope: ControlScope = 'write',
		placement: ControlPlacement = {},
	): ControlCapabilityLease {
		if (!this.enabled)
			throw new ControlEndpointError(
				'forbidden',
				'The local control endpoint is disabled.',
			);
		assertScopeId(terminalSessionId, 'terminal session id');
		// The chat key space is reserved, so no terminal can hold a chat's key.
		if (isChatCallerKey(terminalSessionId))
			throw new TypeError('invalid terminal session id');
		assertScopeId(projectId, 'project id');
		this.assertScope(scope);
		const reach = controlReachForPlacement(projectId, placement);
		this.revokeSession(terminalSessionId);
		let token = this.tokenFactory();
		if (!isValidToken(token))
			throw new TypeError('tokenFactory returned an invalid token');
		let digest = hashToken(token);
		let attempts = 0;
		while (this.hasDigest(digest)) {
			attempts += 1;
			if (attempts >= 32)
				throw new Error('tokenFactory did not produce a unique capability');
			token = this.tokenFactory();
			if (!isValidToken(token))
				throw new TypeError('tokenFactory returned an invalid token');
			digest = hashToken(token);
		}
		const issuedAt = this.now();
		this.capabilities.set(digest.toString('hex'), {
			digest,
			terminalSessionId,
			projectId,
			scope,
			reach,
			issuedAt,
		});
		this.changed();
		return Object.freeze({
			token,
			terminalSessionId,
			projectId,
			scope,
			...reachField(reach),
			issuedAt,
		});
	}

	/**
	 * Mint the single capability of one chat provider session, replacing any
	 * the chat held. Reach comes from the server's chat record: a project, or
	 * the workspace, which resolves exactly as an automation-space terminal's
	 * does. Only the agent chat service is handed this (ADR-0068).
	 */
	mintChat(chatId: string, reach: ControlChatReach): ControlCapabilityLease {
		if (!this.enabled)
			throw new ControlEndpointError(
				'forbidden',
				'The local control endpoint is disabled.',
			);
		const callerKey = chatCallerKey(chatId);
		assertScopeId(callerKey, 'chat id');
		const projectId =
			reach.kind === 'workspace' ? AUTOMATION_SPACE_ID : reach.projectId;
		assertScopeId(projectId, 'project id');
		if (reach.kind === 'project' && projectId === AUTOMATION_SPACE_ID)
			throw new TypeError('invalid chat reach');
		this.revokeSession(callerKey);
		const token = this.uniqueToken();
		const digest = hashToken(token);
		const issuedAt = this.now();
		const chat = Object.freeze({ chatId });
		const controlReach: ControlReach =
			reach.kind === 'workspace' ? 'workspace' : 'project';
		this.capabilities.set(digest.toString('hex'), {
			digest,
			terminalSessionId: callerKey,
			projectId,
			scope: 'write',
			reach: controlReach,
			issuedAt,
			chat,
		});
		this.changed();
		return Object.freeze({
			token,
			terminalSessionId: callerKey,
			projectId,
			scope: 'write' as const,
			...reachField(controlReach),
			issuedAt,
			chat,
		});
	}

	/** End a chat's capability: its session ended, or it was cleared or closed. */
	revokeChat(chatId: string): number {
		return this.revokeSession(chatCallerKey(chatId));
	}

	private uniqueToken(): string {
		let token = this.tokenFactory();
		let attempts = 0;
		for (;;) {
			if (!isValidToken(token))
				throw new TypeError('tokenFactory returned an invalid token');
			if (!this.hasDigest(hashToken(token))) return token;
			attempts += 1;
			if (attempts >= 32)
				throw new Error('tokenFactory did not produce a unique capability');
			token = this.tokenFactory();
		}
	}

	rotate(
		terminalSessionId: string,
		projectId: string,
		scope: ControlScope = 'write',
		placement: ControlPlacement = {},
	): ControlCapabilityLease {
		return this.mint(terminalSessionId, projectId, scope, placement);
	}

	revoke(token: string): boolean {
		if (!isValidToken(token)) return false;
		const digest = hashToken(token);
		return this.revokeDigest(digest);
	}

	revokeSession(terminalSessionId: string): number {
		let count = 0;
		for (const capability of this.capabilities.values()) {
			if (
				capability.terminalSessionId === terminalSessionId &&
				this.revokeDigest(capability.digest)
			)
				count += 1;
		}
		return count;
	}

	onTerminalExit(terminalSessionId: string): number {
		return this.revokeSession(terminalSessionId);
	}

	/**
	 * Revoke every capability whose terminal is not in `runningSessions`, so a
	 * terminal that ended without its exit being seen leaves nothing behind.
	 * A capability is minted before its terminal is listed as running, so one
	 * issued within the last minute is left alone.
	 */
	prune(runningSessions: ReadonlySet<string>): number {
		const issuedBefore = this.now() - PRUNE_GRACE_MS;
		let count = 0;
		for (const capability of [...this.capabilities.values()])
			if (
				capability.chat === undefined &&
				capability.issuedAt <= issuedBefore &&
				!runningSessions.has(capability.terminalSessionId) &&
				this.revokeDigest(capability.digest)
			)
				count += 1;
		return count;
	}

	revokeAll(): number {
		let count = 0;
		for (const capability of [...this.capabilities.values()])
			if (this.revokeDigest(capability.digest)) count += 1;
		return count;
	}

	/**
	 * Atomically removes a terminal's old capability and mints one for its new
	 * canonical placement, so entering or leaving the automation space swaps
	 * workspace and project reach with no window in which both are valid.
	 */
	moveTerminal(
		terminalSessionId: string,
		projectId: string,
		scope: ControlScope = 'write',
		placement: ControlPlacement = {},
	): ControlCapabilityLease {
		return this.mint(terminalSessionId, projectId, scope, placement);
	}

	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) return;
		this.enabled = enabled;
		if (!enabled) {
			this.revokeAll();
		}
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	resolve(token: string): ControlCapabilityScope | null {
		if (!this.enabled || !isValidToken(token)) return null;
		const digest = hashToken(token);
		const capability = this.findByDigest(digest);
		if (capability === undefined) return null;
		return {
			terminalSessionId: capability.terminalSessionId,
			projectId: capability.projectId,
			scope: capability.scope,
			...reachField(capability.reach),
			...(capability.chat === undefined ? {} : { chat: capability.chat }),
		};
	}

	authorize(
		token: string,
		requiredScope: ControlScope = 'read',
	): ControlCapabilityScope {
		const scope = this.resolve(token);
		if (scope === null)
			throw new ControlEndpointError(
				'invalid_token',
				INVALID_CAPABILITY_ERROR.message,
			);
		if (scopeRank[scope.scope ?? 'write'] < scopeRank[requiredScope])
			throw new ControlEndpointError(
				'forbidden',
				'The control capability is not permitted for this operation.',
			);
		return scope;
	}

	/** Metadata intentionally excludes raw tokens and token digests. */
	metadata(): readonly Omit<ControlCapabilityLease, 'token'>[] {
		const result: Omit<ControlCapabilityLease, 'token'>[] = [];
		for (const capability of this.capabilities.values()) {
			result.push({
				terminalSessionId: capability.terminalSessionId,
				projectId: capability.projectId,
				scope: capability.scope,
				...reachField(capability.reach),
				issuedAt: capability.issuedAt,
			});
		}
		return result;
	}

	/** Every capability, by digest. Raw tokens are never retained. */
	snapshot(): readonly PersistedControlCapability[] {
		const result: PersistedControlCapability[] = [];
		for (const [digest, capability] of this.capabilities) {
			// A chat lives only in server memory, so its capability is never saved.
			if (capability.chat !== undefined) continue;
			result.push({
				digest,
				terminalSessionId: capability.terminalSessionId,
				projectId: capability.projectId,
				scope: capability.scope,
				reach: capability.reach,
				issuedAt: capability.issuedAt,
			});
		}
		return result;
	}

	/**
	 * Reinstate capabilities saved by an earlier server process, for terminals
	 * that are still running. An entry is ignored unless it is well formed,
	 * names a session in `runningSessions`, and that session holds no
	 * capability already. Returns how many were reinstated.
	 */
	restore(
		entries: readonly unknown[],
		runningSessions: ReadonlySet<string>,
	): number {
		if (!this.enabled) return 0;
		let restored = 0;
		for (const entry of entries) {
			const capability = parsePersistedCapability(entry);
			if (capability === undefined) continue;
			if (!runningSessions.has(capability.terminalSessionId)) continue;
			if (this.capabilities.has(capability.digest)) continue;
			let held = false;
			for (const existing of this.capabilities.values())
				if (existing.terminalSessionId === capability.terminalSessionId)
					held = true;
			if (held) continue;
			this.capabilities.set(capability.digest, {
				digest: Buffer.from(capability.digest, 'hex'),
				terminalSessionId: capability.terminalSessionId,
				projectId: capability.projectId,
				scope: capability.scope,
				reach: capability.reach,
				issuedAt: capability.issuedAt,
			});
			restored += 1;
		}
		if (restored > 0) this.changed();
		return restored;
	}

	/** Called after the set of capabilities changes, by mint or revocation. */
	onChanged(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	private changed(): void {
		for (const listener of [...this.changeListeners]) {
			try {
				listener();
			} catch {
				/* an observer cannot affect capability authority */
			}
		}
	}

	onRevoked(listener: CapabilityRevocationListener): () => void {
		this.revocationListeners.add(listener);
		return () => this.revocationListeners.delete(listener);
	}

	private findByDigest(digest: Buffer): StoredCapability | undefined {
		for (const capability of this.capabilities.values()) {
			if (timingSafeEqual(capability.digest, digest)) return capability;
		}
		return undefined;
	}

	private hasDigest(digest: Buffer): boolean {
		return this.findByDigest(digest) !== undefined;
	}

	private revokeDigest(digest: Buffer): boolean {
		const key = digest.toString('hex');
		const capability = this.capabilities.get(key);
		if (capability === undefined) return false;
		this.capabilities.delete(key);
		for (const listener of this.revocationListeners)
			listener(key, capability.terminalSessionId);
		this.changed();
		return true;
	}

	private assertScope(scope: string): asserts scope is ControlScope {
		if (!(scope in scopeRank)) throw new TypeError('invalid control scope');
	}
}

function parsePersistedCapability(
	value: unknown,
): PersistedControlCapability | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const entry = value as Record<string, unknown>;
	const { digest, terminalSessionId, projectId, scope, reach } = entry;
	// Entries saved by builds that expired capabilities also carry
	// `expiresAt`; it is ignored.
	const { issuedAt } = entry;
	if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest))
		return undefined;
	if (typeof terminalSessionId !== 'string' || typeof projectId !== 'string')
		return undefined;
	if (typeof scope !== 'string' || !(scope in scopeRank)) return undefined;
	if (reach !== 'project' && reach !== 'workspace') return undefined;
	if (typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt))
		return undefined;
	try {
		assertScopeId(terminalSessionId, 'terminal session id');
		if (isChatCallerKey(terminalSessionId)) return undefined;
		assertScopeId(projectId, 'project id');
		// Workspace reach is valid only for the automation space; a saved entry
		// claiming it for anything else is discarded, never honoured.
		if (reach === 'workspace' && projectId !== AUTOMATION_SPACE_ID)
			return undefined;
	} catch {
		return undefined;
	}
	return {
		digest,
		terminalSessionId,
		projectId,
		scope: scope as ControlScope,
		reach,
		issuedAt,
	};
}

export interface ControlSettingsBinding {
	readonly dispose: () => void;
}

/**
 * Bind the server-owned terminayMcp setting to capability authority. The
 * initial snapshot and every committed update are applied synchronously at
 * this boundary; disabling MCP revokes existing capabilities immediately.
 */
export async function bindControlSetting(
	capabilities: Pick<ControlCapabilityStore, 'setEnabled'>,
	settings: ServerSettingsRepository,
): Promise<ControlSettingsBinding> {
	if (typeof capabilities?.setEnabled !== 'function')
		throw new TypeError('control capability store is required');
	if (!(settings instanceof Object) || typeof settings.onChange !== 'function')
		throw new TypeError('server settings repository is required');
	const apply = (state: ServerSettingsState): void => {
		const setting = state.settings.terminayMcp;
		const enabled =
			typeof setting === 'object' &&
			setting !== null &&
			!Array.isArray(setting) &&
			typeof setting.enabled === 'boolean'
				? setting.enabled
				: true;
		capabilities.setEnabled(enabled);
	};
	const remove = settings.onChange(apply);
	try {
		apply(await settings.load());
	} catch (error) {
		remove();
		throw error;
	}
	return { dispose: remove };
}

export class ControlFrameLimitError extends Error {
	constructor(readonly maxBytes: number) {
		super(`Control frame exceeds the ${maxBytes}-byte limit.`);
		this.name = 'ControlFrameLimitError';
	}
}

export class ControlFrameMalformedError extends Error {
	constructor(message = 'Malformed control frame.') {
		super(message);
		this.name = 'ControlFrameMalformedError';
	}
}

/** Incremental UTF-8 JSONL decoder with a hard limit for partial frames. */
export class ControlFrameDecoder {
	private buffered = new Uint8Array();
	/** Encoded byte length of each frame returned by the last `push`. */
	lastFrameBytes: number[] = [];
	constructor(
		readonly maxFrameBytes = CONTROL_MAX_FRAME_BYTES,
		private readonly maxFramesPerPush = 128,
	) {
		assertPositiveLimit(maxFrameBytes, 'maxFrameBytes');
		assertPositiveLimit(maxFramesPerPush, 'maxFramesPerPush');
	}

	push(chunk: Uint8Array): unknown[] {
		if (!(chunk instanceof Uint8Array))
			throw new TypeError('control frame chunks must be Uint8Array');
		if (chunk.byteLength === 0) return [];
		// Refuse an unbounded read before copying it into the accumulator. A
		// chunk containing complete frames is allowed only up to the bounded
		// batch ceiling; a partial frame can never exceed maxFrameBytes.
		if (
			chunk.byteLength > this.maxFrameBytes * this.maxFramesPerPush ||
			(this.buffered.byteLength + chunk.byteLength > this.maxFrameBytes &&
				!chunk.includes(0x0a))
		) {
			throw new ControlFrameLimitError(this.maxFrameBytes);
		}
		const next = new Uint8Array(this.buffered.byteLength + chunk.byteLength);
		next.set(this.buffered);
		next.set(chunk, this.buffered.byteLength);
		this.buffered = next;
		const values: unknown[] = [];
		const sizes: number[] = [];
		let offset = 0;
		for (let index = 0; index < this.buffered.byteLength; index += 1) {
			if (this.buffered[index] !== 0x0a) continue;
			const line = this.buffered.subarray(offset, index);
			if (line.byteLength > this.maxFrameBytes)
				throw new ControlFrameLimitError(this.maxFrameBytes);
			if (line.byteLength === 0)
				throw new ControlFrameMalformedError('Empty control frame.');
			const withoutCarriage =
				line[line.byteLength - 1] === 0x0d
					? line.subarray(0, line.byteLength - 1)
					: line;
			let parsed: unknown;
			try {
				parsed = JSON.parse(textDecoder.decode(withoutCarriage));
			} catch {
				throw new ControlFrameMalformedError();
			}
			values.push(parsed);
			sizes.push(line.byteLength);
			offset = index + 1;
			if (values.length > this.maxFramesPerPush)
				throw new ControlFrameMalformedError(
					'Too many control frames in one read.',
				);
		}
		this.buffered = this.buffered.slice(offset);
		if (this.buffered.byteLength > this.maxFrameBytes)
			throw new ControlFrameLimitError(this.maxFrameBytes);
		this.lastFrameBytes = sizes;
		return values;
	}

	finish(): void {
		if (this.buffered.byteLength !== 0)
			throw new ControlFrameMalformedError('Truncated control frame.');
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

export function isControlRequest(value: unknown): value is ControlRequest {
	if (!isPlainObject(value)) return false;
	const keys = Object.keys(value).sort();
	if (keys.join('|') !== 'id|op|params|token|version') return false;
	return (
		typeof value.id === 'string' &&
		idPattern.test(value.id) &&
		isValidToken(value.token) &&
		value.version === CONTROL_PROTOCOL_VERSION &&
		typeof value.op === 'string' &&
		controlOperations.has(value.op) &&
		isPlainObject(value.params)
	);
}

export function encodeControlMessage(message: unknown): string {
	const encoded = JSON.stringify(message);
	if (encoded === undefined)
		throw new TypeError('control message is not JSON serializable');
	return `${encoded}\n`;
}

function responseForError(id: string, error: ControlError): ControlResponse {
	return { id, ok: false, error };
}
function candidateId(value: unknown): string | null {
	return isPlainObject(value) &&
		typeof value.id === 'string' &&
		idPattern.test(value.id)
		? value.id
		: null;
}

function normalizeScope(
	value: ControlCapabilityScope | null,
): ControlCapabilityScope | null {
	if (value === null || !isPlainObject(value)) return null;
	if (
		typeof value.terminalSessionId !== 'string' ||
		typeof value.projectId !== 'string'
	)
		return null;
	if (
		!idPattern.test(value.terminalSessionId) ||
		!idPattern.test(value.projectId)
	)
		return null;
	if (value.scope !== undefined && !(value.scope in scopeRank)) return null;
	if (
		value.reach !== undefined &&
		value.reach !== 'project' &&
		value.reach !== 'workspace'
	)
		return null;
	return {
		terminalSessionId: value.terminalSessionId,
		projectId: value.projectId,
		scope: value.scope ?? 'write',
		...reachField(value.reach ?? 'project'),
		// A chat caller keeps its identity only when it agrees with the
		// reserved key it was resolved under (ADR-0068).
		...(isPlainObject(value.chat) &&
		typeof value.chat.chatId === 'string' &&
		value.terminalSessionId === chatCallerKey(value.chat.chatId)
			? { chat: Object.freeze({ chatId: value.chat.chatId }) }
			: {}),
	};
}

function asControlError(error: unknown): ControlError {
	if (
		isPlainObject(error) &&
		typeof error.code === 'string' &&
		controlErrorCodes.has(error.code as ControlErrorCode) &&
		typeof error.message === 'string'
	) {
		const message = error.message.slice(0, CONTROL_ERROR_MESSAGE_BYTES);
		const candidates = Array.isArray(error.candidates)
			? error.candidates
					.filter(
						(candidate): candidate is string =>
							typeof candidate === 'string' && idPattern.test(candidate),
					)
					.slice(0, CONTROL_ERROR_CANDIDATES)
			: undefined;
		return {
			code: error.code as ControlErrorCode,
			message,
			...(candidates === undefined || candidates.length === 0
				? {}
				: { candidates }),
		};
	}
	if (error instanceof ControlEndpointError) {
		const candidates = error.candidates
			?.filter(
				(candidate): candidate is string =>
					typeof candidate === 'string' && idPattern.test(candidate),
			)
			.slice(0, CONTROL_ERROR_CANDIDATES);
		return {
			code: error.code,
			message: error.message.slice(0, CONTROL_ERROR_MESSAGE_BYTES),
			...(candidates === undefined || candidates.length === 0
				? {}
				: { candidates }),
		};
	}
	return { code: 'internal', message: 'The control operation failed.' };
}

/**
 * Build the server-side operation dispatcher used by a local control
 * endpoint.  Each request is routed by its validated operation name; there is
 * no renderer, window, PID, or request-body scope fallback in this path.
 *
 * Handlers may return either a plain result or an explicit result/error
 * envelope.  A typed ControlEndpointError is converted to its stable public
 * error shape, while an unexpected exception is intentionally collapsed to a
 * generic internal error so implementation details cannot cross the socket.
 */
export function createControlOperationDispatcher(
	handlers: ControlOperationHandlers,
): ControlDispatcher {
	if (!isPlainObject(handlers))
		throw new TypeError('control operation handlers must be an object');
	for (const [operation, handler] of Object.entries(handlers)) {
		if (!controlOperations.has(operation))
			throw new TypeError(
				`unsupported control operation handler: ${operation}`,
			);
		if (handler !== undefined && typeof handler !== 'function')
			throw new TypeError(
				`control operation handler must be a function: ${operation}`,
			);
	}
	const table = Object.freeze({ ...handlers }) as ControlOperationHandlers;
	return async (request, context) => {
		const handler = table[request.op] as ControlOperationHandler | undefined;
		if (handler === undefined) {
			return {
				ok: false,
				error: {
					code: 'unsupported_op',
					message: `The control operation is not available: ${request.op}.`,
				},
			} satisfies ControlDispatchResult;
		}
		try {
			return await handler(request, context);
		} catch (error) {
			return {
				ok: false,
				error: asControlError(error),
			} satisfies ControlDispatchResult;
		}
	};
}

function localSocketPath(socketPath: string): boolean {
	const namedPipe = socketPath.startsWith('\\\\.\\pipe\\');
	if (namedPipe) return true;
	if (!isAbsolute(socketPath))
		throw new TypeError('control socket path must be absolute');
	if (/^(?:tcp|udp|http|https):\/\//i.test(socketPath))
		throw new TypeError('control endpoint must be local');
	return true;
}

async function removeStaleSocket(socketPath: string): Promise<void> {
	try {
		const stat = await lstat(socketPath);
		if (!stat.isSocket())
			throw new Error('control endpoint path exists and is not a socket');
		await unlink(socketPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
}

export function createControlEndpoint(
	options: ControlEndpointOptions,
): LocalControlEndpoint {
	localSocketPath(options.socketPath);
	const resolveCapability =
		options.resolveCapability ??
		options.capabilities?.resolve.bind(options.capabilities);
	if (resolveCapability === undefined)
		throw new TypeError('a capability resolver is required');
	const resolve = resolveCapability;
	const maxFrameBytes = options.maxFrameBytes ?? CONTROL_MAX_FRAME_BYTES;
	const maxResponseBytes =
		options.maxResponseBytes ?? CONTROL_MAX_RESPONSE_BYTES;
	const maxInFlightPerConnection =
		options.maxInFlightPerConnection ?? CONTROL_MAX_IN_FLIGHT_PER_CONNECTION;
	const maxInFlightTotal =
		options.maxInFlightTotal ?? CONTROL_MAX_IN_FLIGHT_TOTAL;
	const requestTimeoutMs =
		options.requestTimeoutMs ?? CONTROL_REQUEST_TIMEOUT_MS;
	const timers = options.timers ?? GLOBAL_CONTROL_TIMERS;
	// A host that pins the frame bound without naming a large one keeps a
	// single bound: nothing may then exceed what it chose.
	const maxLargeFrameBytes = Math.max(
		maxFrameBytes,
		options.maxLargeFrameBytes ??
			(options.maxFrameBytes === undefined
				? CONTROL_MAX_LARGE_FRAME_BYTES
				: maxFrameBytes),
	);
	const maxLargeResponseBytes =
		options.maxLargeResponseBytes ?? CONTROL_MAX_LARGE_RESPONSE_BYTES;
	const maxQueuedResponseBytes =
		options.maxQueuedResponseBytes ??
		Math.max(maxResponseBytes, maxLargeResponseBytes) * 2;
	assertPositiveLimit(maxFrameBytes, 'maxFrameBytes');
	assertPositiveLimit(maxResponseBytes, 'maxResponseBytes');
	assertPositiveLimit(maxInFlightPerConnection, 'maxInFlightPerConnection');
	assertPositiveLimit(maxInFlightTotal, 'maxInFlightTotal');
	assertPositiveLimit(requestTimeoutMs, 'requestTimeoutMs');
	assertPositiveLimit(maxQueuedResponseBytes, 'maxQueuedResponseBytes');
	const operationScopes = {
		...DEFAULT_OPERATION_SCOPES,
		...options.operationScopes,
	};
	let server: Server | undefined;
	let listening = false;
	let nextConnectionId = 0;
	let totalInFlight = 0;
	const connections = new Set<Socket>();
	const allControllers = new Map<AbortController, string>();
	let removeRevocationListener: (() => void) | undefined;

	const reportError = (error: unknown): void => {
		options.onError?.(error);
	};

	function writeResponse(
		socket: Socket,
		response: ControlResponse,
		limit = maxResponseBytes,
	): void {
		if (!socket.writable || socket.destroyed) return;
		let encoded: string;
		try {
			encoded = encodeControlMessage(response);
		} catch {
			encoded = encodeControlMessage(
				responseForError(response.id, {
					code: 'internal',
					message: 'The control response was not serializable.',
				}),
			);
		}
		if (Buffer.byteLength(encoded, 'utf8') > limit) {
			encoded = encodeControlMessage(
				responseForError(response.id, {
					code: 'limit_exceeded',
					message: 'The control response exceeded its size limit.',
				}),
			);
		}
		if (
			socket.writableLength + Buffer.byteLength(encoded, 'utf8') >
			maxQueuedResponseBytes
		) {
			socket.destroy(
				new Error('control client is not reading bounded responses'),
			);
			return;
		}
		socket.write(encoded);
	}

	function abortForRevokedDigest(digest: string): void {
		for (const [controller, tokenDigest] of allControllers)
			if (tokenDigest === digest) controller.abort('revoked');
	}

	async function handleRequest(
		socket: Socket,
		connectionId: string,
		inFlight: Map<string, AbortController>,
		value: unknown,
	): Promise<void> {
		const id = candidateId(value);
		if (!isControlRequest(value)) {
			if (id !== null)
				writeResponse(
					socket,
					responseForError(id, {
						code: 'bad_request',
						message: 'Malformed control request envelope.',
					}),
				);
			else socket.destroy(new Error('malformed control request'));
			return;
		}
		const request = value;
		if (inFlight.has(request.id)) {
			writeResponse(
				socket,
				responseForError(request.id, {
					code: 'bad_request',
					message: 'A request with this id is already in flight.',
				}),
			);
			return;
		}
		if (inFlight.size >= maxInFlightPerConnection) {
			writeResponse(
				socket,
				responseForError(request.id, {
					code: 'limit_exceeded',
					message: 'The per-connection control concurrency limit was exceeded.',
				}),
			);
			return;
		}
		// A held watch for tool-list changes is one per agent and does no
		// work; it is bounded per connection but not counted against the server.
		const counted = !(
			request.op === 'list_connected_tools' &&
			typeof request.params.after === 'string'
		);
		if (counted && totalInFlight >= maxInFlightTotal) {
			writeResponse(
				socket,
				responseForError(request.id, {
					code: 'limit_exceeded',
					message: 'The control concurrency limit was exceeded.',
				}),
			);
			return;
		}
		const controller = new AbortController();
		inFlight.set(request.id, controller);
		allControllers.set(controller, hashToken(request.token).toString('hex'));
		if (counted) totalInFlight += 1;
		let timeout: unknown = timers.setTimeout(
			() => controller.abort('timeout'),
			requestTimeoutMs,
		);
		const holdDeadline = (): (() => void) => {
			if (timeout !== undefined) timers.clearTimeout(timeout);
			timeout = undefined;
			let resumed = false;
			return () => {
				if (resumed || controller.signal.aborted) return;
				resumed = true;
				timeout = timers.setTimeout(
					() => controller.abort('timeout'),
					requestTimeoutMs,
				);
			};
		};
		const aborted = new Promise<ControlResponse>((resolve) =>
			controller.signal.addEventListener(
				'abort',
				() => {
					if (!socket.writable || controller.signal.reason === 'caller_closed')
						return;
					const code: ControlErrorCode =
						controller.signal.reason === 'timeout'
							? 'timeout'
							: controller.signal.reason === 'revoked'
								? 'invalid_token'
								: 'cancelled';
					resolve(
						responseForError(
							request.id,
							code === 'timeout'
								? {
										code,
										message: 'The control request exceeded its deadline.',
									}
								: code === 'invalid_token'
									? INVALID_CAPABILITY_ERROR
									: { code, message: 'The control request was cancelled.' },
						),
					);
				},
				{ once: true },
			),
		);
		try {
			const operation = Promise.resolve().then(async () => {
				let resolvedScope: ControlCapabilityScope | null;
				try {
					resolvedScope = await resolve(request.token);
				} catch {
					return responseForError(request.id, INVALID_CAPABILITY_ERROR);
				}
				const scope = normalizeScope(resolvedScope);
				if (scope === null)
					return responseForError(request.id, INVALID_CAPABILITY_ERROR);
				const requiredScope = operationScopes[request.op] ?? 'read';
				if (scopeRank[scope.scope ?? 'write'] < scopeRank[requiredScope])
					return responseForError(request.id, {
						code: 'forbidden',
						message:
							'The control capability is not permitted for this operation.',
					});
				if (controller.signal.aborted) return undefined;
				const { token: _token, ...dispatchRequest } = request;
				const dispatchResult = await options.dispatch(dispatchRequest, {
					...scope,
					connectionId,
					requestId: request.id,
					signal: controller.signal,
					holdDeadline,
				});
				if (
					isPlainObject(dispatchResult) &&
					dispatchResult.ok === false &&
					'error' in dispatchResult
				)
					return responseForError(
						request.id,
						asControlError(dispatchResult.error),
					);
				if (
					isPlainObject(dispatchResult) &&
					dispatchResult.ok === true &&
					'result' in dispatchResult
				)
					return {
						id: request.id,
						ok: true,
						result: dispatchResult.result,
						...(typeof dispatchResult.modelContext === 'string'
							? { modelContext: dispatchResult.modelContext }
							: {}),
					} satisfies ControlResponse;
				return {
					id: request.id,
					ok: true,
					result: dispatchResult === undefined ? null : dispatchResult,
				} satisfies ControlResponse;
			});
			const result = await Promise.race([operation, aborted]);
			if (
				result !== undefined &&
				socket.writable &&
				controller.signal.reason !== 'caller_closed'
			)
				writeResponse(
					socket,
					result,
					CONTROL_LARGE_RESPONSE_OPERATIONS.has(request.op)
						? Math.max(maxResponseBytes, maxLargeResponseBytes)
						: maxResponseBytes,
				);
		} catch (error) {
			reportError(error);
			if (socket.writable && controller.signal.reason !== 'caller_closed')
				writeResponse(
					socket,
					responseForError(request.id, asControlError(error)),
				);
		} finally {
			if (timeout !== undefined) timers.clearTimeout(timeout);
			inFlight.delete(request.id);
			allControllers.delete(controller);
			if (counted) totalInFlight -= 1;
		}
	}

	function onConnection(socket: Socket): void {
		const connectionId = `connection-${++nextConnectionId}`;
		const inFlight = new Map<string, AbortController>();
		// The decoder admits the large bound; a frame over the ordinary bound is
		// then accepted only for an operation that is allowed to be large.
		const decoder = new ControlFrameDecoder(maxLargeFrameBytes);
		connections.add(socket);
		socket.on('data', (chunk: Buffer) => {
			let values: unknown[];
			try {
				values = decoder.push(chunk);
			} catch (error) {
				reportError(error);
				socket.destroy(error instanceof Error ? error : undefined);
				return;
			}
			const sizes = decoder.lastFrameBytes;
			for (const [index, value] of values.entries()) {
				if (
					(sizes[index] ?? 0) > maxFrameBytes &&
					!(
						isPlainObject(value) &&
						typeof value.op === 'string' &&
						CONTROL_LARGE_FRAME_OPERATIONS.has(value.op)
					)
				) {
					const error = new ControlFrameLimitError(maxFrameBytes);
					reportError(error);
					socket.destroy(error);
					return;
				}
				void handleRequest(socket, connectionId, inFlight, value).catch(
					reportError,
				);
			}
		});
		socket.on('error', reportError);
		socket.on('close', () => {
			for (const controller of inFlight.values())
				controller.abort('caller_closed');
			inFlight.clear();
			connections.delete(socket);
		});
	}

	async function start(): Promise<void> {
		if (listening) return;
		if (!options.socketPath.startsWith('\\\\.\\pipe\\')) {
			const parent = dirname(options.socketPath);
			await mkdir(parent, { recursive: true, mode: 0o700 });
			// Never change permissions on a filesystem root. Applications should
			// normally provide a private data directory, which is tightened here.
			if (
				options.tightenParentDirectory !== false &&
				parent !== '/' &&
				parent !== '.'
			)
				await chmod(parent, 0o700);
			await removeStaleSocket(options.socketPath);
		}
		const nextServer = createServer(onConnection);
		await new Promise<void>((resolve, reject) => {
			const onListening = (): void => {
				nextServer.off('error', onError);
				resolve();
			};
			const onError = (error: Error): void => {
				nextServer.off('listening', onListening);
				reject(error);
			};
			nextServer.once('listening', onListening);
			nextServer.once('error', onError);
			nextServer.on('error', reportError);
			nextServer.listen(options.socketPath);
		});
		if (!options.socketPath.startsWith('\\\\.\\pipe\\'))
			await chmod(options.socketPath, 0o600);
		server = nextServer;
		listening = true;
		if (options.capabilities?.onRevoked !== undefined)
			removeRevocationListener = options.capabilities.onRevoked(
				abortForRevokedDigest,
			);
	}

	async function stop(): Promise<void> {
		if (!listening || server === undefined) return;
		const closing = server;
		server = undefined;
		listening = false;
		removeRevocationListener?.();
		removeRevocationListener = undefined;
		for (const controller of allControllers.keys())
			controller.abort('caller_closed');
		options.capabilities?.revokeAll?.();
		for (const socket of connections) socket.destroy();
		await new Promise<void>((resolve) => closing.close(() => resolve()));
		if (!options.socketPath.startsWith('\\\\.\\pipe\\'))
			await removeStaleSocket(options.socketPath);
	}

	return {
		socketPath: options.socketPath,
		get listening() {
			return listening;
		},
		start,
		stop,
	};
}

export const createLocalControlEndpoint = createControlEndpoint;
export const createMcpControlEndpoint = createControlEndpoint;
