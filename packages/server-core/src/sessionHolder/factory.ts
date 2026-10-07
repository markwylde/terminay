import { spawn as spawnChild } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	watch,
} from 'node:fs';
import {
	cleanEnvironment,
	createForegroundObserver,
	createForegroundPolling,
	type NodePtyFactoryOptions,
	type NodePtyProcess,
	shellName,
} from '../terminalService/nodePty.js';
import type { PtySpawnOptions } from '../terminalService/types.js';
import {
	type HolderSessionStream,
	SessionHolderClient,
	SessionHolderRefusedError,
} from './client.js';
import {
	deleteHolderCloseRecord,
	MAX_HOLDER_CLOSE_RECORDS,
	readHolderCloseRecords,
} from './closeRecord.js';
import type { SessionHolderRecordFile } from './holder.js';
import {
	holderClosedReport,
	type SessionHolderIdentity,
	type SessionHolderObservationReport,
	type SessionHolderObserver,
} from './observation.js';
import {
	isSessionHolderGeneration,
	sessionHolderDirectory,
	sessionHolderRecordPath,
	sessionHolderSocketPath,
	sessionTailsDirectory,
	socketPathFits,
} from './paths.js';
import { SESSION_HOLDER_ENV } from './process.js';
import type { HolderExitRecord, HolderSessionRecord } from './protocol.js';
import {
	deleteSessionTail,
	pruneSessionTails,
	readSessionTail,
	type SessionTail,
} from './tails.js';

/**
 * The server's side of the session holder: a `PtyFactory` whose processes live
 * in a detached holder, plus the adopt, detach, and end-all operations a
 * server needs around a restart (ADR-0035).
 */

export interface SessionHolderLaunchRequest {
	/** Environment the holder process must receive, in addition to its own. */
	readonly env: Readonly<Record<string, string>>;
}

export interface SessionHolderPtyFactoryOptions extends NodePtyFactoryOptions {
	readonly dataRoot: string;
	/** Identifies this build. A holder started by another build is drained. */
	readonly buildId: string;
	/**
	 * Start a detached holder process. The host knows which runtime and entry
	 * point it ships; server-core only says what the holder must be told.
	 */
	readonly launch: (request: SessionHolderLaunchRequest) => void;
	/** Unattached limit sent to every holder. `null` means no limit. */
	readonly limitMs: number | null;
	readonly launchTimeoutMs?: number;
	/**
	 * Metadata-only observer for holder lifecycle and held sessions ending.
	 * Called on transitions, never for output, and never able to fail one.
	 */
	readonly onObservation?: SessionHolderObserver;
}

/** A session a holder still has, live or ended, that a server may adopt. */
export interface HeldSessionSummary extends HolderSessionRecord {
	readonly generation: string;
}

export interface SessionHolderPtyFactory {
	readonly spawn: (options: PtySpawnOptions) => Promise<NodePtyProcess>;
	/** Attach every reachable holder and report the sessions they hold. */
	readonly start: () => Promise<readonly HeldSessionSummary[]>;
	/** Take over a held session. Its retained output is delivered first. */
	readonly adopt: (sessionId: string) => Promise<{
		readonly process: NodePtyProcess;
		readonly record: HolderSessionRecord;
		/** Output position of the first byte `process` will deliver. */
		readonly from: number;
	}>;
	/** End one session and forget it, wherever it is held. */
	readonly end: (sessionId: string) => Promise<void>;
	/** End every session of this data root and leave no holder running. */
	readonly endAll: () => Promise<void>;
	readonly setLimit: (limitMs: number | null) => void;
	/** Disconnect from every holder. Their sessions keep running. */
	readonly detach: () => Promise<void>;
	readonly readTail: (sessionId: string) => SessionTail | undefined;
	readonly deleteTail: (sessionId: string) => void;
	/** Remove saved tails for sessions the workspace no longer has. */
	readonly pruneTails: (keep: ReadonlySet<string>) => void;
	/** Holders this server could not speak to; their sessions are ended. */
	readonly incompatibleGenerations: () => readonly string[];
	/**
	 * Whether this data root had ever kept sessions in a holder before this
	 * server started. When it had not, the terminals a workspace remembers were
	 * children of an earlier server process and ended with it: there is nothing
	 * to reattach and nothing saved to show.
	 */
	readonly hadPriorState: () => boolean;
}

