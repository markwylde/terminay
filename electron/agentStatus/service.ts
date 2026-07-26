import {
	AgentStatusStore,
	makeAgentStatusStreamId,
} from '../../src/agentStatusStore';
import {
	type AgentLifecycleEvent,
	type AgentProvider,
	type AgentStatusListener,
	type AgentStatusSnapshot,
	isAgentProvider,
} from '../../src/types/agentStatus';
import {
	type AgentHookEnvironment,
	createAgentHookEnvironment,
} from './environment';
import {
	AGENT_HOOK_PROVIDER_HEADER,
	AGENT_HOOK_SESSION_HEADER,
	type AgentHookRequest,
	AgentHookRequestError,
	type AgentHookServer,
	createAgentHookServer,
} from './hookServer';

export interface AgentHookNormalizationContext {
	activationTerminalSessionId: string;
	/** Monotonic receiver-owned sequence for this terminal/provider stream. */
	sequence: number;
	occurredAt: number;
	providerSessionId?: string;
}

export type AgentHookNormalizationResult =
	| AgentLifecycleEvent
	| null
	| undefined;

/**
 * Narrow boundary around the provider-driver registry. Keeping this adapter
 * here lets the transport remain independent of native Codex/Claude payloads.
 */
export type NormalizeAgentHookPayload = (
	provider: AgentProvider,
	payload: Record<string, unknown>,
	context: AgentHookNormalizationContext,
) => AgentHookNormalizationResult | Promise<AgentHookNormalizationResult>;

export interface AgentStatusServiceOptions {
	normalizeHookPayload: NormalizeAgentHookPayload;
	now?: () => number;
	store?: AgentStatusStore;
	token?: string;
}

function singleHeader(
	headers: AgentHookRequest['headers'],
	name: string,
): string | undefined {
	const value = headers[name];
	return typeof value === 'string' ? value.trim() : undefined;
}

function toEvents(
	result: AgentHookNormalizationResult,
): readonly AgentLifecycleEvent[] {
	return result ? [result] : [];
}

function validateNormalizedEvent(
	event: AgentLifecycleEvent,
	provider: AgentProvider,
	activationTerminalSessionId: string,
): void {
	if (!event || typeof event !== 'object') {
		throw new AgentHookRequestError(
			422,
			'Agent driver returned an invalid event.',
		);
	}
	if (event.provider !== provider) {
		throw new AgentHookRequestError(
			422,
			'Agent driver changed the hook provider.',
		);
	}
	if (event.activationTerminalSessionId !== activationTerminalSessionId) {
		throw new AgentHookRequestError(
			422,
			'Agent driver changed the terminal session identity.',
		);
	}
	if (
		typeof event.sessionId !== 'string' ||
		event.sessionId.length === 0 ||
		event.sessionId.length > 512
	) {
		throw new AgentHookRequestError(
			422,
			'Agent driver returned an invalid provider session id.',
		);
	}
	if (
		('agentId' in event &&
			event.agentId !== undefined &&
			(typeof event.agentId !== 'string' ||
				event.agentId.length === 0 ||
				event.agentId.length > 512)) ||
		('subagentId' in event &&
			(typeof event.subagentId !== 'string' ||
				event.subagentId.length === 0 ||
				event.subagentId.length > 512))
	) {
		throw new AgentHookRequestError(
			422,
			'Agent driver returned an invalid agent identity.',
		);
	}
	if (event.promptText !== undefined && event.promptText.length > 4_000) {
		throw new AgentHookRequestError(
			422,
			'Agent driver returned an oversized prompt.',
		);
	}
	if (
		'displayName' in event &&
		event.displayName !== undefined &&
		event.displayName.length > 200
	) {
		throw new AgentHookRequestError(
			422,
			'Agent driver returned an oversized display name.',
		);
	}
	if (
		event.kind === 'tool.started' &&
		((event.tool.subagentLaunch?.displayName?.length ?? 0) > 200 ||
			(event.tool.subagentLaunch?.promptText?.length ?? 0) > 4_000)
	) {
		throw new AgentHookRequestError(
			422,
			'Agent driver returned oversized subagent launch metadata.',
		);
	}
	if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) {
		throw new AgentHookRequestError(
			422,
			'Agent driver returned an invalid event sequence.',
		);
	}
	if (!Number.isFinite(event.occurredAt)) {
		throw new AgentHookRequestError(
			422,
			'Agent driver returned an invalid event timestamp.',
		);
	}
}

