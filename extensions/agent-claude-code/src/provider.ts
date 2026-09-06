import type {
	AgentBindingFingerprint,
	AgentChildJournalSource,
	AgentDirectoryHandle,
	AgentDiscoveredFile,
	AgentFileHandle,
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
import { createClaudeRecordMapper } from './mapping.js';
import { withQuiescence } from './quiescence.js';
import {
	claudeProjectDirectoryPath,
	claudeProjectJournalPath,
	claudeResumeSessionId,
} from './resume.js';

export const PROVIDER_ID = 'com.terminay.agent.claude-code/cli';
const CLAUDE_PROJECTS = '.claude/projects';
const MAX_HEADER_BYTES = 64 * 1024;
/** Bounded listing limits for one terminal's project directory. */
const PROJECT_DIRECTORY = {
	extensions: ['.jsonl'],
	maxDepth: 0,
	maxEntries: 256,
	maxBytes: 512 * 1024 * 1024,
} as const;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu;

/**
 * Claude Code v0.1 observes only files currently held by the exact terminal
 * process tree. The host canonicalizes the candidate below `.claude/projects`
 * before this extension reads it, so filenames/cwds cannot bind a session.
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
		const explicitResume = claudeResumeSessionId(terminal.foreground.arguments);
		// Explicit native identity first, then the provider's own project-directory
		// association, then the open-handle fallback. The Claude Code CLI appends to
		// its journal and closes it, so it normally holds no writable handle at all
		// and the fallback alone would never bind. Each rule is consulted only when
		// the one before it found nothing.
		const candidate =
			(explicitResume
				? await resumedJournalCandidate(terminal, descendants, explicitResume)
				: undefined) ??
			(await projectJournalCandidate(terminal, descendants)) ??
			(await writableJournalCandidate(terminal, descendants));
		if (!candidate) return { state: 'not-bound' };
		const header = await terminal.observation.files.readJsonLine<unknown>(
			candidate.journal,
			{
				position: 'first',
				maxBytes: MAX_HEADER_BYTES,
				signal: terminal.signal,
			},
		);
		const sessionId = rootSessionId(header);
		if (!sessionId) return { state: 'not-bound' };
		const binding = await terminal.bindSession({
			providerSessionId: sessionId,
			mappingVersion: '0.1',
			journal: candidate.journal,
			fingerprint: candidate.fingerprint,
			...(providerVersion(header)
				? { metadata: { providerVersion: providerVersion(header)! } }
				: {}),
		});
		const subagents = await subagentDirectory(terminal, candidate, sessionId);
		const children = await findChildSources(terminal, subagents);
		const sources = children.map((child) => child.source);
		return jsonlSession({
			binding,
			source: withQuiescence(
				terminal.observation.files.follow(candidate.journal, {
					signal: terminal.signal,
				}),
				{ terminal, providerExecutable: 'claude' },
			),
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
	candidate: JournalCandidate,
	sessionId: string,
): Promise<AgentDirectoryHandle | undefined> {
	if (!candidate.projectDirectory) return undefined;
	try {
		return await terminal.observation.files.resolveHomeDirectory(
			`${candidate.projectDirectory}/${sessionId}/subagents`,
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

interface JournalCandidate {
	readonly journal: AgentFileHandle;
	readonly fingerprint: AgentBindingFingerprint;
	/** Home-relative project directory, where the primary rule established one. */
	readonly projectDirectory?: string;
}

/**
 * Claude Code's own association: the descendant process CWD names the provider
 * project directory, and a root journal appended there since that process
 * started belongs to it. Appends rather than creation are the evidence because
 * `claude --resume` and `--continue` append to a journal an earlier process
 * created. One process writes a new journal per conversation, so several
 * candidates are ordinary; the bound root is the one most recently appended.
 * Two appended at the same instant are concurrent and bind nothing.
 */
