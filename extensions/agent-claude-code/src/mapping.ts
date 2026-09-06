import type { AgentRecordContext } from '@terminay/extension-api';
import { QUIET_RECORD } from './quiescence.js';

const QUIET_RECORD_TYPE = QUIET_RECORD.type;

import { safeAgentString } from '@terminay/extension-api';

type JsonObject = Record<string, unknown>;

/** Records Claude Code writes as a header block at the start of every turn. */
const TURN_HEADER = new Set([
	'mode',
	'permission-mode',
	'atis-latch',
	'bridge-session',
]);
/** Model-context wrappers that are never a user-facing prompt label. */
const INJECTED_TEXT =
	/^\s*<(?:command-name|command-message|command-args|local-command|task-notification|system-reminder)/u;
const TASK_NOTIFICATION = /<task-notification>[\s\S]*?<\/task-notification>/u;
const TASK_TOOL_USE =
	/<tool-use-id>\s*([A-Za-z0-9_-]{1,512})\s*<\/tool-use-id>/u;
const TASK_STATUS = /<status>\s*([a-z_]{1,64})\s*<\/status>/u;

function object(value: unknown): JsonObject | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as JsonObject)
		: undefined;
}

function content(message: JsonObject): readonly JsonObject[] {
	return Array.isArray(message.content)
		? message.content
				.map(object)
				.filter((item): item is JsonObject => item !== undefined)
		: [];
}

function bounded(value: unknown, maximum: number): string | undefined {
	const candidate = safeAgentString(value);
	return candidate !== undefined && candidate.length <= maximum
		? candidate
		: undefined;
}

function id(
	value: unknown,
	prefix: string,
	fallback?: unknown,
): string | undefined {
	return (
		bounded(value, 512) ?? bounded(fallback, 500)?.replace(/^/u, `${prefix}:`)
	);
}

function model(message: JsonObject): { id: string } | undefined {
	const value = bounded(message.model, 200);
	return value ? { id: value } : undefined;
}

function metadata(message: JsonObject): { model?: { id: string } } {
	const value = model(message);
	return value ? { model: value } : {};
}

/** Permission modes in which Claude Code never prompts the user. */
const NON_PROMPTING_MODES = new Set(['bypassPermissions', 'plan']);

interface ClaudeState {
	started: boolean;
	/** True between a turn header and that turn's `turn_duration`. */
	turnOpen: boolean;
	/** True while the entry is held `waiting` by the quiescence inference. */
	inferredWaiting: boolean;
	/** The session's most recent recorded permission mode. */
	permissionMode?: string;
	/** True once the session's first turn header has been consumed. */
	headerSeen: boolean;
	/** True once an `ai-title` has named the root, so a prompt no longer relabels it. */
	titled: boolean;
	/** Live subagent launches keyed by the `Agent` tool-use id that started them. */
	children: Set<string>;
}

/**
 * Claude Code project-session JSONL mapping v0.1. It reads only lifecycle
 * fields and an allowlisted user-text preview. Tool input/output and assistant
 * text never cross the extension boundary.
 *
 * Two behaviours of the real CLI shape this mapping. Its header block is
 * rewritten at the start of every turn rather than only at session start, so a
 * later header opens a turn instead of restarting the session. And an assistant
 * record is flushed together with its `tool_result` once the tool completes, so
 * the journal never shows an outstanding tool call: `AskUserQuestion` records
 * the question only after it has been answered and is therefore not a live
 * waiting signal.
 */
export function createClaudeRecordMapper(): (
	record: unknown,
	session: AgentRecordContext,
) => void {
	const state: ClaudeState = {
		started: false,
		headerSeen: false,
		titled: false,
		turnOpen: false,
		inferredWaiting: false,
		children: new Set(),
	};
	return (record, session) => mapClaudeRecord(record, session, state);
}

