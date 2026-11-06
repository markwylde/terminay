import type { BotMessageStore, BotUnacknowledgedPosts } from './messages.js';

/** Where a bot's notification goes: the server's notification manager. */
export type BotNotificationSink = (
	botId: string,
	posts: BotUnacknowledgedPosts | undefined,
) => void;

/**
 * The only source of bot notifications (ADR-0100). It keeps one notification
 * per bot in line with that bot's unacknowledged posts, recomputing from the
 * durable message log on every change and never on a timer.
 */
export class BotNotificationFeed {
	private readonly onChanged = (botId: string) => this.refresh(botId);
	private readonly onRemoved = (botId: string) => this.sink(botId, undefined);
	private closed = false;

	constructor(
		private readonly messages: BotMessageStore,
		private readonly sink: BotNotificationSink,
		botIds: () => readonly string[],
	) {
		messages.on('changed', this.onChanged);
		messages.on('acknowledged', this.onChanged);
		messages.on('removed', this.onRemoved);
		// The manager is live state; the acknowledged sequence is durable.
		for (const botId of botIds()) this.refresh(botId);
	}

	refresh(botId: string): void {
		if (this.closed) return;
		let posts: BotUnacknowledgedPosts | undefined;
		try {
			posts = this.messages.unacknowledged(botId);
		} catch {
			// An unreadable log raises nothing rather than failing the write.
			posts = undefined;
		}
		this.sink(botId, posts);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.messages.off('changed', this.onChanged);
		this.messages.off('acknowledged', this.onChanged);
		this.messages.off('removed', this.onRemoved);
	}
}
