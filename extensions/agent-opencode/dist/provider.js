import { defineAgentProvider, jsonlSession } from '@terminay/extension-api';
import { emptyState, mapOpenCodeEvent } from './mapping.js';
import {
	effectiveOpenCodeRoot,
	isOpenCodeForeground,
	LIMITS,
	OpenCodeStore,
	safeStorePath,
	storePathFor,
} from './store.js';
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
	async observe(terminal) {
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
		let dataRoot;
		try {
			const environment = await terminal.observation.processes.environment(
				['XDG_DATA_HOME'],
				{ signal: terminal.signal },
			);
			dataRoot = effectiveOpenCodeRoot(environment);
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
				// Several eligible roots are ordinary; the most recently updated one
				// is the session this process is working in. Directory alone is never
				// identity: only a parentless row for this exact cwd is eligible.
				const root = roots.sort((a, b) => b.timeUpdated - a.timeUpdated)[0];
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
const encoder = new TextEncoder();
export function storeWatcher(
	terminal,
	store,
	rootId,
	pollMs = POLL_INTERVAL_MS,
) {
	let closed = false;
	async function* iterate() {
		const cursors = new Map([[rootId, -1]]);
		try {
			while (!closed && !terminal.signal.aborted) {
				// A child is admitted only because its own `parent_id` names this
				// root; nothing else in the sessions table is followed.
				for (const child of store.childrenOf(rootId)) {
					if (!cursors.has(child.id)) cursors.set(child.id, -1);
				}
				const lines = [];
				for (const [aggregateId, cursor] of [...cursors]) {
					for (const event of store.eventsAfter(aggregateId, cursor)) {
						cursors.set(aggregateId, event.seq);
						const record = {
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
export function createOpenCodeRecordMapper(rootId) {
	const state = emptyState();
	return (record, session) => {
		const envelope =
			typeof record === 'object' && record !== null ? record : undefined;
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
function delay(ms) {
	return new Promise((resolve) => {
		// Never hold the process open: a bound session idles for long stretches.
		const timer = setTimeout(resolve, ms);
		timer.unref?.();
	});
}

export { LIMITS };
//# sourceMappingURL=provider.js.map
