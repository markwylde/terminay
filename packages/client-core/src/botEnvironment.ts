import {
	assertJsonValue,
	type BotContainerAction,
	type BotEnvironmentOverview,
	type BotEnvironmentSetSettings,
	type BotEnvironmentSettings,
	type BotSiblingContainer,
	botEnvironmentId,
	BOT_ENVIRONMENT_OPERATIONS as op,
	parseBotEnvironmentState,
	parseBotEnvironmentOverview,
	parseBotEnvironmentSetSettings,
	parseBotEnvironmentSettings,
	parseBotSiblingContainers,
} from '@terminay/protocol';
import type {
	BinaryQueryTransport,
	QueryCommandTransport,
} from './queryCommand.js';
import type { CommandOptions, QueryOptions } from './types.js';

/** Backend facade for preload/connection hosts. Calling overview explicitly
 * samples figures again; this facade creates no polling or subscriptions. */
export class BotEnvironmentClient {
	constructor(
		private readonly transport: QueryCommandTransport &
			Partial<BinaryQueryTransport>,
	) {}
	async state(botId: string, options: QueryOptions = {}) {
		return parseBotEnvironmentState(
			await this.transport.query(
				op.state,
				{ botId: botEnvironmentId(botId) },
				options,
			),
		);
	}
	async settings(
		botId: string,
		options: QueryOptions = {},
	): Promise<BotEnvironmentSettings> {
		return parseBotEnvironmentSettings(
			await this.transport.query(
				op.settings,
				{ botId: botEnvironmentId(botId) },
				options,
			),
		);
	}
	async setSettings(
		input: BotEnvironmentSetSettings,
		options: CommandOptions = {},
	): Promise<BotEnvironmentSettings> {
		const payload = { ...parseBotEnvironmentSetSettings(input) };
		assertJsonValue(payload);
		return parseBotEnvironmentSettings(
			await this.transport.command(op.setSettings, payload, options),
		);
	}
	async overview(
		botId: string,
		options: QueryOptions = {},
	): Promise<BotEnvironmentOverview> {
		if (this.transport.queryWithBody) {
			const response = await this.transport.queryWithBody(
				op.overview,
				{ botId: botEnvironmentId(botId), encoding: 'json' },
				options,
			);
			if (response.body.byteLength > 1024 * 1024)
				throw new TypeError('invalid bot overview');
			return parseBotEnvironmentOverview(
				JSON.parse(
					new TextDecoder('utf-8', { fatal: true }).decode(response.body),
				),
			);
		}
		return parseBotEnvironmentOverview(
			await this.transport.query(
				op.overview,
				{ botId: botEnvironmentId(botId) },
				options,
			),
		);
	}
	async containers(
		botId: string,
		options: QueryOptions = {},
	): Promise<readonly BotSiblingContainer[]> {
		return parseBotSiblingContainers(
			await this.transport.query(
				op.containers,
				{ botId: botEnvironmentId(botId) },
				options,
			),
		);
	}
	async lifecycle(
		botId: string,
		action: 'start' | 'stop' | 'restart' | 'recreate',
		options: CommandOptions & { readonly confirmed?: boolean } = {},
	): Promise<void> {
		if (!['start', 'stop', 'restart', 'recreate'].includes(action))
			throw new TypeError('invalid bot lifecycle action');
		await this.transport.command(
			op[action],
			{ botId: botEnvironmentId(botId), confirmed: options.confirmed === true },
			options,
		);
	}
	async remove(
		botId: string,
		deleteHome: boolean,
		options: CommandOptions = {},
	): Promise<void> {
		if (typeof deleteHome !== 'boolean')
			throw new TypeError('deleteHome must be a boolean');
		await this.transport.command(
			op.remove,
			{ botId: botEnvironmentId(botId), deleteHome },
			options,
		);
	}
	async containerAction(
		botId: string,
		containerId: string,
		action: BotContainerAction,
		confirmed = false,
		options: CommandOptions = {},
	): Promise<string | null> {
		if (action === 'logs' && this.transport.queryWithBody) {
			const response = await this.transport.queryWithBody(
				op.containerLogs,
				{ botId: botEnvironmentId(botId), containerId },
				options,
			);
			if (response.body.byteLength > 256 * 1024)
				throw new TypeError('invalid container log');
			return new TextDecoder().decode(response.body);
		}
		const result = await this.transport.command(
			op.containerAction,
			{ botId: botEnvironmentId(botId), containerId, action, confirmed },
			options,
		);
		if (result !== null && typeof result !== 'string')
			throw new TypeError('invalid container action response');
		return result;
	}
}
