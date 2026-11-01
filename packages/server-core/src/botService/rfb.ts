import { createCipheriv } from 'node:crypto';
import { once } from 'node:events';
import { Duplex, type Readable, type Writable } from 'node:stream';
import {
	BOT_DESKTOP_CLIPBOARD_BYTES,
	BOT_STREAM_INPUT_BYTES,
	type BotDesktopMode,
	type BotStreamBinding,
	botEnvironmentId,
	botStreamGeneration,
} from '@terminay/protocol';
import type { EngineDriver } from './engine.js';
import {
	assertBotStreamAuthority,
	type BotStreamAuthority,
} from './streamAuthority.js';

const banner = Buffer.from('RFB 003.008\n');
const u16 = (b: Uint8Array, offset: number) =>
	new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(offset);
const u32 = (b: Uint8Array, offset: number) =>
	new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(offset);

/** RFC 6143 section 7.5. Complete messages alone reach the tunnel. */
export class BotRfbClientFilter {
	private pending = Buffer.alloc(0);
	constructor(readonly mode: BotDesktopMode) {}
	push(bytes: Uint8Array): Buffer {
		if (this.pending.length + bytes.length > BOT_STREAM_INPUT_BYTES)
			throw new Error('RFB reassembly limit exceeded');
		this.pending = Buffer.concat([this.pending, bytes]);
		const output: Buffer[] = [];
		while (this.pending.length) {
			const b = this.pending;
			const type = b[0];
			let size: number;
			switch (type) {
				case 0:
					size = 20;
					break;
				case 2:
					if (b.length < 4) return Buffer.concat(output);
					if (u16(b, 2) > 64) throw new Error('too many RFB encodings');
					size = 4 + 4 * u16(b, 2);
					break;
				case 3:
					size = 10;
					break;
				case 4:
					size = 8;
					break;
				case 5:
					size = 6;
					break;
				case 6:
					if (b.length < 8) return Buffer.concat(output);
					if (u32(b, 4) > BOT_DESKTOP_CLIPBOARD_BYTES)
						throw new Error('RFB clipboard too large');
					size = 8 + u32(b, 4);
					break;
				default:
					throw new Error('unknown RFB client message');
			}
			if (b.length < size) break;
			const message = b.subarray(0, size);
			if (type === 0) validatePixelFormat(message.subarray(4));
			if (type === 3 && message[1]! > 1)
				throw new Error('invalid RFB update request');
			if (type === 4 && message[1]! > 1)
				throw new Error('invalid RFB key event');
			if (type === 2) output.push(allowedEncodings(message));
			else if (this.mode === 'control' || type === 0 || type === 3)
				output.push(message);
			this.pending = Buffer.from(b.subarray(size));
		}
		return Buffer.concat(output);
	}
	close(): void {
		this.pending = Buffer.alloc(0);
	}
}
/** Encodings whose server messages need no client reply. Fences, continuous
 * updates and the other extensions start exchanges this filter does not
 * relay, so the server is never told the client supports them. */
const relayedEncodings = new Set([
	0, 1, 2, 5, 7, 16, -223, -224, -239, -307, -308,
	...Array.from({ length: 10 }, (_, i) => -23 - i),
	...Array.from({ length: 10 }, (_, i) => -247 - i),
]);
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
function allowedEncodings(message: Buffer): Buffer {
	const kept: number[] = [];
	for (let i = 0; i < u16(message, 2); i++) {
		const encoding = view(message).getInt32(4 + i * 4);
		if (relayedEncodings.has(encoding)) kept.push(encoding);
	}
	const out = Buffer.alloc(4 + kept.length * 4);
	out[0] = 2;
	const target = view(out);
	target.setUint16(2, kept.length);
	for (const [i, e] of kept.entries()) target.setInt32(4 + i * 4, e);
	return out;
}
function validatePixelFormat(format: Uint8Array): void {
	const bpp = format[0]!,
		depth = format[1]!;
	if (
		![8, 16, 32].includes(bpp) ||
		depth < 1 ||
		depth > bpp ||
		format[2]! > 1 ||
		format[3]! > 1
	)
		throw new Error('invalid RFB pixel format');
	if (format[3]) {
		let mask = 0n;
		for (let i = 0; i < 3; i++) {
			const maximum = u16(format, 4 + i * 2),
				shift = format[10 + i]!;
			if (!maximum || (maximum & (maximum + 1)) !== 0 || shift >= bpp)
				throw new Error('invalid RFB colour field');
			const field = BigInt(maximum) << BigInt(shift);
			if (field >= 1n << BigInt(bpp) || mask & field)
				throw new Error('invalid RFB colour mask');
			mask |= field;
		}
	}
}
/** VNC uses DES with each password byte's bits reversed. Repeated 3DES keys
 * implement single DES with the OpenSSL algorithms available in Node. */
