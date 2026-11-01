import { randomBytes } from 'node:crypto';
import type { BotSessionOrigin } from '@terminay/protocol';
import { BotError } from './store.js';

export interface BotQueuedTurn {
	readonly id: string;
	readonly botId: string;
	readonly sessionId: string;
	readonly origin: BotSessionOrigin;
	readonly prompt: string;
	readonly arrival: number;
}
interface Lane {
	active?: BotQueuedTurn;
	idleSession?: string;
	waiting: BotQueuedTurn[];
	last?: 'chat' | 'trigger';
	dispatching: boolean;
	stopped: boolean;
	failed: boolean;
}
export interface BotQueueHooks {
	run(item: BotQueuedTurn): Promise<void>;
	suspend(sessionId: string): Promise<void>;
	cancelled(item: BotQueuedTurn, reason: string): void;
	changed(botId: string, active: number, queued: number): void;
	failure(item: BotQueuedTurn): void;
}
/** Only turns hold the lease. Between-turn chat processes yield before other work. */
export class BotTurnQueue {
	private readonly lanes = new Map<string, Lane>();
	constructor(private readonly hooks: BotQueueHooks) {}
	enqueue(
		input: Omit<BotQueuedTurn, 'id' | 'arrival'> & { id?: string },
		now = Date.now(),
	): BotQueuedTurn {
		const lane = this.lane(input.botId);
		if (
			lane.stopped ||
			lane.waiting.length >= 20 ||
			lane.waiting.some((i) =>
				input.origin.kind === 'chat'
					? i.sessionId === input.sessionId
					: i.origin.kind !== 'chat' &&
						i.origin.triggerId === input.origin.triggerId,
			)
		)
			throw new BotError(
				'busy',
				'bot queue is full or this work is already queued',
			);
		const item = structuredClone({
			...input,
			id: input.id ?? randomBytes(12).toString('hex'),
			arrival: now,
		});
		lane.waiting.push(item);
		this.changed(input.botId, lane);
		void this.dispatch(input.botId, lane);
		return structuredClone(item);
	}
	list(botId: string): BotQueuedTurn[] {
		return structuredClone(this.lane(botId).waiting);
	}
	cancel(botId: string, id: string): void {
		const lane = this.lane(botId);
		const index = lane.waiting.findIndex((i) => i.id === id);
		if (index < 0) throw new BotError('not_found', 'queued item not found');
		const [item] = lane.waiting.splice(index, 1);
		this.hooks.cancelled(item!, 'cancelled');
		this.changed(botId, lane);
	}
	disableTrigger(botId: string, triggerId: string): void {
		for (const item of this.list(botId))
			if (item.origin.kind !== 'chat' && item.origin.triggerId === triggerId)
				this.cancel(botId, item.id);
	}
	async block(botId: string): Promise<void> {
		const lane = this.lane(botId);
		lane.stopped = true;
		for (const item of lane.waiting.splice(0))
			this.hooks.cancelled(item, 'bot stopped');
		if (lane.idleSession) {
			await this.hooks.suspend(lane.idleSession);
			lane.idleSession = undefined;
		}
		this.changed(botId, lane);
	}
	unblock(botId: string, reset = false): void {
		const lane = this.lane(botId);
		if (lane.failed && !reset)
			throw new BotError('unavailable', 'bot cleanup must be reconciled');
		lane.stopped = false;
		if (reset) {
			lane.failed = false;
			lane.active = undefined;
		}
	}
	private lane(botId: string): Lane {
		let lane = this.lanes.get(botId);
		if (!lane) {
			lane = { waiting: [], dispatching: false, stopped: false, failed: false };
			this.lanes.set(botId, lane);
		}
		return lane;
	}
	private changed(id: string, lane: Lane): void {
		this.hooks.changed(
			id,
			lane.active || lane.dispatching ? 1 : 0,
			lane.waiting.length,
		);
	}
	private async dispatch(botId: string, lane: Lane): Promise<void> {
		if (lane.active || lane.dispatching || lane.stopped || !lane.waiting.length)
			return;
		lane.dispatching = true;
		let item: BotQueuedTurn | undefined;
		try {
			const chats = lane.waiting
				.filter((i) => i.origin.kind === 'chat')
				.sort((a, b) => a.arrival - b.arrival);
			const triggers = lane.waiting
				.filter((i) => i.origin.kind !== 'chat')
				.sort(
					(a, b) =>
						(a.origin.kind === 'chat' ? 0 : a.origin.fireTime) -
						(b.origin.kind === 'chat' ? 0 : b.origin.fireTime),
				);
			item =
				chats.length && triggers.length
					? lane.last === 'chat'
						? triggers[0]
						: chats[0]
					: (chats[0] ?? triggers[0]);
			if (!item) return;
			if (lane.idleSession && lane.idleSession !== item.sessionId) {
				await this.hooks.suspend(lane.idleSession);
				lane.idleSession = undefined;
			}
			// Cancellation during asynchronous suspension must not dispatch removed work.
			if (lane.stopped || !lane.waiting.some((i) => i.id === item!.id)) return;
			lane.waiting = lane.waiting.filter((i) => i.id !== item!.id);
			lane.idleSession = undefined;
			lane.active = item;
			lane.last = item.origin.kind === 'chat' ? 'chat' : 'trigger';
			this.changed(botId, lane);
			await this.hooks.run(item);
			lane.idleSession =
				item.origin.kind === 'chat' ? item.sessionId : undefined;
		} catch {
			lane.stopped = true;
			lane.failed = true;
			if (item) this.hooks.failure(item);
		} finally {
			if (!lane.failed) lane.active = undefined;
			lane.dispatching = false;
			this.changed(botId, lane);
			if (!lane.stopped && lane.waiting.length) void this.dispatch(botId, lane);
		}
	}
}
