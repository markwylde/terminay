/**
 * Wire protocol between a Terminay Server and its detached session holder.
 *
 * This is internal to the server (ADR-0035): it is not the application
 * protocol, and no client, host, extension, or MCP caller ever speaks it. A
 * holder's protocol is frozen for the life of its sessions, so a released
 * version's wire bytes must never change; a new behaviour is a new version.
 *
 * A frame is `[u32 frameLength][u32 headerLength][header JSON][payload]`, all
 * lengths big-endian, `frameLength` counting everything after itself. Terminal
 * bytes travel only in the payload, never in the JSON header.
 */

export const SESSION_HOLDER_PROTOCOL_VERSIONS: readonly number[] = [1];

/** Largest payload a single frame may carry. */
export const SESSION_HOLDER_MAX_PAYLOAD_BYTES = 1024 * 1024;
/** Largest JSON header. A spawn header carries a whole shell environment. */
export const SESSION_HOLDER_MAX_HEADER_BYTES = 1024 * 1024;
export const SESSION_HOLDER_MAX_FRAME_BYTES =
	4 + SESSION_HOLDER_MAX_HEADER_BYTES + SESSION_HOLDER_MAX_PAYLOAD_BYTES;

export interface HolderExitRecord {
	readonly exitCode: number | null;
	readonly signal: number | null;
	readonly at: number;
}

export interface HolderSessionRecord {
	readonly sessionId: string;
	readonly projectId?: string;
	readonly pid?: number;
	readonly shellPath: string;
	readonly cwd: string;
	readonly cols: number;
	readonly rows: number;
	readonly createdAt: number;
	/** Byte offset one past the last output byte produced. */
	readonly outputPosition: number;
	/** First output position still held in the ring. */
	readonly bufferedFrom: number;
	readonly exit?: HolderExitRecord;
}

export const HOLDER_CLOSE_REASONS = [
	'empty',
	'limit',
	'end-all',
	'signal',
	'first-attach-timeout',
	'crash',
] as const;
export type HolderCloseReason = (typeof HOLDER_CLOSE_REASONS)[number];

/**
 * Why a holder closed and what it held, as it tells an attached server and
 * records in the data root. It carries counts and times only: no session id,
 * path, or output.
 */
export interface HolderCloseNotice {
	readonly reason: HolderCloseReason;
	/** The signal behind a `signal` close. */
	readonly signal?: string;
	/** The uncaught error behind a `crash`. */
	readonly error?: string;
	readonly pid: number;
	readonly startedAt: number;
	readonly closedAt: number;
	readonly liveSessions: number;
	readonly endedSessions: number;
	/** Whether a server was attached when the holder began closing. */
	readonly attached: boolean;
	readonly draining: boolean;
	readonly limitMs: number | null;
	readonly attachCount: number;
	readonly lastAttachAt: number | null;
	readonly lastDetachAt: number | null;
}

const MAX_CLOSE_NOTICE_TEXT = 4_000;

/** A notice read from a frame or a file, or `undefined` when it is not one. */
export function parseHolderCloseNotice(
	value: unknown,
): HolderCloseNotice | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const notice = value as Record<string, unknown>;
	const reason = HOLDER_CLOSE_REASONS.find((known) => known === notice.reason);
	const count = (field: unknown): field is number =>
		typeof field === 'number' && Number.isSafeInteger(field) && field >= 0;
	const time = (field: unknown): field is number | null =>
		field === null || count(field);
	if (
		reason === undefined ||
		!count(notice.pid) ||
		!count(notice.startedAt) ||
		!count(notice.closedAt) ||
		!count(notice.liveSessions) ||
		!count(notice.endedSessions) ||
		!count(notice.attachCount) ||
		typeof notice.attached !== 'boolean' ||
		typeof notice.draining !== 'boolean' ||
		!time(notice.limitMs) ||
		!time(notice.lastAttachAt) ||
		!time(notice.lastDetachAt)
	)
		return undefined;
	const text = (field: unknown): string | undefined =>
		typeof field === 'string' ? field.slice(0, MAX_CLOSE_NOTICE_TEXT) : undefined;
	const signal = text(notice.signal);
	const error = text(notice.error);
	return {
		reason,
		...(signal === undefined ? {} : { signal }),
		...(error === undefined ? {} : { error }),
		pid: notice.pid,
		startedAt: notice.startedAt,
		closedAt: notice.closedAt,
		liveSessions: notice.liveSessions,
		endedSessions: notice.endedSessions,
		attached: notice.attached,
		draining: notice.draining,
		limitMs: notice.limitMs,
		attachCount: notice.attachCount,
		lastAttachAt: notice.lastAttachAt,
		lastDetachAt: notice.lastDetachAt,
	};
}

