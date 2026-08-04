import type {
	AgentEventCursor,
	AgentLifecycleEvent,
	AgentProvider,
	AgentState,
	AgentStatusEntry,
	AgentStatusListener,
	AgentStatusSnapshot,
	AgentToolStatus,
	RootAgentStatusEntry,
	SubagentStatusEntry,
} from './types/agentStatus';

const ATTENTION_STATES: ReadonlySet<AgentState> = new Set([
	'waiting',
	'blocked',
	'done',
]);

export const EMPTY_AGENT_STATUS_SNAPSHOT: AgentStatusSnapshot = Object.freeze({
	revision: 0,
	entries: Object.freeze({}),
	eventCursors: Object.freeze({}),
});

export function createEmptyAgentStatusSnapshot(): AgentStatusSnapshot {
	return EMPTY_AGENT_STATUS_SNAPSHOT;
}

function encodeIdPart(value: string): string {
	return encodeURIComponent(value);
}

export function makeAgentStatusEntryId(
	activationTerminalSessionId: string,
	sessionId: string,
	agentId = sessionId,
): string {
	return [
		encodeIdPart(activationTerminalSessionId),
		encodeIdPart(sessionId),
		encodeIdPart(agentId),
	].join(':');
}

export function makeAgentStatusStreamId(
	provider: AgentProvider,
	activationTerminalSessionId: string,
	sessionId: string,
): string {
	return [
		encodeIdPart(provider),
		encodeIdPart(activationTerminalSessionId),
		encodeIdPart(sessionId),
	].join(':');
}

function compareEntries(
	left: AgentStatusEntry,
	right: AgentStatusEntry,
): number {
	return (
		left.activationTerminalSessionId.localeCompare(
			right.activationTerminalSessionId,
		) ||
		left.sessionId.localeCompare(right.sessionId) ||
		(left.kind === right.kind ? 0 : left.kind === 'root' ? -1 : 1) ||
		left.agentId.localeCompare(right.agentId)
	);
}

function rootEntryFor(event: AgentLifecycleEvent): RootAgentStatusEntry {
	return {
		entryId: makeAgentStatusEntryId(
			event.activationTerminalSessionId,
			event.sessionId,
			event.sessionId,
		),
		kind: 'root',
		provider: event.provider,
		agentId: event.sessionId,
		sessionId: event.sessionId,
		activationTerminalSessionId: event.activationTerminalSessionId,
		terminalSessionId: event.activationTerminalSessionId,
		inProcess: false,
		state: 'idle',
		stateStartedAt: event.occurredAt,
		updatedAt: event.occurredAt,
		lastEventKind: event.kind,
		lastEventSequence: event.sequence,
		active: true,
		activeTools: [],
		unread: false,
	};
}

function subagentEntryFor(
	event: Extract<
		AgentLifecycleEvent,
		{ kind: 'subagent.started' | 'subagent.stopped' }
	>,
): SubagentStatusEntry {
	const parentAgentId =
		event.kind === 'subagent.started'
			? (event.parentAgentId ?? event.sessionId)
			: event.sessionId;
	return {
		entryId: makeAgentStatusEntryId(
			event.activationTerminalSessionId,
			event.sessionId,
			event.subagentId,
		),
		kind: 'subagent',
		provider: event.provider,
		agentId: event.subagentId,
		sessionId: event.sessionId,
		activationTerminalSessionId: event.activationTerminalSessionId,
		terminalSessionId: null,
		inProcess: true,
		parentAgentId,
		parentEntryId: makeAgentStatusEntryId(
			event.activationTerminalSessionId,
			event.sessionId,
			parentAgentId,
		),
		state: 'idle',
		stateStartedAt: event.occurredAt,
		updatedAt: event.occurredAt,
		lastEventKind: event.kind,
		lastEventSequence: event.sequence,
		active: false,
		activeTools: [],
		unread: false,
	};
}

function withState(
	entry: AgentStatusEntry,
	state: AgentState,
	event: AgentLifecycleEvent,
	changes: Partial<AgentStatusEntry> = {},
): AgentStatusEntry {
	return {
		...entry,
		...changes,
		promptText: event.promptText ?? entry.promptText,
		model: event.model ?? entry.model,
		state,
		stateStartedAt:
			state === entry.state ? entry.stateStartedAt : event.occurredAt,
		updatedAt: event.occurredAt,
		lastEventKind: event.kind,
		lastEventSequence: event.sequence,
		unread: entry.unread || ATTENTION_STATES.has(state),
	} as AgentStatusEntry;
}

