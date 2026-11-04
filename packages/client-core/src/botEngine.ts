import {
	BOT_ENGINE_CHANGED,
	type BotBuildProgress,
	type BotEngineKind,
	type BotEngineStatus,
	BOT_ENGINE_OPERATIONS as op,
	parseBotBuildProgress,
	parseBotEngineStatus,
} from '@terminay/protocol';
import type { BotTransport } from './bots.js';
import type { CommandOptions, QueryOptions } from './types.js';

export class BotEngineClient {
	constructor(private readonly transport: BotTransport) {}
	async status(options: QueryOptions = {}): Promise<BotEngineStatus> {
		return parseBotEngineStatus(
			await this.transport.query(op.status, {}, options),
		);
	}
	async check(options: CommandOptions = {}): Promise<void> {
		await this.transport.command(op.check, {}, options);
	}
	async use(
		kind: BotEngineKind,
		address: string,
		confirmed = false,
		options: CommandOptions = {},
	): Promise<void> {
		await this.transport.command(op.use, { kind, address, confirmed }, options);
	}
	async build(options: CommandOptions = {}): Promise<void> {
		await this.transport.command(
			op.build,
			{},
			{ deadlineMs: 16 * 60_000, ...options },
		);
	}
	async progress(options: QueryOptions = {}): Promise<BotBuildProgress | null> {
		return parseBotBuildProgress(
			await this.transport.query(op.progress, {}, options),
		);
	}
	async log(options: QueryOptions = {}): Promise<string> {
		const r = await this.transport.queryWithBody(op.log, {}, options);
		if (r.body.byteLength > 256 * 1024)
			throw new TypeError('invalid image log');
		return new TextDecoder().decode(r.body);
	}
	watch(
		listener: (event: { revision: number }) => void,
		onResync?: () => void,
	): () => void {
		return this.transport.subscribe(
			BOT_ENGINE_CHANGED,
			(v) => {
				if (
					!v ||
					typeof v !== 'object' ||
					Array.isArray(v) ||
					Object.keys(v).join(',') !== 'revision' ||
					!Number.isSafeInteger(v.revision)
				)
					throw new TypeError('invalid engine invalidation');
				listener({ revision: v.revision as number });
			},
			onResync,
		);
	}
}
