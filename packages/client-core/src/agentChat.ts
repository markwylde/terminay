import type { JsonValue } from '@terminay/protocol';
import type { QueryCommandTransport } from './queryCommand.js';
import type { ClientEvent } from './types.js';

/** A server that serves agent chats and Pixel says so in its hello. */
export const AGENT_CHAT_CAPABILITY = 'agent-chat.v1' as const;

/** Mirrors the server's Pixel operation names. */
export const PIXEL_OPERATIONS = Object.freeze({
	state: 'pixel.state',
	open: 'pixel.open',
	changed: 'pixel.changed',
} as const);

/** Mirrors the server's agent chat operation names. */
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
	changed: 'agent-chat.changed',
} as const);

export type AgentChatReach =
	| { readonly kind: 'none' }
	| { readonly kind: 'project'; readonly projectId: string }
	| { readonly kind: 'workspace' };

export type AgentChatStatus = 'idle' | 'thinking' | 'streaming';

export type AgentChatPart =
	| { readonly type: 'text'; readonly text: string }
	| {
			readonly type: 'activity';
			readonly callId: string;
			readonly text: string;
			readonly state: 'running' | 'completed' | 'failed';
	  };

export type AgentChatApprovalState =
	| 'pending'
	| 'allowed-once'
	| 'allowed-session'
	| 'declined'
	| 'allowed-by-policy'
	| 'denied-by-policy'
	| 'ended';

export type AgentChatEntry = (
	| { readonly kind: 'user'; readonly text: string }
	| { readonly kind: 'assistant'; readonly parts: readonly AgentChatPart[] }
	| {
			readonly kind: 'approval';
			readonly approvalId: string;
			readonly statement: string;
			readonly groupLabel: string;
			readonly details: readonly {
				readonly label: string;
				readonly value: string;
				readonly code?: boolean;
			}[];
			readonly state: AgentChatApprovalState;
	  }
	| {
			readonly kind: 'notice';
			readonly tone: 'info' | 'error';
			readonly text: string;
	  }
) & {
	readonly id: string;
	readonly createdAt: number;
	readonly revision: number;
};

export interface AgentChatSummary {
	readonly id: string;
	readonly key?: string;
	readonly title: string;
	readonly providerId: string;
	readonly providerName: string;
	readonly reach: AgentChatReach;
	readonly status: AgentChatStatus;
	readonly revision: number;
	readonly pendingApprovals: number;
	readonly createdAt: number;
}

export interface AgentChatView extends AgentChatSummary {
	readonly order: readonly string[];
	readonly entries: readonly AgentChatEntry[];
}

export interface AgentChatProvider {
	readonly id: string;
	readonly displayName: string;
	readonly available: boolean;
	readonly reason?:
		| 'not_installed'
		| 'not_signed_in'
		| 'unsupported_platform'
		| 'disabled';
	readonly detail?: string;
}

export type AgentChatDecision = 'once' | 'session' | 'decline';

export interface AgentChatClientTransport extends QueryCommandTransport {
	subscribe: (
		event: string,
		listener: (event: ClientEvent<unknown>) => void,
		onResync?: () => void,
	) => (() => void) | Promise<() => void>;
}

/** A thin client of the server's agent chats; the server holds everything. */
export class AgentChatClient {
	constructor(private readonly transport: AgentChatClientTransport) {}

	async providers(): Promise<readonly AgentChatProvider[]> {
		const result = (await this.transport.query(
			AGENT_CHAT_OPERATIONS.providers,
		)) as unknown as {
			providers: AgentChatProvider[];
		};
		return result.providers;
	}

	async list(): Promise<readonly AgentChatSummary[]> {
		const result = (await this.transport.query(
			AGENT_CHAT_OPERATIONS.list,
		)) as unknown as {
			chats: AgentChatSummary[];
		};
		return result.chats;
	}

