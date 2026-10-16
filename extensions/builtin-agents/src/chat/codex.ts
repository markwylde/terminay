import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import type {
	AgentChatEvents,
	AgentChatFailure,
	AgentChatProviderRuntime,
	AgentChatSession,
	AgentChatSessionRequest,
	AgentChatToolState,
} from '@terminay/extension-api';
import { defineChatProvider } from '@terminay/extension-api';
import {
	endProcess,
	jsonObject,
	objectOf,
	readLines,
	stderrTail,
} from './process.js';

const REQUEST_TIMEOUT_MS = 30_000;
const INTERRUPT_ACK_MS = 2_000;
const NOT_SIGNED_IN =
	'Codex is not signed in. Run `codex login` in a terminal to sign in.';
const NOT_INSTALLED =
	'Codex is not installed. Install it, or set TERMINAY_CODEX_COMMAND to its path.';

/** Features that reach beyond the MCP server, switched off for every session. */
export const CODEX_ARGUMENTS: readonly string[] = Object.freeze([
	'app-server',
	'--disable',
	'hooks',
	'--disable',
	'browser_use',
	'--disable',
	'computer_use',
	'--disable',
	'apps',
]);

/** Server requests that ask for approval; every one is declined. */
const DECLINES: Readonly<Record<string, unknown>> = Object.freeze({
	'item/commandExecution/requestApproval': { decision: 'decline' },
	'item/fileChange/requestApproval': { decision: 'decline' },
	'item/permissions/requestApproval': { permissions: {}, scope: 'turn' },
	applyPatchApproval: { decision: 'abort' },
	execCommandApproval: { decision: 'abort' },
	'item/tool/requestUserInput': { answers: {} },
	'mcpServer/elicitation/request': {
		action: 'cancel',
		content: null,
		_meta: null,
	},
});

export type CodexChatOptions = {
	/** Resolves the `codex` executable; undefined when it is not installed. */
	locate(): Promise<string | undefined>;
	/** Reported to the app server as the client version. */
	clientVersion?: string;
};

/**
 * The `thread/start` configuration: every MCP server the user configured is
 * switched off by name, and the host's server is the only one added.
 */
export function codexThreadConfig(
	request: AgentChatSessionRequest,
	userServers: readonly string[],
): Record<string, unknown> {
	const config: Record<string, unknown> = {};
	const host = request.mcpServer;
	for (const name of userServers)
		if (name !== host?.name) config[`mcp_servers.${name}.enabled`] = false;
	if (host !== null) {
		config[`mcp_servers.${host.name}.command`] = host.command;
		config[`mcp_servers.${host.name}.args`] = host.args;
		config[`mcp_servers.${host.name}.env`] = host.env ?? {};
		config[`mcp_servers.${host.name}.enabled`] = true;
		// Terminay's own permission policy decides every call on the server,
		// so Codex must not ask a second time.
		config[`mcp_servers.${host.name}.default_tools_approval_mode`] = 'approve';
	}
	return config;
}

/** Codex over `codex app-server` JSON-RPC, one process and one ephemeral thread per session. */
export function createCodexChatProvider(
	options: CodexChatOptions,
): AgentChatProviderRuntime {
	return defineChatProvider({
		async availability() {
			return (await options.locate()) === undefined
				? { available: false, reason: 'not_installed', detail: NOT_INSTALLED }
				: { available: true };
		},
		async openSession(request, events) {
			const executable = await options.locate();
			if (executable === undefined) {
				events.failure({ reason: 'not_installed', detail: NOT_INSTALLED });
				throw new Error(NOT_INSTALLED);
			}
			const session = new CodexSession(executable, request, events);
			await session.start(options.clientVersion ?? '0.0.0');
			return session;
		},
	});
}

interface Pending {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
}

interface Turn {
	id?: string;
	resolve(): void;
	reject(error: Error): void;
	interrupted: boolean;
	lastError?: AgentChatFailure;
	completed?: () => void;
	/** The agent message item text last arrived for, to separate messages. */
	messageItem?: string;
}

class CodexSession implements AgentChatSession {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly stderr: () => string;
	private readonly pending = new Map<number, Pending>();
	private sequence = 0;
	private threadId: string | undefined;
	private turn: Turn | undefined;
	private exited = false;
	private exitReported = false;

