/**
 * One thread beside Chat: its root, its replies and a composer that posts
 * into it. It follows the bot's message events itself, applying each change
 * to the one message it names, so loaded history and the reading position
 * survive live updates.
 */
import type { BotIoTransport, BotMessagesClient } from '@terminay/client-core';
import type { BotMessage, BotProfile } from '@terminay/protocol';
import { X } from 'lucide-react';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { BotComposer, type BotPostResult } from './BotComposer';
import { BotHistoryEdge } from './BotHistoryEdge';
import { BotStartFailures } from './BotStartFailures';
import { BotTranscript, type MessageMenuRequest } from './BotTranscript';
import {
	fullMessage,
	fullMessages,
	isNotFound,
	messageItem,
	replyCountLabel,
	visibleStartFailures,
} from './threadModel';
import { useOlderHistory } from './useOlderHistory';
import { refusalText } from './useServerBots';

export function BotThreadPanel({
	client,
	bot,
	transport,
	rootId,
	initialRoot,
	draft,
	onDraftChange,
	clearSentDraft,
	inputRef,
	escapeDisabled,
	onClose,
	onRootGone,
	onObserved,
	onMessageMenu,
	onPosted,
	onSignIn,
}: Readonly<{
	client: BotMessagesClient;
	bot: BotProfile;
	transport: BotIoTransport | undefined;
	rootId: string;
	/** The root as the main stream last showed it, until the panel reads it. */
	initialRoot: BotMessage | undefined;
	draft: string;
	onDraftChange: (value: string) => void;
	clearSentDraft: (sent: string) => void;
	inputRef?: (element: HTMLTextAreaElement | null) => void;
	escapeDisabled?: boolean;
	onClose: () => void;
	/** The root was deleted or the chat cleared. */
	onRootGone: () => void;
	/** The newest sequence the panel shows, so acknowledgement covers it. */
	onObserved: (sequence: number) => void;
	onMessageMenu: (request: MessageMenuRequest, message: BotMessage) => void;
	onPosted: (result: BotPostResult) => void;
	onSignIn: () => void;
}>) {
	const [root, setRoot] = useState(initialRoot);
	const [replies, setReplies] = useState<ReadonlyMap<string, BotMessage>>(
		new Map(),
	);
	const [older, setOlder] = useState<string | null>(null),
		[loading, setLoading] = useState(true),
		[error, setError] = useState<string>(),
		[recovering, setRecovering] = useState<string>();
	const scroller = useRef<HTMLDivElement>(null),
		sentinel = useRef<HTMLDivElement>(null),
		panel = useRef<HTMLElement>(null),
		pinned = useRef(true),
		// Bumped whenever the panel starts over; late responses are dropped.
		generation = useRef(0);
	const gone = useRef(onRootGone);
	gone.current = onRootGone;
	const upsert = useCallback((message: BotMessage) => {
		setReplies((current) =>
			(current.get(message.id)?.revision ?? 0) > message.revision
				? current
				: new Map(current).set(message.id, message),
		);
	}, []);
	useEffect(() => {
		let live = true,
			busy = false,
			again = false,
			cursor: string | undefined;
		const view = ++generation.current;
		const current = () => live && view === generation.current;
		setReplies(new Map());
		setOlder(null);
		setLoading(true);
		setError(undefined);
		pinned.current = true;
		const refreshRoot = async () => {
			try {
				const message = await fullMessage(client, bot.id, rootId);
				if (current()) setRoot(message);
			} catch (cause) {
				if (!current()) return;
				// Only a confirmed deletion closes the thread; a failed read keeps
				// it open with the error shown.
				if (isNotFound(cause)) gone.current();
				else setError(refusalText(cause));
			}
		};
		const load = async () => {
			const [rootMessage, page] = await Promise.all([
				fullMessage(client, bot.id, rootId),
				client.list(bot.id, { threadId: rootId, limit: 25 }),
			]);
			const details = await fullMessages(
				client,
				bot.id,
				page.items.map((m) => m.id),
			);
			if (!current()) return;
			setRoot(rootMessage);
			setReplies(new Map(details.map((m) => [m.id, m])));
			setOlder(page.nextCursor);
			cursor = page.eventsCursor;
		};
		const read = async () => {
			if (busy) {
				again = true;
				return;
			}
			busy = true;
			try {
				if (cursor === undefined) await load();
				let more = cursor !== undefined;
				while (more && current()) {
					const page = await client.events(bot.id, { cursor, limit: 25 });
					if (!current()) return;
					if (page.items.some((e) => e.type === 'messages.cleared')) {
						gone.current();
						return;
					}
					if (page.gap) {
						// Start over from the first page.
						cursor = undefined;
						again = true;
						break;
					}
					for (const event of page.items) {
						const id = event.subjectId;
						if (event.type === 'message.deleted') {
							if (id === rootId) {
								gone.current();
								return;
							}
							setReplies((now) => {
								if (!now.has(id)) return now;
								const next = new Map(now);
								next.delete(id);
								return next;
							});
						} else if (id === rootId) {
							if (
								[
									'message.edited',
									'message.dispatch',
									'message.thread',
								].includes(event.type)
							)
								await refreshRoot();
						} else if (
							['message.posted', 'message.edited', 'message.dispatch'].includes(
								event.type,
							)
						) {
							try {
								const message = await fullMessage(client, bot.id, id);
								if (current() && message.threadId === rootId) upsert(message);
							} catch (error) {
								// Deleted since: its own event follows.
								if (!isNotFound(error)) throw error;
							}
						}
					}
					cursor = page.nextCursor;
					more = page.hasMore;
				}
				if (current()) setLoading(false);
			} catch (cause) {
				if (!current()) return;
				if (isNotFound(cause)) gone.current();
				else {
					setError(refusalText(cause));
					setLoading(false);
				}
			} finally {
				busy = false;
				if (again && current()) {
					again = false;
					void read();
				}
			}
		};
		const unwatch = client.watch(bot.id, () => void read());
		void read();
		return () => {
			live = false;
			unwatch();
		};
	}, [client, bot.id, rootId, upsert]);
	// Opening a thread focuses the panel, never a text field: that would raise a
	// touch device's keyboard over the thread. Escape and Tab work from here.
	useEffect(() => {
		panel.current?.focus({ preventScroll: true });
	}, [rootId]);
	const ordered = useMemo(
		() => [...replies.values()].sort((a, b) => a.sequence - b.sequence),
		[replies],
	);
	const items = useMemo(() => ordered.map(messageItem), [ordered]);
	const shown = ordered.at(-1)?.sequence ?? root?.sequence;
	useEffect(() => {
		if (shown !== undefined) onObserved(shown);
	}, [shown, onObserved]);
	const rootItems = useMemo(() => (root ? [messageItem(root)] : []), [root]);
	const times = useMemo(
		() =>
			new Map(
				[...(root ? [root] : []), ...ordered].map((m) => [m.id, m.createdAt]),
			),
		[root, ordered],
	);
	const failures = useMemo(() => visibleStartFailures(ordered), [ordered]);
	useLayoutEffect(() => {
		const viewport = scroller.current;
		if (viewport && pinned.current) viewport.scrollTop = viewport.scrollHeight;
	}, [items, rootItems, failures]);
	// Older replies arrive as the reader scrolls up; see useOlderHistory.
	const fetchOlder = useCallback(
		async (next: string) => {
			const page = await client.list(bot.id, {
				threadId: rootId,
				cursor: next,
				limit: 25,
			});
			const details = await fullMessages(
				client,
				bot.id,
				page.items.map((m) => m.id),
			);
			return { details, next: page.nextCursor };
		},
		[client, bot.id, rootId],
	);
	const applyOlder = useCallback(
		({ details, next }: { details: BotMessage[]; next: string | null }) => {
			for (const m of details) upsert(m);
			setOlder(next);
		},
		[upsert],
	);
	const history = useOlderHistory({
		scroller,
		sentinel,
		cursor: older,
		generation,
		enabled: !loading,
		pinned,
		fetchPage: fetchOlder,
		apply: applyOlder,
	});
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
			if (view === generation.current) upsert(updated);
		} catch (cause) {
			if (view === generation.current) setError(refusalText(cause));
		} finally {
			setRecovering(undefined);
		}
	};
	const count = root?.thread?.replyCount ?? replies.size;
	return (
		<aside
			ref={panel}
			tabIndex={-1}
			className="bots-thread"
			aria-label="Thread"
			data-terminay-bot-thread={rootId}
			onKeyDown={(event) => {
				if (event.key !== 'Escape' || event.defaultPrevented || escapeDisabled)
					return;
				event.preventDefault();
				onClose();
			}}
		>
			<header className="bots-thread__head">
				<div className="bots-thread__title">
					<b>Thread</b>
					<span className="bots-faint">{bot.name}</span>
				</div>
				<button
					type="button"
					className="bots-btn bots-btn--sm bots-btn--ghost bots-thread__close"
					aria-label="Close thread"
					title="Close thread"
					data-terminay-bot-thread-close="true"
					onClick={onClose}
				>
					<X size={16} aria-hidden="true" />
				</button>
			</header>
			<div
				className="bots-scroll bots-thread__body"
				ref={scroller}
				onScroll={(event) => {
					const el = event.currentTarget;
					pinned.current =
						el.scrollHeight - el.scrollTop - el.clientHeight < 80;
				}}
			>
				{root ? (
					<div className="bots-thread__root">
						<BotTranscript
							items={rootItems}
							messageTimes={times}
							bot={bot}
							transport={transport}
							onMessageMenu={(request) => onMessageMenu(request, root)}
						/>
					</div>
				) : null}
				<div
					className="bots-thread__divider"
					data-terminay-bot-thread-count={count}
				>
					<span>{count ? replyCountLabel(count) : 'No replies yet'}</span>
				</div>
				<BotHistoryEdge
					sentinel={sentinel}
					more={!!older}
					loading={history.loading}
					error={history.error}
					onRetry={history.retry}
					noun="replies"
					start={false}
				/>
				{loading && !replies.size && count > 0 ? (
					<p className="bots-faint">Loading replies…</p>
				) : null}
				<BotTranscript
					items={items}
					messageTimes={times}
					bot={bot}
					transport={transport}
					onMessageMenu={(request) => {
						const message = replies.get(request.key);
						if (message) onMessageMenu(request, message);
					}}
				/>
				<BotStartFailures
					failures={failures}
					recovering={recovering}
					onRecover={(m, action) => void recover(m, action)}
				/>
				{error ? (
					<p className="bots-note bots-note--error" role="alert">
						{error}
					</p>
				) : null}
			</div>
			<BotComposer
				key={rootId}
				client={client}
				botId={bot.id}
				threadId={rootId}
				draft={draft}
				onDraftChange={onDraftChange}
				clearSentDraft={clearSentDraft}
				label={`Reply in thread to ${bot.name}`}
				placeholder="Reply in thread…"
				inputRef={inputRef}
				onPosted={(result) => {
					pinned.current = true;
					if (result.message.threadId === rootId) upsert(result.message);
					onPosted(result);
				}}
				onSignIn={onSignIn}
			/>
		</aside>
	);
}