export function botVncChallengeResponse(
	password: Uint8Array,
	challenge: Uint8Array,
): Buffer {
	if (challenge.length !== 16) throw new Error('invalid VNC challenge');
	const key = Buffer.alloc(24);
	for (let i = 0; i < 8; i++) {
		let byte = password[i] ?? 0,
			reversed = 0;
		for (let bit = 0; bit < 8; bit++) {
			reversed = (reversed << 1) | (byte & 1);
			byte >>= 1;
		}
		key[i] = reversed;
		key[i + 8] = reversed;
		key[i + 16] = reversed;
	}
	try {
		const cipher = createCipheriv('des-ede3', key, null);
		cipher.setAutoPadding(false);
		return Buffer.concat([cipher.update(challenge), cipher.final()]);
	} finally {
		key.fill(0);
	}
}
async function readExact(source: Readable, size: number): Promise<Buffer> {
	if (size === 0) return Buffer.alloc(0);
	while (true) {
		const value = source.read(size) as Buffer | null;
		if (value !== null) return value;
		if (source.destroyed || source.readableEnded)
			throw new Error('RFB tunnel ended');
		await once(source, 'readable');
	}
}
async function write(target: Writable, bytes: Uint8Array): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const settle = (failed = false) => {
			if (settled) return;
			settled = true;
			target.off('close', closed);
			target.off('error', failedWrite);
			if (failed) reject(new Error('RFB tunnel write failed'));
			else resolve();
		};
		const closed = () => settle(true),
			failedWrite = () => settle(true);
		target.once('close', closed);
		target.once('error', failedWrite);
		target.write(bytes, (error?: Error | null) => settle(Boolean(error)));
	});
}

/** Authenticated upstream, security None downstream. Writable callbacks wait
 * for the exec pipe's drain; readable high-water marks pause the exec stdout. */