	constructor(
		executable: string,
		private readonly request: AgentChatSessionRequest,
		private readonly events: AgentChatEvents,
	) {
		this.child = spawn(executable, [...CODEX_ARGUMENTS], {
			cwd: request.workingDirectory,
			env: process.env,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		this.stderr = stderrTail(this.child);
		this.child.stdin.on('error', () => undefined);
		readLines(this.child.stdout, (line) => this.receive(line));
		this.child.on('error', (error: NodeJS.ErrnoException) => {
			const failure: AgentChatFailure =
				error.code === 'ENOENT'
					? { reason: 'not_installed', detail: NOT_INSTALLED }
					: { reason: 'crashed', detail: error.message };
			this.events.failure(failure);
			this.stopped(new Error(failure.detail));
			this.reportExit(null, null);
		});
		this.child.on('exit', (code, signal) => {
			this.exited = true;
			const turn = this.turn;
			this.turn = undefined;
			if (turn?.interrupted) turn.resolve();
			else if (turn !== undefined) {
				const failure = classify(this.stderr(), undefined, 'crashed');
				this.events.failure(failure);
				turn.reject(new Error(failure.detail ?? 'Codex stopped'));
			}
			this.stopped(new Error('Codex stopped'));
			this.reportExit(code, signal);
		});
	}

	async start(clientVersion: string): Promise<void> {
		try {
			await this.call('initialize', {
				clientInfo: {
					name: 'terminay',
					title: 'Terminay',
					version: clientVersion,
				},
			});
			this.notify('initialized');
			const read = objectOf(
				await this.call('config/read', { cwd: this.request.workingDirectory }),
			);
			const servers = objectOf(objectOf(read?.config)?.mcp_servers) ?? {};
			const started = objectOf(
				await this.call('thread/start', {
					cwd: this.request.workingDirectory,
					sandbox: 'read-only',
					approvalPolicy: 'untrusted',
					ephemeral: true,
					...(this.request.instruction === undefined
						? {}
						: { developerInstructions: this.request.instruction }),
					config: codexThreadConfig(this.request, Object.keys(servers)),
				}),
			);
			const threadId = objectOf(started?.thread)?.id;
			if (typeof threadId !== 'string')
				throw new Error('Codex started no thread');
			this.threadId = threadId;
		} catch (error) {
			const failure = classify(
				error instanceof Error ? error.message : String(error),
				undefined,
				'failed',
			);
			this.events.failure(failure);
			await this.close();
			throw new Error(failure.detail ?? 'Codex could not start');
		}
	}

	prompt(text: string, signal: AbortSignal): Promise<void> {
		const threadId = this.threadId;
		if (this.exited || threadId === undefined)
			return Promise.reject(new Error('Codex has stopped'));
		if (this.turn !== undefined)
			return Promise.reject(new Error('a turn is already running'));
		return new Promise<void>((resolve, reject) => {
			const turn: Turn = { resolve, reject, interrupted: false };
			this.turn = turn;
			signal.addEventListener('abort', () => void this.cancel(), {
				once: true,
			});
			this.call('turn/start', {
				threadId,
				input: [{ type: 'text', text, text_elements: [] }],
			}).then(
				(result) => {
					const id = objectOf(objectOf(result)?.turn)?.id;
					if (typeof id === 'string') turn.id = id;
					if (turn.interrupted) void this.interruptTurn(turn);
				},
				(error: unknown) => {
					if (this.turn !== turn) return;
					this.turn = undefined;
					const failure = classify(
						error instanceof Error ? error.message : String(error),
						undefined,
						'failed',
					);
					this.events.failure(failure);
					reject(new Error(failure.detail ?? 'Codex turn failed'));
				},
			);
		});
	}

	async cancel(): Promise<void> {
		const turn = this.turn;
		if (turn === undefined || turn.interrupted || this.exited) return;
		turn.interrupted = true;
		if (turn.id !== undefined) await this.interruptTurn(turn);
	}

	async close(): Promise<void> {
		await endProcess(this.child);
		this.reportExit(this.child.exitCode, this.child.signalCode);
	}

	private async interruptTurn(turn: Turn): Promise<void> {
		const completed = new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), INTERRUPT_ACK_MS);
			turn.completed = () => {
				clearTimeout(timer);
				resolve(true);
			};
		});
		this.call('turn/interrupt', {
			threadId: this.threadId,
			turnId: turn.id,
		}).catch(() => undefined);
		// An app server that does not end the turn is stopped outright; the turn
		// then ends as cancelled when the process exits.
		if (!(await completed)) await endProcess(this.child, 200);
	}

	private call(method: string, params: unknown): Promise<unknown> {
		if (this.exited) return Promise.reject(new Error('Codex has stopped'));
		const id = ++this.sequence;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Codex did not answer ${method}`));
			}, REQUEST_TIMEOUT_MS);
			this.pending.set(id, { resolve, reject, timer });
			this.write({ jsonrpc: '2.0', id, method, params });
		});
	}

	private notify(method: string, params?: unknown): void {
		this.write({
			jsonrpc: '2.0',
			method,
			...(params === undefined ? {} : { params }),
		});
	}

	private write(message: unknown): void {
		if (this.exited || this.child.stdin.destroyed) return;
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private receive(line: string): void {
		const message = jsonObject(line);
		if (message === undefined) return;
		const method =
			typeof message.method === 'string' ? message.method : undefined;
		if (method !== undefined && message.id !== undefined) {
			this.answer(message.id, method);
			return;
		}
		if (method !== undefined) {
			this.notification(method, objectOf(message.params) ?? {});
			return;
		}
		if (typeof message.id !== 'number') return;
		const pending = this.pending.get(message.id);
		if (pending === undefined) return;
		this.pending.delete(message.id);
		clearTimeout(pending.timer);
		const error = objectOf(message.error);
		if (error !== undefined)
			pending.reject(
				new Error(
					typeof error.message === 'string'
						? error.message
						: 'Codex request failed',
				),
			);
		else pending.resolve(message.result);
	}

	/** Every server request is refused: approvals declined, questions cancelled. */
	private answer(id: unknown, method: string): void {
		const result = DECLINES[method];
		this.write(
			result === undefined
				? {
						jsonrpc: '2.0',
						id,
						error: { code: -32601, message: `${method} is not supported` },
					}
				: { jsonrpc: '2.0', id, result },
		);
	}

	private notification(method: string, params: Record<string, unknown>): void {
		switch (method) {
			case 'item/agentMessage/delta': {
				if (typeof params.delta !== 'string' || params.delta.length === 0)
					return;
				// Codex may send a short preamble and the answer as separate
				// messages; keep them apart as paragraphs.
				const turn = this.turn;
				const item =
					typeof params.itemId === 'string' ? params.itemId : undefined;
				if (turn !== undefined && item !== undefined) {
					if (turn.messageItem !== undefined && turn.messageItem !== item)
						this.events.text('\n\n');
					turn.messageItem = item;
				}
				this.events.text(params.delta);
				return;
			}
			case 'item/started':
			case 'item/completed':
				this.item(objectOf(params.item), method === 'item/started');
				return;
			case 'error': {
				if (params.willRetry === true || this.turn === undefined) return;
				const error = objectOf(params.error);
				this.turn.lastError = classify(
					typeof error?.message === 'string' ? error.message : '',
					error?.codexErrorInfo,
					'failed',
				);
				return;
			}
			case 'turn/completed':
				this.turnCompleted(objectOf(params.turn));
				return;
			default:
				return;
		}
	}

	private item(
		item: Record<string, unknown> | undefined,
		started: boolean,
	): void {
		if (item === undefined || typeof item.id !== 'string') return;
		const state: AgentChatToolState = started
			? 'running'
			: item.status === 'failed' || item.status === 'declined'
				? 'failed'
				: 'completed';
		if (item.type === 'mcpToolCall' && typeof item.tool === 'string')
			this.events.tool({
				callId: item.id,
				...(typeof item.server === 'string' ? { server: item.server } : {}),
				name: item.tool,
				state,
			});
		else if (item.type === 'commandExecution')
			this.events.tool({ callId: item.id, name: 'command', state });
	}

	private turnCompleted(completed: Record<string, unknown> | undefined): void {
		const turn = this.turn;
		if (turn === undefined) return;
		if (turn.id !== undefined && completed?.id !== turn.id) return;
		this.turn = undefined;
		turn.completed?.();
		if (turn.interrupted || completed?.status !== 'failed') {
			turn.resolve();
			return;
		}
		const error = objectOf(completed.error);
		const failure =
			turn.lastError ??
			classify(
				typeof error?.message === 'string' ? error.message : '',
				error?.codexErrorInfo,
				'failed',
			);
		this.events.failure(failure);
		turn.reject(new Error(failure.detail ?? 'Codex turn failed'));
	}

	private stopped(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}

	private reportExit(code: number | null, signal: NodeJS.Signals | null): void {
		if (this.exitReported) return;
		this.exitReported = true;
		this.exited = true;
		this.events.exit({ code, signal });
	}
}

function classify(
	text: string,
	info: unknown,
	fallback: 'crashed' | 'failed',
): AgentChatFailure {
	if (
		info === 'unauthorized' ||
		/not logged in|log ?in required|codex login|unauthori[sz]ed|authentication/i.test(
			text,
		)
	)
		return { reason: 'not_signed_in', detail: NOT_SIGNED_IN };
	return text.length > 0
		? { reason: fallback, detail: text }
		: { reason: fallback };
}
