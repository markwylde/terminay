import { LIMITS } from './store.js';

function object(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value
		: undefined;
}
function text(value, limit) {
	return typeof value === 'string' && value.length > 0 && value.length <= limit
		? value
		: undefined;
}
export function emptyState() {
	return {
		started: false,
		titled: false,
		turnOpen: false,
		faulted: false,
		tools: new Set(),
		waits: new Set(),
		children: new Set(),
	};
}
/**
 * OpenCode `(opencode, 0.1)`.
 *
 * Records are read from the store's append-only `event` log. Only lifecycle
 * and bounded display fields are taken: a tool part contributes its name, call
 * id and status, never `state.input` or `state.output`, and a message
 * contributes its role and completion, never its text.
 */
export function mapOpenCodeEvent(type, raw, context) {
	let payload;
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
			state.turnOpen = true;
			state.faulted = false;
			const id = text(info.id, LIMITS.sessionId) ?? context.rootId;
			publish.turnStarted({ turnId: `opencode:turn:${id}` });
			return;
		}
		if (role !== 'assistant') return;
		const error = object(info.error) ?? text(info.error, 200);
		const finish = text(info.finish, 64);
		if (error !== undefined && !finish) {
			// A recorded fault with no completion halts the turn. OpenCode
			// records no explicitly blocking condition, so this is derived.
			if (state.faulted) return;
			state.faulted = true;
			publish.waitStarted({
				waitId: `opencode:fault:${context.rootId}`,
				state: 'blocked',
				reason: 'assistant-error',
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
						: finish.includes('cancel') || finish.includes('abort')
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
		const status = text(object(part.state)?.status, 32);
		if (status === 'pending') {
			// A tool part is pending while it waits for the user to approve it.
			if (state.waits.has(callId)) return;
			state.waits.add(callId);
			publish.waitStarted({
				waitId: callId,
				state: 'waiting',
				reason: `permission:${name}`,
			});
			return;
		}
		if (state.waits.delete(callId)) publish.waitFinished({ waitId: callId });
		if (status === 'running') {
			if (name === 'task') {
				if (state.children.has(callId)) return;
				state.children.add(callId);
				const title = text(object(part.state)?.title, LIMITS.title);
				publish.subagentStarted({
					subagentId: callId,
					parentAgentId: context.rootId,
					...(title ? { title } : {}),
				});
				return;
			}
			if (state.tools.has(callId)) return;
			state.tools.add(callId);
			publish.toolStarted({ toolId: callId, name });
			return;
		}
		if (status === 'completed' || status === 'error') {
			const outcome = status === 'error' ? 'error' : 'success';
			if (state.children.delete(callId)) {
				publish.subagentDone({ subagentId: callId, outcome });
				return;
			}
			if (!state.tools.delete(callId)) return;
			publish.toolFinished({ toolId: callId, outcome });
		}
	}
}
//# sourceMappingURL=mapping.js.map
