import type { AgentLifecyclePublisher } from '@terminay/extension-api';
import { LIMITS } from './store.js';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as JsonObject)
		: undefined;
}

function text(value: unknown, limit: number): string | undefined {
	return typeof value === 'string' && value.length > 0 && value.length <= limit
		? value
		: undefined;
}

export interface OpenCodeMapState {
	started: boolean;
	titled: boolean;
	turnOpen: boolean;
	faulted: boolean;
	/**
	 * User message ids that have already opened a turn. OpenCode re-stores a
	 * user message after the turn completes (to record its diff summary), so a
	 * turn is keyed by message id and never reopened by a later update.
	 */
	turns: Set<string>;
	/** Tool call ids currently running, so a completion matches its start. */
	tools: Set<string>;
	children: Set<string>;
	/**
	 * Child call ids whose label has already been published. A `task` part is
	 * first written with an empty `state.input`, so the label arrives on a later
	 * record and is published then as a repeated start for the same child.
	 */
	labelled: Set<string>;
}

export function emptyState(): OpenCodeMapState {
	return {
		started: false,
		titled: false,
		turnOpen: false,
		faulted: false,
		turns: new Set(),
		tools: new Set(),
		children: new Set(),
		labelled: new Set(),
	};
}

/**
 * The bounded human label for a `task` child.
 *
 * OpenCode records a short `state.input.description` for every task call, and
 * that is the only field taken. The child's prompt is conversation content: it
 * is used solely as a last resort, and then never beyond its first line, capped
 * well below a full instruction, so no prompt body is ever projected.
 */
const SUBAGENT_LABEL_LIMIT = 80;

export function subagentLabel(
	state: JsonObject | undefined,
): string | undefined {
	if (!state) return undefined;
	const declared =
		text(state.title, LIMITS.title) ??
		text(object(state.input)?.description, LIMITS.title);
	if (declared) return declared;
	const prompt = object(state.input)?.prompt;
	if (typeof prompt !== 'string') return undefined;
	const line = prompt.split('\n', 1)[0]?.trim() ?? '';
	if (line.length === 0) return undefined;
	return line.length > SUBAGENT_LABEL_LIMIT
		? `${line.slice(0, SUBAGENT_LABEL_LIMIT - 1)}\u2026`
		: line;
}

export interface OpenCodeMapContext {
	readonly publish: AgentLifecyclePublisher;
	readonly rootId: string;
	readonly state: OpenCodeMapState;
}

/**
 * OpenCode `(opencode, 0.1)`.
 *
 * Records are read from the store's append-only `event` log. Only lifecycle
 * and bounded display fields are taken: a tool part contributes its name, call
 * id and status, never `state.input` or `state.output`, and a message
 * contributes its role and completion, never its text.
 */
