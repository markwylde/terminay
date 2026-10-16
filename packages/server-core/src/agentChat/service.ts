import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
	AgentChatAvailability,
	AgentChatEvent,
	AgentChatFailure,
	AgentChatMcpServer,
	AgentChatSessionRequest,
} from '@terminay/extension-api';

/**
 * Server-owned agent chats. The service holds every chat, its conversation,
 * its provider session and its MCP capability; extensions only run turns.
 * Nothing here is written to disk except each session's empty working
 * directory, and a server restart starts with no chats.
 */

export const AGENT_CHAT_LIMITS = Object.freeze({
	chats: 8,
	entries: 200,
	textLength: 64 * 1024,
	messageLength: 16 * 1024,
	titleLength: 80,
	keyLength: 64,
	instructionLength: 8 * 1024,
	/** A turn that reports nothing for this long, with no approval pending, fails. */
	inactivityMs: 10 * 60_000,
	/** Provider availability answers are reused for this long. */
	availabilityTtlMs: 10_000,
});

/** The key only the Pixel feature may use; clients cannot create it. */
export const PIXEL_CHAT_KEY = 'pixel';

/**
 * The caller key a chat's MCP capability, approvals and grants are held
 * under. The control endpoint reserves the same prefix (ADR-0068).
 */
export function agentChatCallerKey(chatId: string): string {
	return `chat:${chatId}`;
}

/** The name a chat's MCP server is registered under in every agent. */
export const AGENT_CHAT_MCP_SERVER_NAME = 'terminay_chat';

export type AgentChatReach =
	| { readonly kind: 'none' }
	| { readonly kind: 'project'; readonly projectId: string }
	| { readonly kind: 'workspace' };

export type AgentChatStatus = 'idle' | 'thinking' | 'streaming';

export type AgentChatActivityState = 'running' | 'completed' | 'failed';

export type AgentChatPart =
	| { readonly type: 'text'; readonly text: string }
	| {
			readonly type: 'activity';
			readonly callId: string;
			readonly text: string;
			readonly state: AgentChatActivityState;
	  };

export type AgentChatApprovalState =
	| 'pending'
	| 'allowed-once'
	| 'allowed-session'
	| 'declined'
	| 'allowed-by-policy'
	| 'denied-by-policy'
	| 'ended';

export interface AgentChatApprovalDetail {
	readonly label: string;
	readonly value: string;
	readonly code?: boolean;
}

