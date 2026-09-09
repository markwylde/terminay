import type {
	AgentChildJournalSource,
	AgentDirectoryHandle,
	AgentDiscoveredFile,
	AgentFileHandle,
	AgentFileWatchChunk,
	AgentFileWatcher,
	AgentForegroundProcess,
	AgentObservationResult,
	AgentProcessSnapshot,
	AgentTerminalContext,
} from '@terminay/extension-api';
import {
	defineAgentProvider,
	jsonlSession,
	safeAgentString,
} from '@terminay/extension-api';
import {
	CONVERSATION_SWITCH_RECORD,
	createClaudeRecordMapper,
	sessionIdleRecord,
} from './mapping.js';
import { withQuiescence } from './quiescence.js';
import {
	claudeProjectDirectoryPath,
	claudeProjectJournalPath,
} from './resume.js';

export const PROVIDER_ID = 'com.terminay.agent.claude-code/cli';
const CLAUDE_PROJECTS = '.claude/projects';
const CLAUDE_SESSIONS = '.claude/sessions';
const MAX_HEADER_BYTES = 64 * 1024;
/** The session file is one small flat object; nothing larger is ever read. */
const MAX_SESSION_FILE_BYTES = 64 * 1024;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu;

/**
 * How far the session file's `startedAt` may lie from the process start the
 * environment reports before the file is treated as evidence about a dead
 * process rather than this one.
 *
 * `ps` reports a start time at second resolution in local time, while the CLI
 * records epoch milliseconds a moment after the kernel started the process, so
 * a healthy pair disagrees by up to a second or two. Five seconds absorbs that
 * and a slow start, and still rejects the case the check exists for: a crash
 * left a session file behind and the kernel handed the same pid to a new
 * process minutes or hours later.
 */
export const SESSION_START_TOLERANCE_MS = 5_000;

/**
 * Every field this provider reads from a `.claude/sessions/<pid>.json` file.
 * The file also carries a peer token path, a socket path, a display name and a
 * live status; none of them is read, and the sibling `<pid>.<digest>.key` is
 * never opened at all. `fixtures/session-file-v01.json` is the captured shape
 * this set is held against.
 */
export const CLAUDE_SESSION_FILE_FIELDS = Object.freeze([
	'pid',
	'sessionId',
	'cwd',
	'startedAt',
	'version',
	'status',
	'statusUpdatedAt',
] as const);

/**
 * Bounded listing limits for the provider's own session directory. One small
 * object per live `claude`; the extension filter also keeps the sibling `.key`
 * files out of the listing entirely.
 */
const SESSION_DIRECTORY = {
	extensions: ['.json'],
	maxDepth: 0,
	maxEntries: 256,
	maxBytes: 4 * 1024 * 1024,
} as const;

/**
 * Bounded limits for the one look below `.claude/projects` that finds a
 * conversation resumed away from the directory it started in.
 *
 * Depth one is every project directory and no deeper, which keeps a session's
 * own `<session>/subagents/` tree out of the listing entirely. The host charges
 * each matching journal's size against the byte budget and stops the walk when
 * the next would exceed it, so these are chosen at its maximum: a directory
 * large enough to exhaust them reports a truncated snapshot, and a truncated
 * snapshot binds nothing rather than something plausible.
 */
const PROJECT_DIRECTORY = {
	extensions: ['.jsonl'],
	maxDepth: 1,
	maxEntries: 256,
	maxBytes: 1024 * 1024 * 1024,
} as const;

/**
 * Claude Code binds through the pid-keyed session file its own CLI writes, and
 * through nothing else. Every interactive `claude` writes
 * `~/.claude/sessions/<pid>.json` naming the conversation that process is
 * holding, rewrites it when the process changes conversation, and removes it on
 * exit. No file time, append order or open handle is consulted: two terminals
 * in one repository share a project directory, and only the process's own
 * record says which journal in it belongs to which terminal.
 */
