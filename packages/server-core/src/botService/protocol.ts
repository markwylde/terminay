import {
	assertJsonValue,
	type BotContainerAction,
	botEnvironmentId,
	type JsonValue,
	BOT_ENVIRONMENT_OPERATIONS as op,
	parseBotEnvironmentSetSettings,
	protocolError,
} from '@terminay/protocol';
import type {
	CommandRequest,
	OperationRegistries,
	QueryRequest,
} from '../types.js';
import { assertBotAuthority } from './authority.js';
import type { BotEnvironmentService } from './environment.js';

/** Group 5's bot/session registry can compose this registry. All reads and writes
 * recheck terminal-create authority; no bot data enters the public journal. */
export function createBotEnvironmentOperations(
	service: BotEnvironmentService,
): OperationRegistries {
	const payload = (
		request: QueryRequest | CommandRequest,
	): Record<string, JsonValue> => {
		assertBotAuthority(request.context);
		const value = request.envelope.payload;
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new TypeError('invalid bot environment request');
		botEnvironmentId(value.botId);
		return value;
	};
	const json = (value: unknown): JsonValue => {
		assertJsonValue(value);
		return value;
	};
	return {
		policies: Object.fromEntries(
			Object.values(op).map((operation) => [
				operation,
				{ scope: 'write' as const },
			]),
		),
		queries: {
			[op.state]: async (request) =>
				service.state(botEnvironmentId(payload(request).botId)),
			[op.settings]: async (request) => {
				const value = await service.settings(
					botEnvironmentId(payload(request).botId),
				);
				assertBotAuthority(request.context);
				return json(value);
			},
			[op.overview]: async (request) => {
				const p = payload(request);
				const value = json(await service.overview(botEnvironmentId(p.botId)));
				assertBotAuthority(request.context);
				if (p.encoding !== 'json') return value;
				const body = Buffer.from(JSON.stringify(value));
				return { result: { encoding: 'json', bytes: body.length }, body };
			},
			[op.containerLogs]: async (request) => {
				const p = payload(request);
				if (typeof p.containerId !== 'string')
					throw new TypeError('invalid container id');
				const log = await service.containerAction(
					botEnvironmentId(p.botId),
					p.containerId,
					'logs',
				);
				assertBotAuthority(request.context);
				const body = Buffer.from(log ?? '');
				return { result: { encoding: 'utf-8', bytes: body.length }, body };
			},
			[op.containers]: async (request) =>
				json(
					await service.containers(botEnvironmentId(payload(request).botId)),
				),
		},
		commands: {
			[op.setSettings]: async (request) => {
				let input: ReturnType<typeof parseBotEnvironmentSetSettings>;
				const p = payload(request);
				try {
					input = parseBotEnvironmentSetSettings(p);
				} catch {
					throw protocolError('validation', 'invalid bot environment settings');
				}
				return { result: json(await service.setSettings(input)) };
			},
			...Object.fromEntries(
				(['start', 'stop', 'restart', 'recreate'] as const).map((action) => [
					op[action],
					async (request: CommandRequest) => {
						const data = payload(request);
						if (action === 'recreate')
							await service.recreate(
								botEnvironmentId(data.botId),
								data.confirmed === true,
							);
						else await service[action](botEnvironmentId(data.botId));
						return { result: null };
					},
				]),
			),
			[op.remove]: async (request) => {
				const data = payload(request);
				if (typeof data.deleteHome !== 'boolean')
					throw new TypeError('deleteHome must be a boolean');
				await service.remove(botEnvironmentId(data.botId), data.deleteHome);
				return { result: null };
			},
			[op.containerAction]: async (request) => {
				const data = payload(request);
				if (
					typeof data.containerId !== 'string' ||
					typeof data.action !== 'string'
				)
					throw new TypeError('invalid container action');
				return {
					result: await service.containerAction(
						botEnvironmentId(data.botId),
						data.containerId,
						data.action as BotContainerAction,
						data.confirmed === true,
					),
				};
			},
		},
	};
}
