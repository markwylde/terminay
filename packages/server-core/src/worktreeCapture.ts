import { execFile } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { basename, join } from 'node:path';
import type {
	FolderReconcilerOptions,
	WorktreeAppeared,
} from './folderReconciler.js';
import { GitTraceDirectory } from './gitTraceDirectory.js';
import type {
	WorkspaceApplyResult,
	WorkspaceCommand,
	WorkspaceState,
} from './workspace.js';

/**
 * Which terminal created a worktree.
 *
 * The Git watch says a worktree appeared and nothing about who made it. The
 * answer comes from the terminal and from Git, never from an agent (ADR-0051):
 *
 * 1. Git reports its own commands. Terminay's terminals carry Git's Trace2
 *    variables, so every Git process started under one sends its argument list
 *    to a socket this server owns, tagged with a token for the terminal
 *    session (ADR-0069).
 * 2. Failing that, the process table is read once when the worktree appears,
 *    and a `git worktree add` still running there is walked up to a terminal's
 *    shell. This is a race Git can win on a small repository.
 *
 * When neither names a terminal, nobody is moved.
 */

/** Longest Trace2 line read. A longer one ends its connection. */
const MAX_TRACE_LINE_BYTES = 64 * 1024;
/** How many recent `worktree add` commands are remembered. */
const MAX_RECENT_COMMANDS = 32;
/** A command older than this did not create a worktree that appears now. */
const RECENT_COMMAND_WINDOW_MS = 120_000;

/** Options of `git worktree add` that take a value as the next argument. */
const WORKTREE_ADD_VALUE_OPTIONS = new Set(['-b', '-B', '--reason']);
/** Options of `git` itself, before the subcommand, that take a value. */
const GIT_VALUE_OPTIONS = new Set([
	'-C',
	'-c',
	'--git-dir',
	'--work-tree',
	'--namespace',
	'--exec-path',
	'--super-prefix',
	'--config-env',
]);

/**
 * Read a Git argument list as `git worktree add`. Returns the directory name of
 * the worktree being added, `null` when the list is some other command, and an
 * empty string when it is `worktree add` but the path could not be picked out.
 *
 * Agents and wrappers put options before the subcommand
 * (`git -c core.fsmonitor= -C /repo worktree add …`), so it is found after
 * them, never at a fixed position.
 */
export function worktreeAddDirectoryName(
	argv: readonly unknown[],
): string | null {
	const args = argv.filter(
		(value): value is string => typeof value === 'string',
	);
	let index = 1;
	while (index < args.length && args[index]?.startsWith('-') === true) {
		index += GIT_VALUE_OPTIONS.has(args[index] ?? '') ? 2 : 1;
	}
	if (args[index] !== 'worktree' || args[index + 1] !== 'add') return null;
	index += 2;
	while (index < args.length) {
		const arg = args[index] ?? '';
		if (arg === '--') return directoryName(args[index + 1]);
		if (!arg.startsWith('-')) return directoryName(arg);
		index += WORKTREE_ADD_VALUE_OPTIONS.has(arg) ? 2 : 1;
	}
	return '';
}

function directoryName(path: string | undefined): string {
	if (path === undefined) return '';
	return basename(path.replace(/[\\/]+$/, ''));
}

/**
 * What capture saw and decided, for diagnostics. It names the project and how
 * many commands and sessions were weighed, never a path, a directory name, or
 * a token, so it can be logged as it is.
 */
