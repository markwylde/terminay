/**
 * Chat with a bot, beside a context rail.
 *
 * Chat shows the session the user is in: the one they opened, or else the
 * bot's open chat session. Sending continues that session or starts one; the
 * server queues the message when the bot is busy, and the chat says so.
 */

import type {
	BotPermission,
	BotProfile,
	BotSessionRecord,
} from '@terminay/protocol';
import {
	Brain,
	FolderOpen,
	Monitor,
	Plus,
	Square,
	SquareTerminal,
	Zap,
} from 'lucide-react';
import {
	type KeyboardEvent,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { BotDesktopCanvas } from './BotDesktopView';
import type { BotEnvironmentSubTab } from './BotEnvironmentPanel';
import type { BotConfigTab } from './BotTab';
import { BotTranscript } from './BotTranscript';
import { formatWhen } from './BotTriggersPanel';
import { SESSION_STATE_LABELS, sessionTitle, shortAge } from './botsModel';
import { foldTranscript } from './transcriptModel';
import { useBotSession } from './useBotSession';
import { useNow } from './useNow';
import { refusalText, type ServerBots } from './useServerBots';


/** The session Chat shows: the chosen one, else the bot's open chat. */
export function chatSession(
	sessions: readonly BotSessionRecord[],
	chosenId: string | undefined,
	fresh: boolean,
): BotSessionRecord | undefined {
	if (chosenId !== undefined) {
		const chosen = sessions.find((s) => s.id === chosenId);
		if (chosen !== undefined) return chosen;
	}
	if (fresh) return undefined;
	return sessions.find((s) => s.origin.kind === 'chat' && s.open);
}

/** What the chat says about a session that is not simply running. */
export function sessionNotice(
	record: BotSessionRecord,
	busyWith: BotSessionRecord | undefined,
	environment: string,
): string | undefined {
	switch (record.state) {
		case 'queued':
			if (environment === 'starting' || environment === 'stopped')
				return 'Starting the bot’s container…';
			return busyWith === undefined
				? 'Waiting for the bot.'
				: `The bot is busy with “${sessionTitle(busyWith)}”. Your message is sent when that turn ends.`;
		case 'suspended':
			return record.canLoad
				? 'This chat was paused so other work could run. Your next message resumes it.'
				: 'This chat was paused so other work could run. This agent cannot resume it, so your next message starts a new session.';
		case 'stopped':
			return record.open
				? 'Stopped. Your next message continues this session.'
				: 'Stopped. This agent cannot resume, so your next message starts a new session.';
		case 'timed-out':
			return 'This turn reached its maximum duration and was stopped.';
		case 'failed':
			return `This session failed${record.reason ? `: ${record.reason}` : '.'}`;
		case 'interrupted':
			return 'The server restarted during this session. Continue it from Sessions.';
		case 'completed':
			return record.open ? undefined : 'This session has ended.';
		default:
			return undefined;
	}
}

export function BotChat({
	server,
	bot,
	sessions,
	environment,
	sessionId,
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
	onSessionChange: (sessionId: string | undefined) => void;
	draft: string;
	onDraftChange: (draft: string) => void;
	onConfigure: (tab: BotConfigTab, sub?: BotEnvironmentSubTab) => void;
	/** Whether the tab is on screen; the live thumbnail runs only then. */
	visible: boolean;
}>) {
	const now = useNow();
	const [fresh, setFresh] = useState(false);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string>();
	const [queueIds, setQueueIds] = useState<ReadonlyMap<string, string>>(
		new Map(),
	);
	const record = chatSession(sessions, sessionId, fresh);
	const { session, error: readError } = useBotSession(server, bot.id, record);
	const items = useMemo(
		() =>
			foldTranscript(
				session?.id === record?.id ? (session?.updates ?? []) : [],
			),
		[session, record?.id],
	);
	const running = record?.state === 'running' || record?.state === 'needs-you';
	const busyWith = sessions.find(
		(s) =>
			s.id !== record?.id && (s.state === 'running' || s.state === 'needs-you'),
	);
	const notice =
		record === undefined
			? undefined
			: sessionNotice(record, busyWith, environment);
	const queued = record?.queuedMessage ?? null;
	const queueId =
		record === undefined
			? undefined
			: ((record.queuedMessage as { id?: string } | null)?.id ??
				queueIds.get(record.id));

	// Keep the newest output in view unless the user scrolled up to read.
	const scroller = useRef<HTMLDivElement>(null);
	const pinned = useRef(true);
	useLayoutEffect(() => {
		const el = scroller.current;
		if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
	}, [items, notice]);

	useEffect(() => {
		if (sessionId !== undefined) setFresh(false);
	}, [sessionId]);

	const act = (work: Promise<unknown>) => {
		setError(undefined);
		work
			.then(() => server.refreshBot(bot.id))
			.catch((cause: unknown) => setError(refusalText(cause)));
	};

	const send = () => {
		const text = draft.trim();
		if (text.length === 0 || sending) return;
		setSending(true);
		setError(undefined);
		const target = record?.open === true ? record.id : undefined;
		server.client
			.send(bot.id, text, target)
			.then((result) => {
				onDraftChange('');
				setFresh(false);
				setQueueIds((map) =>
					new Map(map).set(result.sessionId, result.queueId),
				);
				onSessionChange(result.sessionId);
				pinned.current = true;
				server.refreshBot(bot.id);
			})
			.catch((cause: unknown) => setError(refusalText(cause)))
			.finally(() => setSending(false));
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (
			event.key === 'Enter' &&
			!event.shiftKey &&
			!event.nativeEvent.isComposing
		) {
			event.preventDefault();
			send();
		}
	};

	return (
		<div className="bots-chatwrap">
			<div className="bots-chatcol">
				<div
					className="bots-scroll bots-msgs"
					ref={scroller}
					onScroll={(event) => {
						const el = event.currentTarget;
						pinned.current =
							el.scrollHeight - el.scrollTop - el.clientHeight < 40;
					}}
				>
					{record === undefined ? (
						<div className="bots-placeholder" data-terminay-bot-chat="empty">
							<b>Message {bot.name}</b>
							<span>
								Your message starts a new session. The bot’s container starts if
								it is stopped.
							</span>
						</div>
					) : (
						<>
							<BotTranscript items={items} bot={bot} />
							{readError ? (
								<div className="bots-note bots-note--warn">{readError}</div>
							) : null}
							{record.permission !== null ? (
								<PermissionPrompt
									permission={record.permission}
									onDecide={(optionId) =>
										act(
											server.client.decide(
												bot.id,
												record.id,
												record.permission?.id ?? '',
												optionId,
											),
										)
									}
								/>
							) : null}
							{record.state === 'running' ? (
								<div className="bots-typing" data-terminay-bot-typing="true">
									<span className="bots-typing__dot" />
									{bot.name} is working
								</div>
							) : null}
							{notice ? (
								<div
									className="bots-note"
									data-terminay-bot-notice={record.state}
								>
									{notice}
								</div>
							) : null}
							{queued !== null ? (
								<div
									className="bots-card bots-queued"
									data-terminay-bot-queued={queued.status}
								>
									<span className="bots-lab">
										{queued.status === 'queued' ? 'Queued' : 'Not sent'}
									</span>
									<span className="bots-queued__text">{queued.text}</span>
									{queued.status === 'queued' && queueId !== undefined ? (
										<button
											type="button"
											className="bots-link"
											onClick={() =>
												act(server.client.cancelQueued(bot.id, queueId))
											}
										>
											Cancel
										</button>
									) : null}
								</div>
							) : null}
						</>
					)}
				</div>
				<div className="bots-composer">
					{error ? (
						<div
							className="bots-note bots-note--error"
							role="alert"
							data-terminay-bot-chat-error="true"
						>
							{error}
							{/not signed in/i.test(error) ? (
								<>
									{' '}
									<button
										type="button"
										className="bots-link"
										onClick={() => onConfigure('profile')}
										data-terminay-bot-open-signin="true"
									>
										Open Sign-in
									</button>
								</>
							) : null}
						</div>
					) : null}
					<form
						onSubmit={(event) => {
							event.preventDefault();
							send();
						}}
					>
						<textarea
							value={draft}
							rows={2}
							aria-label={`Message ${bot.name}`}
							placeholder={`Message ${bot.name} · Enter to send`}
							onChange={(event) => onDraftChange(event.target.value)}
							onKeyDown={onKeyDown}
							data-terminay-bot-composer="true"
						/>
						<div className="bots-composer__row">
							{running && record !== undefined ? (
								<span className="bots-composer__stop">
									<button
										type="button"
										className="bots-btn bots-btn--sm bots-btn--danger"
										onClick={() =>
											act(server.client.control(bot.id, record.id, 'stop'))
										}
										data-terminay-bot-stop="true"
									>
										<Square size={12} aria-hidden="true" /> Stop
									</button>
									<span className="bots-faint">Enter to queue a message</span>
								</span>
							) : record !== undefined ? (
								<button
									type="button"
									className="bots-btn bots-btn--sm bots-btn--ghost"
									onClick={() => {
										setFresh(true);
										onSessionChange(undefined);
										if (record.origin.kind === 'chat' && record.open)
											act(server.client.newChat(bot.id));
									}}
									title="Start a new session"
									data-terminay-bot-new-chat="true"
								>
									<Plus size={13} aria-hidden="true" /> New chat
								</button>
							) : (
								<span />
							)}
							<button
								type="submit"
								className="bots-btn bots-btn--primary"
								disabled={draft.trim().length === 0 || sending}
								data-terminay-bot-send="true"
							>
								{running ? 'Queue' : 'Send'}
							</button>
						</div>
					</form>
				</div>
			</div>
			<aside
				className="bots-rail bots-scroll"
				aria-label={`${bot.name} context`}
			>
				<section>
					<div className="bots-railhead">
						<h3 className="bots-lab">Desktop</h3>
						{environment === 'running' ? (
							<button
								type="button"
								className="bots-link"
								onClick={() => onConfigure('environment', 'desktop')}
							>
								Open desktop
							</button>
						) : null}
					</div>
					{environment === 'running' && visible ? (
						<div
							className="bots-desk bots-desk--live"
							data-terminay-bot-desk-thumb="live"
						>
							<BotDesktopCanvas
								server={server}
								bot={bot}
								mode="view-only"
								thumbnail
							/>
							<button
								type="button"
								className="bots-desk__open"
								aria-label="Open the desktop"
								onClick={() => onConfigure('environment', 'desktop')}
							/>
						</div>
					) : (
						<button
							type="button"
							className="bots-desk"
							onClick={() => onConfigure('environment', 'desktop')}
							data-terminay-bot-desk-thumb={environment}
						>
							<Monitor size={20} aria-hidden="true" />
							<span>The desktop shows while the container runs</span>
						</button>
					)}
				</section>
				<section>
					<div className="bots-railhead">
						<h3 className="bots-lab">Recent sessions</h3>
						<button
							type="button"
							className="bots-link"
							onClick={() => onConfigure('sessions')}
						>
							View all
						</button>
					</div>
					{sessions.length === 0 ? (
						<p className="bots-faint">No sessions yet.</p>
					) : (
						<ul className="bots-sesslist">
							{sessions.slice(0, 6).map((s) => (
								<li key={s.id}>
									<button
										type="button"
										className={`bots-sess${s.id === record?.id ? ' bots-sess--on' : ''}`}
										onClick={() => {
											setFresh(false);
											onSessionChange(s.id);
										}}
									>
										<span
											className={`bots-sess__dot bots-sess__dot--${s.state}`}
											aria-hidden="true"
										/>
										<span className="bots-sess__body">
											<span className="bots-sess__t">{sessionTitle(s)}</span>
											<span className="bots-sess__m">
												{SESSION_STATE_LABELS[s.state]} ·{' '}
												{shortAge(s.startedAt, now)}
											</span>
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</section>
				<section>
					<div className="bots-railhead">
						<h3 className="bots-lab">Upcoming</h3>
						<button
							type="button"
							className="bots-link"
							onClick={() => onConfigure('triggers')}
						>
							Triggers
						</button>
					</div>
					{(server.upcoming.get(bot.id) ?? []).length === 0 ? (
						<p className="bots-faint">No upcoming firings.</p>
					) : (
						<ul className="bots-upnext" data-terminay-bot-upcoming="true">
							{(server.upcoming.get(bot.id) ?? []).slice(0, 3).map((firing) => (
								<li key={`${firing.triggerId}:${firing.at}`}>
									<span className="bots-mono">{formatWhen(firing.at)}</span>
									<span>{firing.triggerName}</span>
								</li>
							))}
						</ul>
					)}
				</section>
				<section>
					<div className="bots-railhead">
						<h3 className="bots-lab">Shortcuts</h3>
					</div>
					<div className="bots-shortcuts">
						<button
							type="button"
							className="bots-btn bots-btn--sm"
							onClick={() => onConfigure('environment', 'files')}
						>
							<FolderOpen size={13} aria-hidden="true" /> Files
						</button>
						<button
							type="button"
							className="bots-btn bots-btn--sm"
							onClick={() => onConfigure('environment', 'shell')}
						>
							<SquareTerminal size={13} aria-hidden="true" /> Shell
						</button>
						<button
							type="button"
							className="bots-btn bots-btn--sm"
							onClick={() => onConfigure('memories')}
						>
							<Brain size={13} aria-hidden="true" /> Memories
						</button>
						<button
							type="button"
							className="bots-btn bots-btn--sm"
							onClick={() => onConfigure('triggers')}
						>
							<Zap size={13} aria-hidden="true" /> Triggers
						</button>
					</div>
				</section>
			</aside>
		</div>
	);
}

function PermissionPrompt({
	permission,
	onDecide,
}: Readonly<{
	permission: BotPermission;
	onDecide: (optionId: string) => void;
}>) {
	const toolCall = permission.toolCall as Record<string, unknown> | null;
	const title =
		typeof toolCall?.title === 'string' && toolCall.title.length > 0
			? toolCall.title
			: 'A tool';
	return (
		<fieldset
			className="bots-card bots-ask"
			aria-label="Permission request"
			data-terminay-bot-permission={permission.id}
		>
			<span className="bots-lab">Needs you</span>
			<b>{title}</b>
			<div className="bots-ask__options">
				{permission.options.map((option) => (
					<button
						key={option.optionId}
						type="button"
						className={`bots-btn bots-btn--sm${option.kind.startsWith('allow') ? ' bots-btn--primary' : ''}`}
						onClick={() => onDecide(option.optionId)}
						data-terminay-bot-permission-option={option.optionId}
					>
						{option.name}
					</button>
				))}
			</div>
		</fieldset>
	);
}