export function mapClaudeRecord(
	record: unknown,
	session: AgentRecordContext,
	state?: ClaudeState,
): void {
	if (session.journal?.role === 'child') {
		mapChildRecord(record, session, session.journal.childId);
		return;
	}
	const scope = state ?? {
		started: false,
		headerSeen: false,
		titled: false,
		turnOpen: false,
		inferredWaiting: false,
		children: new Set<string>(),
	};
	const envelope = object(record);
	if (!envelope || envelope.isSidechain === true) return;
	const message = object(envelope.message) ?? {};
	const publisher = session.publish;
	const type = typeof envelope.type === 'string' ? envelope.type : undefined;
	if (type === undefined) return;

	if (type === QUIET_RECORD_TYPE) {
		// Silence is only evidence of a prompt inside an open turn, and only in a
		// mode that can prompt at all. A bypassing session never asks.
		if (!scope.turnOpen || scope.inferredWaiting) return;
		if (
			scope.permissionMode !== undefined &&
			NON_PROMPTING_MODES.has(scope.permissionMode)
		)
			return;
		scope.inferredWaiting = true;
		publisher.waitStarted({
			waitId: `inferred-wait:${session.binding.providerSessionId}`,
			state: 'waiting',
			reason: 'input-request-inferred',
			inferred: true,
		});
		return;
	}
	// Any record the provider actually wrote answers an inferred wait.
	if (scope.inferredWaiting) {
		scope.inferredWaiting = false;
		publisher.waitFinished({
			waitId: `inferred-wait:${session.binding.providerSessionId}`,
		});
	}

	// The recorded permission mode decides whether this session can prompt at
	// all, so it is tracked before any early return in the header handling.
	if (type === 'permission-mode') {
		const mode = bounded(envelope.permissionMode, 64);
		if (mode !== undefined) scope.permissionMode = mode;
	}

	// The header block is preceded by `last-prompt` and `ai-title` in the real
	// journal, so the session starts on whichever recognized record arrives
	// first rather than on the header specifically.
	if (
		!scope.started &&
		(TURN_HEADER.has(type) || type === 'ai-title' || type === 'last-prompt')
	) {
		scope.started = true;
		scope.headerSeen = TURN_HEADER.has(type);
		publisher.sessionStarted({ title: 'Claude Code', ...metadata(message) });
		if (TURN_HEADER.has(type)) return;
	}
	if (TURN_HEADER.has(type)) {
		// A later header block is the start of another turn, not another session.
		// Restarting here would clear active tools and drop a working root to idle.
		if (type === 'permission-mode') {
			if (!scope.headerSeen) {
				scope.headerSeen = true;
				return;
			}
			const turnId = id(envelope.uuid, 'turn', envelope.sessionId);
			if (turnId) publisher.turnStarted({ turnId });
		}
		return;
	}
	if (type === 'ai-title') {
		const title = bounded(envelope.aiTitle, 200);
		if (title) {
			scope.titled = true;
			publisher.metadataChanged({ title });
		}
		return;
	}
	if (type === 'last-prompt') {
		// A deterministic label before the provider has chosen one. An `ai-title`
		// supersedes it and a prompt never overwrites a chosen title.
		const prompt = bounded(envelope.lastPrompt, 200);
		if (prompt && !scope.titled) publisher.metadataChanged({ title: prompt });
		return;
	}
	if (type === 'user' && message.role === 'user' && envelope.isMeta !== true) {
		const results = content(message).filter(
			(item) => item.type === 'tool_result',
		);
		if (results.length > 0) {
			for (const item of results) {
				const toolId = id(item.tool_use_id, 'tool', envelope.uuid);
				if (toolId)
					publisher.toolFinished({
						toolId,
						outcome: item.is_error === true ? 'error' : 'success',
					});
			}
			return;
		}
		if (finishSubagent(message, scope, publisher)) return;
		const promptText = userText(message);
		if (promptText === undefined) return;
		const turnId = id(envelope.promptId, 'user', envelope.uuid);
		if (turnId) {
			scope.turnOpen = true;
			publisher.turnStarted({ turnId, promptText });
		}
		return;
	}
	if (type === 'assistant' && message.role === 'assistant') {
		if (envelope.isApiErrorMessage === true) {
			// A recorded fault that halts the turn. A `turn_duration` arriving
			// afterwards completes the turn and supersedes this.
			const waitId = id(envelope.uuid, 'error', envelope.requestId);
			if (waitId)
				publisher.waitStarted({
					waitId,
					state: 'blocked',
					reason: 'api-error',
				});
			return;
		}
		const turnId = id(envelope.uuid, 'assistant', envelope.requestId);
		const modelMetadata = metadata(message);
		if (modelMetadata.model) publisher.metadataChanged(modelMetadata);
		if (turnId) {
			scope.turnOpen = true;
			publisher.turnStarted({ turnId });
		}
		for (const item of content(message).filter(
			(candidate) => candidate.type === 'tool_use',
		)) {
			const toolId = id(item.id, 'tool', envelope.uuid);
			const name = bounded(item.name, 200);
			if (!toolId || !name) continue;
			const input = object(item.input) ?? {};
			if (name === 'Agent' || name === 'Task') {
				const childTitle =
					bounded(input.description, 200) ?? bounded(input.subagent_type, 200);
				const childPrompt = bounded(input.prompt, 4_000);
				scope.children.add(toolId);
				publisher.subagentStarted({
					subagentId: toolId,
					parentAgentId: session.binding.providerSessionId,
					...(childTitle ? { title: childTitle } : {}),
					...(childPrompt ? { promptText: childPrompt } : {}),
					...metadata(message),
				});
			} else {
				publisher.toolStarted({ toolId, name });
			}
		}
		if (message.stop_reason === 'end_turn')
			publisher.done({ outcome: 'success' });
		return;
	}
	if (type === 'system' && envelope.subtype === 'turn_duration') {
		scope.turnOpen = false;
		publisher.done({ outcome: 'success' });
	}
}