export class BotRfbRelay extends Duplex {
	private clientPending = Buffer.alloc(0);
	private stage: 'version' | 'security' | 'init' | 'messages' = 'version';
	private readonly clientFilter: BotRfbClientFilter;
	private flowing = false;
	private readonly abort: () => void;
	private readonly data: (chunk: Buffer) => void;
	private readonly sourceEnd: () => void;
	constructor(
		readonly binding: BotStreamBinding,
		private readonly authority: BotStreamAuthority,
		private readonly source: Readable,
		private readonly sink: Writable,
		private readonly serverInit: Buffer,
		private readonly teardown: () => void,
	) {
		super({
			readableHighWaterMark: 256 * 1024,
			writableHighWaterMark: 256 * 1024,
		});
		this.clientFilter = new BotRfbClientFilter(binding.mode);
		this.abort = () => this.destroy();
		this.data = (bytes) => {
			try {
				assertBotStreamAuthority(authority);
				if (!this.push(bytes)) source.pause();
			} catch {
				this.destroy();
			}
		};
		this.sourceEnd = () => this.destroy();
		authority.signal.addEventListener('abort', this.abort, { once: true });
		source.once('end', this.sourceEnd);
		source.once('error', this.sourceEnd);
		sink.once('error', this.sourceEnd);
		this.on('error', () => undefined);
		this.push(banner);
	}
	override _read(): void {
		if (this.flowing) this.source.resume();
	}
	override _write(
		chunk: Buffer,
		_encoding: string,
		callback: (error?: Error | null) => void,
	): void {
		void this.receive(chunk).then(
			() => callback(),
			() => callback(new Error('invalid desktop stream')),
		);
	}
	private async receive(bytes: Buffer): Promise<void> {
		assertBotStreamAuthority(this.authority);
		if (this.clientPending.length + bytes.length > BOT_STREAM_INPUT_BYTES)
			throw new Error('RFB input limit');
		this.clientPending = Buffer.concat([this.clientPending, bytes]);
		while (!this.destroyed) {
			const length =
				this.stage === 'version' ? 12 : this.stage === 'messages' ? 0 : 1;
			if (this.clientPending.length < length) return;
			if (this.stage === 'messages') {
				const allowed = this.clientFilter.push(this.clientPending);
				this.clientPending = Buffer.alloc(0);
				if (allowed.length) await write(this.sink, allowed);
				return;
			}
			const message = this.clientPending.subarray(0, length);
			this.clientPending = Buffer.from(this.clientPending.subarray(length));
			if (this.stage === 'version') {
				if (message.toString() !== banner.toString())
					throw new Error('RFB 3.8 required');
				this.push(Buffer.from([1, 1]));
				this.stage = 'security';
			} else if (this.stage === 'security') {
				if (message[0] !== 1) throw new Error('RFB None required');
				this.push(Buffer.alloc(4));
				this.stage = 'init';
			} else {
				if (message[0]! > 1) throw new Error('invalid client init');
				this.push(this.serverInit);
				this.stage = 'messages';
				this.flowing = true;
				this.source.on('data', this.data);
			}
		}
	}
	override _destroy(
		_error: Error | null,
		callback: (error?: Error | null) => void,
	): void {
		this.authority.signal.removeEventListener('abort', this.abort);
		this.source.off('data', this.data);
		this.source.off('end', this.sourceEnd);
		this.source.off('error', this.sourceEnd);
		this.sink.off('error', this.sourceEnd);
		this.clientPending = Buffer.alloc(0);
		this.clientFilter.close();
		this.teardown();
		callback();
	}
}
export interface BotDesktopHooks {
	readonly engine: () => Promise<EngineDriver>;
	readonly running: (id: string) => boolean;
	readonly withPassword: <T>(
		id: string,
		callback: (value: Uint8Array) => Promise<T>,
	) => Promise<T>;
	readonly activity: (id: string, delta: 1 | -1) => void;
}
export class BotDesktopService {
	private readonly streams = new Map<string, BotRfbRelay>();
	private readonly generations = new Map<string, number>();
	constructor(private readonly hooks: BotDesktopHooks) {}
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
			throw new Error('bot must be running to view desktop');
		const key = JSON.stringify([
			authority.connectionId,
			botId,
			thumbnail ? 'thumbnail' : 'desktop',
		]);
		if ((this.generations.get(key) ?? 0) >= generation)
			throw new Error('stale desktop generation');
		this.generations.set(key, generation);
		this.streams.get(key)?.destroy();
		const driver = await this.hooks.engine();
		assertBotStreamAuthority(authority);
		const child = driver.execStream(
			`terminay-bot-${botId}`,
			['terminay-init', '--tunnel', '5901'],
			{ user: 'root' },
		);
		const source = child.stdout as unknown as Readable,
			sink = child.stdin as unknown as Writable;
		child.stderr.on('data', () => undefined);
		source.on('error', () => undefined);
		sink.on('error', () => undefined);
		let shuttingDown = false;
		const shutdown = () => {
			if (shuttingDown) return;
			shuttingDown = true;
			// EOF reaches the container-side tunnel before retiring its CLI.
			// This closes the VNC connection rather than orphaning an exec.
			sink.end();
			const deadline = setTimeout(() => child.kill('SIGKILL'), 5_000);
			deadline.unref();
			child.once('close', () => clearTimeout(deadline));
		};
		// One absolute handshake deadline, also unblocks an EOF mid-message.
		const timeout = setTimeout(() => {
			source.destroy(new Error('RFB handshake deadline'));
			shutdown();
		}, 10_000);
		const abort = () => {
			source.destroy(new Error('desktop authority revoked'));
			shutdown();
		};
		authority.signal.addEventListener('abort', abort, { once: true });
		child.once('error', abort);
		child.once('close', abort);
		try {
			if ((await readExact(source, 12)).toString() !== banner.toString())
				throw new Error('RFB 3.8 required');
			await write(sink, banner);
			const count = (await readExact(source, 1))[0]!;
			if (!count || !(await readExact(source, count)).includes(2))
				throw new Error('VNC authentication required');
			await write(sink, Buffer.from([2]));
			const challenge = await readExact(source, 16);
			await this.hooks.withPassword(botId, async (password) => {
				const response = botVncChallengeResponse(password, challenge);
				try {
					await write(sink, response);
				} finally {
					response.fill(0);
				}
			});
			if (u32(await readExact(source, 4), 0) !== 0)
				throw new Error('desktop authentication failed');
			await write(sink, Buffer.from([1]));
			const header = await readExact(source, 24);
			if (u32(header, 20) > 1024 * 1024)
				throw new Error('desktop server name too large');
			validatePixelFormat(header.subarray(4, 20));
			const init = Buffer.concat([
				header,
				await readExact(source, u32(header, 20)),
			]);
			assertBotStreamAuthority(authority);
			if (this.generations.get(key) !== generation)
				throw new Error('stale desktop generation');
			clearTimeout(timeout);
			this.hooks.activity(botId, 1);
			const relay = new BotRfbRelay(
				{
					connectionId: authority.connectionId,
					clientId: authority.clientId,
					botId,
					generation,
					mode,
					slot: thumbnail ? 'thumbnail' : 'desktop',
				},
				authority,
				source,
				sink,
				init,
				() => {
					shutdown();
					if (this.streams.get(key) === relay) this.streams.delete(key);
					this.hooks.activity(botId, -1);
				},
			);
			this.streams.set(key, relay);
			return relay;
		} catch {
			shutdown();
			throw new Error('desktop connection failed');
		} finally {
			clearTimeout(timeout);
			authority.signal.removeEventListener('abort', abort);
		}
	}
	closeBot(id: string): void {
		for (const relay of this.streams.values())
			if (relay.binding.botId === id) relay.destroy();
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
