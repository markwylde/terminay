import type { AgentRecordContext } from '@terminay/extension-api';

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
 * The synthetic record the provider injects for the `status` its own
 * `~/.claude/sessions/<pid>.json` reports, and again for every change to it.
 *
 * This is the only thing that moves the root between working, waiting and
 * done. The CLI maintains that word itself, for itself, and rewrites it within
 * milliseconds of the state changing; a journal, by contrast, says only what
 * has been written down so far, which is why reading a turn's end out of it
 * needed a heuristic and still missed. Nothing here is inferred.
 */
export const SESSION_STATUS_RECORD_TYPE = 'terminay-session-status';
/**
 * The CLI's own status vocabulary, as written to its session file. Captured
 * from the 2.1.270 binary, which validates the word it reads back against
 * exactly this list and drops anything else.
 *
 * `shell` is the CLI having handed the terminal to a shell. Like `idle` it
 * means no work is in flight, so the two are one state here and moving between
 * them publishes nothing.
 */
export type ClaudeSessionStatus = 'busy' | 'shell' | 'idle' | 'waiting';
const CLAUDE_SESSION_STATUSES: readonly ClaudeSessionStatus[] = [
	'busy',
	'shell',
	'idle',
	'waiting',
];
/** The three states the row actually has; `shell` and `idle` are both quiet. */
type RootStatus = 'busy' | 'waiting' | 'quiet';
function rootStatusFor(status: ClaudeSessionStatus): RootStatus {
	return status === 'busy' || status === 'waiting' ? status : 'quiet';
}
export interface SessionStatusRecord {
	readonly type: typeof SESSION_STATUS_RECORD_TYPE;
	readonly status: ClaudeSessionStatus;
	/** The file's own `statusUpdatedAt`, epoch milliseconds. */
	readonly statusUpdatedAt?: number;
	/** The file's own `waitingFor`, when it says what the wait is for. */
	readonly waitingFor?: string;
}
export function sessionStatusRecord(
	status: ClaudeSessionStatus,
	statusUpdatedAt: number | undefined,
	waitingFor: string | undefined,
): SessionStatusRecord {
	return {
		type: SESSION_STATUS_RECORD_TYPE,
		status,
		...(statusUpdatedAt === undefined ? {} : { statusUpdatedAt }),
		...(waitingFor === undefined ? {} : { waitingFor }),
	};
}
export function isClaudeSessionStatus(
	value: unknown,
): value is ClaudeSessionStatus {
	return CLAUDE_SESSION_STATUSES.includes(value as ClaudeSessionStatus);
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

interface ClaudeState {
	started: boolean;
	/**
	 * The last status published for the root, so a repeated status word
	 * republishes nothing. `undefined` until the session file is first read.
	 */
	status?: RootStatus;
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
	state.children.clear();
	state.completed.clear();
}

/**
 * Claude Code session mapping v0.2. It reads only lifecycle fields and an
 * allowlisted user-text preview. Tool input/output and assistant text never
 * cross the extension boundary.
 *
 * Two lanes, and they do not overlap:
 *
 * - The session file says what the root *is*. Its `status` — `busy`, `idle`,
 *   `shell`, `waiting` — is the only thing that moves the root between
 *   working, waiting and done. The CLI maintains that word for its own use and rewrites it as
 *   the state changes, so there is nothing to infer and nothing to miss.
 * - The journal says what the root is *doing*. Title, prompt, model, which
 *   tool is running, and the subagents it launched. None of it sets the root's
 *   state: a journal is written behind the work it describes, and a record
 *   landing after the CLI has gone idle must not put a finished session back
 *   to work.
 *
 * Subagents keep their own journal-derived lifecycle: they have no session
 * file of their own, and `idle` on the parent's file ends any that are left.
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
		// own records relabel it and carry none of its subagents.
		for (const child of scope.children)
			publisher.subagentDone({ subagentId: child, outcome: 'cancelled' });
		resetConversation(scope);
		return;
	}

	if (type === SESSION_STATUS_RECORD_TYPE) {
		applySessionStatus(envelope, session, scope);
		return;
	}

	// The header block is preceded by `last-prompt` and `ai-title` in the real
	// journal, so the session starts on whichever recognized record arrives
	// first rather than on the header specifically.
	if (
		!scope.started &&
		(TURN_HEADER.has(type) || type === 'ai-title' || type === 'last-prompt')
	) {
		start(session, scope, metadata(message));
		scope.headerSeen = TURN_HEADER.has(type);
		if (TURN_HEADER.has(type)) return;
	}
	if (TURN_HEADER.has(type)) {
		// Header blocks are bookkeeping. The real CLI writes one at session
		// start, another after the user prompt has been recorded, and another
		// after `turn_duration`; none of them is a state boundary.
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
	// Everything below is what the root is doing, not what it is.
	//
	// Which tool is running is only true of the present, so a record written at
	// or before the CLI's last idle mark — the journal is replayed from its
	// start on every bind — contributes nothing but the subagents it has to
	// keep closed. What the session is *about* has no such expiry: the model it
	// runs and the prompt it was given are read from those records too, or a
	// session that was already idle when this terminal bound would show a row
	// with no label and no model.
	const stale = beforeIdle(envelope, scope);
	if (type === 'user' && message.role === 'user' && envelope.isMeta !== true) {
		const results = content(message).filter(
			(item) => item.type === 'tool_result',
		);
		if (results.length > 0) {
			if (stale) return;
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
		// The prompt labels the row. Whether the session is working on it is the
		// session file's to say.
		const promptText = userText(message);
		if (promptText !== undefined) publisher.metadataChanged({ promptText });
		return;
	}
	if (type === 'assistant' && message.role === 'assistant') {
		if (envelope.isApiErrorMessage === true) {
			// A recorded fault, and the one thing the journal says that the status
			// word does not: the CLI stays `busy` while it retries. It is an
			// attention signal, not a claim about whether work is in flight, and
			// the next status the file reports supersedes it.
			if (stale) return;
			const waitId = id(envelope.uuid, 'error', envelope.requestId);
			if (waitId)
				publisher.waitStarted({
					waitId,
					state: 'blocked',
					reason: 'api-error',
				});
			return;
		}
		const modelMetadata = metadata(message);
		if (modelMetadata.model) publisher.metadataChanged(modelMetadata);
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
				if (stale) {
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
			} else if (!stale) {
				publisher.toolStarted({ toolId, name });
			}
		}
		return;
	}
}

/**
 * The root's state, and the only thing that sets it.
 *
 * `busy`, `waiting` and `idle` are the CLI's own words about itself, so each
 * is published as it arrives and a repeated word publishes nothing. `idle`
 * additionally closes any subagent still open: the process that owns them says
 * it is doing nothing, so whatever they were doing is over, whether or not
 * their journals ever said so.
 *
 * The first status read is a baseline, not a transition. Binding to a session
 * that is sitting at its prompt must leave the row idle: `done` is a turn
 * having ended, it marks the row unread, and a session that has not run
 * anything since this terminal bound has ended nothing.
 */
function applySessionStatus(
	envelope: JsonObject,
	session: AgentRecordContext,
	scope: ClaudeState,
): void {
	const word = envelope.status;
	if (!isClaudeSessionStatus(word)) return;
	start(session, scope, {});
	const publisher = session.publish;
	const status = rootStatusFor(word);
	const at = envelope.statusUpdatedAt;
	if (typeof at === 'number' && Number.isFinite(at) && status === 'quiet')
		scope.idleSince = Math.max(scope.idleSince ?? 0, at);
	if (scope.status === status) return;
	const previous = scope.status;
	scope.status = status;
	const waitId = `session-wait:${session.binding.providerSessionId}`;
	if (status === 'waiting') {
		publisher.waitStarted({
			waitId,
			state: 'waiting',
			reason: bounded(envelope.waitingFor, 200) ?? 'input-request',
		});
		return;
	}
	// Leaving a wait is its own event; the store admits a completion straight
	// from `waiting`, but not a turn.
	if (previous === 'waiting' && status === 'busy') {
		publisher.waitFinished({ waitId });
		return;
	}
	if (status === 'busy') {
		publisher.turnStarted({
			turnId: `status:${typeof at === 'number' ? at : Date.now()}`,
		});
		return;
	}
	for (const child of scope.children) {
		scope.completed.add(child);
		publisher.subagentDone({ subagentId: child, outcome: 'cancelled' });
	}
	scope.children.clear();
	// Quiet is only a completion if there was something to complete. The entry
	// is already idle from `session.started`, which is what a session sitting
	// at its prompt should read as.
	if (previous !== undefined) publisher.done({ outcome: 'success' });
}

/** One `session.started` per bound session, from whichever lane arrives first. */
function start(
	session: AgentRecordContext,
	scope: ClaudeState,
	extra: { model?: { id: string } },
): void {
	if (scope.started) return;
	scope.started = true;
	session.publish.sessionStarted({ title: 'Claude Code', ...extra });
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
