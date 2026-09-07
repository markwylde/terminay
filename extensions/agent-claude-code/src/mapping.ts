import type { AgentRecordContext } from '@terminay/extension-api';
import { QUIET_RECORD } from './quiescence.js';

const QUIET_RECORD_TYPE = QUIET_RECORD.type;

/**
 * The synthetic record a conversation switch produces. It never reaches a
 * journal: the provider injects it when the process's own session file comes to
 * name a different conversation, so the records of the journal that follows are
 * not read as a continuation of the one before it.
 */
export const CONVERSATION_SWITCH_RECORD = {
	type: 'terminay-conversation-switch',
} as const;
const CONVERSATION_SWITCH_RECORD_TYPE = CONVERSATION_SWITCH_RECORD.type;

/**
 * The synthetic record the provider injects when the process's own session
 * file reports `status: "idle"`. The CLI writes that itself, so it outranks
 * anything inferred from journals: no subagent can still be running once the
 * process that owns it says it is idle.
 */
export const SESSION_IDLE_RECORD_TYPE = 'terminay-session-idle';
/** Builds the idle record; `idleSince` is the file's own `statusUpdatedAt`. */
export function sessionIdleRecord(idleSince: number | undefined): {
	readonly type: typeof SESSION_IDLE_RECORD_TYPE;
	readonly idleSince?: number;
} {
	return {
		type: SESSION_IDLE_RECORD_TYPE,
		...(idleSince === undefined ? {} : { idleSince }),
	};
}

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
	/**
	 * Children already completed, keyed the same way. The root lane and the
	 * child-journal lane describe the same subagent, and a child journal is
	 * replayed from its start, so a completed child must never be re-opened by
	 * records that were written before it finished.
	 */
	completed: Set<string>;
	/**
	 * Epoch milliseconds of the CLI's last `status: "idle"` mark, from its own
	 * session file. A subagent launch or start recorded before it is history:
	 * the process has been idle since, so whatever that child did is over,
	 * whether or not its journal ever said so. Journals are replayed
	 * concurrently and the host re-opens a stopped child on a later start, so
	 * this is the only ordering-independent way to keep a dead child down.
	 */
	idleSince?: number;
}

function newState(): ClaudeState {
	return {
		started: false,
		headerSeen: false,
		titled: false,
		turnOpen: false,
		inferredWaiting: false,
		children: new Set<string>(),
		completed: new Set<string>(),
	};
}

/**
 * Clears everything that belonged to the conversation just left, so the journal
 * that follows relabels the entry, opens its own turns and carries none of the
 * previous conversation's subagents. `started` is deliberately kept: the host
 * materialises one root per bound session and the entry stays that same root.
 */
function resetConversation(state: ClaudeState): void {
	state.headerSeen = false;
	state.titled = false;
	state.turnOpen = false;
	state.inferredWaiting = false;
	delete state.permissionMode;
	state.children.clear();
	state.completed.clear();
}

/**
 * Claude Code project-session JSONL mapping v0.1. It reads only lifecycle
 * fields and an allowlisted user-text preview. Tool input/output and assistant
 * text never cross the extension boundary.
 *
 * Two behaviours of the real CLI shape this mapping. Its header block is
 * rewritten after every user prompt and again after every `turn_duration`,
 * not only at session start, so a later header is bookkeeping: it neither
 * restarts the session nor opens a turn. The user prompt record opens a turn
 * and `turn_duration` closes it. And an assistant
 * record is flushed together with its `tool_result` once the tool completes, so
 * the journal never shows an outstanding tool call: `AskUserQuestion` records
 * the question only after it has been answered and is therefore not a live
 * waiting signal.
 */
export function createClaudeRecordMapper(): (
	record: unknown,
	session: AgentRecordContext,
) => void {
	const state = newState();
	return (record, session) => mapClaudeRecord(record, session, state);
}