function addTool(
	tools: readonly AgentToolStatus[],
	tool: AgentToolStatus,
): readonly AgentToolStatus[] {
	return [...tools.filter((candidate) => candidate.id !== tool.id), tool].sort(
		(left, right) => left.id.localeCompare(right.id),
	);
}

function targetAgentId(event: AgentLifecycleEvent): string {
	if ('subagentId' in event) {
		return event.subagentId;
	}
	if ('agentId' in event && event.agentId) {
		return event.agentId;
	}
	return event.sessionId;
}

function getOrCreateTargetEntry(
	snapshot: AgentStatusSnapshot,
	event: AgentLifecycleEvent,
): AgentStatusEntry | undefined {
	const agentId = targetAgentId(event);
	const entryId = makeAgentStatusEntryId(
		event.activationTerminalSessionId,
		event.sessionId,
		agentId,
	);
	const existing = snapshot.entries[entryId];
	if (existing) {
		return existing;
	}
	if (event.kind === 'subagent.started' || event.kind === 'subagent.stopped') {
		return subagentEntryFor(event);
	}
	// A targeted in-process agent must first be introduced by a subagent event;
	// otherwise treating it as a root would lose its parent/execution identity.
	if (agentId !== event.sessionId) {
		return undefined;
	}
	return rootEntryFor(event);
}

function applyLifecycleEvent(
	entry: AgentStatusEntry,
	event: AgentLifecycleEvent,
): AgentStatusEntry {
	switch (event.kind) {
		case 'session.started':
			return withState(entry, 'idle', event, {
				active: true,
				activeTools: [],
				displayName: event.displayName ?? entry.displayName,
				waitingReason: undefined,
				completionOutcome: undefined,
				summary: undefined,
				exitCode: undefined,
				exitSignal: undefined,
			});
		case 'session.stopped':
			return withState(entry, 'idle', event, {
				active: false,
				activeTools: [],
				waitingReason: undefined,
				summary: event.reason ?? entry.summary,
			});
		case 'turn.started':
			return withState(entry, 'working', event, {
				active: true,
				activeTools: [],
				currentTurnId: event.turnId,
				waitingReason: undefined,
				completionOutcome: undefined,
				summary: undefined,
			});
		case 'tool.started':
			return withState(entry, 'working', event, {
				active: true,
				activeTools: addTool(entry.activeTools, {
					...event.tool,
					startedAt: event.occurredAt,
				}),
				waitingReason: undefined,
			});
		case 'tool.finished':
			return withState(entry, 'working', event, {
				active: true,
				activeTools: entry.activeTools.filter(
					(tool) => tool.id !== event.toolId,
				),
				waitingReason: undefined,
			});
		case 'wait.started':
			return withState(entry, event.state, event, {
				active: true,
				waitingReason: event.reason,
			});
		case 'wait.finished':
			return withState(entry, 'working', event, {
				active: true,
				waitingReason: undefined,
			});
		case 'agent.done':
			return withState(entry, 'done', event, {
				active: true,
				activeTools: [],
				waitingReason: undefined,
				completionOutcome: event.outcome,
				summary: event.summary,
			});
		case 'subagent.started':
			return withState(entry, 'working', event, {
				active: true,
				activeTools: [],
				displayName: event.displayName ?? entry.displayName,
				waitingReason: undefined,
				completionOutcome: undefined,
				summary: undefined,
			});
		case 'subagent.stopped':
			return withState(entry, 'done', event, {
				active: false,
				activeTools: [],
				waitingReason: undefined,
				completionOutcome: event.outcome,
				summary: event.summary,
			});
		case 'agent.exited':
			return withState(entry, 'done', event, {
				active: false,
				activeTools: [],
				waitingReason: undefined,
				exitCode: event.exitCode,
				exitSignal: event.signal,
				completionOutcome:
					event.exitCode === undefined || event.exitCode === 0
						? entry.completionOutcome
						: 'error',
			});
	}
}

