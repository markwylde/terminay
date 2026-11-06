import { createHash } from 'node:crypto';
import {
	assertJsonValue,
	botTriggerOrigin,
	type BotDraft,
	type BotTriggerDraft,
	type BotUpcomingCursor,
	type JsonValue,
	BOT_OPERATIONS as op,
} from '@terminay/protocol';
import type {
	CommandRequest,
	OperationRegistries,
	QueryRequest,
} from '../types.js';
import { assertBotAuthority } from './authority.js';
import type { BotService } from './service.js';
import { BotError, object, text } from './store.js';

/** Every handler revalidates authority. Only invalidations enter the event journal. */
export function createBotOperations(service: BotService): OperationRegistries {
	const payload = (request: QueryRequest | CommandRequest) => {
		assertBotAuthority(request.context);
		return object(request.envelope.payload);
	};
	const json = (value: unknown): JsonValue => {
		assertJsonValue(value);
		return value;
	};
	const bot = (d: Record<string, unknown>) => text(d.botId, 12, 'bot id');
	const id = (d: Record<string, unknown>) =>
		text(d.sessionId, 24, 'session id');
	const owned = (d: Record<string, unknown>) => {
		const s = service.sessions.get(id(d));
		if (s.botId !== bot(d))
			throw new BotError('not_found', 'session not found');
		return s;
	};
	const command =
		(
			work: (
				data: Record<string, unknown>,
				request: CommandRequest,
			) => unknown | Promise<unknown>,
		) =>
		async (request: CommandRequest) => ({
			result: json((await work(payload(request), request)) ?? null),
		});
	return {
		policies: Object.fromEntries(
			Object.values(op).map((name) => [name, { scope: 'write' as const }]),
		),
		queries: Object.fromEntries(
			Object.entries({
				[op.sourceMemory]: (r) => {
					const d = payload(r);
					return json(
						service.triggers.memory(
							bot(d),
							text(d.triggerId, 24, 'trigger id'),
							d.memoryOffset as number | undefined,
						),
					);
				},
				[op.triggers]: (r) => json(service.triggers.list(bot(payload(r)))),
				[op.previewTrigger]: (r) => {
					const d = payload(r);
					service.bots.get(bot(d));
					return json(service.triggers.preview(d.condition));
				},
				[op.upcomingTriggers]: (r) => {
					const d = payload(r);
					return json(
						service.triggers.upcoming(
							bot(d),
							d.from as number,
							d.through as number,
							d.limit as number | undefined,
							d.after as BotUpcomingCursor | undefined,
						),
					);
				},
				[op.triggerFirings]: (r) => {
					const d = payload(r);
					return json(
						service.triggers.firings(
							bot(d),
							d.triggerId === undefined
								? undefined
								: text(d.triggerId, 24, 'trigger id'),
						),
					);
				},
				[op.list]: (request) => {
					payload(request);
					return json({
						revision: service.bots.revision,
						bots: service.bots.list(),
					});
				},
				[op.queue]: (request) => {
					const botId = bot(payload(request));
					service.bots.get(botId);
					return json({
						botId,
						items: service.queue.list(botId).map((i) => {
							const trigger = botTriggerOrigin(i.origin);
							return {
								id: i.id,
								kind: trigger ? 'trigger' : i.origin.kind,
								sessionId: i.sessionId,
								triggerId: trigger?.triggerId ?? null,
								triggerName: trigger?.triggerName ?? null,
								fireTime: trigger?.fireTime ?? null,
								enqueuedAt: i.arrival,
							};
						}),
					});
				},
				[op.get]: (request) => json(service.bots.get(bot(payload(request)))),
				[op.agents]: async (request) => {
					payload(request);
					return json(await service.agents());
				},
				[op.sessions]: (request) => {
					const d = payload(request);
					service.bots.get(bot(d));
					return json(
						service.sessions.list(bot(d), {
							origin: typeof d.origin === 'string' ? d.origin : undefined,
							state: typeof d.state === 'string' ? d.state : undefined,
							search: typeof d.search === 'string' ? d.search : undefined,
						}),
					);
				},
				[op.session]: (request) => json(owned(payload(request))),
				[op.memories]: async (request) => {
					const d = payload(request);
					return json(
						await service.memories.list(
							bot(d),
							typeof d.search === 'string' ? d.search : undefined,
						),
					);
				},
				[op.memory]: async (request) => {
					const d = payload(request);
					return service.memories.read(
						bot(d),
						text(d.path, 255, 'memory path'),
					);
				},
			} satisfies NonNullable<OperationRegistries['queries']>).map(
				([name, handler]) => [
					name,
					async (request: QueryRequest) => {
						const d = payload(request);
						const value = await handler(request);
						assertBotAuthority(request.context);
						const bytes = Buffer.from(JSON.stringify(value));
						const version = createHash('sha256').update(bytes).digest('hex');
						const offset = d.offset ?? 0;
						if (
							!Number.isSafeInteger(offset) ||
							(offset as number) < 0 ||
							(offset as number) > bytes.length
						)
							throw new BotError('validation', 'invalid bot response offset');
						if (d.version !== undefined && d.version !== version)
							throw new BotError(
								'conflict',
								'bot response changed; fetch it again',
							);
						const body = bytes.subarray(
							offset as number,
							(offset as number) + 1024 * 1024,
						);
						return {
							result: {
								encoding: 'json',
								version,
								offset: offset as number,
								totalBytes: bytes.length,
							},
							body,
						};
					},
				],
			),
		),
		commands: {
			[op.enableBot]: command((d, r) =>
				service.enableBot(
					bot(d),
					d.enabled as boolean,
					r.context.expectedRevision,
				),
			),
			[op.testSource]: command((d, r) =>
				service.triggers.test(
					bot(d),
					d.condition,
					d.triggerId as string | undefined,
					r.context.signal,
				),
			),
			[op.resetSource]: command((d) =>
				service.triggers.reset(
					bot(d),
					text(d.triggerId, 24, 'trigger id'),
					d.confirmed === true,
				),
			),
			[op.retrySource]: command((d) =>
				service.triggers.retry(bot(d), text(d.triggerId, 24, 'trigger id')),
			),
			[op.createTrigger]: command(async (d, r) => {
				const trigger = await service.triggers.prepare(
					bot(d),
					undefined,
					object(
						r.body.byteLength
							? JSON.parse(
									new TextDecoder('utf-8', { fatal: true }).decode(r.body),
								)
							: d.trigger,
					) as unknown as BotTriggerDraft,
					r.context.expectedRevision,
				);
				return { triggerId: trigger.id, revision: service.bots.revision };
			}),
			[op.updateTrigger]: command(async (d, r) => {
				const trigger = await service.triggers.prepare(
					bot(d),
					text(d.triggerId, 24, 'trigger id'),
					object(
						r.body.byteLength
							? JSON.parse(
									new TextDecoder('utf-8', { fatal: true }).decode(r.body),
								)
							: d.trigger,
					) as unknown as BotTriggerDraft,
					r.context.expectedRevision,
				);
				return { triggerId: trigger.id, revision: service.bots.revision };
			}),
			[op.deleteTrigger]: command((d, r) =>
				service.triggers.remove(
					bot(d),
					text(d.triggerId, 24, 'trigger id'),
					r.context.expectedRevision,
				),
			),
			[op.enableTrigger]: command((d, r) =>
				service.triggers.enable(
					bot(d),
					text(d.triggerId, 24, 'trigger id'),
					d.enabled as boolean,
					r.context.expectedRevision,
				),
			),
			[op.runTrigger]: command((d) =>
				service.triggers.runNow(bot(d), text(d.triggerId, 24, 'trigger id')),
			),
			[op.dismissMissedTriggers]: command((d) =>
				service.triggers.dismissMissed(
					bot(d),
					text(d.triggerId, 24, 'trigger id'),
				),
			),
			[op.save]: command(async (d, r) => {
				const draft = r.body.byteLength
					? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(r.body))
					: d.bot;
				const saved = await service.save(
					object(draft) as unknown as BotDraft,
					r.context.expectedRevision,
				);
				return { botId: saved.id, revision: service.bots.revision };
			}),
			[op.remove]: command((d) => {
				if (typeof d.deleteHome !== 'boolean')
					throw new BotError('validation', 'deleteHome must be a boolean');
				return service.remove(bot(d), d.deleteHome, d.confirmed === true);
			}),
			[op.send]: command((d, r) =>
				service.send(
					bot(d),
					text(
						r.body.byteLength
							? new TextDecoder('utf-8', { fatal: true }).decode(r.body)
							: d.prompt,
						64 * 1024,
						'message',
					),
					d.sessionId === undefined ? undefined : id(d),
				),
			),
			[op.stop]: command((d) => service.stop(bot(d), id(d))),
			[op.reviseMessage]: command((d) =>
				service.reviseMessage(
					bot(d),
					id(d),
					text(d.key, 256, 'message key'),
					text(d.expected, 64 * 1024, 'expected message', true),
					d.replacement === null
						? null
						: text(d.replacement, 64 * 1024, 'message'),
				),
			),
			[op.clearChat]: command((d) =>
				service.clearChat(bot(d), id(d), d.confirmed === true),
			),
			[op.newChat]: command((d) => service.newChat(bot(d))),
			[op.end]: command((d) => service.end(bot(d), id(d))),
			[op.continue]: command((d) => service.continue(bot(d), id(d))),
			[op.decide]: command((d) =>
				service.decide(
					bot(d),
					id(d),
					text(d.permissionId, 64, 'permission id'),
					text(d.optionId, 256, 'option id'),
				),
			),
			[op.cancelQueued]: command((d) => {
				service.bots.get(bot(d));
				service.queue.cancel(bot(d), text(d.queueId, 24, 'queue id'));
			}),
			[op.writeMemory]: command((d, r) =>
				service.memories.write(
					bot(d),
					text(d.path, 255, 'memory path'),
					text(
						r.body.byteLength
							? new TextDecoder('utf-8', { fatal: true }).decode(r.body)
							: (d.contents ?? ''),
						1024 * 1024,
						'memory',
						true,
					),
				),
			),
			[op.pinMemory]: command((d) => {
				if (typeof d.pinned !== 'boolean')
					throw new BotError('validation', 'pinned must be boolean');
				service.memories.pin(
					bot(d),
					text(d.path, 255, 'memory path'),
					d.pinned,
				);
			}),
			[op.watchMemories]: command(async (d, r) => ({
				watchId: await service.watchMemories(bot(d), r.context),
			})),
			[op.unwatchMemories]: command((d, r) =>
				service.unwatchMemories(text(d.watchId, 24, 'watch id'), r.context),
			),
			[op.deleteMemory]: command((d) =>
				service.memories.remove(bot(d), text(d.path, 255, 'memory path')),
			),
		},
	};
}
