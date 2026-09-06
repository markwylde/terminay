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

export const PROVIDER_ID = 'com.terminay.agent.opencode/cli';
const MAPPING_VERSION = '0.1';
const POLL_INTERVAL_MS = 250;

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

		const cwds = new Set(
			descendants
				.filter((process) => isOpenCodeForeground(process.executableName))
				.flatMap((process) => (process.cwd ? [process.cwd] : [])),
		);
		if (cwds.size === 0) return { state: 'not-bound' };

		for (const file of writers) {
			const candidate = storePathFor(file.path);
			if (!candidate) continue;
			const path = await safeStorePath(candidate, dataRoot);
			if (!path) continue;
			const store = new OpenCodeStore(path);
			try {
				const roots = [...cwds].flatMap((cwd) => store.rootsForDirectory(cwd));
				const requested = openCodeSessionId(terminal.foreground.arguments);
				const root = requested
					? roots.find((candidate) => candidate.id === requested)
					: roots.sort((a, b) => b.timeUpdated - a.timeUpdated)[0];
				if (!root) {
					store.close();
					continue;
				}
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
