import type { TerminalActivityState } from './components/TerminalTab';

export const TERMINAL_ACTIVITY_RECENT_MS = 1000;
export const TERMINAL_ACTIVITY_AMBER_DELAY_MS = 0;
export const TERMINAL_ACTIVITY_TAB_SWITCH_SUPPRESSION_MS = 1000;

type TerminalActivityTimings = {
	amberDelayMs: number;
	greenDelayMs: number;
	tabSwitchSuppressionMs: number;
};

type TerminalActivityRecord = {
	lastActivityAt?: number;
	lastUserInputAt?: number;
	needsAcknowledgement: boolean;
	suppressActivityUntil?: number;
};

export type TerminalActivityEvaluation = {
	nextDeadline: number | null;
	state: TerminalActivityState;
};

export class TerminalActivityStore {
	private readonly records = new Map<string, TerminalActivityRecord>();
	private timings: TerminalActivityTimings;

	constructor(timings?: Partial<TerminalActivityTimings>) {
		this.timings = this.normalizeTimings(timings);
	}

	configure(timings: Partial<TerminalActivityTimings>) {
		this.timings = this.normalizeTimings(timings);
	}

	clear() {
		this.records.clear();
	}

	deleteSession(sessionId: string) {
		this.records.delete(sessionId);
	}

	evaluate(sessionId: string, now = Date.now()): TerminalActivityEvaluation {
		return this.evaluateRecord(this.getRecord(sessionId), now);
	}

	markViewed(sessionId: string, now = Date.now()): TerminalActivityEvaluation {
		const record = this.getRecord(sessionId);
		record.needsAcknowledgement = false;
		return this.evaluateRecord(record, now);
	}

	recordInitialSuppression(
		sessionId: string,
		now = Date.now(),
	): TerminalActivityEvaluation {
		const record = this.getRecord(sessionId);
		record.lastUserInputAt = now;
		record.needsAcknowledgement = false;
		record.suppressActivityUntil = now + this.timings.greenDelayMs;
		return this.evaluateRecord(record, now);
	}

	suppressTerminalActivity(
		sessionId: string,
		now = Date.now(),
	): TerminalActivityEvaluation {
		const record = this.getRecord(sessionId);
		record.suppressActivityUntil = Math.max(
			record.suppressActivityUntil ?? 0,
			now + this.timings.tabSwitchSuppressionMs,
		);
		return this.evaluateRecord(record, now);
	}

	recordTerminalActivity(
		sessionId: string,
		now = Date.now(),
	): TerminalActivityEvaluation {
		const record = this.getRecord(sessionId);

		if (
			record.suppressActivityUntil !== undefined &&
			now < record.suppressActivityUntil
		) {
			return this.evaluateRecord(record, now);
		}

		if (record.suppressActivityUntil !== undefined) {
			record.suppressActivityUntil = undefined;
		}

		record.lastActivityAt = now;

		if (this.hasRecentUserInput(record, now)) {
			record.needsAcknowledgement = false;
			return this.evaluateRecord(record, now);
		}

		record.needsAcknowledgement = true;
		return this.evaluateRecord(record, now);
	}

	recordUserInput(sessionId: string, now = Date.now()): TerminalActivityEvaluation {
		const record = this.getRecord(sessionId);
		record.lastUserInputAt = now;
		record.needsAcknowledgement = false;
		return this.evaluateRecord(record, now);
	}

	private evaluateRecord(
		record: TerminalActivityRecord,
		now: number,
	): TerminalActivityEvaluation {
		if (!record.needsAcknowledgement || record.lastActivityAt === undefined) {
			return { nextDeadline: null, state: 'viewed' };
		}

		const amberAt = record.lastActivityAt + this.timings.amberDelayMs;
		const greenAt =
			record.lastActivityAt +
			Math.max(this.timings.amberDelayMs, this.timings.greenDelayMs);

		if (now < amberAt) {
			return { nextDeadline: amberAt, state: 'viewed' };
		}

		const state: TerminalActivityState = now < greenAt ? 'recent' : 'unviewed';
		const nextDeadline = state === 'recent' ? greenAt : null;

		return { nextDeadline, state };
	}

	private getRecord(sessionId: string): TerminalActivityRecord {
		let record = this.records.get(sessionId);
		if (!record) {
			record = { needsAcknowledgement: false };
			this.records.set(sessionId, record);
		}
		return record;
	}

	private hasRecentUserInput(record: TerminalActivityRecord, now: number): boolean {
		return (
			record.lastUserInputAt !== undefined &&
			now - record.lastUserInputAt < this.timings.greenDelayMs
		);
	}

	private normalizeTimings(
		timings: Partial<TerminalActivityTimings> = {},
	): TerminalActivityTimings {
		return {
			amberDelayMs: this.normalizeMs(
				timings.amberDelayMs,
				TERMINAL_ACTIVITY_AMBER_DELAY_MS,
			),
			greenDelayMs: this.normalizeMs(
				timings.greenDelayMs,
				TERMINAL_ACTIVITY_RECENT_MS,
			),
			tabSwitchSuppressionMs: this.normalizeMs(
				timings.tabSwitchSuppressionMs,
				TERMINAL_ACTIVITY_TAB_SWITCH_SUPPRESSION_MS,
			),
		};
	}

	private normalizeMs(value: number | undefined, fallback: number): number {
		return typeof value === 'number' && Number.isFinite(value)
			? Math.max(0, value)
			: fallback;
	}
}
