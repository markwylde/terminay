import {
	EXTENSION_LIMITS,
	validateAgentChatAvailability,
	validateAgentChatSessionRequest,
} from '@terminay/extension-api';
import type { ChildFrame, HostFrame } from './protocol.js';

/**
 * The child side of chat providers. It turns host frames into calls on the
 * registered runtimes and session events back into frames. The host owns
 * every session's lifetime; the child only runs what it is told and validates
 * again on the host side whatever it reports.
 */
export interface AgentChatChildIo {
	send(frame: ChildFrame): boolean;
	nextId(prefix: string): string;
	result(id: string, payload?: unknown): void;
	failure(id: string, error: unknown): void;
}

interface ChildChatRuntime {
	availability(signal: AbortSignal): Promise<unknown>;
	openSession(
		request: unknown,
		events: unknown,
		signal: AbortSignal,
	): Promise<unknown>;
}

interface ChildChatSession {
	prompt(text: string, signal: AbortSignal): Promise<void>;
	cancel(): unknown;
	close(): unknown;
}

interface OpenSession {
	readonly providerId: string;
	readonly session: ChildChatSession;
	readonly controller: AbortController;
	prompt?: AbortController;
	exited: boolean;
}

export class AgentChatChild {
	private readonly providers = new Map<string, ChildChatRuntime>();
	private readonly sessions = new Map<string, OpenSession>();
	private declared = new Set<string>();

	constructor(private readonly io: AgentChatChildIo) {}

	/** Forget everything from a previous activation. */
	async reset(declared: readonly string[]): Promise<void> {
		await this.closeAll();
		this.providers.clear();
		this.declared = new Set(declared);
	}

	registry(registered: string[]): Readonly<Record<string, unknown>> {
		return Object.freeze({
			registerChatProvider: (providerId: string, runtime: unknown) => {
				const value =
					typeof runtime === 'object' && runtime !== null
						? (runtime as Record<string, unknown>)
						: undefined;
				if (
					typeof providerId !== 'string' ||
					!this.declared.has(providerId) ||
					this.providers.has(providerId) ||
					value === undefined ||
					typeof value.availability !== 'function' ||
					typeof value.openSession !== 'function'
				)
					throw new Error(
						'chat provider registration is undeclared or invalid',
					);
				this.providers.set(providerId, value as unknown as ChildChatRuntime);
				registered.push(providerId);
				let disposed = false;
				return Object.freeze({
					providerId,
					dispose: () => {
						if (disposed) return;
						disposed = true;
						this.providers.delete(providerId);
						for (const [sessionId, open] of this.sessions)
							if (open.providerId === providerId)
								void this.closeSession(sessionId);
					},
				});
			},
		});
	}

	handles(kind: HostFrame['kind']): boolean {
		return kind.startsWith('agent.chat.');
	}

	async receive(frame: HostFrame): Promise<void> {
		try {
			const payload = objectOf(frame.payload) ?? {};
			switch (frame.kind) {
				case 'agent.chat.availability': {
					const runtime = this.provider(payload.providerId);
					const result = validateAgentChatAvailability(
						await runtime.availability(new AbortController().signal),
					);
					if (!result.ok) throw new Error(result.reason);
					this.io.result(frame.id, result.value);
					return;
				}
				case 'agent.chat.open':
					await this.open(payload);
					break;
				case 'agent.chat.prompt':
					await this.prompt(payload);
					break;
				case 'agent.chat.cancel': {
					const open = this.session(payload.sessionId);
					await open.session.cancel();
					break;
				}
				case 'agent.chat.close':
					if (typeof payload.sessionId !== 'string')
						throw new Error('sessionId is invalid');
					await this.closeSession(payload.sessionId);
					break;
				default:
					throw new Error('unknown chat frame');
			}
			this.io.result(frame.id);
		} catch (error) {
			this.io.failure(frame.id, error);
		}
	}

	/** Ends every session's agent, as deactivation requires. */
	async closeAll(): Promise<void> {
		await Promise.all(
			[...this.sessions.keys()].map((sessionId) =>
				this.closeSession(sessionId),
			),
		);
	}

	private provider(providerId: unknown): ChildChatRuntime {
		const runtime =
			typeof providerId === 'string'
				? this.providers.get(providerId)
				: undefined;
		if (runtime === undefined)
			throw new Error('chat provider is not registered');
		return runtime;
	}

	private session(sessionId: unknown): OpenSession {
		const open =
			typeof sessionId === 'string' ? this.sessions.get(sessionId) : undefined;
		if (open === undefined) throw new Error('chat session is not open');
		return open;
	}

	private async open(payload: Record<string, unknown>): Promise<void> {
		const providerId = payload.providerId;
		const runtime = this.provider(providerId);
		const checked = validateAgentChatSessionRequest(payload.request);
		if (!checked.ok) throw new Error(checked.reason);
		const request = checked.value;
		if (this.sessions.has(request.sessionId))
			throw new Error('chat session is already open');
		const controller = new AbortController();
		const holder: { open?: OpenSession; exited: boolean } = { exited: false };
		const emit = (event: Record<string, unknown>): void => {
			if (holder.exited) return;
			if (event.type === 'exit') {
				holder.exited = true;
				if (holder.open) holder.open.exited = true;
			}
			this.io.send({
				protocolVersion: 1,
				kind: 'agent.chat.event',
				id: this.io.nextId('agent-chat-event'),
				payload: { sessionId: request.sessionId, event },
			});
		};
		const events = Object.freeze({
			text: (delta: unknown) => {
				if (typeof delta !== 'string' || delta.length === 0) return;
				// A long delta is split rather than dropped; each piece is still
				// bounded on the host.
				for (
					let start = 0;
					start < delta.length;
					start += EXTENSION_LIMITS.chatTextDeltaLength
				)
					emit({
						type: 'text',
						delta: delta.slice(
							start,
							start + EXTENSION_LIMITS.chatTextDeltaLength,
						),
					});
			},
			tool: (tool: unknown) => emit({ type: 'tool', tool }),
			failure: (failure: unknown) => emit({ type: 'failure', failure }),
			exit: (exit: unknown) => emit({ type: 'exit', exit }),
		});
		const session = (await runtime.openSession(
			request,
			events,
			controller.signal,
		)) as Partial<ChildChatSession> | undefined;
		if (
			session === undefined ||
			typeof session.prompt !== 'function' ||
			typeof session.cancel !== 'function' ||
			typeof session.close !== 'function'
		)
			throw new Error('chat provider returned an invalid session');
		const open: OpenSession = {
			providerId: providerId as string,
			session: session as ChildChatSession,
			controller,
			exited: holder.exited,
		};
		holder.open = open;
		this.sessions.set(request.sessionId, open);
	}

	private async prompt(payload: Record<string, unknown>): Promise<void> {
		const open = this.session(payload.sessionId);
		const text = payload.text;
		if (
			typeof text !== 'string' ||
			text.length === 0 ||
			text.length > EXTENSION_LIMITS.chatPromptLength
		)
			throw new Error('prompt text is invalid');
		if (open.prompt !== undefined) throw new Error('a turn is already running');
		const controller = new AbortController();
		open.prompt = controller;
		try {
			await open.session.prompt(text, controller.signal);
		} finally {
			if (open.prompt === controller) open.prompt = undefined;
		}
	}

	private async closeSession(sessionId: string): Promise<void> {
		const open = this.sessions.get(sessionId);
		if (open === undefined) return;
		this.sessions.delete(sessionId);
		open.prompt?.abort();
		open.controller.abort();
		try {
			await open.session.close();
		} catch {
			/* the session is gone either way */
		}
	}
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
