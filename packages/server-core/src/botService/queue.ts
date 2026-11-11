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
	/** Sessions whose process cleanup the engine did not confirm. */
	uncleaned: Set<string>;
	reservation?: { source: string; target: string };
}
export interface BotQueueHooks {
	run(item: BotQueuedTurn): Promise<void>;
	suspend(sessionId: string): Promise<void>;
	cancelled(item: BotQueuedTurn, reason: string): void;
	changed(botId: string, running: number, queued: number): void;
	failure(item: BotQueuedTurn, error: unknown): void;
}
/** Four work executions and one user-message coordination slot. No idle provider is retained. */
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
		if (
			[...lane.active.values()].filter((i) => !i.coordinationOnly).length >= 4
		)
			return false;
		item.coordinationOnly = false;
		return true;
	}
	cancel(botId: string, id: string): void {
		const lane = this.lane(botId),
			index = lane.waiting.findIndex((i) => i.id === id);
		if (index < 0)
			throw new BotError('not_found', 'Queued execution not found');
		const [item] = lane.waiting.splice(index, 1);
		this.hooks.cancelled(item!, 'cancelled');
		this.changed(botId, lane);
	}
	disableTrigger(botId: string, triggerId: string): void {
		for (const item of this.list(botId))
			if (botTriggerOrigin(item.origin)?.triggerId === triggerId)
				this.cancel(botId, item.id);
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
			lane.uncleaned.clear();
		}
		this.dispatch(botId, lane);
	}
	/** Whether an execution's cleanup is unconfirmed, blocking new work. */
	blocked(botId: string): boolean {
		return this.lane(botId).failed;
	}
	/** Sessions whose cleanup must be confirmed before the bot runs again. */
	uncleaned(botId: string): string[] {
		return [...this.lane(botId).uncleaned];
	}
	/** A retried cleanup was confirmed; the last one lifts the block. */
	cleaned(botId: string, sessionId: string): void {
		const lane = this.lane(botId);
		lane.uncleaned.delete(sessionId);
		if (!lane.uncleaned.size) lane.failed = false;
	}
	private changed(id: string, lane: Lane): void {
		this.hooks.changed(id, lane.active.size, lane.waiting.length);
	}
	private dispatch(id: string, lane: Lane): void {
		if (lane.stopped || lane.reservation) return;
		while (lane.waiting.length) {
			const work = [...lane.active.values()].filter(
				(i) => !i.coordinationOnly,
			).length;
			const coordination = work >= 4;
			if (
				coordination &&
				[...lane.active.values()].some((i) => i.coordinationOnly)
			)
				break;
			const index = coordination
				? lane.waiting.findIndex((i) => i.origin.kind === 'chat')
				: 0;
			if (index < 0) break;
			const [item] = lane.waiting.splice(index, 1);
			item!.coordinationOnly = coordination;
			lane.active.set(item!.id, item!);
			this.changed(id, lane);
			void this.hooks
				.run(item!)
				.catch((error: unknown) => {
					lane.failed = true;
					lane.stopped = true;
					lane.uncleaned.add(item!.sessionId);
					this.hooks.failure(item!, error);
				})
				.finally(() => {
					lane.active.delete(item!.id);
					this.changed(id, lane);
					this.dispatch(id, lane);
				});
		}
	}
}
