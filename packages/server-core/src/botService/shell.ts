import { randomUUID } from 'node:crypto';
import {
	type BotStreamBinding,
	botEnvironmentId,
	botStreamGeneration,
} from '@terminay/protocol';
import type {
	PtyProcess,
	TerminalDimensions,
} from '../terminalService/types.js';
import { type EngineDriver } from './engine.js';
import {
	assertBotStreamAuthority,
	type BotStreamAuthority,
} from './streamAuthority.js';

export interface BotShellHooks {
	readonly engine: () => Promise<EngineDriver>;
	readonly start: (id: string) => Promise<void>;
	readonly activity: (id: string, delta: 1 | -1) => void;
	/** The agent's declared device sign-in, run as the bot user in /home/bot. */
	readonly signIn?: {
		readonly command: (botId: string) => readonly string[] | undefined;
		readonly prepare?: (botId: string) => Promise<void>;
		/** The sign-in command exited 0: the login is now in the bot's home. */
		readonly succeeded: (botId: string) => Promise<void>;
	};
}
export type BotShellPurpose = 'shell' | 'sign-in';
export interface BotShellStream {
	readonly binding: BotStreamBinding;
	write(bytes: Uint8Array): Promise<void>;
	resize(dimensions: TerminalDimensions): Promise<void>;
	pause(): void;
	resume(): void;
	close(): Promise<void>;
}
/** The engine owns the TTY. The server relays its socket exec stream and
 * resizes it through the API, with no host CLI or PTY process. */
