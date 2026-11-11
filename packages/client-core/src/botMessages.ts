import {
	BOT_MESSAGE_OPERATIONS as op,
	type BotMessage,
	type BotMessagePage,
	type BotMessageDetail,
	type BotMessageUpload,
	type BotRuntimeEventPage,
	type JsonValue,
	assertJsonValue,
} from '@terminay/protocol';
import type { BotTransport } from './bots.js';
function json(value: unknown): JsonValue {
	const clean = JSON.parse(JSON.stringify(value));
	assertJsonValue(clean);
	return clean;
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new TypeError('Invalid message response');
	return value as Record<string, unknown>;
}
export class BotMessagesClient {
	constructor(private readonly transport: BotTransport) {}
	async list(
		botId: string,
		options: { cursor?: string; limit?: number; search?: string } = {},
	): Promise<BotMessagePage> {
		const value = record(
			await this.transport.query(op.list, json({ botId, ...options })),
		);
		if (
			!Array.isArray(value.items) ||
			value.items.length > 25 ||
			typeof value.eventsCursor !== 'string'
		)
			throw new TypeError('Invalid message page');
		return value as unknown as BotMessagePage;
	}
	async get(
		botId: string,
		messageId: string,
		cursor?: string,
	): Promise<BotMessageDetail> {
		const value = record(
			await this.transport.query(
				op.get,
				json({ botId, messageId, ...(cursor ? { cursor } : {}) }),
			),
		);
		if (
			typeof value.text !== 'string' ||
			!value.message ||
			typeof value.message !== 'object'
		)
			throw new TypeError('Invalid message detail');
		return value as unknown as BotMessageDetail;
	}
	async post(
		botId: string,
		text: string,
		key: string,
		uploads: readonly string[] = [],
	): Promise<{ message: BotMessage; sessionId?: string; error?: string }> {
		return record(
			await this.transport.command(op.post, {
				botId,
				text,
				key,
				...(uploads.length ? { uploads: [...uploads] } : {}),
			}),
		) as unknown as { message: BotMessage; sessionId?: string; error?: string };
	}
	/** Stages one image for a later post. The server sniffs its type and bounds its size. */
	async upload(
		botId: string,
		name: string,
		bytes: Uint8Array,
	): Promise<BotMessageUpload> {
		const r = record(
			await this.transport.commandWithBody(op.upload, { botId, name }, bytes),
		);
		const a = r.attachment as Record<string, unknown> | undefined;
		if (
			typeof r.token !== 'string' ||
			!/^[a-f0-9]{24}$/.test(r.token) ||
			!a ||
			typeof a.name !== 'string' ||
			typeof a.size !== 'number' ||
			!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
				String(a.mime),
			)
		)
			throw new TypeError('Invalid upload response');
		return r as unknown as BotMessageUpload;
	}
	async edit(
		botId: string,
		messageId: string,
		revision: number,
		text: string,
	): Promise<void> {
		await this.transport.command(op.edit, { botId, messageId, revision, text });
	}
	async remove(
		botId: string,
		messageId: string,
		revision: number,
	): Promise<void> {
		await this.transport.command(op.remove, { botId, messageId, revision });
	}
	/** Start a fresh execution for a user message whose start failed. */
	async retry(
		botId: string,
		messageId: string,
		revision: number,
		attempt: number,
	): Promise<{ message: BotMessage; sessionId?: string; error?: string }> {
		return record(
			await this.transport.command(op.retry, {
				botId,
				messageId,
				revision,
				attempt,
			}),
		) as unknown as { message: BotMessage; sessionId?: string; error?: string };
	}
	/** Hide a user message's start-failure warning on every client. */
	async dismiss(
		botId: string,
		messageId: string,
		revision: number,
		attempt: number,
	): Promise<BotMessage> {
		return record(
			await this.transport.command(op.dismiss, {
				botId,
				messageId,
				revision,
				attempt,
			}),
		) as unknown as BotMessage;
	}
	/** Acknowledge this bot's posts through the latest sequence this client has
	 * observed; later posts keep their notification. */
	async acknowledge(botId: string, throughSequence: number): Promise<void> {
		await this.transport.command(
			op.acknowledge,
			json({ botId, throughSequence }),
		);
	}
	async clear(botId: string): Promise<void> {
		await this.transport.command(op.clear, { botId, confirmed: true });
	}
	async events(
		botId: string,
		options: { cursor?: string; limit?: number; waitMs?: number } = {},
	): Promise<BotRuntimeEventPage> {
		return record(
			await this.transport.query(op.events, json({ botId, ...options })),
		) as unknown as BotRuntimeEventPage;
	}
	async attachment(
		botId: string,
		attachmentId: string,
		signal?: AbortSignal,
	): Promise<{ mime: string; bytes: Uint8Array }> {
		const { result, body } = await this.transport.queryWithBody(
			op.attachment,
			{ botId, attachmentId },
			{ signal },
		);
		const r = record(result);
		if (
			!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
				String(r.mime),
			) ||
			body.length > 2 * 1024 * 1024
		)
			throw new TypeError('Invalid attachment');
		return { mime: String(r.mime), bytes: body };
	}
	watch(botId: string, listener: () => void): () => void {
		return this.transport.subscribe(
			'bots.messages.changed',
			(value) => {
				const r = record(value);
				if (r.botId === botId) listener();
			},
			listener,
		);
	}
}