export const claudeCodeProvider = defineAgentProvider({
	mappingVersion: '0.1',

	matchesForeground(process: AgentForegroundProcess): boolean {
		return process.executableName === 'claude';
	},

	async observe(
		terminal: AgentTerminalContext,
	): Promise<AgentObservationResult> {
		if (
			!terminal.capabilities.has('process-observation') ||
			!terminal.capabilities.has('agent-journal')
		) {
			return { state: 'unavailable', reason: 'environment-capability-missing' };
		}
		const descendants = await terminal.observation.processes.descendants({
			signal: terminal.signal,
		});
		const accepted: SessionFile[] = [];
		for (const process of descendants) {
			const file = await sessionFileFor(terminal, process);
			if (file) accepted.push(file);
		}
		// A `claude` nested inside a `claude` is not a case worth guessing at.
		if (accepted.length !== 1) return { state: 'not-bound' };
		const file = accepted[0]!;
		const journal = await journalFor(terminal, file.cwd, file.sessionId);
		if (!journal) return { state: 'not-bound' };
		const binding = await terminal.bindSession({
			providerSessionId: file.sessionId,
			mappingVersion: '0.1',
			journal: journal.handle,
			fingerprint: {
				kind: 'claude-session-file-for-pty-descendant-pid',
				process: file.process.handle,
				// The session file is the evidence; the journal it names is carried
				// by the binding itself.
				file: file.handle,
				metadata: { providerSessionId: file.sessionId },
			},
			...((file.version ?? journal.version)
				? { metadata: { providerVersion: (file.version ?? journal.version)! } }
				: {}),
		});
		const subagents = await subagentDirectory(terminal, file);
		const children = await findChildSources(terminal, subagents);
		const sources = children.map((child) => child.source);
		return jsonlSession({
			binding,
			source: withQuiescence(rootSource(terminal, file, journal.handle), {
				terminal,
				providerExecutable: 'claude',
			}),
			mapRecord: createClaudeRecordMapper(),
			...(sources.length === 0 ? {} : { childSources: sources }),
			...(subagents === undefined
				? {}
				: {
						childSourceDiscovery: discoverChildSources(
							terminal,
							subagents,
							new Set(children.map((child) => child.agentId)),
						),
					}),
		});
	},
});

/** One accepted `sessions/<pid>.json`, reduced to the fields that are read. */
interface SessionFile {
	readonly process: AgentProcessSnapshot;
	readonly handle: AgentFileHandle;
	readonly relativePath: string;
	readonly sessionId: string;
	readonly cwd: string;
	readonly version?: string;
	/** The CLI's own `idle` / `busy` word, rewritten as the process changes. */
	readonly status?: string;
	/** When that word was last written, epoch milliseconds. */
	readonly statusUpdatedAt?: number;
}

/**
 * Resolves and validates the session file one `claude` descendant wrote for
 * itself. The pid names the file, so no listing is needed to find it, and the
 * file is accepted only when everything in it that can be checked against the
 * observed process agrees with that process.
 */
async function sessionFileFor(
	terminal: AgentTerminalContext,
	process: AgentProcessSnapshot,
): Promise<SessionFile | undefined> {
	if (process.executableName !== 'claude') return undefined;
	const pid = process.pid;
	if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0)
		return undefined;
	const relativePath = `${pid}.json`;
	const handle = await terminal.observation.files.resolveHomeRelative(
		`${CLAUDE_SESSIONS}/${relativePath}`,
		{
			beneath: { homeRelative: CLAUDE_SESSIONS },
			extension: '.json',
			signal: terminal.signal,
		},
	);
	if (!handle) return undefined;
	return acceptSessionFile(
		await terminal.observation.files.readJson<unknown>(handle, {
			maxBytes: MAX_SESSION_FILE_BYTES,
			signal: terminal.signal,
		}),
		process,
		handle,
		relativePath,
	);
}

