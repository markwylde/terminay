import { type JsonValue, protocolError } from '@terminay/protocol';
import { assertAutomationAuthority } from '../automationService/protocol.js';
import type { McpApprovalService } from '../mcpApprovals/index.js';
import type {
	CommandRequest,
	OperationRegistries,
	QueryRequest,
	RequestContext,
} from '../types.js';
import {
	AGENT_CHAT_LIMITS,
	AgentChatError,
	type AgentChatReach,
	type AgentChatService,
} from './service.js';

/** Stable protocol names for agent chats. */
export const AGENT_CHAT_OPERATIONS = Object.freeze({
	providers: 'agent-chat.providers',
	list: 'agent-chat.list',
	get: 'agent-chat.get',
	create: 'agent-chat.create',
	open: 'agent-chat.open',
	send: 'agent-chat.send',
	stop: 'agent-chat.stop',
	clear: 'agent-chat.clear',
	close: 'agent-chat.close',
	decideApproval: 'agent-chat.decide-approval',
} as const);

export const AGENT_CHAT_EVENTS = Object.freeze({
	/** `{ chatId, revision, removed? }`; readers fetch the chat itself. */
	changed: 'agent-chat.changed',
} as const);

export interface AgentChatOperationOptions {
	readonly service: AgentChatService;
	/** Pending approvals, for deciding one shown in a chat. */
	readonly approvals?: Pick<McpApprovalService, 'decide'>;
	/** Whether a project exists on this server, for a project-reach chat. */
	readonly projectExists?: (projectId: string) => boolean;
}

/**
 * Agent chats over the authenticated protocol. Every operation needs the
 * authority to create terminals on this server, because a chat can act on
 * terminals; a project- or session-bound client is refused.
 */
export function createAgentChatOperationHandlers(
	options: AgentChatOperationOptions,
): OperationRegistries {
	const { service } = options;
	const policy = { scope: 'write' } as const;
	const run = async <T>(work: () => T | Promise<T>): Promise<JsonValue> => {
		try {
			return (await work()) as unknown as JsonValue;
		} catch (error) {
			throw mapError(error);
		}
	};
	return {
		queries: {
			[AGENT_CHAT_OPERATIONS.providers]: (request: QueryRequest) => {
				authorize(request.context);
				return run(async () => ({ providers: await service.providers() }));
			},
			[AGENT_CHAT_OPERATIONS.list]: (request: QueryRequest) => {
				authorize(request.context);
				return run(() => ({ chats: service.list() }));
			},
			[AGENT_CHAT_OPERATIONS.get]: (request: QueryRequest) => {
				authorize(request.context);
				const payload = objectPayload(request.envelope.payload);
				const chatId = idField(payload.chatId, 'chatId');
				const after =
					payload.afterRevision === undefined
						? 0
						: uint(payload.afterRevision, 'afterRevision');
				return run(() => service.get(chatId, after));
			},
		},
		commands: {
			[AGENT_CHAT_OPERATIONS.create]: (request: CommandRequest) => {
				authorize(request.context);
				const payload = objectPayload(request.envelope.payload);
				const input = createInput(payload);
				// A summary carries its own `revision`, so it is wrapped: a bare
				// one would be read as a result envelope and lose its fields.
				return run(() => ({ result: service.create(input) }));
			},
			[AGENT_CHAT_OPERATIONS.open]: (request: CommandRequest) => {
				authorize(request.context);
				const payload = objectPayload(request.envelope.payload);
				const input = createInput(payload);
				if (input.key === undefined)
					throw protocolError('validation', 'opening a chat needs a key');
				return run(() => ({
					result: service.open({ ...input, key: input.key as string }),
				}));
			},
			[AGENT_CHAT_OPERATIONS.send]: (request: CommandRequest) => {
				authorize(request.context);
				const payload = objectPayload(request.envelope.payload);
				const chatId = idField(payload.chatId, 'chatId');
				if (typeof payload.text !== 'string')
					throw protocolError('validation', 'text is required');
				const text = payload.text;
				return run(() => {
					service.send(chatId, text);
					return { chatId, accepted: true };
				});
			},
			[AGENT_CHAT_OPERATIONS.stop]: (request: CommandRequest) => {
				authorize(request.context);
				const chatId = idField(
					objectPayload(request.envelope.payload).chatId,
					'chatId',
				);
				return run(async () => {
					await service.stop(chatId);
					return { chatId, stopped: true };
				});
			},
			[AGENT_CHAT_OPERATIONS.clear]: (request: CommandRequest) => {
				authorize(request.context);
				const chatId = idField(
					objectPayload(request.envelope.payload).chatId,
					'chatId',
				);
				return run(async () => {
					await service.clear(chatId);
					return { chatId, cleared: true };
				});
			},
			[AGENT_CHAT_OPERATIONS.close]: (request: CommandRequest) => {
				authorize(request.context);
				const chatId = idField(
					objectPayload(request.envelope.payload).chatId,
					'chatId',
				);
				return run(async () => {
					await service.close(chatId);
					return { chatId, closed: true };
				});
			},
			[AGENT_CHAT_OPERATIONS.decideApproval]: (request: CommandRequest) => {
				authorize(request.context);
				const payload = objectPayload(request.envelope.payload);
				const chatId = idField(payload.chatId, 'chatId');
				const approvalId = idField(payload.approvalId, 'approvalId');
				const decision = payload.decision;
				if (
					decision !== 'once' &&
					decision !== 'session' &&
					decision !== 'decline'
				)
					throw protocolError('validation', 'approval decision is invalid');
				// Only an approval this chat is showing can be decided through it.
				if (
					options.approvals === undefined ||
					!service.hasApproval(chatId, approvalId) ||
					!options.approvals.decide(approvalId, decision)
				)
					throw protocolError('not_found', 'approval is no longer pending');
				return { chatId, approvalId, decision };
			},
		},
		policies: Object.fromEntries(
			Object.values(AGENT_CHAT_OPERATIONS).map((name) => [name, policy]),
		),
	};

	function createInput(payload: Readonly<Record<string, unknown>>) {
		const providerId = idField(payload.providerId, 'providerId');
		if (typeof payload.title !== 'string')
			throw protocolError('validation', 'title is required');
		const reach = reachField(payload.reach);
		if (
			reach.kind === 'project' &&
			options.projectExists !== undefined &&
			!options.projectExists(reach.projectId)
		)
			throw protocolError('not_found', 'project not found on this server');
		const key =
			payload.key === undefined ? undefined : idField(payload.key, 'key');
		// A client never supplies an instruction or the reserved key.
		return {
			providerId,
			title: payload.title,
			reach,
			...(key === undefined ? {} : { key }),
		};
	}
}

