import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import type {
	AgentChatEvents,
	AgentChatFailure,
	AgentChatProviderRuntime,
	AgentChatSession,
	AgentChatSessionRequest,
} from '@terminay/extension-api';
import { defineChatProvider } from '@terminay/extension-api';
import {
	endProcess,
	jsonObject,
	objectOf,
	readLines,
	stderrTail,
} from './process.js';

const INTERRUPT_ACK_MS = 2_000;
const NOT_SIGNED_IN =
	'Claude Code is not signed in. Run `claude` in a terminal to sign in.';
const NOT_INSTALLED =
	'Claude Code is not installed. Install it, or set TERMINAY_CLAUDE_CODE_COMMAND to its path.';

export type ClaudeCodeChatOptions = {
	/** Resolves the `claude` executable; undefined when it is not installed. */
	locate(): Promise<string | undefined>;
};

/**
 * The arguments that confine a session: no built-in tools, no user settings
 * or hooks, only the host's MCP server, every other permission prompt denied,
 * and no session history on disk.
 */
export function claudeCodeArguments(
	request: AgentChatSessionRequest,
): string[] {
	const server = request.mcpServer;
	const mcpConfig = {
		mcpServers:
			server === null
				? {}
				: {
						[server.name]: {
							command: server.command,
							args: server.args,
							...(server.env === undefined ? {} : { env: server.env }),
						},
					},
	};
	return [
		'-p',
		'--input-format',
		'stream-json',
		'--output-format',
		'stream-json',
		'--verbose',
		'--include-partial-messages',
		'--tools',
		'',
		'--setting-sources',
		'',
		'--strict-mcp-config',
		'--mcp-config',
		JSON.stringify(mcpConfig),
		...(server === null ? [] : ['--allowedTools', `mcp__${server.name}`]),
		'--permission-prompts',
		'none',
		'--no-session-persistence',
		...(request.instruction === undefined || request.instruction.length === 0
			? []
			: ['--append-system-prompt', request.instruction]),
	];
}

/** Claude Code over `claude --print` streaming JSON, one process per session. */
export function createClaudeCodeChatProvider(
	options: ClaudeCodeChatOptions,
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
			return new ClaudeCodeSession(executable, request, events);
		},
	});
}

interface Turn {
	resolve(): void;
	reject(error: Error): void;
	interrupted: boolean;
}

class ClaudeCodeSession implements AgentChatSession {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly stderr: () => string;
	private turn: Turn | undefined;
	private interrupt: { id: string; acknowledged: () => void } | undefined;
	private sequence = 0;
	private exited = false;
	private exitReported = false;

