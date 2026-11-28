/**
 * The server half of a remote desktop: the RFB client-message allowlist, the
 * VNC authentication response, and the relay that offers a client security
 * None while the server itself authenticates upstream.
 *
 * Nothing here knows what the desktop belongs to. A caller supplies the
 * upstream byte streams and an authority that is checked on every callback.
 */

import { createCipheriv } from 'node:crypto';
import { once } from 'node:events';
import { connect as connectSocket } from 'node:net';
import { Duplex, type Readable, type Writable } from 'node:stream';

import type { DesktopMode } from '../index.js';

export type { DesktopMode };

export const RFB_BANNER = Buffer.from('RFB 003.008\n');

const u16 = (b: Uint8Array, offset: number) =>
	new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(offset);
const view = (b: Uint8Array) =>
	new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Byte limits a relay enforces on what a client sends. */
export interface RfbClientLimits {
	/** Most bytes held while reassembling client messages. */
	readonly inputBytes: number;
	/** Largest clipboard payload, in either the legacy or the extended form. */
	readonly clipboardBytes: number;
}

/** What a client may ask the desktop's screen to become. */
export interface DesktopResizeLimits {
	readonly minWidth: number;
	readonly minHeight: number;
	readonly maxWidth: number;
	readonly maxHeight: number;
	/** Most resizes passed on per second; the latest request wins. */
	readonly perSecond: number;
}

/** 640x480 to 3840x2160, at most ten a second. */
export const DESKTOP_RESIZE_LIMITS: DesktopResizeLimits = Object.freeze({
	minWidth: 640,
	minHeight: 480,
	maxWidth: 3840,
	maxHeight: 2160,
	perSecond: 10,
});

/** How a filter that admits resizes sends one it held back. */
export interface RfbResizeAdmission {
	readonly limits: DesktopResizeLimits;
	readonly now: () => number;
	/** Runs `run` after `delayMs`; returns a function that cancels it. */
	readonly later: (delayMs: number, run: () => void) => () => void;
	/** Delivers a resize that was held back by the rate bound. */
	readonly send: (message: Buffer) => void;
}

const SET_DESKTOP_SIZE = 251;

