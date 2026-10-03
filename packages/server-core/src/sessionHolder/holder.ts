import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
	chmodSync,
	mkdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import type {
	NodePtyDisposable,
	NodePtyModuleLike,
	NodePtyProcessLike,
} from '../terminalService/nodePty.js';
import {
	isHolderSessionId,
	sessionHolderDirectory,
	sessionHolderRecordPath,
	sessionHolderSocketPath,
	socketPathFits,
} from './paths.js';
import {
	encodeHolderFrame,
	type HolderClientMessage,
	type HolderExitRecord,
	HolderFrameDecoder,
	type HolderServerMessage,
	type HolderSessionRecord,
	type HolderSpawnRequest,
	SESSION_HOLDER_PROTOCOL_VERSIONS,
	selectHolderProtocolVersion,
} from './protocol.js';
import { deleteSessionTail, writeSessionTail } from './tails.js';

/**
 * The detached process that owns PTYs (ADR-0035).
 *
 * It does as little as possible, because a crash here ends every session it
 * holds: it shuttles bytes, keeps a bounded ring per session, and ends itself
 * when nothing will come back for it. It loads no extensions, parses no
 * terminal output, and holds no workspace state.
 */

export const DEFAULT_HOLDER_BUFFER_BYTES = 1024 * 1024;
/** How long a holder waits for its first server before giving up. */
export const HOLDER_FIRST_ATTACH_TIMEOUT_MS = 60_000;
const DEFAULT_KILL_GRACE_MS = 2_000;
const DATA_FRAME_BYTES = 64 * 1024;

export interface SessionHolderTimers {
	readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
	readonly clearTimeout: (timer: unknown) => void;
}

export interface SessionHolderOptions {
	readonly dataRoot: string;
	readonly generation: string;
	/** Identifies the build that started this holder; a server from another
	 * build drains it instead of spawning into it. */
	readonly buildId: string;
	readonly nodePty: NodePtyModuleLike;
	/** Unattached limit until a server sets one. `null` means no limit. */
	readonly limitMs: number | null;
	readonly maxBufferBytes?: number;
	/** Protocol versions this holder speaks. Defaults to every known version. */
	readonly versions?: readonly number[];
	readonly killGraceMs?: number;
	readonly firstAttachTimeoutMs?: number;
	readonly now?: () => number;
	readonly timers?: SessionHolderTimers;
	/** Called once the holder has released everything. Defaults to nothing, so
	 * an in-process holder under test does not end the test process. */
	readonly onClosed?: (reason: SessionHolderCloseReason) => void;
}

export type SessionHolderCloseReason =
	| 'empty'
	| 'limit'
	| 'end-all'
	| 'signal'
	| 'first-attach-timeout';

export interface SessionHolderRecordFile {
	readonly generation: string;
	readonly pid: number;
	readonly buildId: string;
	readonly versions: readonly number[];
	readonly credential: string;
	readonly socketPath: string;
	readonly startedAt: number;
}

interface RingChunk {
	readonly position: number;
	readonly bytes: Uint8Array;
}

interface HeldSession {
	readonly sessionId: string;
	readonly projectId: string | undefined;
	readonly shellPath: string;
	readonly cwd: string;
	readonly createdAt: number;
	readonly child: NodePtyProcessLike;
	readonly ring: RingChunk[];
	cols: number;
	rows: number;
	ringBytes: number;
	outputPosition: number;
	bufferedFrom: number;
	/** The attached server is receiving this session's output. */
	streaming: boolean;
	/** The attached server asked for backpressure. */
	serverPaused: boolean;
	exit: HolderExitRecord | undefined;
	dataSubscription: NodePtyDisposable | undefined;
	exitSubscription: NodePtyDisposable | undefined;
}

