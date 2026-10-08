import { connect, type Socket } from 'node:net';
import type { SessionHolderRecordFile } from './holder.js';
import {
	encodeHolderFrame,
	type HolderClientMessage,
	type HolderCloseNotice,
	type HolderExitRecord,
	HolderFrameDecoder,
	type HolderServerMessage,
	type HolderSessionRecord,
	type HolderSpawnRequest,
	parseHolderCloseNotice,
	SESSION_HOLDER_MAX_PAYLOAD_BYTES,
	SESSION_HOLDER_PROTOCOL_VERSIONS,
} from './protocol.js';

/** A holder turned this server away. `version` carries what it does speak. */
export class SessionHolderRefusedError extends Error {
	readonly reason: 'credential' | 'version' | 'busy' | 'closed';
	readonly versions: readonly number[] | undefined;
	constructor(
		reason: SessionHolderRefusedError['reason'],
		versions?: readonly number[],
	) {
		super(`session holder refused the connection: ${reason}`);
		this.name = 'SessionHolderRefusedError';
		this.reason = reason;
		this.versions = versions;
	}
}

export interface HolderSessionStream {
	readonly onData: (
		listener: (position: number, bytes: Uint8Array) => void,
	) => () => void;
	readonly onExit: (
		listener: (exit: HolderExitRecord) => void,
	) => () => void;
	/** Stop receiving this session's events. The session keeps running. */
	readonly release: () => void;
}

interface StreamState {
	readonly dataListeners: Set<(position: number, bytes: Uint8Array) => void>;
	readonly exitListeners: Set<(exit: HolderExitRecord) => void>;
	readonly pendingData: Array<{ position: number; bytes: Uint8Array }>;
	pendingExit: HolderExitRecord | undefined;
	/** One past the last output position received for this session. */
	received: number;
	/** Waiting for retained output to arrive up to a position. */
	caughtUp: { readonly position: number; readonly resolve: () => void } | undefined;
}

interface PendingRequest {
	readonly resolve: (value: unknown) => void;
	readonly reject: (reason: Error) => void;
}

type RequestMessage = Extract<HolderClientMessage, { id: number }>;
type RequestBody<T extends RequestMessage['type']> = Omit<
	Extract<RequestMessage, { type: T }>,
	'id'
>;

export interface SessionHolderConnectOptions {
	readonly versions?: readonly number[];
	readonly timeoutMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

/** The server's connection to one session holder generation. */
export class SessionHolderClient {
	readonly generation: string;
	readonly buildId: string;
	readonly pid: number;
	readonly version: number;

	private readonly socket: Socket;
	private readonly requests = new Map<number, PendingRequest>();
	private readonly streams = new Map<string, StreamState>();
	private readonly closeListeners = new Set<() => void>();
	private readonly closingListeners = new Set<
		(notice: HolderCloseNotice) => void
	>();
	private closeNoticeValue: HolderCloseNotice | undefined;
	private nextRequestId = 1;
	private drainingValue: boolean;
	private closedValue = false;

	private constructor(
		socket: Socket,
		welcome: Extract<HolderServerMessage, { type: 'welcome' }>,
	) {
		this.socket = socket;
		this.generation = welcome.generation;
		this.buildId = welcome.buildId;
		this.pid = welcome.pid;
		this.version = welcome.version;
		this.drainingValue = welcome.draining;
	}

	static connect(
		record: Pick<SessionHolderRecordFile, 'socketPath' | 'credential'>,
		options: SessionHolderConnectOptions = {},
	): Promise<SessionHolderClient> {
		return new Promise((resolve, reject) => {
			const socket = connect(record.socketPath);
			const frames = new HolderFrameDecoder();
			let client: SessionHolderClient | undefined;
			let settled = false;
			const fail = (error: Error): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				socket.destroy();
				reject(error);
			};
			const timer = setTimeout(
				() => fail(new SessionHolderRefusedError('closed')),
				options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
			);
			socket.once('connect', () => {
				socket.write(
					encodeHolderFrame({
						type: 'hello',
						credential: record.credential,
						versions: options.versions ?? SESSION_HOLDER_PROTOCOL_VERSIONS,
					}),
				);
			});
			socket.on('error', () => {
				if (client === undefined) fail(new SessionHolderRefusedError('closed'));
			});
			socket.on('close', () => {
				if (client === undefined) {
					// A holder that does not know the credential just hangs up.
					fail(new SessionHolderRefusedError('credential'));
					return;
				}
				client.connectionClosed();
			});
			socket.on('data', (chunk: Buffer) => {
				let decoded: ReturnType<HolderFrameDecoder['push']>;
				try {
					decoded = frames.push(chunk);
				} catch {
					if (client === undefined)
						fail(new SessionHolderRefusedError('closed'));
					else socket.destroy();
					return;
				}
				for (const frame of decoded) {
					const message = frame.message as HolderServerMessage;
					if (client !== undefined) {
						client.receive(message, frame.payload);
						continue;
					}
					if (message.type === 'refuse') {
						fail(new SessionHolderRefusedError(message.reason, message.versions));
						return;
					}
					if (message.type !== 'welcome') {
						fail(new SessionHolderRefusedError('closed'));
						return;
					}
					settled = true;
					clearTimeout(timer);
					client = new SessionHolderClient(socket, message);
					resolve(client);
				}
			});
		});
	}