/** RFC 6143 section 7.5. Complete messages alone reach the tunnel. */
export class RfbClientFilter {
	private pending = Buffer.alloc(0);
	private resizeSentAt = Number.NEGATIVE_INFINITY;
	private resizeHeld: Buffer | undefined;
	private cancelResize: (() => void) | undefined;
	constructor(
		readonly mode: DesktopMode,
		private readonly limits: RfbClientLimits,
		/** Sees each key and pointer event that is let through. */
		private readonly observe?: (message: Buffer) => void,
		/** Present when the desktop's screen may be resized by its viewer.
		 * Without it a resize is an unknown message and closes the stream. */
		private readonly resize?: RfbResizeAdmission,
	) {}
	/** One screen, clamped to the limits, at most `perSecond` a second with
	 * the latest request applied. Returns the message to send now, if any. */
	private admitResize(message: Buffer): Buffer | undefined {
		const resize = this.resize as RfbResizeAdmission;
		const { limits } = resize;
		const clamp = (value: number, low: number, high: number) =>
			Math.min(high, Math.max(low, value));
		const width = clamp(u16(message, 2), limits.minWidth, limits.maxWidth);
		const height = clamp(u16(message, 4), limits.minHeight, limits.maxHeight);
		const out = Buffer.alloc(24);
		out[0] = SET_DESKTOP_SIZE;
		const target = view(out);
		target.setUint16(2, width);
		target.setUint16(4, height);
		out[6] = 1;
		// The one screen keeps its id and flags and covers the whole desktop.
		target.setUint32(8, view(message).getUint32(8));
		target.setUint16(16, width);
		target.setUint16(18, height);
		target.setUint32(20, view(message).getUint32(20));
		const interval = 1000 / limits.perSecond;
		const wait = this.resizeSentAt + interval - resize.now();
		if (wait <= 0 && this.resizeHeld === undefined) {
			this.resizeSentAt = resize.now();
			return out;
		}
		// Inside the interval: keep only the newest and send it when due.
		const scheduled = this.resizeHeld !== undefined;
		this.resizeHeld = out;
		if (!scheduled)
			this.cancelResize = resize.later(Math.max(0, wait), () => {
				const held = this.resizeHeld;
				this.resizeHeld = undefined;
				this.cancelResize = undefined;
				if (held === undefined) return;
				this.resizeSentAt = resize.now();
				resize.send(held);
			});
		return undefined;
	}
	push(bytes: Uint8Array): Buffer {
		if (this.pending.length + bytes.length > this.limits.inputBytes)
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
				case 6: {
					if (b.length < 8) return Buffer.concat(output);
					// A negative length is the ExtendedClipboard form: flags and a
					// zlib payload, UTF-8 text. Either form is bounded alike.
					const length = view(b).getInt32(4);
					const payload = Math.abs(length);
					if (payload > this.limits.clipboardBytes)
						throw new Error('RFB clipboard too large');
					if (length < 0 && payload < 4)
						throw new Error('invalid RFB extended clipboard');
					size = 8 + payload;
					break;
				}
				case SET_DESKTOP_SIZE:
					if (!this.resize) throw new Error('unknown RFB client message');
					if (b.length < 8) return Buffer.concat(output);
					// The desktop is one screen. A layout of any other count is
					// not something this desktop has, so the stream ends.
					if (b[6] !== 1) throw new Error('RFB resize needs one screen');
					size = 24;
					break;
				default:
					throw new Error('unknown RFB client message');
			}
			if (b.length < size) break;
			const message = b.subarray(0, size);
			if (type === SET_DESKTOP_SIZE) {
				// A view-only stream cannot change the screen.
				const admitted =
					this.mode === 'control' ? this.admitResize(message) : undefined;
				if (admitted) output.push(admitted);
				this.pending = Buffer.from(b.subarray(size));
				continue;
			}
			if (type === 0) validatePixelFormat(message.subarray(4));
			if (type === 3 && message[1]! > 1)
				throw new Error('invalid RFB update request');
			if (type === 4 && message[1]! > 1)
				throw new Error('invalid RFB key event');
			if (type === 2) output.push(allowedEncodings(message, this.mode));
			else if (this.mode === 'control' || type === 0 || type === 3) {
				output.push(message);
				if (type === 4 || type === 5) this.observe?.(message);
			}
			this.pending = Buffer.from(b.subarray(size));
		}
		return Buffer.concat(output);
	}
	close(): void {
		this.pending = Buffer.alloc(0);
		this.cancelResize?.();
		this.cancelResize = undefined;
		this.resizeHeld = undefined;
	}
}
/** Encodings whose server messages need no client reply this filter blocks.
 * Fences, continuous updates and the other extensions start exchanges this
 * filter does not relay, so the server is never told the client supports them.
 * ExtendedClipboard's replies are all ClientCutText, relayed in control mode.
 * A view-only stream is never offered it: the display server then has no
 * extended clipboard exchange to start, and the view-only credential the
 * stream authenticates with keeps the legacy form from being sent. */
