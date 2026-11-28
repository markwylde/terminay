import {
	BotIoClient,
	type BotIoTransport,
	BotMessagesClient,
} from '@terminay/client-core';
/**
 * A session's transcript: messages, collapsible tool entries, and the plan as
 * a checklist. Shared by Chat and the Sessions tab.
 */

import type {
	BotMessageAttachment,
	BotProfile,
	BotThreadSummary,
} from '@terminay/protocol';
import {
	Check,
	ChevronRight,
	Circle,
	Download,
	FileText,
	LoaderCircle,
	MessageSquareReply,
	Music,
	Pause,
	Play,
	User,
	X,
} from 'lucide-react';
import {
	type CSSProperties,
	Fragment,
	type MouseEvent,
	memo,
	type Ref,
	type RefObject,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { saveDownload } from '../../host/nativeActions';
import { BotAvatar } from './BotAvatar';
import {
	attachmentView,
	formatFileSize,
	formatPlaybackTime,
} from './botsModel';
import { replyCountLabel } from './threadModel';

/** A root's thread, as the reply bar under it shows it. */
export type TranscriptThread = Readonly<{
	summary: BotThreadSummary;
	/** It holds a bot reply this device has not read. */
	isNew: boolean;
}>;

/** Shown on a top-level message while it is hovered or holds focus. */
function MessageActions({
	messageKey,
	onOpenThread,
}: Readonly<{ messageKey: string; onOpenThread: (key: string) => void }>) {
	return (
		<div className="bots-msg__actions">
			<button
				type="button"
				className="bots-msg__action"
				aria-label="Reply in thread"
				title="Reply in thread"
				data-terminay-bot-reply-in-thread={messageKey}
				onClick={() => onOpenThread(messageKey)}
			>
				<MessageSquareReply size={15} aria-hidden="true" />
			</button>
		</div>
	);
}

/** Under a root with replies: who replied, how many, and when. */
function ReplyBar({
	messageKey,
	thread,
	bot,
	onOpenThread,
}: Readonly<{
	messageKey: string;
	thread: TranscriptThread;
	bot: Pick<BotProfile, 'id' | 'name' | 'colour' | 'avatar' | 'avatarStyle'>;
	onOpenThread: (key: string) => void;
}>) {
	const { summary, isNew } = thread;
	return (
		<button
			type="button"
			className={isNew ? 'bots-replies bots-replies--new' : 'bots-replies'}
			data-terminay-bot-thread-replies={summary.replyCount}
			data-terminay-bot-thread-new={isNew ? 'true' : undefined}
			aria-label={`${replyCountLabel(summary.replyCount)}${isNew ? ', new' : ''}. Open thread`}
			onClick={() => onOpenThread(messageKey)}
		>
			<span className="bots-replies__faces" aria-hidden="true">
				{summary.authors.slice(0, 2).map((author) =>
					author === 'bot' ? (
						<BotAvatar key={author} bot={bot} size="sm" />
					) : (
						<span key={author} className="bots-replies__you" title="You">
							<User size={12} aria-hidden />
						</span>
					),
				)}
			</span>
			<span className="bots-replies__count">
				{replyCountLabel(summary.replyCount)}
			</span>
			<span className="bots-replies__time">
				Last reply {messageTime(summary.lastReplyAt)}
			</span>
			<span className="bots-replies__open" aria-hidden="true">
				View thread
				<ChevronRight size={13} />
			</span>
		</button>
	);
}

/** Saves an attachment's bytes through the host save (ADR-0130), tracking the
 * in-flight save and its error. */
function useSaveAttachment(
	name: string,
	download: (() => Promise<{ bytes: Uint8Array }>) | undefined,
) {
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string>();
	const save = () => {
		if (!download || busy) return;
		setBusy(true);
		setError(undefined);
		void saveDownload({
			filename: name,
			chunks: async function* () {
				yield (await download()).bytes;
			},
		})
			.catch((cause: unknown) =>
				setError(cause instanceof Error ? cause.message : 'Download failed'),
			)
			.finally(() => setBusy(false));
	};
	return { busy, error, save };
}

/** A sent non-image attachment. It is never rendered: activating it saves
 * its bytes through the host save (ADR-0130). */
function FileChip({
	attachment,
	download,
}: Readonly<{
	attachment: Pick<BotMessageAttachment, 'name' | 'size'>;
	download: (() => Promise<{ bytes: Uint8Array }>) | undefined;
}>) {
	const { busy, error, save } = useSaveAttachment(attachment.name, download);
	return (
		<>
			<button
				type="button"
				className="bots-file-chip"
				disabled={!download || busy}
				title={`Download ${attachment.name}`}
				aria-label={`Download ${attachment.name}`}
				data-terminay-bot-file-chip={attachment.name}
				onClick={save}
			>
				<FileText size={18} aria-hidden="true" />
				<span className="bots-file-chip__text">
					<span className="bots-file-chip__name">{attachment.name}</span>
					<span className="bots-file-chip__size">
						{formatFileSize(attachment.size)}
					</span>
				</span>
				{busy ? (
					<LoaderCircle size={14} className="bots-spin" aria-hidden="true" />
				) : (
					<Download size={14} aria-hidden="true" />
				)}
			</button>
			{error ? (
				<span className="bots-file-chip__error" role="status">
					{error}
				</span>
			) : null}
		</>
	);
}

type AttachmentLoader = (
	id: string,
	signal?: AbortSignal,
) => Promise<{ mime: string; bytes: Uint8Array }>;

/** The nearest ancestor that scrolls: an observer's margin only extends its root. */
function scrollParent(element: HTMLElement): HTMLElement | null {
	for (let at = element.parentElement; at; at = at.parentElement)
		if (/auto|scroll/.test(getComputedStyle(at).overflowY)) return at;
	return null;
}

/**
 * A playable attachment's `blob:` URL. Bytes load near the viewport, a paused
 * player far away releases them, unmounting aborts the load and revokes the
 * URL, and a late result is discarded. The server's content type must match
 * `kind`, never the name or the recorded type (ADR-0143). With `pauseHidden`,
 * a player that stops being displayed is paused.
 */
function useAttachmentMedia(
	attachmentId: string,
	load: AttachmentLoader,
	kind: 'video' | 'audio',
	media: RefObject<HTMLMediaElement | null>,
	pauseHidden = false,
) {
	const frame = useRef<HTMLDivElement>(null),
		near = useRef(false);
	const [wanted, setWanted] = useState(false),
		[url, setUrl] = useState<string>(),
		[failed, setFailed] = useState(false);
	useEffect(() => {
		const element = frame.current;
		if (!element || typeof IntersectionObserver === 'undefined') {
			setWanted(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[entries.length - 1];
				if (!entry) return;
				near.current = entry.isIntersecting;
				if (entry.isIntersecting) setWanted(true);
				else if (media.current?.paused ?? true) setWanted(false);
			},
			{ root: scrollParent(element), rootMargin: '200% 0px' },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [media]);
	// A player that stops being displayed (Chat left, tab or panel hidden)
	// collapses to no box wherever it is scrolled; intersection alone misses
	// that once the player is already outside the observer's root.
	useEffect(() => {
		const element = frame.current;
		if (!pauseHidden || !element || typeof ResizeObserver === 'undefined')
			return;
		const observer = new ResizeObserver((entries) => {
			const box = entries[entries.length - 1]?.contentRect;
			if (box && box.width === 0 && box.height === 0) media.current?.pause();
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [media, pauseHidden]);
	useEffect(() => {
		if (!wanted || failed) return;
		const controller = new AbortController();
		let created: string | undefined;
		load(attachmentId, controller.signal)
			.then(({ mime, bytes }) => {
				if (controller.signal.aborted) return;
				// The server's content type decides, never the name or record.
				if (attachmentView(mime) !== kind)
					throw new Error(`The attachment is not ${kind}`);
				created = URL.createObjectURL(
					new Blob([bytes as BlobPart], { type: mime }),
				);
				setUrl(created);
			})
			.catch(() => {
				if (!controller.signal.aborted) setFailed(true);
			});
		return () => {
			controller.abort();
			if (created) URL.revokeObjectURL(created);
			setUrl(undefined);
		};
	}, [wanted, failed, load, attachmentId, kind]);
	return {
		frame,
		url,
		failed,
		fail: () => setFailed(true),
		/** A paused player far from the viewport releases its bytes. */
		paused: () => {
			if (!near.current) setWanted(false);
		},
	};
}

/** Plays a video attachment from a blob URL. Any failure removes the player
 * so only the message's download chip remains. */
function VideoPlayer({
	attachment,
	load,
}: Readonly<{
	attachment: Pick<BotMessageAttachment, 'id' | 'name'>;
	load: AttachmentLoader;
}>) {
	const video = useRef<HTMLVideoElement>(null);
	const { frame, url, failed, fail, paused } = useAttachmentMedia(
		attachment.id,
		load,
		'video',
		video,
	);
	const [ratio, setRatio] = useState<number>();
	if (failed) return null;
	return (
		<div
			ref={frame}
			className="bots-video"
			data-terminay-bot-video={attachment.name}
			style={
				ratio ? ({ '--bots-video-ratio': ratio } as CSSProperties) : undefined
			}
		>
			{url ? (
				<video
					ref={video}
					src={url}
					controls
					loop
					muted
					playsInline
					preload="metadata"
					aria-label={attachment.name}
					onError={fail}
					onLoadedMetadata={({
						currentTarget: { videoWidth, videoHeight },
					}) => {
						if (videoWidth > 0 && videoHeight > 0)
							setRatio(videoWidth / videoHeight);
					}}
					onPause={paused}
				/>
			) : (
				<LoaderCircle size={18} className="bots-spin" aria-hidden="true" />
			)}
		</div>
	);
}

/** The one audio element playing in this window: starting another pauses it. */
let playingAudio: HTMLMediaElement | null = null;
function claimAudio(element: HTMLMediaElement) {
	if (playingAudio && playingAudio !== element) playingAudio.pause();
	playingAudio = element;
}
function releaseAudio(element: HTMLMediaElement | null) {
	if (element && playingAudio === element) playingAudio = null;
}

/** A compact player for an audio attachment: name, size and download, then
 * play/pause, a seek bar and the time. Any load, type or decode failure
 * replaces it with the plain download chip. */
function AudioPlayer({
	attachment,
	load,
}: Readonly<{
	attachment: Pick<BotMessageAttachment, 'id' | 'name' | 'size'>;
	load: AttachmentLoader;
}>) {
	const audio = useRef<HTMLAudioElement>(null);
	const { frame, url, failed, fail, paused } = useAttachmentMedia(
		attachment.id,
		load,
		'audio',
		audio,
		true,
	);
	const download = () => load(attachment.id);
	const { busy, error, save } = useSaveAttachment(attachment.name, download);
	const [playing, setPlaying] = useState(false),
		[time, setTime] = useState(0),
		[duration, setDuration] = useState<number>();
	useEffect(() => {
		if (url) return;
		setPlaying(false);
		setTime(0);
		setDuration(undefined);
	}, [url]);
	useEffect(() => {
		const element = audio.current;
		return () => releaseAudio(element);
	}, [url]);
	if (failed) return <FileChip attachment={attachment} download={download} />;
	const { name } = attachment;
	const readDuration = (element: HTMLMediaElement) =>
		setDuration(
			Number.isFinite(element.duration) && element.duration > 0
				? element.duration
				: undefined,
		);
	return (
		<div ref={frame} className="bots-audio" data-terminay-bot-audio={name}>
			<div className="bots-audio__head">
				<Music size={16} aria-hidden="true" />
				<span className="bots-audio__name" title={name}>
					{name}
				</span>
				<span className="bots-audio__size">
					{formatFileSize(attachment.size)}
				</span>
				<button
					type="button"
					className="bots-audio__download"
					disabled={busy}
					title={`Download ${name}`}
					aria-label={`Download ${name}`}
					onClick={save}
				>
					{busy ? (
						<LoaderCircle size={14} className="bots-spin" aria-hidden="true" />
					) : (
						<Download size={14} aria-hidden="true" />
					)}
				</button>
			</div>
			<div className="bots-audio__controls">
				<button
					type="button"
					className="bots-audio__play"
					disabled={!url}
					aria-label={`${playing ? 'Pause' : 'Play'} ${name}`}
					onClick={() => {
						const element = audio.current;
						if (!element) return;
						if (!element.paused) {
							element.pause();
							return;
						}
						claimAudio(element);
						element.play().catch(() => {
							releaseAudio(element);
							setPlaying(false);
						});
					}}
				>
					{!url ? (
						<LoaderCircle size={14} className="bots-spin" aria-hidden="true" />
					) : playing ? (
						<Pause size={14} aria-hidden="true" />
					) : (
						<Play size={14} aria-hidden="true" />
					)}
				</button>
				<input
					type="range"
					className="bots-audio__seek"
					min={0}
					max={duration ?? 0}
					step={duration !== undefined && duration < 10 ? 0.1 : 1}
					value={Math.min(time, duration ?? 0)}
					disabled={!url || duration === undefined}
					aria-label={`Seek ${name}`}
					aria-valuetext={`${formatPlaybackTime(time)} of ${formatPlaybackTime(duration)}`}
					style={
						{
							'--bots-audio-progress': `${duration ? (Math.min(time, duration) / duration) * 100 : 0}%`,
						} as CSSProperties
					}
					onChange={(event) => {
						const at = Number(event.currentTarget.value);
						if (audio.current) audio.current.currentTime = at;
						setTime(at);
					}}
				/>
				<span className="bots-audio__time">
					{formatPlaybackTime(time)} / {formatPlaybackTime(duration)}
				</span>
			</div>
			{url ? (
				// biome-ignore lint/a11y/useMediaCaption: user audio has no captions; the custom controls above are its accessible surface.
				<audio
					ref={audio}
					src={url}
					preload="metadata"
					onError={fail}
					onLoadedMetadata={(event) => readDuration(event.currentTarget)}
					onDurationChange={(event) => readDuration(event.currentTarget)}
					onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
					onPlay={(event) => {
						claimAudio(event.currentTarget);
						setPlaying(true);
					}}
					onPause={(event) => {
						releaseAudio(event.currentTarget);
						setPlaying(false);
						paused();
					}}
					onEnded={(event) => {
						const element = event.currentTarget;
						releaseAudio(element);
						element.currentTime = 0;
						setTime(0);
						setPlaying(false);
					}}
				/>
			) : null}
			{error ? (
				<span className="bots-file-chip__error" role="status">
					{error}
				</span>
			) : null}
		</div>
	);
}

/** A message's non-image attachments: videos play inline with their download
 * chip kept, audio plays in a mini player that carries its own download, and
 * every other file is a download chip. */
function MessageFiles({
	attachments,
	load,
}: Readonly<{
	attachments: readonly BotMessageAttachment[] | undefined;
	load: AttachmentLoader | undefined;
}>) {
	const files = attachments?.filter((a) => attachmentView(a.mime) !== 'image');
	if (!files?.length) return null;
	return (
		<ul className="bots-msg__files" aria-label="Attached files">
			{files.map((a) => {
				const view = attachmentView(a.mime);
				return (
					<li
						key={a.id}
						className={
							view === 'video'
								? 'bots-msg__file--video'
								: view === 'audio'
									? 'bots-msg__file--audio'
									: undefined
						}
					>
						{load && view === 'audio' ? (
							<AudioPlayer attachment={a} load={load} />
						) : (
							<>
								{load && view === 'video' ? (
									<VideoPlayer attachment={a} load={load} />
								) : null}
								<FileChip
									attachment={a}
									download={load ? () => load(a.id) : undefined}
								/>
							</>
						)}
					</li>
				);
			})}
		</ul>
	);
}

import { BotActionGroup, type RevealAction } from './BotActionRow';
import type { BotActionItem } from './botActions';
import {
	botMarkdownImagePaths,
	handleBotMarkdownClick,
	renderBotMarkdown,
} from './botMarkdown';
import {
	type PlanStep,
	type TranscriptItem,
	transcriptTime,
} from './transcriptModel';

/** A request to open a chat message's menu. */
export type MessageMenuRequest = Readonly<{
	key: string;
	/** The exact message surface to restore focus to when its menu closes. */
	element: HTMLElement;
	x: number;
	y: number;
	/** Opened with the context-menu key or Shift+F10, not the pointer. */
	keyboard: boolean;
	/** The user's selection, when it lies wholly inside this message's body. */
	selection?: string;
}>;

/** The selection's text when it is non-empty and wholly inside `body`. */
function selectionWithin(body: Element | null): string | undefined {
	const selection = body?.ownerDocument.getSelection();
	if (!body || !selection || selection.isCollapsed) return undefined;
	const { anchorNode, focusNode } = selection;
	if (!anchorNode || !focusNode) return undefined;
	if (!body.contains(anchorNode) || !body.contains(focusNode)) return undefined;
	const text = selection.toString();
	return text.trim() ? text : undefined;
}

/* macOS selects the word under a right-click before `contextmenu` fires, so a
 * pointer-opened menu uses the selection read when the right button went down. */
let rightDownSelection: { key: string; text: string | undefined } | undefined;

function messageMenuHandlers(
	key: string,
	bodyOf: (element: HTMLElement) => Element | null,
	onMessageMenu: ((request: MessageMenuRequest) => void) | undefined,
): {
	onMouseDown?: (event: MouseEvent<HTMLElement>) => void;
	onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
} {
	if (!onMessageMenu) return {};
	return {
		onMouseDown: (event: MouseEvent<HTMLElement>) => {
			if (event.button === 2)
				rightDownSelection = {
					key,
					text: selectionWithin(bodyOf(event.currentTarget)),
				};
		},
		onContextMenu: (event: MouseEvent<HTMLElement>) => {
			event.preventDefault();
			const element = event.currentTarget;
			const keyboard =
				event.button !== 2 || (event.clientX === 0 && event.clientY === 0);
			const early =
				!keyboard && rightDownSelection?.key === key
					? rightDownSelection
					: undefined;
			rightDownSelection = undefined;
			const rect = element.getBoundingClientRect();
			onMessageMenu({
				key,
				element,
				x: keyboard ? rect.left : event.clientX,
				y: keyboard ? rect.bottom : event.clientY,
				keyboard,
				selection: early ? early.text : selectionWithin(bodyOf(element)),
			});
		},
	};
}

export const BotTranscript = memo(function BotTranscript({
	items,
	bot,
	onMessageMenu,
	active = false,
	transport,
	containerRef,
	messageTimes,
	unread,
	threads,
	onOpenThread,
	onRevealAction,
}: Readonly<{
	/** Chat: roots' threads, by message key. */
	threads?: ReadonlyMap<string, TranscriptThread>;
	/** Chat: offers Reply in thread on each message and opens a thread. */
	onOpenThread?: (key: string) => void;
	/** Chat: reveal what a recorded Terminay action touched. */
	onRevealAction?: RevealAction;
	active?: boolean;
	/** Chat: each message's posting time. When given, every message is its own
	 * block with avatar, author and time instead of folding into one turn. */
	messageTimes?: ReadonlyMap<string, number>;
	/** Chat: the first unread message and how many there are. */
	unread?: Readonly<{
		key: string;
		count: number;
		ref?: Ref<HTMLDivElement>;
	}>;
	containerRef?: Ref<HTMLDivElement>;
	transport?: BotIoTransport;
	items: readonly (TranscriptItem | BotActionItem)[];
	bot: Pick<BotProfile, 'id' | 'name' | 'colour' | 'avatar' | 'avatarStyle'>;
	onMessageMenu?: (request: MessageMenuRequest) => void;
}>) {
	const imageLoader = useMemo(() => {
		if (!transport) return undefined;
		const io = new BotIoClient(transport);
		const messages = new BotMessagesClient(transport as never);
		return (path: string, signal: AbortSignal) =>
			path.startsWith('bot-attachment:')
				? messages.attachment(
						bot.id,
						path.slice('bot-attachment:'.length),
						signal,
					)
				: io.image(bot.id, path, { signal });
	}, [transport, bot.id]);
	const attachmentLoader = useMemo<AttachmentLoader | undefined>(() => {
		if (!transport) return undefined;
		const messages = new BotMessagesClient(transport as never);
		return (id, signal) => messages.attachment(bot.id, id, signal);
	}, [transport, bot.id]);
	const separate = messageTimes !== undefined;
	const blocks = useMemo(() => turnBlocks(items, separate), [items, separate]);
	const activeBlock = [...blocks]
		.reverse()
		.find((block) => block.kind === 'agent');
	return (
		<div
			ref={containerRef}
			className={separate ? 'bots-tx bots-tx--chat' : 'bots-tx'}
			data-terminay-bot-transcript={items.length}
		>
			{blocks.map((block) => {
				const key = blockKey(block);
				const rendered = renderBlock(block);
				return unread?.key === key && rendered ? (
					<Fragment key={key}>
						<div
							className="bots-unread"
							ref={unread.ref}
							data-terminay-bot-unread={unread.count}
						>
							<span>
								{unread.count} new message{unread.count === 1 ? '' : 's'}
							</span>
						</div>
						{rendered}
					</Fragment>
				) : (
					rendered
				);
			})}
		</div>
	);
	function renderBlock(block: TurnBlock) {
		if (block.kind === 'actions')
			return (
				<BotActionGroup
					key={block.key}
					botId={bot.id}
					items={block.items}
					onReveal={onRevealAction}
				/>
			);
		// Chat shows message-log times; Sessions shows each entry's recorded time.
		const at = separate ? messageTimes?.get(blockKey(block)) : blockTime(block);
		const entryTimes = !separate;
		if (block.kind === 'user') {
			const menuHandlers = messageMenuHandlers(
				block.item.key,
				(element) => element.querySelector('.bots-msg__body--plain'),
				onMessageMenu,
			);
			return (
				<div
					className="bots-msg bots-msg--user"
					key={block.item.key}
					data-terminay-message-key={block.item.key}
					tabIndex={onMessageMenu ? 0 : undefined}
					onMouseDown={menuHandlers.onMouseDown}
					onContextMenu={menuHandlers.onContextMenu}
				>
					{onOpenThread ? (
						<MessageActions
							messageKey={block.item.key}
							onOpenThread={onOpenThread}
						/>
					) : null}
					<span className="bots-msg__you" aria-hidden="true">
						You
					</span>
					<div className="bots-msg__main">
						<MessageHead who="You" at={at} />
						{block.item.text ? (
							<div className="bots-msg__body bots-msg__body--plain">
								{block.item.text}
							</div>
						) : null}
						{block.item.attachments?.some(
							(a) => attachmentView(a.mime) === 'image',
						) ? (
							<AgentText
								text={block.item.attachments
									.filter((a) => attachmentView(a.mime) === 'image')
									.map(
										(a) =>
											`![${a.name.replace(/[[\]]/g, '')}](bot-attachment:${a.id})`,
									)
									.join('\n\n')}
								imageLoader={imageLoader}
							/>
						) : null}
						<MessageFiles
							attachments={block.item.attachments}
							load={attachmentLoader}
						/>
						{replyBar(block.item.key)}
					</div>
				</div>
			);
		}
		if (block.kind === 'other') {
			const item = block.item;
			if (item.kind === 'plan')
				return (
					<PlanList
						key={item.key}
						steps={item.steps}
						at={entryTimes ? item.at : undefined}
					/>
				);
			if (item.kind === 'truncated')
				return (
					<div
						className="bots-note bots-note--warn"
						key={item.key}
						data-terminay-bot-truncated="true"
					>
						This transcript reached its size limit. Later updates were not kept.
						{entryTimes ? (
							<EntryTime at={item.at} className="bots-entry-time" />
						) : null}
					</div>
				);
			return null;
		}
		// One agent turn: a single avatar and name over its thoughts,
		// tool runs and replies, in order.
		return (
			<div className="bots-msg" key={block.key}>
				{onOpenThread && separate ? (
					<MessageActions messageKey={block.key} onOpenThread={onOpenThread} />
				) : null}
				<BotAvatar bot={bot} size="sm" />
				<div className="bots-msg__main bots-msg__turn">
					<MessageHead who={bot.name} at={at} />
					{block.parts.map((part, index) => {
						if (Array.isArray(part))
							return part.length === 1 ? (
								<ToolEntry
									key={part[0]!.key}
									item={part[0]!}
									active={active && block === activeBlock}
									showTime={entryTimes}
								/>
							) : (
								<ToolGroup
									key={part[0]!.key}
									tools={part}
									active={active && block === activeBlock}
									showTime={entryTimes}
								/>
							);
						if (part.kind === 'thought')
							return (
								<details className="bots-thought" key={part.key}>
									<summary>
										Thinking
										{entryTimes ? (
											<EntryTime at={part.at} className="bots-entry-time" />
										) : null}
									</summary>
									<div>{part.text}</div>
								</details>
							);
						if (part.kind === 'agent') {
							// A post of only files still needs a target for its menu.
							const fileMenu = part.text
								? {}
								: messageMenuHandlers(
										part.key,
										(element) => element,
										onMessageMenu,
									);
							return (
								<Fragment key={part.key}>
									{/* The turn's head already shows its first message's time. */}
									{entryTimes &&
									index > 0 &&
									transcriptTime(part.at) !== undefined ? (
										<div className="bots-entry-time-row">
											<EntryTime at={part.at} className="bots-entry-time" />
										</div>
									) : null}
									{part.text ? (
										<AgentText
											text={part.text}
											messageKey={part.key}
											imageLoader={imageLoader}
											onMessageMenu={onMessageMenu}
										/>
									) : null}
									{part.attachments?.length ? (
										<div
											data-terminay-message-key={
												part.text ? undefined : part.key
											}
											tabIndex={!part.text && onMessageMenu ? 0 : undefined}
											onMouseDown={fileMenu.onMouseDown}
											onContextMenu={fileMenu.onContextMenu}
										>
											<MessageFiles
												attachments={part.attachments}
												load={attachmentLoader}
											/>
										</div>
									) : null}
								</Fragment>
							);
						}
						return null;
					})}
					{separate ? replyBar(block.key) : null}
				</div>
			</div>
		);
	}
	function replyBar(key: string) {
		const thread = threads?.get(key);
		return thread && onOpenThread ? (
			<ReplyBar
				messageKey={key}
				thread={thread}
				bot={bot}
				onOpenThread={onOpenThread}
			/>
		) : null;
	}
});

function MessageHead({ who, at }: Readonly<{ who: string; at?: number }>) {
	if (transcriptTime(at) === undefined)
		return <div className="bots-msg__who">{who}</div>;
	return (
		<div className="bots-msg__head">
			<span className="bots-msg__who">{who}</span>
			<EntryTime at={at} />
		</div>
	);
}

/** When an entry happened, in the chat time format; the full date and time
 * on hover. Nothing for an entry with no valid recorded time. */
function EntryTime({
	at,
	className = 'bots-msg__time',
}: Readonly<{ at: number | undefined; className?: string }>) {
	const time = transcriptTime(at);
	if (time === undefined) return null;
	const date = new Date(time);
	return (
		<time
			className={className}
			dateTime={date.toISOString()}
			title={date.toLocaleString(undefined, {
				dateStyle: 'full',
				timeStyle: 'medium',
			})}
			data-terminay-bot-entry-time={time}
		>
			{messageTime(time)}
		</time>
	);
}

/** When a turn block started: its first entry's recorded time. */
function blockTime(block: TurnBlock): number | undefined {
	if (block.kind === 'user' || block.kind === 'other') return block.item.at;
	if (block.kind !== 'agent') return undefined;
	const first = block.parts[0];
	return Array.isArray(first) ? first[0]?.at : first?.at;
}

/** Today's messages by clock time; older ones with a day, then a date. */
export function messageTime(at: number, now = Date.now()): string {
	const date = new Date(at),
		today = new Date(now);
	const time = date.toLocaleTimeString(undefined, {
		hour: '2-digit',
		minute: '2-digit',
	});
	const startOfDay = (d: Date) =>
		new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
	if (days <= 0) return time;
	if (days === 1) return `Yesterday ${time}`;
	if (days < 7)
		return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
	return `${date.toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
		...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
	})} ${time}`;
}

type AgentPart = TranscriptItem | ToolItem[];
type TurnBlock =
	| { kind: 'user'; item: TranscriptItem & { kind: 'user' } }
	| { kind: 'agent'; key: string; parts: AgentPart[] }
	| { kind: 'other'; item: TranscriptItem }
	| { kind: 'actions'; key: string; items: BotActionItem[] };

/** A block's key: what the unread divider and React keys use. */
function blockKey(block: TurnBlock): string {
	return block.kind === 'agent' || block.kind === 'actions'
		? block.key
		: block.item.key;
}

/** Groups the flat transcript into turns. Answered permission echoes are
 * dropped (a pending one is asked above the composer); runs of tool calls
 * fold into one line. */
function turnBlocks(
	items: readonly (TranscriptItem | BotActionItem)[],
	separate = false,
): TurnBlock[] {
	const blocks: TurnBlock[] = [];
	for (const item of items) {
		if (item.kind === 'action') {
			// Consecutive Terminay actions form one group (ADR-0134).
			const last = blocks[blocks.length - 1];
			if (last?.kind === 'actions') last.items.push(item);
			else blocks.push({ kind: 'actions', key: item.key, items: [item] });
			continue;
		}
		if (item.kind === 'permission') continue;
		if (item.kind === 'user') {
			blocks.push({ kind: 'user', item });
			continue;
		}
		if (item.kind === 'plan' || item.kind === 'truncated') {
			blocks.push({ kind: 'other', item });
			continue;
		}
		let last = blocks[blocks.length - 1];
		if (last?.kind !== 'agent' || (separate && item.kind === 'agent')) {
			last = { kind: 'agent', key: item.key, parts: [] };
			blocks.push(last);
		}
		const tail = last.parts[last.parts.length - 1];
		if (item.kind === 'tool') {
			if (Array.isArray(tail)) tail.push(item);
			else last.parts.push([item]);
		} else last.parts.push(item);
	}
	return blocks;
}

function AgentText({
	text,
	imageLoader,
	messageKey,
	onMessageMenu,
}: Readonly<{
	text: string;
	messageKey?: string;
	imageLoader?: (
		path: string,
		signal: AbortSignal,
	) => Promise<{ mime: string; bytes: Uint8Array }>;
	onMessageMenu?: (request: MessageMenuRequest) => void;
}>) {
	const pathKey = JSON.stringify(botMarkdownImagePaths(text));
	const [images, setImages] = useState<ReadonlyMap<string, string | null>>(
		new Map(),
	);
	useEffect(() => {
		const controller = new AbortController();
		const urls: string[] = [];
		const resolved = new Map<string, string | null>();
		setImages(new Map());
		for (const path of JSON.parse(pathKey) as string[]) {
			if (!imageLoader) {
				resolved.set(path, null);
				setImages(new Map(resolved));
				continue;
			}
			imageLoader(path, controller.signal)
				.then(({ mime, bytes }) => {
					if (controller.signal.aborted) return;
					// Markdown can name an arbitrary durable attachment, including
					// an opaque file. Recheck here before giving its bytes to an img.
					if (attachmentView(mime) !== 'image')
						throw new Error('The attachment is not an image');
					const url = URL.createObjectURL(
						new Blob([bytes as BlobPart], { type: mime }),
					);
					urls.push(url);
					resolved.set(path, url);
					setImages(new Map(resolved));
				})
				.catch(() => {
					if (!controller.signal.aborted) {
						resolved.set(path, null);
						setImages(new Map(resolved));
					}
				});
		}
		return () => {
			controller.abort();
			for (const url of urls) URL.revokeObjectURL(url);
		};
	}, [pathKey, imageLoader]);
	const html = useMemo(() => renderBotMarkdown(text, images), [text, images]);
	const menuHandlers = messageKey
		? messageMenuHandlers(messageKey, (element) => element, onMessageMenu)
		: {};
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: delegated link clicks; links stay keyboard-focusable
		<div
			className="bots-msg__body bots-md"
			onErrorCapture={(event) => {
				const target = event.target;
				if (!(target instanceof HTMLImageElement)) return;
				const source = target.getAttribute('src');
				setImages((current) => {
					const next = new Map(current);
					for (const [path, url] of current)
						if (url === source) next.set(path, null);
					return next;
				});
			}}
			data-terminay-message-key={messageKey}
			tabIndex={onMessageMenu && messageKey ? 0 : undefined}
			onMouseDown={menuHandlers.onMouseDown}
			onContextMenu={menuHandlers.onContextMenu}
			onClick={handleBotMarkdownClick}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it with html disabled escapes raw HTML
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

type ToolItem = TranscriptItem & { kind: 'tool' };

function ToolGroup({
	tools,
	active,
	showTime = false,
}: Readonly<{
	tools: readonly ToolItem[];
	active: boolean;
	/** Sessions: show each call's recorded time. */
	showTime?: boolean;
}>) {
	const [open, setOpen] = useState(false);
	const running =
		active &&
		tools.some((t) => t.status !== 'completed' && t.status !== 'failed');
	const unfinished = tools.filter(
		(t) => t.status === 'pending' || t.status === 'in_progress',
	).length;
	const failed = tools.filter((t) => t.status === 'failed').length;
	const current = running
		? tools.find((t) => t.status !== 'completed' && t.status !== 'failed')
		: undefined;
	return (
		<div
			className="bots-tool bots-tool--group"
			data-terminay-bot-tool-group={tools.length}
		>
			<button
				type="button"
				className="bots-tool__head"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				<ChevronRight
					size={13}
					aria-hidden="true"
					className={open ? 'bots-rot90' : ''}
				/>
				{running ? (
					<LoaderCircle size={13} aria-hidden="true" className="bots-spin" />
				) : unfinished ? (
					<Circle size={13} aria-label="No final tool status reported" />
				) : failed ? (
					<X size={13} aria-hidden="true" className="bots-tool__failed" />
				) : (
					<Check size={13} aria-hidden="true" className="bots-tool__done" />
				)}
				<span className="bots-tool__title">
					{running ? current?.title : `Used ${tools.length} tools`}
					{!running && unfinished
						? ` · ${unfinished} without final status`
						: ''}
					{!running && failed ? ` · ${failed} failed` : ''}
				</span>
				{showTime ? (
					<EntryTime at={tools[0]?.at} className="bots-tool__time" />
				) : null}
			</button>
			{open ? (
				<div className="bots-tool__group">
					{tools.map((tool) => (
						<ToolEntry
							key={tool.key}
							item={tool}
							active={active}
							showTime={showTime}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

function ToolEntry({
	item,
	active,
	showTime = false,
}: Readonly<{
	item: TranscriptItem & { kind: 'tool' };
	active: boolean;
	/** Sessions: show the call's recorded time. */
	showTime?: boolean;
}>) {
	const [open, setOpen] = useState(false);
	const icon =
		item.status === 'completed' ? (
			<Check size={13} aria-hidden="true" />
		) : item.status === 'failed' ? (
			<X size={13} aria-hidden="true" />
		) : active ? (
			<LoaderCircle size={13} aria-hidden="true" className="bots-spin" />
		) : (
			<Circle size={13} aria-label="No final tool status reported" />
		);
	const hasDetail = item.input.length > 0 || item.output.length > 0;
	return (
		<div
			className={`bots-tool bots-tool--${item.status}`}
			data-terminay-bot-tool={item.toolCallId}
			data-terminay-bot-tool-status={item.status}
		>
			<button
				type="button"
				className="bots-tool__head"
				aria-expanded={open}
				disabled={!hasDetail}
				onClick={() => setOpen((value) => !value)}
			>
				<ChevronRight
					size={13}
					aria-hidden="true"
					className={open ? 'bots-rot90' : ''}
				/>
				{icon}
				<span className="bots-tool__title">
					{item.title}
					{!active &&
					(item.status === 'pending' || item.status === 'in_progress')
						? ' · No final status reported'
						: ''}
				</span>
				{showTime ? (
					<EntryTime at={item.at} className="bots-tool__time" />
				) : null}
			</button>
			{open ? (
				<div className="bots-tool__body">
					{item.input.length > 0 ? (
						<pre className="bots-tool__out bots-mono">{item.input}</pre>
					) : null}
					{item.output.length > 0 ? (
						<pre className="bots-tool__out bots-mono">{item.output}</pre>
					) : null}
				</div>
			) : null}
		</div>
	);
}

export function PlanList({
	steps,
	at,
}: Readonly<{ steps: readonly PlanStep[]; at?: number }>) {
	if (steps.length === 0) return null;
	const done = steps.filter((step) => step.status === 'completed').length;
	return (
		<div className="bots-card bots-plan" data-terminay-bot-plan={done}>
			<div className="bots-lab">
				Plan · {done} of {steps.length}
				<EntryTime at={at} className="bots-entry-time" />
			</div>
			<ul>
				{steps.map((step, index) => (
					<li
						// Plans are replaced whole; position is the step's identity.
						key={index}
						className={`bots-plan__step bots-plan__step--${step.status}`}
					>
						{step.status === 'completed' ? (
							<Check size={13} aria-hidden="true" />
						) : step.status === 'in_progress' ? (
							<LoaderCircle
								size={13}
								aria-hidden="true"
								className="bots-spin"
							/>
						) : (
							<Circle size={13} aria-hidden="true" />
						)}
						<span>{step.content}</span>
					</li>
				))}
			</ul>
		</div>
	);
}
