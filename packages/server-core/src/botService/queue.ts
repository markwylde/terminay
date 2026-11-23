import { randomBytes } from 'node:crypto';
import { type BotSessionOrigin, botTriggerOrigin } from '@terminay/protocol';
import { BotError } from './store.js';
export interface BotQueuedTurn {
	readonly id: string;
	readonly botId: string;
	readonly sessionId: string;
	readonly origin: BotSessionOrigin;
	readonly prompt: string;
	readonly arrival: number;
	coordinationOnly?: boolean;
}
interface Lane {
	waiting: BotQueuedTurn[];
	active: Map<string, BotQueuedTurn>;
	stopped: boolean;
	failed: boolean;
	/** Consecutive finished executions whose cleanup failed, in finish order. */
	cleanupFailures: number;
	/** Sessions whose process-group cleanup is unconfirmed since the last confirmed one. */
	uncleaned: Set<string>;
	reservation?: { source: string; target: string };
}
/** How an execution ended its agent: `failed` means its process group was not confirmed gone. */
export type BotRunResult =
	| { readonly cleanup: 'ok' }
	| { readonly cleanup: 'failed'; readonly error: unknown };
export interface BotQueueFailure {
	readonly error: unknown;
	/** True when the failure was a cleanup failure counted toward the threshold. */
	readonly cleanup: boolean;
	/** True when this failure blocked the bot. */
	readonly blocked: boolean;
}
/** Consecutive cleanup failures that block a bot until reconciliation. */
export const BOT_CLEANUP_FAILURE_LIMIT = 3;
export interface BotQueueHooks {
	run(item: BotQueuedTurn): Promise<BotRunResult | undefined>;
	suspend(sessionId: string): Promise<void>;
	cancelled(item: BotQueuedTurn, reason: string): void;
	changed(botId: string, running: number, queued: number): void;
	failure(item: BotQueuedTurn, failure: BotQueueFailure): void | Promise<void>;
}
const isCheckIn = (item: BotQueuedTurn): boolean =>
	item.origin.kind === 'check-in';
/** Active executions holding an ordinary work slot. */
const workCount = (lane: Lane): number =>
	[...lane.active.values()].filter((i) => !i.coordinationOnly && !isCheckIn(i))
		.length;
/**
 * Four work executions, one user-message coordination slot, and one check-in
 * slot that nothing else uses, so a stuck check-in can never hold up work or
 * a user's correction (ADR-0140). No idle provider is retained.
 */
