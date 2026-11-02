import {
	BOT_MESSAGE_OPERATIONS as op,
	assertJsonValue,
	type JsonValue,
} from '@terminay/protocol';
import type {
	OperationRegistries,
	QueryRequest,
	CommandRequest,
} from '../types.js';
import type { BotService } from './service.js';
import { assertBotAuthority } from './authority.js';
import { BotError, object, text } from './store.js';
export function createBotMessageOperations(
	service: BotService,
): OperationRegistries {
	const data = (
		r: QueryRequest | CommandRequest,
	): Record<string, unknown> & { botId: string } => {
		assertBotAuthority(r.context);
		const p = object(r.envelope.payload);
		const botId = text(p.botId, 12, 'bot id');
		service.bots.get(botId);
		return { ...p, botId };
	};
	const json = (v: unknown): JsonValue => {
		assertJsonValue(v);
		return v;
	};
	const cursor = (p: Record<string, unknown>) =>
		p.cursor === undefined ? undefined : text(p.cursor, 4096, 'cursor');
	const queries: OperationRegistries['queries'] = {
		[op.list]: async (r) => {
			const p = data(r);
			return json(
				service.messages.list(p.botId, {
					cursor: cursor(p),
					limit: p.limit as number | undefined,
					search: p.search as string | undefined,
				}),
			);
		},
		[op.get]: async (r) => {
			const p = data(r);
			return json(
				service.messages.detail(
					p.botId,
					text(p.messageId, 24, 'message id'),
					cursor(p),
				),
			);
		},
		[op.events]: async (r) => {
			const p = data(r);
			const result = await service.messages.waitEvents(
				p.botId,
				cursor(p),
				p.limit as number | undefined,
				p.waitMs as number | undefined,
				r.context.signal,
			);
			assertBotAuthority(r.context);
			return json(result);
		},
		[op.attachment]: async (r) => {
			const p = data(r);
			const asset = service.messages.attachment(
				p.botId,
				text(p.attachmentId, 24, 'attachment id'),
			);
			assertBotAuthority(r.context);
			return { result: { mime: asset.mime }, body: asset.bytes };
		},
	};
	const commands: OperationRegistries['commands'] = {
		[op.post]: async (r) => {
			const p = data(r);
			const result = await service.postUserMessage(
				p.botId,
				text(p.text, 65536, 'message'),
				text(p.key, 128, 'idempotency key'),
			);
			assertBotAuthority(r.context);
			return { result: json(result) };
		},
		[op.edit]: async (r) => {
			const p = data(r);
			const body = await service.redactMessage(
				p.botId,
				text(p.text, 65536, 'message'),
			);
			assertBotAuthority(r.context);
			return {
				result: json(
					service.messages.edit(
						p.botId,
						text(p.messageId, 24, 'message id'),
						p.revision as number,
						body,
					),
				),
			};
		},
		[op.remove]: async (r) => {
			const p = data(r);
			return {
				result: json(
					service.messages.edit(
						p.botId,
						text(p.messageId, 24, 'message id'),
						p.revision as number,
						null,
					),
				),
			};
		},
		[op.clear]: async (r) => {
			const p = data(r);
			if (p.confirmed !== true)
				throw new BotError(
					'validation',
					'Clearing messages requires confirmation',
				);
			await service.clearMessages(p.botId);
			return { result: null };
		},
	};
	return {
		policies: Object.fromEntries(
			Object.values(op).map((name) => [name, { scope: 'write' as const }]),
		),
		queries,
		commands,
	};
}
