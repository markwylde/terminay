/** Shared communication log. Provider output lives exclusively in execution details. */
import { BotMessagesClient } from '@terminay/client-core';
import type {
	BotMessage,
	BotMessageDetail,
	BotProfile,
	BotSessionRecord,
} from '@terminay/protocol';
import { Paperclip, X } from 'lucide-react';
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from '../../components/ContextMenu';
import { recallBotChatRead, rememberBotChatRead } from '../localViewState';
import { BotTranscript } from './BotTranscript';
import { BotContextRail } from './BotContextRail';
import {
	BOT_CHAT_IMAGE_TYPES,
	type ChatSendAttempt,
	acceptChatImages,
	chatSendAttempt,
} from './botsModel';
import type { BotConfigTab } from './BotTab';
import type { BotEnvironmentSubTab } from './BotEnvironmentPanel';
import { refusalText, type ServerBots } from './useServerBots';

interface PendingImage {
	readonly key: string;
	readonly file: File;
	/** Display name sent with the upload; pasted images get a generated one. */
	readonly name: string;
	readonly url: string;
}

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
	const [messages, setMessages] = useState<ReadonlyMap<string, BotMessage>>(
		new Map(),
	);
	const [older, setOlder] = useState<string | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState<string>(),
		[sending, setSending] = useState(false),
		[mutating, setMutating] = useState(false),
		[recovering, setRecovering] = useState<string>();
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
		divider = useRef<HTMLDivElement>(null),
		jumpPending = useRef(false),
		pinned = useRef(true),
		cursor = useRef<string | undefined>(undefined),
		reload = useRef<() => void>(() => {});
	// Images waiting to be sent. Each keeps the upload token it was given, so a
	// retry of the same attempt does not upload or post it twice.
	const [pending, setPending] = useState<readonly PendingImage[]>([]),
		[attachError, setAttachError] = useState<string>(),
		[dragging, setDragging] = useState(false);
	const picker = useRef<HTMLInputElement>(null),
		pendingRef = useRef(pending),
		attempt = useRef<ChatSendAttempt | undefined>(undefined),
		tokens = useRef(new Map<string, string>()),
		pasted = useRef(0);
	pendingRef.current = pending;
	useEffect(
		() => () => {
			for (const image of pendingRef.current) URL.revokeObjectURL(image.url);
		},
		[],
	);
	const addImages = (files: readonly File[]) => {
		if (!files.length) return;
		const { accepted, refusal } = acceptChatImages(
			pendingRef.current.length,
			files,
		);
		setAttachError(refusal);
		if (!accepted.length) return;
		setPending((current) => [
			...current,
			...accepted.map((file) => ({
				key: crypto.randomUUID(),
				file,
				name:
					file.name && file.name !== 'image.png'
						? file.name
						: `pasted-${++pasted.current}.${file.type.split('/')[1] ?? 'png'}`,
				url: URL.createObjectURL(file),
			})),
		]);
	};
	const removeImage = (key: string) => {
		setPending((current) => {
			const gone = current.find((image) => image.key === key);
			if (gone) URL.revokeObjectURL(gone.url);
			return current.filter((image) => image.key !== key);
		});
		tokens.current.delete(key);
		setAttachError(undefined);
	};
	const clearImages = (sent: readonly PendingImage[]) => {
		const keys = new Set(sent.map((image) => image.key));
		for (const image of sent) {
			URL.revokeObjectURL(image.url);
			tokens.current.delete(image.key);
		}
		setPending((current) => current.filter((image) => !keys.has(image.key)));
	};
	const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = [...event.clipboardData.files].filter((file) =>
			file.type.startsWith('image/'),
		);
		if (!files.length) return;
		// A screenshot paste carries no text; text alongside an image still pastes.
		if (!event.clipboardData.types.includes('text/plain')) event.preventDefault();
		addImages(files);
	};
	const hasFiles = (event: DragEvent) =>
		[...event.dataTransfer.types].includes('Files');
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
	// Read position: snapshotted when Chat is entered so the divider stays put
	// while the user reads; written back when they leave.
	// A start failure stays visible until it is dismissed or a later user
	// message has started an execution.
	const startFailures = useMemo(() => {
		let laterStarted = false;
		const shown: BotMessage[] = [];
		for (let i = ordered.length - 1; i >= 0; i--) {
			const m = ordered[i]!;
			if (m.author !== 'user') continue;
			if (m.dispatch?.state === 'started') laterStarted = true;
			else if (
				m.dispatch?.state === 'failed' &&
				!m.dispatch.dismissed &&
				!laterStarted
			)
				shown.unshift(m);
		}
		return shown;
	}, [ordered]);
	const latest = ordered.at(-1)?.sequence;
	const latestRef = useRef(latest);
	latestRef.current = latest;
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
	const items = useMemo(
		() =>
			ordered.map((message) =>
				message.author === 'user'
					? {
							kind: 'user' as const,
							key: message.id,
							text: message.text,
							attachments: message.attachments,
						}
					: {
							kind: 'agent' as const,
							key: message.id,
							text:
								message.text +
								message.attachments
									.map(
										(a) =>
											`\n\n![${a.name.replace(/[[\]]/g, '')}](bot-attachment:${a.id})`,
									)
									.join(''),
						},
			),
		[ordered],
	);
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
					? (
							await client.retry(bot.id, message.id, message.revision, attempt)
						).message
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
	const send = async () => {
		const images = pendingRef.current;
		if (sending || (!draft.trim() && !images.length)) return;
		const text = draft,
			view = generation.current;
		// The same text and images reuse the previous attempt's key, so a post
		// whose response was lost is replayed, not duplicated.
		const current = chatSendAttempt(
			attempt.current,
			JSON.stringify([text, images.map((image) => image.key)]),
			() => crypto.randomUUID(),
		);
		attempt.current = current;
		setSending(true);
		setError(undefined);
		setAttachError(undefined);
		try {
			const uploads: string[] = [];
			for (const image of images) {
				let token = tokens.current.get(image.key);
				if (!token) {
					const bytes = new Uint8Array(await image.file.arrayBuffer());
					token = (await client.upload(bot.id, image.name, bytes)).token;
					tokens.current.set(image.key, token);
				}
				uploads.push(token);
			}
			const result = await client.post(bot.id, text, current.key, uploads);
			attempt.current = undefined;
			if (view === generation.current)
				setMessages((current) =>
					new Map(current).set(result.message.id, result.message),
				);
			if (draftRef.current === text) onDraftChange('');
			clearImages(images);
			pinned.current = true;
			// Replying means the user has caught up.
			rememberBotChatRead(bot.id, result.message.sequence);
			setReadThrough(result.message.sequence);
			// A start failure shows as the message's warning with Retry and
			// Dismiss; only a missing sign-in also needs the composer's link.
			if (
				result.error &&
				(result.message.dispatch?.state !== 'failed' ||
					/not signed in/.test(result.error))
			)
				setError(result.error);
			server.refreshBot(bot.id);
		} catch (cause) {
			const message = refusalText(cause);
			// Staged uploads expire or vanish on restart: upload again next time.
			if (/no longer available/i.test(message)) {
				for (const image of images) tokens.current.delete(image.key);
				attempt.current = undefined;
			}
			setError(message);
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
						messageTimes={times}
						unread={unread ? { ...unread, ref: divider } : undefined}
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
					{startFailures.map((m) => (
						<div
							key={m.id}
							className="bots-note bots-note--warn bots-start-failure"
							data-terminay-bot-start-failure={m.id}
						>
							<span>{m.dispatch?.error}</span>
							<span className="bots-start-failure__actions">
								<button
									type="button"
									className="bots-btn bots-btn--sm"
									disabled={recovering !== undefined}
									data-terminay-bot-start-failure-retry="true"
									onClick={() => void recover(m, 'retry')}
								>
									{recovering === m.id ? 'Retrying…' : 'Retry'}
								</button>
								<button
									type="button"
									className="bots-btn bots-btn--sm bots-btn--ghost"
									disabled={recovering !== undefined}
									data-terminay-bot-start-failure-dismiss="true"
									onClick={() => void recover(m, 'dismiss')}
								>
									Dismiss
								</button>
							</span>
						</div>
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
						className={dragging ? 'bots-composer--drop' : undefined}
						data-terminay-bot-composer-form="true"
						onSubmit={(event) => {
							event.preventDefault();
							void send();
						}}
						onDragOver={(event) => {
							if (!hasFiles(event)) return;
							event.preventDefault();
							event.dataTransfer.dropEffect = 'copy';
							setDragging(true);
						}}
						onDragLeave={(event) => {
							if (!event.currentTarget.contains(event.relatedTarget as Node))
								setDragging(false);
						}}
						onDrop={(event) => {
							if (!hasFiles(event)) return;
							event.preventDefault();
							setDragging(false);
							addImages([...event.dataTransfer.files]);
						}}
					>
						{pending.length ? (
							<ul
								className="bots-composer__images"
								aria-label="Images to send"
								data-terminay-bot-pending-images="true"
							>
								{pending.map((image) => (
									<li key={image.key} className="bots-composer__image">
										<img src={image.url} alt={image.name} />
										<button
											type="button"
											className="bots-composer__remove"
											aria-label={`Remove ${image.name}`}
											title={`Remove ${image.name}`}
											disabled={sending}
											onClick={() => removeImage(image.key)}
										>
											<X size={12} aria-hidden="true" />
										</button>
									</li>
								))}
							</ul>
						) : null}
						{attachError ? (
							<p
								className="bots-composer__refusal"
								role="status"
								data-terminay-bot-attach-error="true"
							>
								{attachError}
							</p>
						) : null}
						<textarea
							value={draft}
							rows={2}
							aria-label={`Message ${bot.name}`}
							placeholder={`Message ${bot.name} · Enter to send`}
							onChange={(event) => onDraftChange(event.target.value)}
							onKeyDown={keyDown}
							onPaste={onPaste}
							data-terminay-bot-composer="true"
						/>
						<input
							ref={picker}
							type="file"
							hidden
							multiple
							accept={BOT_CHAT_IMAGE_TYPES.join(',')}
							data-terminay-bot-attach-input="true"
							onChange={(event) => {
								addImages([...(event.target.files ?? [])]);
								event.target.value = '';
							}}
						/>
						<div className="bots-composer__row">
							<div className="bots-composer__actions">
								<button
									type="button"
									className="bots-btn bots-btn--sm bots-btn--ghost bots-composer__attach"
									aria-label="Attach images"
									title="Attach images"
									disabled={sending}
									data-terminay-bot-attach="true"
									onClick={() => picker.current?.click()}
								>
									<Paperclip size={16} aria-hidden="true" />
								</button>
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
								disabled={sending || (!draft.trim() && !pending.length)}
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
