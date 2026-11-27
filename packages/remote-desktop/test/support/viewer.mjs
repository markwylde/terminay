/**
 * A minimal RFB viewer for tests. It speaks to any duplex stream: a relay, or
 * a socket to a display server. It never asks for framebuffer updates, so the
 * only server messages it sees are the ones a test provokes, and it keeps the
 * raw bytes so a test can assert on exactly what a stream carried.
 */

import { createCipheriv } from 'node:crypto';

export const ENCODING = Object.freeze({
	raw: 0,
	extendedDesktopSize: -308,
	extendedClipboard: -1063131698,
});

const CLIPBOARD_ACTIONS = [
	[24, 'caps'],
	[25, 'request'],
	[26, 'peek'],
	[27, 'notify'],
	[28, 'provide'],
];

function vncResponse(password, challenge) {
	const key = Buffer.alloc(24);
	for (let i = 0; i < 8; i++) {
		let byte = password[i] ?? 0;
		let reversed = 0;
		for (let bit = 0; bit < 8; bit++) {
			reversed = (reversed << 1) | (byte & 1);
			byte >>= 1;
		}
		key[i] = key[i + 8] = key[i + 16] = reversed;
	}
	const cipher = createCipheriv('des-ede3', key, null);
	cipher.setAutoPadding(false);
	return Buffer.concat([cipher.update(challenge), cipher.final()]);
}

export class Viewer {
	/** Every byte the stream delivered after the handshake. */
	raw = Buffer.alloc(0);
	closed = false;
	#stream;
	#pending = Buffer.alloc(0);
	#waiters = [];
	#parsed = 0;

	constructor(stream) {
		this.#stream = stream;
		stream.on('data', (chunk) => {
			this.#pending = Buffer.concat([this.#pending, chunk]);
			this.#wake();
		});
		const end = () => {
			this.closed = true;
			this.#wake();
		};
		stream.on('close', end);
		stream.on('end', end);
		stream.on('error', end);
	}
	#wake() {
		for (const waiter of this.#waiters.splice(0)) waiter();
	}
	async #take(size) {
		while (this.#pending.length < size) {
			if (this.closed) throw new Error('stream closed during handshake');
			await new Promise((resolve) => this.#waiters.push(resolve));
		}
		const out = this.#pending.subarray(0, size);
		this.#pending = this.#pending.subarray(size);
		return out;
	}
	#send(bytes) {
		return new Promise((resolve, reject) =>
			this.#stream.write(bytes, (error) => (error ? reject(error) : resolve())),
		);
	}
	/** Handshake. With a password, VncAuth; without, security None. */
	async connect(password) {
		await this.#take(12);
		await this.#send(Buffer.from('RFB 003.008\n'));
		const types = await this.#take((await this.#take(1))[0]);
		if (password === undefined) {
			if (!types.includes(1)) throw new Error('security None not offered');
			await this.#send(Buffer.from([1]));
		} else {
			if (!types.includes(2)) throw new Error('VncAuth not offered');
			await this.#send(Buffer.from([2]));
			await this.#send(vncResponse(password, await this.#take(16)));
		}
		if ((await this.#take(4)).readUInt32BE(0) !== 0)
			throw new Error('authentication failed');
		await this.#send(Buffer.from([1]));
		const header = await this.#take(24);
		await this.#take(header.readUInt32BE(20));
		this.width = header.readUInt16BE(0);
		this.height = header.readUInt16BE(2);
		// From here on, everything received is kept raw.
		this.raw = this.#pending;
		this.#pending = Buffer.alloc(0);
		this.#stream.removeAllListeners('data');
		this.#stream.on('data', (chunk) => {
			this.raw = Buffer.concat([this.raw, chunk]);
		});
		return this;
	}
	setEncodings(encodings) {
		const message = Buffer.alloc(4 + encodings.length * 4);
		message[0] = 2;
		message.writeUInt16BE(encodings.length, 2);
		for (const [i, e] of encodings.entries())
			message.writeInt32BE(e, 4 + i * 4);
		return this.#send(message);
	}
	key(keysym, down) {
		const message = Buffer.alloc(8);
		message[0] = 4;
		message[1] = down ? 1 : 0;
		message.writeUInt32BE(keysym, 4);
		return this.#send(message);
	}
	pointer(x, y, buttons = 0) {
		const message = Buffer.alloc(6);
		message[0] = 5;
		message[1] = buttons;
		message.writeUInt16BE(x, 2);
		message.writeUInt16BE(y, 4);
		return this.#send(message);
	}
	/** SetDesktopSize with one screen per entry of `screens` (default one). */
	resize(width, height, screens = 1) {
		const message = Buffer.alloc(8 + 16 * screens);
		message[0] = 251;
		message.writeUInt16BE(width, 2);
		message.writeUInt16BE(height, 4);
		message[6] = screens;
		for (let i = 0; i < screens; i++) {
			const at = 8 + 16 * i;
			message.writeUInt32BE(i + 1, at);
			message.writeUInt16BE(0, at + 4);
			message.writeUInt16BE(0, at + 6);
			message.writeUInt16BE(width, at + 8);
			message.writeUInt16BE(height, at + 10);
		}
		return this.#send(message);
	}
	/** ExtendedClipboard request for text. */
	requestClipboard() {
		const message = Buffer.alloc(12);
		message[0] = 6;
		message.writeInt32BE(-4, 4);
		message.writeUInt32BE(((1 << 25) | 1) >>> 0, 8);
		return this.#send(message);
	}
	/** Legacy ClientCutText. */
	cutText(text) {
		const body = Buffer.from(text, 'latin1');
		const header = Buffer.alloc(8);
		header[0] = 6;
		header.writeUInt32BE(body.length, 4);
		return this.#send(Buffer.concat([header, body]));
	}
	send(bytes) {
		return this.#send(bytes);
	}
	/**
	 * Parse what has arrived since the last call. Returns clipboard and bell
	 * messages; throws on anything else, which a viewer that never requests a
	 * framebuffer update should not be sent.
	 */
	messages() {
		const out = [];
		const b = this.raw;
		let at = this.#parsed;
		while (at < b.length) {
			const type = b[at];
			if (type === 2) {
				out.push({ type: 'bell' });
				at += 1;
			} else if (type === 3) {
				if (b.length < at + 8) break;
				const length = b.readInt32BE(at + 4);
				const size = 8 + Math.abs(length);
				if (b.length < at + size) break;
				if (length >= 0) {
					out.push({
						type: 'clipboard',
						form: 'legacy',
						text: b.subarray(at + 8, at + size).toString('latin1'),
					});
				} else {
					const flags = b.readUInt32BE(at + 8);
					out.push({
						type: 'clipboard',
						form: 'extended',
						actions: CLIPBOARD_ACTIONS.filter(
							([bit]) => flags & (1 << bit),
						).map(([, name]) => name),
						payloadBytes: -length - 4,
					});
				}
				at += size;
			} else {
				throw new Error(`unexpected server message type ${type}`);
			}
		}
		this.#parsed = at;
		return out;
	}
	close() {
		this.#stream.destroy();
	}
}

export const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