function isOrderedAfter(
	cursor: AgentEventCursor | undefined,
	event: AgentLifecycleEvent,
): boolean {
	if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) {
		return false;
	}
	if (!Number.isFinite(event.occurredAt)) {
		return false;
	}
	if (!cursor) {
		return true;
	}
	return (
		event.sequence > cursor.sequence && event.occurredAt >= cursor.occurredAt
	);
}

/**
 * Pure reducer. Rejected events return the exact input snapshot reference.
 */
export function reduceAgentStatusSnapshot(
	snapshot: AgentStatusSnapshot,
	event: AgentLifecycleEvent,
): AgentStatusSnapshot {
	const streamId = makeAgentStatusStreamId(
		event.provider,
		event.activationTerminalSessionId,
		event.sessionId,
	);
	if (!isOrderedAfter(snapshot.eventCursors[streamId], event)) {
		return snapshot;
	}

	const entry = getOrCreateTargetEntry(snapshot, event);
	if (!entry) {
		return snapshot;
	}
	const nextEntry = applyLifecycleEvent(entry, event);
	return {
		revision: snapshot.revision + 1,
		entries: {
			...snapshot.entries,
			[nextEntry.entryId]: nextEntry,
		},
		eventCursors: {
			...snapshot.eventCursors,
			[streamId]: {
				sequence: event.sequence,
				occurredAt: event.occurredAt,
			},
		},
	};
}

export function selectAgentStatusEntries(
	snapshot: AgentStatusSnapshot,
): readonly AgentStatusEntry[] {
	return Object.values(snapshot.entries).sort(compareEntries);
}

export function selectRootAgentStatuses(
	snapshot: AgentStatusSnapshot,
): readonly RootAgentStatusEntry[] {
	return selectAgentStatusEntries(snapshot).filter(
		(entry): entry is RootAgentStatusEntry => entry.kind === 'root',
	);
}

/**
 * Select the current root for a terminal. Active roots win over historical
 * roots, then the most recently updated root wins with a stable id tie-break.
 */
export function selectRootAgentStatusForTerminal(
	snapshot: AgentStatusSnapshot,
	activationTerminalSessionId: string,
): RootAgentStatusEntry | undefined {
	return selectRootAgentStatuses(snapshot)
		.filter(
			(entry) =>
				entry.activationTerminalSessionId === activationTerminalSessionId,
		)
		.sort(
			(left, right) =>
				Number(right.active) - Number(left.active) ||
				right.updatedAt - left.updatedAt ||
				right.lastEventSequence - left.lastEventSequence ||
				left.entryId.localeCompare(right.entryId),
		)[0];
}

export function selectSubagentStatuses(
	snapshot: AgentStatusSnapshot,
	parentAgentId?: string,
): readonly SubagentStatusEntry[] {
	return selectAgentStatusEntries(snapshot).filter(
		(entry): entry is SubagentStatusEntry =>
			entry.kind === 'subagent' &&
			(parentAgentId === undefined || entry.parentAgentId === parentAgentId),
	);
}

export function selectAgentStatusEntry(
	snapshot: AgentStatusSnapshot,
	entryId: string,
): AgentStatusEntry | undefined {
	return snapshot.entries[entryId];
}

export function selectAgentStatusByAgentId(
	snapshot: AgentStatusSnapshot,
	activationTerminalSessionId: string,
	sessionId: string,
	agentId = sessionId,
): AgentStatusEntry | undefined {
	return selectAgentStatusEntry(
		snapshot,
		makeAgentStatusEntryId(activationTerminalSessionId, sessionId, agentId),
	);
}

export function selectAgentStatusesForTerminal(
	snapshot: AgentStatusSnapshot,
	activationTerminalSessionId: string,
): readonly AgentStatusEntry[] {
	return selectAgentStatusEntries(snapshot).filter(
		(entry) =>
			entry.activationTerminalSessionId === activationTerminalSessionId,
	);
}

function isEndedAgentStatusEntry(entry: AgentStatusEntry): boolean {
	return (
		!entry.active &&
		(entry.lastEventKind === 'session.stopped' ||
			entry.lastEventKind === 'agent.exited' ||
			entry.lastEventKind === 'subagent.stopped')
	);
}

