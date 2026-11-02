/** Shared communication log. Provider output lives exclusively in execution details. */
import { BotMessagesClient } from '@terminay/client-core';
import type {
	BotMessage,
	BotMessageDetail,
	BotProfile,
	BotSessionRecord,
} from '@terminay/protocol';
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from '../../components/ContextMenu';
import { BotTranscript } from './BotTranscript';
import { BotContextRail } from './BotContextRail';
import type { BotConfigTab } from './BotTab';
import type { BotEnvironmentSubTab } from './BotEnvironmentPanel';
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
}>) {
	const client = useMemo(
		() => new BotMessagesClient(server.transport as never),
		[server.transport],
	);
	const [messages, setMessages] = useState<ReadonlyMap<string, BotMessage>>(
		new Map(),
	);
	const [older, setOlder] = useState<string | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState<string>(),
		[sending, setSending] = useState(false),
		[mutating, setMutating] = useState(false);
	const [menu, setMenu] = useState<{
		id: string;
		text: string;
		revision: number;
		x: number;
		y: number;
	}>();
	const [editing, setEditing] = useState<{
			id: string;
			revision: number;
			text: string;
		}>(),
		[clearing, setClearing] = useState(false);
	const scroller = useRef<HTMLDivElement>(null),
		transcript = useRef<HTMLDivElement>(null),
		pinned = useRef(true),
		cursor = useRef<string | undefined>(undefined),
		reload = useRef<() => void>(() => {});
	const generation = useRef(0),
		draftRef = useRef(draft);
	draftRef.current = draft;
	const olderRef = useRef(older);
	olderRef.current = older;
	const full = async (id: string): Promise<BotMessage> => {
		let part: BotMessageDetail = await client.get(bot.id, id);
		let text = part.text;
		let next = part.nextCursor;
		while (next) {
			part = await client.get(bot.id, id, next);
			text += part.text;
			next = part.nextCursor;
		}
		return { ...part.message, text };
	};
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
						initialized = false;
						again = true;
						break;
					}
					for (const event of page.items) {
						if (!event.type.startsWith('message.')) continue;
						if (event.type === 'message.deleted') {
							generation.current++;
							setMessages((current) => {
								const next = new Map(current);
								next.delete(event.subjectId);
								return next;
							});
							continue;
						}
						if (
							['message.posted', 'message.edited', 'message.dispatch'].includes(
								event.type,
							)
						) {
							try {
								const message = await full(event.subjectId);
								if (live)
									setMessages((current) =>
										new Map(current).set(message.id, message),
									);
							} catch {
								if (live)
									setMessages((current) => {
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
	}, [client, bot.id]);
	const ordered = useMemo(
		() => [...messages.values()].sort((a, b) => a.sequence - b.sequence),
		[messages],
	);
	const items = useMemo(
		() =>
			ordered.map((message) => ({
				kind:
					message.author === 'user' ? ('user' as const) : ('agent' as const),
				key: message.id,
				text:
					message.text +
					message.attachments
						.map(
							(a) =>
								`\n\n![${a.name.replace(/[\[\]]/g, '')}](bot-attachment:${a.id})`,
						)
						.join(''),
			})),
		[ordered],
	);
	useLayoutEffect(() => {
		if (visible && pinned.current && scroller.current)
			scroller.current.scrollTop = scroller.current.scrollHeight;
	}, [items, visible]);
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
	const send = async () => {
		if (sending || !draft.trim()) return;
		const text = draft,
			view = generation.current;
		setSending(true);
		setError(undefined);
		try {
			const result = await client.post(bot.id, text, crypto.randomUUID());
			if (view === generation.current)
				setMessages((current) =>
					new Map(current).set(result.message.id, result.message),
				);
			if (draftRef.current === text) onDraftChange('');
			pinned.current = true;
			if (result.error) setError(result.error);
			server.refreshBot(bot.id);
		} catch (cause) {
			setError(refusalText(cause));
		} finally {
			setSending(false);
		}
	};
	const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (
			event.key === 'Enter' &&
			!event.shiftKey &&
			!event.nativeEvent.isComposing
		) {
			event.preventDefault();
			void send();
		}
	};
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
	return (
		<div className="bots-chatwrap">
			{menu ? (
				<ContextMenu
					x={menu.x}
					y={menu.y}
					onClose={() => setMenu(undefined)}
					items={[
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
							label: 'Delete message',
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
						bot={bot}
						transport={server.transport}
						onMessageMenu={(id, _text, x, y) => {
							const message = messages.get(id);
							if (message)
								setMenu({
									id,
									text: message.text,
									revision: message.revision,
									x,
									y,
								});
						}}
					/>
					{ordered
						.filter((m) => m.dispatch?.state === 'failed')
						.map((m) => (
							<p key={m.id} className="bots-note bots-note--warn">
								{m.dispatch?.error}
							</p>
						))}
				</div>
				<div className="bots-composer">
					{error ? (
						<div
							className="bots-note bots-note--error"
							role="alert"
							data-terminay-bot-chat-error="true"
						>
							{error}
							{error.includes('sign') ? (
								<button
									type="button"
									className="bots-link"
									data-terminay-bot-open-signin="true"
									onClick={() => onConfigure('profile')}
								>
									Open Sign-in
								</button>
							) : null}
							<button
								type="button"
								className="bots-link"
								onClick={() => reload.current()}
							>
								Reload messages
							</button>
						</div>
					) : null}
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void send();
						}}
					>
						<textarea
							value={draft}
							rows={2}
							aria-label={`Message ${bot.name}`}
							placeholder={`Message ${bot.name} · Enter to send`}
							onChange={(event) => onDraftChange(event.target.value)}
							onKeyDown={keyDown}
							data-terminay-bot-composer="true"
						/>
						<div className="bots-composer__row">
							<div className="bots-composer__actions">
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
							</div>
							<button
								type="submit"
								className="bots-btn bots-btn--primary"
								disabled={sending || !draft.trim()}
								data-terminay-bot-send="true"
							>
								{sending ? 'Posting…' : 'Send'}
							</button>
						</div>
					</form>
				</div>
			</div>
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
		</div>
	);
}
