import { randomUUID } from 'node:crypto';
import {
	type BotStreamBinding,
	botEnvironmentId,
	botStreamGeneration,
} from '@terminay/protocol';
import type {
	PtyFactory,
	PtyProcess,
	TerminalDimensions,
} from '../terminalService/types.js';
import { type EngineDriver, engineAddressArgs } from './engine.js';
import {
	assertBotStreamAuthority,
	type BotStreamAuthority,
} from './streamAuthority.js';

export interface BotShellHooks {
	readonly engine: () => Promise<EngineDriver>;
	readonly start: (id: string) => Promise<void>;
	readonly pty: PtyFactory;
	readonly cwd: string;
	readonly environment: Readonly<Record<string, string | undefined>>;
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
/** The existing privileged PTY host owns the engine CLI's real TTY. Resize on
 * that PTY propagates through exec -it to the container; no host shell runs. */
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
		const args = [
			...engineAddressArgs(driver.details.pin),
			'exec',
			'-it',
			'-u',
			'root',
			'-w',
			'/home/bot',
			...(purpose === 'sign-in' ? ['-e', 'HOME=/home/bot'] : []),
			`terminay-bot-${botId}`,
			'terminay-run',
			sid,
			'--',
			...(signInCommand ?? ['/bin/bash', '-i']),
		];
		const spawn =
			typeof this.hooks.pty === 'function'
				? this.hooks.pty
				: this.hooks.pty.spawn.bind(this.hooks.pty);
		const pty: PtyProcess = await spawn({
			shell: driver.details.pin.kind,
			shellPath: driver.details.pin.kind,
			args,
			cwd: this.hooks.cwd,
			env: this.hooks.environment,
			...dimensions,
			name: 'xterm-256color',
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