export interface HolderSpawnRequest {
	readonly sessionId: string;
	readonly projectId?: string;
	readonly shellPath: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly name?: string;
	readonly cols: number;
	readonly rows: number;
}

/** Server to holder. Requests that expect a `result` carry an `id`. */
export type HolderClientMessage =
	| {
			readonly type: 'hello';
			readonly credential: string;
			readonly versions: readonly number[];
	  }
	| { readonly type: 'list'; readonly id: number }
	| ({ readonly type: 'spawn'; readonly id: number } & HolderSpawnRequest)
	| {
			readonly type: 'attach';
			readonly id: number;
			readonly sessionId: string;
			/** First position wanted; clamped up to the ring's first position. */
			readonly from: number;
	  }
	| { readonly type: 'write'; readonly sessionId: string }
	| {
			readonly type: 'resize';
			readonly sessionId: string;
			readonly cols: number;
			readonly rows: number;
	  }
	| {
			readonly type: 'signal';
			readonly sessionId: string;
			readonly signal?: number | string;
	  }
	| { readonly type: 'end'; readonly id: number; readonly sessionId: string }
	| { readonly type: 'endAll'; readonly id: number }
	| { readonly type: 'pause'; readonly sessionId: string }
	| { readonly type: 'resume'; readonly sessionId: string }
	| {
			readonly type: 'foreground';
			readonly id: number;
			readonly sessionId: string;
	  }
	/** `null` keeps sessions until the machine restarts. */
	| { readonly type: 'setLimit'; readonly limitMs: number | null }
	| { readonly type: 'drain' };

/** Holder to server. */
export type HolderServerMessage =
	| {
			readonly type: 'welcome';
			readonly version: number;
			readonly generation: string;
			readonly buildId: string;
			readonly pid: number;
			readonly draining: boolean;
	  }
	| {
			readonly type: 'refuse';
			readonly reason: 'credential' | 'version' | 'busy';
			readonly versions?: readonly number[];
	  }
	| {
			readonly type: 'result';
			readonly id: number;
			readonly ok: boolean;
			readonly value?: unknown;
			readonly error?: string;
	  }
	| {
			readonly type: 'data';
			readonly sessionId: string;
			/** Byte offset of the payload's first byte in the session's output. */
			readonly position: number;
	  }
	| ({
			readonly type: 'exit';
			readonly sessionId: string;
			readonly outputPosition: number;
	  } & HolderExitRecord)
	// Sent once, before a closing holder ends its sessions. A server that does
	// not know it ignores it, so it needs no new protocol version.
	| ({ readonly type: 'closing' } & HolderCloseNotice);

export type HolderMessage = HolderClientMessage | HolderServerMessage;

export interface HolderFrame<T extends HolderMessage = HolderMessage> {
	readonly message: T;
	readonly payload: Uint8Array;
}

export class HolderProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'HolderProtocolError';
	}
}