export class BotTurnQueue {
	private lanes = new Map<string, Lane>();
	constructor(private readonly hooks: BotQueueHooks) {}
	private lane(id: string): Lane {
		let lane = this.lanes.get(id);
		if (!lane) {
			lane = {
				waiting: [],
				active: new Map(),
				stopped: false,
				failed: false,
				cleanupFailures: 0,
				uncleaned: new Set(),
			};
			this.lanes.set(id, lane);
		}
		return lane;
	}
	enqueue(
		input: Omit<BotQueuedTurn, 'id' | 'arrival'> & { id?: string },
		now = Date.now(),
	): BotQueuedTurn {
		const lane = this.lane(input.botId);
		if (
			lane.stopped ||
			lane.waiting.length >= 20 ||
			lane.waiting.some((i) => i.sessionId === input.sessionId)
		)
			throw new BotError('busy', 'Bot execution queue is full or blocked');
		const item = structuredClone({
			...input,
			id: input.id ?? randomBytes(12).toString('hex'),
			arrival: now,
		});
		lane.waiting.push(item);
		this.changed(input.botId, lane);
		this.dispatch(input.botId, lane);
		return structuredClone(item);
	}
	list(botId: string): BotQueuedTurn[] {
		return structuredClone(this.lane(botId).waiting);
	}
	active(botId: string): BotQueuedTurn[] {
		return structuredClone([...this.lane(botId).active.values()]);
	}
	reservePromotion(botId: string, source: string, target: string): () => void {
		const lane = this.lane(botId),
			active = [...lane.active.values()];
		if (
			active.find((i) => i.sessionId === source)?.coordinationOnly &&
			active.some((i) => i.sessionId === target && !i.coordinationOnly)
		)
			lane.reservation = { source, target };
		return () => {
			if (lane.reservation?.source === source) delete lane.reservation;
			this.dispatch(botId, lane);
		};
	}
	promote(botId: string, sessionId: string, retiredId?: string): boolean {
		const lane = this.lane(botId),
			item = [...lane.active.values()].find((i) => i.sessionId === sessionId);
		if (!item) return false;
		if (!item.coordinationOnly) return true;
		if (
			lane.reservation?.source === sessionId &&
			lane.reservation.target === retiredId
		) {
			const retired = [...lane.active.values()].find(
				(i) => i.sessionId === retiredId,
			);
			if (retired) retired.coordinationOnly = true;
		}
		if (workCount(lane) >= 4) return false;
		item.coordinationOnly = false;
		return true;
	}
	cancel(botId: string, id: string, reason = 'cancelled'): void {
		const lane = this.lane(botId),
			index = lane.waiting.findIndex((i) => i.id === id);
		if (index < 0)
			throw new BotError('not_found', 'Queued execution not found');
		const [item] = lane.waiting.splice(index, 1);
		this.hooks.cancelled(item!, reason);
		this.changed(botId, lane);
	}
	/** Removes a trigger's queued items that have not started. */
	disableTrigger(botId: string, triggerId: string, reason = 'cancelled'): void {
		for (const item of this.list(botId))
			if (botTriggerOrigin(item.origin)?.triggerId === triggerId)
				this.cancel(botId, item.id, reason);
	}
	pause(botId: string): void {
		this.lane(botId).stopped = true;
	}
	async block(botId: string): Promise<void> {
		const lane = this.lane(botId);
		lane.stopped = true;
		for (const item of lane.waiting.splice(0))
			this.hooks.cancelled(item, 'bot stopped');
		this.changed(botId, lane);
	}
	unblock(botId: string, reset = false): void {
		const lane = this.lane(botId);
		if (lane.failed && !reset)
			throw new BotError('unavailable', 'Bot cleanup must be reconciled');
		lane.stopped = false;
		if (reset) {
			lane.failed = false;
			lane.cleanupFailures = 0;
			lane.uncleaned.clear();
		}
		this.dispatch(botId, lane);
	}
	/** Whether the bot is blocked until its unconfirmed cleanups are confirmed. */
	blocked(botId: string): boolean {
		return this.lane(botId).failed;
	}
	/** Sessions whose cleanup must be confirmed before a blocked bot runs again. */
	uncleaned(botId: string): string[] {
		return [...this.lane(botId).uncleaned];
	}
	/** A retried cleanup was confirmed; the last one lifts the block. */
	cleaned(botId: string, sessionId: string): void {
		const lane = this.lane(botId);
		lane.uncleaned.delete(sessionId);
		if (lane.uncleaned.size) return;
		lane.failed = false;
		lane.cleanupFailures = 0;
	}
	private fail(lane: Lane): void {
		lane.failed = true;
		lane.stopped = true;
		for (const item of lane.waiting.splice(0))
			this.hooks.cancelled(item, 'bot blocked after a cleanup failure');
	}
	private async report(
		item: BotQueuedTurn,
		failure: BotQueueFailure,
	): Promise<void> {
		try {
			await this.hooks.failure(item, failure);
		} catch (error) {
			console.error('[terminay] bot failure hook failed:', error);
		}
	}
	private changed(id: string, lane: Lane): void {
		this.hooks.changed(id, lane.active.size, lane.waiting.length);
	}
	/** Moves reserved-slot executions into free ordinary slots, oldest first,
	 * so the reserve is free again for the next user message. A replacement's
	 * reservation keeps its own promotion. */
	private returnReserve(lane: Lane): void {
		if (lane.reservation) return;
		const active = [...lane.active.values()];
		let work = workCount(lane);
		for (const item of active.filter((i) => i.coordinationOnly)) {
			if (work >= 4) return;
			item.coordinationOnly = false;
			work++;
		}
	}
	private dispatch(id: string, lane: Lane): void {
		this.returnReserve(lane);
		if (lane.stopped || lane.reservation) return;
		while (lane.waiting.length) {
			const active = [...lane.active.values()];
			const coordination = workCount(lane) >= 4;
			const reserveBusy = active.some((i) => i.coordinationOnly);
			const checkInBusy = active.some(isCheckIn);
			const index = lane.waiting.findIndex((i) =>
				isCheckIn(i)
					? !checkInBusy
					: !coordination || (i.origin.kind === 'chat' && !reserveBusy),
			);
			if (index < 0) break;
			const [item] = lane.waiting.splice(index, 1);
			item!.coordinationOnly = coordination && !isCheckIn(item!);
			lane.active.set(item!.id, item!);
			this.changed(id, lane);
			void this.hooks
				.run(item!)
				.then(
					(result) => {
						if (result?.cleanup !== 'failed') {
							if (!lane.failed) {
								lane.cleanupFailures = 0;
								lane.uncleaned.clear();
							}
							return;
						}
						lane.cleanupFailures++;
						lane.uncleaned.add(item!.sessionId);
						const blocked =
							!lane.failed && lane.cleanupFailures >= BOT_CLEANUP_FAILURE_LIMIT;
						if (blocked) this.fail(lane);
						return this.report(item!, {
							error: result.error,
							cleanup: true,
							blocked,
						});
					},
					(error: unknown) => {
						lane.uncleaned.add(item!.sessionId);
						const blocked = !lane.failed;
						this.fail(lane);
						return this.report(item!, { error, cleanup: false, blocked });
					},
				)
				.finally(() => {
					lane.active.delete(item!.id);
					this.changed(id, lane);
					this.dispatch(id, lane);
				});
		}
	}
}