	get draining(): boolean {
		return this.drainingValue;
	}

	get closed(): boolean {
		return this.closedValue;
	}

	onClose(listener: () => void): () => void {
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}

	/** What the holder said about closing, once it has said it. */
	get closeNotice(): HolderCloseNotice | undefined {
		return this.closeNoticeValue;
	}

	/** Hear the holder say it is closing, before the connection goes. */
	onClosing(listener: (notice: HolderCloseNotice) => void): () => void {
		this.closingListeners.add(listener);
		return () => this.closingListeners.delete(listener);
	}

	list(): Promise<readonly HolderSessionRecord[]> {
		return this.request('list', { type: 'list' }) as Promise<
			readonly HolderSessionRecord[]
		>;
	}

	/** The stream is registered before the request is sent, so no output of a
	 * fresh shell can arrive ahead of its listener. */
	async spawn(request: HolderSpawnRequest): Promise<{
		readonly record: HolderSessionRecord;
		readonly stream: HolderSessionStream;
	}> {
		const stream = this.openStream(request.sessionId);
		try {
			const record = (await this.request('spawn', {
				type: 'spawn',
				...request,
			})) as HolderSessionRecord;
			return { record, stream };
		} catch (error) {
			stream.release();
			throw error;
		}
	}

	/** Receive a session's retained output from `from`, then its live output. */
	async attach(
		sessionId: string,
		from: number,
	): Promise<{
		readonly record: HolderSessionRecord;
		/** First position that will be delivered. */
		readonly from: number;
		readonly stream: HolderSessionStream;
	}> {
		const stream = this.openStream(sessionId);
		try {
			const value = (await this.request('attach', {
				type: 'attach',
				sessionId,
				from,
			})) as HolderSessionRecord & { from: number };
			const { from: start, ...record } = value;
			// The holder sends the retained output straight after its answer. It
			// is held here until a listener attaches, so by the time this resolves
			// a caller that subscribes synchronously sees every retained byte
			// before anything else can ask for a position.
			await this.retainedOutputReceived(sessionId, start, record.outputPosition);
			return { record, from: start, stream };
		} catch (error) {
			stream.release();
			throw error;
		}
	}

	write(sessionId: string, bytes: Uint8Array): void {
		for (
			let offset = 0;
			offset < bytes.byteLength;
			offset += SESSION_HOLDER_MAX_PAYLOAD_BYTES
		)
			this.send(
				{ type: 'write', sessionId },
				bytes.subarray(offset, offset + SESSION_HOLDER_MAX_PAYLOAD_BYTES),
			);
	}

	resize(sessionId: string, cols: number, rows: number): void {
		this.send({ type: 'resize', sessionId, cols, rows });
	}

	signal(sessionId: string, signal?: number | string): void {
		this.send({
			type: 'signal',
			sessionId,
			...(signal === undefined ? {} : { signal }),
		});
	}

	/** End a session's process and forget it, including any saved tail. */
	async end(sessionId: string): Promise<void> {
		await this.request('end', { type: 'end', sessionId });
	}

	/** End every session; the holder exits. */
	async endAll(): Promise<void> {
		await this.request('endAll', { type: 'endAll' });
	}

	pause(sessionId: string): void {
		this.send({ type: 'pause', sessionId });
	}

	resume(sessionId: string): void {
		this.send({ type: 'resume', sessionId });
	}

	foreground(sessionId: string): Promise<string | null> {
		return this.request('foreground', {
			type: 'foreground',
			sessionId,
		}) as Promise<string | null>;
	}

	setLimit(limitMs: number | null): void {
		this.send({ type: 'setLimit', limitMs });
	}

	/** Stop this holder taking new sessions; it exits after its last one. */
	drain(): void {
		this.drainingValue = true;
		this.send({ type: 'drain' });
	}