export class AgentStatusService {
	private readonly normalizeHookPayload: NormalizeAgentHookPayload;
	private readonly now: () => number;
	private readonly store: AgentStatusStore;
	private readonly server: AgentHookServer;
	private readonly activeTerminalSessions = new Set<string>();
	private readonly nextSequenceByTerminalProvider = new Map<string, number>();
	private readonly pendingSubagentLaunches = new Map<
		string,
		Array<{
			displayName?: string;
			promptText?: string;
			toolId: string;
		}>
	>();
	private started = false;

	constructor(options: AgentStatusServiceOptions) {
		this.normalizeHookPayload = options.normalizeHookPayload;
		this.now = options.now ?? Date.now;
		this.store = options.store ?? new AgentStatusStore();
		this.server = createAgentHookServer({
			token: options.token,
			handleRequest: (request) => this.handleHookRequest(request),
		});
	}

	getSnapshot = (): AgentStatusSnapshot => this.store.getSnapshot();

	subscribe = (listener: AgentStatusListener): (() => void) =>
		this.store.subscribe(listener);

	markAcknowledged(entryId: string, acknowledgedAt = this.now()): boolean {
		return this.store.markAcknowledged(entryId, acknowledgedAt);
	}

	markTerminalAcknowledged(
		activationTerminalSessionId: string,
		acknowledgedAt = this.now(),
	): number {
		return this.store.markTerminalAcknowledged(
			activationTerminalSessionId,
			acknowledgedAt,
		);
	}

	async start(): Promise<void> {
		if (this.started) {
			return;
		}
		await this.server.start();
		this.started = true;
	}

	async stop(): Promise<void> {
		for (const terminalSessionId of [...this.activeTerminalSessions]) {
			this.terminalExited(terminalSessionId);
		}
		this.started = false;
		this.nextSequenceByTerminalProvider.clear();
		this.pendingSubagentLaunches.clear();
		await this.server.stop();
	}

	clearStatus(): boolean {
		this.nextSequenceByTerminalProvider.clear();
		this.pendingSubagentLaunches.clear();
		return this.store.clear();
	}

	prepareTerminalSession(terminalSessionId: string): AgentHookEnvironment {
		if (!this.started) {
			throw new Error('Agent status service is not running.');
		}
		this.activeTerminalSessions.add(terminalSessionId);
		return createAgentHookEnvironment(
			terminalSessionId,
			this.server.endpoint,
			this.server.token,
		);
	}

	abandonTerminalSession(terminalSessionId: string): void {
		this.activeTerminalSessions.delete(terminalSessionId);
		this.removeSequenceCounters(terminalSessionId);
		this.removePendingSubagentLaunches(terminalSessionId);
	}

	terminalExited(
		terminalSessionId: string,
		options: { exitCode?: number; signal?: string } = {},
	): void {
		this.activeTerminalSessions.delete(terminalSessionId);
		this.removeSequenceCounters(terminalSessionId);
		this.removePendingSubagentLaunches(terminalSessionId);
		const snapshot = this.store.getSnapshot();
		const roots = Object.values(snapshot.entries).filter(
			(entry) =>
				entry.kind === 'root' &&
				entry.activationTerminalSessionId === terminalSessionId &&
				entry.active,
		);

		for (const root of roots) {
			const streamId = makeAgentStatusStreamId(
				root.provider,
				root.activationTerminalSessionId,
				root.sessionId,
			);
			const cursor = this.store.getSnapshot().eventCursors[streamId];
			this.store.dispatch({
				kind: 'agent.exited',
				provider: root.provider,
				sessionId: root.sessionId,
				activationTerminalSessionId: root.activationTerminalSessionId,
				agentId: root.agentId,
				sequence: (cursor?.sequence ?? root.lastEventSequence) + 1,
				occurredAt: Math.max(this.now(), cursor?.occurredAt ?? root.updatedAt),
				exitCode: options.exitCode,
				signal: options.signal,
			});
		}
	}