function acceptSessionFile(
	value: unknown,
	process: AgentProcessSnapshot,
	handle: AgentFileHandle,
	relativePath: string,
): SessionFile | undefined {
	const envelope = record(value);
	if (!envelope) return undefined;
	// Only the allowed fields are ever looked at, and the set is the one the
	// reference capture is held against.
	const read = <T>(field: (typeof CLAUDE_SESSION_FILE_FIELDS)[number]): T =>
		envelope[field] as T;
	const pid = read<unknown>('pid');
	const sessionId = safeAgentString(read<unknown>('sessionId'))?.slice(0, 512);
	const cwd = safeAgentString(read<unknown>('cwd'))?.slice(0, 4_096);
	const startedAt = read<unknown>('startedAt');
	const version = safeAgentString(read<unknown>('version'))?.slice(0, 100);
	const status = safeAgentString(read<unknown>('status'))?.slice(0, 32);
	const statusUpdatedAt = read<unknown>('statusUpdatedAt');
	if (pid !== process.pid) return undefined;
	if (!cwd || cwd !== process.cwd) return undefined;
	if (!sessionId || !SESSION_ID.test(sessionId)) return undefined;
	const observedStart = process.startedAt
		? Date.parse(process.startedAt)
		: Number.NaN;
	if (Number.isFinite(observedStart)) {
		if (typeof startedAt !== 'number' || !Number.isFinite(startedAt))
			return undefined;
		if (Math.abs(startedAt - observedStart) > SESSION_START_TOLERANCE_MS)
			return undefined;
	}
	return {
		process,
		handle,
		relativePath,
		sessionId,
		cwd,
		...(version ? { version } : {}),
		...(status ? { status } : {}),
		...(typeof statusUpdatedAt === 'number' && Number.isFinite(statusUpdatedAt)
			? { statusUpdatedAt }
			: {}),
	};
}

interface RootJournalHandle {
	readonly handle: AgentFileHandle;
	readonly version?: string;
}

/**
 * The journal for the session a session file names.
 *
 * `<encoded cwd>/<sessionId>.jsonl` below `.claude/projects` is where the CLI
 * files a conversation it started here, so it is derived and tried first. It is
 * not where every conversation lives: `claude --resume` in another directory
 * keeps writing the journal under the directory the conversation *originated*
 * in, and a terminal running one of those has a healthy session file naming a
 * session whose journal the derived path will never find.
 *
 * So the session id, not the directory, is what is resolved. The id is never
 * chosen here — it comes from the pid-keyed file the observed process wrote
 * about itself — and whatever is found has to name that same session back.
 */
async function journalFor(
	terminal: AgentTerminalContext,
	cwd: string,
	sessionId: string,
): Promise<RootJournalHandle | undefined> {
	const relativePath = claudeProjectJournalPath(cwd, sessionId);
	if (!relativePath) return undefined;
	const derived = await terminal.observation.files.resolveHomeRelative(
		relativePath,
		{
			beneath: { homeRelative: CLAUDE_PROJECTS },
			extension: '.jsonl',
			signal: terminal.signal,
		},
	);
	const admitted =
		derived === undefined
			? undefined
			: await admitJournal(terminal, derived, sessionId);
	return admitted ?? (await journalElsewhere(terminal, sessionId));
}

/** A candidate is this session's journal only when it says so itself. */
async function admitJournal(
	terminal: AgentTerminalContext,
	handle: AgentFileHandle,
	sessionId: string,
): Promise<RootJournalHandle | undefined> {
	const header = await terminal.observation.files.readJsonLine<unknown>(
		handle,
		{
			position: 'first',
			maxBytes: MAX_HEADER_BYTES,
			signal: terminal.signal,
		},
	);
	if (rootSessionId(header) !== sessionId) return undefined;
	const version = providerVersion(header);
	return { handle, ...(version ? { version } : {}) };
}

/**
 * One bounded look for `<sessionId>.jsonl` in the provider's other project
 * directories, for the conversation that was resumed away from its origin.
 *
 * This is a lookup by exact name for an id the process already named, not a
 * search for a plausible journal: no timestamp, ordering, or proximity takes
 * part, every candidate is still verified against its own first record, and
 * anything ambiguous or unfinished binds nothing at all.
 */
async function journalElsewhere(
	terminal: AgentTerminalContext,
	sessionId: string,
): Promise<RootJournalHandle | undefined> {
	if (!SESSION_ID.test(sessionId)) return undefined;
	const directory = await terminal.observation.files.resolveHomeDirectory(
		CLAUDE_PROJECTS,
		{ signal: terminal.signal },
	);
	if (!directory) return undefined;
	const listing = await terminal.observation.files.listDirectory(directory, {
		...PROJECT_DIRECTORY,
		signal: terminal.signal,
	});
	// A limit reached before the journal was seen makes the snapshot evidence of
	// nothing. Discovery retries and topology polling remain free to try again.
	if (listing.truncated) return undefined;
	const named = `${sessionId}.jsonl`;
	const candidates = listing.entries.filter(
		(entry) => entry.relativePath.split('/').at(-1) === named,
	);
	// Two directories claiming one session id is not a case worth guessing at.
	if (candidates.length !== 1) return undefined;
	return admitJournal(terminal, candidates[0]!.handle, sessionId);
}

