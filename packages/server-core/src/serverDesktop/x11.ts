import { readFile } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { xDisplayFiles } from './paths.js';

/**
 * The little of the X11 protocol the desktop needs, spoken directly: writing
 * the cookie file, and counting the program windows open on the display. No
 * X client program is run for either, so no cookie ever appears in a command
 * line.
 */

const COOKIE_NAME = 'MIT-MAGIC-COOKIE-1';
/** Matches any host, so the cookie survives a hostname change. */
const FAMILY_WILD = 0xffff;

/** One `.Xauthority` entry for `display`, in the file's binary form. */
export function xauthorityEntry(display: number, cookie: Uint8Array): Buffer {
	const field = (bytes: Uint8Array) => {
		const length = Buffer.alloc(2);
		view(length).setUint16(0, bytes.length);
		return Buffer.concat([length, bytes]);
	};
	const family = Buffer.alloc(2);
	view(family).setUint16(0, FAMILY_WILD);
	return Buffer.concat([
		family,
		field(Buffer.alloc(0)),
		field(Buffer.from(String(display))),
		field(Buffer.from(COOKIE_NAME)),
		field(cookie),
	]);
}

/** The cookie for `display` in an `.Xauthority` file's bytes, if present. */
export function readXauthorityCookie(
	file: Uint8Array,
	display: number,
): Buffer | undefined {
	const bytes = Buffer.from(file);
	let at = 0;
	const field = () => {
		if (at + 2 > bytes.length) throw new Error('truncated');
		const length = view(bytes).getUint16(at);
		at += 2;
		if (at + length > bytes.length) throw new Error('truncated');
		const value = bytes.subarray(at, at + length);
		at += length;
		return value;
	};
	try {
		while (at < bytes.length) {
			at += 2; // family
			field(); // address
			const number = field().toString();
			const name = field().toString();
			const data = field();
			if (number === String(display) && name === COOKIE_NAME)
				return Buffer.from(data);
		}
	} catch {
		return undefined;
	}
	return undefined;
}

const pad = (length: number) => (4 - (length % 4)) % 4;
const view = (bytes: Uint8Array) =>
	new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** A connection that hands back exactly the bytes asked for. */
class Reader {
	private buffered = Buffer.alloc(0);
	private waiter: (() => void) | undefined;
	private ended = false;
	constructor(socket: Socket) {
		socket.on('data', (chunk: Buffer) => {
			this.buffered = Buffer.concat([this.buffered, chunk]);
			this.waiter?.();
		});
		const end = () => {
			this.ended = true;
			this.waiter?.();
		};
		socket.on('error', end);
		socket.on('close', end);
	}
	async read(length: number): Promise<Buffer> {
		while (this.buffered.length < length) {
			if (this.ended) throw new Error('X connection closed');
			await new Promise<void>((resolve) => {
				this.waiter = resolve;
			});
			this.waiter = undefined;
		}
		const out = this.buffered.subarray(0, length);
		this.buffered = this.buffered.subarray(length);
		return out;
	}
}

/**
 * How many program windows are open on the display: the windows the window
 * manager manages, leaving out the desktop background and the panel.
 */
export async function countProgramWindows(
	display: number,
	cookieFile: string,
	timeoutMs = 5_000,
): Promise<number> {
	const cookie = readXauthorityCookie(await readFile(cookieFile), display);
	if (cookie === undefined) throw new Error('no cookie for the display');
	const socket = connect(xDisplayFiles(display).socket);
	const timer = setTimeout(() => socket.destroy(), timeoutMs);
	try {
		await new Promise<void>((resolve, reject) => {
			socket.once('connect', resolve);
			socket.once('error', reject);
		});
		const reader = new Reader(socket);
		const name = Buffer.from(COOKIE_NAME);
		const setup = Buffer.alloc(12);
		setup[0] = 0x6c; // little-endian
		view(setup).setUint16(2, 11, true);
		view(setup).setUint16(4, 0, true);
		view(setup).setUint16(6, name.length, true);
		view(setup).setUint16(8, cookie.length, true);
		socket.write(
			Buffer.concat([
				setup,
				name,
				Buffer.alloc(pad(name.length)),
				cookie,
				Buffer.alloc(pad(cookie.length)),
			]),
		);
		const head = await reader.read(8);
		if (head[0] !== 1) throw new Error('the display refused the connection');
		const body = await reader.read(view(head).getUint16(6, true) * 4);
		const vendorLength = view(body).getUint16(16, true);
		const formats = body[21] as number;
		const root = view(body).getUint32(
			32 + vendorLength + pad(vendorLength) + formats * 8,
			true,
		);

		const atom = async (text: string): Promise<number> => {
			const bytes = Buffer.from(text);
			const request = Buffer.alloc(8);
			request[0] = 16; // InternAtom
			request[1] = 1; // only if it exists
			view(request).setUint16(2, 2 + (bytes.length + pad(bytes.length)) / 4, true);
			view(request).setUint16(4, bytes.length, true);
			socket.write(Buffer.concat([request, bytes, Buffer.alloc(pad(bytes.length))]));
			const reply = await reader.read(32);
			if (reply[0] !== 1) return 0;
			return view(reply).getUint32(8, true);
		};
		const property = async (
			window: number,
			which: number,
		): Promise<readonly number[]> => {
			if (which === 0) return [];
			const request = Buffer.alloc(24);
			request[0] = 20; // GetProperty
			view(request).setUint16(2, 6, true);
			view(request).setUint32(4, window, true);
			view(request).setUint32(8, which, true);
			view(request).setUint32(12, 0, true); // any type
			view(request).setUint32(16, 0, true);
			view(request).setUint32(20, 4096, true);
			socket.write(request);
			const reply = await reader.read(32);
			if (reply[0] !== 1) return [];
			const data = await reader.read(view(reply).getUint32(4, true) * 4);
			if (reply[1] !== 32) return [];
			const count = view(reply).getUint32(16, true);
			const values: number[] = [];
			for (let i = 0; i < count && (i + 1) * 4 <= data.length; i++)
				values.push(view(data).getUint32(i * 4, true));
			return values;
		};

		const clientList = await atom('_NET_CLIENT_LIST');
		const windowType = await atom('_NET_WM_WINDOW_TYPE');
		const furniture = new Set(
			[
				await atom('_NET_WM_WINDOW_TYPE_DESKTOP'),
				await atom('_NET_WM_WINDOW_TYPE_DOCK'),
			].filter((value) => value !== 0),
		);
		let count = 0;
		for (const window of await property(root, clientList)) {
			const types = await property(window, windowType);
			if (!types.some((type) => furniture.has(type))) count += 1;
		}
		return count;
	} finally {
		clearTimeout(timer);
		socket.destroy();
	}
}