const EXTENDED_CLIPBOARD_ENCODING = -1063131698; // 0xC0A1E5CE
const relayedEncodings = new Set([
	0,
	1,
	2,
	5,
	7,
	16,
	-223,
	-224,
	-239,
	-307,
	-308,
	EXTENDED_CLIPBOARD_ENCODING,
	...Array.from({ length: 10 }, (_, i) => -23 - i),
	...Array.from({ length: 10 }, (_, i) => -247 - i),
]);
function allowedEncodings(message: Buffer, mode: DesktopMode): Buffer {
	const kept: number[] = [];
	for (let i = 0; i < u16(message, 2); i++) {
		const encoding = view(message).getInt32(4 + i * 4);
		if (encoding === EXTENDED_CLIPBOARD_ENCODING && mode !== 'control')
			continue;
		if (relayedEncodings.has(encoding)) kept.push(encoding);
	}
	const out = Buffer.alloc(4 + kept.length * 4);
	out[0] = 2;
	const target = view(out);
	target.setUint16(2, kept.length);
	for (const [i, e] of kept.entries()) target.setInt32(4 + i * 4, e);
	return out;
}
export function validatePixelFormat(format: Uint8Array): void {
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
export function vncChallengeResponse(
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
export async function readExact(
	source: Readable,
	size: number,
): Promise<Buffer> {
	if (size === 0) return Buffer.alloc(0);
	while (true) {
		const value = source.read(size) as Buffer | null;
		if (value !== null) return value;
		if (source.destroyed || source.readableEnded)
			throw new Error('RFB tunnel ended');
		await once(source, 'readable');
	}
}
export async function writeAll(
	target: Writable,
	bytes: Uint8Array,
): Promise<void> {
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

/** Keys and pointer buttons a stream pressed and has not released. */
export interface HeldInput {
	readonly keys: number;
	readonly buttons: boolean;
	/** Where the pointer was when this stream last moved it. */
	readonly x: number;
	readonly y: number;
}

/** What a relay asks of its owner on every read and write callback. */
export interface RfbRelayAuthority {
	/** Aborted when the client's connection or its authority ends. */
	readonly signal: AbortSignal;
	/** Throws once the client may no longer use the stream. */
	readonly assert: () => void;
}

export interface RfbRelayOptions {
	readonly mode: DesktopMode;
	readonly authority: RfbRelayAuthority;
	/** Upstream server-to-client bytes, positioned after ServerInit. */
	readonly source: Readable;
	/** Upstream client-to-server bytes. */
	readonly sink: Writable;
	/** The ServerInit message the upstream sent, replayed to the client. */
	readonly serverInit: Buffer;
	readonly limits: RfbClientLimits;
	/** Lets a control stream resize the desktop's screen within these
	 * limits. Left out, a resize request closes the stream. */
	readonly resize?: DesktopResizeLimits;
	/** Runs once, when the relay is destroyed for any reason. */
	readonly teardown: () => void;
}

/** Authenticated upstream, security None downstream. Writable callbacks wait
 * for the upstream's drain; readable high-water marks pause the upstream. */
export class RfbRelay extends Duplex {
	private clientPending = Buffer.alloc(0);
	private stage: 'version' | 'security' | 'init' | 'messages' = 'version';
	private readonly clientFilter: RfbClientFilter;
	private flowing = false;
	private readonly abort: () => void;
	private readonly data: (chunk: Buffer) => void;
	private readonly sourceEnd: () => void;
	private readonly authority: RfbRelayAuthority;
	private readonly source: Readable;
	private readonly sink: Writable;
	private readonly serverInit: Buffer;
	private readonly limits: RfbClientLimits;
	private readonly teardown: () => void;
	private readonly keysDown = new Set<number>();
	private pointer = { buttons: 0, x: 0, y: 0 };
	constructor(options: RfbRelayOptions) {
		super({
			readableHighWaterMark: 256 * 1024,
			writableHighWaterMark: 256 * 1024,
		});
		const { authority, source, sink } = options;
		this.authority = authority;
		this.source = source;
		this.sink = sink;
		this.serverInit = options.serverInit;
		this.limits = options.limits;
		this.teardown = options.teardown;
		this.clientFilter = new RfbClientFilter(
			options.mode,
			options.limits,
			(message) => this.track(message),
			options.resize && {
				limits: options.resize,
				now: () => Date.now(),
				later: (delayMs, run) => {
					const timer = setTimeout(run, delayMs);
					return () => clearTimeout(timer);
				},
				send: (message) => {
					if (this.destroyed) return;
					try {
						this.authority.assert();
					} catch {
						this.destroy();
						return;
					}
					void writeAll(this.sink, message).catch(() => this.destroy());
				},
			},
		);
		this.abort = () => this.destroy();
		this.data = (bytes) => {
			try {
				authority.assert();
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
		this.push(RFB_BANNER);
	}
	/** Follows what this stream has pressed, from the events it was allowed
	 * to send. A press is counted before its write completes, so input cut
	 * off mid-write is still reported as possibly held. */
	private track(message: Buffer): void {
		if (message[0] === 4) {
			const keysym = view(message).getUint32(4);
			if (message[1]) this.keysDown.add(keysym);
			else this.keysDown.delete(keysym);
		} else {
			this.pointer = {
				buttons: message[1]!,
				x: u16(message, 2),
				y: u16(message, 4),
			};
		}
	}
	/** What this stream may still hold down on the desktop. */
	heldInput(): HeldInput {
		return {
			keys: this.keysDown.size,
			buttons: this.pointer.buttons !== 0,
			x: this.pointer.x,
			y: this.pointer.y,
		};
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
		this.authority.assert();
		if (this.clientPending.length + bytes.length > this.limits.inputBytes)
			throw new Error('RFB input limit');
		this.clientPending = Buffer.concat([this.clientPending, bytes]);
		while (!this.destroyed) {
			const length =
				this.stage === 'version' ? 12 : this.stage === 'messages' ? 0 : 1;
			if (this.clientPending.length < length) return;
			if (this.stage === 'messages') {
				const allowed = this.clientFilter.push(this.clientPending);
				this.clientPending = Buffer.alloc(0);
				if (allowed.length) await writeAll(this.sink, allowed);
				return;
			}
			const message = this.clientPending.subarray(0, length);
			this.clientPending = Buffer.from(this.clientPending.subarray(length));
			if (this.stage === 'version') {
				if (message.toString() !== RFB_BANNER.toString())
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

export interface VncHandshakeOptions {
	readonly source: Readable;
	readonly sink: Writable;
	/** Hands the VNC password to the callback and wipes it afterwards. */
	readonly withPassword: <T>(
		callback: (password: Uint8Array) => Promise<T>,
	) => Promise<T>;
}

/** Authenticate to an upstream VNC server with VncAuth and return its
 * ServerInit message. The caller owns deadlines and teardown. */
export async function vncHandshake(
	options: VncHandshakeOptions,
): Promise<Buffer> {
	const { source, sink } = options;
	const u32 = (b: Uint8Array, offset: number) => view(b).getUint32(offset);
	if ((await readExact(source, 12)).toString() !== RFB_BANNER.toString())
		throw new Error('RFB 3.8 required');
	await writeAll(sink, RFB_BANNER);
	const count = (await readExact(source, 1))[0]!;
	if (!count || !(await readExact(source, count)).includes(2))
		throw new Error('VNC authentication required');
	await writeAll(sink, Buffer.from([2]));
	const challenge = await readExact(source, 16);
	await options.withPassword(async (password) => {
		const response = vncChallengeResponse(password, challenge);
		try {
			await writeAll(sink, response);
		} finally {
			response.fill(0);
		}
	});
	if (u32(await readExact(source, 4), 0) !== 0)
		throw new Error('desktop authentication failed');
	await writeAll(sink, Buffer.from([1]));
	const header = await readExact(source, 24);
	if (u32(header, 20) > 1024 * 1024)
		throw new Error('desktop server name too large');
	validatePixelFormat(header.subarray(4, 20));
	return Buffer.concat([header, await readExact(source, u32(header, 20))]);
}

/** One connection to a desktop's VNC service. */
export interface DesktopUpstream {
	/** Server-to-client bytes. */
	readonly source: Readable;
	/** Client-to-server bytes. */
	readonly sink: Writable;
	/** Calls `listener` once, when the connection ends for any reason. */
	onEnd(listener: () => void): void;
	/** Ends the connection. Safe to call more than once. */
	close(): void;
}

/** How a desktop's VNC service is reached. Each call is a new connection:
 * a client stream never shares its upstream with another. */
export interface DesktopConnector {
	open(): DesktopUpstream | Promise<DesktopUpstream>;
}

/** A VNC service listening on a unix socket of the server's own account. */
export function unixSocketConnector(path: string): DesktopConnector {
	return {
		open: () =>
			new Promise<DesktopUpstream>((resolve, reject) => {
				const socket = connectSocket(path);
				const ended: (() => void)[] = [];
				let over = false;
				const end = () => {
					if (over) return;
					over = true;
					for (const listener of ended.splice(0)) listener();
				};
				socket.once('close', end);
				socket.once('error', (error) => {
					end();
					reject(error);
				});
				socket.once('connect', () =>
					resolve({
						source: socket,
						sink: socket,
						onEnd: (listener) => {
							if (over) listener();
							else ended.push(listener);
						},
						close: () => socket.destroy(),
					}),
				);
			}),
	};
}

export interface ConnectDesktopOptions {
	readonly connector: DesktopConnector;
	/** Hands over the VNC password for this connection and wipes it after. */
	readonly withPassword: <T>(
		callback: (password: Uint8Array) => Promise<T>,
	) => Promise<T>;
	/** Aborting ends the attempt and closes the connection. */
	readonly signal?: AbortSignal;
	/** One absolute bound on connecting and authenticating. */
	readonly deadlineMs?: number;
}

/** Open one upstream connection and authenticate it. Whatever goes wrong,
 * the connection is closed and the error says only that connecting failed. */
export async function connectDesktop(
	options: ConnectDesktopOptions,
): Promise<{ upstream: DesktopUpstream; serverInit: Buffer }> {
	let upstream: DesktopUpstream | undefined;
	const stop = () => {
		upstream?.source.destroy(new Error('desktop connection ended'));
		upstream?.close();
	};
	// One absolute deadline, which also unblocks an EOF mid-message.
	const timeout = setTimeout(stop, options.deadlineMs ?? 10_000);
	options.signal?.addEventListener('abort', stop, { once: true });
	try {
		options.signal?.throwIfAborted();
		upstream = await options.connector.open();
		upstream.source.on('error', () => undefined);
		upstream.sink.on('error', () => undefined);
		upstream.onEnd(stop);
		options.signal?.throwIfAborted();
		const serverInit = await vncHandshake({
			source: upstream.source,
			sink: upstream.sink,
			withPassword: options.withPassword,
		});
		options.signal?.throwIfAborted();
		return { upstream, serverInit };
	} catch {
		stop();
		throw new Error('desktop connection failed');
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener('abort', stop);
	}
}

/**
 * Let go of pointer buttons a closed control stream left down.
 *
 * Closing a stream's upstream connection makes the display server release
 * the keys that connection held. TigerVNC 1.15 releases its pointer buttons
 * too, but 1.12 keeps them down until a connection with full rights sends a
 * pointer event with no buttons. This opens such a connection, sends that one
 * event where the pointer last was, and closes it.
 */
export async function releasePointerButtons(
	options: ConnectDesktopOptions & { readonly x: number; readonly y: number },
): Promise<boolean> {
	try {
		const { upstream } = await connectDesktop({
			deadlineMs: 5_000,
			...options,
		});
		try {
			const event = Buffer.alloc(6);
			event[0] = 5;
			view(event).setUint16(2, options.x);
			view(event).setUint16(4, options.y);
			await writeAll(upstream.sink, event);
			// The server reads the event before it sees the close.
			await new Promise<void>((resolve) => {
				upstream.sink.end(resolve);
			});
		} finally {
			upstream.close();
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Orders input release before the next controller. Work held here finishes
 * before `settled()` resolves, so a new control stream waits for the previous
 * one's buttons to be let go.
 */
export class DesktopInputGate {
	private pending: Promise<void> = Promise.resolve();
	hold(work: Promise<unknown>): void {
		const previous = this.pending;
		this.pending = (async () => {
			await previous;
			await work.catch(() => undefined);
		})();
	}
	settled(): Promise<void> {
		return this.pending;
	}
}

export interface DesktopStreamOptions<Relay extends RfbRelay = RfbRelay> {
	readonly connector: DesktopConnector;
	readonly mode: DesktopMode;
	readonly authority: RfbRelayAuthority;
	/** The VNC password for a connection of `mode`: the full one for
	 * control, the view-only one otherwise. */
	readonly withPassword: <T>(
		mode: DesktopMode,
		callback: (password: Uint8Array) => Promise<T>,
	) => Promise<T>;
	readonly limits: RfbClientLimits;
	/** Lets a control stream resize the screen; see `RfbRelayOptions`. */
	readonly resize?: DesktopResizeLimits;
	/** Shared by every stream of one desktop. */
	readonly gate: DesktopInputGate;
	/** Checked after connecting; throwing abandons the stream. */
	readonly admit?: () => void;
	/** Whether the desktop is still there to release input on. */
	readonly releasable?: () => boolean;
	/** Runs once when the stream has ended. */
	readonly onClosed?: () => void;
	/** Builds the relay; defaults to a plain `RfbRelay`. */
	readonly create?: (options: RfbRelayOptions) => Relay;
}

/**
 * Open one client stream onto a desktop: its own upstream connection,
 * authenticated with the credential for its mode, behind a relay.
 *
 * When a control stream ends, its connection is closed, which releases the
 * keys it held, and any pointer button it left down is released through a
 * new full-rights connection. The gate holds the next control stream back
 * until that is done, so nothing a previous controller pressed is still down
 * when later input arrives.
 */
export async function openDesktopStream<Relay extends RfbRelay = RfbRelay>(
	options: DesktopStreamOptions<Relay>,
): Promise<Relay> {
	const { connector, mode, gate } = options;
	if (mode === 'control') await gate.settled();
	const { upstream, serverInit } = await connectDesktop({
		connector,
		withPassword: (callback) => options.withPassword(mode, callback),
		signal: options.authority.signal,
	});
	try {
		options.authority.assert();
		options.admit?.();
	} catch {
		upstream.close();
		throw new Error('desktop connection failed');
	}
	const create =
		options.create ??
		((relayOptions: RfbRelayOptions) => new RfbRelay(relayOptions) as Relay);
	const relay: Relay = create({
		mode,
		authority: options.authority,
		source: upstream.source,
		sink: upstream.sink,
		serverInit,
		limits: options.limits,
		...(options.resize ? { resize: options.resize } : {}),
		teardown: () => {
			const held = relay.heldInput();
			upstream.close();
			if (
				mode === 'control' &&
				held.buttons &&
				(options.releasable?.() ?? true)
			)
				gate.hold(
					releasePointerButtons({
						connector,
						withPassword: (callback) =>
							options.withPassword('control', callback),
						x: held.x,
						y: held.y,
					}),
				);
			options.onClosed?.();
		},
	});
	return relay;
}
