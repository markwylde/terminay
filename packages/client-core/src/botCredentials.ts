import {
	botEnvironmentId,
	type JsonValue,
	BOT_CREDENTIAL_OPERATIONS as op,
} from '@terminay/protocol';
import type { BinaryCommandTransport } from './queryCommand.js';
import type { CommandOptions, QueryOptions } from './types.js';
/** Preload-facing credential operations. No operation returns a secret. */
export class BotCredentialClient {
	constructor(private readonly transport: BinaryCommandTransport) {}
	async options(botId: string, options: QueryOptions = {}): Promise<JsonValue> {
		return this.transport.query(
			op.options,
			{ botId: botEnvironmentId(botId) },
			options,
		);
	}
	async save(
		botId: string,
		variable: string,
		value: Uint8Array,
		options: CommandOptions = {},
	): Promise<void> {
		try {
			await this.transport.commandWithBody(
				op.save,
				{ botId: botEnvironmentId(botId), variable },
				value,
				options,
			);
		} finally {
			value.fill(0);
		}
	}
	async copy(
		sourceBotId: string,
		botId: string,
		variable: string,
		options: CommandOptions = {},
	): Promise<void> {
		await this.transport.command(
			op.copy,
			{
				sourceBotId: botEnvironmentId(sourceBotId),
				botId: botEnvironmentId(botId),
				variable,
			},
			options,
		);
	}
	async remove(
		botId: string,
		variable: string,
		options: CommandOptions = {},
	): Promise<void> {
		await this.transport.command(
			op.remove,
			{ botId: botEnvironmentId(botId), variable },
			options,
		);
	}
	/** Sign out of the device sign-in kept in this bot's home. */
	async deviceSignOut(
		botId: string,
		options: CommandOptions = {},
	): Promise<void> {
		await this.transport.command(
			op.deviceSignOut,
			{ botId: botEnvironmentId(botId) },
			options,
		);
	}
}