export function mapClaudeRecord(
	record: unknown,
	session: AgentRecordContext,
	state?: ClaudeState,
): void {
	const scope = state ?? newState();
	if (session.journal?.role === 'child') {
		mapChildRecord(record, session, session.journal.childId, scope);
		return;
	}
	const envelope = object(record);
	if (!envelope || envelope.isSidechain === true) return;
	const message = object(envelope.message) ?? {};
	const publisher = session.publish;
	const type = typeof envelope.type === 'string' ? envelope.type : undefined;
	if (type === undefined) return;

	if (type === CONVERSATION_SWITCH_RECORD_TYPE) {
		// The process changed conversation in place. Anything the conversation
		// left open ends with it — a turn abandoned by `/clear` is cancelled, not
		// completed — and the entry then follows the process: the next journal's
		// own records relabel it and open its turns.
		if (scope.inferredWaiting)
			publisher.waitFinished({
				waitId: `inferred-wait:${session.binding.providerSessionId}`,
			});
		for (const child of scope.children)
			publisher.subagentDone({ subagentId: child, outcome: 'cancelled' });
		if (scope.turnOpen) publisher.done({ outcome: 'cancelled' });
		resetConversation(scope);
		return;
	}

	if (type === SESSION_IDLE_RECORD_TYPE) {
		// A child whose completion was never recorded — killed, or interrupted
		// before its journal closed — would otherwise hold the root `working`
		// for ever. The process says it is idle, so every open child is over.
		if (typeof envelope.idleSince === 'number')
			scope.idleSince = Math.max(scope.idleSince ?? 0, envelope.idleSince);
		// The same goes for the root: a turn still open when the CLI says idle
		// never wrote its `turn_duration` — interrupted, or lost — and is over.
		if (scope.inferredWaiting) {
			scope.inferredWaiting = false;
			publisher.waitFinished({
				waitId: `inferred-wait:${session.binding.providerSessionId}`,
			});
		}
		if (scope.turnOpen) {
			scope.turnOpen = false;
			publisher.done({ outcome: 'cancelled' });
		}
		for (const child of scope.children) {
			scope.completed.add(child);
			publisher.subagentDone({ subagentId: child, outcome: 'cancelled' });
		}
		scope.children.clear();
		return;
	}

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
		// Header blocks are bookkeeping, not turn boundaries. The real CLI writes
		// one at session start, another after the user prompt has been recorded,
		// and another after `turn_duration`, so opening a turn here would leave a
		// phantom turn open after every completed one. The user prompt record
		// opens a turn and `turn_duration` closes it.
		scope.headerSeen = true;
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
	// Everything below changes state. A record written at or before the CLI's
	// last idle mark is history: replaying it live would show a turn that ended
	// before this terminal bound, for as long as the replay takes.
	if (beforeIdle(envelope, scope)) {
		// A turn that finished before the mark still ends with its outcome, so
		// a terminal binding just after a turn shows DONE rather than nothing;
		// it just never passes through `working` on the way.
		if (type === 'system' && envelope.subtype === 'turn_duration') {
			scope.turnOpen = false;
			publisher.done({ outcome: 'success' });
		}
		return;
	}
	if (type === 'user' && interrupted(message)) {
		// The turn was stopped before its `turn_duration` could be written.
		if (scope.turnOpen) {
			scope.turnOpen = false;
			publisher.done({ outcome: 'cancelled' });
		}
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
				// The launch record is replayed from the start of the journal, so a
				// child that already completed must not be re-opened by it.
				if (scope.completed.has(toolId)) continue;
				if (beforeIdle(envelope, scope)) {
					// Launched before the CLI last went idle: finished, one way or
					// another, and its own journal must not re-open it either.
					scope.completed.add(toolId);
					continue;
				}
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
 *
 * The child is keyed by the same tool-use id the root lane used to launch it,
 * so these records refine one entry rather than adding a second. A child the
 * root already completed is left alone: its journal is replayed from the
 * beginning and its earlier records would otherwise put it back to work. A
 * child completing publishes only that child's completion and never the root's.
 */
function mapChildRecord(
	record: unknown,
	session: AgentRecordContext,
	childId: string,
	state: ClaudeState,
): void {
	if (state.completed.has(childId)) return;
	const envelope = object(record);
	if (!envelope) return;
	const message = object(envelope.message) ?? {};
	const type = typeof envelope.type === 'string' ? envelope.type : undefined;
	const finish = (outcome: 'success' | 'cancelled' = 'success'): void => {
		state.children.delete(childId);
		state.completed.add(childId);
		session.publish.subagentDone({ subagentId: childId, outcome });
	};
	// A stopped subagent's journal ends on this user record and nothing else:
	// no `end_turn`, no `turn_duration`, and no task notification reaches the
	// root for it. It is the child's own last word, so it closes the child.
	if (type === 'user' && interrupted(message)) {
		finish('cancelled');
		return;
	}
	if (type === 'assistant' && message.role === 'assistant') {
		if (message.stop_reason === 'end_turn') {
			finish();
			return;
		}
		// Written before the CLI last went idle: this child cannot be running.
		if (beforeIdle(envelope, state)) return;
		// One start per child. The host re-opens a stopped child on any later
		// start, and journals replay concurrently, so a start repeated for every
		// assistant record is a stream of chances to resurrect a finished child.
		if (state.children.has(childId)) return;
		state.children.add(childId);
		session.publish.subagentStarted({
			subagentId: childId,
			parentAgentId: session.binding.providerSessionId,
			...metadata(message),
		});
		return;
	}
	if (type === 'system' && envelope.subtype === 'turn_duration') finish();
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
	// The child's own journal is followed independently and replays from its
	// start; recording the completion here keeps it from re-opening this child.
	state.completed.add(toolId);
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

/** True when the record predates the CLI's last idle mark. */
function beforeIdle(envelope: JsonObject, state: ClaudeState): boolean {
	if (state.idleSince === undefined) return false;
	const at =
		typeof envelope.timestamp === 'string'
			? Date.parse(envelope.timestamp)
			: Number.NaN;
	return Number.isFinite(at) && at <= state.idleSince;
}

/** True for the `[Request interrupted by user…]` record the CLI writes when a run is stopped. */
function interrupted(message: JsonObject): boolean {
	return content(message).some(
		(item) =>
			item.type === 'text' &&
			typeof item.text === 'string' &&
			item.text.startsWith('[Request interrupted by user'),
	);
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
