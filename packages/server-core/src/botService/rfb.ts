import type { Readable, Writable } from 'node:stream';
import {
	BOT_DESKTOP_CLIPBOARD_BYTES,
	BOT_STREAM_INPUT_BYTES,
	type BotDesktopMode,
	type BotStreamBinding,
	botEnvironmentId,
	botStreamGeneration,
} from '@terminay/protocol';
import {
	type DesktopConnector,
	DesktopInputGate,
	openDesktopStream,
	RfbClientFilter,
	type RfbClientLimits,
	RfbRelay,
	type RfbRelayOptions,
	vncChallengeResponse,
} from '@terminay/remote-desktop/server';
import type { EngineDriver } from './engine.js';
import { BotError } from './store.js';
import {
	assertBotStreamAuthority,
	type BotStreamAuthority,
} from './streamAuthority.js';

/** The limits every bot desktop stream is held to. */
const botLimits: RfbClientLimits = {
	inputBytes: BOT_STREAM_INPUT_BYTES,
	clipboardBytes: BOT_DESKTOP_CLIPBOARD_BYTES,
};

/** The shared client-message allowlist under the bot stream limits. */
export class BotRfbClientFilter extends RfbClientFilter {
	constructor(mode: BotDesktopMode) {
		super(mode, botLimits);
	}
}
export const botVncChallengeResponse = vncChallengeResponse;

/** The shared relay, carrying which bot stream it serves. */
export class BotRfbRelay extends RfbRelay {
	/** The relay over streams and an authority given directly. */
	constructor(
		binding: BotStreamBinding,
		authority: BotStreamAuthority,
		source: Readable,
		sink: Writable,
		serverInit: Buffer,
		teardown: () => void,
	);
	/** The relay `openDesktopStream` asks for. */
	constructor(binding: BotStreamBinding, options: RfbRelayOptions);
	constructor(
		readonly binding: BotStreamBinding,
		from: BotStreamAuthority | RfbRelayOptions,
		source?: Readable,
		sink?: Writable,
		serverInit?: Buffer,
		teardown?: () => void,
	) {
		super(
			'limits' in from
				? from
				: {
						mode: binding.mode,
						authority: {
							signal: from.signal,
							assert: () => assertBotStreamAuthority(from),
						},
						source: source as Readable,
						sink: sink as Writable,
						serverInit: serverInit as Buffer,
						limits: botLimits,
						teardown: teardown as () => void,
					},
		);
	}
}
/** Highlighting text in the bot is never a copy to the user's device. New
 * containers start Xvnc with -SendPrimary=0; this also covers an Xvnc started
 * before that flag existed. vncconfig exits 0 even when a set fails, so the
 * value is read back. */
export async function ensureSelectionIsolated(
	driver: Pick<EngineDriver, 'exec'>,
	container: string,
): Promise<void> {
	const options = { user: 'root', deadlineMs: 10_000 } as const;
	try {
		await driver.exec(
			container,
			['vncconfig', '-display', ':1', '-set', 'SendPrimary=0'],
			options,
		);
		const value = await driver.exec(
			container,
			['vncconfig', '-display', ':1', '-get', 'SendPrimary'],
			options,
		);
		if (value.trim() !== 'off') throw new Error('PRIMARY still sent');
	} catch {
		throw new Error('desktop connection failed');
	}
}
export interface BotDesktopHooks {
	readonly engine: () => Promise<EngineDriver>;
	readonly running: (id: string) => boolean;
	/** The VNC password for a stream of `mode`: the full one for control, the
	 * view-only one otherwise. */
	readonly withPassword: <T>(
		id: string,
		callback: (value: Uint8Array) => Promise<T>,
		mode: BotDesktopMode,
	) => Promise<T>;
	readonly activity: (id: string, delta: 1 | -1, preview?: boolean) => void;
}
/** A bot's VNC service, reached through an exec tunnel into its container.
 * The container publishes no port; the service listens on its loopback. */
