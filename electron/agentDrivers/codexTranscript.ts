import { open } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { isPlainObject } from './managedHooks';

const MAX_SESSION_META_BYTES = 256 * 1024;

type CodexSessionMeta = {
	agentPath?: string;
	id?: string;
	parentThreadId?: string;
};

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

function canonicalEventName(payload: Record<string, unknown>): string {
	return (
		firstString(
			payload.hook_event_name,
			payload.hookEventName,
			payload.event_name,
			payload.event,
			payload.type,
		) ?? ''
	)
		.replace(/[^a-zA-Z0-9]/g, '')
		.toLowerCase();
}

function parseSessionMeta(line: string): CodexSessionMeta | undefined {
	let record: unknown;
	try {
		record = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (
		!isPlainObject(record) ||
		record.type !== 'session_meta' ||
		!isPlainObject(record.payload)
	) {
		return undefined;
	}

	const payload = record.payload;
	const source = isPlainObject(payload.source) ? payload.source : undefined;
	const subagent =
		source && isPlainObject(source.subagent) ? source.subagent : undefined;
	const threadSpawn =
		subagent && isPlainObject(subagent.thread_spawn)
			? subagent.thread_spawn
			: undefined;
	return {
		agentPath: firstString(threadSpawn?.agent_path),
		id: firstString(payload.id, payload.session_id),
		parentThreadId: firstString(
			payload.parent_thread_id,
			threadSpawn?.parent_thread_id,
		),
	};
}

async function readSessionMeta(path: string): Promise<CodexSessionMeta | undefined> {
	if (
		!isAbsolute(path) ||
		!basename(path).startsWith('rollout-') ||
		!path.endsWith('.jsonl')
	) {
		return undefined;
	}

	const handle = await open(path, 'r');
	try {
		const buffer = Buffer.allocUnsafe(MAX_SESSION_META_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
		if (newline < 0) {
			return undefined;
		}
		return parseSessionMeta(buffer.subarray(0, newline).toString('utf8'));
	} finally {
		await handle.close();
	}
}

async function readSessionMetaWithRetry(
	path: string,
): Promise<CodexSessionMeta | undefined> {
	for (let attempt = 0; attempt < 4; attempt += 1) {
		try {
			const metadata = await readSessionMeta(path);
			if (metadata) {
				return metadata;
			}
		} catch {
			// The child transcript may be created just after SubagentStart fires.
		}
		if (attempt < 3) {
			await new Promise<void>((resolve) => setTimeout(resolve, 20));
		}
	}
	return undefined;
}

/**
 * Codex's SubagentStart hook identifies the child and supplies its transcript,
 * while the transcript's structured session_meta record carries agent_path.
 */
export async function enrichCodexNativePayload(
	nativePayload: unknown,
): Promise<unknown> {
	if (
		!isPlainObject(nativePayload) ||
		canonicalEventName(nativePayload) !== 'subagentstart'
	) {
		return nativePayload;
	}

	const directAgentPath = firstString(
		nativePayload.agent_path,
		nativePayload.agentPath,
	);
	const transcriptPath = firstString(
		nativePayload.transcript_path,
		nativePayload.transcriptPath,
	);

	let metadata: CodexSessionMeta | undefined;
	if (!directAgentPath && transcriptPath) {
		metadata = await readSessionMetaWithRetry(transcriptPath);
	}
	const agentPath = directAgentPath ?? metadata?.agentPath;
	if (!agentPath) {
		return nativePayload;
	}

	const childId = firstString(
		nativePayload.agent_id,
		nativePayload.agentId,
		nativePayload.subagent_id,
		nativePayload.subagentId,
	);
	const parentId = firstString(
		nativePayload.session_id,
		nativePayload.sessionId,
	);
	if (
		(metadata?.id && childId && metadata.id !== childId) ||
		(metadata?.parentThreadId &&
			parentId &&
			metadata.parentThreadId !== parentId)
	) {
		return nativePayload;
	}

	const displayName = basename(agentPath);
	if (!displayName || displayName === '.' || displayName === '/') {
		return nativePayload;
	}
	return {
		...nativePayload,
		agent_path: agentPath,
		display_name: displayName.slice(0, 200),
	};
}
