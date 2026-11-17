import {
	BotIoClient,
	type BotIoTransport,
	BotMessagesClient,
} from '@terminay/client-core';
/**
 * A session's transcript: messages, collapsible tool entries, and the plan as
 * a checklist. Shared by Chat and the Sessions tab.
 */

import type { BotMessageAttachment, BotProfile } from '@terminay/protocol';
import {
	Check,
	ChevronRight,
	Circle,
	Download,
	FileText,
	LoaderCircle,
	X,
} from 'lucide-react';
import {
	Fragment,
	type MouseEvent,
	memo,
	type Ref,
	useEffect,
	useMemo,
	useState,
} from 'react';
import { saveDownload } from '../../host/nativeActions';
import { BotAvatar } from './BotAvatar';
import { attachmentView, formatFileSize } from './botsModel';

/** A sent non-image attachment. It is never rendered: activating it saves
 * its bytes through the host save (ADR-0130). */
function FileChip({
	attachment,
	download,
}: Readonly<{
	attachment: Pick<BotMessageAttachment, 'name' | 'size'>;
	download: (() => Promise<{ bytes: Uint8Array }>) | undefined;
}>) {
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string>();
	return (
		<>
			<button
				type="button"
				className="bots-file-chip"
				disabled={!download || busy}
				title={`Download ${attachment.name}`}
				aria-label={`Download ${attachment.name}`}
				data-terminay-bot-file-chip={attachment.name}
				onClick={() => {
					if (!download) return;
					setBusy(true);
					setError(undefined);
					void saveDownload({
						filename: attachment.name,
						chunks: async function* () {
							yield (await download()).bytes;
						},
					})
						.catch((cause: unknown) =>
							setError(
								cause instanceof Error ? cause.message : 'Download failed',
							),
						)
						.finally(() => setBusy(false));
				}}
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

import { BotActionGroup, type RevealAction } from './BotActionRow';
import type { BotActionItem } from './botActions';
import {
	botMarkdownImagePaths,
	handleBotMarkdownClick,
	renderBotMarkdown,
} from './botMarkdown';
import type { PlanStep, TranscriptItem } from './transcriptModel';

/** A request to open a chat message's menu. */
export type MessageMenuRequest = Readonly<{
	key: string;
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
	onRevealAction,
}: Readonly<{
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
	bot: Pick<BotProfile, 'id' | 'name' | 'colour' | 'avatar'>;
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
		const at = messageTimes?.get(blockKey(block));
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
						{block.item.attachments?.some(
							(a) => attachmentView(a.mime) === 'file',
						) ? (
							<ul className="bots-msg__files" aria-label="Attached files">
								{block.item.attachments
									.filter((a) => attachmentView(a.mime) === 'file')
									.map((a) => (
										<li key={a.id}>
											<FileChip
												attachment={a}
												download={
													transport
														? () =>
																new BotMessagesClient(
																	transport as never,
																).attachment(bot.id, a.id)
														: undefined
												}
											/>
										</li>
									))}
							</ul>
						) : null}
					</div>
				</div>
			);
		}
		if (block.kind === 'other') {
			const item = block.item;
			if (item.kind === 'plan')
				return <PlanList key={item.key} steps={item.steps} />;
			if (item.kind === 'truncated')
				return (
					<div
						className="bots-note bots-note--warn"
						key={item.key}
						data-terminay-bot-truncated="true"
					>
						This transcript reached its size limit. Later updates were not kept.
					</div>
				);
			return null;
		}
		// One agent turn: a single avatar and name over its thoughts,
		// tool runs and replies, in order.
		return (
			<div className="bots-msg" key={block.key}>
				<BotAvatar bot={bot} size="sm" />
				<div className="bots-msg__main bots-msg__turn">
					<MessageHead who={bot.name} at={at} />
					{block.parts.map((part) => {
						if (Array.isArray(part))
							return part.length === 1 ? (
								<ToolEntry
									key={part[0]!.key}
									item={part[0]!}
									active={active && block === activeBlock}
								/>
							) : (
								<ToolGroup
									key={part[0]!.key}
									tools={part}
									active={active && block === activeBlock}
								/>
							);
						if (part.kind === 'thought')
							return (
								<details className="bots-thought" key={part.key}>
									<summary>Thinking</summary>
									<div>{part.text}</div>
								</details>
							);
						if (part.kind === 'agent')
							return (
								<AgentText
									key={part.key}
									text={part.text}
									messageKey={part.key}
									imageLoader={imageLoader}
									onMessageMenu={onMessageMenu}
								/>
							);
						return null;
					})}
				</div>
			</div>
		);
	}
});

function MessageHead({ who, at }: Readonly<{ who: string; at?: number }>) {
	if (at === undefined) return <div className="bots-msg__who">{who}</div>;
	return (
		<div className="bots-msg__head">
			<span className="bots-msg__who">{who}</span>
			<time
				className="bots-msg__time"
				dateTime={new Date(at).toISOString()}
				title={new Date(at).toLocaleString(undefined, {
					dateStyle: 'full',
					timeStyle: 'medium',
				})}
			>
				{messageTime(at)}
			</time>
		</div>
	);
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
}: Readonly<{ tools: readonly ToolItem[]; active: boolean }>) {
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
			</button>
			{open ? (
				<div className="bots-tool__group">
					{tools.map((tool) => (
						<ToolEntry key={tool.key} item={tool} active={active} />
					))}
				</div>
			) : null}
		</div>
	);
}

function ToolEntry({
	item,
	active,
}: Readonly<{ item: TranscriptItem & { kind: 'tool' }; active: boolean }>) {
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

export function PlanList({ steps }: Readonly<{ steps: readonly PlanStep[] }>) {
	if (steps.length === 0) return null;
	const done = steps.filter((step) => step.status === 'completed').length;
	return (
		<div className="bots-card bots-plan" data-terminay-bot-plan={done}>
			<div className="bots-lab">
				Plan · {done} of {steps.length}
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
