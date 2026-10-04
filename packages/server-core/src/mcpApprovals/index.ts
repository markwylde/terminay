import { type JsonValue, protocolError } from '@terminay/protocol';
import { assertAutomationAuthority } from '../automationService/protocol.js';
import type {
	CommandRequest,
	OperationRegistries,
	OrderedEventJournalLike,
	QueryRequest,
} from '../types.js';

/**
 * Server-owned MCP permission policy and approvals (ADR-0031).
 *
 * Every MCP operation belongs to one permission group whose policy is a
 * server setting. An `ask` policy parks the request here as a pending approval
 * bound to the calling terminal until a client with terminal-create authority
 * decides it, the request is cancelled, or the terminal's capability ends.
 * Nothing here is persisted: a restart ends every approval and session grant.
 */

export const MCP_PERMISSION_GROUPS = [
	'terminalsRead',
	'terminalsManage',
	'automationsRead',
	'automationsManage',
	'appWindows',
	'connectedServerTools',
	// Not an agent operation: a message a window types into its terminal. It
	// shares the policy table, grants, and approval prompt of the groups.
	'windowMessages',
] as const;

export type McpPermissionGroup = (typeof MCP_PERMISSION_GROUPS)[number];
export type McpPermissionPolicy = 'ask' | 'allow' | 'deny';
export type McpPermissionPolicies = Readonly<
	Record<McpPermissionGroup, McpPermissionPolicy>
>;

export const DEFAULT_MCP_PERMISSIONS: McpPermissionPolicies = Object.freeze({
	terminalsRead: 'allow',
	terminalsManage: 'allow',
	automationsRead: 'allow',
	automationsManage: 'ask',
	appWindows: 'allow',
	connectedServerTools: 'allow',
	windowMessages: 'allow',
});

export const MCP_PERMISSION_GROUP_LABELS: Readonly<
	Record<McpPermissionGroup, string>
> = Object.freeze({
	terminalsRead: 'Read Terminals',
	terminalsManage: 'Full Terminal Management',
	automationsRead: 'Read Automations',
	automationsManage: 'Full Automation Management',
	appWindows: 'App Windows',
	connectedServerTools: 'Connected Server Tools',
	windowMessages: 'Window Messages',
});

export const MCP_APPROVAL_OPERATIONS = Object.freeze({
	get: 'mcp.approvals.get',
	decide: 'mcp.approvals.decide',
} as const);

export const MCP_APPROVAL_EVENTS = Object.freeze({
	changed: 'mcp.approvals.changed',
} as const);

/** Pending approvals one terminal may hold; one more is refused. */
export const MAX_PENDING_APPROVALS_PER_TERMINAL = 8;

export type McpApprovalDecision = 'once' | 'session' | 'decline';

/** A labelled line of what the operation would apply, shown in full. */
export interface McpApprovalDetail {
	readonly label: string;
	readonly value: string;
	/** Render in a monospace block (commands, text). */
	readonly code?: boolean;
}

export interface McpApprovalRequest {
	readonly terminalSessionId: string;
	readonly projectId: string;
	readonly operation: string;
	readonly group: McpPermissionGroup;
	/** Detected agent name, or "An agent". */
	readonly agent: string;
	readonly terminalTitle: string;
	/** Plain-words action, completing "<agent> in <terminal> wants to …". */
	readonly summary: string;
	readonly details: readonly McpApprovalDetail[];
	readonly signal: AbortSignal;
}

export interface McpApprovalView {
	readonly id: string;
	readonly terminalSessionId: string;
	readonly projectId: string;
	readonly operation: string;
	readonly group: McpPermissionGroup;
	readonly groupLabel: string;
	readonly agent: string;
	readonly terminalTitle: string;
	readonly summary: string;
	readonly details: readonly McpApprovalDetail[];
	readonly createdAt: number;
}

export type McpPermissionErrorCode =
	| 'permission_denied'
	| 'permission_declined'
	| 'approval_queue_full'
	| 'cancelled';

export class McpPermissionError extends Error {
	readonly code: McpPermissionErrorCode;

	constructor(code: McpPermissionErrorCode, message: string) {
		super(message);
		this.name = 'McpPermissionError';
		this.code = code;
	}
}

export interface McpApprovalServiceOptions {
	readonly eventJournal?: OrderedEventJournalLike;
	readonly policies?: McpPermissionPolicies;
	readonly maxPendingPerTerminal?: number;
	readonly now?: () => number;
	readonly generateId?: () => string;
}

export type McpAuthorization =
	| { readonly ok: true }
	| { readonly ok: false; readonly error: McpPermissionError };

interface Pending {
	readonly view: McpApprovalView;
	readonly settle: (outcome: 'allow' | McpPermissionError) => void;
}