export type WorktreeCaptureReport =
	| {
			/** Whether the Git command socket is listening, and where it is. */
			readonly kind: 'stream.listening';
			readonly listening: boolean;
			/** A fixed address survives a restart; a per-run one does not. */
			readonly placement: GitCommandSocketPlacement;
	  }
	| {
			/** Sessions kept across a restart whose tokens were registered again. */
			readonly kind: 'sessions.adopted';
			readonly count: number;
	  }
	| {
			/** Git reported a `worktree add`. */
			readonly kind: 'command.reported';
			/** Whether its token belongs to a live terminal of this server. */
			readonly attributed: boolean;
			/** Whether the worktree's directory could be read from its arguments. */
			readonly pathRead: boolean;
	  }
	| {
			/** A worktree's folder was made. */
			readonly kind: 'folder.appeared';
			readonly projectId: string;
			/** False on the project's first pass, where nobody is ever moved. */
			readonly announced: boolean;
			readonly creator: boolean;
			readonly created: boolean;
	  }
	| {
			/** Who created a worktree that appeared. */
			readonly kind: 'creator.resolved';
			readonly projectId: string;
			readonly source: 'trace2' | 'process-table' | 'none';
			/** Commands remembered when the worktree appeared, before expiry. */
			readonly remembered: number;
			/** Of those, how many were older than the window and dropped. */
			readonly expired: number;
			/** Unexpired commands from this project's terminals. */
			readonly ofProject: number;
			/** Of those, how many named this directory, and how many named none. */
			readonly named: number;
			readonly unnamed: number;
			/** Distinct sessions behind the candidate commands; one is required. */
			readonly candidateSessions: number;
			/** Age of the newest command naming this directory, from any project. */
			readonly newestNamedAgeMs: number | null;
			/** Live shells of the project, when the process table was read. */
			readonly shells: number | null;
			/** Whether the creating session still has a terminal panel here. */
			readonly panel: boolean;
	  }
	| {
			readonly kind: 'capture.decided';
			readonly projectId: string;
			readonly outcome:
				| 'moved'
				| 'offered'
				| 'refused'
				| 'no-panel'
				| 'no-folder'
				| 'other-project'
				| 'already-there';
	  };

/** Where the Git command socket lives (ADR-0069). */
export type GitCommandSocketPlacement =
	| 'data-directory'
	| 'runtime-directory'
	| 'per-run'
	/** Windows: a directory Git writes one file per process into (ADR-0082). */
	| 'trace-directory';

/** The key file's name in the data directory. */
export const GIT_TRACE_KEY_FILENAME = 'git-trace.key';
const GIT_TRACE_KEY_BYTES = 32;

/**
 * The key a data directory's tokens are derived from (ADR-0069), created once
 * and readable only by its owner. A missing or malformed file is replaced: the
 * cost is that terminals kept from before are not recognised until reopened,
 * never that one is mistaken for another.
 */
