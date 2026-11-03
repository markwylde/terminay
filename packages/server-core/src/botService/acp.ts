import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import {
	assertJsonValue,
	type BotApprovalMode,
	type BotPermission,
	type JsonValue,
} from '@terminay/protocol';
import { BotError, object, text } from './store.js';

export interface BotAcpProcess extends EventEmitter {
	readonly stdin: Writable;
	readonly stdout: Readable;
	readonly stderr: Readable;
	kill(signal?: string): boolean;
}
export interface BotTextRedactor {
	push(chunk: string): string;
	finish(): string;
}
/** Owned by the credential broker. Device sign-in uses an empty lease.
 * No extension receives this lease or any bot/session identifier. */
export interface BotCredentialLease {
	readonly environment: Readonly<Record<string, string>>;
	readonly authenticateMethodId?: string;
	redact(value: string): string;
	stream(): BotTextRedactor;
	release(): void;
}
export const noBotCredentials = (): BotCredentialLease => ({
	environment: {},
	redact: (value) => value,
	stream: () => ({ push: (chunk) => chunk, finish: () => '' }),
	release: () => undefined,
});
export function redactBotJson(
	value: JsonValue,
	credential: Pick<BotCredentialLease, 'redact'>,
): JsonValue {
	if (typeof value === 'string') return credential.redact(value);
	if (Array.isArray(value))
		return value.map((v) => redactBotJson(v, credential));
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value).map(([key, v]) => [
				credential.redact(key),
				redactBotJson(v, credential),
			]),
		);
	return value;
}
interface Pending {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
}
interface Approval {
	rpcId: string | number;
	permission: BotPermission;
}
/** Bounded JSON-lines ACP. The host offers no filesystem or terminal facilities. */
export class BotAcpClient extends EventEmitter {
	private readonly pending = new Map<number, Pending>();
	private readonly approvals = new Map<string, Approval>();
	private readonly answered = new Set<string>();
	private readonly chunks = new Map<
		string,
		{
			redactor: BotTextRedactor;
			template: Record<string, JsonValue>;
			path: (string | number)[];
		}
	>();
	private readonly runner: BotTextRedactor;
	private nextId = 0;
	private buffer = '';
	private readonly decoder = new StringDecoder('utf8');
	private readonly stderrDecoder = new StringDecoder('utf8');
	private ended = false;
	private turnActive = false;
	private expired = false;
	private acpId: string | null = null;
	private promptResult: Promise<unknown> | undefined;
	private capabilities: Record<string, unknown> = {};
	private mode: BotApprovalMode;
	constructor(
		readonly process: BotAcpProcess,
		private readonly credential: BotCredentialLease,
		mode: BotApprovalMode,
		private readonly autonomousOnly = false,
	) {
		super();
		this.mode = autonomousOnly ? 'autonomous' : mode;
		this.runner = credential.stream();
		process.stdout.on('data', (chunk: Buffer) =>
			this.receive(this.decoder.write(chunk)),
		);
		process.stderr.on('data', (chunk: Buffer) => {
			const safe = this.runner.push(this.stderrDecoder.write(chunk));
			if (safe) this.emit('runner', safe);
		});
		process.stdin.on('error', () => this.fail());
		process.once('error', () => this.fail());
		process.once('close', () => {
			this.fail();
			this.emit('closed');
		});
	}
	get permissions(): BotPermission[] {
		return structuredClone(
			[...this.approvals.values()].map((a) => a.permission),
		);
	}
	get canLoad(): boolean {
		return this.capabilities.loadSession === true;
	}
	get session(): string | null {
		return this.acpId;
	}
	async initialize(): Promise<void> {
		const result = object(
			await this.request('initialize', {
				protocolVersion: 1,
				clientCapabilities: {},
				clientInfo: { name: 'terminay', version: '1' },
			}),
		);
		this.capabilities = object(result.agentCapabilities ?? {});
		if (this.credential.authenticateMethodId) {
			const methods = Array.isArray(result.authMethods)
				? result.authMethods
				: [];
			if (
				!methods.some(
					(m) => object(m).id === this.credential.authenticateMethodId,
				)
			)
				throw new BotError(
					'unavailable',
					'agent does not declare the required authentication method',
				);
			await this.request('authenticate', {
				methodId: this.credential.authenticateMethodId,
			});
		}
	}
	async open(
		loadId: string | null,
		modelId: string | null,
		mcpServers: readonly JsonValue[] = [],
	): Promise<boolean> {
		if (loadId && !this.canLoad)
			throw new BotError('unavailable', 'agent cannot load sessions');
		const result = object(
			await this.request(loadId ? 'session/load' : 'session/new', {
				...(loadId ? { sessionId: loadId } : {}),
				cwd: '/home/bot',
				mcpServers: [...mcpServers],
			}),
		);
		this.acpId = loadId ?? text(result.sessionId, 256, 'ACP session id');
		const config = Array.isArray(result.configOptions)
			? result.configOptions
			: [];
		const model = config
			.map(object)
			.find((option) => option.category === 'model');
		if (modelId !== null && model) {
			const options = JSON.stringify(model.options ?? []);
			// A chosen model must actually be offered by this adapter, including grouped options.
			const contains = (values: unknown): boolean =>
				Array.isArray(values) &&
				values.some((v) => {
					const o = object(v);
					return o.value === modelId || contains(o.options);
				});
			if (options.length > 1024 * 1024 || !contains(model.options))
				throw new BotError(
					'validation',
					'agent does not offer the selected model',
				);
			await this.request('session/set_config_option', {
				sessionId: this.acpId,
				configId: text(model.id, 256, 'model config id'),
				value: modelId,
			});
		}
		const modes = object(result.modes ?? {});
		if (
			this.autonomousOnly &&
			Array.isArray(modes.availableModes) &&
			modes.availableModes.some((m) => object(m).id === 'agent-full-access')
		)
			await this.request('session/set_mode', {
				sessionId: this.acpId,
				modeId: 'agent-full-access',
			});
		return !!model;
	}
	async prompt(prompt: string, maxTurnMs: number): Promise<void> {
		if (this.turnActive || !this.acpId)
			throw new BotError('busy', 'agent is not ready for a turn');
		this.turnActive = true;
		this.expired = false;
		this.promptResult = this.request(
			'session/prompt',
			{ sessionId: this.acpId, prompt: [{ type: 'text', text: prompt }] },
			maxTurnMs + 30_000,
		);
		try {
			await this.promptResult;
		} finally {
			this.turnActive = false;
			this.rejectPermissions();
			this.flushChunks();
		}
	}
	/** ACP cancel is a notification. Its acknowledgement is the prompt's cancelled result. */
	async cancel(): Promise<void> {
		this.rejectPermissions();
		if (!this.turnActive) return;
		this.write({
			jsonrpc: '2.0',
			method: 'session/cancel',
			params: { sessionId: this.acpId },
		});
		await this.promptResult;
	}
	timeout(): void {
		this.expired = true;
		this.rejectPermissions();
	}
	answer(id: string, optionId: string): void {
		const approval = this.approvals.get(id);
		if (!approval)
			throw new BotError(
				'conflict',
				this.answered.has(id)
					? 'already answered'
					: 'permission request is no longer active',
			);
		if (this.expired || !this.turnActive) {
			this.finishApproval(id, this.rejectOutcome(approval.permission));
			throw new BotError('conflict', 'turn is no longer active');
		}
		if (!approval.permission.options.some((o) => o.optionId === optionId))
			throw new BotError('validation', 'unknown permission option');
		this.finishApproval(id, { outcome: 'selected', optionId });
	}
	closeInput(): void {
		this.rejectPermissions();
		this.process.stdin.end();
	}
	dispose(): void {
		this.fail();
		this.removeAllListeners();
	}
	private receive(chunk: string): void {
		this.buffer += chunk;
		if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024) {
			this.fail();
			this.emit('failure');
			return;
		}
		let index = this.buffer.indexOf('\n');
		while (index >= 0) {
			const line = this.buffer.slice(0, index);
			this.buffer = this.buffer.slice(index + 1);
			try {
				if (line.trim()) this.message(object(JSON.parse(line)));
			} catch {
				this.fail();
				this.emit('failure');
				return;
			}
			index = this.buffer.indexOf('\n');
		}
	}
	private message(message: Record<string, unknown>): void {
		if (message.jsonrpc !== '2.0') throw new Error('invalid ACP frame');
		if (typeof message.method === 'string') {
			if (message.method === 'session/update') {
				const params = object(message.params);
				if (params.sessionId === this.acpId) this.update(object(params.update));
			} else if (
				message.method === 'session/request_permission' &&
				(typeof message.id === 'number' || typeof message.id === 'string')
			) {
				this.permission(message.id, object(message.params));
			} else if (message.id !== undefined)
				this.write({
					jsonrpc: '2.0',
					id: message.id as JsonValue,
					error: { code: -32601, message: 'client capability not available' },
				});
			return;
		}
		if (typeof message.id !== 'number') return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.pending.delete(message.id);
		if (message.error) {
			const safe = this.credential.redact(
				JSON.stringify(message.error).slice(0, 8192),
			);
			this.emit('runner', `ACP request failed: ${safe}\n`);
			pending.reject(
				new BotError(
					'unavailable',
					'The agent could not start or complete the request. See Runner output for details.',
				),
			);
		} else pending.resolve(message.result);
	}
	private update(update: Record<string, unknown>): void {
		assertJsonValue(update);
		const safe = redactBotJson(update, this.credential) as Record<
			string,
			JsonValue
		>;
		const texts: { path: (string | number)[]; value: string }[] = [];
		const walk = (value: JsonValue, path: (string | number)[]) => {
			if (Array.isArray(value)) {
				value.forEach((v, i) => {
					walk(v, [...path, i]);
				});
				return;
			}
			if (value && typeof value === 'object') {
				if (value.type === 'text' && typeof value.text === 'string')
					texts.push({ path: [...path, 'text'], value: value.text });
				for (const [key, child] of Object.entries(value))
					if (key !== 'text') walk(child, [...path, key]);
			}
		};
		walk(update, []);
		if (typeof update.rawOutput === 'string')
			texts.push({ path: ['rawOutput'], value: update.rawOutput });
		let produced = false;
		for (const part of texts) {
			const key = JSON.stringify([
				update.sessionUpdate,
				update.toolCallId ?? null,
				part.path,
			]);
			let entry = this.chunks.get(key);
			if (!entry) {
				if (this.chunks.size >= 256)
					throw new Error('too many ACP text streams');
				entry = {
					redactor: this.credential.stream(),
					template: safe,
					path: part.path,
				};
				this.chunks.set(key, entry);
			}
			entry.template = safe;
			const value = entry.redactor.push(part.value);
			produced ||= value.length > 0;
			this.setText(safe, part.path, value);
		}
		// Tool metadata can progress even while its text tail is withheld. Pure
		// message chunks wait until their carry window is safe to publish.
		if (produced || !String(update.sessionUpdate).endsWith('_chunk'))
			this.emit('update', safe);
	}
	private setText(
		value: Record<string, JsonValue>,
		path: (string | number)[],
		textValue: string,
	): void {
		let target: JsonValue = value;
		for (const key of path.slice(0, -1))
			target = (target as Record<string, JsonValue>)[key]!;
		(target as Record<string, JsonValue>)[path.at(-1)!] = textValue;
	}
	private flushChunks(): void {
		for (const { redactor, template, path } of this.chunks.values()) {
			const value = redactor.finish();
			if (!value) continue;
			const safe = structuredClone(template);
			// A final tail must not repeat the other text blocks from a tool update.
			const clear = (item: JsonValue) => {
				if (Array.isArray(item)) item.forEach(clear);
				else if (item && typeof item === 'object')
					for (const [key, child] of Object.entries(item)) {
						if (
							(item.type === 'text' && key === 'text') ||
							(key === 'rawOutput' && typeof child === 'string')
						)
							item[key] = '';
						else clear(child);
					}
			};
			clear(safe);
			this.setText(safe, path, value);
			this.emit('update', safe);
		}
		this.chunks.clear();
	}
	private permission(
		rpcId: string | number,
		params: Record<string, unknown>,
	): void {
		if (
			params.sessionId !== this.acpId ||
			!Array.isArray(params.options) ||
			params.options.length > 32
		)
			throw new Error('invalid permission request');
		const permission: BotPermission = {
			id: randomBytes(12).toString('hex'),
			options: params.options.map((v) => {
				const o = object(v);
				return {
					optionId: text(o.optionId, 256, 'permission option'),
					name: this.credential.redact(text(o.name, 1024, 'permission name')),
					kind: text(o.kind, 64, 'permission kind'),
				};
			}),
			toolCall: redactBotJson(
				(params.toolCall ?? null) as JsonValue,
				this.credential,
			),
		};
		if (this.approvals.size >= 64)
			throw new Error('too many permission requests');
		this.approvals.set(permission.id, { rpcId, permission });
		if (this.expired || !this.turnActive) {
			this.finishApproval(permission.id, this.rejectOutcome(permission));
			return;
		}
		this.emit('permission-request', permission);
		if (this.mode === 'autonomous') {
			const option = permission.options.find((o) => o.kind === 'allow_once');
			this.finishApproval(
				permission.id,
				option
					? { outcome: 'selected', optionId: option.optionId }
					: this.rejectOutcome(permission),
			);
		} else this.emit('permission', permission);
	}
	private rejectOutcome(permission: BotPermission): JsonValue {
		const reject = permission.options.find((o) => o.kind === 'reject_once');
		return reject
			? { outcome: 'selected', optionId: reject.optionId }
			: { outcome: 'cancelled' };
	}
	private rejectPermissions(): void {
		for (const [id, a] of this.approvals)
			this.finishApproval(id, this.rejectOutcome(a.permission));
	}
	private finishApproval(id: string, outcome: JsonValue): void {
		const a = this.approvals.get(id);
		if (!a) return;
		this.approvals.delete(id);
		this.answered.add(id);
		if (this.answered.size > 256)
			this.answered.delete(this.answered.values().next().value!);
		this.write({ jsonrpc: '2.0', id: a.rpcId, result: { outcome } });
		this.emit('permission-answered', id);
	}
	private request(
		method: string,
		params: JsonValue,
		deadlineMs = 30_000,
	): Promise<unknown> {
		if (this.ended || this.pending.size >= 256)
			return Promise.reject(
				new BotError('unavailable', 'ACP connection unavailable'),
			);
		const id = ++this.nextId;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new BotError('timeout', 'ACP request timed out'));
			}, deadlineMs);
			this.pending.set(id, { resolve, reject, timer });
			this.write({ jsonrpc: '2.0', id, method, params });
		});
	}
	private write(value: JsonValue): void {
		if (this.ended) return;
		const line = `${JSON.stringify(value)}\n`;
		if (
			Buffer.byteLength(line) > 2 * 1024 * 1024 ||
			this.process.stdin.writableLength > 4 * 1024 * 1024
		) {
			this.fail();
			this.emit('failure');
			return;
		}
		this.process.stdin.write(line);
	}
	private fail(): void {
		if (this.ended) return;
		this.rejectPermissions();
		this.flushChunks();
		const tail = this.runner.finish();
		if (tail) this.emit('runner', tail);
		this.ended = true;
		for (const p of this.pending.values()) {
			clearTimeout(p.timer);
			p.reject(new BotError('unavailable', 'ACP connection closed'));
		}
		this.pending.clear();
		this.buffer = '';
	}
}
