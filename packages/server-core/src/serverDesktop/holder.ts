import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, openSync, watch } from 'node:fs';
import {
	chmod,
	lstat,
	mkdir,
	open,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import {
	DESKTOP_HOLDER_PROTOCOL_VERSION,
	type DesktopHolderReply,
	type DesktopHolderState,
	handshakeProof,
	isNonce,
	LineReader,
	newNonce,
	proofMatches,
	sendLine,
} from './holderProtocol.js';
import {
	SERVER_DESKTOP_DISPLAY_SCAN,
	SERVER_DESKTOP_PREFERRED_DISPLAY,
	type ServerDesktopPaths,
	serverDesktopDisplayRecord,
	serverDesktopPaths,
	xDisplayFiles,
} from './paths.js';
import { countProgramWindows, xauthorityEntry } from './x11.js';

/**
 * The desktop holder: one detached process that starts the display server
 * and the desktop session, keeps them running, and outlives the server that
 * started it, so a server restart leaves every window where it was.
 *
 * The holder is the only thing that starts the display server, and it always
 * starts it through the launcher that denies it the network.
 */

export class DesktopHolderLockedError extends Error {
	constructor() {
		super('another desktop holder holds the lock');
		this.name = 'DesktopHolderLockedError';
	}
}

export interface DesktopHolderOptions {
	/** The owner-only desktop directory. */
	readonly directory: string;
	/** Where the chosen display number is remembered. */
	readonly dataRoot: string;
	/** The directory programs on the desktop start in. */
	readonly home: string;
	readonly programs: {
		readonly displayServer: string;
		readonly passwordTool: string;
		readonly python: string;
		readonly shell: string;
	};
	/** The launcher that denies the display server the network. */
	readonly launcher: string;
	/** The shared desktop session script. */
	readonly sessionScript: string;
	/** The environment the session's programs inherit. */
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly preferredDisplay?: number;
	/** Runs when the holder has stopped everything it started. */
	readonly onClosed?: () => void;
}

const FILE_MODE = 0o600;
/** How long the display server may take to answer on its sockets. */
const DISPLAY_START_MS = 20_000;
/** A display or session that dies this many times within the window is not
 * restarted again; the holder reports why and waits to be stopped. */
const RESTART_LIMIT = 3;
const RESTART_WINDOW_MS = 60_000;
const STOP_GRACE_MS = 5_000;
const ORPHAN_CHECK_MS = 5_000;

/** Variables the session's programs keep from the holder's own environment. */
const INHERITED = ['PATH', 'LANG', 'LANGUAGE', 'LC_ALL', 'TZ', 'USER', 'LOGNAME', 'SHELL'];

async function exists(path: string): Promise<boolean> {
	return lstat(path).then(
		() => true,
		() => false,
	);
}

/** Whether something answers on a unix socket. */
function answers(path: string): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect(path);
		const done = (value: boolean) => {
			socket.destroy();
			resolve(value);
		};
		socket.once('connect', () => done(true));
		socket.once('error', () => done(false));
	});
}

/** Whether a display number is free for a new display server: nothing
 * answers on its socket and no live process holds its lock file. A stale
 * socket or lock is left for the display server to replace, as it does. */
export async function displayIsFree(display: number): Promise<boolean> {
	const files = xDisplayFiles(display);
	if ((await exists(files.socket)) && (await answers(files.socket))) return false;
	const lock = await readFile(files.lock, 'utf8').catch(() => undefined);
	if (lock === undefined) return true;
	const pid = Number.parseInt(lock.trim(), 10);
	if (!Number.isSafeInteger(pid) || pid <= 0) return true;
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		// EPERM: a live process of another account.
		return (error as NodeJS.ErrnoException).code !== 'EPERM';
	}
}

/** Resolves when `path` exists, or rejects when `signal` aborts. */
function pathAppears(path: string, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const watcher = watch(dirname(path), () => void check());
		const finish = (error?: Error) => {
			watcher.close();
			signal.removeEventListener('abort', abort);
			if (error === undefined) resolve();
			else reject(error);
		};
		const abort = () => finish(new Error('gave up waiting'));
		const check = async () => {
			if (await exists(path)) finish();
		};
		signal.addEventListener('abort', abort, { once: true });
		watcher.on('error', () => undefined);
		if (signal.aborted) abort();
		else void check();
	});
}

