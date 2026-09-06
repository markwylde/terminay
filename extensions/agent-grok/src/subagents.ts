import type {
	AgentDirectoryHandle,
	AgentFileWatchChunk,
	AgentTerminalContext,
} from '@terminay/extension-api';

/** Synthetic record type carrying one child's state into the root mapper. */
export const SUBAGENT_RECORD = 'terminay-grok-subagent';

/**
 * Grok writes each subagent to `<session>/subagents/<subagent_id>/meta.json`
 * below the same sessions root, updated in place as the child runs.
 *
 * Observed on a real run: `meta.json` appears with `status: "running"` when the
 * child is spawned and is rewritten to `"completed"` when it finishes, so two
 * children spawned together reach `completed` at different times. It carries an
 * explicit `parent_session_id`, which is the only parentage evidence used.
 *
 * The listing root is the bound session's own directory, not `subagents/`:
 * Grok creates `subagents/` only when the first child is spawned, which on a
 * recorded 1.0.13 run was twelve seconds after it created `events.jsonl`, so a
 * root resolved at bind time never exists yet. Depth 2 below the session
 * directory is exactly `subagents/<subagent_id>/meta.json`.
 *
 * The sibling `output.json`, and this file's own `prompt`, are the child's
 * conversation content and are never read or projected.
 */
export const SUBAGENT_DIRECTORY = {
	extensions: ['.json'],
	maxDepth: 2,
	maxEntries: 128,
	maxBytes: 4 * 1024 * 1024,
} as const;

const META_JSON = /^subagents\/([0-9a-f-]{1,128})\/meta\.json$/iu;
const encoder = new TextEncoder();

export interface GrokSubagentRecord {
	readonly type: typeof SUBAGENT_RECORD;
	readonly subagentId: string;
	readonly parentSessionId: string;
	readonly description?: string;
	readonly status?: string;
}

function bounded(value: unknown, maximum: number): string | undefined {
	return typeof value === 'string' &&
		value.length > 0 &&
		value.length <= maximum
		? value
		: undefined;
}

/** Reads only the bounded lifecycle fields; `prompt` and output stay unread. */
export function subagentRecordFrom(
	value: unknown,
): GrokSubagentRecord | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return undefined;
	const meta = value as Record<string, unknown>;
	const subagentId = bounded(meta.subagent_id ?? meta.child_session_id, 512);
	const parentSessionId = bounded(meta.parent_session_id, 512);
	if (!subagentId || !parentSessionId) return undefined;
	const description = bounded(meta.description, 200);
	const status = bounded(meta.status, 64);
	return {
		type: SUBAGENT_RECORD,
		subagentId,
		parentSessionId,
		...(description ? { description } : {}),
		...(status ? { status } : {}),
	};
}

/**
 * Polls the bound root's own `subagents/` directory and emits one synthetic
 * record whenever a child appears or changes state. Nothing else in the
 * sessions tree is followed, so a session Grok did not declare as this root's
 * child can never become one.
 *
 * Polling re-lists the session directory, so a `subagents/` tree Grok creates
 * long after the root bound is still enumerated.
 */
export async function* followSubagents(
	terminal: AgentTerminalContext,
	directory: AgentDirectoryHandle,
	pollMs: number,
	isFollowing: () => boolean,
): AsyncGenerator<AgentFileWatchChunk> {
	const seen = new Map<string, string>();
	while (!terminal.signal.aborted) {
		const lines: string[] = [];
		try {
			const listing = await terminal.observation.files.listDirectory(
				directory,
				{
					...SUBAGENT_DIRECTORY,
					signal: terminal.signal,
				},
			);
			for (const entry of listing.entries) {
				if (!META_JSON.test(entry.relativePath)) continue;
				const meta = await terminal.observation.files.readJson<unknown>(
					entry.handle,
					{ maxBytes: 64 * 1024, signal: terminal.signal },
				);
				const record = subagentRecordFrom(meta);
				if (!record) continue;
				const signature = `${record.status ?? ''}:${record.description ?? ''}`;
				if (seen.get(record.subagentId) === signature) continue;
				seen.set(record.subagentId, signature);
				lines.push(JSON.stringify(record));
			}
		} catch {
			// Child observation is bounded enrichment; a directory that briefly
			// cannot be listed must never stall the root's own event stream.
		}
		if (lines.length > 0)
			yield { type: 'append', bytes: encoder.encode(`${lines.join('\n')}\n`) };
		// The root journal is the session's lifetime. Once its follower is
		// exhausted there is nothing left to enrich, so the poll must not outlive
		// it.
		if (!isFollowing()) return;
		await delay(pollMs);
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		(timer as { unref?: () => void }).unref?.();
	});
}
