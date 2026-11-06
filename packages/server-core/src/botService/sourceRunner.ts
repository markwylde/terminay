import { randomBytes } from 'node:crypto';
import type { BotObservationSource } from '@terminay/protocol';
import type { EngineDriver } from './engine.js';
import { type Observation, parseObservation } from './sourceState.js';
import { BotError } from './store.js';
import type { BotTokenVault } from './tokens.js';
export interface SourceRunOptions {
	signal: AbortSignal;
	cursor?: string;
	test?: boolean;
}
export interface BotSourceRunner {
	protect(
		botId: string,
		triggerId: string,
		source: BotObservationSource,
	): Promise<BotObservationSource>;
	run(
		botId: string,
		source: BotObservationSource,
		options: SourceRunOptions,
		observe: (value: Observation) => Promise<void>,
	): Promise<void>;
}
export const STDERR_TAIL_BYTES = 4096;
const TEST_WINDOW_MS = 10000;
const EXIT_GRACE_MS = 1000;
export interface SourceRunDiagnostics {
	/** Exit status of the worker exec, or null when it is unknown. */
	exitCode: number | null;
	/** Bounded stderr tail with header secrets substituted; not yet bot-redacted. */
	stderr: string;
}
/**
 * A source run that ended without a result frame. `outcome` is structured and
 * never inferred from stderr. `cleaned` records whether container-side cleanup
 * of the run succeeded, which a retry requires.
 */
