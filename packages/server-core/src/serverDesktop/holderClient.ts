import { spawn } from 'node:child_process';
import { chmod, mkdir, open, readFile, rm } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { DESKTOP_HOLDER_ENV, DESKTOP_HOLDER_LOCKED } from './holderProcess.js';
import {
	DESKTOP_HOLDER_SUPPORTED_VERSIONS,
	type DesktopHolderState,
	handshakeProof,
	isNonce,
	LineReader,
	newNonce,
	parseHolderState,
	proofMatches,
	sendLine,
} from './holderProtocol.js';
import { type ServerDesktopPaths, serverDesktopPaths } from './paths.js';

/**
 * The server's side of the desktop holder: finding the one that is running,
 * proving each side to the other, and starting one when there is none.
 *
 * The server never trusts a pid or a path written in a file. It derives the
 * control socket's path itself and adopts only a holder that proves it holds
 * the credential.
 */

export interface DesktopHolderLaunch {
	readonly dataRoot: string;
	readonly home: string;
	readonly programs: {
		readonly displayServer: string;
		readonly passwordTool: string;
		readonly python: string;
		readonly shell: string;
	};
	readonly launcher: string;
	readonly sessionScript: string;
	readonly preferredDisplay?: number;
	/** The environment the desktop's programs inherit. */
	readonly env: Readonly<Record<string, string | undefined>>;
	/** The Node binary and the holder's entry file. */
	readonly execPath?: string;
	readonly entry?: string;
}

/** A live, proven connection to a holder. */
export class DesktopHolderClient {
	private readonly pending: {
		resolve: (message: Record<string, unknown>) => void;
		reject: (error: Error) => void;
	}[] = [];
	private latest: DesktopHolderState;
	private closed = false;
	private readonly stateListeners = new Set<(state: DesktopHolderState) => void>();
	private readonly closeListeners = new Set<() => void>();

	constructor(
		private readonly socket: Socket,
		reader: LineReader,
		readonly version: number,
		state: DesktopHolderState,
	) {
		this.latest = state;
		reader.onMessage = (message) => {
			// A state with no request waiting for one is the holder's own news.
			if (message.t === 'state' && this.pendingKind[0] !== 'status') {
				const parsed = parseHolderState(message.state);
				if (parsed !== undefined) this.setState(parsed);
				return;
			}
			this.pendingKind.shift();
			const waiter = this.pending.shift();
			if (message.t === 'state') {
				const parsed = parseHolderState(message.state);
				if (parsed !== undefined) this.setState(parsed);
			}
			waiter?.resolve(message);
		};
		socket.on('close', () => {
			this.closed = true;
			for (const waiter of this.pending.splice(0))
				waiter.reject(new Error('the desktop holder went away'));
			for (const listener of this.closeListeners) listener();
		});
	}

	private readonly pendingKind: string[] = [];

	private setState(state: DesktopHolderState): void {
		const changed = JSON.stringify(state) !== JSON.stringify(this.latest);
		this.latest = state;
		if (changed) for (const listener of this.stateListeners) listener(state);
	}

	get state(): DesktopHolderState {
		return this.latest;
	}

	get alive(): boolean {
		return !this.closed;
	}

	onState(listener: (state: DesktopHolderState) => void): () => void {
		this.stateListeners.add(listener);
		return () => this.stateListeners.delete(listener);
	}

	/** Runs when the holder's connection ends, however it ends. */
	onClosed(listener: () => void): () => void {
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}

	private request(kind: string): Promise<Record<string, unknown>> {
		if (this.closed) return Promise.reject(new Error('the desktop holder went away'));
		return new Promise((resolve, reject) => {
			this.pending.push({ resolve, reject });
			this.pendingKind.push(kind);
			sendLine(this.socket, { t: kind });
		});
	}

	async status(): Promise<DesktopHolderState> {
		await this.request('status');
		return this.latest;
	}

	/** The VNC passwords, for the server's own upstream connections. They are
	 * handed to `use` and not kept. */
	async credentials(): Promise<{ full: string; viewOnly: string }> {
		const reply = await this.request('credentials');
		if (
			reply.t !== 'credentials' ||
			typeof reply.full !== 'string' ||
			typeof reply.viewOnly !== 'string'
		)
			throw new Error('the desktop is not running');
		return { full: reply.full, viewOnly: reply.viewOnly };
	}

	/** Program windows open on the display; -1 when it could not be told. */
	async windows(): Promise<number> {
		const reply = await this.request('windows');
		return reply.t === 'windows' && Number.isSafeInteger(reply.count)
			? (reply.count as number)
			: -1;
	}