const EMPTY = new Uint8Array(0);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeHolderFrame(
	message: HolderMessage,
	payload: Uint8Array = EMPTY,
): Uint8Array {
	const header = encoder.encode(JSON.stringify(message));
	if (header.byteLength > SESSION_HOLDER_MAX_HEADER_BYTES)
		throw new HolderProtocolError('holder frame header is too large');
	if (payload.byteLength > SESSION_HOLDER_MAX_PAYLOAD_BYTES)
		throw new HolderProtocolError('holder frame payload is too large');
	const frameLength = 4 + header.byteLength + payload.byteLength;
	const frame = new Uint8Array(4 + frameLength);
	const view = new DataView(frame.buffer);
	view.setUint32(0, frameLength, false);
	view.setUint32(4, header.byteLength, false);
	frame.set(header, 8);
	frame.set(payload, 8 + header.byteLength);
	return frame;
}

/**
 * Incremental decoder for one direction of a holder connection. `push` returns
 * every frame completed by the new bytes and throws on a malformed stream; a
 * caller that catches must close the connection, since framing is then lost.
 */
export class HolderFrameDecoder {
	private buffered: Uint8Array = EMPTY;

	push(chunk: Uint8Array): HolderFrame[] {
		if (chunk.byteLength > 0) {
			const next = new Uint8Array(this.buffered.byteLength + chunk.byteLength);
			next.set(this.buffered, 0);
			next.set(chunk, this.buffered.byteLength);
			this.buffered = next;
		}
		const frames: HolderFrame[] = [];
		let offset = 0;
		for (;;) {
			const remaining = this.buffered.byteLength - offset;
			if (remaining < 4) break;
			const view = new DataView(
				this.buffered.buffer,
				this.buffered.byteOffset + offset,
				remaining,
			);
			const frameLength = view.getUint32(0, false);
			if (frameLength < 4 || frameLength > SESSION_HOLDER_MAX_FRAME_BYTES)
				throw new HolderProtocolError('holder frame length is out of range');
			if (remaining < 4 + frameLength) break;
			const headerLength = view.getUint32(4, false);
			if (headerLength > frameLength - 4)
				throw new HolderProtocolError('holder frame header overruns its frame');
			if (headerLength > SESSION_HOLDER_MAX_HEADER_BYTES)
				throw new HolderProtocolError('holder frame header is too large');
			const payloadLength = frameLength - 4 - headerLength;
			if (payloadLength > SESSION_HOLDER_MAX_PAYLOAD_BYTES)
				throw new HolderProtocolError('holder frame payload is too large');
			const headerStart = offset + 8;
			const payloadStart = headerStart + headerLength;
			let message: unknown;
			try {
				message = JSON.parse(
					decoder.decode(this.buffered.subarray(headerStart, payloadStart)),
				);
			} catch {
				throw new HolderProtocolError('holder frame header is not valid JSON');
			}
			if (
				typeof message !== 'object' ||
				message === null ||
				Array.isArray(message) ||
				typeof (message as { type?: unknown }).type !== 'string'
			)
				throw new HolderProtocolError('holder frame header has no type');
			frames.push({
				message: message as HolderMessage,
				payload: this.buffered.slice(payloadStart, payloadStart + payloadLength),
			});
			offset = payloadStart + payloadLength;
		}
		this.buffered =
			offset === 0 ? this.buffered : this.buffered.slice(offset);
		return frames;
	}

	/** Bytes of an incomplete frame still waiting for more input. */
	get pendingBytes(): number {
		return this.buffered.byteLength;
	}
}

/** Highest version both sides speak, or `undefined` when there is none. */
export function selectHolderProtocolVersion(
	offered: readonly number[],
	supported: readonly number[] = SESSION_HOLDER_PROTOCOL_VERSIONS,
): number | undefined {
	let best: number | undefined;
	for (const version of offered) {
		if (!Number.isSafeInteger(version) || version < 1) continue;
		if (!supported.includes(version)) continue;
		if (best === undefined || version > best) best = version;
	}
	return best;
}
