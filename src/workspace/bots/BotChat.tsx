/** Shared communication log. Provider output lives exclusively in execution details. */
import { BotMessagesClient } from '@terminay/client-core';
import type {
	BotMessage,
	BotProfile,
	BotSessionRecord,
} from '@terminay/protocol';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from '../../components/ContextMenu';
import { recallBotChatRead, rememberBotChatRead } from '../localViewState';
import { BotComposer, type BotPostResult } from './BotComposer';
import { BotContextRail } from './BotContextRail';
import type { BotEnvironmentSubTab } from './BotEnvironmentPanel';
import { BotStartFailures } from './BotStartFailures';
import type { BotConfigTab } from './BotTab';
import { BotThreadPanel } from './BotThreadPanel';
import {
	BotTranscript,
	type MessageMenuRequest,
	type TranscriptThread,
} from './BotTranscript';
import { appendQuote, quoteMessage } from './quoteMessage';
import {
	deleteLabel,
	fullMessage,
	messageItem,
	observedThrough,
	threadIsNew,
	visibleStartFailures,
} from './threadModel';
import { refusalText, type ServerBots } from './useServerBots';

export function BotChat({
	server,
	bot,
	sessions,
	environment,
	onSessionChange,
	draft,
	onDraftChange,
	onConfigure,
	visible,
	interaction,
}: Readonly<{
	server: ServerBots;
	bot: BotProfile;
	sessions: readonly BotSessionRecord[];
	environment: string;
	sessionId: string | undefined;
	onSessionChange: (id: string | undefined) => void;
	draft: string;
	onDraftChange: (value: string) => void;
	onConfigure: (tab: BotConfigTab, sub?: BotEnvironmentSubTab) => void;
	visible: boolean;
	/** Counts what the user has done with this bot; see `BotTab`. */
	interaction: number;
}>) {
	const client = useMemo(
		() => new BotMessagesClient(server.transport as never),
		[server.transport],
	);
	// Top-level messages only; replies live in their thread's panel.
	const [messages, setMessages] = useState<ReadonlyMap<string, BotMessage>>(
		new Map(),
	);
	const [older, setOlder] = useState<string | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState<string>(),
		[mutating, setMutating] = useState(false),
		[recovering, setRecovering] = useState<string>();
	// The open thread's root, and each thread's draft while this tab lives.
	const [thread, setThread] = useState<string>(),
		[threadDrafts, setThreadDrafts] = useState<ReadonlyMap<string, string>>(
			new Map(),
		);
	// The newest reply the thread panel has shown: the main stream may not
	// have refreshed that thread's summary yet.
	const [panelSeen, setPanelSeen] = useState<number>();
	const observePanel = useCallback(
		(sequence: number) =>
			setPanelSeen((now) =>
				now === undefined || sequence > now ? sequence : now,
			),
		[],
	);
	const threadRef = useRef(thread);
	threadRef.current = thread;
	const [menu, setMenu] = useState<{
		id: string;
		/** The full stored text, which Edit message edits. */
		text: string;
		/** The formatted quote (of the selection, or else of `text`); '' when there is nothing to quote. */
		quote: string;
		revision: number;
		/** The thread the message is shown in, for a reply or the open root. */
		inThread: string | undefined;
		/** Reply in thread is offered for a top-level message. */
		topLevel: boolean;
		deleteLabel: string;
		x: number;
		y: number;
		keyboard: boolean;
	}>();
	const composer = useRef<HTMLTextAreaElement | null>(null),
		threadComposer = useRef<HTMLTextAreaElement | null>(null),
		// Which composer a quote just went into, to focus it after render.
		caretPending = useRef<'main' | 'thread' | undefined>(undefined),
		menuFor = useRef<string | undefined>(undefined);
	const [editing, setEditing] = useState<{
			id: string;
			revision: number;
			text: string;
		}>(),
		[clearing, setClearing] = useState(false);
	const scroller = useRef<HTMLDivElement>(null),
		transcript = useRef<HTMLDivElement>(null),
		divider = useRef<HTMLDivElement>(null),
		jumpPending = useRef(false),
		pinned = useRef(true),
		cursor = useRef<string | undefined>(undefined),
		reload = useRef<() => void>(() => {});
	const generation = useRef(0),
		draftRef = useRef(draft),
		threadDraftsRef = useRef(threadDrafts);
	draftRef.current = draft;
	threadDraftsRef.current = threadDrafts;
	const mainComposerRef = useCallback((element: HTMLTextAreaElement | null) => {
			composer.current = element;
		}, []),
		threadComposerRef = useCallback((element: HTMLTextAreaElement | null) => {
			threadComposer.current = element;
		}, []);
	const olderRef = useRef(older);
	olderRef.current = older;
	const full = useCallback(
		(id: string) => fullMessage(client, bot.id, id),
		[client, bot.id],
	);
	useEffect(() => {
		let live = true,
			busy = false,
			again = false,
			initialized = false;
		const read = async () => {
			if (busy) {
				again = true;
				return;
			}
			busy = true;
			try {
				if (!initialized) {
					const page = await client.list(bot.id, { limit: 25 });
					const details = await Promise.all(page.items.map((m) => full(m.id)));
					if (!live) return;
					setMessages(new Map(details.map((m) => [m.id, m])));
					setOlder(page.nextCursor);
					cursor.current = page.eventsCursor;
					initialized = true;
				}
				let more = true;
				while (more && live) {
					const page = await client.events(bot.id, {
						...(cursor.current ? { cursor: cursor.current } : {}),
						limit: 25,
					});
					if (!live) return;
					if (page.gap) {
						generation.current++;
						initialized = false;
						again = true;
						break;
					}
					if (page.items.some((e) => e.type === 'messages.cleared')) {
						generation.current++;
						setMessages(new Map());
						setOlder(null);
						setThread(undefined);
						setPanelSeen(undefined);
						initialized = false;
						again = true;
						break;
					}
					for (const event of page.items) {
						if (!event.type.startsWith('message.')) continue;
						if (event.type === 'message.deleted') {
							generation.current++;
							if (event.subjectId === threadRef.current) setThread(undefined);
							setMessages((current) => {
								if (!current.has(event.subjectId)) return current;
								const next = new Map(current);
								next.delete(event.subjectId);
								return next;
							});
							continue;
						}
						// A reply changed a root's summary; refresh it if it is shown.
						const known = event.type === 'message.thread';
						if (
							known ||
							['message.posted', 'message.edited', 'message.dispatch'].includes(
								event.type,
							)
						) {
							try {
								const message = await full(event.subjectId);
								if (!live) continue;
								setMessages((current) =>
									message.threadId || (known && !current.has(message.id))
										? current
										: new Map(current).set(message.id, message),
								);
							} catch {
								if (live)
									setMessages((current) => {
										if (!current.has(event.subjectId)) return current;
										const next = new Map(current);
										next.delete(event.subjectId);
										return next;
									});
							}
						}
					}
					cursor.current = page.nextCursor;
					more = page.hasMore;
				}
				if (live) {
					setLoading(false);
				}
			} catch (cause) {
				if (live) {
					setError(refusalText(cause));
					setLoading(false);
				}
			} finally {
				busy = false;
				if (again && live) {
					again = false;
					void read();
				}
			}
		};
		generation.current++;
		setMessages(new Map());
		setLoading(true);
		setThread(undefined);
		cursor.current = undefined;
		pinned.current = true;
		const unwatch = client.watch(bot.id, () => {
			void read();
		});
		reload.current = () => {
			generation.current++;
			initialized = false;
			void read();
		};
		void read();
		return () => {
			generation.current++;
			live = false;
			unwatch();
		};
	}, [client, bot.id, full]);
	const ordered = useMemo(
		() => [...messages.values()].sort((a, b) => a.sequence - b.sequence),
		[messages],
	);
	// A start failure stays visible until it is dismissed or a later user
	// message has started an execution. Replies' failures show in their thread.
	const startFailures = useMemo(() => visibleStartFailures(ordered), [ordered]);
	// What this view has observed: top-level messages and, through their
	// summaries, the replies in their threads.
	const latest = useMemo(() => {
		const main = observedThrough(ordered);
		if (panelSeen === undefined) return main;
		return main === undefined ? panelSeen : Math.max(main, panelSeen);
	}, [ordered, panelSeen]);
	const latestRef = useRef(latest);
	latestRef.current = latest;
	// Read position: snapshotted when Chat is entered so the divider stays put
	// while the user reads; written back when they leave.
	const [readThrough, setReadThrough] = useState<number>();
	const [shown, setShown] = useState(
		() => document.visibilityState !== 'hidden',
	);
	useEffect(() => {
		const sync = () => setShown(document.visibilityState !== 'hidden');
		document.addEventListener('visibilitychange', sync);
		return () => document.removeEventListener('visibilitychange', sync);
	}, []);
	// The user is on this screen: Chat is showing and the window is not hidden.
	const here = visible && shown;
	// Layout timing, so the divider exists before the first scroll decision.
	useLayoutEffect(() => {
		if (!here) return;
		const id = bot.id;
		setReadThrough(recallBotChatRead(id));
		jumpPending.current = true;
		return () => {
			if (latestRef.current !== undefined)
				rememberBotChatRead(id, latestRef.current);
			setReadThrough(undefined);
		};
	}, [here, bot.id]);
	useEffect(() => {
		// A bot never shown on this device starts read, so old history gets no
		// divider; record that once the first page has loaded.
		if (here && !loading && readThrough === undefined && latest !== undefined)
			if (recallBotChatRead(bot.id) === undefined) {
				rememberBotChatRead(bot.id, latest);
				setReadThrough(latest);
			}
	}, [here, loading, readThrough, latest, bot.id]);
	// Something the user does in Chat acknowledges the bot's posts for every
	// client, so its notification clears everywhere. Being on screen does not:
	// a reply that lands while they are in another application, or while they
	// sit watching, waits for their next action, as an agent's terminal does.
	// Only what this client has loaded is acknowledged: a post still on its way
	// keeps its notification. An action taken before history loads counts once
	// it has. The per-device read position above is separate.
	const handledInteraction = useRef(0);
	const acknowledged = useRef<{ botId: string; through: number } | undefined>(
		undefined,
	);
	useEffect(() => {
		if (interaction <= handledInteraction.current) return;
		if (!here || loading || latest === undefined) return;
		handledInteraction.current = interaction;
		const last = acknowledged.current;
		if (last?.botId === bot.id && last.through >= latest) return;
		acknowledged.current = { botId: bot.id, through: latest };
		void client.acknowledge(bot.id, latest).catch(() => {
			// The next action tries again rather than leave it acknowledged here.
			if (acknowledged.current?.through === latest) acknowledged.current = last;
		});
	}, [interaction, here, loading, latest, bot.id, client]);
	const seenLatest = useRef<number | undefined>(undefined);
	useEffect(() => {
		// A reply arriving while the user is reading at the bottom is seen, not
		// new; a divider marks only what arrived while they were away.
		const before = seenLatest.current;
		seenLatest.current = latest;
		if (
			!here ||
			latest === undefined ||
			before === undefined ||
			readThrough === undefined ||
			latest <= before
		)
			return;
		const divided = ordered.some(
			(m) =>
				m.sequence > readThrough && m.sequence <= before && m.author !== 'user',
		);
		if (!divided && pinned.current && document.hasFocus())
			setReadThrough(latest);
	}, [here, latest, readThrough, ordered]);
	const unread = useMemo(() => {
		if (readThrough === undefined) return undefined;
		const fresh = ordered.filter(
			(m) => m.sequence > readThrough && m.author !== 'user',
		);
		return fresh[0] ? { key: fresh[0].id, count: fresh.length } : undefined;
	}, [ordered, readThrough]);
	const times = useMemo(
		() => new Map(ordered.map((m) => [m.id, m.createdAt])),
		[ordered],
	);
	const items = useMemo(() => ordered.map(messageItem), [ordered]);
	const threads = useMemo(() => {
		const found = new Map<string, TranscriptThread>();
		for (const m of ordered)
			if (m.thread?.replyCount)
				found.set(m.id, {
					summary: m.thread,
					isNew: threadIsNew(m.thread, readThrough),
				});
		return found;
	}, [ordered, readThrough]);
	useLayoutEffect(() => {
		const viewport = scroller.current;
		if (!visible || !viewport) return;
		// Wait for the entry snapshot so the divider is in place before deciding.
		const snapshotPending =
			readThrough === undefined && recallBotChatRead(bot.id) !== undefined;
		if (jumpPending.current && !loading && !snapshotPending) {
			jumpPending.current = false;
			const line = divider.current;
			if (line) {
				const top =
					line.getBoundingClientRect().top -
					viewport.getBoundingClientRect().top +
					viewport.scrollTop;
				// Open at the divider only when the unread run would not fit.
				if (viewport.scrollHeight - top > viewport.clientHeight) {
					pinned.current = false;
					viewport.scrollTop = Math.max(0, top - 16);
					return;
				}
			}
		}
		if (pinned.current) viewport.scrollTop = viewport.scrollHeight;
	}, [items, visible, loading, readThrough, unread?.key, bot.id]);
	useLayoutEffect(() => {
		const viewport = scroller.current,
			content = transcript.current;
		if (!visible || !viewport || !content) return;
		pinned.current = true;
		const follow = () => {
			if (pinned.current) viewport.scrollTop = viewport.scrollHeight;
		};
		follow();
		// Images decode after message rendering; observe their resulting layout,
		// rather than guessing when loading has finished or animating the scroll.
		const observer = new ResizeObserver(follow);
		observer.observe(content);
		observer.observe(viewport);
		return () => observer.disconnect();
	}, [visible]);
	const active = sessions.filter((s) =>
		['running', 'needs-you', 'queued'].includes(s.state),
	);
	const act = async (work: () => Promise<unknown>) => {
		setMutating(true);
		setError(undefined);
		try {
			await work();
			setEditing(undefined);
			setClearing(false);
		} catch (cause) {
			setError(refusalText(cause));
		} finally {
			setMutating(false);
		}
	};
	const recover = async (message: BotMessage, action: 'retry' | 'dismiss') => {
		if (recovering) return;
		const view = generation.current,
			attempt = message.dispatch?.attempt ?? 1;
		setRecovering(message.id);
		setError(undefined);
		try {
			const updated =
				action === 'retry'
					? (await client.retry(bot.id, message.id, message.revision, attempt))
							.message
					: await client.dismiss(bot.id, message.id, message.revision, attempt);
			if (view === generation.current)
				setMessages((current) => new Map(current).set(updated.id, updated));
			if (action === 'retry') server.refreshBot(bot.id);
		} catch (cause) {
			if (view === generation.current) setError(refusalText(cause));
		} finally {
			setRecovering(undefined);
		}
	};
	// Replying means the user has caught up.
	const posted = (result: BotPostResult) => {
		const message = result.message;
		if (!message.threadId) {
			setMessages((current) => new Map(current).set(message.id, message));
			pinned.current = true;
		}
		rememberBotChatRead(bot.id, message.sequence);
		setReadThrough(message.sequence);
		server.refreshBot(bot.id);
	};
	const setThreadDraft = useCallback((root: string, value: string) => {
		setThreadDrafts((current) => {
			if ((current.get(root) ?? '') === value) return current;
			const next = new Map(current);
			if (value) next.set(root, value);
			else next.delete(root);
			return next;
		});
	}, []);
	// A reply that completes after its panel closed clears only the draft it
	// sent, never one typed since.
	const clearSentThreadDraft = useCallback((root: string, sent: string) => {
		setThreadDrafts((current) => {
			if ((current.get(root) ?? '') !== sent) return current;
			const next = new Map(current);
			next.delete(root);
			return next;
		});
	}, []);
	const openThread = useCallback((root: string) => setThread(root), []);
	// Closing hands focus back to the root in the main stream.
	const closeThread = useCallback(() => {
		const root = threadRef.current;
		setThread(undefined);
		if (!root) return;
		requestAnimationFrame(() =>
			transcript.current
				?.querySelector<HTMLElement>(
					`[data-terminay-message-key="${CSS.escape(root)}"][tabindex]`,
				)
				?.focus(),
		);
	}, []);
	const loadOlder = async () => {
		const next = olderRef.current,
			view = generation.current;
		if (!next || loading) return;
		setLoading(true);
		const before = scroller.current?.scrollHeight ?? 0;
		try {
			const page = await client.list(bot.id, { cursor: next, limit: 25 });
			const details = await Promise.all(page.items.map((m) => full(m.id)));
			if (view !== generation.current) return;
			pinned.current = false;
			setMessages((current) => {
				const map = new Map(current);
				for (const m of details)
					if ((map.get(m.id)?.revision ?? 0) <= m.revision) map.set(m.id, m);
				return map;
			});
			setOlder(page.nextCursor);
			requestAnimationFrame(() => {
				if (scroller.current)
					scroller.current.scrollTop += scroller.current.scrollHeight - before;
			});
		} catch (cause) {
			if (view === generation.current) setError(refusalText(cause));
		} finally {
			if (view === generation.current) setLoading(false);
		}
	};
	useEffect(() => {
		const onEscape = (event: globalThis.KeyboardEvent) => {
			if (event.key === 'Escape' && !mutating) {
				setEditing(undefined);
				setClearing(false);
			}
		};
		window.addEventListener('keydown', onEscape);
		return () => window.removeEventListener('keydown', onEscape);
	}, [mutating]);
	// A quote leaves its composer focused with the caret after it.
	useLayoutEffect(() => {
		const target = caretPending.current;
		const input =
			target === 'thread' ? threadComposer.current : composer.current;
		if (!target || !input) return;
		caretPending.current = undefined;
		input.focus();
		input.setSelectionRange(input.value.length, input.value.length);
		input.scrollTop = input.scrollHeight;
	}, [draft, threadDrafts]);
	// A menu closed without moving focus elsewhere (Escape) hands it back to its message.
	useEffect(() => {
		if (menu) {
			menuFor.current = menu.id;
			return;
		}
		const key = menuFor.current;
		menuFor.current = undefined;
		const focused = document.activeElement;
		if (!key || editing || clearing) return;
		if (focused && focused !== document.body && focused.isConnected) return;
		document
			.querySelector<HTMLElement>(
				`.bots-chatwrap [data-terminay-message-key="${CSS.escape(key)}"][tabindex]`,
			)
			?.focus();
	}, [menu, editing, clearing]);
	const quote = (text: string, inThread: string | undefined) => {
		if (inThread) {
			caretPending.current = 'thread';
			setThreadDraft(
				inThread,
				appendQuote(threadDraftsRef.current.get(inThread) ?? '', text),
			);
			return;
		}
		caretPending.current = 'main';
		onDraftChange(appendQuote(draftRef.current, text));
	};
	const openMenu = (
		{ key, x, y, keyboard, selection }: MessageMenuRequest,
		message: BotMessage,
		inThread: string | undefined,
	) =>
		setMenu({
			id: key,
			text: message.text,
			quote: quoteMessage(selection ?? message.text),
			revision: message.revision,
			inThread,
			topLevel: !message.threadId && !inThread,
			deleteLabel: deleteLabel(message),
			x,
			y,
			keyboard,
		});
	const signIn = () => onConfigure('profile');
	return (
		<div
			className={
				thread ? 'bots-chatwrap bots-chatwrap--thread' : 'bots-chatwrap'
			}
		>
			{menu ? (
				<ContextMenu
					key={`${menu.id}:${menu.x}:${menu.y}`}
					x={menu.x}
					y={menu.y}
					keyboard={{ autoFocus: menu.keyboard }}
					label="Message actions"
					onClose={() => setMenu(undefined)}
					items={[
						...(menu.quote
							? [
									{
										label: 'Quote',
										onClick: () => quote(menu.quote, menu.inThread),
									},
								]
							: []),
						...(menu.topLevel
							? [
									{
										label: 'Reply in thread',
										onClick: () => openThread(menu.id),
									},
								]
							: []),
						{
							label: 'Edit message',
							disabled: mutating,
							onClick: () =>
								setEditing({
									id: menu.id,
									revision: menu.revision,
									text: menu.text,
								}),
						},
						{
							label: menu.deleteLabel,
							danger: true,
							disabled: mutating,
							onClick: () =>
								void act(() => client.remove(bot.id, menu.id, menu.revision)),
						},
					]}
				/>
			) : null}
			{createPortal(
				<div className="bots-ui bots-chat-overlays">
					{editing || clearing ? (
						<div className="bots-modal bots-chat-modal">
							{/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: Both conditional roles support aria-modal; Biome cannot resolve the expression. */}
							<div
								className="bots-dialog bots-message-editor"
								role={clearing ? 'alertdialog' : 'dialog'}
								aria-modal="true"
								aria-label={clearing ? 'Clear chat history?' : 'Edit message'}
							>
								<h2>{clearing ? 'Clear chat history?' : 'Edit message'}</h2>
								{error ? (
									<p role="alert" className="bots-note bots-note--error">
										{error}
									</p>
								) : null}
								{editing ? (
									<textarea
										aria-label="Message text"
										value={editing.text}
										disabled={mutating}
										onChange={(event) =>
											setEditing({ ...editing, text: event.target.value })
										}
									/>
								) : null}
								<p className="bots-faint">
									{clearing
										? 'This clears the shared message log and stops active sessions. Files and memories remain.'
										: 'This changes the shared message log. Executions can discover the revision through events; actions already performed remain.'}
								</p>
								<footer className="bots-dialog__foot">
									<button
										type="button"
										className="bots-btn"
										disabled={mutating}
										onClick={() => {
											setEditing(undefined);
											setClearing(false);
										}}
									>
										Cancel
									</button>
									<button
										type="button"
										className={`bots-btn ${clearing ? 'bots-btn--danger' : 'bots-btn--primary'}`}
										disabled={mutating || (!!editing && !editing.text.trim())}
										onClick={() =>
											void act(() =>
												clearing
													? client.clear(bot.id)
													: client.edit(
															bot.id,
															editing!.id,
															editing!.revision,
															editing!.text,
														),
											)
										}
									>
										{clearing ? 'Clear chat' : 'Save message'}
									</button>
								</footer>
							</div>
						</div>
					) : null}
				</div>,
				document.body,
			)}
			<div className="bots-chatcol">
				<div
					className="bots-scroll bots-msgs"
					ref={scroller}
					onWheel={(event) => {
						if (event.deltaY < 0) pinned.current = false;
					}}
					onTouchMove={() => {
						pinned.current = false;
					}}
					onPointerDown={(event) => {
						const el = event.currentTarget;
						if (
							event.clientX >=
							el.getBoundingClientRect().right -
								Math.max(16, el.offsetWidth - el.clientWidth)
						)
							pinned.current = false;
					}}
					onKeyDown={(event) => {
						if (['ArrowUp', 'PageUp', 'Home'].includes(event.key))
							pinned.current = false;
					}}
					onScroll={(event) => {
						const el = event.currentTarget;
						// Layout, anchoring and our own jumps also emit scroll events.
						// Only a user gesture above unpins; reaching the end resumes following.
						if (el.scrollHeight - el.scrollTop - el.clientHeight < 80)
							pinned.current = true;
					}}
				>
					{older ? (
						<button
							type="button"
							className="bots-btn bots-btn--sm"
							disabled={loading}
							onClick={() => void loadOlder()}
						>
							Load older messages
						</button>
					) : null}
					{loading && messages.size === 0 ? (
						<p className="bots-faint">Loading messages…</p>
					) : null}
					{!loading && messages.size === 0 ? (
						<div className="bots-emptychat" data-terminay-bot-chat="empty">
							<b>Message {bot.name}</b>
							<span>
								Each message starts a fresh session. Replies appear here when
								the bot posts them.
							</span>
						</div>
					) : null}
					<BotTranscript
						containerRef={transcript}
						items={items}
						messageTimes={times}
						unread={unread ? { ...unread, ref: divider } : undefined}
						bot={bot}
						transport={server.transport}
						threads={threads}
						onOpenThread={openThread}
						onMessageMenu={(request) => {
							const message = messages.get(request.key);
							if (message) openMenu(request, message, undefined);
						}}
					/>
					<BotStartFailures
						failures={startFailures}
						recovering={recovering}
						onRecover={(m, action) => void recover(m, action)}
					/>
				</div>
				{error && !editing && !clearing ? (
					<div
						className="bots-note bots-note--error bots-chat-error"
						role="alert"
						data-terminay-bot-chat-error="true"
					>
						{error}
						<button
							type="button"
							className="bots-link"
							onClick={() => {
								setError(undefined);
								reload.current();
							}}
						>
							Reload messages
						</button>
					</div>
				) : null}
				<BotComposer
					client={client}
					botId={bot.id}
					draft={draft}
					onDraftChange={onDraftChange}
					label={`Message ${bot.name}`}
					placeholder={`Message ${bot.name} · Enter to send`}
					inputRef={mainComposerRef}
					onPosted={posted}
					onSignIn={signIn}
					actions={
						<>
							{messages.size ? (
								<button
									type="button"
									className="bots-btn bots-btn--sm bots-btn--ghost"
									disabled={mutating}
									onClick={() => setClearing(true)}
								>
									Clear chat
								</button>
							) : null}
							<span className="bots-faint">
								{active.length
									? `${active.length} session${active.length === 1 ? '' : 's'} active`
									: 'Ready'}
							</span>
						</>
					}
				/>
			</div>
			{thread ? (
				<BotThreadPanel
					key={thread}
					client={client}
					bot={bot}
					transport={server.transport}
					rootId={thread}
					initialRoot={messages.get(thread)}
					draft={threadDrafts.get(thread) ?? ''}
					onDraftChange={(value) => setThreadDraft(thread, value)}
					clearSentDraft={(sent) => clearSentThreadDraft(thread, sent)}
					inputRef={threadComposerRef}
					onClose={closeThread}
					onRootGone={() => setThread(undefined)}
					onObserved={observePanel}
					onMessageMenu={(request, message) =>
						openMenu(request, message, thread)
					}
					onPosted={posted}
					onSignIn={signIn}
				/>
			) : (
				<BotContextRail
					server={server}
					bot={bot}
					sessions={sessions}
					environment={environment}
					visible={visible}
					onConfigure={onConfigure}
					onExecution={(id) => {
						onSessionChange(id);
						onConfigure('sessions');
					}}
				/>
			)}
		</div>
	);
}
