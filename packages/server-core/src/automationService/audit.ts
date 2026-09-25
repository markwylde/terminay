import type { AutomationAuditRecord } from './protocol.js';
import type { AutomationRunOutcome, AutomationSkipReason } from './types.js';

/** The server-internal principal every automation run executes under. It is
 * never a connected client, so a run never depends on or impersonates one. */
export const AUTOMATION_PRINCIPAL = Object.freeze({
	clientId: 'system:automation',
	connectionId: 'system:automation',
});

export interface AutomationAuditActor {
	readonly clientId: string;
	readonly connectionId: string;
}

/** One audit trail entry. Metadata only: never a command line, text, cwd,
 * field value, subject title, output, or secret. */
export interface AutomationAuditEntry {
	readonly occurredAt: number;
	readonly serverId: string;
	readonly type: 'definition' | 'run';
	readonly operation: string;
	/** `client` for a definition change or request by an editing actor;
	 * `automation` for work a run performs under the automation principal. */
	readonly principal: 'client' | 'automation';
	readonly actor: AutomationAuditActor;
	/** For a user-started run, the client that asked for it. */
	readonly requestedBy?: AutomationAuditActor;
	readonly automationId?: string;
	readonly runId?: string;
	readonly revision?: number;
	readonly outcome?: AutomationRunOutcome;
	readonly skipReason?: AutomationSkipReason;
}

export interface AutomationAuditLogOptions {
	readonly serverId: string;
	readonly now?: () => number;
	readonly maxEntries?: number;
	/** Durable sink; receives the same metadata-only entry. Failures are
	 * swallowed so auditing can never stop a run or an edit. */
	readonly sink?: (entry: AutomationAuditEntry) => void;
}

const DEFAULT_MAX_ENTRIES = 1_000;

/** Bounded, server-owned audit trail for automation definition changes and
 * runs, mirroring the remote lifecycle's `RemoteAuditLog`. */
export class AutomationAuditLog {
	private readonly entries: AutomationAuditEntry[] = [];
	private readonly now: () => number;
	private readonly maxEntries: number;
	private lastOccurredAt = 0;

	constructor(private readonly options: AutomationAuditLogOptions) {
		this.now = options.now ?? (() => Date.now());
		const max = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
		if (!Number.isSafeInteger(max) || max <= 0)
			throw new RangeError('automation audit maxEntries is invalid');
		this.maxEntries = max;
	}

	record(
		entry: Omit<AutomationAuditEntry, 'occurredAt' | 'serverId'>,
	): AutomationAuditEntry {
		const candidate = this.now();
		if (Number.isSafeInteger(candidate) && candidate >= 0)
			this.lastOccurredAt = Math.max(this.lastOccurredAt, candidate);
		const normalized: AutomationAuditEntry = Object.freeze({
			occurredAt: this.lastOccurredAt,
			serverId: this.options.serverId,
			type: entry.type,
			operation: entry.operation.slice(0, 128),
			principal: entry.principal,
			actor: Object.freeze({ ...entry.actor }),
			...(entry.requestedBy === undefined
				? {}
				: { requestedBy: Object.freeze({ ...entry.requestedBy }) }),
			...(entry.automationId === undefined
				? {}
				: { automationId: entry.automationId }),
			...(entry.runId === undefined ? {} : { runId: entry.runId }),
			...(entry.revision === undefined ? {} : { revision: entry.revision }),
			...(entry.outcome === undefined ? {} : { outcome: entry.outcome }),
			...(entry.skipReason === undefined
				? {}
				: { skipReason: entry.skipReason }),
		});
		this.entries.push(normalized);
		if (this.entries.length > this.maxEntries)
			this.entries.splice(0, this.entries.length - this.maxEntries);
		try {
			this.options.sink?.(normalized);
		} catch {
			/* Audit persistence never takes down an edit or a run. */
		}
		return normalized;
	}

	/** Adapter for `createAutomationOperationRegistry({ onAudit })`: records
	 * definition changes and run/stop requests under the editing actor. */
	recordRequest(record: AutomationAuditRecord): AutomationAuditEntry {
		return this.record({
			type: record.type,
			operation: record.operation,
			principal: 'client',
			actor: record.actor,
			...(record.automationId === undefined
				? {}
				: { automationId: record.automationId }),
			...(record.type === 'run' ? { runId: record.runId } : {}),
			...(record.type === 'definition' ? { revision: record.revision } : {}),
		});
	}

	/** Newest first. */
	list(limit = this.maxEntries): readonly AutomationAuditEntry[] {
		if (!Number.isSafeInteger(limit) || limit <= 0)
			throw new RangeError('audit list limit is invalid');
		return Object.freeze(this.entries.slice(-limit).reverse());
	}

	get size(): number {
		return this.entries.length;
	}
}
