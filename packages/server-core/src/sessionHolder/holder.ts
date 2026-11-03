import { TerminalPresentationCheckpointAuthority } from '../terminalService/presentationCheckpoint.js';
import { encodePresentationRecovery } from '../terminalService/presentationRecovery.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { writeFileDurablySync } from '../durableFile.js';
import { BoundedChunkQueue } from '../terminalService/boundedChunkQueue.js';
import type {
	NodePtyDisposable,
	NodePtyModuleLike,
	NodePtyProcessLike,
} from '../terminalService/nodePty.js';
import { writeHolderCloseRecord } from './closeRecord.js';
import {
	isHolderSessionId,
	sessionHolderDirectory,
	type SessionHolderAddressing,
	sessionHolderAddress,
	sessionHolderAddressFits,
	sessionHolderRecordPath,
} from './paths.js';
import {
	encodeHolderFrame,
	type HolderClientMessage,
	type HolderCloseNotice,
	type HolderCloseReason,
	type HolderExitRecord,
	HolderFrameDecoder,
	type HolderServerMessage,
	type HolderSessionRecord,
	type HolderSpawnRequest,
	holderHandshakeProof,
	holderProofMatches,
	isHolderNonce,
	SESSION_HOLDER_MUTUAL_PROOF_VERSION,
	SESSION_HOLDER_NONCE_BYTES,
	SESSION_HOLDER_PROTOCOL_VERSIONS,
	selectHolderProtocolVersion,
} from './protocol.js';

/** A `challenge` this holder has answered, awaiting the server's proof. */
interface HolderChallenge {
	readonly version: number;
	readonly holderNonce: string;
	readonly serverNonce: string;
}
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
	/**
	 * Refuse a version-1 `hello`, which presents the credential, and accept
	 * only the mutual proof. On wherever the holder's address could be taken by
	 * another user first, which is Windows (ADR-0086 §3).
	 */
	readonly requireMutualProof?: boolean;
	/**
	 * Where the holder runs. Defaults to this process's platform; on Windows it
	 * carries the user's SID, which names the pipe.
	 */
	readonly addressing?: SessionHolderAddressing;
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

export interface SessionHolderCloseDetail {
	/** The signal that asked for a `signal` close. */
	readonly signal?: string;
}

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
	presentationError?: string;
	presentationQueue: Promise<void>;
	presentationBytes: number;
	presentationPaused: boolean;
	recovering: boolean;
	recoveryFinished?: Promise<void>;
	readonly sessionId: string;
	readonly projectId: string | undefined;
	readonly shellPath: string;
	readonly cwd: string;
	readonly createdAt: number;
	readonly child: NodePtyProcessLike;
	readonly ring: BoundedChunkQueue<RingChunk>;
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

export class SessionHolder {
	readonly generation: string;
	readonly buildId: string;
	readonly socketPath: string;
	readonly credential: string;

