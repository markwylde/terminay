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
			child.stderr.on('data', () => {});
			let childError: Error | undefined;
			child.on('error', (e) => {
				childError = e;
				child.stdout.destroy(e);
			});
			hooks.activity(botId, 1);
			const stop = () => child.kill();
			options.signal.addEventListener('abort', stop, { once: true });
			const continuous = source.kind === 'files' || source.kind === 'sse';
			const timer =
				!continuous || options.test
					? setTimeout(
							stop,
							options.test
								? 10000
								: ((source.kind === 'http' || source.kind === 'command'
										? source.timeoutMs
										: 30000) ?? 30000) + 5000,
						)
					: undefined;
			try {
				child.stdin.write(
					JSON.stringify({ source: resolved, cursor: options.cursor }) + '\n',
				);
				let buffered = Buffer.alloc(0);
				let seen = false;
				for await (const data of child.stdout) {
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
				}
				if (childError) throw childError;
				if (options.signal.aborted)
					throw new BotError('conflict', 'Source cancelled');
				if (!seen)
					throw new BotError(
						'unavailable',
						'Source worker unavailable; recreate bot to update its image',
					);
				if (continuous && !options.test)
					throw new BotError(
						'unavailable',
						'Source stream ended; event history may be unavailable',
					);
			} finally {
				if (timer) clearTimeout(timer);
				options.signal.removeEventListener('abort', stop);
				try {
					await driver.exec(
						`terminay-bot-${botId}`,
						['terminay-run', '--kill', sid],
						{ user: 'root', deadlineMs: 15000 },
					);
				} finally {
					child.kill();
					hooks.activity(botId, -1);
				}
				secrets.fill('');
			}
		},
	};
}
