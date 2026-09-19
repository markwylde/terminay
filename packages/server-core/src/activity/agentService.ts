import { randomUUID } from 'node:crypto';
import {
	AgentStatusStore,
	selectAgentStatusEntry,
	selectAgentStatusesForTerminal,
} from './agentStore.js';
import type {
	AgentStatusEntry,
	AgentStatusListener,
	AgentStatusSnapshot,
	RootAgentStatusEntry,
} from './agentTypes.js';
import type {
	ActivitySessionIdentity,
	TerminalActivityService,
} from './service.js';

/** Options for the canonical, provider-neutral sidebar projection. */
export interface AgentStatusServiceOptions {
	readonly activity: TerminalActivityService;
	readonly now?: () => number;
	readonly store?: AgentStatusStore;
	readonly enabled?: boolean;
	/** Live process identity for Agents snapshots. Generated at construction
	 * when omitted; never persisted in user-data. */
	readonly processInstanceId?: string;
}

/** One live server-owned terminal and the PTY shell process it spawned. */
export interface AgentTerminal {
	readonly identity: ActivitySessionIdentity;
	readonly shellPid?: number;
}

/**
 * A terminal lifecycle edge. Session binding is re-evaluated only on these
 * edges, never on a timer.
 */
export type AgentTerminalEdge =
	| { readonly kind: 'started'; readonly terminal: AgentTerminal }
	| { readonly kind: 'exited'; readonly terminal: AgentTerminal }
	| {
			readonly kind: 'foreground';
			readonly terminal: AgentTerminal;
			readonly shellForeground: boolean;
	  };

/**
 * The canonical agent authority: live terminals, the reduced entry snapshot,
 * acknowledgement, and the agent status setting.
 *
 * Session detection lives in extensions and reaches this service only as
 * entries a session source bridge reduced from bounded snapshots. The service
 * reads no provider file and infers no agent state.
 */
export class AgentStatusService {
	private readonly activity: TerminalActivityService;
	private readonly now: () => number;
	private readonly store: AgentStatusStore;
	private readonly terminals = new Map<string, AgentTerminal>();
	private readonly terminalObservers = new Set<
		(edge: AgentTerminalEdge) => void
	>();
	private readonly activitySequences = new Map<string, number>();
	private started = false;
	private enabled: boolean;
	private readonly integrationObservers = new Set<
		(enabled: boolean) => void
	>();
	private readonly processInstanceId: string;
	private lastInnerSnapshot: AgentStatusSnapshot | undefined;
	private lastStampedSnapshot: AgentStatusSnapshot | undefined;

	constructor(options: AgentStatusServiceOptions) {
		this.activity = options.activity;
		this.now = options.now ?? Date.now;
		this.store = options.store ?? new AgentStatusStore();
		this.enabled = options.enabled ?? true;
		this.processInstanceId = options.processInstanceId ?? randomUUID();
	}

	get processId(): string {
		return this.processInstanceId;
	}
	getSnapshot(): AgentStatusSnapshot {
		return this.withProcessInstance(this.store.getSnapshot());
	}
	isSessionActive(identity: ActivitySessionIdentity): boolean {
		const current = this.terminals.get(identity.sessionId)?.identity;
		return (
			current !== undefined &&
			current.serverId === identity.serverId &&
			current.projectId === identity.projectId
		);
	}
	getSnapshotForProject(projectId: string | undefined): AgentStatusSnapshot {
		return this.withProcessInstance(
			this.filterSnapshotForProject(this.store.getSnapshot(), projectId),
		);
	}
	/** Entries the server stamped with `projectId`. A project claim never sees
	 * another project's sessions, bound or external. */
	filterSnapshotForProject(
		snapshot: AgentStatusSnapshot,
		projectId: string | undefined,
	): AgentStatusSnapshot {
		if (projectId === undefined) return snapshot;
		const entries = Object.fromEntries(
			Object.entries(snapshot.entries).filter(([, entry]) =>
				entry.projectIds.includes(projectId),
			),
		);
		return Object.freeze({ ...snapshot, entries: Object.freeze(entries) });
	}
	subscribe(listener: AgentStatusListener): () => void {
		return this.store.subscribe((snapshot) =>
			listener(this.withProcessInstance(snapshot)),
		);
	}
	get listening(): boolean {
		return this.started;
	}
	get serverId(): string {
		return this.activity.serverId;
	}
	get integrationEnabled(): boolean {
		return this.enabled;
	}