function exited(child: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) resolve();
		else child.once('exit', () => resolve());
	});
}

async function end(child: ChildProcess | undefined, group: boolean): Promise<void> {
	if (child === undefined || child.pid === undefined) return;
	const signal = (name: NodeJS.Signals) => {
		try {
			// The session is ended as a group: on Debian 12, dbus-run-session
			// does not pass a signal on to the session it wraps.
			process.kill(group ? -(child.pid as number) : (child.pid as number), name);
		} catch {
			/* already gone */
		}
	};
	if (child.exitCode === null && child.signalCode === null) signal('SIGTERM');
	const force = setTimeout(() => signal('SIGKILL'), STOP_GRACE_MS);
	await exited(child);
	clearTimeout(force);
	// Anything of the group that outlived its leader.
	if (group) signal('SIGKILL');
}

export class DesktopHolder {
	private readonly paths: ServerDesktopPaths;
	private state: DesktopHolderState = { phase: 'starting', generation: 0 };
	private display: ChildProcess | undefined;
	private session: ChildProcess | undefined;
	private server: Server | undefined;
	private readonly connections = new Set<Socket>();
	private readonly subscribers = new Set<Socket>();
	private lock: { close(): void } | undefined;
	private credential = '';
	private passwords = { full: '', viewOnly: '' };
	private displayNumber = 0;
	private stopping = false;
	private readonly restarts: number[] = [];
	private supervising: Promise<void> = Promise.resolve();

	private constructor(private readonly options: DesktopHolderOptions) {
		this.paths = serverDesktopPaths(options.directory);
	}

	/** Take the lock, serve the control socket, and start the desktop. The
	 * promise resolves once the control socket is listening; the desktop's own
	 * start is reported through the state. */
	static async start(options: DesktopHolderOptions): Promise<DesktopHolder> {
		const holder = new DesktopHolder(options);
		await holder.begin();
		return holder;
	}

	get current(): DesktopHolderState {
		return this.state;
	}

	private async begin(): Promise<void> {
		const { paths } = this;
		await mkdir(paths.directory, { recursive: true, mode: 0o700 });
		await chmod(paths.directory, 0o700);
		await this.takeLock();
		try {
			this.credential = await this.readOrCreateSecret();
			await this.listen();
		} catch (error) {
			this.lock?.close();
			throw error;
		}
		this.supervising = this.run().catch((error: unknown) => {
			this.fail(error instanceof Error ? error.message : String(error));
		});
	}

	/** An exclusive SQLite transaction, left open: the kernel holds the lock
	 * for as long as this process exists and drops it however it ends
	 * (ADR-0055). The file is never removed. */
	private async takeLock(): Promise<void> {
		const { DatabaseSync } = await import('node:sqlite');
		await open(this.paths.lock, 'wx', FILE_MODE)
			.then((handle) => handle.close())
			.catch((error: NodeJS.ErrnoException) => {
				if (error.code !== 'EEXIST') throw error;
			});
		const database = new DatabaseSync(this.paths.lock);
		try {
			database.exec('BEGIN EXCLUSIVE');
		} catch {
			database.close();
			throw new DesktopHolderLockedError();
		}
		this.lock = database;
	}

	private async readOrCreateSecret(): Promise<string> {
		const present = await readFile(this.paths.secret, 'utf8').catch(() => '');
		if (/^[0-9a-f]{64}$/u.test(present.trim())) return present.trim();
		const secret = randomBytes(32).toString('hex');
		const pending = `${this.paths.secret}.tmp`;
		await writeFile(pending, `${secret}\n`, { mode: FILE_MODE });
		await rename(pending, this.paths.secret);
		return secret;
	}

