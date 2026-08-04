import type { SemanticActivity } from './types/terminalSignals';
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
	// Signal-driven state (only consulted when signal detection is enabled).
	hasSignal: boolean;
	claimed: boolean;
	signalWorking: boolean;
	attentionPending: boolean;
};

export type TerminalActivityEvaluation = {
	nextDeadline: number | null;
	state: TerminalActivityState;
};

export class TerminalActivityStore {
	private readonly records = new Map<string, TerminalActivityRecord>();
	private timings: TerminalActivityTimings;
	private signalDetectionEnabled = true;

	constructor(timings?: Partial<TerminalActivityTimings>) {
		this.timings = this.normalizeTimings(timings);
	}

	configure(
		timings: Partial<TerminalActivityTimings>,
		options?: { signalDetectionEnabled?: boolean },
	) {
		this.timings = this.normalizeTimings(timings);
		if (options && typeof options.signalDetectionEnabled === 'boolean') {
			this.signalDetectionEnabled = options.signalDetectionEnabled;
		}
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
		record.attentionPending = false;
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

		// A claimed session is driven entirely by interpreted signals; raw output
		// (e.g. an agent's spinner / tips-bar repaints) must not move its state.
		if (this.signalDetectionEnabled && record.hasSignal && record.claimed) {
			return this.evaluateRecord(record, now);
		}

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

	/**
	 * Consume an interpreted activity snapshot from the pty host. Claimed
	 * sessions are driven entirely by these snapshots; unclaimed sessions blend
	 * the host's foreground opinion with the raw-output timer.
	 */
	recordActivitySignal(
		sessionId: string,
		activity: SemanticActivity,
		now = Date.now(),
		options?: { focused?: boolean },
	): TerminalActivityEvaluation {
		const record = this.getRecord(sessionId);
		record.hasSignal = true;
		record.claimed = activity.claimed;

		const wasWorking = record.signalWorking;
		record.signalWorking = activity.status === 'working';

		const recentInput = this.hasRecentUserInput(record, now);

		// A working → idle transition means a unit of work finished; surface the
		// finished (green) indicator unless the user is actively interacting.
		if (wasWorking && activity.status === 'idle' && !recentInput) {
			record.needsAcknowledgement = true;
		}

		// Attention never fires for the tab the user is already looking at;
		// viewing it is acknowledgement.
		if (options?.focused) {
			record.attentionPending = false;
		} else if (activity.attention && !recentInput) {
			record.attentionPending = true;
		}

		return this.evaluateRecord(record, now);
	}

	recordUserInput(sessionId: string, now = Date.now()): TerminalActivityEvaluation {
		const record = this.getRecord(sessionId);
		record.lastUserInputAt = now;
		record.needsAcknowledgement = false;
		record.attentionPending = false;
		return this.evaluateRecord(record, now);
	}

	private evaluateRecord(
		record: TerminalActivityRecord,
		now: number,
	): TerminalActivityEvaluation {
		const signalsActive = this.signalDetectionEnabled && record.hasSignal;

		// Attention overrides everything: the session is asking for the user.
		if (signalsActive && record.attentionPending) {
			return { nextDeadline: null, state: 'attention' };
		}

		// Claimed sessions trust the host's status exclusively; the raw-output
		// heuristic is ignored entirely for them.
		if (signalsActive && record.claimed) {
			if (record.signalWorking) {
				return { nextDeadline: null, state: 'recent' };
			}
			return {
				nextDeadline: null,
				state: record.needsAcknowledgement ? 'unviewed' : 'viewed',
			};
		}

		const outputEvaluation = this.evaluateOutputRecord(record, now);

		// Unclaimed sessions: the host's foreground "working" opinion can promote
		// an otherwise-quiet tab to active (e.g. a silent `sleep 30`).
		if (signalsActive && record.signalWorking && outputEvaluation.state === 'viewed') {
			return { nextDeadline: null, state: 'recent' };
		}

		return outputEvaluation;
	}

	private evaluateOutputRecord(
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
			record = {
				needsAcknowledgement: false,
				hasSignal: false,
				claimed: false,
				signalWorking: false,
				attentionPending: false,
			};
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