/** Normalize the stored `terminayMcp.permissions` setting. */
export function mcpPermissionsFromSettings(
	settings: Readonly<Record<string, unknown>> | undefined,
): McpPermissionPolicies {
	const mcp = record(settings?.terminayMcp);
	const permissions = record(mcp?.permissions);
	const result = { ...DEFAULT_MCP_PERMISSIONS };
	for (const group of MCP_PERMISSION_GROUPS) {
		const value = permissions?.[group];
		if (value === 'ask' || value === 'allow' || value === 'deny')
			result[group] = value;
	}
	return Object.freeze(result);
}

export function deniedMessage(group: McpPermissionGroup): string {
	return `${MCP_PERMISSION_GROUP_LABELS[group]} is set to Never Allow for Terminay MCP. The user can change it in Settings > AI > Terminay MCP.`;
}

export class McpApprovalService {
	private policySet: McpPermissionPolicies;
	private readonly pending = new Map<string, Pending>();
	/** terminalSessionId → groups granted for this capability's lifetime. */
	private readonly grants = new Map<string, Set<McpPermissionGroup>>();
	private readonly listeners = new Set<() => void>();
	private readonly maxPendingPerTerminal: number;
	private readonly now: () => number;
	private readonly generateId: () => string;
	private nextId = 0;

	constructor(private readonly options: McpApprovalServiceOptions = {}) {
		this.policySet = options.policies ?? DEFAULT_MCP_PERMISSIONS;
		this.maxPendingPerTerminal =
			options.maxPendingPerTerminal ?? MAX_PENDING_APPROVALS_PER_TERMINAL;
		this.now = options.now ?? Date.now;
		this.generateId =
			options.generateId ??
			(() => {
				this.nextId += 1;
				return `apr_${this.now().toString(36)}_${this.nextId.toString(36)}`;
			});
	}

	policies(): McpPermissionPolicies {
		return this.policySet;
	}

	/** The policy that applies to one terminal now, counting session grants.
	 * A grant never overrides Never Allow. */
	effectivePolicy(
		group: McpPermissionGroup,
		terminalSessionId: string,
	): McpPermissionPolicy {
		const policy = this.policySet[group];
		if (policy !== 'ask') return policy;
		return this.grants.get(terminalSessionId)?.has(group) === true
			? 'allow'
			: 'ask';
	}

	/**
	 * Apply new policies. Pending approvals in a changed group are re-decided
	 * by the new policy, and every session grant for that group ends.
	 */
	setPolicies(next: McpPermissionPolicies): void {
		const changed = MCP_PERMISSION_GROUPS.filter(
			(group) => this.policySet[group] !== next[group],
		);
		this.policySet = next;
		if (changed.length === 0) return;
		for (const grants of this.grants.values())
			for (const group of changed) grants.delete(group);
		for (const [id, entry] of [...this.pending]) {
			const group = entry.view.group;
			if (!changed.includes(group)) continue;
			const policy = next[group];
			if (policy === 'allow') this.finish(id, 'allow');
			else if (policy === 'deny')
				this.finish(
					id,
					new McpPermissionError('permission_denied', deniedMessage(group)),
				);
		}
	}

	/**
	 * Decide whether an operation may run. Resolves once allowed; waits on a
	 * user decision under `ask` with no time limit. The caller's signal ends
	 * the wait and withdraws the approval.
	 */
	async authorize(request: McpApprovalRequest): Promise<McpAuthorization> {
		const policy = this.effectivePolicy(
			request.group,
			request.terminalSessionId,
		);
		if (policy === 'allow') return { ok: true };
		if (policy === 'deny')
			return {
				ok: false,
				error: new McpPermissionError(
					'permission_denied',
					deniedMessage(request.group),
				),
			};
		if (request.signal.aborted)
			return { ok: false, error: cancelledError() };
		const queued = [...this.pending.values()].filter(
			(entry) => entry.view.terminalSessionId === request.terminalSessionId,
		).length;
		if (queued >= this.maxPendingPerTerminal)
			return {
				ok: false,
				error: new McpPermissionError(
					'approval_queue_full',
					'This terminal already has the maximum number of MCP requests waiting for approval.',
				),
			};
		const id = this.generateId();
		const view: McpApprovalView = Object.freeze({
			id,
			terminalSessionId: request.terminalSessionId,
			projectId: request.projectId,
			operation: request.operation,
			group: request.group,
			groupLabel: MCP_PERMISSION_GROUP_LABELS[request.group],
			agent: request.agent,
			terminalTitle: request.terminalTitle,
			summary: request.summary,
			details: Object.freeze(request.details.map((line) => ({ ...line }))),
			createdAt: this.now(),
		});
		return new Promise<McpAuthorization>((resolve) => {
			const onAbort = (): void => {
				this.finish(id, cancelledError());
			};
			this.pending.set(id, {
				view,
				settle: (outcome) => {
					request.signal.removeEventListener('abort', onAbort);
					resolve(outcome === 'allow' ? { ok: true } : { ok: false, error: outcome });
				},
			});
			request.signal.addEventListener('abort', onAbort, { once: true });
			this.publish();
		});
	}

