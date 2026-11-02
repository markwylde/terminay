import type {
	AgentStatusEntry,
	AgentStatusListener,
	AgentState,
} from '../activity/agentTypes.js';
import type {
	ActivityListener,
	TerminalActivitySessionSnapshot,
} from '../activity/types.js';
import type { RemoteConnectionAdmission } from '../remote/transport.js';
import type { EventListener } from '../types.js';
import {
	PROJECT_CLOSED_EVENT,
	PROJECT_OPENED_EVENT,
} from '../workspaceProtocol.js';
import type {
	TriggerEventKind,
	TriggerSubject,
	TriggerEventContext,
} from './types.js';
/** What the server knows about a terminal an event is about. */
export interface EventTerminalDescription {
	readonly projectId: string;
	readonly title?: string;
	readonly projectTitle?: string;
	/** The session's incarnation (its `createdAt`). */
	readonly sessionCreatedAt?: number;
}

export interface EventFanoutOptions {
	readonly serverId: string;
	readonly agents?: { subscribe(listener: AgentStatusListener): () => void };
	readonly activity?: { subscribe(listener: ActivityListener): () => void };
	readonly eventJournal?: { subscribe(listener: EventListener): () => void };
	readonly describeTerminal: (
		sessionId: string,
	) => EventTerminalDescription | undefined;
	readonly now?: () => number;
	readonly onError?: (error: unknown) => void;
}

export interface TriggerEvent {
	readonly event: TriggerEventKind;
	readonly subject: TriggerSubject;
	readonly context?: TriggerEventContext;
}

/** A consumer selects its current enabled definitions at event time. */
export interface EventConsumer {
	readonly accepts: (event: TriggerEventKind) => boolean;
	readonly onEvent: (
		trigger: TriggerEvent,
		firedAt: number,
	) => void | Promise<void>;
}

const AGENT_EVENTS: Readonly<Partial<Record<AgentState, TriggerEventKind>>> = {
	done: 'agent.finished',
	waiting: 'agent.needsInput',
	blocked: 'agent.blocked',
};

interface ActivityMemory {
	readonly status: TerminalActivitySessionSnapshot['status'];
	readonly attention: boolean;
}

/**
 * Server-wide event observation. Subscribes once to each canonical source and
 * fans transitions out to the registered consumers.
 *
 * An event fires only on a transition *into* the named state. The first report
 * of any terminal or agent after start seeds its last-known state and never
 * fires, which keeps "transition into" safe across restarts. Events from run
 * terminals (registered by the executor) are dropped before fan-out; terminals
 * a run opens through MCP are not registered and fire like any other.
 */
export class EventFanout {
	private readonly now: () => number;
	private readonly consumers = new Map<string, EventConsumer>();
	private readonly activityState = new Map<string, ActivityMemory>();
	private readonly agentState = new Map<string, AgentState>();
	private readonly runTerminals = new Set<string>();
	private readonly unsubscribers: (() => void)[] = [];
	private started = false;
	private stopped = false;

	constructor(private readonly options: EventFanoutOptions) {
		this.now = options.now ?? Date.now;
	}

	start(): void {
		if (this.started || this.stopped) return;
		this.started = true;
		const { agents, activity, eventJournal } = this.options;
		if (agents !== undefined)
			this.unsubscribers.push(
				agents.subscribe((snapshot) =>
					this.guard(() => this.observeAgents(snapshot.entries)),
				),
			);
		if (activity !== undefined)
			this.unsubscribers.push(
				activity.subscribe((event) =>
					this.guard(() => {
						if (event.type === 'activity.removed') {
							this.activityState.delete(event.sessionId);
							this.runTerminals.delete(event.sessionId);
							return;
						}
						if (event.snapshot !== undefined)
							this.observeActivity(event.snapshot);
					}),
				),
			);
		if (eventJournal !== undefined)
			this.unsubscribers.push(
				eventJournal.subscribe((event) =>
					this.guard(() => this.observeJournal(event.event, event.payload)),
				),
			);
	}

	stop(): void {
		this.stopped = true;
		for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
		this.activityState.clear();
		this.agentState.clear();
		this.runTerminals.clear();
		this.consumers.clear();
	}

	/** The executor registers the terminal it launched for a run. Nothing that
	 * terminal does raises an event. */
	markRunTerminal(sessionId: string): void {
		this.runTerminals.add(sessionId);
	}

	unmarkRunTerminal(sessionId: string): void {
		this.runTerminals.delete(sessionId);
	}

	isRunTerminal(sessionId: string): boolean {
		return this.runTerminals.has(sessionId);
	}

	/** Host hook: one authenticated remote device connection was admitted. */
	deviceConnected(admission: RemoteConnectionAdmission): void {
		if (!this.live) return;
		this.guard(() =>
			this.dispatch({
				event: 'device.connected',
				subject: {
					kind: 'device',
					deviceId: admission.deviceId,
					...(admission.deviceName === undefined
						? {}
						: { name: admission.deviceName }),
				},
			}),
		);
	}

