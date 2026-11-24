/** Thread helpers for bot Chat. */
import type { BotMessagesClient } from '@terminay/client-core';
import type {
	BotMessage,
	BotMessageDetail,
	BotThreadSummary,
	TranscriptItem,
} from '@terminay/protocol';
import { isBotImageMime } from '@terminay/protocol';
import type { BotActionItem } from './botActions';

/** A message with its whole text, read in as many slices as it takes. */
/** Whether a refusal says the message is gone, not that the read failed.
 * The code does not survive the preload bridge, so the refusal's own words
 * ("Message not found", "Thread not found") count too. */
export function isNotFound(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const { code, message } = error as { code?: unknown; message?: unknown };
	return (
		code === 'not_found' ||
		(typeof message === 'string' &&
			/\b(message|thread) not found\b/i.test(message))
	);
}

/** Full messages for a page; one deleted since the page was listed is left
 * out rather than failing the page. */
export async function fullMessages(
	client: Pick<BotMessagesClient, 'get'>,
	botId: string,
	ids: readonly string[],
): Promise<BotMessage[]> {
	const got = await Promise.all(
		ids.map((id) =>
			fullMessage(client, botId, id).catch((error: unknown) => {
				if (isNotFound(error)) return null;
				throw error;
			}),
		),
	);
	return got.filter((m): m is BotMessage => m !== null);
}

export async function fullMessage(
	client: Pick<BotMessagesClient, 'get'>,
	botId: string,
	id: string,
): Promise<BotMessage> {
	let part: BotMessageDetail = await client.get(botId, id);
	let text = part.text;
	let next = part.nextCursor;
	while (next) {
		part = await client.get(botId, id, next);
		text += part.text;
		next = part.nextCursor;
	}
	return { ...part.message, text };
}

/** How Chat shows a message: the user's with its files, the bot's as Markdown with its images. */
export function messageItem(
	message: BotMessage,
): TranscriptItem | BotActionItem {
	if (message.activity !== undefined)
		return {
			kind: 'action',
			key: message.id,
			text: message.text,
			at: message.createdAt,
			activity: message.activity,
		};
	return message.author === 'user'
		? {
				kind: 'user',
				key: message.id,
				text: message.text,
				attachments: message.attachments,
			}
		: {
				kind: 'agent',
				key: message.id,
				text:
					message.text +
					message.attachments
						.filter((a) => isBotImageMime(a.mime))
						.map(
							(a) =>
								`\n\n![${a.name.replace(/[[\]]/g, '')}](bot-attachment:${a.id})`,
						)
						.join(''),
				attachments: message.attachments.filter((a) => !isBotImageMime(a.mime)),
			};
}

/** "1 reply", "3 replies". */
export function replyCountLabel(count: number): string {
	return `${count} ${count === 1 ? 'reply' : 'replies'}`;
}

/** A thread is new to this device when its latest bot reply is past the read position. */
export function threadIsNew(
	summary: Pick<BotThreadSummary, 'lastBotReplySequence'> | undefined,
	readThrough: number | undefined,
): boolean {
	return (
		readThrough !== undefined &&
		summary?.lastBotReplySequence != null &&
		summary.lastBotReplySequence > readThrough
	);
}

/**
 * The latest sequence a view has observed: its messages and their roots'
 * latest replies. Roots older than `floor` (the oldest message of the view's
 * first page) arrived by scrolling back, which acknowledges nothing, so only
 * their own sequence counts.
 */
export function observedThrough(
	messages: readonly Pick<BotMessage, 'sequence' | 'thread'>[],
	floor?: number,
): number | undefined {
	let latest: number | undefined;
	for (const m of messages) {
		const replies =
			floor === undefined || m.sequence >= floor
				? (m.thread?.lastReplySequence ?? 0)
				: 0;
		const at = Math.max(m.sequence, replies);
		if (latest === undefined || at > latest) latest = at;
	}
	return latest;
}

/**
 * User messages whose start failed and still need a warning, oldest first.
 * A failure stays visible until it is dismissed or a later user message in
 * the same list has started an execution.
 */
export function visibleStartFailures<
	T extends Pick<BotMessage, 'author' | 'dispatch'>,
>(ordered: readonly T[]): T[] {
	let laterStarted = false;
	const shown: T[] = [];
	for (let i = ordered.length - 1; i >= 0; i--) {
		const m = ordered[i]!;
		if (m.author !== 'user') continue;
		if (m.dispatch?.state === 'started') laterStarted = true;
		else if (
			m.dispatch?.state === 'failed' &&
			!m.dispatch.dismissed &&
			!laterStarted
		)
			shown.unshift(m);
	}
	return shown;
}

/** The Delete label for a message: a root with replies deletes them too. */
export function deleteLabel(
	message: Pick<BotMessage, 'threadId' | 'thread'>,
): string {
	return !message.threadId && message.thread?.replyCount
		? 'Delete message and replies'
		: 'Delete message';
}