	/** Ask the holder to end the desktop and exit; resolves once it has gone. */
	async stop(): Promise<void> {
		if (this.closed) return;
		const gone = new Promise<void>((resolve) => {
			this.socket.once('close', () => resolve());
		});
		this.request('stop').catch(() => undefined);
		await gone;
	}

	/** Drop this connection. The holder and its desktop keep running. */
	disconnect(): void {
		this.socket.destroy();
	}
}

export type DesktopHolderConnection =
	| { readonly outcome: 'adopted'; readonly client: DesktopHolderClient }
	/** Nothing answered on the control socket. */
	| { readonly outcome: 'absent' }
	/** Something answered and could not prove itself, or would not speak. */
	| { readonly outcome: 'unproven' }
	/** A proven holder speaks a protocol version this server does not. It has
	 * been asked to stop and has gone. */
	| { readonly outcome: 'replaced'; readonly version: number };

async function readSecret(paths: ServerDesktopPaths): Promise<string | undefined> {
	const text = (await readFile(paths.secret, 'utf8').catch(() => '')).trim();
	return /^[0-9a-f]{64}$/u.test(text) ? text : undefined;
}

/** Connect to the holder at the derived socket and complete the handshake. */
export async function connectDesktopHolder(
	directory: string,
	timeoutMs = 10_000,
): Promise<DesktopHolderConnection> {
	const paths = serverDesktopPaths(directory);
	const socket = connect(paths.control);
	const connected = await new Promise<boolean>((resolve) => {
		socket.once('connect', () => resolve(true));
		socket.once('error', () => resolve(false));
	});
	if (!connected) {
		socket.destroy();
		return { outcome: 'absent' };
	}
	socket.on('error', () => undefined);
	const timer = setTimeout(() => socket.destroy(), timeoutMs);
	try {
		const credential = await readSecret(paths);
		if (credential === undefined) throw new Error('no credential');
		const reader = new LineReader(socket);
		const nonce = newNonce();
		sendLine(socket, { t: 'challenge', nonce });
		const proof = await reader.next();
		if (
			proof.t !== 'proof' ||
			!isNonce(proof.nonce) ||
			!Number.isSafeInteger(proof.version) ||
			!proofMatches(
				proof.proof,
				handshakeProof(credential, 'holder', proof.nonce, nonce),
			)
		)
			throw new Error('the holder did not prove itself');
		sendLine(socket, {
			t: 'prove',
			proof: handshakeProof(credential, 'server', nonce, proof.nonce),
		});
		const welcome = await reader.next();
		const state = parseHolderState(welcome.state);
		if (welcome.t !== 'welcome' || state === undefined)
			throw new Error('the holder did not welcome the server');
		clearTimeout(timer);
		const version = proof.version as number;
		const client = new DesktopHolderClient(socket, reader, version, state);
		if (!DESKTOP_HOLDER_SUPPORTED_VERSIONS.includes(version)) {
			// `stop` means the same in every version.
			await client.stop();
			return { outcome: 'replaced', version };
		}
		return { outcome: 'adopted', client };
	} catch {
		clearTimeout(timer);
		socket.destroy();
		return { outcome: 'unproven' };
	}
}

/** Whether a live process holds the holder lock. The lock is tried and let
 * go at once; a lock file that does not exist is free. */
export async function desktopHolderLockHeld(directory: string): Promise<boolean> {
	const paths = serverDesktopPaths(directory);
	const present = await open(paths.lock, 'r').then(
		(handle) => handle.close().then(() => true),
		() => false,
	);
	if (!present) return false;
	const { DatabaseSync } = await import('node:sqlite');
	const database = new DatabaseSync(paths.lock);
	try {
		database.exec('BEGIN EXCLUSIVE');
		database.exec('ROLLBACK');
		return false;
	} catch {
		return true;
	} finally {
		database.close();
	}
}

export type DesktopHolderStart =
	| { readonly outcome: 'started' }
	| { readonly outcome: 'locked' }
	| { readonly outcome: 'failed'; readonly reason: string };

/**
 * Start a detached holder and wait for what it does, never for a clock: it
 * closes its readiness descriptor once its control socket is listening, or
 * writes why it could not start.
 */
