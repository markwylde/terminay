import {
	assertJsonValue,
	BOT_EVENTS,
	BOTS_CAPABILITY,
	type BotAgent,
	type BotDraft,
	type BotInvalidation,
	type BotMemory,
	type BotProfile,
	type BotQueue,
	type BotSession,
	type BotSessionRecord,
	type BotTrigger,
	type BotTriggerDraft,
	type BotTriggerFiring,
	type BotUpcomingCursor,
	type BotUpcomingPage,
	type JsonValue,
	BOT_OPERATIONS as op,
} from '@terminay/protocol';
import type {
	BinaryCommandTransport,
	BinaryQueryTransport,
} from './queryCommand.js';
import type { CommandOptions, QueryOptions } from './types.js';

export { BOTS_CAPABILITY };
export interface BotTransport
	extends BinaryQueryTransport,
		BinaryCommandTransport {
	subscribe(
		event: string,
		listener: (payload: JsonValue) => void,
		onResync?: () => void,
	): () => void;
}
const json = (value: unknown): JsonValue => {
	assertJsonValue(value);
	return value;
};
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new TypeError('invalid bot response');
	return value as Record<string, unknown>;
}
function profile(value: unknown): BotProfile {
	const r = record(value);
	if (
		typeof r.id !== 'string' ||
		!/^[a-z0-9]{12}$/.test(r.id) ||
		typeof r.name !== 'string' ||
		typeof r.agentId !== 'string' ||
		!['autonomous', 'ask'].includes(String(r.approvalMode)) ||
		(r.investigateFailures !== undefined &&
			typeof r.investigateFailures !== 'boolean') ||
		(r.terminayMcpAccess !== undefined &&
			typeof r.terminayMcpAccess !== 'boolean')
	)
		throw new TypeError('invalid bot profile');
	return structuredClone(r) as unknown as BotProfile;
}
function session(value: unknown): BotSessionRecord {
	const r = record(value);
	if (
		typeof r.id !== 'string' ||
		!/^[a-z0-9]{24}$/.test(r.id) ||
		typeof r.botId !== 'string' ||
		typeof r.state !== 'string' ||
		typeof r.runnerOutput !== 'string'
	)
		throw new TypeError('invalid bot session');
	if (r.queuedMessage !== null && r.queuedMessage !== undefined) {
		const q = record(r.queuedMessage);
		if (
			typeof q.id !== 'string' ||
			!/^[a-z0-9]{24}$/.test(q.id) ||
			typeof q.text !== 'string' ||
			!['queued', 'not-sent'].includes(String(q.status))
		)
			throw new TypeError('invalid queued message');
	}
	return structuredClone(r) as unknown as BotSessionRecord;
}
function trigger(value: unknown): BotTrigger {
	const r = record(value);
	if (
		typeof r.id !== 'string' ||
		!/^[a-z0-9]{24}$/.test(r.id) ||
		typeof r.botId !== 'string' ||
		typeof r.name !== 'string' ||
		typeof r.enabled !== 'boolean' ||
		typeof r.prompt !== 'string' ||
		!Number.isSafeInteger(r.missedCount) ||
		![
			'event',
			'cron',
			'once',
			'every',
			'files',
			'sse',
			'http',
			'command',
		].includes(String(record(r.condition).kind))
	)
		throw new TypeError('invalid bot trigger');
	return structuredClone(r) as unknown as BotTrigger;
}
function firing(value: unknown): BotTriggerFiring {
	const r = record(value);
	if (
		typeof r.id !== 'string' ||
		typeof r.triggerId !== 'string' ||
		!Number.isSafeInteger(r.firedAt) ||
		!['pending', 'running', 'completed', 'failed', 'skipped'].includes(
			String(r.outcome),
		) ||
		(r.reason !== null && typeof r.reason !== 'string')
	)
		throw new TypeError('invalid bot firing');
	return structuredClone(r) as unknown as BotTriggerFiring;
}
/** Preload/connection-host facade. The renderer receives only server responses. */
export class BotsClient {
	constructor(private readonly transport: BotTransport) {}
	private async read(
		operation: string,
		payload: JsonValue,
		options: QueryOptions,
	): Promise<JsonValue> {
		const input = record(payload);
		const chunks: Uint8Array[] = [];
		let offset = 0;
		let version: string | undefined;
		let totalBytes = 0;
		do {
			const response = await this.transport.queryWithBody(
				operation,
				json({ ...input, offset, ...(version ? { version } : {}) }),
				options,
			);
			const meta = record(response.result);
			if (
				meta.encoding !== 'json' ||
				typeof meta.version !== 'string' ||
				meta.offset !== offset ||
				!Number.isSafeInteger(meta.totalBytes) ||
				(meta.totalBytes as number) < 1 ||
				(meta.totalBytes as number) > 64 * 1024 * 1024 ||
				response.body.byteLength < 1 ||
				response.body.byteLength > 1024 * 1024 ||
				offset + response.body.byteLength > (meta.totalBytes as number) ||
				(version !== undefined && version !== meta.version)
			)
				throw new TypeError('invalid bot response page');
			version = meta.version;
			totalBytes = meta.totalBytes as number;
			chunks.push(response.body);
			offset += response.body.byteLength;
		} while (offset < totalBytes);
		const bytes = new Uint8Array(totalBytes);
		let at = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, at);
			at += chunk.byteLength;
		}
		const value: unknown = JSON.parse(
			new TextDecoder('utf-8', { fatal: true }).decode(bytes),
		);
		assertJsonValue(value);
		return value;
	}
	async enableBot(
		botId: string,
		enabled: boolean,
		options: CommandOptions = {},
	): Promise<void> {
		await this.transport.command(op.enableBot, { botId, enabled }, options);
	}
	async testSource(
		botId: string,
		condition: BotTriggerDraft['condition'],
		triggerId?: string,
		options: CommandOptions = {},
	): Promise<import('@terminay/protocol').BotSourceTest> {
		return (await this.transport.command(
			op.testSource,
			json({ botId, condition, ...(triggerId ? { triggerId } : {}) }),
			options,
		)) as unknown as import('@terminay/protocol').BotSourceTest;
	}
	async sourceMemory(
		botId: string,
		triggerId: string,
		memoryOffset = 0,
	): Promise<{ total: number; ids: string[]; next: number | null }> {
		return (await this.read(
			op.sourceMemory,
			{ botId, triggerId, memoryOffset },
			{},
		)) as unknown as { total: number; ids: string[]; next: number | null };
	}
	async resetSource(
		botId: string,
		triggerId: string,
		confirmed: boolean,
	): Promise<void> {
		await this.transport.command(
			op.resetSource,
			{ botId, triggerId, confirmed },
			{},
		);
	}
	async retrySource(botId: string, triggerId: string): Promise<void> {
		await this.transport.command(op.retrySource, { botId, triggerId }, {});
	}
	async triggers(
		botId: string,
		options: QueryOptions = {},
	): Promise<{ revision: number; triggers: BotTrigger[] }> {
		const r = record(await this.read(op.triggers, { botId }, options));
		if (!Number.isSafeInteger(r.revision) || !Array.isArray(r.triggers))
			throw new TypeError('invalid triggers');
		return {
			revision: r.revision as number,
			triggers: r.triggers.map(trigger),
		};
	}
	async createTrigger(
		botId: string,
		draft: BotTriggerDraft,
		options: CommandOptions = {},
	): Promise<BotTrigger> {
		const r = record(
			await this.transport.commandWithBody(
				op.createTrigger,
				{ botId },
				new TextEncoder().encode(JSON.stringify(draft)),
				options,
			),
		);
		return this.savedTrigger(botId, r.triggerId, options);
	}
	async updateTrigger(
		botId: string,
		triggerId: string,
		draft: BotTriggerDraft,
		options: CommandOptions = {},
	): Promise<BotTrigger> {
		const r = record(
			await this.transport.commandWithBody(
				op.updateTrigger,
				{ botId, triggerId },
				new TextEncoder().encode(JSON.stringify(draft)),
				options,
			),
		);
		return this.savedTrigger(botId, r.triggerId, options);
	}
	private async savedTrigger(
		botId: string,
		id: unknown,
		options: QueryOptions,
	): Promise<BotTrigger> {
		if (typeof id !== 'string') throw new TypeError('invalid saved trigger');
		const saved = (await this.triggers(botId, options)).triggers.find(
			(t) => t.id === id,
		);
		if (!saved) throw new TypeError('saved trigger was removed');
		return saved;
	}
	async deleteTrigger(
		botId: string,
		triggerId: string,
		options: CommandOptions = {},
	): Promise<void> {
		await this.transport.command(
			op.deleteTrigger,
			{ botId, triggerId },
			options,
		);
	}
	async enableTrigger(
		botId: string,
		triggerId: string,
		enabled: boolean,
		options: CommandOptions = {},
	): Promise<void> {
		await this.transport.command(
			op.enableTrigger,
			{ botId, triggerId, enabled },
			options,
		);
	}
	async runTrigger(
		botId: string,
		triggerId: string,
		options: CommandOptions = {},
	): Promise<BotTriggerFiring | null> {
		const result = await this.transport.command(
			op.runTrigger,
			{ botId, triggerId },
			options,
		);
		return result === null ? null : firing(result);
	}

	async previewTrigger(
		botId: string,
		condition: BotTriggerDraft['condition'],
		options: QueryOptions = {},
	): Promise<number[]> {
		const r = await this.read(
			op.previewTrigger,
			json({ botId, condition }),
			options,
		);
		if (
			!Array.isArray(r) ||
			r.length > 5 ||
			r.some((at) => !Number.isSafeInteger(at))
		)
			throw new TypeError('invalid trigger preview');
		return r as number[];
	}
	async upcomingTriggers(
		botId: string,
		from: number,
		through: number,
		page: { limit?: number; after?: BotUpcomingCursor } = {},
		options: QueryOptions = {},
	): Promise<BotUpcomingPage> {
		const r = record(
			await this.read(
				op.upcomingTriggers,
				json({ botId, from, through, ...page }),
				options,
			),
		);
		if (
			!Array.isArray(r.firings) ||
			r.firings.length > 1000 ||
			r.firings.some(
				(f) =>
					typeof record(f).triggerId !== 'string' ||
					!Number.isSafeInteger(record(f).at),
			) ||
			(r.next !== null &&
				(typeof record(r.next).triggerId !== 'string' ||
					!Number.isSafeInteger(record(r.next).at)))
		)
			throw new TypeError('invalid upcoming triggers');
		return r as unknown as BotUpcomingPage;
	}
	async triggerFirings(
		botId: string,
		triggerId?: string,
		options: QueryOptions = {},
	): Promise<BotTriggerFiring[]> {
		const r = await this.read(
			op.triggerFirings,
			{ botId, ...(triggerId ? { triggerId } : {}) },
			options,
		);
		if (!Array.isArray(r) || r.length > 200)
			throw new TypeError('invalid trigger firings');
		return r.map(firing);
	}
	async dismissMissedTriggers(
		botId: string,
		triggerId: string,
		options: CommandOptions = {},
	): Promise<void> {
		await this.transport.command(
			op.dismissMissedTriggers,
			{ botId, triggerId },
			options,
		);
	}
	async agents(options: QueryOptions = {}): Promise<BotAgent[]> {
		const value = await this.read(op.agents, {}, options);
		if (!Array.isArray(value) || value.length > 256)
			throw new TypeError('invalid bot agents');
		return value.map((entry) => {
			const r = record(entry),
				status = record(r.status),
				models = record(r.models);
			if (
				!['extensionId', 'extensionName', 'id', 'displayName'].every(
					(key) =>
						typeof r[key] === 'string' && (r[key] as string).length <= 512,
				) ||
				typeof r.autonomousOnly !== 'boolean' ||
				typeof r.canLoad !== 'boolean' ||
				!Array.isArray(r.signInMethods) ||
				r.signInMethods.length > 2 ||
				new Set(r.signInMethods).size !== r.signInMethods.length ||
				r.signInMethods.some(
					(method) => !['device', 'token'].includes(String(method)),
				) ||
				(r.deviceSignIn !== null &&
					(typeof record(r.deviceSignIn).label !== 'string' ||
						typeof record(r.deviceSignIn).help !== 'string')) ||
				!['ready', 'not-signed-in', 'not-installed', 'unavailable'].includes(
					String(status.state),
				) ||
				(status.detail !== undefined &&
					(typeof status.detail !== 'string' || status.detail.length > 4096)) ||
				(status.action !== undefined &&
					(typeof record(status.action).label !== 'string' ||
						![
							'sign-in',
							'build-image',
							'enable-extension',
							'install-extension',
						].includes(String(record(status.action).kind)))) ||
				typeof models.available !== 'boolean' ||
				!Array.isArray(models.value) ||
				models.value.length > 64 ||
				models.value.some(
					(model) =>
						typeof record(model).id !== 'string' ||
						typeof record(model).displayName !== 'string',
				)
			)
				throw new TypeError('invalid bot agent');
			return structuredClone(r) as unknown as BotAgent;
		});
	}
	async queue(botId: string, options: QueryOptions = {}): Promise<BotQueue> {
		const r = record(await this.read(op.queue, { botId }, options));
		if (
			r.botId !== botId ||
			!Array.isArray(r.items) ||
			r.items.length > 20 ||
			r.items.some((item) => {
				const i = record(item);
				return (
					typeof i.id !== 'string' ||
					!/^[a-z0-9]{24}$/.test(i.id) ||
					!['chat', 'trigger'].includes(String(i.kind)) ||
					!['sessionId', 'triggerId', 'triggerName'].every(
						(key) => i[key] === null || typeof i[key] === 'string',
					) ||
					!(
						i.fireTime === null ||
						(typeof i.fireTime === 'number' && Number.isFinite(i.fireTime))
					) ||
					typeof i.enqueuedAt !== 'number' ||
					!Number.isFinite(i.enqueuedAt)
				);
			})
		)
			throw new TypeError('invalid bot queue');
		return structuredClone(r) as unknown as BotQueue;
	}
	async list(
		options: QueryOptions = {},
	): Promise<{ revision: number; bots: BotProfile[] }> {
		const r = record(await this.read(op.list, {}, options));
		if (!Number.isSafeInteger(r.revision) || !Array.isArray(r.bots))
			throw new TypeError('invalid bots list');
		return { revision: r.revision as number, bots: r.bots.map(profile) };
	}
	async get(botId: string, options: QueryOptions = {}): Promise<BotProfile> {
		return profile(await this.read(op.get, { botId }, options));
	}
	async save(bot: BotDraft, options: CommandOptions = {}): Promise<BotProfile> {
		const result = record(
			await this.transport.commandWithBody(
				op.save,
				{},
				new TextEncoder().encode(JSON.stringify(bot)),
				options,
			),
		);
		if (typeof result.botId !== 'string')
			throw new TypeError('invalid saved bot');
		return this.get(result.botId, options);
	}
	async remove(
		botId: string,
		deleteHome = false,
		confirmed = false,
		options: CommandOptions = {},
	): Promise<{ warning: string | null }> {
		const result = await this.transport.command(
			op.remove,
			{ botId, deleteHome, confirmed },
			options,
		);
		if (result === null) return { warning: null };
		const value = record(result);
		if (value.warning !== null && typeof value.warning !== 'string')
			throw new TypeError('invalid bot deletion result');
		return { warning: value.warning };
	}
	async sessions(
		botId: string,
		filter: {
			origin?: string;
			state?: string;
			search?: string;
			triggerId?: string;
		} = {},
		options: QueryOptions = {},
	): Promise<BotSessionRecord[]> {
		const response = await this.read(
			op.sessions,
			json({ botId, ...filter }),
			options,
		);
		if (!Array.isArray(response)) throw new TypeError('invalid bot sessions');
		return response.map(session);
	}
	async session(
		botId: string,
		sessionId: string,
		options: QueryOptions = {},
	): Promise<BotSession> {
		const r = record(
			await this.read(op.session, { botId, sessionId }, options),
		);
		session(r);
		if (!Array.isArray(r.updates))
			throw new TypeError('invalid bot transcript');
		return r as unknown as BotSession;
	}
	async send(
		botId: string,
		prompt: string,
		sessionId?: string,
		options: CommandOptions = {},
	): Promise<{ sessionId: string; queueId: string }> {
		const r = record(
			await this.transport.commandWithBody(
				op.send,
				{ botId, ...(sessionId ? { sessionId } : {}) },
				new TextEncoder().encode(prompt),
				options,
			),
		);
		if (typeof r.sessionId !== 'string' || typeof r.queueId !== 'string')
			throw new TypeError('invalid queued message');
		return { sessionId: r.sessionId, queueId: r.queueId };
	}
	async reviseMessage(
		botId: string,
		sessionId: string,
		key: string,
		expected: string,
		replacement: string | null,
	): Promise<{ sessionId: string }> {
		const result = await this.transport.command(op.reviseMessage, {
			botId,
			sessionId,
			key,
			expected,
			replacement,
		});
		const value = result as { sessionId?: unknown };
		if (typeof value?.sessionId !== 'string')
			throw new TypeError('invalid revised chat');
		return { sessionId: value.sessionId };
	}
	async clearChat(botId: string, sessionId: string): Promise<void> {
		await this.transport.command(op.clearChat, {
			botId,
			sessionId,
			confirmed: true,
		});
	}
	async newChat(botId: string, options: CommandOptions = {}): Promise<void> {
		await this.transport.command(op.newChat, { botId }, options);
	}
	async control(
		botId: string,
		sessionId: string,
		action: 'stop' | 'end' | 'continue',
		options: CommandOptions = {},
	): Promise<void> {
		if (!['stop', 'end', 'continue'].includes(action))
			throw new TypeError('invalid bot session action');
		await this.transport.command(op[action], { botId, sessionId }, options);
	}
	async cancelQueued(
		botId: string,
		queueId: string,
		options: CommandOptions = {},
	): Promise<void> {
		await this.transport.command(op.cancelQueued, { botId, queueId }, options);
	}
	async decide(
		botId: string,
		sessionId: string,
		permissionId: string,
		optionId: string,
		options: CommandOptions = {},
	): Promise<void> {
		await this.transport.command(
			op.decide,
			{ botId, sessionId, permissionId, optionId },
			options,
		);
	}
	async memories(
		botId: string,
		search = '',
		options: QueryOptions = {},
	): Promise<BotMemory[]> {
		const r = await this.read(op.memories, { botId, search }, options);
		if (
			!Array.isArray(r) ||
			r.some(
				(v) =>
					typeof record(v).path !== 'string' ||
					typeof record(v).title !== 'string' ||
					typeof record(v).pinned !== 'boolean',
			)
		)
			throw new TypeError('invalid bot memories');
		return r as unknown as BotMemory[];
	}
	async memory(
		botId: string,
		path: string,
		options: QueryOptions = {},
	): Promise<string> {
		const r = await this.read(op.memory, { botId, path }, options);
		if (typeof r !== 'string') throw new TypeError('invalid memory');
		return r;
	}
	async writeMemory(
		botId: string,
		path: string,
		contents: string,
		options: CommandOptions = {},
	): Promise<void> {
		await this.transport.commandWithBody(
			op.writeMemory,
			{ botId, path },
			new TextEncoder().encode(contents),
			options,
		);
	}
	async pinMemory(
		botId: string,
		path: string,
		pinned: boolean,
		options: CommandOptions = {},
	): Promise<void> {
		await this.transport.command(
			op.pinMemory,
			{ botId, path, pinned },
			options,
		);
	}
	async deleteMemory(
		botId: string,
		path: string,
		options: CommandOptions = {},
	): Promise<void> {
		await this.transport.command(op.deleteMemory, { botId, path }, options);
	}
	async watchMemories(
		botId: string,
		options: CommandOptions = {},
	): Promise<() => Promise<void>> {
		const response = record(
			await this.transport.command(op.watchMemories, { botId }, options),
		);
		if (typeof response.watchId !== 'string')
			throw new TypeError('invalid memory watch');
		const watchId = response.watchId;
		let closed = false;
		return async () => {
			if (closed) return;
			closed = true;
			await this.transport.command(op.unwatchMemories, { watchId }, options);
		};
	}
	watch(
		listener: (value: BotInvalidation) => void,
		onResync?: () => void,
	): () => void {
		return this.transport.subscribe(
			BOT_EVENTS.changed,
			(value) => {
				const r = record(value);
				if (
					typeof r.botId !== 'string' ||
					!Number.isSafeInteger(r.revision) ||
					Object.keys(r).some((k) => !['botId', 'revision'].includes(k))
				)
					throw new TypeError('invalid bot invalidation');
				listener(r as unknown as BotInvalidation);
			},
			onResync,
		);
	}
}