export type AgentChatEntry = (
	| { readonly kind: 'user'; readonly text: string }
	| { readonly kind: 'assistant'; readonly parts: readonly AgentChatPart[] }
	| {
			readonly kind: 'approval';
			readonly approvalId: string;
			/** e.g. "Pixel (Claude Code) wants to run `npm test` in api". */
			readonly statement: string;
			readonly groupLabel: string;
			readonly details: readonly AgentChatApprovalDetail[];
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
	/** The chat revision that last changed this entry. */
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
	/** Every entry id, oldest first. */
	readonly order: readonly string[];
	/** The entries changed after the revision the reader asked from. */
	readonly entries: readonly AgentChatEntry[];
}

export interface AgentChatProviderView {
	readonly id: string;
	readonly displayName: string;
	readonly available: boolean;
	readonly reason?: AgentChatAvailabilityReason;
	readonly detail?: string;
}

export type AgentChatAvailabilityReason =
	| 'not_installed'
	| 'not_signed_in'
	| 'unsupported_platform'
	| 'disabled';

/** One open provider session, as the extension manager returns it. */
export interface AgentChatProviderSession {
	prompt(text: string, signal?: AbortSignal): Promise<void>;
	cancel(): Promise<void>;
	close(): Promise<void>;
}

/** What the service needs from the extension platform. */
export interface AgentChatProviderBridge {
	providers(): readonly { readonly id: string; readonly displayName: string }[];
	availability(
		providerId: string,
		signal?: AbortSignal,
	): Promise<AgentChatAvailability>;
	openSession(
		providerId: string,
		request: AgentChatSessionRequest,
		onEvent: (event: AgentChatEvent) => void,
	): Promise<AgentChatProviderSession>;
}

/** The MCP side, supplied by the host that serves the control socket. */
export interface AgentChatMcpBridge {
	/** Mint the chat's single capability for the given reach. */
	mint(
		chatId: string,
		reach: Exclude<AgentChatReach, { kind: 'none' }>,
	): { readonly token: string };
	/** End the chat's capability, its pending approvals and its grants. */
	revoke(chatId: string): void;
	/** The command that starts the Terminay MCP adapter with this token. */
	serverEntry(token: string): Omit<AgentChatMcpServer, 'name'>;
	/** Withdraw the chat's pending approvals, keeping its grants. */
	cancelPendingApprovals(chatId: string): void;
	/**
	 * Whether the host reports each of a chat's Terminay MCP calls itself
	 * through `noteMcpCall`, so provider-reported calls to that server are
	 * not shown twice.
	 */
	readonly notesCalls?: boolean;
}

export interface AgentChatDiagnostic {
	readonly event: 'session-started' | 'session-ended' | 'turn-failed';
	readonly chatId: string;
	readonly providerId: string;
	readonly reason?: string;
	readonly exitCode?: number | null;
	readonly signal?: string | null;
	readonly deliberate?: boolean;
}

export interface AgentChatServiceOptions {
	readonly providers: AgentChatProviderBridge;
	readonly mcp?: AgentChatMcpBridge;
	/** Where each session's empty, private working directory is created. */
	readonly workRoot: string;
	/** Called after a chat changes, with only its id and revision. */
	readonly onChanged?: (change: {
		readonly chatId: string;
		readonly revision: number;
		readonly removed?: boolean;
	}) => void;
	readonly onDiagnostic?: (diagnostic: AgentChatDiagnostic) => void;
	readonly now?: () => number;
	readonly inactivityMs?: number;
	/** Coalesce change notifications for streaming text; 0 disables. */
	readonly changeCoalesceMs?: number;
}

export class AgentChatError extends Error {
	constructor(
		readonly code:
			| 'validation'
			| 'not_found'
			| 'chat_busy'
			| 'chat_limit_reached'
			| 'provider_unavailable'
			| 'mcp_unavailable'
			| 'reserved_key',
		message: string,
		readonly reason?: AgentChatAvailabilityReason,
	) {
		super(message);
		this.name = 'AgentChatError';
	}
}

export interface CreateAgentChatInput {
	readonly providerId: string;
	readonly title: string;
	readonly reach: AgentChatReach;
	readonly key?: string;
	/** Set only by a server feature, never taken from a client. */
	readonly instruction?: string;
	/** Allows the reserved Pixel key; only the Pixel feature passes it. */
	readonly allowReservedKey?: boolean;
}

interface OpenSession {
	readonly sessionId: string;
	readonly handle: AgentChatProviderSession;
	readonly workingDirectory: string;
	closing: boolean;
}

interface ChatRecord {
	readonly id: string;
	readonly key?: string;
	readonly title: string;
	readonly providerId: string;
	readonly providerName: string;
	readonly reach: AgentChatReach;
	readonly instruction?: string;
	readonly createdAt: number;
	status: AgentChatStatus;
	revision: number;
	entries: AgentChatEntry[];
	session?: OpenSession;
	opening?: Promise<OpenSession>;
	/** The assistant entry the running turn appends to. */
	reply?: string;
	turn?: AbortController;
	/** A failure was already shown for the running turn. */
	turnFailed: boolean;
	/** The last session ended unexpectedly, so the next one starts fresh. */
	memoryLost: boolean;
	inactivity?: ReturnType<typeof setTimeout>;
	notify?: ReturnType<typeof setTimeout>;
	closed: boolean;
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class AgentChatService {
	private readonly chats = new Map<string, ChatRecord>();
	private readonly knownProviders = new Map<string, string>();
	private readonly availabilityCache = new Map<
		string,
		{ readonly at: number; readonly value: AgentChatAvailability }
	>();
	private readonly now: () => number;
	private readonly inactivityMs: number;
	private readonly coalesceMs: number;
	private stopped = false;

	constructor(private readonly options: AgentChatServiceOptions) {
		this.now = options.now ?? Date.now;
		this.inactivityMs = options.inactivityMs ?? AGENT_CHAT_LIMITS.inactivityMs;
		this.coalesceMs = options.changeCoalesceMs ?? 50;
	}

	// ---------- providers ----------

	async providers(
		signal?: AbortSignal,
	): Promise<readonly AgentChatProviderView[]> {
		const running = this.options.providers.providers();
		for (const provider of running)
			this.knownProviders.set(provider.id, provider.displayName);
		const runningIds = new Set(running.map((provider) => provider.id));
		const views: AgentChatProviderView[] = [];
		for (const [id, displayName] of this.knownProviders) {
			if (!runningIds.has(id)) {
				views.push({ id, displayName, available: false, reason: 'disabled' });
				continue;
			}
			const availability = await this.availability(id, signal).catch(
				(): AgentChatAvailability => ({
					available: false,
					reason: 'not_installed',
				}),
			);
			views.push({
				id,
				displayName,
				...(availability.available
					? { available: true }
					: { available: false, reason: availability.reason }),
				...(availability.detail === undefined
					? {}
					: { detail: availability.detail }),
			});
		}
		return views;
	}

	/** "Pixel (Claude Code)": how a chat is named in its approval prompts. */
	agentName(chatId: string): string | undefined {
		const chat = this.chats.get(chatId);
		return chat === undefined
			? undefined
			: `${chat.title} (${chat.providerName})`;
	}

	// ---------- chats ----------

	list(): readonly AgentChatSummary[] {
		return [...this.chats.values()].map((chat) => this.summary(chat));
	}

	get(chatId: string, afterRevision = 0): AgentChatView {
		const chat = this.require(chatId);
		return {
			...this.summary(chat),
			order: chat.entries.map((entry) => entry.id),
			entries: chat.entries.filter((entry) => entry.revision > afterRevision),
		};
	}

	findByKey(key: string): AgentChatSummary | undefined {
		const chat = [...this.chats.values()].find((record) => record.key === key);
		return chat === undefined ? undefined : this.summary(chat);
	}

	create(input: CreateAgentChatInput): AgentChatSummary {
		this.assertRunning();
		const title = boundedLine(input.title, AGENT_CHAT_LIMITS.titleLength);
		if (title === undefined)
			throw new AgentChatError('validation', 'a chat needs a title');
		const reach = validReach(input.reach);
		if (input.key !== undefined) {
			if (!KEY_PATTERN.test(input.key))
				throw new AgentChatError('validation', 'chat key is invalid');
			if (input.key === PIXEL_CHAT_KEY && input.allowReservedKey !== true)
				throw new AgentChatError('reserved_key', 'that chat key is reserved');
			if (this.findByKey(input.key) !== undefined)
				throw new AgentChatError('validation', 'a chat with that key exists');
		}
		if (
			input.instruction !== undefined &&
			input.instruction.length > AGENT_CHAT_LIMITS.instructionLength
		)
			throw new AgentChatError('validation', 'chat instruction is too long');
		if (reach.kind !== 'none' && this.options.mcp === undefined)
			throw new AgentChatError(
				'mcp_unavailable',
				'Terminay MCP is not available on this server, so a chat cannot reach its terminals.',
			);
		if (this.chats.size >= AGENT_CHAT_LIMITS.chats)
			throw new AgentChatError(
				'chat_limit_reached',
				`This server already has ${AGENT_CHAT_LIMITS.chats} chats open. Close one first.`,
			);
		const provider = this.options.providers
			.providers()
			.find((candidate) => candidate.id === input.providerId);
		if (provider === undefined)
			throw new AgentChatError(
				'provider_unavailable',
				'That agent is not available.',
				this.knownProviders.has(input.providerId) ? 'disabled' : undefined,
			);
		this.knownProviders.set(provider.id, provider.displayName);
		const id = `chat_${randomBytes(9).toString('base64url')}`;
		const record: ChatRecord = {
			id,
			...(input.key === undefined ? {} : { key: input.key }),
			title,
			providerId: provider.id,
			providerName: provider.displayName,
			reach,
			...(input.instruction === undefined
				? {}
				: { instruction: input.instruction }),
			createdAt: this.now(),
			status: 'idle',
			revision: 1,
			entries: [],
			turnFailed: false,
			memoryLost: false,
			closed: false,
		};
		this.chats.set(id, record);
		this.changed(record, true);
		return this.summary(record);
	}

	/** The chat with `key`, created from `input` when there is none. */
	open(
		input: CreateAgentChatInput & { readonly key: string },
	): AgentChatSummary {
		if (input.key === PIXEL_CHAT_KEY && input.allowReservedKey !== true)
			throw new AgentChatError('reserved_key', 'that chat key is reserved');
		return this.findByKey(input.key) ?? this.create(input);
	}

	/**
	 * Append the user's message and run one turn. Resolves once the turn is
	 * under way; the reply arrives as changes.
	 */
	send(chatId: string, text: string): void {
		this.assertRunning();
		const chat = this.require(chatId);
		const message = typeof text === 'string' ? text.trim() : '';
		if (
			message.length === 0 ||
			message.length > AGENT_CHAT_LIMITS.messageLength
		)
			throw new AgentChatError('validation', 'message is empty or too long');
		if (chat.status !== 'idle' || chat.turn !== undefined)
			throw new AgentChatError(
				'chat_busy',
				'This chat is still replying. Wait for it, or press Stop.',
			);
		this.push(chat, { kind: 'user', text: message });
		chat.status = 'thinking';
		chat.turnFailed = false;
		chat.reply = undefined;
		const turn = new AbortController();
		chat.turn = turn;
		this.armInactivity(chat);
		this.changed(chat, true);
		void this.runTurn(chat, message, turn);
	}

	/** Stop the running turn and withdraw the chat's pending approvals. */
	async stop(chatId: string): Promise<void> {
		const chat = this.require(chatId);
		this.options.mcp?.cancelPendingApprovals(chat.id);
		if (chat.turn === undefined) return;
		// End the turn first, so whatever the agent says while it stops is dropped.
		chat.turn.abort();
		this.endTurn(chat);
		await chat.session?.handle.cancel().catch(() => undefined);
	}

	/** Forget the conversation; the next message starts a new session. */
	async clear(chatId: string): Promise<void> {
		const chat = this.require(chatId);
		await this.endSession(chat);
		chat.entries = [];
		chat.memoryLost = false;
		this.changed(chat, true);
	}

	async close(chatId: string): Promise<void> {
		const chat = this.chats.get(chatId);
		if (chat === undefined) return;
		chat.closed = true;
		await this.endSession(chat);
		this.chats.delete(chatId);
		clearTimeout(chat.notify);
		this.options.onChanged?.({
			chatId,
			revision: chat.revision + 1,
			removed: true,
		});
	}

	async closeByKey(key: string): Promise<void> {
		const chat = this.findByKey(key);
		if (chat !== undefined) await this.close(chat.id);
	}

	/** Every chat ends: the server is stopping or MCP was disabled. */
	async shutdown(): Promise<void> {
		this.stopped = true;
		await Promise.all([...this.chats.keys()].map((id) => this.close(id)));
	}

	// ---------- approvals and MCP calls, reported by the host ----------

	/** A pending approval for one of this service's chats appeared. */
	approvalPending(approval: {
		readonly approvalId: string;
		readonly chatId: string;
		readonly summary: string;
		readonly groupLabel: string;
		readonly details: readonly AgentChatApprovalDetail[];
	}): void {
		const chat = this.chats.get(approval.chatId);
		if (chat === undefined) return;
		if (
			chat.entries.some(
				(entry) =>
					entry.kind === 'approval' && entry.approvalId === approval.approvalId,
			)
		)
			return;
		this.push(chat, {
			kind: 'approval',
			approvalId: approval.approvalId,
			statement: boundedText(
				`${chat.title} (${chat.providerName}) wants to ${approval.summary}`,
				AGENT_CHAT_LIMITS.messageLength,
			),
			groupLabel: approval.groupLabel,
			details: approval.details.map((detail) => ({
				label: boundedText(detail.label, 256),
				value: boundedText(detail.value, AGENT_CHAT_LIMITS.messageLength),
				...(detail.code === true ? { code: true } : {}),
			})),
			state: 'pending',
		});
		// An approval can wait as long as the user takes; it is not inactivity.
		clearTimeout(chat.inactivity);
		chat.reply = undefined;
		this.changed(chat, true);
	}

	approvalSettled(
		approvalId: string,
		chatId: string,
		state: AgentChatApprovalState,
	): void {
		const chat = this.chats.get(chatId);
		if (chat === undefined) return;
		const index = chat.entries.findIndex(
			(entry) => entry.kind === 'approval' && entry.approvalId === approvalId,
		);
		if (index < 0) return;
		const entry = chat.entries[index];
		if (entry?.kind !== 'approval' || entry.state !== 'pending') return;
		chat.revision += 1;
		chat.entries[index] = { ...entry, state, revision: chat.revision };
		if (chat.turn !== undefined) this.armInactivity(chat);
		this.changed(chat, true);
	}

	/** Whether an approval belongs to a chat, so a decision can be routed. */
	hasApproval(chatId: string, approvalId: string): boolean {
		return (
			this.chats
				.get(chatId)
				?.entries.some(
					(entry) =>
						entry.kind === 'approval' &&
						entry.approvalId === approvalId &&
						entry.state === 'pending',
				) === true
		);
	}

	/**
	 * The host saw the chat call one of Terminay's MCP tools and describes it
	 * in its own words, e.g. "Reading build". Shown as an activity note.
	 */
	noteMcpCall(chatId: string, text: string): void {
		const chat = this.chats.get(chatId);
		if (chat === undefined || chat.turn === undefined) return;
		this.appendPart(chat, {
			type: 'activity',
			callId: `mcp_${randomBytes(6).toString('base64url')}`,
			text: boundedText(text, 512),
			state: 'completed',
		});
	}

	// ---------- internals ----------

	private async runTurn(
		chat: ChatRecord,
		text: string,
		turn: AbortController,
	): Promise<void> {
		try {
			const session = await this.ensureSession(chat);
			if (turn.signal.aborted || chat.closed) return;
			await session.handle.prompt(text, turn.signal);
		} catch (error) {
			if (!turn.signal.aborted && !chat.closed && !chat.turnFailed)
				this.notice(
					chat,
					'error',
					error instanceof AgentChatError
						? error.message
						: `The agent could not reply: ${errorText(error)}`,
				);
		} finally {
			if (chat.turn === turn) this.endTurn(chat);
		}
	}

	private async ensureSession(chat: ChatRecord): Promise<OpenSession> {
		if (chat.session !== undefined) return chat.session;
		chat.opening ??= this.openSession(chat).finally(() => {
			chat.opening = undefined;
		});
		return chat.opening;
	}

	private async openSession(chat: ChatRecord): Promise<OpenSession> {
		const availability = await this.availability(chat.providerId).catch(
			(error): AgentChatAvailability => {
				throw new AgentChatError(
					'provider_unavailable',
					`${chat.providerName} is not available: ${errorText(error)}`,
					'disabled',
				);
			},
		);
		if (!availability.available) {
			this.availabilityCache.delete(chat.providerId);
			chat.turnFailed = true;
			this.notice(
				chat,
				'error',
				unavailableText(chat.providerName, availability),
			);
			throw new AgentChatError(
				'provider_unavailable',
				unavailableText(chat.providerName, availability),
				availability.reason,
			);
		}
		const sessionId = `${chat.id}_${randomBytes(6).toString('base64url')}`;
		const workingDirectory = join(this.options.workRoot, sessionId);
		await mkdir(workingDirectory, { recursive: true, mode: 0o700 });
		let mcpServer: AgentChatMcpServer | null = null;
		if (chat.reach.kind !== 'none') {
			const mcp = this.options.mcp;
			if (mcp === undefined)
				throw new AgentChatError(
					'mcp_unavailable',
					'Terminay MCP is not available on this server.',
				);
			const lease = mcp.mint(chat.id, chat.reach);
			mcpServer = {
				name: AGENT_CHAT_MCP_SERVER_NAME,
				...mcp.serverEntry(lease.token),
			};
		}
		const request: AgentChatSessionRequest = {
			sessionId,
			workingDirectory,
			...(chat.instruction === undefined
				? {}
				: { instruction: chat.instruction }),
			mcpServer,
		};
		let open: OpenSession | undefined;
		try {
			const handle = await this.options.providers.openSession(
				chat.providerId,
				request,
				(event) => this.onEvent(chat, sessionId, event),
			);
			open = { sessionId, handle, workingDirectory, closing: false };
		} catch (error) {
			this.options.mcp?.revoke(chat.id);
			await rm(workingDirectory, { recursive: true, force: true }).catch(
				() => undefined,
			);
			throw error;
		}
		if (chat.closed) {
			await open.handle.close().catch(() => undefined);
			throw new AgentChatError('not_found', 'chat was closed');
		}
		chat.session = open;
		this.options.onDiagnostic?.({
			event: 'session-started',
			chatId: chat.id,
			providerId: chat.providerId,
		});
		if (chat.memoryLost) {
			chat.memoryLost = false;
			this.notice(
				chat,
				'info',
				'I started a new agent. It does not remember what we said before this point.',
			);
		}
		return open;
	}

	private onEvent(
		chat: ChatRecord,
		sessionId: string,
		event: AgentChatEvent,
	): void {
		if (chat.session?.sessionId !== sessionId && event.type !== 'exit') return;
		if (event.type === 'exit') {
			this.sessionExited(chat, sessionId, event.exit);
			return;
		}
		if (chat.turn === undefined) return;
		this.armInactivity(chat);
		switch (event.type) {
			case 'text':
				this.appendText(chat, event.delta);
				return;
			case 'tool': {
				const { tool } = event;
				if (
					tool.server === AGENT_CHAT_MCP_SERVER_NAME &&
					this.options.mcp?.notesCalls === true
				)
					return;
				this.appendPart(chat, {
					type: 'activity',
					callId: tool.callId,
					text: activityText(tool.server, tool.name),
					state: tool.state,
				});
				return;
			}
			case 'failure':
				this.failure(chat, event.failure);
				return;
		}
	}

	private failure(chat: ChatRecord, failure: AgentChatFailure): void {
		if (chat.turnFailed) return;
		chat.turnFailed = true;
		this.options.onDiagnostic?.({
			event: 'turn-failed',
			chatId: chat.id,
			providerId: chat.providerId,
			reason: failure.reason,
		});
		const detail = failure.detail === undefined ? '' : ` ${failure.detail}`;
		const text =
			failure.reason === 'not_installed'
				? `${chat.providerName} is not installed on this server.${detail}`
				: failure.reason === 'not_signed_in'
					? `${chat.providerName} is not signed in.${detail}`
					: failure.reason === 'crashed'
						? `${chat.providerName} stopped unexpectedly.${detail}`
						: `${chat.providerName} could not finish that reply.${detail}`;
		this.notice(chat, 'error', text);
	}

	private sessionExited(
		chat: ChatRecord,
		sessionId: string,
		exit: { readonly code: number | null; readonly signal: string | null },
	): void {
		const session = chat.session;
		if (session === undefined || session.sessionId !== sessionId) return;
		chat.session = undefined;
		this.options.mcp?.revoke(chat.id);
		void rm(session.workingDirectory, { recursive: true, force: true }).catch(
			() => undefined,
		);
		this.options.onDiagnostic?.({
			event: 'session-ended',
			chatId: chat.id,
			providerId: chat.providerId,
			exitCode: exit.code,
			signal: exit.signal,
			deliberate: session.closing,
		});
		if (session.closing || chat.closed) return;
		chat.memoryLost = true;
		if (!chat.turnFailed)
			this.notice(
				chat,
				'error',
				`${chat.providerName} stopped. Send another message to start it again.`,
			);
		chat.turnFailed = true;
		if (chat.turn !== undefined) {
			chat.turn.abort();
			this.endTurn(chat);
		}
	}

	private async endSession(chat: ChatRecord): Promise<void> {
		this.options.mcp?.cancelPendingApprovals(chat.id);
		chat.turn?.abort();
		if (chat.turn !== undefined) this.endTurn(chat);
		const opening = chat.opening;
		if (opening !== undefined) await opening.catch(() => undefined);
		const session = chat.session;
		if (session !== undefined) {
			session.closing = true;
			await session.handle.close().catch(() => undefined);
			// The exit event normally arrives during close; make sure it is final.
			this.sessionExited(chat, session.sessionId, { code: null, signal: null });
		}
		this.options.mcp?.revoke(chat.id);
	}

	private endTurn(chat: ChatRecord): void {
		clearTimeout(chat.inactivity);
		chat.inactivity = undefined;
		chat.turn = undefined;
		chat.reply = undefined;
		for (let index = 0; index < chat.entries.length; index += 1) {
			const entry = chat.entries[index];
			if (
				entry?.kind === 'assistant' &&
				entry.parts.some(
					(part) => part.type === 'activity' && part.state === 'running',
				)
			) {
				chat.revision += 1;
				chat.entries[index] = {
					...entry,
					parts: entry.parts.map((part) =>
						part.type === 'activity' && part.state === 'running'
							? { ...part, state: 'completed' as const }
							: part,
					),
					revision: chat.revision,
				};
			}
		}
		chat.status = 'idle';
		this.changed(chat, true);
	}

	private armInactivity(chat: ChatRecord): void {
		clearTimeout(chat.inactivity);
		if (
			chat.entries.some(
				(entry) => entry.kind === 'approval' && entry.state === 'pending',
			)
		)
			return;
		chat.inactivity = setTimeout(() => {
			if (chat.turn === undefined) return;
			this.notice(
				chat,
				'error',
				`${chat.providerName} has not said anything for a while, so I stopped waiting.`,
			);
			chat.turnFailed = true;
			chat.turn.abort();
			void chat.session?.handle.cancel().catch(() => undefined);
			this.endTurn(chat);
		}, this.inactivityMs);
		chat.inactivity.unref?.();
	}

	private appendText(chat: ChatRecord, delta: string): void {
		const reply = this.replyEntry(chat);
		const parts = [...reply.parts];
		const last = parts[parts.length - 1];
		const total = parts.reduce(
			(sum, part) => sum + (part.type === 'text' ? part.text.length : 0),
			0,
		);
		const room = AGENT_CHAT_LIMITS.textLength - total;
		if (room <= 0) return;
		const piece = delta.length > room ? `${delta.slice(0, room - 1)}…` : delta;
		if (last?.type === 'text')
			parts[parts.length - 1] = { type: 'text', text: last.text + piece };
		else parts.push({ type: 'text', text: piece });
		this.replaceReply(chat, reply.id, parts);
		if (chat.status !== 'streaming') {
			chat.status = 'streaming';
			this.changed(chat, true);
			return;
		}
		this.changed(chat, false);
	}

	private appendPart(
		chat: ChatRecord,
		part: AgentChatPart & { type: 'activity' },
	): void {
		const reply = this.replyEntry(chat);
		const parts = [...reply.parts];
		const existing = parts.findIndex(
			(candidate) =>
				candidate.type === 'activity' && candidate.callId === part.callId,
		);
		// A later report of the same call updates its state, keeping its words.
		if (existing >= 0)
			parts[existing] = {
				...part,
				text: (parts[existing] as typeof part).text,
			};
		else parts.push(part);
		this.replaceReply(chat, reply.id, parts);
		this.changed(chat, true);
	}

	private replyEntry(chat: ChatRecord): AgentChatEntry & { kind: 'assistant' } {
		const current = chat.entries.find((entry) => entry.id === chat.reply);
		if (current?.kind === 'assistant') return current;
		const entry = this.push(chat, { kind: 'assistant', parts: [] });
		chat.reply = entry.id;
		return entry as AgentChatEntry & { kind: 'assistant' };
	}

	private replaceReply(
		chat: ChatRecord,
		entryId: string,
		parts: readonly AgentChatPart[],
	): void {
		const index = chat.entries.findIndex((entry) => entry.id === entryId);
		if (index < 0) return;
		const entry = chat.entries[index];
		if (entry?.kind !== 'assistant') return;
		chat.revision += 1;
		chat.entries[index] = { ...entry, parts, revision: chat.revision };
	}

	private notice(chat: ChatRecord, tone: 'info' | 'error', text: string): void {
		this.push(chat, {
			kind: 'notice',
			tone,
			text: boundedText(text, AGENT_CHAT_LIMITS.messageLength),
		});
		chat.reply = undefined;
		this.changed(chat, true);
	}

	private push(
		chat: ChatRecord,
		entry: DistributiveOmit<AgentChatEntry, 'id' | 'createdAt' | 'revision'>,
	): AgentChatEntry {
		chat.revision += 1;
		const full = {
			...entry,
			id: `e_${randomBytes(6).toString('base64url')}`,
			createdAt: this.now(),
			revision: chat.revision,
		} as AgentChatEntry;
		chat.entries.push(full);
		if (chat.entries.length > AGENT_CHAT_LIMITS.entries)
			chat.entries.splice(0, chat.entries.length - AGENT_CHAT_LIMITS.entries);
		return full;
	}

	/**
	 * Record that the chat changed and tell subscribers. Status changes have
	 * no entry of their own, so every change advances the revision; streaming
	 * text is coalesced so a fast reply is a few notifications, not hundreds.
	 */
	private changed(chat: ChatRecord, immediate: boolean): void {
		chat.revision += 1;
		const notify = (): void => {
			chat.notify = undefined;
			if (chat.closed || !this.chats.has(chat.id)) return;
			this.options.onChanged?.({ chatId: chat.id, revision: chat.revision });
		};
		if (immediate || this.coalesceMs <= 0) {
			clearTimeout(chat.notify);
			notify();
			return;
		}
		chat.notify ??= setTimeout(notify, this.coalesceMs);
	}

	private async availability(
		providerId: string,
		signal?: AbortSignal,
	): Promise<AgentChatAvailability> {
		const cached = this.availabilityCache.get(providerId);
		if (
			cached !== undefined &&
			this.now() - cached.at < AGENT_CHAT_LIMITS.availabilityTtlMs
		)
			return cached.value;
		const value = await this.options.providers.availability(providerId, signal);
		this.availabilityCache.set(providerId, { at: this.now(), value });
		return value;
	}

	private summary(chat: ChatRecord): AgentChatSummary {
		return {
			id: chat.id,
			...(chat.key === undefined ? {} : { key: chat.key }),
			title: chat.title,
			providerId: chat.providerId,
			providerName: chat.providerName,
			reach: chat.reach,
			status: chat.status,
			revision: chat.revision,
			pendingApprovals: chat.entries.filter(
				(entry) => entry.kind === 'approval' && entry.state === 'pending',
			).length,
			createdAt: chat.createdAt,
		};
	}

	private require(chatId: string): ChatRecord {
		const chat = this.chats.get(chatId);
		if (chat === undefined)
			throw new AgentChatError('not_found', 'chat not found');
		return chat;
	}

	private assertRunning(): void {
		if (this.stopped)
			throw new AgentChatError(
				'provider_unavailable',
				'the server is stopping',
			);
	}
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
	? Omit<T, K>
	: never;

function validReach(value: AgentChatReach): AgentChatReach {
	if (value?.kind === 'none' || value?.kind === 'workspace')
		return { kind: value.kind };
	if (
		value?.kind === 'project' &&
		typeof value.projectId === 'string' &&
		PROJECT_ID_PATTERN.test(value.projectId) &&
		value.projectId !== 'system:automations'
	)
		return { kind: 'project', projectId: value.projectId };
	throw new AgentChatError('validation', 'chat reach is invalid');
}

/** The note for a tool Terminay did not describe itself. */
function activityText(server: string | undefined, name: string): string {
	if (server === AGENT_CHAT_MCP_SERVER_NAME) {
		const words: Record<string, string> = {
			list_terminals: 'Looking at the terminals',
			read_terminal: 'Reading a terminal',
			search_terminal: 'Searching a terminal',
			get_terminal_status: 'Checking a terminal',
			write_terminal: 'Typing into a terminal',
			run_command: 'Running a command in a terminal',
			open_terminal: 'Opening a terminal',
			close_terminal: 'Closing a terminal',
			focus_terminal: 'Switching to a terminal',
			rename_terminal: 'Renaming a terminal',
			split_terminal: 'Splitting a terminal',
			wait_for_idle: 'Waiting for a terminal to go quiet',
			wait_for_command: 'Waiting for a command to finish',
			wait_for_attention: 'Waiting for a terminal to need attention',
			list_automations: 'Looking at automations',
			get_automation: 'Reading an automation',
			list_automation_runs: 'Reading an automation’s runs',
			create_automation: 'Creating an automation',
			update_automation: 'Changing an automation',
			delete_automation: 'Deleting an automation',
			set_automation_enabled: 'Switching an automation',
			run_automation: 'Running an automation',
			stop_automation_run: 'Stopping an automation run',
		};
		return words[name] ?? `Using ${sanitizedName(name)}`;
	}
	if (server !== undefined)
		return `Using ${sanitizedName(name)} from ${sanitizedName(server)}`;
	return name === 'command'
		? 'Running a command'
		: `Using ${sanitizedName(name)}`;
}

function sanitizedName(value: string): string {
	return value.replace(/[^\w .:-]/g, '').slice(0, 64) || 'a tool';
}

function unavailableText(
	providerName: string,
	availability: Exclude<AgentChatAvailability, { available: true }>,
): string {
	const detail =
		availability.detail === undefined ? '' : ` ${availability.detail}`;
	switch (availability.reason) {
		case 'not_installed':
			return `${providerName} is not installed on this server.${detail}`;
		case 'not_signed_in':
			return `${providerName} is not signed in.${detail}`;
		default:
			return `${providerName} does not run on this server.${detail}`;
	}
}

function boundedLine(value: unknown, maximum: number): string | undefined {
	if (typeof value !== 'string') return undefined;
	const line = value.replace(/[\0\r\n]+/g, ' ').trim();
	if (line.length === 0) return undefined;
	return line.length > maximum ? `${line.slice(0, maximum - 1)}…` : line;
}

function boundedText(value: string, maximum: number): string {
	const clean = value.replace(/\0/g, '');
	return clean.length > maximum ? `${clean.slice(0, maximum - 1)}…` : clean;
}

function errorText(error: unknown): string {
	return boundedText(
		error instanceof Error ? error.message : 'unknown error',
		512,
	);
}