export class SourceRunError extends BotError {
	readonly outcome: 'deadline' | 'not-executable' | 'interrupted';
	readonly diagnostics: SourceRunDiagnostics;
	cleaned = false;
	constructor(
		outcome: SourceRunError['outcome'],
		message: string,
		diagnostics: SourceRunDiagnostics,
	) {
		super(outcome === 'deadline' ? 'deadline' : 'unavailable', message);
		this.outcome = outcome;
		this.diagnostics = diagnostics;
	}
}
export function containerSourceRunner(hooks: {
	driver: () => Promise<EngineDriver>;
	start: (id: string) => Promise<void>;
	activity: (id: string, delta: 1 | -1) => void;
	vault: BotTokenVault;
}): BotSourceRunner {
	return {
		async protect(botId, triggerId, source) {
			if (source.kind !== 'http' && source.kind !== 'sse') return source;
			const headers: Record<string, string> = {};
			const prefix = `@vault:bot:${botId}:trigger:${triggerId}:header:`;
			for (const [name, value] of Object.entries(source.headers ?? {})) {
				if (value.startsWith('@vault:')) {
					if (
						!value.startsWith(prefix) ||
						!hooks.vault
							.status()
							.entries.some((e) => `@vault:${e.id}` === value)
					)
						throw new BotError('validation', 'Invalid header secret reference');
					headers[name] = value;
				} else {
					const key = prefix.slice(7) + randomBytes(12).toString('hex');
					await hooks.vault.put({
						id: key,
						label: `Bot ${botId} trigger header ${name}`,
						value: Buffer.from(value),
					});
					headers[name] = `@vault:${key}`;
				}
			}
			return { ...source, headers };
		},
		async run(botId, source, options, observe) {
			if (options.signal.aborted)
				throw new BotError('conflict', 'Source cancelled');
			await hooks.start(botId);
			if (options.signal.aborted)
				throw new BotError('conflict', 'Source cancelled');
			const driver = await hooks.driver();
			const sid = `source-${randomBytes(12).toString('hex')}`;
			const secrets: string[] = [];
			let resolved = source;
			if (source.kind === 'http' || source.kind === 'sse') {
				const headers: Record<string, string> = {};
				for (const [name, value] of Object.entries(source.headers ?? {})) {
					if (value.startsWith('@vault:')) {
						if (!value.startsWith(`@vault:bot:${botId}:trigger:`))
							throw new BotError(
								'validation',
								'Header secret belongs to another bot',
							);
						headers[name] = await hooks.vault.withSecret(value.slice(7), (v) =>
							Buffer.from(v).toString('utf8'),
						);
					} else headers[name] = value;
					if (headers[name]) secrets.push(headers[name]);
				}
				resolved = { ...source, headers };
			}
			const clean = (v: unknown): unknown =>
				typeof v === 'string'
					? secrets.reduce((s, k) => s.split(k).join('[redacted]'), v)
					: Array.isArray(v)
						? v.map(clean)
						: v && typeof v === 'object'
							? Object.fromEntries(
									Object.entries(v).map(([k, x]) => [
										String(clean(k)),
										clean(x),
									]),
								)
							: v;
			const child = driver.execStream(
				`terminay-bot-${botId}`,
				['terminay-run', sid, '--', '/usr/local/bin/terminay-source'],
				{ user: 'root', env: { HOME: '/home/bot' } },
			);
			// Keep only a bounded stderr tail; a partial first line is dropped later.
			let stderrTail = Buffer.alloc(0);
			let stderrOverflow = false;
			child.stderr.on('data', (chunk: Buffer | string) => {
				stderrTail = Buffer.concat([stderrTail, Buffer.from(chunk)]);
				if (stderrTail.length > STDERR_TAIL_BYTES) {
					stderrTail = stderrTail.subarray(
						stderrTail.length - STDERR_TAIL_BYTES,
					);
					stderrOverflow = true;
				}
			});
			let childError: Error | undefined;
			child.on('error', (e) => {
				childError = e;
				child.stdout.destroy(e);
			});
			let exitCode: number | null = null;
			let exited = false;
			const exitWaiters: (() => void)[] = [];
			child.on('exit', (code: unknown) => {
				exitCode = typeof code === 'number' ? code : null;
				exited = true;
				for (const w of exitWaiters.splice(0)) w();
			});
			hooks.activity(botId, 1);
			const stop = () => child.kill();
			options.signal.addEventListener('abort', stop, { once: true });
			const continuous = source.kind === 'files' || source.kind === 'sse';
			const limitMs = options.test
				? TEST_WINDOW_MS
				: ((source.kind === 'http' || source.kind === 'command'
						? source.timeoutMs
						: undefined) ?? 30000);
			let timedOut = false;
			const timer =
				!continuous || options.test
					? setTimeout(
							() => {
								timedOut = true;
								stop();
							},
							options.test ? limitMs : limitMs + 5000,
						)
					: undefined;
			const diagnostics = (): SourceRunDiagnostics => {
				let tail = stderrTail;
				if (stderrOverflow) {
					const nl = tail.indexOf(10);
					tail = nl < 0 ? Buffer.alloc(0) : tail.subarray(nl + 1);
				}
				const text = String(clean(tail.toString('utf8')));
				return { exitCode, stderr: text };
			};
			let primary: unknown;
			try {
				child.stdin.write(
					JSON.stringify({ source: resolved, cursor: options.cursor }) + '\n',
				);
				let buffered = Buffer.alloc(0);
				let seen = false;
				let frameError = false;
				let streamError: unknown;
				try {
					for await (const data of child.stdout) {
						try {
							buffered = Buffer.concat([buffered, Buffer.from(data)]);
							if (buffered.length > 20 * 1024 * 1024)
								throw new BotError('resource', 'Source frame exceeds limit');
							let pos: number;
							while (true) {
								pos = buffered.indexOf(10);
								if (pos < 0) break;
								const line = buffered.subarray(0, pos);
								buffered = buffered.subarray(pos + 1);
								if (!line.length) continue;
								const raw: unknown = JSON.parse(
									new TextDecoder('utf-8', { fatal: true }).decode(line),
								);
								if (!raw || typeof raw !== 'object' || Array.isArray(raw))
									throw new BotError('validation', 'Invalid source frame');
								const v = clean(raw) as Observation & { error?: string };
								if (v.error) throw new BotError('unavailable', v.error);
								await observe(parseObservation(v));
								seen = true;
								if (continuous && !(v.status === 'connected' && !v.snapshot))
									child.stdin.write('ack\n');
								if (!continuous) return;
							}
						} catch (error) {
							frameError = true;
							throw error;
						}
					}
				} catch (error) {
					// Frame and observation errors keep their meaning; a broken stream
					// is classified below with the other runs that end without a result.
					if (frameError) throw error;
					streamError = error;
				}
				if (options.signal.aborted)
					throw new BotError('conflict', 'Source cancelled');
				if (seen) {
					if (childError ?? streamError) throw childError ?? streamError;
					if (continuous && !options.test)
						throw new BotError(
							'unavailable',
							'Source stream ended; event history may be unavailable',
						);
					return;
				}
				if (timedOut)
					throw new SourceRunError(
						'deadline',
						`Source check exceeded its ${Math.round(limitMs / 1000)} s limit`,
						diagnostics(),
					);
				// The exit status can arrive just after stdout ends.
				if (!exited && !childError && !streamError)
					await new Promise<void>((resolve) => {
						const t = setTimeout(resolve, EXIT_GRACE_MS);
						exitWaiters.push(() => {
							clearTimeout(t);
							resolve();
						});
					});
				if (exitCode === 126 || exitCode === 127)
					throw new SourceRunError(
						'not-executable',
						"The source worker could not be executed in the bot's container; recreate the bot to update its image",
						diagnostics(),
					);
				throw new SourceRunError(
					'interrupted',
					'Source check was interrupted before it reported',
					diagnostics(),
				);
			} catch (error) {
				primary = error;
				throw error;
			} finally {
				if (timer) clearTimeout(timer);
				options.signal.removeEventListener('abort', stop);
				let cleanupError: unknown;
				try {
					await driver.exec(
						`terminay-bot-${botId}`,
						['terminay-run', '--kill', sid],
						{ user: 'root', deadlineMs: 15000 },
					);
				} catch (error) {
					cleanupError = error ?? new Error('Source cleanup failed');
				} finally {
					child.kill();
					hooks.activity(botId, -1);
				}
				secrets.fill('');
				if (primary instanceof SourceRunError)
					primary.cleaned = cleanupError === undefined;
				// Cleanup failure never hides the run's own error.
				if (cleanupError !== undefined && primary === undefined) {
					// biome-ignore lint/correctness/noUnsafeFinally: a successful run still reports failed cleanup
					throw cleanupError;
				}
			}
		},
	};
}
