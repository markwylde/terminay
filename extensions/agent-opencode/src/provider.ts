import {
	type AgentFileWatchChunk,
	type AgentFileWatcher,
	type AgentObservationResult,
	type AgentRecordContext,
	type AgentTerminalContext,
	defineAgentProvider,
	jsonlSession,
} from '@terminay/extension-api';
import {
	emptyState,
	mapOpenCodeEvent,
	type OpenCodeMapState,
} from './mapping.js';
import {
	effectiveOpenCodeRoot,
	isOpenCodeForeground,
	LIMITS,
	type OpenCodeSessionRow,
	OpenCodeStore,
	safeStorePath,
	storePathFor,
} from './store.js';

/** OpenCode `--session` / `-s` names the restored root when present. */
export function openCodeSessionId(
	arguments_: readonly string[] | undefined,
): string | undefined {
	if (!arguments_) return undefined;
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (typeof argument !== 'string') continue;
		const inline = /^(?:--session|-s)=(.*)$/u.exec(argument)?.[1];
		if (inline) return inline || undefined;
		if (argument === '--session' || argument === '-s') {
			const next = arguments_[index + 1];
			return typeof next === 'string' && next.length > 0 ? next : undefined;
		}
	}
	return undefined;
}

/** OpenCode `--continue` / `-c` reopens the directory's newest session. */
export function openCodeContinues(
	arguments_: readonly string[] | undefined,
): boolean {
	return (arguments_ ?? []).some(
		(argument) =>
			typeof argument === 'string' &&
			/^(?:--continue|-c)(?:=.*)?$/u.test(argument),
	);
}

export const PROVIDER_ID = 'com.terminay.agent.opencode/cli';
const MAPPING_VERSION = '0.1';
const POLL_INTERVAL_MS = 250;

export const ROOT_SELECTION = {
	/**
	 * A process start time is only ever proven to whole seconds on some
	 * platforms (`ps -o lstart`), and it never postdates the real start, so a
	 * session this process created can read as up to a second older than it.
	 */
	clockToleranceMs: 1_000,
	/**
	 * OpenCode writes no session row when a TUI opens: the row appears when the
	 * first prompt is submitted, about two to three seconds after launch in
	 * practice. Until then a freshly launched CLI and a CLI that reopened an
	 * older session look identical from the store. Within this window a launch
	 * is assumed to be making its own session and no older root is adopted;
	 * past it, the only remaining reading is that this process reopened one.
	 */
	newSessionGraceMs: 30_000,
} as const;

/**
 * Which parentless root in a directory belongs to the CLI running in this
 * terminal.
 *
 * The rule cannot be "the most recently updated root in the directory": two
 * terminals in one repository is the ordinary case, and that rule hands both
 * of them whichever session typed last. A session is created when its first
 * prompt is submitted, which is always after its own process started, so a
 * root created before this process existed was made by some other terminal
 * and is never this one's.
 *
 * The earliest root created after the process started is preferred, not the
 * latest: a second terminal starting later also creates a root that passes the
 * time test, and taking the earliest keeps each terminal on the session it
 * opened with rather than drifting onto a neighbour's newer one.
 */
export function selectOpenCodeRoot(
	roots: readonly OpenCodeSessionRow[],
	options: {
		requested?: string;
		/** True only when `--continue` was proven on the CLI's arguments. */
		continuing?: boolean;
		/** The root this same terminal was last bound to, if any. */
		remembered?: string;
		/** Epoch milliseconds the CLI process started, when the environment proves it. */
		startedAt?: number;
		now: number;
	},
): OpenCodeSessionRow | undefined {
	if (options.requested)
		return roots.find((root) => root.id === options.requested);
	const mostRecentlyUpdated = [...roots].sort(
		(a, b) => b.timeUpdated - a.timeUpdated,
	)[0];
	const remembered = options.remembered
		? roots.find((root) => root.id === options.remembered)
		: undefined;
	// `--continue` is OpenCode's own "newest session in this directory", so when
	// the arguments prove it the provider follows the same rule the CLI used.
	if (options.continuing) return mostRecentlyUpdated;
	// Without a proven start there is no way to tell this process's row from a
	// neighbour's; the terminal's last root is the only exact fact left.
	if (options.startedAt === undefined) return remembered;
	const own = [...roots]
		.filter(
			(root) =>
				root.timeCreated >=
				(options.startedAt ?? 0) - ROOT_SELECTION.clockToleranceMs,
		)
		.sort((a, b) => a.timeCreated - b.timeCreated)[0];
	if (own) return own;
	// Still inside the window in which this process would write its own row:
	// binding an older root here is what makes two terminals share one session.
	if (options.now - options.startedAt < ROOT_SELECTION.newSessionGraceMs)
		return undefined;
	// Otherwise this process reopened a session it did not name where the
	// environment could see it. The session this terminal last had is the one
	// reading it back. "Newest in the directory" is never used here: it is the
	// live session of whichever neighbour typed last.
	return remembered;
}