	/** Apply a user's decision. False when the approval no longer exists. */
	decide(approvalId: string, decision: McpApprovalDecision): boolean {
		const entry = this.pending.get(approvalId);
		if (entry === undefined) return false;
		if (decision === 'session') {
			const terminal = entry.view.terminalSessionId;
			const grants = this.grants.get(terminal) ?? new Set<McpPermissionGroup>();
			grants.add(entry.view.group);
			this.grants.set(terminal, grants);
		}
		if (decision === 'decline')
			this.finish(
				approvalId,
				new McpPermissionError(
					'permission_declined',
					'The user declined this request.',
				),
			);
		else this.finish(approvalId, 'allow');
		if (decision === 'session') this.releaseGranted(entry.view.terminalSessionId);
		return true;
	}

	/** Pending approvals, oldest first. */
	list(): readonly McpApprovalView[] {
		return [...this.pending.values()]
			.map((entry) => entry.view)
			.sort((left, right) => left.createdAt - right.createdAt);
	}

	/** The terminal's capability was revoked or replaced: its approvals and
	 * session grants end with it. */
	revokeTerminal(terminalSessionId: string): void {
		this.grants.delete(terminalSessionId);
		for (const [id, entry] of [...this.pending])
			if (entry.view.terminalSessionId === terminalSessionId)
				this.finish(id, cancelledError());
	}

	/** MCP disabled or the server stopping: everything ends. */
	revokeAll(): void {
		this.grants.clear();
		for (const id of [...this.pending.keys()]) this.finish(id, cancelledError());
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Protocol operations for clients: read pending approvals and decide one.
	 * Both need the authority to create terminals on this server. */
	operations(): OperationRegistries {
		const policy = { scope: 'write' } as const;
		return {
			queries: {
				[MCP_APPROVAL_OPERATIONS.get]: async (request: QueryRequest) => {
					authorizeClient(request);
					return asJson({ approvals: this.list() });
				},
			},
			commands: {
				[MCP_APPROVAL_OPERATIONS.decide]: async (request: CommandRequest) => {
					authorizeClient(request);
					const payload = record(request.envelope.payload);
					const approvalId = payload?.approvalId;
					const decision = payload?.decision;
					if (
						typeof approvalId !== 'string' ||
						approvalId.length === 0 ||
						approvalId.length > 128 ||
						(decision !== 'once' &&
							decision !== 'session' &&
							decision !== 'decline')
					)
						throw protocolError('validation', 'approval decision is invalid');
					if (!this.decide(approvalId, decision))
						throw protocolError('not_found', 'approval is no longer pending');
					return asJson({ approvalId, decision });
				},
			},
			policies: {
				[MCP_APPROVAL_OPERATIONS.get]: policy,
				[MCP_APPROVAL_OPERATIONS.decide]: policy,
			},
		};
	}

	private finish(id: string, outcome: 'allow' | McpPermissionError): void {
		const entry = this.pending.get(id);
		if (entry === undefined) return;
		this.pending.delete(id);
		entry.settle(outcome);
		this.publish();
	}

	/** A new session grant also releases that terminal's other approvals in
	 * the same group, which the grant now covers. */
	private releaseGranted(terminalSessionId: string): void {
		for (const [id, entry] of [...this.pending])
			if (
				entry.view.terminalSessionId === terminalSessionId &&
				this.effectivePolicy(entry.view.group, terminalSessionId) === 'allow'
			)
				this.finish(id, 'allow');
	}

	private publish(): void {
		// Journal events reach every subscriber whatever its authority, so they
		// carry only ids and terminals; clients with authority refetch the
		// details through `mcp.approvals.get`.
		this.options.eventJournal?.append(
			MCP_APPROVAL_EVENTS.changed,
			asJson({
				approvals: this.list().map(({ id, terminalSessionId }) => ({
					id,
					terminalSessionId,
				})),
			}),
		);
		for (const listener of this.listeners) listener();
	}
}

function authorizeClient(request: QueryRequest | CommandRequest): void {
	try {
		assertAutomationAuthority(request.context);
	} catch {
		throw protocolError(
			'forbidden',
			'deciding MCP approvals requires authority to create terminals on this server',
		);
	}
}

function cancelledError(): McpPermissionError {
	return new McpPermissionError(
		'cancelled',
		'The request ended before it was approved.',
	);
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function asJson(value: unknown): JsonValue {
	return value as JsonValue;
}
