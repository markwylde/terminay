import type { TerminalActivityState } from './components/TerminalTab';

export const TERMINAL_ACTIVITY_RECENT_MS = 1000;

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

	constructor(private readonly recentMs = TERMINAL_ACTIVITY_RECENT_MS) {}

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
		record.suppressActivityUntil = now + this.recentMs;
		return this.evaluateRecord(record, now);
	}

	recordTerminalActivity(
		sessionId: string,
		now = Date.now(),
	): TerminalActivityEvaluation {
		const record = this.getRecord(sessionId);
		record.lastActivityAt = now;

		if (
			record.suppressActivityUntil !== undefined &&
			now < record.suppressActivityUntil
		) {
			record.needsAcknowledgement = false;
			return this.evaluateRecord(record, now);
		}

		if (record.suppressActivityUntil !== undefined) {
			record.suppressActivityUntil = undefined;
		}

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
		const hasRecentActivity =
			record.lastActivityAt !== undefined &&
			now - record.lastActivityAt < this.recentMs;
		const state: TerminalActivityState =
			record.needsAcknowledgement && hasRecentActivity
				? 'recent'
				: record.needsAcknowledgement
					? 'unviewed'
					: 'viewed';
		const nextDeadline =
			state === 'recent' && record.lastActivityAt !== undefined
				? record.lastActivityAt + this.recentMs
				: null;

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
			now - record.lastUserInputAt < this.recentMs
		);
	}
}