/**
 * A child's own journal carries its lifecycle. Its records are sidechains of
 * the root, so only bounded lifecycle facts are read from them: a child works
 * while its journal is appended and completes when its turn ends. Child
 * prompts, assistant text, reasoning and tool payloads are never projected.
 */
function mapChildRecord(
	record: unknown,
	session: AgentRecordContext,
	childId: string,
): void {
	const envelope = object(record);
	if (!envelope) return;
	const message = object(envelope.message) ?? {};
	const type = typeof envelope.type === 'string' ? envelope.type : undefined;
	if (type === 'assistant' && message.role === 'assistant') {
		if (message.stop_reason === 'end_turn') {
			session.publish.subagentDone({ subagentId: childId, outcome: 'success' });
			return;
		}
		session.publish.subagentStarted({
			subagentId: childId,
			parentAgentId: session.binding.providerSessionId,
			...metadata(message),
		});
		return;
	}
	if (type === 'system' && envelope.subtype === 'turn_duration') {
		session.publish.subagentDone({ subagentId: childId, outcome: 'success' });
	}
}

/**
 * A subagent launch returns immediately and the child reports its completion
 * later through a task notification naming the launching tool-use id. Only that
 * id and the status word are read; the notification body is never projected.
 */
function finishSubagent(
	message: JsonObject,
	state: ClaudeState,
	publisher: AgentRecordContext['publish'],
): boolean {
	const raw =
		typeof message.content === 'string'
			? message.content
			: content(message)
					.filter((item) => item.type === 'text')
					.map((item) => item.text)
					.find((text) => typeof text === 'string');
	if (typeof raw !== 'string' || !TASK_NOTIFICATION.test(raw)) return false;
	const toolId = TASK_TOOL_USE.exec(raw)?.[1];
	if (!toolId || !state.children.has(toolId)) return true;
	state.children.delete(toolId);
	const status = TASK_STATUS.exec(raw)?.[1];
	publisher.subagentDone({
		subagentId: toolId,
		outcome:
			status === 'completed'
				? 'success'
				: status === 'cancelled'
					? 'cancelled'
					: 'error',
	});
	return true;
}

function userText(message: JsonObject): string | undefined {
	if (typeof message.content === 'string') {
		const text = bounded(message.content, 4_000);
		return text && !INJECTED_TEXT.test(text) ? text : undefined;
	}
	return content(message)
		.filter((item) => item.type === 'text')
		.map((item) => bounded(item.text, 4_000))
		.find(
			(text): text is string => text !== undefined && !INJECTED_TEXT.test(text),
		);
}