	private readonly dataRoot: string;
	private readonly addressing: SessionHolderAddressing;
	private readonly nodePty: NodePtyModuleLike;
	private readonly maxBufferBytes: number;
	private readonly versions: readonly number[];
	private readonly requireMutualProof: boolean;
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
	private attachedVersion = 1;
	private readonly presentations =
		new TerminalPresentationCheckpointAuthority();
	private limitMs: number | null;
	private limitTimer: unknown;
	private readonly startedAt: number;
	private attachCount = 0;
	private lastAttachAt: number | null = null;
	private lastDetachAt: number | null = null;
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
		this.requireMutualProof = options.requireMutualProof ?? false;
		this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
		this.firstAttachTimeoutMs =
			options.firstAttachTimeoutMs ?? HOLDER_FIRST_ATTACH_TIMEOUT_MS;
		this.now = options.now ?? (() => Date.now());
		this.timers = options.timers ?? defaultTimers;
		this.startedAt = this.now();
		this.onClosed = options.onClosed;
		this.addressing = options.addressing ?? { platform: process.platform };
		this.socketPath = sessionHolderAddress({
			...this.addressing,
			dataRoot: options.dataRoot,
			generation: options.generation,
		});
		this.credential = randomBytes(32).toString('hex');
		this.server = server;
	}

	static async start(options: SessionHolderOptions): Promise<SessionHolder> {
		if (
			!Number.isSafeInteger(options.maxBufferBytes ?? 1) ||
			(options.maxBufferBytes ?? 1) <= 0
		)
			throw new TypeError('maxBufferBytes must be a positive safe integer');
		const directory = sessionHolderDirectory(options.dataRoot);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		chmodSync(directory, 0o700);
		const server = createServer();
		const holder = new SessionHolder(options, server);
		// On Windows the launching server has already closed the directory to
		// other users; modes mean nothing there.
		const windows = holder.addressing.platform === 'win32';
		if (
			!sessionHolderAddressFits(
				options.dataRoot,
				options.generation,
				holder.addressing,
			)
		)
			throw new Error('session holder socket path is too long');
		if (!windows) rmSync(holder.socketPath, { force: true });
		server.on('connection', (socket) => holder.accept(socket));
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(holder.socketPath, () => {
				server.off('error', reject);
				resolve();
			});
		});
		if (!windows) chmodSync(holder.socketPath, 0o600);
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
	close(
		reason: SessionHolderCloseReason,
		detail: SessionHolderCloseDetail = {},
	): Promise<void> {
		if (this.closing !== undefined) return this.closing;
		// Taken before anything is ended: it describes what the close found.
		const at = this.now();
		const notice = this.closeNotice(reason, at, detail);
		this.closing = (async () => {
			this.clearLimitTimer();
			this.announceClose(notice);
			if (reason !== 'end-all') this.saveTails(at);
			else
				for (const sessionId of this.sessions.keys())
					deleteSessionTail(this.dataRoot, sessionId);
			await this.endLiveSessions();
			for (const session of this.sessions.values()) this.release(session);
			this.sessions.clear();
			this.presentations.close();
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
			// A pipe goes when its server closes; a socket file stays behind.
			if (this.addressing.platform !== 'win32')
				rmSync(this.socketPath, { force: true });
			rmSync(sessionHolderRecordPath(this.dataRoot, this.generation), {
				force: true,
			});
			for (const resolve of this.exitWaiters.splice(0)) resolve();
			this.onClosed?.(reason);
		})();
		return this.closing;
	}

	/**
	 * Leave word that an uncaught error is about to end this process. Nothing is
	 * closed or caught here: the holder dies exactly as it would have.
	 */
	recordCrash(error: unknown): void {
		const text =
			error instanceof Error ? (error.stack ?? error.message) : String(error);
		this.writeCloseRecord({
			...this.closeNotice('crash', this.now()),
			error: text,
		});
	}

	private closeNotice(
		reason: HolderCloseReason,
		at: number,
		detail: SessionHolderCloseDetail = {},
	): HolderCloseNotice {
		const liveSessions = this.liveCount();
		return {
			reason,
			...(detail.signal === undefined ? {} : { signal: detail.signal }),
			pid: process.pid,
			startedAt: this.startedAt,
			closedAt: at,
			liveSessions,
			endedSessions: this.sessions.size - liveSessions,
			attached: this.attached !== undefined,
			draining: this.draining,
			limitMs: this.limitMs,
			attachCount: this.attachCount,
			lastAttachAt: this.lastAttachAt,
			lastDetachAt: this.lastDetachAt,
		};
	}

	/**
	 * Say why this holder is closing, before its sessions are ended. The record
	 * is for the case nobody is attached to hear the notice. `end-all` leaves
	 * none: the server asked for it and is removing everything the holder kept.
	 */
	private announceClose(notice: HolderCloseNotice): void {
		if (notice.reason !== 'end-all') this.writeCloseRecord(notice);
		this.send({ type: 'closing', ...notice });
	}

	private writeCloseRecord(notice: HolderCloseNotice): void {
		try {
			writeHolderCloseRecord(this.dataRoot, this.generation, notice);
		} catch {
			// Best effort, like a tail: failing to explain a close cannot stop it.
		}
	}

	private writeRecord(): void {
		const record: SessionHolderRecordFile = {
			generation: this.generation,
			pid: process.pid,
			buildId: this.buildId,
			versions: this.versions,
			credential: this.credential,
			socketPath: this.socketPath,
			startedAt: this.startedAt,
		};
		writeFileDurablySync(
			sessionHolderRecordPath(this.dataRoot, this.generation),
			JSON.stringify(record),
			{ mode: 0o600 },
		);
	}

	private accept(socket: Socket): void {
		if (this.closing !== undefined) {
			socket.destroy();
			return;
		}
		this.pending.add(socket);
		const frames = new HolderFrameDecoder();
		let greeted = false;
		let challenge: HolderChallenge | undefined;
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
					if (challenge !== undefined) {
						// The only frame after our proof is the server's.
						if (
							message.type !== 'prove' ||
							!holderProofMatches(
								message.proof,
								holderHandshakeProof(
									this.credential,
									'server',
									challenge.serverNonce,
									challenge.holderNonce,
								),
							) ||
							!this.admit(socket, challenge.version)
						) {
							socket.destroy();
							return;
						}
						greeted = true;
						continue;
					}
					if (message.type === 'challenge') {
						challenge = this.answerChallenge(socket, message);
						if (challenge === undefined) {
							socket.destroy();
							return;
						}
						continue;
					}
					if (
						message.type !== 'hello' ||
						this.requireMutualProof ||
						!this.greet(socket, message)
					) {
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
		// A `hello` presents the credential, so it never negotiates a version
		// whose handshake is the mutual proof.
		const version = Array.isArray(message.versions)
			? selectHolderProtocolVersion(
					message.versions,
					this.versions.filter(
						(supported) => supported < SESSION_HOLDER_MUTUAL_PROOF_VERSION,
					),
				)
			: undefined;
		if (version === undefined) {
			reply({
				type: 'refuse',
				reason: 'version',
				versions: this.versions,
			});
			return false;
		}
		return this.admit(socket, version);
	}

	/**
	 * Answer a `challenge` with this holder's proof. Nothing about a session is
	 * said until the server has proved itself in return.
	 */
	private answerChallenge(
		socket: Socket,
		message: Extract<HolderClientMessage, { type: 'challenge' }>,
	): HolderChallenge | undefined {
		if (!isHolderNonce(message.nonce)) return undefined;
		const version = Array.isArray(message.versions)
			? selectHolderProtocolVersion(
					message.versions,
					this.versions.filter(
						(supported) => supported >= SESSION_HOLDER_MUTUAL_PROOF_VERSION,
					),
				)
			: undefined;
		if (version === undefined) {
			socket.write(
				encodeHolderFrame({
					type: 'refuse',
					reason: 'version',
					versions: this.versions,
				}),
			);
			return undefined;
		}
		const holderNonce = randomBytes(SESSION_HOLDER_NONCE_BYTES).toString('hex');
		socket.write(
			encodeHolderFrame({
				type: 'proof',
				version,
				nonce: holderNonce,
				proof: holderHandshakeProof(
					this.credential,
					'holder',
					holderNonce,
					message.nonce,
				),
			}),
		);
		return { version, holderNonce, serverNonce: message.nonce };
	}

	/** Attach a server that has authenticated, or refuse it as busy. */
	private admit(socket: Socket, version: number): boolean {
		const reply = (value: HolderServerMessage): void => {
			socket.write(encodeHolderFrame(value));
		};
		if (this.attached !== undefined) {
			reply({ type: 'refuse', reason: 'busy' });
			return false;
		}
		this.pending.delete(socket);
		this.attached = socket;
		this.attachedVersion = version;
		this.attachCount += 1;
		this.lastAttachAt = this.now();
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
			case 'challenge':
			case 'prove':
				throw new Error('already attached');
			case 'list':
				this.result(message.id, [...this.sessions.values()].map(recordOf));
				return;
			case 'spawn':
				this.result(message.id, this.spawn(message));
				return;
			case 'attach':
				if (this.attachedVersion >= 3) {
					const socket = this.attached;
					void this.attachPresentation(
						message.id,
						message.sessionId,
						message.from,
						socket,
					).catch((error) => {
						if (socket === this.attached)
							this.send({
								type: 'result',
								id: message.id,
								ok: false,
								error:
									error instanceof Error ? error.message : 'recovery failed',
							});
					});
				} else this.attach(message.id, message.sessionId, message.from);
				return;
			case 'write':
				this.live(message.sessionId).child.write(Buffer.from(payload));
				return;
			case 'resize': {
				const session = this.live(message.sessionId);
				assertDimension(message.cols, 'cols');
				assertDimension(message.rows, 'rows');
				session.child.resize(message.cols, message.rows);
				session.cols = message.cols;
				session.rows = message.rows;
				this.observePresentation(session, 0, () =>
					this.presentations.ingestResize(this.presentationIdentity(session), {
						cols: message.cols,
						rows: message.rows,
					}),
				);
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
				this.syncFlow(session);
				return;
			}
			case 'resume': {
				const session = this.live(message.sessionId);
				session.serverPaused = false;
				this.syncFlow(session);
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
			presentationQueue: Promise.resolve(),
			presentationBytes: 0,
			presentationPaused: false,
			recovering: false,
			sessionId: request.sessionId,
			projectId: request.projectId,
			shellPath: request.shellPath,
			cwd: request.cwd,
			createdAt: this.now(),
			child,
			ring: new BoundedChunkQueue(
				this.maxBufferBytes,
				'within-bound-keep-last',
			),
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
		try {
			this.presentations.createSession(this.presentationIdentity(session), {
				cols: session.cols,
				rows: session.rows,
			});
		} catch (error) {
			session.presentationError = String(error);
		}
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

	private presentationIdentity(session: HeldSession) {
		return {
			serverId: 'session-holder',
			projectId: 'held',
			sessionId: session.sessionId,
		};
	}

	private syncFlow(session: HeldSession): void {
		if (session.exit !== undefined) return;
		if (
			session.serverPaused ||
			this.flowPaused ||
			session.presentationPaused ||
			session.recovering
		)
			session.child.pause?.();
		else session.child.resume?.();
	}

	private observePresentation(
		session: HeldSession,
		bytes: number,
		observe: () => Promise<void>,
	): void {
		if (session.presentationError !== undefined) return;
		session.presentationBytes += bytes;
		if (
			session.presentationBytes >= 256 * 1024 &&
			!session.presentationPaused
		) {
			session.presentationPaused = true;
			this.syncFlow(session);
		}
		let work: Promise<void>;
		try {
			work = observe();
		} catch (error) {
			work = Promise.reject(error);
		}
		const settled = work
			.catch((error) => {
				session.presentationError = String(error);
			})
			.finally(() => {
				session.presentationBytes -= bytes;
				if (
					session.presentationPaused &&
					session.presentationBytes <= 64 * 1024
				) {
					session.presentationPaused = false;
					this.syncFlow(session);
				}
			});
		// Work is already serialized by the shared authority. Track its latest
		// completion for a stable recovery cut without scanning retained output.
		session.presentationQueue = settled;
	}

	private async attachPresentation(
		id: number,
		sessionId: string,
		from: number,
		socket: Socket | undefined,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (
			!session ||
			!Number.isSafeInteger(from) ||
			from < 0 ||
			from > session.outputPosition
		)
			throw new Error('invalid recovery request');
		while (session.recoveryFinished !== undefined)
			await session.recoveryFinished;
		if (
			socket !== this.attached ||
			socket?.destroyed ||
			this.sessions.get(sessionId) !== session
		)
			return;
		let finishRecovery = () => {};
		session.recoveryFinished = new Promise<void>((resolve) => {
			finishRecovery = resolve;
		});
		session.recovering = true;
		session.streaming = false;
		this.syncFlow(session);
		try {
			let pending: Promise<void>;
			do {
				pending = session.presentationQueue;
				await pending;
			} while (pending !== session.presentationQueue);
			let recovery: Uint8Array | undefined;
			let presentationError = session.presentationError;
			if (presentationError === undefined) {
				const scope = {
					...this.presentationIdentity(session),
					clientId: 'server',
					attachmentId: 'recovery',
				};
				try {
					const metadata = await this.presentations.pin(scope);
					try {
						const value = this.presentations.read({
							...scope,
							checkpointId: metadata.checkpointId,
						});
						if (value.headPosition !== session.outputPosition)
							throw new Error('holder presentation cut changed');
						recovery = encodePresentationRecovery(value);
					} finally {
						this.presentations.release(metadata.checkpointId, scope);
					}
				} catch (error) {
					presentationError = String(error);
				}
			}
			if (
				socket !== this.attached ||
				socket?.destroyed ||
				this.sessions.get(sessionId) !== session
			)
				return;
			if (recovery !== undefined) {
				for (
					let offset = 0;
					offset < recovery.byteLength;
					offset += DATA_FRAME_BYTES
				) {
					this.send(
						{
							type: 'presentation',
							sessionId,
							offset,
							total: recovery.byteLength,
						},
						recovery.subarray(offset, offset + DATA_FRAME_BYTES),
					);
				}
			}
			const start = Math.max(from, session.bufferedFrom);
			this.result(id, {
				...recordOf(session),
				from: start,
				...(presentationError === undefined ? {} : { presentationError }),
			});
			for (const chunk of session.ring) {
				const skip = Math.max(0, start - chunk.position);
				if (skip < chunk.bytes.byteLength)
					this.sendData(
						session,
						chunk.position + skip,
						chunk.bytes.subarray(skip),
					);
			}
			session.streaming = true;
			if (session.exit !== undefined) this.sendExit(session, session.exit);
		} finally {
			session.recovering = false;
			session.recoveryFinished = undefined;
			finishRecovery();
			this.syncFlow(session);
		}
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
		this.presentations.closeSession(this.presentationIdentity(session));
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
		for (
			let offset = 0;
			offset < bytes.byteLength;
			offset += DATA_FRAME_BYTES
		) {
			const part = bytes.slice(
				offset,
				Math.min(bytes.byteLength, offset + DATA_FRAME_BYTES),
			);
			const position = session.outputPosition;
			this.observePresentation(session, part.byteLength, () =>
				this.presentations.ingestOutput(
					this.presentationIdentity(session),
					position,
					part,
				),
			);
			session.ring.push({ position, bytes: part });
			session.ringBytes = session.ring.byteLength;
			session.outputPosition = position + part.byteLength;
			session.bufferedFrom =
				session.ring.first?.position ?? session.outputPosition;
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
		this.lastDetachAt = this.now();
		this.flowPaused = false;
		for (const session of this.sessions.values()) {
			session.streaming = false;
			session.serverPaused = false;
			if (session.exit === undefined) {
				try {
					this.syncFlow(session);
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
		this.send({ type: 'data', sessionId: session.sessionId, position }, bytes);
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
			if (session.exit === undefined) this.syncFlow(session);
	}
}

function recordOf(session: HeldSession): HolderSessionRecord {
	return {
		sessionId: session.sessionId,
		...(session.projectId === undefined
			? {}
			: { projectId: session.projectId }),
		...(typeof session.child.pid === 'number'
			? { pid: session.child.pid }
			: {}),
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