const SWITCH_CHUNK: AgentFileWatchChunk = {
	// `truncate` resets the record decoder, so no partial line of the retired
	// journal can be joined to the first line of its replacement.
	type: 'truncate',
	bytes: new TextEncoder().encode(
		`${JSON.stringify(CONVERSATION_SWITCH_RECORD)}\n`,
	),
};

function idleChunk(file: SessionFile): AgentFileWatchChunk {
	return {
		type: 'append',
		bytes: new TextEncoder().encode(
			`${JSON.stringify(sessionIdleRecord(file.statusUpdatedAt))}\n`,
		),
	};
}

/** Which of the two lanes produced a result, and what it produced. */
type Lane =
	| { readonly lane: 'record'; readonly chunk?: AgentFileWatchChunk }
	| { readonly lane: 'session'; readonly session?: SessionFile };

/**
 * Reports each time this process's own session file comes to name a session
 * other than the bound one, or to report a different status. The CLI rewrites the file in place rather than
 * appending to it, so its directory is watched and only the one entry this pid
 * names is ever read from the listing.
 */
async function* renamedSessions(
	terminal: AgentTerminalContext,
	file: SessionFile,
	bound: () => string,
): AsyncGenerator<SessionFile> {
	const directory = await terminal.observation.files.resolveHomeDirectory(
		CLAUDE_SESSIONS,
		{ signal: terminal.signal },
	);
	if (!directory) return;
	const watcher = await terminal.observation.files.watchDirectory(directory, {
		...SESSION_DIRECTORY,
		signal: terminal.signal,
	});
	let status = file.status;
	try {
		for await (const listing of watcher) {
			const entry = listing.entries.find(
				(candidate) => candidate.relativePath === file.relativePath,
			);
			if (!entry) continue;
			const named = acceptSessionFile(
				await terminal.observation.files.readJson<unknown>(entry.handle, {
					maxBytes: MAX_SESSION_FILE_BYTES,
					signal: terminal.signal,
				}),
				file.process,
				entry.handle,
				file.relativePath,
			);
			if (!named) continue;
			if (named.sessionId === bound() && named.status === status) continue;
			status = named.status;
			yield named;
		}
	} finally {
		await watcher.dispose();
	}
}

/**
 * The bound journal's records, followed by those of whatever journal the
 * process moves to.
 *
 * `/clear` and an in-process `/resume` change the `sessionId` in the same
 * pid-keyed file rather than starting a new process, and neither changes the
 * process tree, so nothing outside this stream would ever look again: the
 * terminal would sit on a journal its process had stopped writing.
 *
 * The entry therefore follows the process. A switch resets the mapping and
 * continues on the newly named journal, so the row relabels itself and opens
 * the new conversation's turns.
 *
 * What it does not do is re-bind. The host refuses a live context that
 * publishes a binding naming a different `providerSessionId`
 * (`agentService.ts`, `ingestExtensionLifecycle`: "extension agent session
 * replacement requires a separate binding publication"), and the method that
 * would retire and re-materialise the root has no caller. Until that exists the
 * canonical root keeps the session id it bound with; retiring it here would
 * leave the terminal with no root at all.
 */