	async start(): Promise<void> {
		this.started = true;
	}
	async stop(): Promise<void> {
		this.terminals.clear();
		this.activitySequences.clear();
		this.store.clear();
		this.started = false;
	}

	/**
	 * Observe the agent status setting. Session sources must stop, not merely
	 * be ignored, when it is switched off, so their watches are released.
	 */
	observeIntegrationEnabled(
		listener: (enabled: boolean) => void,
	): () => void {
		if (typeof listener !== 'function')
			throw new TypeError('integration listener must be a function');
		this.integrationObservers.add(listener);
		return () => {
			this.integrationObservers.delete(listener);
		};
	}

	setIntegrationEnabled(enabled: boolean): boolean {
		if (typeof enabled !== 'boolean')
			throw new TypeError('agent integration enabled must be boolean');
		if (this.enabled === enabled) return false;
		this.enabled = enabled;
		if (!enabled) this.store.clear();
		for (const listener of [...this.integrationObservers]) {
			try {
				listener(enabled);
			} catch {
				/* an observer must not block the setting from applying */
			}
		}
		return true;
	}

	/** Terminals whose shell process a session can descend from. */
	liveTerminals(): readonly AgentTerminal[] {
		return [...this.terminals.values()];
	}
	terminal(sessionId: string): AgentTerminal | undefined {
		return this.terminals.get(sessionId);
	}
	observeTerminals(listener: (edge: AgentTerminalEdge) => void): () => void {
		this.terminalObservers.add(listener);
		return () => {
			this.terminalObservers.delete(listener);
		};
	}

	register(identity: ActivitySessionIdentity): void {
		if (!this.started) throw new Error('agent status service is not running');
		this.terminals.set(identity.sessionId, {
			identity: Object.freeze({ ...identity }),
		});
	}

	terminalStarted(identity: ActivitySessionIdentity, shellPid: number): void {
		this.assertActive(identity);
		if (!Number.isSafeInteger(shellPid) || shellPid <= 0) return;
		const terminal = Object.freeze({
			identity: this.terminals.get(identity.sessionId)!.identity,
			shellPid,
		});
		this.terminals.set(identity.sessionId, terminal);
		this.notifyTerminal({ kind: 'started', terminal });
	}

	terminalExited(identity: ActivitySessionIdentity): void {
		const terminal = this.terminals.get(identity.sessionId);
		if (terminal === undefined || !sameScope(terminal.identity, identity))
			return;
		this.terminals.delete(identity.sessionId);
		this.activitySequences.delete(identity.sessionId);
		this.notifyTerminal({ kind: 'exited', terminal });
	}

	abandonTerminalSession(identity: ActivitySessionIdentity): void {
		this.terminalExited(identity);
	}

	foregroundProcessChanged(
		identity: ActivitySessionIdentity,
		_processName: string,
		shellForeground: boolean,
	): void {
		const terminal = this.terminals.get(identity.sessionId);
		if (terminal === undefined || !sameScope(terminal.identity, identity))
			return;
		this.notifyTerminal({ kind: 'foreground', terminal, shellForeground });
	}

