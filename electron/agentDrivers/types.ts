import type {
	AgentLifecycleEvent,
	AgentProvider,
} from '../../src/types/agentStatus';
import type {
	ManagedHookOptions,
	ManagedHookReconciler,
	ManagedHookStatus,
} from './managedHooks';

export type AgentEvent = AgentLifecycleEvent;

export interface AgentDriverContext {
	/** Exact Terminay PTY/session UUID inherited by the hook process. */
	activationTerminalSessionId: string;
	/** Monotonic sequence assigned by the receiver for this provider session. */
	sequence: number;
	/** Receiver time; defaults to Date.now() when omitted. */
	occurredAt?: number;
	/** Receiver-known provider session id used when a payload omits one. */
	providerSessionId?: string;
}

export interface AgentDriver {
	readonly provider: AgentProvider;
	readonly displayName: string;
	readonly hooks: ManagedHookReconciler;
	normalize(
		nativePayload: unknown,
		context: AgentDriverContext,
	): AgentLifecycleEvent | null;
}

export type AgentDriverId = AgentProvider;

export interface AgentDriverRegistry {
	readonly drivers: readonly AgentDriver[];
	get(provider: AgentProvider | string): AgentDriver | undefined;
	normalize(
		provider: AgentProvider | string,
		nativePayload: unknown,
		context: AgentDriverContext,
	): AgentLifecycleEvent | null;
	hookStatus(
		provider: AgentProvider | string,
		options?: ManagedHookOptions,
	): Promise<ManagedHookStatus>;
	reconcileHooks(
		request: AgentHookReconciliationRequest,
	): Promise<AgentHookReconciliationResult>;
}

export type AgentHookReconciliationAction = 'install' | 'uninstall' | 'status';

export interface AgentHookReconciliationRequest {
	provider?: AgentProvider;
	action: AgentHookReconciliationAction;
	options?: ManagedHookOptions;
}

export interface AgentHookReconciliationResult {
	statuses: ManagedHookStatus[];
	ok: boolean;
}