export function loadGitTraceKey(dataDirectory: string): Buffer {
	const path = join(dataDirectory, GIT_TRACE_KEY_FILENAME);
	try {
		const key = readFileSync(path);
		if (key.length === GIT_TRACE_KEY_BYTES) return key;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	const key = randomBytes(GIT_TRACE_KEY_BYTES);
	writeFileSync(path, key, { mode: 0o600 });
	chmodSync(path, 0o600);
	return key;
}

/**
 * A session's token: the same for the same session under the same key, so a
 * server that re-adopts a terminal recognises the token its shell was given by
 * an earlier run. Without the key it cannot be predicted.
 */
export function gitTraceTokenFor(
	key: Uint8Array,
): (sessionId: string) => string {
	return (sessionId) =>
		`terminay-${createHmac('sha256', key).update(sessionId).digest('hex').slice(0, 24)}`;
}

export interface GitCommandStreamOptions {
	/** A Unix socket path the server owns. It must be short: socket paths are
	 * capped near 104 bytes. */
	readonly socketPath: string;
	/** Windows: the directory Git writes its events into instead of a socket,
	 * which Node cannot serve there (ADR-0082). Named, it replaces the socket. */
	readonly traceDirectory?: string;
	/** Close the trace directory to other users once it exists; false leaves
	 * Git unreported. */
	readonly prepareTraceDirectory?: (path: string) => boolean;
	readonly onWorktreeAdd: (command: {
		readonly sessionId: string;
		readonly directoryName: string;
	}) => void;
	/** The token for a session. Must give the same token for the same session
	 * on every run that should recognise it (ADR-0069). */
	readonly tokenFor: (sessionId: string) => string;
	readonly onObservation?: (report: WorktreeCaptureReport) => void;
}

/**
 * The socket Git's Trace2 events arrive on.
 *
 * Whatever is written here is untrusted: any process on the machine that can
 * reach the socket can write to it. A line can only say that a session ran a
 * command; it never supplies a path, a project, or a folder to act on, and a
 * token this server did not issue is ignored. Nothing is kept: each line is
 * parsed and dropped as it arrives, so memory does not grow with Git activity.
 */
export class GitCommandStream {
	private readonly tokens = new Map<string, string>();
	private readonly sessions = new Map<string, string>();
	private readonly connections = new Set<Socket>();
	private server: Server | undefined;
	private directory: GitTraceDirectory | undefined;

	constructor(private readonly options: GitCommandStreamOptions) {}

	private get listening(): boolean {
		return this.server !== undefined || this.directory?.listening === true;
	}

	/** Start listening. Resolves false, leaving terminals unreported, when the
	 * socket cannot be created. */
	listen(): Promise<boolean> {
		if (this.listening) return Promise.resolve(true);
		const traceDirectory = this.options.traceDirectory;
		if (traceDirectory !== undefined) {
			this.directory = new GitTraceDirectory({
				path: traceDirectory,
				maxLineBytes: MAX_TRACE_LINE_BYTES,
				onLine: (line) => this.line(line),
				...(this.options.prepareTraceDirectory === undefined
					? {}
					: { prepare: this.options.prepareTraceDirectory }),
			});
			return Promise.resolve(this.directory.start());
		}
		return new Promise((resolve) => {
			try {
				rmSync(this.options.socketPath, { force: true });
			} catch {
				// A stale socket that cannot be removed fails the listen below.
			}
			const server = createServer((connection) => this.accept(connection));
			server.once('error', () => resolve(false));
			server.listen(this.options.socketPath, () => {
				// Only this user's processes have any business writing here.
				try {
					chmodSync(this.options.socketPath, 0o600);
				} catch {
					// What arrives is untrusted either way.
				}
				server.removeAllListeners('error');
				server.on('error', () => undefined);
				this.server = server;
				resolve(true);
			});
		});
	}

	/**
	 * The environment that makes Git in one terminal session report here, or
	 * nothing when the stream is not listening or the terminal's environment
	 * already names a Trace2 target of the user's own.
	 */
	environmentFor(
		sessionId: string,
		existing: Readonly<Record<string, string | undefined>> = {},
	): Readonly<Record<string, string>> {
		if (!this.listening) return {};
		if (
			existing.GIT_TRACE2_EVENT !== undefined ||
			existing.GIT_TRACE2 !== undefined ||
			existing.GIT_TRACE2_PERF !== undefined
		)
			return {};
		const token = this.register(sessionId);
		return {
			GIT_TRACE2_EVENT:
				this.options.traceDirectory ??
				`af_unix:stream:${this.options.socketPath}`,
			GIT_TRACE2_EVENT_BRIEF: '1',
			GIT_TRACE2_EVENT_NESTING: '1',
			GIT_TRACE2_PARENT_SID: token,
		};
	}

	/**
	 * Recognise sessions kept across a restart. Their shells were given their
	 * tokens by an earlier run; the same derivation gives the same tokens.
	 */
	adopt(sessionIds: Iterable<string>): void {
		let count = 0;
		for (const sessionId of sessionIds) {
			this.register(sessionId);
			count += 1;
		}
		this.options.onObservation?.({ kind: 'sessions.adopted', count });
	}

	private register(sessionId: string): string {
		let token = this.sessions.get(sessionId);
		if (token === undefined) {
			token = this.options.tokenFor(sessionId);
			this.sessions.set(sessionId, token);
			this.tokens.set(token, sessionId);
		}
		return token;
	}

	/** Forget a terminal session that has ended. */
	release(sessionId: string): void {
		const token = this.sessions.get(sessionId);
		if (token === undefined) return;
		this.sessions.delete(sessionId);
		this.tokens.delete(token);
	}

	/** How many sessions hold a token; for asserting nothing leaks. */
	get sessionCount(): number {
		return this.sessions.size;
	}

	/** Files of the trace directory still being read; for asserting nothing
	 * accumulates. Zero for a socket. */
	get openTraceFiles(): number {
		return this.directory?.openFiles ?? 0;
	}

	close(): void {
		for (const connection of this.connections) connection.destroy();
		this.connections.clear();
		this.server?.close();
		this.server = undefined;
		this.directory?.stop();
		this.directory = undefined;
		if (this.options.traceDirectory !== undefined) return;
		try {
			rmSync(this.options.socketPath, { force: true });
		} catch {
			// Nothing depends on the path once the server is closed.
		}
	}

	private accept(connection: Socket): void {
		this.connections.add(connection);
		// Only the line being assembled is held, and only up to the bound.
		let pending = '';
		connection.setEncoding('utf8');
		connection.on('data', (chunk: string) => {
			pending += chunk;
			for (
				let newline = pending.indexOf('\n');
				newline >= 0;
				newline = pending.indexOf('\n')
			) {
				this.line(pending.slice(0, newline));
				pending = pending.slice(newline + 1);
			}
			if (pending.length > MAX_TRACE_LINE_BYTES) connection.destroy();
		});
		connection.on('error', () => undefined);
		connection.on('close', () => {
			this.connections.delete(connection);
		});
	}

	private line(line: string): void {
		if (line.length === 0 || line.length > MAX_TRACE_LINE_BYTES) return;
		// Most events are not a command start; skip them without parsing.
		if (!line.includes('"start"')) return;
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		if (typeof event !== 'object' || event === null) return;
		const { event: kind, sid, argv } = event as Record<string, unknown>;
		if (kind !== 'start' || typeof sid !== 'string' || !Array.isArray(argv))
			return;
		const directory = worktreeAddDirectoryName(argv);
		if (directory === null) return;
		// A child Git process extends its parent's id with `/`; the terminal's
		// token is always the first part.
		const sessionId = this.tokens.get(sid.split('/', 1)[0] ?? '');
		this.options.onObservation?.({
			kind: 'command.reported',
			attributed: sessionId !== undefined,
			pathRead: directory !== '',
		});
		if (sessionId === undefined) return;
		this.options.onWorktreeAdd({ sessionId, directoryName: directory });
	}
}

/** One row of the process table. */
export interface ProcessRow {
	readonly pid: number;
	readonly ppid: number;
	readonly command: string;
}

/** Read the process table once. One spawn, on an event, never on a timer. */
export function readProcessTable(
	platform: NodeJS.Platform = process.platform,
): Promise<ProcessRow[]> {
	const args =
		platform === 'linux'
			? ['-eo', 'pid=,ppid=,args=']
			: ['-axo', 'pid=,ppid=,command='];
	return new Promise((resolve) => {
		execFile(
			'ps',
			args,
			{ maxBuffer: 16 * 1024 * 1024, timeout: 5_000 },
			(error, stdout) => {
				if (error !== null) {
					resolve([]);
					return;
				}
				resolve(parseProcessTable(stdout));
			},
		);
	});
}

export function parseProcessTable(output: string): ProcessRow[] {
	const rows: ProcessRow[] = [];
	for (const line of output.split('\n')) {
		const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
		if (match === null) continue;
		rows.push({
			pid: Number(match[1]),
			ppid: Number(match[2]),
			command: match[3] ?? '',
		});
	}
	return rows;
}

/**
 * The terminal session whose shell a running `git worktree add` for this
 * directory descends from, when exactly one does.
 */
export function sessionRunningWorktreeAdd(
	rows: readonly ProcessRow[],
	shells: ReadonlyMap<number, string>,
	directory: string,
): string | undefined {
	const parents = new Map(rows.map((row) => [row.pid, row.ppid]));
	const found = new Set<string>();
	for (const row of rows) {
		if (!/(^|[\\/\s])git(\.exe)?\s/.test(`${row.command} `)) continue;
		// The command line is one string here, so it is split on spaces. A path
		// containing a space is read wrongly and simply fails to match.
		const name = worktreeAddDirectoryName([
			'git',
			...row.command.split(/\s+/).slice(1),
		]);
		if (name === null || (name !== '' && name !== directory)) continue;
		let pid = row.pid;
		for (let hops = 0; hops < 64 && pid > 1; hops += 1) {
			const sessionId = shells.get(pid);
			if (sessionId !== undefined) {
				found.add(sessionId);
				break;
			}
			pid = parents.get(pid) ?? 0;
		}
	}
	return found.size === 1 ? [...found][0] : undefined;
}

export interface WorktreeCaptureOptions {
	readonly workspace: () => WorkspaceState;
	readonly apply: (
		commandId: string,
		command: WorkspaceCommand,
	) => WorkspaceApplyResult;
	/** Whether a terminal that created a worktree is moved into its folder
	 * (true) or only offered the move (false). Read each time. */
	readonly moveAutomatically: () => boolean;
	/** The shell process of each live terminal session of a project. */
	readonly shells: (projectId: string) => ReadonlyMap<number, string>;
	readonly processTable?: () => Promise<readonly ProcessRow[]>;
	/** Announce a committed capture so clients can offer Undo. */
	readonly onCaptured?: (captured: {
		readonly projectId: string;
		readonly folderId: string;
		readonly panelId: string;
		readonly fromFolderId: string;
	}) => void;
	readonly onObservation?: (report: WorktreeCaptureReport) => void;
	readonly now?: () => number;
}

interface RecentCommand {
	readonly sessionId: string;
	readonly directoryName: string;
	readonly at: number;
}

/**
 * Decides which panel created a worktree that just appeared, and what to do
 * about it.
 */
export class WorktreeCapture {
	private recent: RecentCommand[] = [];
	private serial = 0;
	private readonly now: () => number;

	constructor(private readonly options: WorktreeCaptureOptions) {
		this.now = options.now ?? (() => Date.now());
	}

	/** Record a `git worktree add` a terminal session ran. Bounded: the oldest
	 * entries are dropped, and none is kept once it has been used. */
	noteWorktreeAdd(command: {
		readonly sessionId: string;
		readonly directoryName: string;
	}): void {
		this.recent.push({ ...command, at: this.now() });
		if (this.recent.length > MAX_RECENT_COMMANDS)
			this.recent = this.recent.slice(-MAX_RECENT_COMMANDS);
	}

	/** How many commands are remembered; for asserting the bound. */
	get rememberedCommands(): number {
		return this.recent.length;
	}

	/**
	 * The panel whose terminal created a worktree, for a reconciler to record on
	 * the new folder. Undefined when no terminal of the project is established.
	 */
	async creatorOf(appeared: {
		readonly projectId: string;
		readonly worktree: { readonly path: string };
	}): Promise<string | undefined> {
		const directory = basename(appeared.worktree.path);
		const reported = this.reportedCreator(appeared.projectId, directory);
		const running =
			reported.sessionId === undefined
				? await this.runningCreator(appeared.projectId, directory)
				: { sessionId: undefined, shells: null };
		const sessionId = reported.sessionId ?? running.sessionId;
		const state = this.options.workspace();
		const panelId =
			sessionId === undefined
				? undefined
				: Object.values(state.panels).find(
						(panel) =>
							panel.type === 'terminal' &&
							panel.sessionId === sessionId &&
							panel.projectId === appeared.projectId,
					)?.id;
		this.options.onObservation?.({
			kind: 'creator.resolved',
			projectId: appeared.projectId,
			source:
				reported.sessionId !== undefined
					? 'trace2'
					: running.sessionId !== undefined
						? 'process-table'
						: 'none',
			...reported.weighed,
			shells: running.shells,
			panel: panelId !== undefined,
		});
		return panelId;
	}

	/** Move the creating terminal into the new folder, or offer to. */
	capture(appeared: WorktreeAppeared & { readonly panelId: string }): void {
		const state = this.options.workspace();
		const panel = state.panels[appeared.panelId];
		const folder = state.folders[appeared.folderId];
		const decided = (
			outcome: Extract<
				WorktreeCaptureReport,
				{ kind: 'capture.decided' }
			>['outcome'],
		) =>
			this.options.onObservation?.({
				kind: 'capture.decided',
				projectId: appeared.projectId,
				outcome,
			});
		const skipped =
			panel === undefined
				? 'no-panel'
				: folder === undefined
					? 'no-folder'
					: panel.projectId !== appeared.projectId
						? 'other-project'
						: panel.folderId === folder.id
							? 'already-there'
							: undefined;
		if (skipped !== undefined || panel === undefined || folder === undefined) {
			decided(skipped ?? 'no-panel');
			return;
		}
		if (!this.options.moveAutomatically()) {
			const offered = this.apply({
				type: 'folder.offer.set',
				folderId: folder.id,
				panelId: panel.id,
			});
			decided(offered.ok ? 'offered' : 'refused');
			return;
		}
		const fromFolderId = panel.folderId;
		const moved = this.apply({
			type: 'panel.moveToFolder',
			panelId: panel.id,
			folderId: folder.id,
		});
		decided(moved.ok ? 'moved' : 'refused');
		if (moved.ok)
			this.options.onCaptured?.({
				projectId: appeared.projectId,
				folderId: folder.id,
				panelId: panel.id,
				fromFolderId,
			});
	}

	/** From Git's own report: the one session of this project that recently ran
	 * `worktree add` for this directory. */
	private reportedCreator(
		projectId: string,
		directory: string,
	): {
		readonly sessionId: string | undefined;
		readonly weighed: Pick<
			Extract<WorktreeCaptureReport, { kind: 'creator.resolved' }>,
			| 'remembered'
			| 'expired'
			| 'ofProject'
			| 'named'
			| 'unnamed'
			| 'candidateSessions'
			| 'newestNamedAgeMs'
		>;
	} {
		const now = this.now();
		const cutoff = now - RECENT_COMMAND_WINDOW_MS;
		const remembered = this.recent.length;
		const newestNamed = this.recent
			.filter((command) => command.directoryName === directory)
			.reduce<number | null>(
				(newest, command) =>
					newest === null || command.at > newest ? command.at : newest,
				null,
			);
		this.recent = this.recent.filter((command) => command.at >= cutoff);
		const sessions = this.options.workspace().terminalSessions;
		const mine = this.recent.filter(
			(command) => sessions[command.sessionId]?.projectId === projectId,
		);
		// A command whose path could not be read matches any directory, but only
		// when nothing names this directory outright.
		const named = mine.filter((command) => command.directoryName === directory);
		const candidates =
			named.length > 0
				? named
				: mine.filter((command) => command.directoryName === '');
		const sessionIds = new Set(candidates.map((command) => command.sessionId));
		const weighed = {
			remembered,
			expired: remembered - this.recent.length,
			ofProject: mine.length,
			named: named.length,
			unnamed: mine.filter((command) => command.directoryName === '').length,
			candidateSessions: sessionIds.size,
			newestNamedAgeMs: newestNamed === null ? null : now - newestNamed,
		};
		if (sessionIds.size !== 1) return { sessionId: undefined, weighed };
		// Used once: the same command never explains a second worktree.
		this.recent = this.recent.filter(
			(command) => !candidates.includes(command),
		);
		return { sessionId: [...sessionIds][0], weighed };
	}

	/** From the process table: a `git worktree add` still running. */
	private async runningCreator(
		projectId: string,
		directory: string,
	): Promise<{ sessionId: string | undefined; shells: number }> {
		const shells = this.options.shells(projectId);
		if (shells.size === 0) return { sessionId: undefined, shells: 0 };
		const rows = await (this.options.processTable ?? readProcessTable)();
		return {
			sessionId: sessionRunningWorktreeAdd(rows, shells, directory),
			shells: shells.size,
		};
	}

	private apply(command: WorkspaceCommand): WorkspaceApplyResult {
		this.serial += 1;
		return this.options.apply(`capture:${this.serial}`, command);
	}
}

/** A live terminal session, as the terminal service reports it. */
export interface CaptureTerminalSession {
	readonly sessionId: string;
	readonly projectId: string;
	readonly pid?: number;
	readonly status: string;
}

export interface WorktreeCaptureHostOptions {
	readonly socketPath: string;
	/** Windows: Git's events go to this directory, not to `socketPath`. */
	readonly traceDirectory?: string;
	/** Close `traceDirectory` to other users; false leaves Git unreported. */
	readonly prepareTraceDirectory?: (path: string) => boolean;
	/** Where `socketPath` is, for diagnostics. `per-run` when absent. */
	readonly socketPlacement?: GitCommandSocketPlacement;
	/** Make the socket's directory fit to use; false leaves Git unreported. */
	readonly prepareSocket?: () => Promise<boolean>;
	/** The data directory's key (`loadGitTraceKey`). Absent, tokens last one
	 * run, which is right for a server with no terminals that outlive it. */
	readonly tokenKey?: Uint8Array;
	readonly workspace: () => WorkspaceState;
	readonly apply: WorktreeCaptureOptions['apply'];
	readonly moveAutomatically: () => boolean;
	readonly sessions: () => readonly CaptureTerminalSession[];
	readonly onCaptured?: WorktreeCaptureOptions['onCaptured'];
	readonly processTable?: WorktreeCaptureOptions['processTable'];
	readonly onObservation?: (report: WorktreeCaptureReport) => void;
}

/**
 * Everything a host needs to capture a terminal into the folder of a worktree
 * it created: the stream Git reports to, the decision, and the two hooks a
 * `FolderReconciler` calls. Both hosts wire the same thing.
 */
export function createWorktreeCaptureHost(
	options: WorktreeCaptureHostOptions,
): {
	/** Pass to the server composition so launched terminals report here. */
	readonly gitCommands: GitCommandStream;
	readonly capture: WorktreeCapture;
	/** Spread into the folder reconciler's options. */
	readonly reconcilerHooks: Pick<
		FolderReconcilerOptions,
		'creatorOf' | 'onWorktreeAppeared' | 'onWorktreeFolder'
	>;
	/** Start listening. A host that cannot listen still captures through the
	 * process lookup. */
	readonly start: () => Promise<boolean>;
	readonly close: () => void;
} {
	const capture = new WorktreeCapture({
		workspace: options.workspace,
		apply: options.apply,
		moveAutomatically: options.moveAutomatically,
		shells: (projectId) =>
			new Map(
				options
					.sessions()
					.filter(
						(session) =>
							session.projectId === projectId &&
							session.status === 'running' &&
							session.pid !== undefined,
					)
					.map((session) => [session.pid as number, session.sessionId]),
			),
		...(options.onCaptured === undefined
			? {}
			: { onCaptured: options.onCaptured }),
		...(options.processTable === undefined
			? {}
			: { processTable: options.processTable }),
		...(options.onObservation === undefined
			? {}
			: { onObservation: options.onObservation }),
	});
	const gitCommands = new GitCommandStream({
		socketPath: options.socketPath,
		...(options.traceDirectory === undefined
			? {}
			: { traceDirectory: options.traceDirectory }),
		...(options.prepareTraceDirectory === undefined
			? {}
			: { prepareTraceDirectory: options.prepareTraceDirectory }),
		onWorktreeAdd: (command) => capture.noteWorktreeAdd(command),
		tokenFor: gitTraceTokenFor(
			options.tokenKey ?? randomBytes(GIT_TRACE_KEY_BYTES),
		),
		...(options.onObservation === undefined
			? {}
			: { onObservation: options.onObservation }),
	});
	return {
		gitCommands,
		capture,
		reconcilerHooks: {
			creatorOf: (appeared) => capture.creatorOf(appeared),
			onWorktreeAppeared: (appeared) => {
				if (appeared.createdByPanelId !== undefined)
					capture.capture({ ...appeared, panelId: appeared.createdByPanelId });
			},
			onWorktreeFolder: (folder) =>
				options.onObservation?.({ kind: 'folder.appeared', ...folder }),
		},
		start: async () => {
			const prepared = (await options.prepareSocket?.()) ?? true;
			const listening = prepared && (await gitCommands.listen());
			options.onObservation?.({
				kind: 'stream.listening',
				listening,
				placement: options.socketPlacement ?? 'per-run',
			});
			return listening;
		},
		close: () => gitCommands.close(),
	};
}