	/**
	 * Replace and remove entries in one revision. Bound roots whose state or
	 * binding changed drive their terminal's activity indicator; external
	 * entries never do.
	 */
	applyEntries(
		upserts: readonly AgentStatusEntry[],
		removals: readonly string[] = [],
	): boolean {
		if (!this.enabled) return false;
		const before = this.store.getSnapshot();
		if (!this.store.apply(upserts, removals)) return false;
		const after = this.store.getSnapshot();
		for (const entryId of new Set([
			...removals,
			...upserts.map((entry) => entry.entryId),
		])) {
			const previous = before.entries[entryId];
			const next = after.entries[entryId];
			if (previous?.kind !== 'root' && next?.kind !== 'root') continue;
			this.forwardActivity(
				previous as RootAgentStatusEntry | undefined,
				next as RootAgentStatusEntry | undefined,
			);
		}
		return true;
	}

	acknowledge(identity: ActivitySessionIdentity, entryId?: string): boolean {
		this.assertActive(identity);
		if (entryId === undefined) {
			const changed =
				this.store.markTerminalAcknowledged(identity.sessionId, this.now()) > 0;
			this.activity.acknowledge(identity);
			return changed;
		}
		const entry = selectAgentStatusEntry(this.store.getSnapshot(), entryId);
		if (!entry || entry.activationTerminalSessionId !== identity.sessionId)
			return false;
		const changed = this.store.markAcknowledged(entryId, this.now());
		if (changed) this.activity.acknowledge(identity);
		return changed;
	}

	/** Bound entries of one terminal. */
	entriesForTerminal(sessionId: string): readonly AgentStatusEntry[] {
		return selectAgentStatusesForTerminal(this.store.getSnapshot(), sessionId);
	}

	private forwardActivity(
		previous: RootAgentStatusEntry | undefined,
		next: RootAgentStatusEntry | undefined,
	): void {
		const previousTerminal = previous?.activationTerminalSessionId ?? null;
		const nextTerminal = next?.activationTerminalSessionId ?? null;
		if (previousTerminal !== null && previousTerminal !== nextTerminal)
			this.ingestActivity(previousTerminal, previous!, 'idle');
		if (
			nextTerminal !== null &&
			(previousTerminal !== nextTerminal || previous?.state !== next!.state)
		)
			this.ingestActivity(nextTerminal, next!, next!.state);
	}

	private ingestActivity(
		terminalSessionId: string,
		entry: RootAgentStatusEntry,
		state: AgentStatusEntry['state'],
	): void {
		const terminal = this.terminals.get(terminalSessionId);
		if (terminal === undefined) return;
		const sequence = (this.activitySequences.get(terminalSessionId) ?? 0) + 1;
		this.activitySequences.set(terminalSessionId, sequence);
		try {
			this.activity.ingestProvider(terminal.identity, {
				provider: entry.provider,
				state,
				sequence,
				agentId: entry.sessionId,
				source: `extension:${entry.provider}`,
			});
		} catch {
			/* a terminal leaving activity supervision cannot fail agent status */
		}
	}

	private notifyTerminal(edge: AgentTerminalEdge): void {
		for (const listener of [...this.terminalObservers]) {
			try {
				listener(edge);
			} catch {
				/* terminal lifecycle cannot be blocked by an observer */
			}
		}
	}

	private assertActive(identity: ActivitySessionIdentity): void {
		const current = this.terminals.get(identity.sessionId)?.identity;
		if (current === undefined || !sameScope(current, identity))
			throw new Error('agent session is not active for this project');
	}

	private withProcessInstance(
		snapshot: AgentStatusSnapshot,
	): AgentStatusSnapshot {
		if (
			snapshot === this.lastInnerSnapshot &&
			this.lastStampedSnapshot !== undefined
		)
			return this.lastStampedSnapshot;
		const stamped =
			snapshot.processInstanceId === this.processInstanceId
				? snapshot
				: Object.freeze({
						...snapshot,
						processInstanceId: this.processInstanceId,
					});
		this.lastInnerSnapshot = snapshot;
		this.lastStampedSnapshot = stamped;
		return stamped;
	}
}

function sameScope(
	left: ActivitySessionIdentity,
	right: ActivitySessionIdentity,
): boolean {
	return (
		left.serverId === right.serverId && left.projectId === right.projectId
	);
}