export function mapOpenCodeEvent(
	type: string,
	raw: string,
	context: OpenCodeMapContext,
): void {
	let payload: unknown;
	try {
		payload = JSON.parse(raw);
	} catch {
		return;
	}
	const envelope = object(payload);
	if (!envelope) return;
	const { publish, state } = context;
	const kind = type.replace(/\.\d+$/u, '');

	if (kind === 'session.created' || kind === 'session.updated') {
		const info = object(envelope.info);
		if (!info) return;
		const id = text(info.id, LIMITS.sessionId);
		if (id !== context.rootId) return;
		if (!state.started) {
			state.started = true;
			publish.sessionStarted({ title: 'OpenCode' });
			// The slug is OpenCode's own deterministic name for a session, so a
			// root is never unlabelled while it waits for a generated title.
			const slug = text(info.slug, LIMITS.slug);
			if (slug) publish.metadataChanged({ title: slug });
		}
		const title = text(info.title, LIMITS.title);
		if (title && !state.titled) {
			state.titled = true;
			publish.metadataChanged({ title });
		} else if (title && state.titled) {
			publish.metadataChanged({ title });
		}
		const model = text(info.model, LIMITS.title);
		if (model) publish.metadataChanged({ model: { id: model } });
		return;
	}

	if (kind === 'message.updated') {
		const info = object(envelope.info);
		if (!info) return;
		const role = text(info.role, 32);
		if (role === 'user') {
			const id = text(info.id, LIMITS.sessionId) ?? context.rootId;
			// Only the first record of a user message opens a turn. A re-store of
			// the same message — OpenCode writes one when it attaches the turn's
			// diff summary, after the assistant has completed — would otherwise
			// reopen a finished turn and leave the entry working forever.
			if (state.turns.has(id)) return;
			state.turns.add(id);
			state.turnOpen = true;
			state.faulted = false;
			publish.turnStarted({ turnId: `opencode:turn:${id}` });
			return;
		}
		if (role !== 'assistant') return;
		const error = object(info.error);
		const errorName = error ? text(error.name, 200) : undefined;
		const finish = text(info.finish, 64);
		// An abort is the user stopping the turn, not a fault needing
		// intervention. Observed on a real store: 77 of 99 recorded errors are
		// MessageAbortedError, and 96 of 99 carry no completion, so treating any
		// error without a completion as blocked would paint ordinary
		// cancellations red.
		const aborted = errorName !== undefined && /abort|cancel/iu.test(errorName);
		if (error !== undefined && aborted) {
			state.turnOpen = false;
			state.faulted = false;
			publish.done({ outcome: 'cancelled' });
			return;
		}
		if (error !== undefined && !finish) {
			// A recorded fault that halts the turn. OpenCode records no explicitly
			// blocking condition, so this is derived.
			if (state.faulted) return;
			state.faulted = true;
			publish.waitStarted({
				waitId: `opencode:fault:${context.rootId}`,
				state: 'blocked',
				reason: errorName ?? 'assistant-error',
				inferred: true,
			});
			return;
		}
		if (!finish) return;
		state.turnOpen = false;
		state.faulted = false;
		publish.done({
			outcome:
				error !== undefined
					? 'error'
					: finish === 'stop' || finish === 'end_turn'
						? 'success'
						: /cancel|abort/iu.test(finish)
							? 'cancelled'
							: 'success',
		});
		return;
	}

	if (kind === 'message.part.updated') {
		const part = object(envelope.part);
		if (!part || text(part.type, 32) !== 'tool') return;
		const callId = text(part.callID, LIMITS.toolId);
		const name = text(part.tool, LIMITS.toolName);
		if (!callId || !name) return;
		const partState = object(part.state);
		const status = text(partState?.status, 32);
		// `pending` is the state every tool part is first written in, before its
		// input has streamed in: on this store 6,901 pending records span every
		// tool, and the store holds no record of an approval request of any kind
		// (`session.info.permission` is the configured policy, never an ask). So
		// a pending part is not a permission wait and never reports `waiting`.
		if (status === 'pending') return;
		if (name === 'task') {
			mapTaskPart(callId, status, partState, context);
			return;
		}
		if (status === 'running') {
			if (state.tools.has(callId)) return;
			state.tools.add(callId);
			publish.toolStarted({ toolId: callId, name });
			return;
		}
		if (status === 'completed' || status === 'error') {
			if (!state.tools.delete(callId)) return;
			publish.toolFinished({
				toolId: callId,
				outcome: status === 'error' ? 'error' : 'success',
			});
		}
	}
}

/**
 * A `task` part is a child agent. Its label is absent from the first record and
 * appears with the tool input, so the start is republished once the label is
 * known: the canonical publisher merges a repeated start for the same child.
 */
function mapTaskPart(
	callId: string,
	status: string | undefined,
	partState: JsonObject | undefined,
	context: OpenCodeMapContext,
): void {
	const { publish, state } = context;
	const title = subagentLabel(partState);
	const known = state.children.has(callId);
	if (!known || (title && !state.labelled.has(callId))) {
		if (title) state.labelled.add(callId);
		state.children.add(callId);
		publish.subagentStarted({
			subagentId: callId,
			parentAgentId: context.rootId,
			...(title ? { title } : {}),
		});
	}
	if (status !== 'completed' && status !== 'error') return;
	if (!state.children.delete(callId)) return;
	state.labelled.delete(callId);
	publish.subagentDone({
		subagentId: callId,
		outcome: status === 'error' ? 'error' : 'success',
	});
}