	private get live(): boolean {
		return this.started && !this.stopped;
	}

	private observeActivity(snapshot: TerminalActivitySessionSnapshot): void {
		const sessionId = snapshot.sessionId;
		const previous = this.activityState.get(sessionId);
		this.activityState.set(sessionId, {
			status: snapshot.status,
			attention: snapshot.attention,
		});
		if (previous === undefined || this.runTerminals.has(sessionId)) return;
		if (!previous.attention && snapshot.attention)
			this.dispatchTerminal('terminal.needsAttention', sessionId);
		if (previous.status === 'working' && snapshot.status === 'idle') {
			if (
				snapshot.source === 'structured:command' &&
				snapshot.exitCode !== undefined
			)
				this.dispatchTerminal('terminal.commandFinished', sessionId, {
					exitCode: snapshot.exitCode,
				});
			this.dispatchTerminal('terminal.idle', sessionId);
		}
	}

	private observeAgents(
		entries: Readonly<Record<string, AgentStatusEntry>>,
	): void {
		const seen = new Set<string>();
		for (const entry of Object.values(entries)) {
			// Subagents have no terminal of their own; their root reports for them.
			if (entry.kind !== 'root') continue;
			const sessionId =
				entry.terminalSessionId ?? entry.activationTerminalSessionId;
			if (sessionId === null) continue;
			const key = entry.entryId;
			seen.add(key);
			const previous = this.agentState.get(key);
			this.agentState.set(key, entry.state);
			if (previous === undefined || previous === entry.state) continue;
			const event = AGENT_EVENTS[entry.state];
			if (event === undefined || this.runTerminals.has(sessionId)) continue;
			this.dispatchTerminal(event, sessionId, {
				agentProvider: entry.harness || entry.provider,
				agentState: entry.state,
				...(entry.state === 'done' && entry.completionOutcome !== undefined
					? { agentOutcome: entry.completionOutcome }
					: {}),
			});
		}
		for (const key of [...this.agentState.keys()])
			if (!seen.has(key)) this.agentState.delete(key);
	}

	private observeJournal(name: string, payload: unknown): void {
		if (name !== PROJECT_OPENED_EVENT && name !== PROJECT_CLOSED_EVENT) return;
		if (typeof payload !== 'object' || payload === null) return;
		const record = payload as Record<string, unknown>;
		if (
			typeof record.projectId !== 'string' ||
			(record.serverId !== undefined &&
				record.serverId !== this.options.serverId)
		)
			return;
		this.dispatch({
			event:
				name === PROJECT_OPENED_EVENT ? 'project.opened' : 'project.closed',
			subject: {
				kind: 'project',
				projectId: record.projectId,
				...(typeof record.name === 'string' ? { title: record.name } : {}),
			},
		});
	}

	private dispatchTerminal(
		event: TriggerEventKind,
		sessionId: string,
		context?: TriggerEventContext,
	): void {
		if (!this.hasListeners(event)) return;
		const terminal = this.options.describeTerminal(sessionId);
		if (terminal === undefined) return;
		this.dispatch({
			event,
			subject: {
				kind: 'terminal',
				serverId: this.options.serverId,
				projectId: terminal.projectId,
				sessionId,
				...(terminal.sessionCreatedAt === undefined
					? {}
					: { sessionCreatedAt: terminal.sessionCreatedAt }),
				...(terminal.title === undefined ? {} : { title: terminal.title }),
				...(terminal.projectTitle === undefined
					? {}
					: { projectTitle: terminal.projectTitle }),
			},
			...(context === undefined ? {} : { context }),
		});
	}

	/** Registers an independent consumer without adding upstream subscriptions. */
	registerSource(id: string, consumer: EventConsumer): () => void {
		if (this.stopped) throw new Error('Event fan-out is stopped');
		if (this.consumers.has(id))
			throw new Error(`Event source already registered: ${id}`);
		this.consumers.set(id, consumer);
		return () => {
			if (this.consumers.get(id) === consumer) this.consumers.delete(id);
		};
	}

	private hasListeners(event: TriggerEventKind): boolean {
		for (const consumer of this.consumers.values()) {
			try {
				if (consumer.accepts(event)) return true;
			} catch (error) {
				this.report(error);
			}
		}
		return false;
	}

	private dispatch(trigger: TriggerEvent): void {
		if (!this.live) return;
		const firedAt = this.now();
		for (const [id, consumer] of [...this.consumers]) {
			if (!this.live || this.consumers.get(id) !== consumer) continue;
			this.guard(() => {
				if (consumer.accepts(trigger.event))
					void Promise.resolve(consumer.onEvent(trigger, firedAt)).catch(
						(error: unknown) => this.report(error),
					);
			});
		}
	}
	private guard(operation: () => void): void {
		try {
			operation();
		} catch (error) {
			this.report(error);
		}
	}

	private report(error: unknown): void {
		try {
			this.options.onError?.(error);
		} catch {
			// A failing reporter never stops the triggers.
		}
	}
}