/**
 * The last root each terminal was bound to, keyed by the PTY device the CLI
 * holds open. The device is stable for the life of a terminal and distinct
 * between terminals, which is exactly the identity a rebind needs; the map is
 * bounded so a long-lived host cannot grow it without limit.
 */
const REMEMBERED_ROOTS = new Map<string, string>();
const REMEMBERED_LIMIT = 256;

/** The terminal device the observed processes share, when one is visible. */
export function terminalDeviceKey(
	files: readonly { path: string }[],
): string | undefined {
	const devices = [
		...new Set(
			files
				.map((file) => file.path)
				.filter((path) => /^\/dev\/(?:pts\/\d+|tty[a-z0-9]*)$/u.test(path)),
		),
	].sort();
	return devices.length > 0 ? devices.join(',') : undefined;
}

export function rememberOpenCodeRoot(key: string, rootId: string): void {
	REMEMBERED_ROOTS.delete(key);
	REMEMBERED_ROOTS.set(key, rootId);
	while (REMEMBERED_ROOTS.size > REMEMBERED_LIMIT) {
		const oldest = REMEMBERED_ROOTS.keys().next();
		if (oldest.done) break;
		REMEMBERED_ROOTS.delete(oldest.value);
	}
}

export function rememberedOpenCodeRoot(key: string): string | undefined {
	return REMEMBERED_ROOTS.get(key);
}

/**
 * The directories OpenCode is running in below this terminal, each with the
 * earliest start time proven for a CLI process in it.
 */
export function openCodeWorkingDirectories(
	processes: readonly {
		executableName: string;
		cwd?: string;
		startedAt?: string;
	}[],
): Map<string, number | undefined> {
	const directories = new Map<string, number | undefined>();
	for (const process of processes) {
		if (!isOpenCodeForeground(process.executableName) || !process.cwd) continue;
		const parsed = process.startedAt
			? Date.parse(process.startedAt)
			: Number.NaN;
		const startedAt = Number.isFinite(parsed) ? parsed : undefined;
		if (!directories.has(process.cwd)) {
			directories.set(process.cwd, startedAt);
			continue;
		}
		const existing = directories.get(process.cwd);
		// An unproven start time on any one process leaves the directory
		// unproven: the rule must never be applied to a guess.
		if (startedAt === undefined) directories.set(process.cwd, undefined);
		else if (existing !== undefined && startedAt < existing)
			directories.set(process.cwd, startedAt);
	}
	return directories;
}

/**
 * OpenCode keeps its state in a SQLite store rather than a JSONL journal, so
 * this provider drives its own bounded polling loop over the store's
 * append-only `event` table instead of using the shared JSONL session helper.
 * The store is only ever opened read-only.
 */