	private async listen(): Promise<void> {
		// The lock is held, so a socket left here is nobody's.
		await rm(this.paths.control, { force: true });
		const server = createServer((socket) => this.serve(socket));
		const previous = process.umask(0o177);
		try {
			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(this.paths.control, resolve);
			});
		} finally {
			process.umask(previous);
		}
		await chmod(this.paths.control, FILE_MODE);
		this.server = server;
		// A holder whose directory has been removed belongs to nothing: a
		// deleted data directory or an uninstall. It ends its desktop.
		const orphaned = setInterval(() => {
			if (this.stopping) clearInterval(orphaned);
			else if (!existsSync(this.paths.secret)) {
				clearInterval(orphaned);
				void this.close();
			}
		}, ORPHAN_CHECK_MS);
		orphaned.unref();
	}

	private serve(socket: Socket): void {
		this.connections.add(socket);
		socket.on('close', () => {
			this.connections.delete(socket);
			this.subscribers.delete(socket);
		});
		socket.on('error', () => undefined);
		const reader = new LineReader(socket);
		// A peer that does not finish the handshake is dropped.
		const deadline = setTimeout(() => socket.destroy(), 10_000);
		void (async () => {
			const challenge = await reader.next();
			if (challenge.t !== 'challenge' || !isNonce(challenge.nonce))
				throw new Error('bad challenge');
			const nonce = newNonce();
			sendLine(socket, {
				t: 'proof',
				version: DESKTOP_HOLDER_PROTOCOL_VERSION,
				nonce,
				proof: handshakeProof(this.credential, 'holder', nonce, challenge.nonce),
			});
			const prove = await reader.next();
			if (
				prove.t !== 'prove' ||
				!proofMatches(
					prove.proof,
					handshakeProof(this.credential, 'server', challenge.nonce, nonce),
				)
			)
				throw new Error('bad proof');
			clearTimeout(deadline);
			sendLine(socket, { t: 'welcome', state: this.state });
			this.subscribers.add(socket);
			reader.onMessage = (message) => void this.answer(socket, message);
		})().catch(() => {
			clearTimeout(deadline);
			socket.destroy();
		});
	}

	private async answer(
		socket: Socket,
		message: Record<string, unknown>,
	): Promise<void> {
		const reply = (value: DesktopHolderReply) => sendLine(socket, value);
		switch (message.t) {
			case 'status':
				reply({ t: 'state', state: this.state });
				return;
			case 'credentials':
				if (this.state.phase !== 'running')
					reply({ t: 'error', message: 'the desktop is not running' });
				else reply({ t: 'credentials', ...this.passwords });
				return;
			case 'windows':
				try {
					reply({
						t: 'windows',
						count:
							this.state.phase === 'running'
								? await countProgramWindows(this.displayNumber, this.paths.cookie)
								: 0,
					});
				} catch {
					// Unknown is treated as "there may be windows".
					reply({ t: 'windows', count: -1 });
				}
				return;
			case 'stop':
				reply({ t: 'stopping' });
				void this.close();
				return;
			default:
				reply({ t: 'error', message: 'unknown request' });
		}
	}

	private publish(state: DesktopHolderState): void {
		this.state = state;
		for (const socket of this.subscribers) sendLine(socket, { t: 'state', state });
	}

	private fail(reason: string): void {
		if (this.stopping) return;
		this.publish({
			phase: 'failed',
			generation: this.state.generation,
			...(this.displayNumber ? { display: this.displayNumber } : {}),
			reason: reason.slice(0, 2048),
		});
	}

	private async run(): Promise<void> {
		await this.prepareFiles();
		this.displayNumber = await this.chooseDisplay();
		while (!this.stopping) {
			await this.startDisplay();
			if (this.stopping) break;
			await this.superviseSessions();
			if (this.stopping) break;
			// The display server died. Every window went with it.
			await end(this.session, true);
			this.session = undefined;
			this.allowRestart('The display server stopped repeatedly.');
		}
	}

	/** Throws once restarts have come too fast to be worth another. */
	private allowRestart(reason: string): void {
		const now = Date.now();
		this.restarts.push(now);
		while (this.restarts.length && now - (this.restarts[0] as number) > RESTART_WINDOW_MS)
			this.restarts.shift();
		if (this.restarts.length > RESTART_LIMIT) throw new Error(reason);
	}

	private async prepareFiles(): Promise<void> {
		const { paths } = this;
		for (const directory of [paths.state, paths.config, paths.cache, paths.runtime]) {
			await mkdir(directory, { recursive: true, mode: 0o700 });
			await chmod(directory, 0o700);
		}
		// Two fresh passwords for every holder. VNC compares eight bytes, so
		// eight random characters each, and never the same two.
		const password = () => randomBytes(6).toString('base64url');
		const full = password();
		let viewOnly = password();
		while (viewOnly === full) viewOnly = password();
		this.passwords = { full, viewOnly };
		const obfuscated = await new Promise<Buffer>((resolve, reject) => {
			// The passwords go in on standard input, never on the command line.
			const child = spawn(this.options.programs.passwordTool, ['-f'], {
				stdio: ['pipe', 'pipe', 'ignore'],
				env: {} as NodeJS.ProcessEnv,
			});
			const chunks: Buffer[] = [];
			child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
			child.once('error', reject);
			child.once('close', (code) =>
				code === 0 && Buffer.concat(chunks).length === 16
					? resolve(Buffer.concat(chunks))
					: reject(new Error('the VNC password file could not be written')),
			);
			child.stdin.end(`${full}\n${viewOnly}\n`);
		});
		await writeFile(paths.passwords, obfuscated, { mode: FILE_MODE });
		await chmod(paths.passwords, FILE_MODE);
	}

	/** The remembered number if it is free, else the preferred one, else the
	 * next free one above it. A display Terminay did not start is never
	 * touched: its number is simply passed over. */
	private async chooseDisplay(): Promise<number> {
		const preferred =
			this.options.preferredDisplay ?? SERVER_DESKTOP_PREFERRED_DISPLAY;
		const record = serverDesktopDisplayRecord(this.options.dataRoot);
		const remembered = Number.parseInt(
			(await readFile(record, 'utf8').catch(() => '')).trim(),
			10,
		);
		const candidates = [
			...(Number.isSafeInteger(remembered) &&
			remembered >= preferred &&
			remembered <= preferred + SERVER_DESKTOP_DISPLAY_SCAN
				? [remembered]
				: []),
			...Array.from({ length: SERVER_DESKTOP_DISPLAY_SCAN + 1 }, (_, i) => preferred + i),
		];
		for (const candidate of candidates) {
			if (!(await displayIsFree(candidate))) continue;
			const pending = `${record}.tmp`;
			await writeFile(pending, `${candidate}\n`, { mode: FILE_MODE });
			await rename(pending, record);
			return candidate;
		}
		throw new Error('No display number is free for the desktop.');
	}

	private async startDisplay(): Promise<void> {
		const { paths, options } = this;
		const display = this.displayNumber;
		this.publish({ phase: 'starting', display, generation: this.state.generation });
		// The cookie is kept across restarts of the display server, so
		// programs that already hold its path keep working.
		if (!(await exists(paths.cookie))) {
			await writeFile(paths.cookie, xauthorityEntry(display, randomBytes(16)), {
				mode: FILE_MODE,
			});
			await chmod(paths.cookie, FILE_MODE);
		}
		await rm(paths.rfb, { force: true });
		const log = openSync(paths.displayLog, 'w', FILE_MODE);
		let child: ChildProcess;
		try {
			child = spawn(
				options.programs.python,
				[
					'-I',
					options.launcher,
					options.programs.displayServer,
					`:${display}`,
					// No RFB TCP port and no X TCP listener: one unix socket each.
					'-rfbport',
					'-1',
					'-rfbunixpath',
					paths.rfb,
					'-rfbunixmode',
					'0600',
					'-nolisten',
					'tcp',
					'-auth',
					paths.cookie,
					'-SecurityTypes',
					'VncAuth',
					'-PasswordFile',
					paths.passwords,
					'-geometry',
					'1280x800',
					'-depth',
					'24',
					'-AlwaysShared',
					// Highlighting text on the desktop is never a copy to a device.
					'-SendPrimary=0',
					'-MaxCutText=1048576',
				],
				{
					stdio: ['ignore', log, log],
					// Its own environment: no ~/.vnc is read, and nothing of the
					// server's reaches the display server.
					env: {
						PATH: '/usr/bin:/bin',
						HOME: paths.state,
					} as unknown as NodeJS.ProcessEnv,
					cwd: paths.directory,
				},
			);
		} finally {
			closeSync(log);
		}
		this.display = child;
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), DISPLAY_START_MS);
		void exited(child).then(() => abort.abort());
		try {
			await pathAppears(paths.rfb, abort.signal);
			await pathAppears(xDisplayFiles(display).socket, abort.signal);
		} catch {
			await end(child, false);
			const tail = (await readFile(paths.displayLog, 'utf8').catch(() => ''))
				.trim()
				.split('\n')
				.slice(-4)
				.join(' ');
			throw new Error(
				`The display server did not start.${tail ? ` ${tail.slice(0, 600)}` : ''}`,
			);
		} finally {
			clearTimeout(timer);
		}
		this.publish({
			phase: 'running',
			display,
			generation: this.state.generation + 1,
		});
	}

	/** Keep a session on the display until the display server exits. */
	private async superviseSessions(): Promise<void> {
		const display = this.display as ChildProcess;
		const displayGone = exited(display);
		const sessionRestarts: number[] = [];
		while (!this.stopping && display.exitCode === null && display.signalCode === null) {
			const session = this.startSession();
			this.session = session;
			const which = await Promise.race([
				displayGone.then(() => 'display' as const),
				exited(session).then(() => 'session' as const),
			]);
			if (which === 'display' || this.stopping) return;
			// The session ended on its own: clear what is left of it and start
			// another on the same display. Programs keep their windows.
			await end(session, true);
			const now = Date.now();
			sessionRestarts.push(now);
			while (now - (sessionRestarts[0] as number) > RESTART_WINDOW_MS)
				sessionRestarts.shift();
			if (sessionRestarts.length > RESTART_LIMIT) {
				const tail = (await readFile(this.paths.sessionLog, 'utf8').catch(() => ''))
					.trim()
					.split('\n')
					.slice(-3)
					.join(' ');
				throw new Error(
					`The desktop session stopped repeatedly.${tail ? ` ${tail.slice(0, 600)}` : ''}`,
				);
			}
		}
	}

	private startSession(): ChildProcess {
		const { paths, options } = this;
		const inherited: Record<string, string> = {};
		for (const name of INHERITED) {
			const value = options.env[name];
			if (value !== undefined) inherited[name] = value;
		}
		const log = openSync(paths.sessionLog, 'w', FILE_MODE);
		try {
			return spawn(options.programs.shell, [options.sessionScript], {
				stdio: ['ignore', log, log],
				// Its own process group, so the whole session ends together.
				detached: true,
				cwd: options.home,
				env: {
					PATH: '/usr/local/bin:/usr/bin:/bin',
					...inherited,
					HOME: options.home,
					DISPLAY: `:${this.displayNumber}`,
					XAUTHORITY: paths.cookie,
					// The session's own configuration: nothing of the account's
					// existing desktop settings is read or changed.
					XDG_CONFIG_HOME: paths.config,
					XDG_CACHE_HOME: paths.cache,
					XDG_RUNTIME_DIR: paths.runtime,
					TERMINAY_DESKTOP_DISPLAY: `:${this.displayNumber}`,
					TERMINAY_DESKTOP_STATE_DIR: paths.state,
					TERMINAY_DESKTOP_HOME: options.home,
					// No launchers and no services: nothing but the desktop.
				} as unknown as NodeJS.ProcessEnv,
			});
		} finally {
			closeSync(log);
		}
	}

	/** End the session and the display server, then everything else. */
	async close(): Promise<void> {
		if (this.stopping) return this.supervising;
		this.stopping = true;
		await end(this.session, true);
		await end(this.display, false);
		await this.supervising.catch(() => undefined);
		// No new connection is taken, but the ones open stay open until
		// everything is released: a server waiting on `stop` sees its
		// connection end only once another holder could start.
		this.server?.close();
		await rm(this.paths.control, { force: true });
		await rm(this.paths.rfb, { force: true });
		// The passwords die with the display they opened.
		await rm(this.paths.passwords, { force: true });
		this.lock?.close();
		for (const socket of this.connections) socket.destroy();
		this.options.onClosed?.();
	}
}
