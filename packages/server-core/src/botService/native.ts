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
/** Variables a server receives from the agent process rather than its config. */
function isForwarded(name: string): boolean {
	return (
		name.startsWith('TERMINAY_RUNTIME_') || name.startsWith('TERMINAY_MCP_')
	);
}

export function nativeArguments(
	driver: BotNativeDriver,
	model: string | null,
	mode: BotApprovalMode,
	servers: readonly JsonValue[],
	token: boolean,
	/** Container paths of the triggering message's images (Codex only). */
	images: readonly string[] = [],
): string[] {
	// Each server's socket and secret are forwarded from the agent process by
	// name, never written into argv or the MCP config.
	const forwarded: Record<string, string[]> = {};
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
			forwarded[String(s.name)] = Object.keys(env).filter(isForwarded);
			return [
				String(s.name),
				{
					command: s.command,
					args: s.args,
					env: Object.fromEntries(
						Object.entries(env).filter(([key]) => !isForwarded(key)),
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
		);
		const names = forwarded[name] ?? [];
		if (names.length > 0)
			config.push(
				'-c',
				`mcp_servers.${name}.env_vars=${JSON.stringify(names)}`,
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
/** How long an execution waits on background work before it is asked, and
 * again after each further wait (ADR-0149). */
export const BOT_DONE_CHECK_INTERVAL_MS = 5 * 60_000;
/** How long an agent has to exit once its done answer is accepted. */
export const BOT_DONE_SHUTDOWN_MS = 30_000;
export interface BotNativeTimers {
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}
const nativeTimers: BotNativeTimers = {
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (handle) =>
		clearTimeout(handle as ReturnType<typeof setTimeout>),
};
/** One background task Claude Code lists as running. */
export interface BotNativeTask {
	readonly id: string;
	readonly kind: string;
	readonly description: string;
}
/** What holds an execution open. Descriptions are redacted agent text. */
export interface BotNativeWait {
	readonly waiting: boolean;
	readonly items: readonly BotNativeTask[];
	/** Follow-up turns still expected for finished background tasks. */
	readonly followUps: number;
}
const doneLine = (nonce: string) => `TERMINAY-DONE ${nonce}`;
/** A whole line, so a quotation inside a sentence never counts. */
function saysDone(reply: string, nonce: string): boolean {
	return reply
		.split('\n')
		.some((line) => line.replace(/[`*]/g, '').trim() === doneLine(nonce));
}
function doneCheck(
	nonce: string,
	tasks: readonly BotNativeTask[],
	followUps: number,
): string {
	const listed = tasks
		.slice(0, 8)
		.map(
			(task) =>
				`- ${task.kind}: ${JSON.stringify(task.description.slice(0, 128))}`,
		);
	if (tasks.length > 8) listed.push(`- and ${tasks.length - 8} more`);
	if (followUps > 0)
		listed.push('- a follow-up turn for a finished background task');
	return [
		'Terminay check: your turn ended, but this session is still running because it is waiting on background work.',
		...(listed.length ? listed : ['- nothing Terminay can list']),
		'Are you done? If your task is completely finished, including anything you meant to post, reply with this line on its own:',
		doneLine(nonce),
		'Terminay will then stop your background work and end this session as completed. If you are still waiting for something you need, do not write that line; say what you are waiting for. The session keeps running and you will be asked again in 5 minutes. Do not post to chat about this check.',
	].join('\n');
}
interface Approval {
	requestId: string;
	input: JsonValue;
	permission: BotPermission;
}
/**
 * The whole line Claude Code writes to its own stderr when it ends background
 * work at its print-mode ceiling. Tool output and replies travel on stdout.
 */
const BACKGROUND_STOPPED_LINE =
	/^Background tasks still running .+ after the last turn \(.*\); stopping them\. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely\.$/;
const STDERR_LINE_LIMIT = 8192;
/** The agent ended its own background work, so its task did not finish. */
export const BOT_BACKGROUND_STOPPED_REASON =
	'The agent stopped its background work at a time limit before it finished, so this task may be incomplete.';
export class BotBackgroundStoppedError extends BotError {
	constructor() {
		super('unavailable', BOT_BACKGROUND_STOPPED_REASON);
		this.name = 'BotBackgroundStoppedError';
	}
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
	private claudeTasks: BotNativeTask[] = [];
	private claudePendingWakeups = 0;
	/** The agent's input is held open and no turn is running. */
	private waiting = false;
	private checkTimer?: unknown;
	/** The latest done check's nonce; only its line is accepted. */
	private checkNonce?: string;
	/** Checks sent whose turn has not started. */
	private unstartedChecks = 0;
	private checkTurn = false;
	/** Set once the done answer is accepted. */
	private done?: { readonly failed: boolean };
	private doneTimer?: unknown;
	private readonly stopping = new Set<string>();
	private claudeApprovalStreamClosed = false;
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
	};
	private stderrLine = '';
	private backgroundStopped = false;
	private readonly approvals = new Map<string, Approval>();
	private readonly answered = new Set<string>();
	constructor(
		readonly process: BotAgentStream,
		private readonly credential: BotCredentialLease,
		private readonly driver: BotNativeDriver,
		private readonly mode: BotApprovalMode,
		private readonly interrupt?: () => Promise<void>,
		private readonly timers: BotNativeTimers = nativeTimers,
	) {
		super();
		this.runner = credential.stream();
		this.message = credential.stream();
		this.thought = credential.stream();
		process.stdout.on('data', (chunk: Buffer) =>
			this.receive(this.stdout.write(chunk)),
		);
		process.stderr.on('data', (chunk: Buffer) => {
			const raw = this.stderr.write(chunk);
			this.scanStderr(raw);
			const value = this.runner.push(raw);
			if (value) this.emit('runner', value);
		});
		process.stdin.on('error', () => this.fail());
		process.once('error', () => this.fail());
		process.once('close', (code: number | null) => {
			if (this.closed) return;
			this.receive(this.stdout.end());
			if (this.buffer.trim()) this.fail();
			const rest = this.stderr.end();
			this.scanStderr(`${rest}\n`);
			const tail = this.runner.push(rest) + this.runner.finish();
			if (tail) this.emit('runner', tail);
			this.flushText();
			this.rejectPermissions();
			this.closed = true;
			this.endWait();
			if (this.done) this.settleDone();
			else if (
				this.terminal &&
				!this.resultFailed &&
				!this.claudeApprovalStreamClosed &&
				!this.backgroundStopped &&
				code === 0
			)
				this.finish();
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
		images: readonly { mime: string; bytes: Uint8Array }[] = [],
	): Promise<void> {
		if (!this.initialized || this.active || this.closed)
			return Promise.reject(
				new BotError('unavailable', 'Native agent is not ready'),
			);
		this.active = true;
		const result = new Promise<void>((resolve, reject) => {
			this.turn = { resolve, reject };
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
		this.endWait();
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
	/** Whole lines only, so a fragment of other stderr can never match. */
	private scanStderr(value: string): void {
		if (this.driver !== 'claude-code-cli') return;
		const lines = `${this.stderrLine}${value}`.split('\n');
		this.stderrLine = (lines.pop() ?? '').slice(-STDERR_LINE_LIMIT);
		if (lines.some((line) => BACKGROUND_STOPPED_LINE.test(line.trimEnd())))
			this.backgroundStopped = true;
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
		this.endWait();
		this.rejectPermissions();
		this.process.stdin.end();
	}
	dispose(): void {
		this.fail();
		this.removeAllListeners();
	}
	private write(value: unknown): void {
		// After an accepted done answer the input may already be closed.
		if (this.done && (this.closed || this.process.stdin.writableEnded)) return;
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
				if (this.expired || !this.active || this.done) {
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
			} else if (
				e.type === 'system' &&
				e.subtype === 'background_tasks_changed' &&
				Array.isArray(e.tasks)
			) {
				this.claudeTasks = e.tasks.map((raw) => {
					const task = object(raw);
					return {
						id: String(task.task_id),
						kind: String(task.task_type ?? 'task'),
						description: String(task.description ?? ''),
					};
				});
				if (this.done) this.stopTasks();
				else if (this.waiting) this.emitWait();
			} else if (
				e.type === 'system' &&
				e.subtype === 'task_notification' &&
				(e.status === 'completed' || e.status === 'failed')
			) {
				// Claude queues a turn per completed or failed background task.
				this.claudePendingWakeups++;
				if (this.waiting) this.emitWait();
			} else if (e.type === 'system' && e.subtype === 'init') {
				// One init per check sent is the check's own, so a check never
				// accounts for a notification's turn, whichever starts first.
				this.checkTurn = this.unstartedChecks > 0;
				if (this.checkTurn) this.unstartedChecks--;
				else if (this.claudePendingWakeups > 0) this.claudePendingWakeups--;
				this.endWait();
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
					if (part.type !== 'tool_result') continue;
					if (
						part.is_error === true &&
						part.content ===
							'Tool permission request failed: AbortError: Stream closed' &&
						Array.isArray(e.tool_result_meta) &&
						e.tool_result_meta.some((raw) => {
							const meta = object(raw);
							return (
								meta.id === part.tool_use_id &&
								meta.non_execution_kind === 'permission-rule'
							);
						})
					)
						this.claudeApprovalStreamClosed = true;
					this.update({
						sessionUpdate: 'tool_call_update',
						toolCallId: String(part.tool_use_id),
						status: part.is_error ? 'failed' : 'completed',
						rawOutput: diagnosticOutput(part.content ?? ''),
					});
				}
			} else if (e.type === 'result') {
				if (!this.textDelta && typeof e.result === 'string')
					this.text(e.result);
				// The done answer already decided the outcome.
				if (this.done) return;
				const failed = e.is_error === true || e.subtype !== 'success';
				const checked = this.checkTurn;
				this.checkTurn = false;
				if (
					!failed &&
					!this.expired &&
					this.active &&
					this.checkNonce !== undefined &&
					typeof e.result === 'string' &&
					saysDone(e.result, this.checkNonce)
				) {
					this.acceptDone();
					return;
				}
				if (checked) this.emit('done-answer', 'waiting');
				this.terminal =
					this.claudeTasks.length === 0 &&
					this.claudePendingWakeups === 0 &&
					this.unstartedChecks === 0;
				this.resultFailed ||= failed;
				// A background notification can wake Claude for another turn.
				if (this.terminal) this.closeInput();
				else this.startWait();
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
	private emitWait(): void {
		const wait: BotNativeWait = {
			waiting: this.waiting,
			items: this.claudeTasks.map((task) => ({
				id: this.credential.redact(task.id),
				kind: this.credential.redact(task.kind),
				// Redacted before anything cuts it, so no part of a secret stays.
				description: this.credential.redact(task.description),
			})),
			followUps: this.claudePendingWakeups,
		};
		this.emit('background-wait', wait);
	}
	private startWait(): void {
		if (this.expired || !this.active || this.closed) return;
		this.waiting = true;
		this.armCheck();
		this.emitWait();
	}
	private endWait(): void {
		if (this.checkTimer !== undefined)
			this.timers.clearTimeout(this.checkTimer);
		this.checkTimer = undefined;
		if (!this.waiting) return;
		this.waiting = false;
		this.emitWait();
	}
	/**
	 * ADR-0028: a repeating timer the owner approved on 2026-11-28 in ticket
	 * 680 ("asks again after another 5 minutes"), recorded in ADR-0149. A
	 * process held open by background work emits nothing that could be watched.
	 */
	private armCheck(): void {
		if (this.checkTimer !== undefined)
			this.timers.clearTimeout(this.checkTimer);
		this.checkTimer = this.timers.setTimeout(
			() => this.askWhetherDone(),
			BOT_DONE_CHECK_INTERVAL_MS,
		);
		(this.checkTimer as { unref?: () => void } | undefined)?.unref?.();
	}
	private askWhetherDone(): void {
		this.checkTimer = undefined;
		if (!this.waiting || this.expired || !this.active || this.closed) return;
		this.armCheck();
		// The agent cannot answer while the user is deciding.
		if (this.approvals.size > 0) return;
		this.checkNonce = randomBytes(8).toString('hex');
		this.unstartedChecks++;
		const text = doneCheck(
			this.checkNonce,
			this.claudeTasks.map((task) => ({
				...task,
				kind: this.credential.redact(task.kind),
				description: this.credential.redact(task.description),
			})),
			this.claudePendingWakeups,
		);
		this.emit('done-check', this.credential.redact(text));
		this.write({
			type: 'user',
			message: { role: 'user', content: text },
			parent_tool_use_id: null,
			session_id: '',
		});
	}
	/** The agent says its task is finished, so the execution now ends. */
	private acceptDone(): void {
		this.endWait();
		this.done = {
			failed: this.resultFailed || this.claudeApprovalStreamClosed,
		};
		this.emit('done-answer', 'done');
		this.rejectPermissions();
		// Bounds shutdown only. The host then ends the process group.
		this.doneTimer = this.timers.setTimeout(
			() => this.settleDone(),
			BOT_DONE_SHUTDOWN_MS,
		);
		(this.doneTimer as { unref?: () => void } | undefined)?.unref?.();
		this.stopTasks();
	}
	/** Subagents first, so that ending one of their commands cannot resume them. */
	private stopTasks(): void {
		if (this.closed || this.process.stdin.writableEnded) return;
		if (this.claudeTasks.length === 0) {
			this.closeInput();
			return;
		}
		const agentsFirst = [...this.claudeTasks].sort(
			(a, b) =>
				Number(b.kind === 'local_agent') - Number(a.kind === 'local_agent'),
		);
		for (const task of agentsFirst) {
			if (this.stopping.has(task.id)) continue;
			this.stopping.add(task.id);
			this.write({
				type: 'control_request',
				request_id: `stop-${++this.nextRequest}`,
				request: { subtype: 'stop_task', task_id: task.id },
			});
		}
	}
	private settleDone(): void {
		if (this.doneTimer !== undefined) this.timers.clearTimeout(this.doneTimer);
		this.doneTimer = undefined;
		if (this.backgroundStopped || this.done?.failed)
			this.reject(this.failure());
		else this.finish();
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
		turn?.resolve();
	}
	private failure(): BotError {
		if (this.backgroundStopped) return new BotBackgroundStoppedError();
		// A closed approval stream after a done answer is not what failed it.
		const approvalLost = this.done ? false : this.claudeApprovalStreamClosed;
		return new BotError(
			'unavailable',
			approvalLost
				? 'Claude Code lost its approval channel before a tool could run.'
				: 'The native agent could not complete the request. See Runner output for details.',
		);
	}
	private fail(): void {
		this.endWait();
		// A broken pipe or frame while shutting down does not undo the answer.
		if (this.done) {
			this.settleDone();
			return;
		}
		this.reject(this.failure());
		this.emit('failure');
	}
	private reject(error: BotError): void {
		const init = this.initialization;
		this.initialization = undefined;
		if (init) {
			clearTimeout(init.timer);
			init.reject(error);
		}
		const turn = this.turn;
		this.turn = undefined;
		turn?.reject(error);
		this.active = false;
	}
}