function execTunnelConnector(
	driver: Pick<EngineDriver, 'execStream'>,
	container: string,
): DesktopConnector {
	return {
		open: () => {
			const child = driver.execStream(
				container,
				['terminay-init', '--tunnel', '5901'],
				{ user: 'root' },
			);
			const source = child.stdout as unknown as Readable,
				sink = child.stdin as unknown as Writable;
			child.stderr.on('data', () => undefined);
			let closing = false;
			return {
				source,
				sink,
				onEnd: (listener) => {
					child.once('error', listener);
					child.once('close', listener);
				},
				close: () => {
					if (closing) return;
					closing = true;
					// EOF reaches the container-side tunnel before retiring its CLI.
					// This closes the VNC connection rather than orphaning an exec.
					sink.end();
					const deadline = setTimeout(() => child.kill('SIGKILL'), 5_000);
					deadline.unref();
					child.once('close', () => clearTimeout(deadline));
				},
			};
		},
	};
}

export class BotDesktopService {
	private readonly streams = new Map<string, BotRfbRelay>();
	private readonly generations = new Map<string, number>();
	private readonly gates = new Map<string, DesktopInputGate>();
	constructor(private readonly hooks: BotDesktopHooks) {}
	private gate(botId: string): DesktopInputGate {
		let gate = this.gates.get(botId);
		if (!gate) {
			gate = new DesktopInputGate();
			this.gates.set(botId, gate);
		}
		return gate;
	}
	async open(
		authority: BotStreamAuthority,
		botId: string,
		generation: number,
		mode: BotDesktopMode = 'view-only',
		thumbnail = false,
	): Promise<BotRfbRelay> {
		assertBotStreamAuthority(authority);
		botEnvironmentId(botId);
		botStreamGeneration(generation);
		if (
			!['view-only', 'control'].includes(mode) ||
			(thumbnail && mode !== 'view-only')
		)
			throw new Error('invalid desktop mode');
		if (!this.hooks.running(botId))
			throw new BotError('conflict', 'The machine is not started.');
		const key = JSON.stringify([
			authority.connectionId,
			botId,
			thumbnail ? 'thumbnail' : 'desktop',
		]);
		if ((this.generations.get(key) ?? 0) >= generation)
			throw new Error('stale desktop generation');
		this.generations.set(key, generation);
		this.streams.get(key)?.destroy();
		let reserved = true;
		this.hooks.activity(botId, 1, thumbnail);
		try {
			const driver = await this.hooks.engine();
			assertBotStreamAuthority(authority);
			if (!this.hooks.running(botId))
				throw new BotError('conflict', 'The machine is not started.');
			if (mode === 'control') {
				await ensureSelectionIsolated(driver, `terminay-bot-${botId}`);
				assertBotStreamAuthority(authority);
			}
			if (!this.hooks.running(botId))
				throw new BotError('conflict', 'The machine is not started.');
			const binding: BotStreamBinding = {
				connectionId: authority.connectionId,
				clientId: authority.clientId,
				botId,
				generation,
				mode,
				slot: thumbnail ? 'thumbnail' : 'desktop',
			};
			const relay: BotRfbRelay = await openDesktopStream<BotRfbRelay>({
				connector: execTunnelConnector(driver, `terminay-bot-${botId}`),
				mode,
				authority: {
					signal: authority.signal,
					assert: () => assertBotStreamAuthority(authority),
				},
				withPassword: (as, callback) =>
					this.hooks.withPassword(botId, callback, as),
				limits: botLimits,
				gate: this.gate(botId),
				admit: () => {
					if (this.generations.get(key) !== generation)
						throw new Error('stale desktop generation');
				},
				releasable: () => this.hooks.running(botId),
				onClosed: () => {
					if (this.streams.get(key) === relay) this.streams.delete(key);
					if (reserved) this.hooks.activity(botId, -1, thumbnail);
					reserved = false;
				},
				create: (options) => new BotRfbRelay(binding, options),
			});
			this.streams.set(key, relay);
			return relay;
		} catch (error) {
			if (reserved) this.hooks.activity(botId, -1, thumbnail);
			reserved = false;
			throw error;
		}
	}
	closeBot(id: string): void {
		for (const relay of this.streams.values())
			if (relay.binding.botId === id) relay.destroy();
		this.gates.delete(id);
	}
	closeConnection(id: string): void {
		for (const relay of this.streams.values())
			if (relay.binding.connectionId === id) relay.destroy();
		for (const key of this.generations.keys())
			if ((JSON.parse(key) as string[])[0] === id) this.generations.delete(key);
	}
	close(): void {
		for (const relay of this.streams.values()) relay.destroy();
		this.generations.clear();
	}
}