	async ingestHookPayload(
		provider: AgentProvider,
		activationTerminalSessionId: string,
		payload: Record<string, unknown>,
	): Promise<number> {
		if (!this.activeTerminalSessions.has(activationTerminalSessionId)) {
			throw new AgentHookRequestError(
				409,
				'Hook request targets an inactive terminal session.',
			);
		}

		const sequenceKey = `${provider}:${activationTerminalSessionId}`;
		const sequence = this.nextSequenceByTerminalProvider.get(sequenceKey) ?? 1;
		this.nextSequenceByTerminalProvider.set(sequenceKey, sequence + 1);
		const result = await this.normalizeHookPayload(provider, payload, {
			activationTerminalSessionId,
			sequence,
			occurredAt: this.now(),
		});
		const events = toEvents(result);
		for (const event of events) {
			validateNormalizedEvent(event, provider, activationTerminalSessionId);
		}
		for (const event of events) {
			this.store.dispatch(this.correlateSubagentLaunch(event));
		}
		return events.length;
	}

	private async handleHookRequest(request: AgentHookRequest): Promise<void> {
		const activationTerminalSessionId = singleHeader(
			request.headers,
			AGENT_HOOK_SESSION_HEADER,
		);
		if (!activationTerminalSessionId) {
			throw new AgentHookRequestError(
				400,
				'Hook request is missing its terminal session id.',
			);
		}
		const providerValue = singleHeader(
			request.headers,
			AGENT_HOOK_PROVIDER_HEADER,
		);
		if (!isAgentProvider(providerValue)) {
			throw new AgentHookRequestError(
				400,
				'Hook request has an unsupported agent provider.',
			);
		}

		await this.ingestHookPayload(
			providerValue,
			activationTerminalSessionId,
			request.body,
		);
	}

	private removeSequenceCounters(terminalSessionId: string): void {
		for (const key of this.nextSequenceByTerminalProvider.keys()) {
			if (key.endsWith(`:${terminalSessionId}`)) {
				this.nextSequenceByTerminalProvider.delete(key);
			}
		}
	}

	private correlateSubagentLaunch(
		event: AgentLifecycleEvent,
	): AgentLifecycleEvent {
		const streamId = makeAgentStatusStreamId(
			event.provider,
			event.activationTerminalSessionId,
			event.sessionId,
		);
		if (event.kind === 'tool.started' && event.tool.subagentLaunch) {
			const pending = this.pendingSubagentLaunches.get(streamId) ?? [];
			pending.push({
				...event.tool.subagentLaunch,
				toolId: event.tool.id,
			});
			// A broken or third-party driver must not grow receiver state forever.
			this.pendingSubagentLaunches.set(streamId, pending.slice(-32));
			return event;
		}
		if (event.kind === 'tool.finished') {
			const pending = this.pendingSubagentLaunches.get(streamId);
			if (pending) {
				const next = pending.filter(
					(candidate) => candidate.toolId !== event.toolId,
				);
				if (next.length > 0) {
					this.pendingSubagentLaunches.set(streamId, next);
				} else {
					this.pendingSubagentLaunches.delete(streamId);
				}
			}
			return event;
		}
		if (event.kind !== 'subagent.started') {
			return event;
		}

		const pending = this.pendingSubagentLaunches.get(streamId);
		const launch = pending?.shift();
		if (!launch) {
			return event;
		}
		if (pending && pending.length === 0) {
			this.pendingSubagentLaunches.delete(streamId);
		}
		return {
			...event,
			displayName: launch.displayName ?? event.displayName,
			promptText: event.promptText ?? launch.promptText,
		};
	}

	private removePendingSubagentLaunches(terminalSessionId: string): void {
		for (const key of this.pendingSubagentLaunches.keys()) {
			if (key.includes(`:${encodeURIComponent(terminalSessionId)}:`)) {
				this.pendingSubagentLaunches.delete(key);
			}
		}
	}
}