function rootSource(
	terminal: AgentTerminalContext,
	file: SessionFile,
	journal: AgentFileHandle,
): AgentFileWatcher {
	let follower: AgentFileWatcher | undefined;
	let renamed: AsyncGenerator<SessionFile> | undefined;

	async function* iterate(): AsyncGenerator<AgentFileWatchChunk> {
		let bound = file.sessionId;
		// The CLI's idle mark goes first, ahead of any replayed record, so every
		// lane knows from its first record which launches are already history.
		if (file.status === 'idle') yield idleChunk(file);
		follower = await terminal.observation.files.follow(journal, {
			signal: terminal.signal,
		});
		let records = follower[Symbol.asyncIterator]();
		let recordsDone = false;
		let renamedDone = false;
		let replayed = false;
		let nextRecord: Promise<Lane> | undefined;
		let nextSession: Promise<Lane> | undefined;
		while (!terminal.signal.aborted) {
			// The watch opens only once the bound journal has replayed, so a switch
			// can never be projected ahead of the session it supersedes.
			if (replayed && renamed === undefined)
				renamed = renamedSessions(terminal, file, () => bound);
			// A lane that fails simply ends: an unreadable session directory must
			// never take the bound session down with it.
			if (!recordsDone)
				nextRecord ??= records.next().then(
					(result) => ({ lane: 'record', chunk: result.value }) as Lane,
					() => ({ lane: 'record' }) as Lane,
				);
			if (renamed && !renamedDone)
				nextSession ??= renamed.next().then(
					(result) => ({ lane: 'session', session: result.value }) as Lane,
					() => ({ lane: 'session' }) as Lane,
				);
			const racing = [nextRecord, nextSession].filter(
				(pending) => pending !== undefined,
			);
			if (racing.length === 0) return;
			const settled = await Promise.race(racing);
			if (settled.lane === 'record') {
				nextRecord = undefined;
				if (!settled.chunk) {
					recordsDone = true;
					// A journal that ended before it produced anything is no evidence
					// for a switch either; there is nothing left to watch.
					if (!replayed) return;
					continue;
				}
				replayed = true;
				yield settled.chunk;
				continue;
			}
			nextSession = undefined;
			if (!settled.session) {
				renamedDone = true;
				continue;
			}
			if (settled.session.sessionId === bound) {
				// Same conversation, new status word. Only `idle` carries a fact the
				// journal cannot: a subagent whose end was never written is over.
				if (settled.session.status === 'idle') yield idleChunk(settled.session);
				continue;
			}
			const moved = await journalFor(
				terminal,
				settled.session.cwd,
				settled.session.sessionId,
			);
			if (!moved) continue;
			yield SWITCH_CHUNK;
			bound = settled.session.sessionId;
			await follower.dispose();
			follower = await terminal.observation.files.follow(moved.handle, {
				signal: terminal.signal,
			});
			records = follower[Symbol.asyncIterator]();
			recordsDone = false;
			nextRecord = undefined;
		}
	}

	return {
		[Symbol.asyncIterator]: iterate,
		async dispose() {
			await renamed?.return(undefined as never);
			await follower?.dispose();
		},
	};
}

/**
 * Bounded listing limits for one root session's own children. The CLI writes
 * two files per child — the journal and its `.meta.json` sidecar — so the
 * entry budget covers both.
 */
const SUBAGENT_DIRECTORY = {
	extensions: ['.jsonl', '.json'],
	maxDepth: 0,
	maxEntries: 128,
	maxBytes: 256 * 1024 * 1024,
} as const;
const SUBAGENT_JOURNAL = /^agent-([A-Za-z0-9_-]{1,128})\.jsonl$/u;
const SUBAGENT_META = /^agent-([A-Za-z0-9_-]{1,128})\.meta\.json$/u;
/** The sidecar is a single small object; nothing larger is read. */
const MAX_META_BYTES = 8 * 1024;
const TOOL_USE_ID = /^[A-Za-z0-9_-]{1,512}$/u;

/**
 * A root session's children live in its own `<session-uuid>/subagents/`
 * directory below the same project directory. That containment is the only
 * parentage evidence used: a journal elsewhere in the tree is never a child.
 */
async function subagentDirectory(
	terminal: AgentTerminalContext,
	file: SessionFile,
): Promise<AgentDirectoryHandle | undefined> {
	const projectDirectory = claudeProjectDirectoryPath(file.cwd);
	if (!projectDirectory) return undefined;
	try {
		return await terminal.observation.files.resolveHomeDirectory(
			`${projectDirectory}/${file.sessionId}/subagents`,
			{ beneath: { homeRelative: CLAUDE_PROJECTS }, signal: terminal.signal },
		);
	} catch {
		return undefined;
	}
}

/** Reads a child's native id from its own file name inside that directory. */
function childIdOf(relativePath: string): string | undefined {
	return SUBAGENT_JOURNAL.exec(relativePath)?.[1];
}

/**
 * One child journal, paired with the identifier the root session already knows
 * it by. The directory names a child by its native agent id, while the root
 * journal's `Agent` tool call and the later task notification both name the
 * same child by the launching tool-use id. The two lanes must agree or the
 * same subagent is projected twice and the agent-id copy never completes.
 */