async function projectJournalCandidate(
	terminal: AgentTerminalContext,
	descendants: readonly AgentProcessSnapshot[],
): Promise<JournalCandidate | undefined> {
	for (const process of descendants) {
		if (
			process.executableName !== 'claude' ||
			!process.cwd ||
			!process.startedAt
		)
			continue;
		const startedAt = Date.parse(process.startedAt);
		if (!Number.isFinite(startedAt)) continue;
		const relativePath = claudeProjectDirectoryPath(process.cwd);
		if (!relativePath) continue;
		const directory = await terminal.observation.files.resolveHomeDirectory(
			relativePath,
			{
				beneath: { homeRelative: CLAUDE_PROJECTS },
				signal: terminal.signal,
			},
		);
		if (!directory) continue;
		const listing = await terminal.observation.files.listDirectory(directory, {
			...PROJECT_DIRECTORY,
			signal: terminal.signal,
		});
		const roots: Array<{ handle: AgentFileHandle; modifiedAt: number }> = [];
		for (const entry of listing.entries) {
			// A root session's children live in `<uuid>/subagents/`; depth 0 keeps
			// them out, and the header check below is authoritative regardless.
			if (entry.relativePath.includes('/')) continue;
			const modifiedAt = entry.modifiedAt
				? Date.parse(entry.modifiedAt)
				: Number.NaN;
			if (!Number.isFinite(modifiedAt) || modifiedAt < startedAt) continue;
			const header = await terminal.observation.files.readJsonLine<unknown>(
				entry.handle,
				{
					position: 'first',
					maxBytes: MAX_HEADER_BYTES,
					signal: terminal.signal,
				},
			);
			if (!rootSessionId(header)) continue;
			roots.push({ handle: entry.handle, modifiedAt });
		}
		const active = mostRecentlyAppended(roots);
		if (!active) continue;
		return {
			journal: active,
			projectDirectory: relativePath,
			fingerprint: {
				kind: 'process-cwd-project-journal-appended-since-process-start',
				process: process.handle,
				file: active,
			},
		};
	}
	return undefined;
}

/**
 * Selects the journal currently receiving appends. Two candidates written at
 * the same instant are genuinely concurrent and bind nothing rather than being
 * separated by a timestamp.
 */
function mostRecentlyAppended(
	roots: ReadonlyArray<{ handle: AgentFileHandle; modifiedAt: number }>,
): AgentFileHandle | undefined {
	if (roots.length === 0) return undefined;
	const ordered = [...roots].sort(
		(left, right) => right.modifiedAt - left.modifiedAt,
	);
	const [first, second] = ordered;
	if (!first) return undefined;
	if (second && second.modifiedAt === first.modifiedAt) return undefined;
	return first.handle;
}

async function writableJournalCandidate(
	terminal: AgentTerminalContext,
	descendants: readonly AgentProcessSnapshot[],
): Promise<JournalCandidate | undefined> {
	const openFiles = await terminal.observation.processes.openFiles(
		descendants,
		{
			access: 'writable',
			signal: terminal.signal,
		},
	);
	return rootJournalCandidate(
		terminal,
		openFiles.map((file) => file.handle),
	);
}

async function resumedJournalCandidate(
	terminal: AgentTerminalContext,
	descendants: readonly AgentProcessSnapshot[],
	sessionId: string,
): Promise<JournalCandidate | undefined> {
	const candidates: JournalCandidate[] = [];
	for (const process of descendants) {
		if (process.executableName !== 'claude' || !process.cwd) continue;
		const relativePath = claudeProjectJournalPath(process.cwd, sessionId);
		if (!relativePath) continue;
		const journal = await terminal.observation.files.resolveHomeRelative(
			relativePath,
			{
				beneath: { homeRelative: CLAUDE_PROJECTS },
				extension: '.jsonl',
				signal: terminal.signal,
			},
		);
		if (!journal) continue;
		const header = await terminal.observation.files.readJsonLine<unknown>(
			journal,
			{
				position: 'first',
				maxBytes: MAX_HEADER_BYTES,
				signal: terminal.signal,
			},
		);
		if (rootSessionId(header) !== sessionId) continue;
		candidates.push({
			journal,
			fingerprint: {
				kind: 'explicit-resume-argument-and-project-journal',
				process: process.handle,
				file: journal,
				metadata: { providerSessionId: sessionId },
			},
		});
	}
	return candidates.length === 1 ? candidates[0] : undefined;
}

async function rootJournalCandidate(
	terminal: AgentTerminalContext,
	writers: readonly AgentFileHandle[],
): Promise<JournalCandidate | undefined> {
	const candidates: JournalCandidate[] = [];
	for (const writer of writers) {
		const journal = await terminal.observation.files.canonicalFile(writer, {
			beneath: { homeRelative: CLAUDE_PROJECTS },
			extension: '.jsonl',
			signal: terminal.signal,
		});
		if (!journal) continue;
		// Claude's sidechain journals live below a subagents directory. The header
		// check below is authoritative; this inexpensive path filter prevents a
		// sidechain becoming a root candidate on path-preserving environments.
		const file = await terminal.observation.files.readJsonLine<unknown>(
			journal,
			{
				position: 'first',
				maxBytes: MAX_HEADER_BYTES,
				signal: terminal.signal,
			},
		);
		if (!rootSessionId(file)) continue;
		candidates.push({
			journal,
			fingerprint: {
				kind: 'writable-file-below-terminal-process',
				file: writer,
			},
		});
	}
	// More than one root journal held by one exact process tree is ambiguous.
	// Do not choose by mtime, title, cwd, or filename.
	return candidates.length === 1 ? candidates[0] : undefined;
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
