/** Native CLI protocols adapted from the Atlas runner/stream parsers.
 * See docker/terminay-bot/PORTING.md. Execution and authority remain server-owned. */
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import type {
	BotApprovalMode,
	BotPermission,
	JsonValue,
} from '@terminay/protocol';
import {
	type BotAgentStream,
	type BotCredentialLease,
	redactBotJson,
} from './credentials.js';
import { BotError, object } from './store.js';

export type BotNativeDriver = 'codex-cli' | 'claude-code-cli';
export function nativeArguments(
	driver: BotNativeDriver,
	model: string | null,
	mode: BotApprovalMode,
	servers: readonly JsonValue[],
	token: boolean,
	/** Container paths of the triggering message's images (Codex only). */
	images: readonly string[] = [],
): string[] {
	const mcp = Object.fromEntries(
		servers.map((raw) => {
			const s = object(raw);
			const env = Array.isArray(s.env)
				? Object.fromEntries(
						s.env.map((raw) => {
							const e = object(raw);
							return [String(e.name), String(e.value)];
						}),
					)
				: {};
			return [
				String(s.name),
				{
					command: s.command,
					args: s.args,
					env: Object.fromEntries(
						Object.entries(env).filter(
							([key]) => !key.startsWith('TERMINAY_RUNTIME_'),
						),
					),
				},
			];
		}),
	);
	if (driver === 'claude-code-cli')
		return [
			'-p',
			'--input-format',
			'stream-json',
			'--output-format',
			'stream-json',
			'--verbose',
			'--include-partial-messages',
			'--no-session-persistence',
			'--setting-sources',
			'',
			'--strict-mcp-config',
			'--mcp-config',
			JSON.stringify({ mcpServers: mcp }),
			'--permission-prompt-tool',
			'stdio',
			'--permission-prompts',
			'host',
			'--permission-mode',
			'manual',
			...(token ? ['--bare'] : []),
			...(model ? ['--model', model] : []),
		];
	if (mode !== 'autonomous')
		throw new BotError(
			'unavailable',
			'Codex bots support Autonomous mode only',
		);
	const config: string[] = token
		? [
				'-c',
				'model_providers.openai.env_key="CODEX_API_KEY"',
				'-c',
				'model_providers.openai.requires_openai_auth=false',
				'-c',
				'cli_auth_credentials_store="ephemeral"',
			]
		: [];
	for (const [name, value] of Object.entries(mcp)) {
		if (!/^[a-zA-Z0-9_-]+$/.test(name))
			throw new BotError('validation', 'invalid MCP name');
		config.push(
			'-c',
			`mcp_servers.${name}.command=${JSON.stringify(value.command)}`,
			'-c',
			`mcp_servers.${name}.args=${JSON.stringify(value.args)}`,
			'-c',
			`mcp_servers.${name}.env_vars=["TERMINAY_RUNTIME_SOCKET","TERMINAY_RUNTIME_TOKEN"]`,
		);
		for (const [key, envValue] of Object.entries(value.env))
			config.push(
				'-c',
				`mcp_servers.${name}.env.${key}=${JSON.stringify(envValue)}`,
			);
	}
	return [
		'exec',
		'--json',
		'--skip-git-repo-check',
		'--dangerously-bypass-approvals-and-sandbox',
		...(model ? ['--model', model] : []),
		...config,
		...images.flatMap((path) => ['--image', path]),
		'-',
	];
}
const NATIVE_FRAME_LIMIT = 16 * 1024 * 1024;
/** Screenshots reach the CLI, but diagnostic transcripts retain text/metadata,
 * not megabytes of inline image data. Posted screenshots use durable attachments. */
function diagnosticOutput(value: unknown): string {
	return (
		typeof value === 'string'
			? value
			: JSON.stringify(value, (key, entry) =>
					key === 'data' && typeof entry === 'string' && entry.length > 4096
						? '[binary result omitted]'
						: entry,
				)
	).slice(-65536);
}
interface Approval {
	requestId: string;
	input: JsonValue;
	permission: BotPermission;
}
/** One execution per process. The public shape deliberately matches the host's
 * existing session lifecycle; no ACP messages or adapter are involved. */