export class BotShellService {
	private readonly generations = new Map<string, number>();
	private readonly streams = new Map<string, BotShellStream>();
	constructor(private readonly hooks: BotShellHooks) {}
	async open(
		authority: BotStreamAuthority,
		botId: string,
		generation: number,
		dimensions: TerminalDimensions,
		output: (bytes: Uint8Array) => void,
		ended: () => void,
		purpose: BotShellPurpose = 'shell',
	): Promise<BotShellStream> {
		assertBotStreamAuthority(authority);
		botEnvironmentId(botId);
		botStreamGeneration(generation);
		validateDimensions(dimensions);
		const signInCommand =
			purpose === 'sign-in' ? this.hooks.signIn?.command(botId) : undefined;
		if (purpose === 'sign-in' && !signInCommand?.length)
			throw new Error('this agent has no device sign-in');
		const key = JSON.stringify([authority.connectionId, botId, purpose]);
		const previous = this.streams.get(key);
		if (generation <= (this.generations.get(key) ?? 0))
			throw new Error('stale shell generation');
		this.generations.set(key, generation);
		await previous?.close();
		await this.hooks.start(botId);
		if (purpose === 'sign-in') await this.hooks.signIn?.prepare?.(botId);
		assertBotStreamAuthority(authority);
		if (this.generations.get(key) !== generation)
			throw new Error('stale shell generation');
		const driver = await this.hooks.engine();
		const sid = `${purpose === 'sign-in' ? 'signin' : 'shell'}-${randomUUID()}`;
		let currentDimensions = dimensions;
		const child = driver.execStream(
			`terminay-bot-${botId}`,
			['terminay-run', sid, '--', ...(signInCommand ?? ['/bin/bash', '-i'])],
			{
				user: 'root',
				tty: true,
				env: { HOME: '/home/bot', TERM: 'xterm-256color' },
			},
		);
		const pty: PtyProcess = {
			write: async (bytes) => {
				if (!child.stdin.write(bytes))
					await new Promise<void>((resolve, reject) => {
						const clean = () => {
							child.stdin.off('drain', drained);
							child.stdin.off('close', failed);
						};
						const drained = () => {
								clean();
								resolve();
							},
							failed = () => {
								clean();
								reject(new Error('shell closed'));
							};
						child.stdin.once('drain', drained);
						child.stdin.once('close', failed);
					});
			},
			resize: async (size) => child.resize(size.cols, size.rows),
			kill: async () => {
				child.kill();
			},
			pause: () => {
				child.stdout.pause();
			},
			resume: () => {
				child.stdout.resume();
			},
			onData: (callback) => {
				const listener = (bytes: Buffer) => callback(bytes);
				child.stdout.on('data', listener);
				return () => child.stdout.off('data', listener);
			},
			onExit: (callback) => {
				const listener = (code: number | null) =>
					callback({ exitCode: code ?? 1 });
				child.once('close', listener);
				return () => child.off('close', listener);
			},
		};
		child.stderr.on('data', () => {});
		child.once('error', () => {
			void close().catch(() => undefined);
		});
		child.once('ready', () => {
			void child
				.resize(currentDimensions.cols, currentDimensions.rows)
				.catch(() => {
					void close().catch(() => undefined);
				});
		});
		let closing: Promise<void> | undefined;
		let closed = false;
		const check = () => {
			assertBotStreamAuthority(authority);
			if (closed) throw new Error('shell closed');
		};
		const detach: (() => void)[] = [];
		const close = (): Promise<void> => {
			if (closing) return closing;
			closed = true;
			for (const remove of detach) remove();
			authority.signal.removeEventListener('abort', abort);
			if (this.streams.get(key) === stream) this.streams.delete(key);
			closing = (async () => {
				try {
					await driver.exec(
						`terminay-bot-${botId}`,
						['terminay-run', '--kill', sid],
						{ user: 'root', deadlineMs: 15_000 },
					);
				} finally {
					await pty.kill('SIGKILL');
					await pty.dispose?.();
					this.hooks.activity(botId, -1);
					ended();
				}
			})();
			return closing;
		};
		const abort = () => {
			void close().catch(() => undefined);
		};
		const stream: BotShellStream = {
			binding: {
				connectionId: authority.connectionId,
				clientId: authority.clientId,
				botId,
				generation,
				mode: 'control',
				slot: 'shell',
			},
			write: async (bytes) => {
				check();
				if (bytes.length > 1024 * 1024)
					throw new RangeError('shell input too large');
				await pty.write(bytes);
			},
			resize: async (size) => {
				check();
				validateDimensions(size);
				currentDimensions = size;
				await pty.resize(size);
			},
			pause: () => {
				check();
				pty.pause?.();
			},
			resume: () => {
				check();
				pty.resume?.();
			},
			close,
		};
		this.hooks.activity(botId, 1);
		this.streams.set(key, stream);
		if (this.generations.get(key) !== generation || authority.signal.aborted) {
			await close();
			throw new Error('shell open superseded');
		}
		const data = pty.onData((bytes) => {
			try {
				check();
				output(bytes);
			} catch {
				abort();
			}
		});
		if (data) detach.push(data);
		const exit = pty.onExit((result) => {
			if (purpose === 'sign-in' && result.exitCode === 0 && !closed)
				void this.hooks.signIn
					?.succeeded(botId)
					.catch(() => undefined)
					.finally(abort);
			else abort();
		});
		if (exit) detach.push(exit);
		authority.signal.addEventListener('abort', abort, { once: true });
		if (authority.signal.aborted) abort();
		return stream;
	}
	async closeBot(id: string): Promise<void> {
		await Promise.all(
			[...this.streams.values()]
				.filter((s) => s.binding.botId === id)
				.map((s) => s.close()),
		);
	}
	async closeConnection(id: string): Promise<void> {
		await Promise.all(
			[...this.streams.values()]
				.filter((s) => s.binding.connectionId === id)
				.map((s) => s.close()),
		);
		for (const key of this.generations.keys())
			if ((JSON.parse(key) as string[])[0] === id) this.generations.delete(key);
	}
	async close(): Promise<void> {
		await Promise.all([...this.streams.values()].map((s) => s.close()));
		this.generations.clear();
	}
}
function validateDimensions(d: TerminalDimensions): void {
	if (
		![d.cols, d.rows].every(
			(n) => Number.isSafeInteger(n) && n >= 1 && n <= 4096,
		)
	)
		throw new RangeError('invalid shell dimensions');
}