	/** Disconnect. The holder's sessions keep running. */
	close(): Promise<void> {
		if (this.closedValue) return Promise.resolve();
		return new Promise((resolve) => {
			this.socket.once('close', () => resolve());
			this.socket.end();
		});
	}

	private openStream(sessionId: string): HolderSessionStream {
		const state: StreamState = {
			dataListeners: new Set(),
			exitListeners: new Set(),
			pendingData: [],
			pendingExit: undefined,
			received: 0,
			caughtUp: undefined,
		};
		this.streams.set(sessionId, state);
		return {
			onData: (listener) => {
				state.dataListeners.add(listener);
				for (const entry of state.pendingData.splice(0))
					listener(entry.position, entry.bytes);
				return () => state.dataListeners.delete(listener);
			},
			onExit: (listener) => {
				state.exitListeners.add(listener);
				if (state.pendingExit !== undefined) {
					const exit = state.pendingExit;
					state.pendingExit = undefined;
					listener(exit);
				}
				return () => state.exitListeners.delete(listener);
			},
			release: () => {
				if (this.streams.get(sessionId) === state)
					this.streams.delete(sessionId);
				state.dataListeners.clear();
				state.exitListeners.clear();
				state.pendingData.length = 0;
			},
		};
	}

	private retainedOutputReceived(
		sessionId: string,
		from: number,
		position: number,
	): Promise<void> {
		const state = this.streams.get(sessionId);
		if (state === undefined || position <= from || state.received >= position)
			return Promise.resolve();
		return new Promise((resolve, reject) => {
			const release = this.onClose(() => {
				state.caughtUp = undefined;
				reject(new Error('session holder connection closed'));
			});
			state.caughtUp = {
				position,
				resolve: () => {
					release();
					resolve();
				},
			};
		});
	}

	private request<T extends RequestMessage['type']>(
		_type: T,
		body: RequestBody<T>,
	): Promise<unknown> {
		if (this.closedValue)
			return Promise.reject(new Error('session holder connection is closed'));
		const id = this.nextRequestId;
		this.nextRequestId += 1;
		return new Promise((resolve, reject) => {
			this.requests.set(id, { resolve, reject });
			this.send({ ...body, id } as unknown as HolderClientMessage);
		});
	}

	private send(message: HolderClientMessage, payload?: Uint8Array): void {
		if (this.closedValue || this.socket.destroyed) return;
		this.socket.write(encodeHolderFrame(message, payload));
	}

	private receive(message: HolderServerMessage, payload: Uint8Array): void {
		switch (message.type) {
			case 'result': {
				const pending = this.requests.get(message.id);
				if (pending === undefined) return;
				this.requests.delete(message.id);
				if (message.ok) pending.resolve(message.value);
				else pending.reject(new Error(message.error ?? 'request failed'));
				return;
			}
			case 'data': {
				const state = this.streams.get(message.sessionId);
				if (state === undefined) return;
				state.received = message.position + payload.byteLength;
				if (state.dataListeners.size === 0)
					state.pendingData.push({ position: message.position, bytes: payload });
				else
					for (const listener of [...state.dataListeners])
						listener(message.position, payload);
				if (
					state.caughtUp !== undefined &&
					state.received >= state.caughtUp.position
				) {
					const waiter = state.caughtUp;
					state.caughtUp = undefined;
					waiter.resolve();
				}
				return;
			}
			case 'exit': {
				const state = this.streams.get(message.sessionId);
				if (state === undefined) return;
				const exit: HolderExitRecord = {
					exitCode: message.exitCode,
					signal: message.signal,
					at: message.at,
				};
				if (state.exitListeners.size === 0) {
					state.pendingExit = exit;
					return;
				}
				for (const listener of [...state.exitListeners]) listener(exit);
				return;
			}
			case 'closing': {
				const notice = parseHolderCloseNotice(message);
				if (notice === undefined || this.closeNoticeValue !== undefined) return;
				this.closeNoticeValue = notice;
				for (const listener of [...this.closingListeners]) {
					try {
						listener(notice);
					} catch {
						/* an observer cannot disturb the connection */
					}
				}
				return;
			}
			default:
				return;
		}
	}

	private connectionClosed(): void {
		if (this.closedValue) return;
		this.closedValue = true;
		const error = new Error('session holder connection closed');
		for (const pending of this.requests.values()) pending.reject(error);
		this.requests.clear();
		for (const listener of [...this.closeListeners]) {
			try {
				listener();
			} catch {
				/* an observer cannot keep a dead connection open */
			}
		}
	}
}