/**
 * Show each chat's MCP approvals in that chat, and record how they ended.
 * Returns the unsubscribe.
 */
export function bindAgentChatApprovals(
	service: AgentChatService,
	approvals: Pick<McpApprovalService, 'list' | 'subscribe' | 'onSettled'>,
): () => void {
	const show = (): void => {
		for (const view of approvals.list()) {
			if (view.chatId === undefined) continue;
			service.approvalPending({
				approvalId: view.id,
				chatId: view.chatId,
				summary: view.summary,
				groupLabel: view.groupLabel,
				details: view.details,
			});
		}
	};
	const unsubscribe = approvals.subscribe(show);
	const unsettle = approvals.onSettled((view, outcome) => {
		if (view.chatId !== undefined)
			service.approvalSettled(view.id, view.chatId, outcome);
	});
	show();
	return () => {
		unsubscribe();
		unsettle();
	};
}

function authorize(context: RequestContext): void {
	try {
		assertAutomationAuthority(context);
	} catch {
		throw protocolError(
			'forbidden',
			'agent chats require authority to create terminals on this server',
		);
	}
}

function mapError(error: unknown) {
	if (!(error instanceof AgentChatError)) return error;
	const details = {
		reason: error.code,
		...(error.reason === undefined ? {} : { availability: error.reason }),
	};
	switch (error.code) {
		case 'validation':
			return protocolError('validation', error.message, { details });
		case 'not_found':
			return protocolError('not_found', error.message, { details });
		case 'chat_busy':
			return protocolError('conflict', error.message, { details });
		case 'chat_limit_reached':
			return protocolError('resource', error.message, { details });
		case 'reserved_key':
			return protocolError('forbidden', error.message, { details });
		default:
			return protocolError('unavailable', error.message, { details });
	}
}

function reachField(value: unknown): AgentChatReach {
	const reach = objectPayload(value ?? { kind: 'none' });
	if (reach.kind === 'none' || reach.kind === 'workspace')
		return { kind: reach.kind };
	if (reach.kind === 'project')
		return {
			kind: 'project',
			projectId: idField(reach.projectId, 'projectId'),
		};
	throw protocolError('validation', 'reach is invalid');
}

function objectPayload(value: unknown): Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw protocolError('validation', 'payload must be an object');
	return value as Readonly<Record<string, unknown>>;
}

function idField(value: unknown, name: string): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > 128 ||
		/[\0\r\n]/.test(value)
	)
		throw protocolError('validation', `${name} is invalid`);
	return value;
}

function uint(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0)
		throw protocolError('validation', `${name} is invalid`);
	return value as number;
}

export { AGENT_CHAT_LIMITS };