/** Select live roster entries while retaining completed history in the snapshot. */
export function selectLiveAgentStatusesForTerminal(
	snapshot: AgentStatusSnapshot,
	activationTerminalSessionId: string,
): readonly AgentStatusEntry[] {
	const entries = selectAgentStatusesForTerminal(
		snapshot,
		activationTerminalSessionId,
	);
	const endedRootEntryIds = new Set(
		entries
			.filter(
				(entry) =>
					entry.kind === 'root' && isEndedAgentStatusEntry(entry),
			)
			.map((entry) => entry.entryId),
	);

	return entries.filter(
		(entry) =>
			!isEndedAgentStatusEntry(entry) &&
			(entry.kind === 'root' || !endedRootEntryIds.has(entry.parentEntryId)),
	);
}

export function selectAgentStatusesByState(
	snapshot: AgentStatusSnapshot,
	state: AgentState,
): readonly AgentStatusEntry[] {
	return selectAgentStatusEntries(snapshot).filter(
		(entry) => entry.state === state,
	);
}

export function selectAgentStatusesByProvider(
	snapshot: AgentStatusSnapshot,
	provider: AgentProvider,
): readonly AgentStatusEntry[] {
	return selectAgentStatusEntries(snapshot).filter(
		(entry) => entry.provider === provider,
	);
}

export function selectUnreadAgentStatuses(
	snapshot: AgentStatusSnapshot,
): readonly AgentStatusEntry[] {
	return selectAgentStatusEntries(snapshot).filter((entry) => entry.unread);
}

export class AgentStatusStore {
	private snapshot: AgentStatusSnapshot;
	private readonly listeners = new Set<AgentStatusListener>();

	constructor(
		initialSnapshot: AgentStatusSnapshot = createEmptyAgentStatusSnapshot(),
	) {
		this.snapshot = initialSnapshot;
	}

	getSnapshot = (): AgentStatusSnapshot => this.snapshot;

	subscribe = (listener: AgentStatusListener): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	dispatch(event: AgentLifecycleEvent): boolean {
		const nextSnapshot = reduceAgentStatusSnapshot(this.snapshot, event);
		if (nextSnapshot === this.snapshot) {
			return false;
		}
		this.publish(nextSnapshot);
		return true;
	}

	markAcknowledged(entryId: string, acknowledgedAt = Date.now()): boolean {
		const entry = this.snapshot.entries[entryId];
		if (!entry || !Number.isFinite(acknowledgedAt)) {
			return false;
		}
		const nextAcknowledgedAt = Math.max(
			entry.acknowledgedAt ?? -Infinity,
			acknowledgedAt,
		);
		if (!entry.unread && nextAcknowledgedAt === entry.acknowledgedAt) {
			return false;
		}
		this.publish({
			...this.snapshot,
			revision: this.snapshot.revision + 1,
			entries: {
				...this.snapshot.entries,
				[entryId]: {
					...entry,
					unread: false,
					acknowledgedAt: nextAcknowledgedAt,
				},
			},
		});
		return true;
	}

	markTerminalAcknowledged(
		activationTerminalSessionId: string,
		acknowledgedAt = Date.now(),
	): number {
		if (!Number.isFinite(acknowledgedAt)) {
			return 0;
		}
		const entries = selectAgentStatusesForTerminal(
			this.snapshot,
			activationTerminalSessionId,
		).filter((entry) => entry.unread);
		if (entries.length === 0) {
			return 0;
		}
		const nextEntries = { ...this.snapshot.entries };
		for (const entry of entries) {
			nextEntries[entry.entryId] = {
				...entry,
				unread: false,
				acknowledgedAt: Math.max(
					entry.acknowledgedAt ?? -Infinity,
					acknowledgedAt,
				),
			};
		}
		this.publish({
			...this.snapshot,
			revision: this.snapshot.revision + 1,
			entries: nextEntries,
		});
		return entries.length;
	}

	clear(): boolean {
		if (
			Object.keys(this.snapshot.entries).length === 0 &&
			Object.keys(this.snapshot.eventCursors).length === 0
		) {
			return false;
		}
		this.publish({
			revision: this.snapshot.revision + 1,
			entries: {},
			eventCursors: {},
		});
		return true;
	}

	private publish(snapshot: AgentStatusSnapshot): void {
		this.snapshot = snapshot;
		for (const listener of [...this.listeners]) {
			listener(snapshot);
		}
	}
}

export function createAgentStatusStore(
	initialSnapshot?: AgentStatusSnapshot,
): AgentStatusStore {
	return new AgentStatusStore(initialSnapshot);
}

export const agentStatusStore = createAgentStatusStore();