export class BotNativeClient extends EventEmitter {
	readonly canLoad = false;
	readonly session = null;
	private readonly stdout = new StringDecoder('utf8');
	private readonly stderr = new StringDecoder('utf8');
	private readonly runner;
	private readonly message;
	private readonly thought;
	private buffer = '';
	private active = false;
	private expired = false;
	private initialized = false;
	private closed = false;
	private terminal = false;
	private resultFailed = false;
	private textDelta = false;
	private nextRequest = 0;
	private initialization?: {
		resolve: () => void;
		reject: (e: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	};
	private promptResult?: Promise<void>;
	private turn?: {
		resolve: () => void;
		reject: (e: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	};
	private readonly approvals = new Map<string, Approval>();
	private readonly answered = new Set<string>();
	constructor(
		readonly process: BotAgentStream,
		private readonly credential: BotCredentialLease,
		private readonly driver: BotNativeDriver,
		private readonly mode: BotApprovalMode,
		private readonly interrupt?: () => Promise<void>,
	) {
		super();
		this.runner = credential.stream();
		this.message = credential.stream();
		this.thought = credential.stream();
		process.stdout.on('data', (chunk: Buffer) =>
			this.receive(this.stdout.write(chunk)),
		);
		process.stderr.on('data', (chunk: Buffer) => {
			const value = this.runner.push(this.stderr.write(chunk));
			if (value) this.emit('runner', value);
		});
		process.stdin.on('error', () => this.fail());
		process.once('error', () => this.fail());
		process.once('close', (code: number | null) => {
			if (this.closed) return;
			this.receive(this.stdout.end());
			if (this.buffer.trim()) this.fail();
			const tail = this.runner.push(this.stderr.end()) + this.runner.finish();
			if (tail) this.emit('runner', tail);
			this.flushText();
			this.rejectPermissions();
			this.closed = true;
			if (this.terminal && !this.resultFailed && code === 0) this.finish();
			else this.fail();
			this.emit('closed');
		});
	}
	get permissions(): BotPermission[] {
		return structuredClone(
			[...this.approvals.values()].map((a) => a.permission),
		);
	}
	initialize(): Promise<void> {
		if (this.driver === 'codex-cli') {
			this.initialized = true;
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => this.fail(), 30000);
			this.initialization = { resolve, reject, timer };
			this.write({
				type: 'control_request',
				request_id: 'initialize',
				request: { subtype: 'initialize' },
			});
		});
	}
	async open(
		load: string | null,
		_model: string | null,
		_mcp: readonly JsonValue[] = [],
	): Promise<boolean> {
		if (load)
			throw new BotError(
				'unavailable',
				'Native bot executions cannot resume historical sessions',
			);
		return true;
	}
	/** `images` reach Claude Code as content blocks; Codex receives them as `--image` launch arguments. */
	prompt(
		prompt: string,
		maxTurnMs: number,
		images: readonly { mime: string; bytes: Uint8Array }[] = [],
	): Promise<void> {
		if (!this.initialized || this.active || this.closed)
			return Promise.reject(
				new BotError('unavailable', 'Native agent is not ready'),
			);
		this.active = true;
		const result = new Promise<void>((resolve, reject) => {
			this.turn = {
				resolve,
				reject,
				timer: setTimeout(() => {
					this.timeout();
					this.fail();
				}, maxTurnMs + 30000),
			};
		});
		this.promptResult = result;
		if (this.driver === 'codex-cli') this.process.stdin.end(`${prompt}\n`);
		else
			this.write({
				type: 'user',
				message: {
					role: 'user',
					content: images.length
						? [
								{ type: 'text', text: prompt },
								...images.map((image) => ({
									type: 'image',
									source: {
										type: 'base64',
										media_type: image.mime,
										data: Buffer.from(image.bytes).toString('base64'),
									},
								})),
							]
						: prompt,
				},
				parent_tool_use_id: null,
				session_id: '',
			});
		return result;
	}
	async cancel(): Promise<void> {
		this.expired = true;
		this.rejectPermissions();
		if (this.closed || !this.active) return;
		if (this.driver === 'claude-code-cli')
			this.write({
				type: 'control_request',
				request_id: `interrupt-${++this.nextRequest}`,
				request: { subtype: 'interrupt' },
			});
		if (this.driver === 'codex-cli') await this.interrupt?.();
		// The supervisor owns termination for both CLIs; never signal an engine exec client.
		await this.promptResult;
	}
	timeout(): void {
		this.expired = true;
		this.rejectPermissions();
	}
	answer(id: string, optionId: string): void {
		const a = this.approvals.get(id);
		if (!a)
			throw new BotError(
				'conflict',
				this.answered.has(id)
					? 'already answered'
					: 'permission request is no longer active',
			);
		if (!a.permission.options.some((o) => o.optionId === optionId))
			throw new BotError('validation', 'unknown permission option');
		this.respond(id, optionId === 'allow' && !this.expired && this.active);
	}
	closeInput(): void {
		this.rejectPermissions();
		this.process.stdin.end();
	}
	dispose(): void {
		this.fail();
		this.removeAllListeners();
	}
	private write(value: unknown): void {
		if (this.closed || this.process.stdin.writableLength > 262144) {
			this.fail();
			return;
		}
		const line = `${JSON.stringify(value)}\n`;
		if (Buffer.byteLength(line) > NATIVE_FRAME_LIMIT) {
			this.fail();
			return;
		}
		this.process.stdin.write(line);
	}
	private receive(chunk: string): void {
		this.buffer += chunk;
		let index = this.buffer.indexOf('\n');
		while (index >= 0) {
			const line = this.buffer.slice(0, index);
			this.buffer = this.buffer.slice(index + 1);
			if (Buffer.byteLength(line) > NATIVE_FRAME_LIMIT) {
				this.fail();
				return;
			}
			try {
				if (line.trim()) this.event(object(JSON.parse(line)));
			} catch {
				this.fail();
				return;
			}
			index = this.buffer.indexOf('\n');
		}
		if (Buffer.byteLength(this.buffer) > NATIVE_FRAME_LIMIT) this.fail();
	}
	private text(value: string, thought = false): void {
		const safe = (thought ? this.thought : this.message).push(value);
		if (safe)
			this.emit('update', {
				sessionUpdate: thought ? 'agent_thought_chunk' : 'agent_message_chunk',
				content: { type: 'text', text: safe },
			});
	}
	private flushText(): void {
		for (const [redactor, type] of [
			[this.message, 'agent_message_chunk'],
			[this.thought, 'agent_thought_chunk'],
		] as const) {
			const text = redactor.finish();
			if (text)
				this.emit('update', {
					sessionUpdate: type,
					content: { type: 'text', text },
				});
		}
	}
	private update(value: Record<string, unknown>): void {
		this.emit('update', redactBotJson(value as JsonValue, this.credential));
	}
	private event(e: Record<string, unknown>): void {
		if (this.driver === 'claude-code-cli') {
			if (e.type === 'control_response') {
				const response = object(e.response);
				if (response.request_id === 'initialize') {
					if (response.subtype !== 'success') {
						this.fail();
						return;
					}
					this.initialized = true;
					const init = this.initialization;
					this.initialization = undefined;
					if (init) {
						clearTimeout(init.timer);
						init.resolve();
					}
				}
			} else if (e.type === 'control_request') {
				const request = object(e.request);
				if (Buffer.byteLength(JSON.stringify(request)) > 131072) {
					this.fail();
					return;
				}
				if (
					request.subtype !== 'can_use_tool' ||
					typeof e.request_id !== 'string'
				) {
					this.fail();
					return;
				}
				if (this.approvals.size >= 64) {
					this.fail();
					return;
				}
				const permission: BotPermission = {
					id: randomBytes(12).toString('hex'),
					options: [
						{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
						{ optionId: 'deny', name: 'Deny', kind: 'reject_once' },
					],
					toolCall: redactBotJson(
						{
							title: String(request.tool_name),
							rawInput: (request.input ?? null) as JsonValue,
						},
						this.credential,
					),
				};
				this.approvals.set(permission.id, {
					requestId: e.request_id,
					input: (request.input ?? {}) as JsonValue,
					permission,
				});
				if (this.expired || !this.active) {
					this.respond(permission.id, false);
					return;
				}
				this.emit('permission-request', permission);
				if (this.mode === 'autonomous') this.respond(permission.id, true);
				else this.emit('permission', permission);
			} else if (e.type === 'stream_event') {
				const event = object(e.event);
				if (event.type === 'content_block_delta') {
					const delta = object(event.delta);
					if (typeof delta.text === 'string') {
						this.textDelta = true;
						this.text(delta.text);
					} else if (typeof delta.thinking === 'string')
						this.text(delta.thinking, true);
				}
			} else if (e.type === 'system' && e.subtype === 'task_progress') {
				this.update({
					sessionUpdate: 'plan',
					entries: [
						{
							content: String(e.description ?? 'Working'),
							status: 'in_progress',
							priority: 'medium',
						},
					],
				});
			} else if (e.type === 'assistant') {
				if (e.error) this.resultFailed = true;
				const message = object(e.message);
				for (const raw of Array.isArray(message.content)
					? message.content
					: []) {
					const part = object(raw);
					if (
						part.type === 'text' &&
						!this.textDelta &&
						typeof part.text === 'string'
					)
						this.text(part.text);
					if (part.type === 'tool_use')
						this.update({
							sessionUpdate: 'tool_call',
							toolCallId: String(part.id),
							title: String(part.name),
							kind: 'other',
							status: 'in_progress',
							rawInput: part.input ?? null,
							...(part.name === 'child' ? { rawOutput: part.input } : {}),
						});
				}
			} else if (e.type === 'user') {
				const message = object(e.message);
				for (const raw of Array.isArray(message.content)
					? message.content
					: []) {
					const part = object(raw);
					if (part.type === 'tool_result')
						this.update({
							sessionUpdate: 'tool_call_update',
							toolCallId: String(part.tool_use_id),
							status: part.is_error ? 'failed' : 'completed',
							rawOutput: diagnosticOutput(part.content ?? ''),
						});
				}
			} else if (e.type === 'result') {
				this.terminal = true;
				this.resultFailed ||= e.is_error === true || e.subtype !== 'success';
				if (!this.textDelta && typeof e.result === 'string')
					this.text(e.result);
				this.closeInput();
			}
		} else {
			if (e.type === 'turn.completed') this.terminal = true;
			if (e.type === 'turn.failed' || e.type === 'error') {
				this.resultFailed = true;
				this.update({
					sessionUpdate: 'agent_message_chunk',
					content: { type: 'text', text: JSON.stringify(e) },
				});
			}
			if (
				['item.started', 'item.updated', 'item.completed'].includes(
					String(e.type),
				)
			) {
				const item = object(e.item),
					done = e.type === 'item.completed';
				if (
					item.type === 'agent_message' &&
					done &&
					typeof item.text === 'string'
				)
					this.text(item.text);
				else if (item.type === 'todo_list')
					this.update({
						sessionUpdate: 'plan',
						entries: (Array.isArray(item.items)
							? item.items.slice(0, 128)
							: []
						).map((raw) => {
							const todo = object(raw);
							return {
								content: String(todo.text ?? ''),
								priority: 'medium',
								status: todo.completed ? 'completed' : 'pending',
							};
						}),
					});
				else if (
					item.type === 'reasoning' &&
					done &&
					typeof item.text === 'string'
				)
					this.text(item.text, true);
				else if (item.type !== 'agent_message' && item.type !== 'reasoning')
					this.update({
						sessionUpdate:
							e.type === 'item.started' ? 'tool_call' : 'tool_call_update',
						toolCallId: String(item.id),
						title: String(item.command ?? item.tool ?? item.type),
						kind: 'other',
						status: done
							? item.status === 'failed'
								? 'failed'
								: 'completed'
							: 'in_progress',
						rawInput: done ? (item.arguments ?? null) : null,
						rawOutput: done
							? typeof item.aggregated_output === 'string'
								? item.aggregated_output
								: diagnosticOutput(item)
							: '',
					});
			}
		}
	}
	private respond(id: string, allow: boolean): void {
		const a = this.approvals.get(id);
		if (!a) return;
		this.approvals.delete(id);
		this.answered.add(id);
		if (this.answered.size > 256)
			this.answered.delete(this.answered.values().next().value!);
		this.write({
			type: 'control_response',
			response: {
				subtype: 'success',
				request_id: a.requestId,
				response: allow
					? { behavior: 'allow', updatedInput: a.input }
					: { behavior: 'deny', message: 'Denied by Terminay' },
			},
		});
		this.emit('permission-answered', id);
	}
	private rejectPermissions(): void {
		for (const id of this.approvals.keys()) this.respond(id, false);
	}
	private finish(): void {
		this.active = false;
		const turn = this.turn;
		this.turn = undefined;
		if (turn) {
			clearTimeout(turn.timer);
			turn.resolve();
		}
	}
	private fail(): void {
		const error = new BotError(
			'unavailable',
			'The native agent could not complete the request. See Runner output for details.',
		);
		const init = this.initialization;
		this.initialization = undefined;
		if (init) {
			clearTimeout(init.timer);
			init.reject(error);
		}
		const turn = this.turn;
		this.turn = undefined;
		if (turn) {
			clearTimeout(turn.timer);
			turn.reject(error);
		}
		this.active = false;
		this.emit('failure');
	}
}
