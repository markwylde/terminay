import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Socket } from 'node:net';

/**
 * The control protocol between a server and its desktop holder.
 *
 * Internal to the server: no client, extension, or MCP caller ever speaks it.
 * Messages are JSON, one per line. A connection opens with a handshake in
 * which each side proves it holds the credential, an HMAC over both nonces,
 * so the credential never crosses the socket and neither proof can be
 * replayed as the other's. A holder serves nothing before the server's proof.
 *
 * The version is the holder's. A server that cannot speak it may still ask it
 * to stop: `stop` means the same in every version.
 */
export const DESKTOP_HOLDER_PROTOCOL_VERSION = 1;
export const DESKTOP_HOLDER_SUPPORTED_VERSIONS: readonly number[] = [1];
const NONCE_BYTES = 32;
/** Longest line either side accepts. */
export const DESKTOP_HOLDER_MAX_LINE_BYTES = 64 * 1024;

export type DesktopHolderPhase =
	/** The display server and session are being started. */
	| 'starting'
	| 'running'
	/** They could not be kept running; `reason` says why. */
	| 'failed';

export interface DesktopHolderState {
	readonly phase: DesktopHolderPhase;
	/** The X display number, once chosen. */
	readonly display?: number;
	/** Counts starts of the display server. A change means every window and
	 * every stream of the previous display is gone. */
	readonly generation: number;
	readonly reason?: string;
}

export type DesktopHolderRequest =
	| { readonly t: 'status' }
	/** The two VNC passwords, for the server's own upstream connections. */
	| { readonly t: 'credentials' }
	/** How many program windows are open on the display. */
	| { readonly t: 'windows' }
	/** End the session and the display server, and exit. */
	| { readonly t: 'stop' };

export type DesktopHolderReply =
	| { readonly t: 'state'; readonly state: DesktopHolderState }
	| {
			readonly t: 'credentials';
			readonly full: string;
			readonly viewOnly: string;
	  }
	| { readonly t: 'windows'; readonly count: number }
	| { readonly t: 'stopping' }
	| { readonly t: 'error'; readonly message: string };

export function newNonce(): string {
	return randomBytes(NONCE_BYTES).toString('hex');
}

export function isNonce(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length === NONCE_BYTES * 2 &&
		/^[0-9a-f]+$/u.test(value)
	);
}

export function handshakeProof(
	credential: string,
	role: 'holder' | 'server',
	ownNonce: string,
	peerNonce: string,
): string {
	return createHmac('sha256', credential)
		.update(`terminay-desktop-holder-proof\0${role}\0${ownNonce}\0${peerNonce}`)
		.digest('hex');
}

export function proofMatches(offered: unknown, expected: string): boolean {
	if (typeof offered !== 'string') return false;
	const left = Buffer.from(offered, 'utf8');
	const right = Buffer.from(expected, 'utf8');
	return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

/** Reads newline-delimited JSON objects from a socket, bounded per line. */
export class LineReader {
	private pending = Buffer.alloc(0);
	private readonly waiting: {
		resolve: (value: Record<string, unknown>) => void;
		reject: (error: Error) => void;
	}[] = [];
	private readonly ready: Record<string, unknown>[] = [];
	private failure: Error | undefined;
	/** Called for each message when nobody is waiting for one. */
	onMessage: ((message: Record<string, unknown>) => void) | undefined;

	constructor(private readonly socket: Socket) {
		socket.on('data', (chunk: Buffer) => this.push(chunk));
		socket.on('error', () => this.fail(new Error('control connection failed')));
		socket.on('close', () => this.fail(new Error('control connection closed')));
	}

	private push(chunk: Buffer): void {
		this.pending = Buffer.concat([this.pending, chunk]);
		while (true) {
			const end = this.pending.indexOf(0x0a);
			if (end < 0) {
				if (this.pending.length > DESKTOP_HOLDER_MAX_LINE_BYTES) {
					this.fail(new Error('control message too long'));
					this.socket.destroy();
				}
				return;
			}
			const line = this.pending.subarray(0, end);
			this.pending = this.pending.subarray(end + 1);
			if (line.length > DESKTOP_HOLDER_MAX_LINE_BYTES) {
				this.fail(new Error('control message too long'));
				this.socket.destroy();
				return;
			}
			let message: unknown;
			try {
				message = JSON.parse(line.toString('utf8'));
			} catch {
				this.fail(new Error('control message is not JSON'));
				this.socket.destroy();
				return;
			}
			if (typeof message !== 'object' || message === null || Array.isArray(message)) {
				this.fail(new Error('control message is not an object'));
				this.socket.destroy();
				return;
			}
			const waiter = this.waiting.shift();
			if (waiter !== undefined) waiter.resolve(message as Record<string, unknown>);
			else if (this.onMessage !== undefined)
				this.onMessage(message as Record<string, unknown>);
			else this.ready.push(message as Record<string, unknown>);
		}
	}

	private fail(error: Error): void {
		if (this.failure !== undefined) return;
		this.failure = error;
		for (const waiter of this.waiting.splice(0)) waiter.reject(error);
	}

	next(): Promise<Record<string, unknown>> {
		const ready = this.ready.shift();
		if (ready !== undefined) return Promise.resolve(ready);
		if (this.failure !== undefined) return Promise.reject(this.failure);
		return new Promise((resolve, reject) => {
			this.waiting.push({ resolve, reject });
		});
	}
}

export function sendLine(socket: Socket, message: object): void {
	if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
}

export function parseHolderState(value: unknown): DesktopHolderState | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const input = value as Record<string, unknown>;
	if (
		!['starting', 'running', 'failed'].includes(input.phase as string) ||
		!Number.isSafeInteger(input.generation) ||
		(input.display !== undefined &&
			(!Number.isInteger(input.display) ||
				(input.display as number) < 0 ||
				(input.display as number) > 65535)) ||
		(input.reason !== undefined && typeof input.reason !== 'string')
	)
		return undefined;
	return {
		phase: input.phase as DesktopHolderPhase,
		generation: input.generation as number,
		...(input.display === undefined ? {} : { display: input.display as number }),
		...(input.reason === undefined
			? {}
			: { reason: (input.reason as string).slice(0, 2048) }),
	};
}