export const openCodeProvider = defineAgentProvider({
	mappingVersion: MAPPING_VERSION,

	matchesForeground(process) {
		return isOpenCodeForeground(process.executableName);
	},

	async observe(
		terminal: AgentTerminalContext,
	): Promise<AgentObservationResult> {
		if (
			!terminal.capabilities.has('process-observation') ||
			!terminal.capabilities.has('filesystem-observation') ||
			!terminal.capabilities.has('agent-journal')
		) {
			return { state: 'unavailable', reason: 'environment-capability-missing' };
		}
		const descendants = await terminal.observation.processes.descendants({
			signal: terminal.signal,
		});
		const writers = await terminal.observation.processes.openFiles(
			descendants,
			{
				access: 'writable',
				signal: terminal.signal,
			},
		);
		let dataRoot: string | undefined;
		try {
			const environment = await terminal.observation.processes.environment(
				['XDG_DATA_HOME'],
				{ signal: terminal.signal },
			);
			dataRoot = effectiveOpenCodeRoot(environment as NodeJS.ProcessEnv);
		} catch {
			dataRoot = effectiveOpenCodeRoot();
		}

		const directories = openCodeWorkingDirectories(descendants);
		if (directories.size === 0) return { state: 'not-bound' };
		const now = Date.now();
		const device = terminalDeviceKey(writers);
		const remembered = device ? rememberedOpenCodeRoot(device) : undefined;

		for (const file of writers) {
			const candidate = storePathFor(file.path);
			if (!candidate) continue;
			const path = await safeStorePath(candidate, dataRoot);
			if (!path) continue;
			const store = new OpenCodeStore(path);
			try {
				// The CLI's flags come from the `opencode` process's own command
				// line — per-process evidence — and only failing that from the
				// foreground summary the host issued.
				const argv =
					descendants.find(
						(process) =>
							isOpenCodeForeground(process.executableName) &&
							process.arguments !== undefined &&
							process.arguments.length > 0,
					)?.arguments ?? terminal.foreground.arguments;
				const requested = openCodeSessionId(argv);
				const continuing = openCodeContinues(argv);
				const root = [...directories]
					.flatMap((entry): OpenCodeSessionRow[] => {
						const chosen = selectOpenCodeRoot(
							store.rootsForDirectory(entry[0]),
							{
								...(requested ? { requested } : {}),
								...(continuing ? { continuing } : {}),
								...(remembered ? { remembered } : {}),
								...(entry[1] === undefined ? {} : { startedAt: entry[1] }),
								now,
							},
						);
						return chosen ? [chosen] : [];
					})
					.sort((a, b) => b.timeUpdated - a.timeUpdated)[0];
				if (!root) {
					store.close();
					continue;
				}
				if (device) rememberOpenCodeRoot(device, root.id);
				const binding = await terminal.bindSession({
					providerSessionId: root.id,
					mappingVersion: MAPPING_VERSION,
					fingerprint: {
						kind: 'writable-session-store-below-terminal-process',
						file: file.handle,
					},
				});
				return jsonlSession({
					binding,
					source: storeWatcher(terminal, store, root.id),
					mapRecord: createOpenCodeRecordMapper(root.id),
				});
			} catch {
				store.close();
			}
		}
		return { state: 'not-bound' };
	},
});

/**
 * The store has no journal to follow, so its append-only `event` rows are
 * re-encoded as JSONL lines. That lets OpenCode use the host's existing record
 * pipeline — replay limits, flow control and validation — rather than a second
 * observation loop of its own.
 */
export interface OpenCodeRecord {
	readonly __opencode: 1;
	readonly type: string;
	readonly data: string;
}

const encoder = new TextEncoder();

export function storeWatcher(
	terminal: AgentTerminalContext,
	store: OpenCodeStore,
	rootId: string,
	pollMs = POLL_INTERVAL_MS,
): AgentFileWatcher {
	let closed = false;
	async function* iterate(): AsyncGenerator<AgentFileWatchChunk> {
		const cursors = new Map<string, number>([[rootId, -1]]);
		try {
			while (!closed && !terminal.signal.aborted) {
				// A child is admitted only because its own `parent_id` names this
				// root; nothing else in the sessions table is followed.
				for (const child of store.childrenOf(rootId)) {
					if (!cursors.has(child.id)) cursors.set(child.id, -1);
				}
				const lines: string[] = [];
				for (const [aggregateId, cursor] of [...cursors]) {
					for (const event of store.eventsAfter(aggregateId, cursor)) {
						cursors.set(aggregateId, event.seq);
						const record: OpenCodeRecord = {
							__opencode: 1,
							type: event.type,
							data: event.data,
						};
						lines.push(JSON.stringify(record));
					}
				}
				if (lines.length > 0) {
					yield {
						type: 'append',
						bytes: encoder.encode(`${lines.join('\n')}\n`),
					};
					continue;
				}
				await delay(pollMs);
			}
		} finally {
			store.close();
		}
	}
	return {
		[Symbol.asyncIterator]: iterate,
		async dispose() {
			closed = true;
			store.close();
		},
	};
}

export function createOpenCodeRecordMapper(
	rootId: string,
): (record: unknown, session: AgentRecordContext) => void {
	const state: OpenCodeMapState = emptyState();
	return (record, session) => {
		const envelope =
			typeof record === 'object' && record !== null
				? (record as Partial<OpenCodeRecord>)
				: undefined;
		if (envelope?.__opencode !== 1) return;
		if (typeof envelope.type !== 'string' || typeof envelope.data !== 'string')
			return;
		mapOpenCodeEvent(envelope.type, envelope.data, {
			publish: session.publish,
			rootId,
			state,
		});
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		// Never hold the process open: a bound session idles for long stretches.
		const timer = setTimeout(resolve, ms);
		(timer as { unref?: () => void }).unref?.();
	});
}

export { LIMITS };