const DEFAULT_LAUNCH_TIMEOUT_MS = 10_000;

export function createSessionHolderPtyFactory(
	options: SessionHolderPtyFactoryOptions,
): SessionHolderPtyFactory {
	const { dataRoot } = options;
	const polling = createForegroundPolling(options.foregroundPolling);
	const clients = new Map<string, SessionHolderClient>();
	const owners = new Map<string, SessionHolderClient>();
	const incompatible: string[] = [];
	let current: SessionHolderClient | undefined;
	let launching: Promise<SessionHolderClient> | undefined;
	let limitMs = options.limitMs;
	let detaching = false;
	/** Sessions whose saved tail this server has read and may need to delete. */
	const tails = new Set<string>();
	let started: Promise<readonly HeldSessionSummary[]> | undefined;
	// Read once, before this server creates either directory itself.
	const priorState =
		existsSync(sessionHolderDirectory(dataRoot)) ||
		existsSync(sessionTailsDirectory(dataRoot));

	const observe = (report: SessionHolderObservationReport): void => {
		try {
			options.onObservation?.(report);
		} catch {
			/* an observer cannot affect a session */
		}
	};
	/** What reports say about a session, kept apart from who owns it. */
	interface ObservedSession {
		readonly ordinal: number;
		readonly holder: SessionHolderIdentity;
		readonly client: SessionHolderClient;
		live: boolean;
		reported: boolean;
		/** Already ended, with no server watching, when this server found it. */
		readonly endedUnattached: boolean;
	}
	const observed = new Map<string, ObservedSession>();
	const identities = new Map<SessionHolderClient, SessionHolderIdentity>();
	/** Connections this server is closing itself. */
	const leaving = new Set<SessionHolderClient>();
	let nextOrdinal = 1;

	const noteSession = (
		client: SessionHolderClient,
		holder: SessionHolderIdentity,
		record: HolderSessionRecord,
		endedUnattached = false,
	): void => {
		observed.set(record.sessionId, {
			ordinal: nextOrdinal,
			holder,
			client,
			live: record.exit === undefined,
			reported: false,
			endedUnattached,
		});
		nextOrdinal += 1;
	};

	const sessionEnded = (
		sessionId: string,
		detail: Pick<
			Extract<SessionHolderObservationReport, { kind: 'session-ended' }>,
			'exitCode' | 'signal' | 'requested' | 'endedUnattached'
		>,
	): void => {
		const session = observed.get(sessionId);
		if (session === undefined || session.reported) return;
		session.reported = true;
		session.live = false;
		observe({
			kind: 'session-ended',
			holder: session.holder,
			session: session.ordinal,
			...detail,
		});
	};

	const liveSessionsOf = (client: SessionHolderClient): number => {
		let count = 0;
		for (const session of observed.values())
			if (session.client === client && session.live) count += 1;
		return count;
	};

	const track = (client: SessionHolderClient, startedAt: number): void => {
		const holder: SessionHolderIdentity = { pid: client.pid, startedAt };
		identities.set(client, holder);
		clients.set(client.generation, client);
		client.setLimit(limitMs);
		client.onClosing((notice) => observe(holderClosedReport(notice, false)));
		client.onClose(() => {
			const announced = client.closeNotice !== undefined;
			observe({
				kind: 'connection-closed',
				holder,
				requested: leaving.has(client),
				announced,
				liveSessions: liveSessionsOf(client),
			});
			// Reported already, so the next server must not report it again. The
			// holder writes its record before it says anything.
			if (announced) deleteHolderCloseRecord(dataRoot, client.generation);
			leaving.delete(client);
			identities.delete(client);
			clients.delete(client.generation);
			if (current === client) current = undefined;
			for (const [sessionId, owner] of owners)
				if (owner === client) owners.delete(sessionId);
			// Counted on the connection record above, not reported one by one.
			for (const [sessionId, session] of observed)
				if (session.client === client) observed.delete(sessionId);
		});
	};

	/** Report closes that had no server to hear them, once each. */
	const reportUnheardCloses = (): void => {
		const records = readHolderCloseRecords(dataRoot);
		const dropped = Math.max(0, records.length - MAX_HOLDER_CLOSE_RECORDS);
		records.forEach((record, index) => {
			// A holder still attached has said so itself, and removes its own.
			if (clients.has(record.generation)) return;
			if (index >= dropped) observe(holderClosedReport(record.notice, true));
			deleteHolderCloseRecord(dataRoot, record.generation);
		});
	};

	const start = (): Promise<readonly HeldSessionSummary[]> => {
		if (started !== undefined) return started;
		started = (async () => {
			const held: HeldSessionSummary[] = [];
			for (const record of readHolderRecords(dataRoot)) {
				const holder: SessionHolderIdentity = {
					pid: record.pid,
					startedAt: record.startedAt,
				};
				if (!processIsAlive(record.pid)) {
					removeHolderFiles(dataRoot, record.generation);
					observe({ kind: 'record-removed', holder });
					continue;
				}
				let client: SessionHolderClient;
				try {
					client = await SessionHolderClient.connect(record);
				} catch (error) {
					if (
						error instanceof SessionHolderRefusedError &&
						error.reason === 'version'
					) {
						// Nothing this server can say to it. SIGTERM is the one request
						// every holder honours: it saves tails and ends its sessions.
						incompatible.push(record.generation);
						observe({ kind: 'incompatible', holder, signal: 'SIGTERM' });
						// Wait for it to finish, so the tails it saves are there to
						// be read by the restore that follows.
						const gone = holderRecordRemoved(dataRoot, record.generation);
						try {
							process.kill(record.pid, 'SIGTERM');
						} catch {
							/* already gone */
						}
						await gone;
					} else
						observe({
							kind: 'unreachable',
							holder,
							reason:
								error instanceof SessionHolderRefusedError
									? error.reason
									: error instanceof Error
										? error.message
										: String(error),
						});
					continue;
				}
				track(client, record.startedAt);
				const sameBuild = client.buildId === options.buildId;
				const wasDraining = client.draining;
				if (sameBuild && !wasDraining) current ??= client;
				else if (!wasDraining) client.drain();
				const sessions = await client.list();
				for (const session of sessions) {
					owners.set(session.sessionId, client);
					held.push({ ...session, generation: client.generation });
					noteSession(
						client,
						holder,
						session,
						// A holder saves a tail with an exit only for a session that
						// ended with no server watching it.
						session.exit !== undefined &&
							readSessionTail(dataRoot, session.sessionId)?.exit !== undefined,
					);
				}
				const liveSessions = liveSessionsOf(client);
				observe({
					kind: 'attached',
					holder,
					buildId: client.buildId,
					sameBuild,
					draining: wasDraining,
					liveSessions,
					endedSessions: sessions.length - liveSessions,
					limitMs,
				});
				if (!sameBuild && !wasDraining)
					observe({ kind: 'drained', holder, cause: 'build-mismatch' });
			}
			reportUnheardCloses();
			return held;
		})();
		return started;
	};

	const currentHolder = async (): Promise<SessionHolderClient> => {
		await start();
		if (current !== undefined && !current.closed) return current;
		launching ??= (async () => {
			const launchStartedAt = Date.now();
			try {
				const generation = randomBytes(8).toString('hex');
				if (!socketPathFits(sessionHolderSocketPath(dataRoot, generation)))
					throw new Error('session holder socket path is too long');
				const record = await launchHolder(options, generation, limitMs);
				const client = await SessionHolderClient.connect(record);
				track(client, record.startedAt);
				current = client;
				observe({
					kind: 'launched',
					holder: { pid: client.pid, startedAt: record.startedAt },
					durationMs: Date.now() - launchStartedAt,
					limitMs,
				});
				return client;
			} catch (error) {
				observe({
					kind: 'launch-failed',
					durationMs: Date.now() - launchStartedAt,
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			} finally {
				launching = undefined;
			}
		})();
		return launching;
	};

	const processFor = (
		client: SessionHolderClient,
		record: HolderSessionRecord,
		stream: HolderSessionStream,
	): NodePtyProcess => {
		const { sessionId } = record;
		const pid = record.pid;
		// Without a pid-based resolver the holder is the only place that can read
		// the PTY's foreground title, so it is asked rather than inspected.
		const resolveForeground =
			options.resolveForegroundProcess ??
			(() => client.foreground(sessionId));
		const foreground = createForegroundObserver(
			{ ...(pid === undefined ? {} : { pid }) },
			shellName(record.shellPath),
			polling,
			pid === undefined ? undefined : resolveForeground,
		);
		const exitListeners = new Set<(exit: HolderExitRecord) => void>();
		let exited = false;
		let disposed = false;
		let signalled = false;
		const releaseHolderClose = client.onClose(() => {
			// Detaching is this server leaving; anything else is the holder dying,
			// which took the shell with it.
			if (detaching || exited || disposed) return;
			exited = true;
			for (const listener of [...exitListeners])
				// Not a clean exit: nothing may treat this as a shell that finished.
				listener({ exitCode: 1, signal: null, at: Date.now() });
		});
		return {
			...(pid === undefined ? {} : { pid }),
			write: (bytes) => client.write(sessionId, bytes),
			resize: (dimensions) =>
				client.resize(sessionId, dimensions.cols, dimensions.rows),
			kill: (signal) => {
				signalled = true;
				client.signal(sessionId, signal);
			},
			pause: () => client.pause(sessionId),
			resume: () => client.resume(sessionId),
			onData: (listener) =>
				stream.onData((_position, bytes) => {
					foreground.noteOutput();
					listener(bytes);
				}),
			onExit: (listener) => {
				const forward = (exit: HolderExitRecord): void => {
					exited = true;
					foreground.dispose();
					listener({ exitCode: exit.exitCode, signal: exit.signal });
				};
				exitListeners.add(forward);
				// Only an exit the holder reports is a session ending. The one made
				// up when a holder's connection goes is counted on that record.
				const release = stream.onExit((exit) => {
					sessionEnded(sessionId, {
						exitCode: exit.exitCode,
						signal: exit.signal,
						requested: signalled,
						endedUnattached: false,
					});
					forward(exit);
				});
				return () => {
					exitListeners.delete(forward);
					release();
				};
			},
			...(pid !== undefined && options.resolveCwd !== undefined
				? {
						getCwd: (signal?: AbortSignal) =>
							options.resolveCwd!(pid, signal),
					}
				: {}),
			onForegroundProcess: foreground.subscribe,
			refreshForegroundProcess: foreground.observeFresh,
			// Disposal stops this server observing the session. It never ends the
			// shell: that is `kill`, `end`, or `endAll`.
			dispose: () => {
				disposed = true;
				foreground.dispose();
				releaseHolderClose();
				exitListeners.clear();
				stream.release();
			},
		};
	};

	return {
		async spawn(spawnOptions) {
			const client = await currentHolder();
			const sessionId = spawnSessionId(spawnOptions);
			const { record, stream } = await client.spawn({
				sessionId,
				...(spawnOptions.projectId === undefined
					? {}
					: { projectId: spawnOptions.projectId }),
				shellPath: spawnOptions.shellPath,
				args: [...spawnOptions.args],
				cwd: spawnOptions.cwd,
				...(spawnOptions.env === undefined
					? {}
					: { env: cleanEnvironment(spawnOptions.env) }),
				...(spawnOptions.name === undefined ? {} : { name: spawnOptions.name }),
				cols: spawnOptions.cols,
				rows: spawnOptions.rows,
			});
			owners.set(sessionId, client);
			const holder = identities.get(client);
			if (holder !== undefined) noteSession(client, holder, record);
			return processFor(client, record, stream);
		},
		start,
		async adopt(sessionId) {
			await start();
			const client = owners.get(sessionId);
			if (client === undefined) throw new Error('session is not held');
			const { record, from, stream } = await client.attach(sessionId, 0);
			const session = observed.get(sessionId);
			if (record.exit !== undefined && session !== undefined) {
				if (session.endedUnattached)
					sessionEnded(sessionId, {
						exitCode: record.exit.exitCode,
						signal: record.exit.signal,
						requested: false,
						endedUnattached: true,
					});
				// Otherwise an earlier server watched it end and reported it then.
				session.reported = true;
				session.live = false;
			}
			return { process: processFor(client, record, stream), record, from };
		},
		async end(sessionId) {
			await start();
			if (tails.delete(sessionId)) deleteSessionTail(dataRoot, sessionId);
			const client = owners.get(sessionId);
			if (client === undefined) return;
			owners.delete(sessionId);
			// A holder ends a session it is asked to end without reporting an exit.
			if (observed.get(sessionId)?.live === true)
				sessionEnded(sessionId, {
					exitCode: null,
					signal: null,
					requested: true,
					endedUnattached: false,
				});
			observed.delete(sessionId);
			try {
				await client.end(sessionId);
			} catch {
				/* a holder that is already gone has nothing left to end */
			}
		},
		async endAll() {
			await start();
			await Promise.all(
				[...clients.values()].map(async (client) => {
					const closed = new Promise<void>((resolve) => {
						if (client.closed) resolve();
						else client.onClose(resolve);
					});
					leaving.add(client);
					try {
						await client.endAll();
					} catch {
						/* the holder exiting is the outcome wanted */
					}
					await closed;
				}),
			);
			owners.clear();
			pruneSessionTails(dataRoot, new Set());
		},
		setLimit(next) {
			limitMs = next;
			for (const client of clients.values()) client.setLimit(next);
			observe({ kind: 'limit-set', limitMs: next, holders: clients.size });
		},
		async detach() {
			detaching = true;
			for (const client of clients.values()) leaving.add(client);
			await Promise.all([...clients.values()].map((client) => client.close()));
		},
		readTail: (sessionId) => {
			const tail = readSessionTail(dataRoot, sessionId);
			if (tail !== undefined) tails.add(sessionId);
			return tail;
		},
		deleteTail: (sessionId) => {
			tails.delete(sessionId);
			deleteSessionTail(dataRoot, sessionId);
		},
		pruneTails: (keep) => pruneSessionTails(dataRoot, keep),
		incompatibleGenerations: () => [...incompatible],
		hadPriorState: () => priorState,
	};
}

/**
 * Start a detached holder with `execPath` and wait for nothing: the caller
 * learns it is ready from its record file. `detached` puts it in its own
 * session, so it has no controlling terminal and is not in this process group.
 */
export function launchDetachedSessionHolder(
	execPath: string,
	args: readonly string[],
	env: Readonly<Record<string, string | undefined>>,
): void {
	const child = spawnChild(execPath, [...args], {
		detached: true,
		stdio: ['ignore', 'ignore', 'ignore'],
		env: { ...env } as NodeJS.ProcessEnv,
	});
	child.unref();
}

/** Every holder record in a data root, whether or not its process is alive. */
export function readHolderRecords(
	dataRoot: string,
): readonly SessionHolderRecordFile[] {
	const directory = sessionHolderDirectory(dataRoot);
	let names: string[];
	try {
		names = readdirSync(directory);
	} catch {
		return [];
	}
	const records: SessionHolderRecordFile[] = [];
	for (const name of names) {
		if (!name.endsWith('.json')) continue;
		const generation = name.slice(0, -'.json'.length);
		if (!isSessionHolderGeneration(generation)) continue;
		const record = readHolderRecord(dataRoot, generation);
		if (record !== undefined) records.push(record);
	}
	return records.sort((left, right) => left.startedAt - right.startedAt);
}

function readHolderRecord(
	dataRoot: string,
	generation: string,
): SessionHolderRecordFile | undefined {
	try {
		const value = JSON.parse(
			readFileSync(sessionHolderRecordPath(dataRoot, generation), 'utf8'),
		) as Partial<SessionHolderRecordFile>;
		if (
			value.generation !== generation ||
			typeof value.pid !== 'number' ||
			typeof value.buildId !== 'string' ||
			typeof value.credential !== 'string' ||
			typeof value.startedAt !== 'number' ||
			!Array.isArray(value.versions)
		)
			return undefined;
		return {
			generation,
			pid: value.pid,
			buildId: value.buildId,
			versions: value.versions,
			credential: value.credential,
			// The path is derived, never trusted from the file: a record cannot
			// redirect this server to a socket outside its data root.
			socketPath: sessionHolderSocketPath(dataRoot, generation),
			startedAt: value.startedAt,
		};
	} catch {
		return undefined;
	}
}

function removeHolderFiles(dataRoot: string, generation: string): void {
	rmSync(sessionHolderRecordPath(dataRoot, generation), { force: true });
	rmSync(sessionHolderSocketPath(dataRoot, generation), { force: true });
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

const HOLDER_EXIT_TIMEOUT_MS = 5_000;

/** Resolves when a holder has removed its record, which it does last. */
function holderRecordRemoved(
	dataRoot: string,
	generation: string,
): Promise<void> {
	const recordPath = sessionHolderRecordPath(dataRoot, generation);
	return new Promise((resolve) => {
		if (!existsSync(recordPath)) {
			resolve();
			return;
		}
		const finish = (): void => {
			clearTimeout(timer);
			watcher.close();
			resolve();
		};
		const watcher = watch(sessionHolderDirectory(dataRoot), () => {
			if (!existsSync(recordPath)) finish();
		});
		// A holder that will not go is not allowed to hold start-up hostage.
		const timer = setTimeout(finish, HOLDER_EXIT_TIMEOUT_MS);
		watcher.on('error', finish);
	});
}

/** A holder is ready once its record file exists; a watch, not a poll, sees it. */
function launchHolder(
	options: SessionHolderPtyFactoryOptions,
	generation: string,
	limitMs: number | null,
): Promise<SessionHolderRecordFile> {
	const directory = sessionHolderDirectory(options.dataRoot);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const recordPath = sessionHolderRecordPath(options.dataRoot, generation);
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error): void => {
			if (settled) return;
			if (error === undefined) {
				const record = readHolderRecord(options.dataRoot, generation);
				// The record is renamed into place, so it is complete once visible.
				if (record === undefined) return;
				settled = true;
				cleanup();
				resolve(record);
				return;
			}
			settled = true;
			cleanup();
			reject(error);
		};
		const watcher = watch(directory, () => {
			if (existsSync(recordPath)) finish();
		});
		const timer = setTimeout(
			() => finish(new Error('session holder did not start')),
			options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS,
		);
		const cleanup = (): void => {
			clearTimeout(timer);
			watcher.close();
		};
		watcher.on('error', (error) => finish(error));
		try {
			options.launch({
				env: {
					[SESSION_HOLDER_ENV.dataRoot]: options.dataRoot,
					[SESSION_HOLDER_ENV.generation]: generation,
					[SESSION_HOLDER_ENV.buildId]: options.buildId,
					[SESSION_HOLDER_ENV.limitMs]:
						limitMs === null ? 'none' : String(limitMs),
				},
			});
		} catch (error) {
			finish(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		if (existsSync(recordPath)) finish();
	});
}

/** The holder names a session by the server's session id. */
function spawnSessionId(options: PtySpawnOptions): string {
	const sessionId = options.sessionId;
	if (typeof sessionId !== 'string' || sessionId.length === 0)
		throw new Error('a held terminal needs a session id');
	return sessionId;
}