const defaultTimers: SessionHolderTimers = {
	setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
	clearTimeout: (timer) =>
		globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class SessionHolder {
	readonly generation: string;
	readonly buildId: string;
	readonly socketPath: string;
	readonly credential: string;

	private readonly dataRoot: string;
	private readonly nodePty: NodePtyModuleLike;
	private readonly maxBufferBytes: number;
	private readonly versions: readonly number[];
	private readonly killGraceMs: number;
	private readonly firstAttachTimeoutMs: number;
	private readonly now: () => number;
	private readonly timers: SessionHolderTimers;
	private readonly onClosed:
		| ((reason: SessionHolderCloseReason) => void)
		| undefined;
	private readonly sessions = new Map<string, HeldSession>();
	private readonly server: Server;
	private readonly pending = new Set<Socket>();
	private attached: Socket | undefined;
	private limitMs: number | null;
	private limitTimer: unknown;
	private draining = false;
	private flowPaused = false;
	private closing: Promise<void> | undefined;
	private exitWaiters: Array<() => void> = [];

	private constructor(options: SessionHolderOptions, server: Server) {
		this.dataRoot = options.dataRoot;
		this.generation = options.generation;
		this.buildId = options.buildId;
		this.nodePty = options.nodePty;
		this.limitMs = options.limitMs;
		this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_HOLDER_BUFFER_BYTES;
		this.versions = options.versions ?? SESSION_HOLDER_PROTOCOL_VERSIONS;
		this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
		this.firstAttachTimeoutMs =
			options.firstAttachTimeoutMs ?? HOLDER_FIRST_ATTACH_TIMEOUT_MS;
		this.now = options.now ?? (() => Date.now());
		this.timers = options.timers ?? defaultTimers;
		this.onClosed = options.onClosed;
		this.socketPath = sessionHolderSocketPath(
			options.dataRoot,
			options.generation,
		);
		this.credential = randomBytes(32).toString('hex');
		this.server = server;
	}

	static async start(options: SessionHolderOptions): Promise<SessionHolder> {
		if (!Number.isSafeInteger(options.maxBufferBytes ?? 1))
			throw new TypeError('maxBufferBytes must be a safe integer');
		const directory = sessionHolderDirectory(options.dataRoot);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		chmodSync(directory, 0o700);
		const server = createServer();
		const holder = new SessionHolder(options, server);
		if (!socketPathFits(holder.socketPath))
			throw new Error('session holder socket path is too long');
		rmSync(holder.socketPath, { force: true });
		server.on('connection', (socket) => holder.accept(socket));
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(holder.socketPath, () => {
				server.off('error', reject);
				resolve();
			});
		});
		chmodSync(holder.socketPath, 0o600);
		holder.writeRecord();
		// A holder nobody ever attaches to must not wait forever.
		holder.limitTimer = holder.timers.setTimeout(
			() => void holder.close('first-attach-timeout'),
			holder.firstAttachTimeoutMs,
		);
		return holder;
	}

	get sessionCount(): number {
		return this.sessions.size;
	}

	get isAttached(): boolean {
		return this.attached !== undefined;
	}

	get isDraining(): boolean {
		return this.draining;
	}

	/** Resolves once the holder has closed, for whatever reason. */
	closed(): Promise<void> {
		if (this.closing !== undefined) return this.closing;
		return new Promise((resolve) => this.exitWaiters.push(resolve));
	}

	/**
	 * Save tails, end every live session, and release the socket. `end-all`
	 * saves nothing: the server is removing those panels.
	 */
	close(reason: SessionHolderCloseReason): Promise<void> {
		if (this.closing !== undefined) return this.closing;
		this.closing = (async () => {
			this.clearLimitTimer();
			const at = this.now();
			if (reason !== 'end-all') this.saveTails(at);
			else
				for (const sessionId of this.sessions.keys())
					deleteSessionTail(this.dataRoot, sessionId);
			await this.endLiveSessions();
			for (const session of this.sessions.values()) this.release(session);
			this.sessions.clear();
			const attached = this.attached;
			if (attached !== undefined && !attached.destroyed)
				// Let an acknowledgement already written reach the server first.
				await new Promise<void>((resolve) => {
					attached.once('close', () => resolve());
					attached.end(() => attached.destroy());
				});
			for (const socket of this.pending) socket.destroy();
			this.attached = undefined;
			this.pending.clear();
			await new Promise<void>((resolve) => this.server.close(() => resolve()));
			rmSync(this.socketPath, { force: true });
			rmSync(sessionHolderRecordPath(this.dataRoot, this.generation), {
				force: true,
			});
			for (const resolve of this.exitWaiters.splice(0)) resolve();
			this.onClosed?.(reason);
		})();
		return this.closing;
	}

	private writeRecord(): void {
		const record: SessionHolderRecordFile = {
			generation: this.generation,
			pid: process.pid,
			buildId: this.buildId,
			versions: this.versions,
			credential: this.credential,
			socketPath: this.socketPath,
			startedAt: this.now(),
		};
		const target = sessionHolderRecordPath(this.dataRoot, this.generation);
		const temporary = `${target}.tmp`;
		writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
		chmodSync(temporary, 0o600);
		renameSync(temporary, target);
	}

	private accept(socket: Socket): void {
		if (this.closing !== undefined) {
			socket.destroy();
			return;
		}
		this.pending.add(socket);
		const frames = new HolderFrameDecoder();
		let greeted = false;
		socket.on('error', () => socket.destroy());
		socket.on('close', () => {
			this.pending.delete(socket);
			if (this.attached === socket) this.detached();
		});
		socket.on('drain', () => {
			if (this.attached === socket) this.releaseFlow();
		});
		socket.on('data', (chunk: Buffer) => {
			let decoded: ReturnType<HolderFrameDecoder['push']>;
			try {
				decoded = frames.push(chunk);
			} catch {
				socket.destroy();
				return;
			}
			for (const frame of decoded) {
				const message = frame.message as HolderClientMessage;
				if (!greeted) {
					if (message.type !== 'hello' || !this.greet(socket, message)) {
						socket.destroy();
						return;
					}
					greeted = true;
					continue;
				}
				if (this.attached !== socket) return;
				try {
					this.handle(message, frame.payload);
				} catch (error) {
					const id = (message as { id?: unknown }).id;
					if (typeof id === 'number')
						this.send({
							type: 'result',
							id,
							ok: false,
							error: error instanceof Error ? error.message : 'request failed',
						});
				}
			}
		});
	}

	private greet(
		socket: Socket,
		message: Extract<HolderClientMessage, { type: 'hello' }>,
	): boolean {
		const reply = (value: HolderServerMessage): void => {
			socket.write(encodeHolderFrame(value));
		};
		if (!credentialMatches(message.credential, this.credential)) return false;
		const version = Array.isArray(message.versions)
			? selectHolderProtocolVersion(message.versions, this.versions)
			: undefined;
		if (version === undefined) {
			reply({
				type: 'refuse',
				reason: 'version',
				versions: this.versions,
			});
			return false;
		}
		if (this.attached !== undefined) {
			reply({ type: 'refuse', reason: 'busy' });
			return false;
		}
		this.pending.delete(socket);
		this.attached = socket;
		this.clearLimitTimer();
		reply({
			type: 'welcome',
			version,
			generation: this.generation,
			buildId: this.buildId,
			pid: process.pid,
			draining: this.draining,
		});
		return true;
	}

	private handle(message: HolderClientMessage, payload: Uint8Array): void {
		switch (message.type) {
			case 'hello':
				throw new Error('already attached');
			case 'list':
				this.result(message.id, [...this.sessions.values()].map(recordOf));
				return;
			case 'spawn':
				this.result(message.id, this.spawn(message));
				return;
			case 'attach':
				this.attach(message.id, message.sessionId, message.from);
				return;
			case 'write':
				this.live(message.sessionId).child.write(decoder.decode(payload));
				return;
			case 'resize': {
				const session = this.live(message.sessionId);
				assertDimension(message.cols, 'cols');
				assertDimension(message.rows, 'rows');
				session.child.resize(message.cols, message.rows);
				session.cols = message.cols;
				session.rows = message.rows;
				return;
			}
			case 'signal':
				this.live(message.sessionId).child.kill(message.signal);
				return;
			case 'end':
				this.end(message.sessionId);
				this.result(message.id, null);
				return;
			case 'endAll':
				this.result(message.id, null);
				void this.close('end-all');
				return;
			case 'pause': {
				const session = this.live(message.sessionId);
				session.serverPaused = true;
				session.child.pause?.();
				return;
			}
			case 'resume': {
				const session = this.live(message.sessionId);
				session.serverPaused = false;
				if (!this.flowPaused) session.child.resume?.();
				return;
			}
			case 'foreground': {
				const session = this.live(message.sessionId);
				let title: string | null = null;
				try {
					const value = session.child.process;
					if (typeof value === 'string' && value.trim().length > 0)
						title = value.trim();
				} catch {
					title = null;
				}
				this.result(message.id, title);
				return;
			}
			case 'setLimit':
				if (
					message.limitMs !== null &&
					(!Number.isSafeInteger(message.limitMs) || message.limitMs < 0)
				)
					throw new Error('limit is invalid');
				this.limitMs = message.limitMs;
				return;
			case 'drain':
				this.draining = true;
				if (this.liveCount() === 0) void this.close('empty');
				return;
			default:
				throw new Error('unknown request');
		}
	}

	private spawn(request: HolderSpawnRequest): HolderSessionRecord {
		if (this.draining) throw new Error('session holder is draining');
		if (!isHolderSessionId(request.sessionId))
			throw new Error('session id is invalid');
		if (this.sessions.has(request.sessionId))
			throw new Error('session already exists');
		assertDimension(request.cols, 'cols');
		assertDimension(request.rows, 'rows');
		const child = this.nodePty.spawn(request.shellPath, [...request.args], {
			...(request.name === undefined ? {} : { name: request.name }),
			cols: request.cols,
			rows: request.rows,
			cwd: request.cwd,
			...(request.env === undefined ? {} : { env: request.env }),
		});
		const session: HeldSession = {
			sessionId: request.sessionId,
			projectId: request.projectId,
			shellPath: request.shellPath,
			cwd: request.cwd,
			createdAt: this.now(),
			child,
			ring: [],
			cols: request.cols,
			rows: request.rows,
			ringBytes: 0,
			outputPosition: 0,
			bufferedFrom: 0,
			streaming: true,
			serverPaused: false,
			exit: undefined,
			dataSubscription: undefined,
			exitSubscription: undefined,
		};
		this.sessions.set(session.sessionId, session);
		// A session replaces whatever an earlier one of the same id left behind.
		deleteSessionTail(this.dataRoot, session.sessionId);
		session.dataSubscription = child.onData((data) =>
			this.output(session, encoder.encode(data)),
		);
		session.exitSubscription = child.onExit((event) =>
			this.exited(session, {
				exitCode: event.exitCode,
				signal: event.signal ?? null,
				at: this.now(),
			}),
		);
		return recordOf(session);
	}

	private attach(id: number, sessionId: string, from: number): void {
		const session = this.sessions.get(sessionId);
		if (session === undefined) throw new Error('session not found');
		if (!Number.isSafeInteger(from) || from < 0)
			throw new Error('position is invalid');
		if (from > session.outputPosition)
			throw new Error('position is ahead of output');
		const start = Math.max(from, session.bufferedFrom);
		this.result(id, { ...recordOf(session), from: start });
		for (const chunk of session.ring) {
			const end = chunk.position + chunk.bytes.byteLength;
			if (end <= start) continue;
			const skip = Math.max(0, start - chunk.position);
			this.sendData(session, chunk.position + skip, chunk.bytes.subarray(skip));
		}
		session.streaming = true;
		if (session.exit !== undefined) this.sendExit(session, session.exit);
	}

	private end(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		deleteSessionTail(this.dataRoot, sessionId);
		if (session === undefined) return;
		this.sessions.delete(sessionId);
		if (session.exit === undefined) {
			this.terminate(session);
			return;
		}
		this.release(session);
		this.exitIfIdle();
	}

	/** SIGHUP, then SIGKILL if the process outlives the grace period. */
	private terminate(session: HeldSession): void {
		try {
			session.child.kill('SIGHUP');
		} catch {
			/* already gone */
		}
		const timer = this.timers.setTimeout(() => {
			if (session.exit !== undefined) return;
			try {
				session.child.kill('SIGKILL');
			} catch {
				/* already gone */
			}
		}, this.killGraceMs);
		const previous = session.exitSubscription;
		session.exitSubscription = undefined;
		previous?.dispose();
		session.exitSubscription = session.child.onExit(() => {
			session.exit = { exitCode: null, signal: null, at: this.now() };
			this.timers.clearTimeout(timer);
			this.release(session);
			this.exitIfIdle();
		});
	}

	private output(session: HeldSession, bytes: Uint8Array): void {
		if (bytes.byteLength === 0) return;
		for (let offset = 0; offset < bytes.byteLength; offset += DATA_FRAME_BYTES) {
			const part = bytes.slice(
				offset,
				Math.min(bytes.byteLength, offset + DATA_FRAME_BYTES),
			);
			const position = session.outputPosition;
			session.ring.push({ position, bytes: part });
			session.ringBytes += part.byteLength;
			session.outputPosition = position + part.byteLength;
			while (
				session.ringBytes > this.maxBufferBytes &&
				session.ring.length > 1
			) {
				const dropped = session.ring.shift();
				if (dropped !== undefined) session.ringBytes -= dropped.bytes.byteLength;
			}
			session.bufferedFrom =
				session.ring[0]?.position ?? session.outputPosition;
			if (session.streaming && this.attached !== undefined)
				this.sendData(session, position, part);
		}
	}

	private exited(session: HeldSession, exit: HolderExitRecord): void {
		if (session.exit !== undefined) return;
		session.exit = exit;
		this.release(session);
		if (session.streaming && this.attached !== undefined) {
			this.sendExit(session, exit);
		} else {
			// Nobody is watching, so this is the only record of how it ended.
			this.saveTail(session, exit.at);
		}
		this.exitIfIdle();
	}

	/** The server went away: stop streaming, never leave a shell blocked on a
	 * paused PTY, and start the unattached limit. */
	private detached(): void {
		this.attached = undefined;
		this.flowPaused = false;
		for (const session of this.sessions.values()) {
			session.streaming = false;
			session.serverPaused = false;
			if (session.exit === undefined) {
				try {
					session.child.resume?.();
				} catch {
					/* exit wins */
				}
			}
		}
		if (this.closing !== undefined) return;
		if (this.liveCount() === 0) {
			void this.close('empty');
			return;
		}
		this.clearLimitTimer();
		if (this.limitMs !== null)
			this.limitTimer = this.timers.setTimeout(
				() => void this.close('limit'),
				this.limitMs,
			);
	}

	private exitIfIdle(): void {
		if (this.closing !== undefined || this.liveCount() !== 0) return;
		if (this.attached === undefined || this.draining) void this.close('empty');
	}

	private liveCount(): number {
		let count = 0;
		for (const session of this.sessions.values())
			if (session.exit === undefined) count += 1;
		return count;
	}

	private live(sessionId: string): HeldSession {
		const session = this.sessions.get(sessionId);
		if (session === undefined) throw new Error('session not found');
		if (session.exit !== undefined) throw new Error('session has ended');
		return session;
	}

	private async endLiveSessions(): Promise<void> {
		const live = [...this.sessions.values()].filter(
			(session) => session.exit === undefined,
		);
		if (live.length === 0) return;
		await Promise.all(
			live.map(
				(session) =>
					new Promise<void>((resolve) => {
						let settled = false;
						const settle = (): void => {
							if (settled) return;
							settled = true;
							this.timers.clearTimeout(timer);
							resolve();
						};
						const timer = this.timers.setTimeout(() => {
							try {
								session.child.kill('SIGKILL');
							} catch {
								/* already gone */
							}
							settle();
						}, this.killGraceMs);
						session.exitSubscription?.dispose();
						session.exitSubscription = session.child.onExit(settle);
						try {
							session.child.kill('SIGHUP');
						} catch {
							settle();
						}
					}),
			),
		);
	}

	private saveTails(at: number): void {
		for (const session of this.sessions.values()) this.saveTail(session, at);
	}

	private saveTail(session: HeldSession, at: number): void {
		const bytes = new Uint8Array(session.ringBytes);
		let offset = 0;
		for (const chunk of session.ring) {
			bytes.set(chunk.bytes, offset);
			offset += chunk.bytes.byteLength;
		}
		try {
			writeSessionTail(this.dataRoot, {
				sessionId: session.sessionId,
				bufferedFrom: session.bufferedFrom,
				outputPosition: session.outputPosition,
				...(session.exit === undefined ? {} : { exit: session.exit }),
				savedAt: at,
				cols: session.cols,
				rows: session.rows,
				cwd: session.cwd,
				bytes,
			});
		} catch {
			// A tail is best effort; failing to save one cannot keep a holder alive.
		}
	}

	private release(session: HeldSession): void {
		session.dataSubscription?.dispose();
		session.exitSubscription?.dispose();
		session.dataSubscription = undefined;
		session.exitSubscription = undefined;
	}

	private clearLimitTimer(): void {
		if (this.limitTimer === undefined) return;
		this.timers.clearTimeout(this.limitTimer);
		this.limitTimer = undefined;
	}

	private result(id: number, value: unknown): void {
		this.send({ type: 'result', id, ok: true, value });
	}

	private sendData(
		session: HeldSession,
		position: number,
		bytes: Uint8Array,
	): void {
		this.send(
			{ type: 'data', sessionId: session.sessionId, position },
			bytes,
		);
	}

	private sendExit(session: HeldSession, exit: HolderExitRecord): void {
		this.send({
			type: 'exit',
			sessionId: session.sessionId,
			outputPosition: session.outputPosition,
			...exit,
		});
	}

	private send(message: HolderServerMessage, payload?: Uint8Array): void {
		const socket = this.attached;
		if (socket === undefined || socket.destroyed) return;
		const flushed = socket.write(encodeHolderFrame(message, payload));
		if (!flushed && !this.flowPaused) {
			// A stalled server must not grow this process without bound.
			this.flowPaused = true;
			for (const session of this.sessions.values())
				if (session.exit === undefined) session.child.pause?.();
		}
	}

	private releaseFlow(): void {
		if (!this.flowPaused) return;
		this.flowPaused = false;
		for (const session of this.sessions.values())
			if (session.exit === undefined && !session.serverPaused)
				session.child.resume?.();
	}
}

function recordOf(session: HeldSession): HolderSessionRecord {
	return {
		sessionId: session.sessionId,
		...(session.projectId === undefined
			? {}
			: { projectId: session.projectId }),
		...(typeof session.child.pid === 'number' ? { pid: session.child.pid } : {}),
		shellPath: session.shellPath,
		cwd: session.cwd,
		cols: session.cols,
		rows: session.rows,
		createdAt: session.createdAt,
		outputPosition: session.outputPosition,
		bufferedFrom: session.bufferedFrom,
		...(session.exit === undefined ? {} : { exit: session.exit }),
	};
}

function credentialMatches(offered: unknown, expected: string): boolean {
	if (typeof offered !== 'string') return false;
	const left = Buffer.from(offered, 'utf8');
	const right = Buffer.from(expected, 'utf8');
	return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function assertDimension(value: unknown, name: string): void {
	if (
		typeof value !== 'number' ||
		!Number.isSafeInteger(value) ||
		value < 1 ||
		value > 10_000
	)
		throw new Error(`${name} is invalid`);
}