	async get(chatId: string, afterRevision = 0): Promise<AgentChatView> {
		return (await this.transport.query(AGENT_CHAT_OPERATIONS.get, {
			chatId,
			afterRevision,
		})) as unknown as AgentChatView;
	}

	async create(input: {
		readonly providerId: string;
		readonly title: string;
		readonly reach: AgentChatReach;
		readonly key?: string;
	}): Promise<AgentChatSummary> {
		return (await this.transport.command(
			AGENT_CHAT_OPERATIONS.create,
			input as unknown as JsonValue,
		)) as unknown as AgentChatSummary;
	}

	async send(chatId: string, text: string): Promise<void> {
		await this.transport.command(AGENT_CHAT_OPERATIONS.send, { chatId, text });
	}

	async stop(chatId: string): Promise<void> {
		await this.transport.command(AGENT_CHAT_OPERATIONS.stop, { chatId });
	}

	async clear(chatId: string): Promise<void> {
		await this.transport.command(AGENT_CHAT_OPERATIONS.clear, { chatId });
	}

	async close(chatId: string): Promise<void> {
		await this.transport.command(AGENT_CHAT_OPERATIONS.close, { chatId });
	}

	async decideApproval(
		chatId: string,
		approvalId: string,
		decision: AgentChatDecision,
	): Promise<void> {
		await this.transport.command(AGENT_CHAT_OPERATIONS.decideApproval, {
			chatId,
			approvalId,
			decision,
		});
	}

	/**
	 * Keep a local copy of one chat. Change notices carry only a revision, so
	 * the mirror reads what changed after the revision it holds, and reads the
	 * whole chat after a missed notice or a reconnect.
	 */
	async mirror(
		chatId: string,
		listener: (chat: AgentChatView | undefined) => void,
	): Promise<() => void> {
		let current: AgentChatView | undefined;
		let fetching: Promise<void> | undefined;
		let again = false;
		let closed = false;
		const fetch = (full: boolean): Promise<void> => {
			if (fetching !== undefined) {
				again = true;
				return fetching;
			}
			fetching = (async () => {
				try {
					do {
						again = false;
						try {
							const after = full || current === undefined ? 0 : current.revision;
							const view = await this.get(chatId, after);
							if (closed) return;
							current = merge(current, view, after);
							listener(current);
						} catch (error) {
							if (isNotFound(error)) {
								current = undefined;
								if (!closed) listener(undefined);
								return;
							}
							throw error;
						}
					} while (again && !closed);
				} finally {
					// Cleared the moment the loop stops, not a turn later: a change
					// reported in between would join a read that has already ended.
					fetching = undefined;
				}
			})();
			return fetching;
		};
		const unsubscribe = await this.transport.subscribe(
			AGENT_CHAT_OPERATIONS.changed,
			(event) => {
				const change = event.payload as {
					chatId?: string;
					revision?: number;
					removed?: boolean;
				};
				if (change?.chatId !== chatId) return;
				if (change.removed === true) {
					current = undefined;
					listener(undefined);
					return;
				}
				if (current !== undefined && (change.revision ?? 0) <= current.revision)
					return;
				void fetch(false).catch(() => undefined);
			},
			() => void fetch(true).catch(() => undefined),
		);
		await fetch(true).catch((error) => {
			unsubscribe();
			throw error;
		});
		return () => {
			closed = true;
			try {
				unsubscribe();
			} catch {
				/* expected disconnect cleanup is local */
			}
		};
	}
}

/** Apply a read made after `after` to the copy held at that revision. */
export function merge(
	current: AgentChatView | undefined,
	view: AgentChatView,
	after: number,
): AgentChatView {
	if (current === undefined || after === 0) return view;
	const byId = new Map(current.entries.map((entry) => [entry.id, entry]));
	for (const entry of view.entries) byId.set(entry.id, entry);
	const entries = view.order
		.map((id) => byId.get(id))
		.filter((entry): entry is AgentChatEntry => entry !== undefined);
	return { ...view, entries };
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		(error as { code?: unknown }).code === 'not_found'
	);
}