	constructor(
		executable: string,
		request: AgentChatSessionRequest,
		private readonly events: AgentChatEvents,
	) {
		this.child = spawn(executable, claudeCodeArguments(request), {
			cwd: request.workingDirectory,
			env: process.env,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		this.stderr = stderrTail(this.child);
		this.child.stdin.on('error', () => undefined);
		readLines(this.child.stdout, (line) => this.receive(line));
		this.child.on('error', (error: NodeJS.ErrnoException) => {
			this.fail(
				error.code === 'ENOENT'
					? { reason: 'not_installed', detail: NOT_INSTALLED }
					: { reason: 'crashed', detail: error.message },
			);
			this.reportExit(null, null);
		});
		this.child.on('exit', (code, signal) => {
			this.exited = true;
			if (this.turn !== undefined) {
				const turn = this.turn;
				this.turn = undefined;
				if (turn.interrupted) turn.resolve();
				else {
					const failure = classify(this.stderr(), 'crashed');
					this.events.failure(failure);
					turn.reject(new Error(failure.detail ?? 'Claude Code stopped'));
				}
			}
			this.reportExit(code, signal);
		});
	}

	prompt(text: string, signal: AbortSignal): Promise<void> {
		if (this.exited)
			return Promise.reject(new Error('Claude Code has stopped'));
		if (this.turn !== undefined)
			return Promise.reject(new Error('a turn is already running'));
		return new Promise<void>((resolve, reject) => {
			this.turn = { resolve, reject, interrupted: false };
			signal.addEventListener('abort', () => void this.cancel(), {
				once: true,
			});
			this.write({
				type: 'user',
				message: { role: 'user', content: text },
			});
		});
	}

	async cancel(): Promise<void> {
		const turn = this.turn;
		if (turn === undefined || turn.interrupted || this.exited) return;
		turn.interrupted = true;
		const id = `terminay-interrupt-${++this.sequence}`;
		const acknowledged = new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), INTERRUPT_ACK_MS);
			this.interrupt = {
				id,
				acknowledged: () => {
					clearTimeout(timer);
					resolve(true);
				},
			};
		});
		this.write({
			type: 'control_request',
			request_id: id,
			request: { subtype: 'interrupt' },
		});
		// An agent that does not answer the interrupt is stopped outright; the
		// turn then ends as cancelled when the process exits.
		if (!(await acknowledged)) await endProcess(this.child, 200);
	}

	async close(): Promise<void> {
		await endProcess(this.child);
		this.reportExit(this.child.exitCode, this.child.signalCode);
	}

	private write(message: unknown): void {
		if (this.exited || this.child.stdin.destroyed) return;
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private receive(line: string): void {
		const message = jsonObject(line);
		if (message === undefined) return;
		switch (message.type) {
			case 'stream_event': {
				if (message.parent_tool_use_id) return;
				const event = objectOf(message.event);
				const delta = objectOf(event?.delta);
				if (
					event?.type === 'content_block_delta' &&
					delta?.type === 'text_delta' &&
					typeof delta.text === 'string' &&
					delta.text.length > 0
				)
					this.events.text(delta.text);
				return;
			}
			case 'assistant':
				for (const block of contentOf(message)) {
					if (
						block.type !== 'tool_use' ||
						typeof block.id !== 'string' ||
						this.toolNames.has(block.id)
					)
						continue;
					const named = toolName(block.name);
					this.toolNames.set(block.id, named);
					this.events.tool({ callId: block.id, ...named, state: 'running' });
				}
				return;
			case 'user':
				for (const block of contentOf(message)) {
					if (
						block.type !== 'tool_result' ||
						typeof block.tool_use_id !== 'string'
					)
						continue;
					this.toolResult(block.tool_use_id, block.is_error === true);
				}
				return;
			case 'control_response': {
				const response = objectOf(message.response);
				if (
					this.interrupt !== undefined &&
					response?.request_id === this.interrupt.id
				) {
					this.interrupt.acknowledged();
					this.interrupt = undefined;
				}
				return;
			}
			case 'result':
				this.finishTurn(message);
				return;
			default:
				return;
		}
	}

	/** Names arrive only in the tool-use block, so results reuse its call id. */
	private readonly toolNames = new Map<
		string,
		{ server?: string; name: string }
	>();

	private toolResult(callId: string, failed: boolean): void {
		const known = this.toolNames.get(callId);
		if (known === undefined) return;
		this.toolNames.delete(callId);
		this.events.tool({
			callId,
			...known,
			state: failed ? 'failed' : 'completed',
		});
	}

	private finishTurn(result: Record<string, unknown>): void {
		const turn = this.turn;
		if (turn === undefined) return;
		this.turn = undefined;
		this.interrupt?.acknowledged();
		this.interrupt = undefined;
		if (
			turn.interrupted ||
			(result.subtype === 'success' && !result.is_error)
		) {
			turn.resolve();
			return;
		}
		const text =
			typeof result.result === 'string'
				? result.result
				: Array.isArray(result.errors)
					? result.errors.filter((item) => typeof item === 'string').join('\n')
					: '';
		const failure = classify(text || this.stderr(), 'failed');
		this.events.failure(failure);
		turn.reject(new Error(failure.detail ?? 'Claude Code turn failed'));
	}

	private fail(failure: AgentChatFailure): void {
		this.events.failure(failure);
		const turn = this.turn;
		this.turn = undefined;
		turn?.reject(new Error(failure.detail ?? failure.reason));
	}

	private reportExit(code: number | null, signal: NodeJS.Signals | null): void {
		if (this.exitReported) return;
		this.exitReported = true;
		this.exited = true;
		this.events.exit({ code, signal });
	}
}

function contentOf(
	message: Record<string, unknown>,
): Array<Record<string, unknown>> {
	const content = objectOf(message.message)?.content;
	return Array.isArray(content)
		? content.filter(
				(block): block is Record<string, unknown> =>
					objectOf(block) !== undefined,
			)
		: [];
}

/** `mcp__terminay_chat__read_terminal` → server `terminay_chat`, name `read_terminal`. */
export function toolName(value: unknown): { server?: string; name: string } {
	const name = typeof value === 'string' && value.length > 0 ? value : 'tool';
	const match = /^mcp__([^_].*?)__(.+)$/.exec(name);
	return match?.[1] && match[2]
		? { server: match[1], name: match[2] }
		: { name };
}

function classify(
	text: string,
	fallback: 'crashed' | 'failed',
): AgentChatFailure {
	if (
		/not logged in|please run \/login|invalid api key|authentication|unauthori[sz]ed|oauth token/i.test(
			text,
		)
	)
		return { reason: 'not_signed_in', detail: NOT_SIGNED_IN };
	return text.length > 0
		? { reason: fallback, detail: text }
		: { reason: fallback };
}