interface DiscoveredChild {
	/** File-level identity, used only to avoid re-admitting the same journal. */
	readonly agentId: string;
	readonly source: AgentChildJournalSource;
}

/**
 * The CLI writes `agent-<agentId>.meta.json` beside each child journal. Only
 * the launching tool-use id is read from it; the description and prompt the
 * sidecar also carries are never read across this boundary.
 */
async function childToolUseId(
	terminal: AgentTerminalContext,
	meta: AgentFileHandle | undefined,
): Promise<string | undefined> {
	if (!meta) return undefined;
	try {
		const sidecar = await terminal.observation.files.readJson<unknown>(meta, {
			maxBytes: MAX_META_BYTES,
			signal: terminal.signal,
		});
		const toolUseId = safeAgentString(record(sidecar)?.toolUseId);
		return toolUseId && TOOL_USE_ID.test(toolUseId) ? toolUseId : undefined;
	} catch {
		// A missing or unreadable sidecar leaves the child keyed by its agent id.
		return undefined;
	}
}

/**
 * Builds one child source per journal in a listing, keyed by the tool-use id
 * its sidecar names and falling back to the agent id when no sidecar exists.
 */
async function childSourcesIn(
	terminal: AgentTerminalContext,
	entries: readonly AgentDiscoveredFile[],
): Promise<readonly DiscoveredChild[]> {
	const journals: Array<{ agentId: string; handle: AgentFileHandle }> = [];
	const sidecars = new Map<string, AgentFileHandle>();
	for (const entry of entries) {
		const agentId = childIdOf(entry.relativePath);
		if (agentId) {
			journals.push({ agentId, handle: entry.handle });
			continue;
		}
		const metaId = SUBAGENT_META.exec(entry.relativePath)?.[1];
		if (metaId) sidecars.set(metaId, entry.handle);
	}
	const children: DiscoveredChild[] = [];
	for (const journal of journals) {
		const toolUseId = await childToolUseId(
			terminal,
			sidecars.get(journal.agentId),
		);
		children.push({
			agentId: journal.agentId,
			source: {
				childId: toolUseId ?? journal.agentId,
				journal: journal.handle,
				source: terminal.observation.files.follow(journal.handle, {
					signal: terminal.signal,
				}),
			},
		});
	}
	return children;
}

async function findChildSources(
	terminal: AgentTerminalContext,
	subagents: AgentDirectoryHandle | undefined,
): Promise<readonly DiscoveredChild[]> {
	if (!subagents) return [];
	try {
		const listing = await terminal.observation.files.listDirectory(subagents, {
			...SUBAGENT_DIRECTORY,
			signal: terminal.signal,
		});
		return await childSourcesIn(terminal, listing.entries);
	} catch {
		// Child discovery is bounded enrichment; a missing directory must not
		// make an already proven root unavailable.
		return [];
	}
}

/**
 * Admits children created after the root binds, never re-admitting one. The
 * seen set holds agent ids — the file's own identity — so a child already
 * admitted under its tool-use id is not admitted a second time.
 */
async function* discoverChildSources(
	terminal: AgentTerminalContext,
	subagents: AgentDirectoryHandle,
	seen: Set<string>,
): AsyncGenerator<AgentChildJournalSource> {
	try {
		const watcher = await terminal.observation.files.watchDirectory(subagents, {
			...SUBAGENT_DIRECTORY,
			signal: terminal.signal,
		});
		try {
			for await (const listing of watcher) {
				const fresh = listing.entries.filter((entry) => {
					const agentId = childIdOf(entry.relativePath);
					return agentId === undefined || !seen.has(agentId);
				});
				for (const child of await childSourcesIn(terminal, fresh)) {
					if (seen.size >= SUBAGENT_DIRECTORY.maxEntries) return;
					if (seen.has(child.agentId)) continue;
					seen.add(child.agentId);
					yield child.source;
				}
			}
		} finally {
			await watcher.dispose();
		}
	} catch {
		return;
	}
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function rootSessionId(value: unknown): string | undefined {
	const envelope = record(value);
	if (!envelope || envelope.isSidechain === true) return undefined;
	const id = safeAgentString(envelope.sessionId)?.slice(0, 512);
	return id && SESSION_ID.test(id) ? id : undefined;
}

function providerVersion(value: unknown): string | undefined {
	return safeAgentString(record(value)?.version)?.slice(0, 100);
}