export async function startDesktopHolder(
	directory: string,
	launch: DesktopHolderLaunch,
): Promise<DesktopHolderStart> {
	const paths = serverDesktopPaths(directory);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	const log = await open(paths.holderLog, 'w', 0o600);
	try {
		const child = spawn(
			launch.execPath ?? process.execPath,
			[launch.entry ?? fileURLToPath(new URL('./holderEntry.js', import.meta.url))],
			{
				// Its own session: no controlling terminal, not in this process
				// group, so it outlives the server.
				detached: true,
				stdio: ['ignore', log.fd, log.fd, 'pipe'],
				cwd: directory,
				env: {
					...launch.env,
					[DESKTOP_HOLDER_ENV.directory]: directory,
					[DESKTOP_HOLDER_ENV.dataRoot]: launch.dataRoot,
					[DESKTOP_HOLDER_ENV.home]: launch.home,
					[DESKTOP_HOLDER_ENV.displayServer]: launch.programs.displayServer,
					[DESKTOP_HOLDER_ENV.passwordTool]: launch.programs.passwordTool,
					[DESKTOP_HOLDER_ENV.python]: launch.programs.python,
					[DESKTOP_HOLDER_ENV.shell]: launch.programs.shell,
					[DESKTOP_HOLDER_ENV.launcher]: launch.launcher,
					[DESKTOP_HOLDER_ENV.sessionScript]: launch.sessionScript,
					...(launch.preferredDisplay === undefined
						? {}
						: {
								[DESKTOP_HOLDER_ENV.preferredDisplay]: String(
									launch.preferredDisplay,
								),
							}),
					[DESKTOP_HOLDER_ENV.readyFd]: '3',
				} as unknown as NodeJS.ProcessEnv,
			},
		);
		child.unref();
		const ready = child.stdio[3] as NodeJS.ReadableStream & {
			destroy(): void;
		};
		const chunks: Buffer[] = [];
		ready.on('data', (chunk: Buffer) => chunks.push(chunk));
		const outcome = await new Promise<DesktopHolderStart>((resolve) => {
			child.once('error', (error) =>
				resolve({ outcome: 'failed', reason: error.message }),
			);
			ready.once('end', () => {
				const said = Buffer.concat(chunks).toString('utf8');
				if (said === '') resolve({ outcome: 'started' });
				else if (said === DESKTOP_HOLDER_LOCKED) resolve({ outcome: 'locked' });
				else resolve({ outcome: 'failed', reason: said });
			});
			ready.once('error', () =>
				resolve({ outcome: 'failed', reason: 'the desktop holder did not start' }),
			);
		});
		ready.destroy();
		return outcome;
	} finally {
		await log.close();
	}
}

export type DesktopHolderAdoption =
	| {
			readonly outcome: 'ready';
			readonly client: DesktopHolderClient;
			/** True when this call started the holder. */
			readonly started: boolean;
			/** The version of a holder that had to be replaced, when one was:
			 * every window of that desktop closed. */
			readonly replaced?: number;
	  }
	| { readonly outcome: 'failed'; readonly reason: string };

/**
 * Adopt the running holder, or start one.
 *
 * - A holder that proves itself is adopted.
 * - Nothing provable and the lock free: no holder is alive. Stale sockets of
 *   Terminay's own are removed and one is started.
 * - Nothing provable and the lock held: something is there that cannot be
 *   spoken to. Nothing is started beside it and nothing is signalled.
 */
export async function adoptOrStartDesktopHolder(
	directory: string,
	launch: DesktopHolderLaunch,
): Promise<DesktopHolderAdoption> {
	let replaced: number | undefined;
	for (let attempt = 0; attempt < 3; attempt++) {
		const connection = await connectDesktopHolder(directory);
		if (connection.outcome === 'adopted')
			return {
				outcome: 'ready',
				client: connection.client,
				started: attempt > 0,
				...(replaced === undefined ? {} : { replaced }),
			};
		if (connection.outcome === 'replaced') {
			replaced = connection.version;
		} else if (await desktopHolderLockHeld(directory)) {
			return {
				outcome: 'failed',
				reason:
					'A desktop holder is already running here but could not be reached. Nothing was started beside it.',
			};
		}
		// No holder is alive, so these are nobody's.
		const paths = serverDesktopPaths(directory);
		await rm(paths.control, { force: true });
		await rm(paths.rfb, { force: true });
		const start = await startDesktopHolder(directory, launch);
		if (start.outcome === 'failed')
			return { outcome: 'failed', reason: start.reason };
		// `locked`: another start won the race; go round and adopt it.
	}
	return {
		outcome: 'failed',
		reason: 'The desktop holder could not be started.',
	};
}
