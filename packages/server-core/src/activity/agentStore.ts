import type {
	AgentStatusEntry,
	AgentStatusListener,
	AgentStatusSnapshot,
} from './agentTypes.js';

/**
 * A wire-safe identity segment: every character outside `[A-Za-z0-9._-]` is
 * percent-encoded, so a source-supplied id can never break the `:`-joined
 * entry id or the client's id pattern.
 */
export function agentIdSegment(value: string): string {
	const encoded = Array.from(new TextEncoder().encode(value))
		.map((byte) => {
			const character = String.fromCharCode(byte);
			return /[A-Za-z0-9._-]/u.test(character) && byte < 0x80
				? character
				: `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
		})
		.join('');
	return /^[A-Za-z0-9]/u.test(encoded) ? encoded : `s${encoded}`;
}

export function makeAgentStatusEntryId(
	sourceId: string,
	sessionId: string,
	agentId?: string,
): string {
	return [sourceId, sessionId, ...(agentId === undefined ? [] : [agentId])]
		.map(agentIdSegment)
		.join(':');
}

export function createEmptyAgentStatusSnapshot(): AgentStatusSnapshot {
	return Object.freeze({ revision: 0, entries: Object.freeze({}) });
}

function compareEntries(
	left: AgentStatusEntry,
	right: AgentStatusEntry,
): number {
	return (
		left.provider.localeCompare(right.provider) ||
		left.sessionId.localeCompare(right.sessionId) ||
		(left.kind === right.kind ? 0 : left.kind === 'root' ? -1 : 1) ||
		left.agentId.localeCompare(right.agentId)
	);
}

export function selectAgentStatusEntries(
	snapshot: AgentStatusSnapshot,
): readonly AgentStatusEntry[] {
	return Object.values(snapshot.entries).sort(compareEntries);
}

export function selectAgentStatusesForTerminal(
	snapshot: AgentStatusSnapshot,
	terminalSessionId: string,
): readonly AgentStatusEntry[] {
	return selectAgentStatusEntries(snapshot).filter(
		(entry) => entry.activationTerminalSessionId === terminalSessionId,
	);
}

export function selectLiveAgentStatusesForTerminal(
	snapshot: AgentStatusSnapshot,
	terminalSessionId: string,
): readonly AgentStatusEntry[] {
	return selectAgentStatusesForTerminal(snapshot, terminalSessionId).filter(
		(entry) => entry.active,
	);
}

export function selectAgentStatusEntry(
	snapshot: AgentStatusSnapshot,
	entryId: string,
): AgentStatusEntry | undefined {
	return snapshot.entries[entryId];
}

/**
 * The reduced agent snapshot. Every change is one revision, so a batch of
 * session changes is never observed half applied.
 */
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
		return () => this.listeners.delete(listener);
	};

	/** Replace and remove entries in one revision. Returns false when nothing
	 * would change. */
	apply(
		upserts: readonly AgentStatusEntry[],
		removals: readonly string[] = [],
	): boolean {
		const entries: Record<string, AgentStatusEntry> = {
			...this.snapshot.entries,
		};
		let changed = false;
		for (const entryId of removals) {
			if (!(entryId in entries)) continue;
			delete entries[entryId];
			changed = true;
		}
		for (const entry of upserts) {
			const previous = entries[entry.entryId];
			if (previous !== undefined && sameEntry(previous, entry)) continue;
			entries[entry.entryId] = Object.freeze(entry);
			changed = true;
		}
		if (!changed) return false;
		this.publish(
			Object.freeze({
				revision: this.snapshot.revision + 1,
				entries: Object.freeze(entries),
			}),
		);
		return true;
	}

	markAcknowledged(entryId: string, acknowledgedAt = Date.now()): boolean {
		const entry = this.snapshot.entries[entryId];
		if (!entry || !Number.isFinite(acknowledgedAt)) return false;
		// Acknowledging an already-read entry is intentionally a no-op, so a
		// duplicate acknowledgement from another client creates no revision.
		if (!entry.unread) return false;
		return this.apply([acknowledged(entry, acknowledgedAt)]);
	}

	markTerminalAcknowledged(
		terminalSessionId: string,
		acknowledgedAt = Date.now(),
	): number {
		if (!Number.isFinite(acknowledgedAt)) return 0;
		const entries = selectAgentStatusesForTerminal(
			this.snapshot,
			terminalSessionId,
		).filter((entry) => entry.unread);
		if (entries.length === 0) return 0;
		this.apply(entries.map((entry) => acknowledged(entry, acknowledgedAt)));
		return entries.length;
	}

	clear(): boolean {
		if (Object.keys(this.snapshot.entries).length === 0) return false;
		this.publish(
			Object.freeze({
				revision: this.snapshot.revision + 1,
				entries: Object.freeze({}),
			}),
		);
		return true;
	}

	private publish(snapshot: AgentStatusSnapshot): void {
		this.snapshot = snapshot;
		for (const listener of [...this.listeners]) {
			try {
				listener(snapshot);
			} catch {
				/* observers cannot roll back server state */
			}
		}
	}
}

function acknowledged(
	entry: AgentStatusEntry,
	acknowledgedAt: number,
): AgentStatusEntry {
	return {
		...entry,
		unread: false,
		acknowledgedAt: Math.max(entry.acknowledgedAt ?? -Infinity, acknowledgedAt),
	};
}

function sameEntry(left: AgentStatusEntry, right: AgentStatusEntry): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
