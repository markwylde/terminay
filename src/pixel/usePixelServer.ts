/**
 * Pixel on the active server, kept current.
 *
 * Pixel and its chat are server-owned: this hook only reads them and sends
 * what the user does. Change notices carry no text, so the chat is mirrored
 * by revision through the agent chat client. A client without the authority
 * to create terminals sees no Pixel at all.
 */

import {
	AGENT_CHAT_CAPABILITY,
	AgentChatClient,
	type AgentChatDecision,
	type AgentChatProvider,
	type AgentChatView,
	PIXEL_OPERATIONS,
	type TerminayClient,
	TerminayClientFacade,
} from '@terminay/client-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PIXEL_PROVIDER_UNSET, type PixelServerState } from './pixelModel';

export type PixelServerEntry = Readonly<{
	serverId: string;
	applicationClient?: TerminayClient;
	capabilities?: readonly string[];
}>;

export type PixelServer = Readonly<{
	/** Null while Pixel is unknown, off, or not offered to this client. */
	state: PixelServerState | null;
	chat: AgentChatView | undefined;
	providers: readonly AgentChatProvider[];
	/** Why Pixel cannot chat right now, in plain words. */
	problem: string | undefined;
	send: (text: string) => void;
	stop: () => void;
	clear: () => void;
	decide: (approvalId: string, decision: AgentChatDecision) => void;
	chooseProvider: (providerId: string) => void;
}>;

export function usePixelServer(
	entry: PixelServerEntry | undefined,
): PixelServer {
	const applicationClient = entry?.applicationClient;
	const supported =
		entry?.capabilities?.includes(AGENT_CHAT_CAPABILITY) === true &&
		applicationClient !== undefined;
	const transport = useMemo(() => {
		if (!supported || applicationClient === undefined) return undefined;
		const facade = new TerminayClientFacade(applicationClient);
		return {
			facade,
			chats: new AgentChatClient({
				query: facade.query.bind(facade),
				command: facade.command.bind(facade),
				subscribe: (event, listener, onResync) =>
					facade.subscribeClientEvents(event, listener, onResync),
			}),
		};
	}, [applicationClient, supported]);

	const [state, setState] = useState<PixelServerState | null>(null);
	const [chat, setChat] = useState<AgentChatView | undefined>(undefined);
	const [providers, setProviders] = useState<readonly AgentChatProvider[]>([]);
	const [problem, setProblem] = useState<string | undefined>(undefined);
	const chatIdRef = useRef<string | undefined>(undefined);

	// Pixel's own state: switched on or off, and which agent.
	useEffect(() => {
		setState(null);
		if (transport === undefined) return;
		let disposed = false;
		const load = () =>
			void transport.facade
				.query(PIXEL_OPERATIONS.state)
				.then((value) => {
					if (!disposed) setState(value as unknown as PixelServerState);
				})
				.catch(() => {
					if (!disposed) setState(null);
				});
		let unsubscribe: (() => void) | undefined;
		void transport.facade
			.subscribeClientEvents(PIXEL_OPERATIONS.changed, load, load)
			.then((stop) => {
				if (disposed) stop();
				else unsubscribe = stop;
			})
			.catch(() => undefined);
		load();
		return () => {
			disposed = true;
			unsubscribe?.();
		};
	}, [transport]);

	const ready =
		state?.enabled === true && state.provider !== PIXEL_PROVIDER_UNSET;

	// The Pixel chat, mirrored while Pixel is on and has an agent.
	useEffect(() => {
		setChat(undefined);
		setProblem(undefined);
		chatIdRef.current = undefined;
		if (transport === undefined || !ready) return;
		let disposed = false;
		let stopMirror: (() => void) | undefined;
		const open = async () => {
			try {
				const summary = (await transport.facade.command(
					PIXEL_OPERATIONS.open,
				)) as unknown as { id: string };
				if (disposed) return;
				chatIdRef.current = summary.id;
				const stop = await transport.chats.mirror(summary.id, (view) => {
					if (disposed) return;
					setChat(view);
					// The server closed the chat (another agent was chosen, say);
					// the state notice that follows opens the next one.
					if (view === undefined) chatIdRef.current = undefined;
				});
				if (disposed) stop();
				else stopMirror = stop;
			} catch (error) {
				if (!disposed) setProblem(messageOf(error));
			}
		};
		void open();
		return () => {
			disposed = true;
			stopMirror?.();
		};
	}, [ready, state?.provider, transport]);

	// The agents on offer, for the first-click question.
	useEffect(() => {
		if (
			transport === undefined ||
			state === null ||
			!state.enabled ||
			state.provider !== PIXEL_PROVIDER_UNSET
		)
			return;
		let disposed = false;
		void transport.chats
			.providers()
			.then((next) => {
				if (!disposed) setProviders(next);
			})
			.catch(() => undefined);
		return () => {
			disposed = true;
		};
	}, [state, transport]);

	const withChat = useCallback(
		(work: (chats: AgentChatClient, chatId: string) => Promise<void>) => {
			const chatId = chatIdRef.current;
			if (transport === undefined || chatId === undefined) return;
			void work(transport.chats, chatId).catch((error) =>
				setProblem(messageOf(error)),
			);
		},
		[transport],
	);

	return {
		state,
		chat,
		providers,
		problem,
		send: (text) => {
			setProblem(undefined);
			withChat((chats, chatId) => chats.send(chatId, text));
		},
		stop: () => withChat((chats, chatId) => chats.stop(chatId)),
		clear: () => withChat((chats, chatId) => chats.clear(chatId)),
		decide: (approvalId, decision) =>
			withChat((chats, chatId) =>
				chats.decideApproval(chatId, approvalId, decision),
			),
		chooseProvider: (providerId) => {
			if (transport === undefined) return;
			void transport.facade
				.command('settings.update', {
					settings: { pixel: { provider: providerId } },
				})
				.catch((error) => setProblem(messageOf(error)));
		},
	};
}

function messageOf(error: unknown): string {
	return error instanceof Error && error.message.length > 0
		? error.message
		: 'Pixel could not reach its agent.';
}
