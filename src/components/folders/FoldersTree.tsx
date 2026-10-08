import {
	CircleCheck,
	CircleDashed,
	CircleX,
	EllipsisVertical,
	Folder,
	GitBranch,
	GripVertical,
	MinusCircle,
	Plus,
} from 'lucide-react';
import {
	type DragEvent,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import { flushSync } from 'react-dom';
import type {
	WorktreeCheckState,
	WorktreeProperties,
} from '../../types/terminay';
import {
	type FolderTreeChange,
	type FolderTreeFolderRow,
	type FolderTreeTerminalRow,
	folderOrderAfterMove,
	terminalRenameTitle,
} from '../../workspace/folderTreeModel';
import { AgentStatusIndicator } from '../AgentStatusIndicator';
import {
	checksAccessibleName,
	checksChip,
	checksTone,
	pullRequestAccessibleName,
	pullRequestChip,
	pullRequestTitle,
	showsNoPullRequest,
	unmergedMark,
	shownCheckItems,
} from './worktreePropertyPresentation';
import './foldersTree.css';

type WorktreeChecks = NonNullable<WorktreeProperties['checks']>;

/**
 * How long a rename input takes focus back after it opens. The click that
 * opened it also activated the terminal, which focuses itself a frame later.
 */
const RENAME_FOCUS_SETTLE_MS = 400;

/** How long a dropped order is shown while the server has not answered. */
const PENDING_ORDER_MS = 3_000;

export type FoldersTreeProps = {
	folders: readonly FolderTreeFolderRow[];
	onSelectFolder: (folderId: string) => void;
	onSelectTerminal: (folderId: string, panelId: string) => void;
	/** Absent where folders cannot be created, such as in a peek. */
	onCreateFolder?: () => void;
	/** Creates a terminal in a folder. Absent where a card only lists. */
	onNewTerminal?: (folderId: string) => void;
	/**
	 * Asks the server for a new folder order. Absent where folders cannot be
	 * reordered, such as in a peek: the cards then have no grip. A rejection
	 * means the order was refused, and the tree goes back to the server's.
	 */
	onReorderFolders?: (folderIds: string[]) => void | Promise<void>;
	onFolderMenu?: (folderId: string, anchor: { x: number; y: number }) => void;
	onAnswerOffer?: (folderId: string, answer: 'accept' | 'decline') => void;
	/** True while a terminal is being dragged that a folder may take. */
	acceptsTerminalDrop?: boolean;
	onDropTerminal?: (folderId: string) => void;
	/** A terminal row started being dragged, or its drag ended. */
	onTerminalDrag?: (drag: { folderId: string; panelId: string } | null) => void;
	/**
	 * Opens a terminal's menu at a point: the one its tab opens. Absent where a
	 * row only lists, such as in a peek.
	 */
	onTerminalMenu?: (
		folderId: string,
		panelId: string,
		anchor: { x: number; y: number },
	) => void;
	/**
	 * Saves the name typed into a terminal's row. Absent where a row only
	 * lists.
	 */
	onRenameTerminal?: (folderId: string, panelId: string, title: string) => void;
	/**
	 * Opens a pull request or a check in the browser. Absent where a card only
	 * reports, such as in a peek: the number and the count are then plain text.
	 */
	onOpenLink?: (url: string) => void;
	/** Every check of a folder's worktree; a card carries only the counts. */
	onLoadChecks?: (worktreePath: string) => Promise<WorktreeChecks | undefined>;
	/** A peek lists what is there and nothing else: no grips or actions. */
	variant?: 'tree' | 'peek';
};

/**
 * A project's folders, each a card holding its branch, its facts, and its
 * terminals.
 *
 * It renders the model it is given and reports what the user did. Where a
 * terminal belongs, what a folder's branch is, and what order the folders are
 * in are decided elsewhere.
 */
export function FoldersTree({
	folders,
	onSelectFolder,
	onSelectTerminal,
	onCreateFolder,
	onNewTerminal,
	onReorderFolders,
	onFolderMenu,
	onAnswerOffer,
	acceptsTerminalDrop = false,
	onDropTerminal,
	onTerminalDrag,
	onTerminalMenu,
	onRenameTerminal,
	onOpenLink,
	onLoadChecks,
	variant = 'tree',
}: FoldersTreeProps) {
	const [dropTargetId, setDropTargetId] = useState<string | null>(null);
	/** Folders whose list of checks is shown. */
	const [openChecks, setOpenChecks] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const toggleChecks = (folderId: string) =>
		setOpenChecks((current) => {
			const next = new Set(current);
			if (next.has(folderId)) next.delete(folderId);
			else next.add(folderId);
			return next;
		});

	const treeRef = useRef<HTMLDivElement>(null);
	const serverOrder = folders.map((folder) => folder.id);
	const serverOrderKey = serverOrder.join('\n');
	/**
	 * An order this device is showing ahead of the server: while a card is
	 * being dragged, and after it is dropped until the server's order arrives.
	 */
	const [preview, setPreview] = useState<{
		order: string[];
		draggingId?: string;
	} | null>(null);
	const previewRef = useRef(preview);
	previewRef.current = preview;
	const endDragRef = useRef<(() => void) | null>(null);
	/** The folder whose grip keeps focus across a keyboard move. */
	const refocusGripRef = useRef<string | null>(null);

	// The server's order is the order. Whatever was previewed gives way to it
	// as soon as it changes, unless a card is still in the hand.
	useEffect(() => {
		setPreview((current) =>
			current === null || current.draggingId !== undefined ? current : null,
		);
		const folderId = refocusGripRef.current;
		if (folderId === null) return;
		refocusGripRef.current = null;
		gripOf(treeRef.current, folderId)?.focus();
	}, [serverOrderKey]);
	// A dropped order the server never answers is not shown for ever.
	useEffect(() => {
		if (preview === null || preview.draggingId !== undefined) return;
		const timer = window.setTimeout(() => {
			refocusGripRef.current = null;
			setPreview(null);
		}, PENDING_ORDER_MS);
		return () => window.clearTimeout(timer);
	}, [preview]);
	useEffect(() => () => endDragRef.current?.(), []);

	// Kept on the grip that was moved from the keyboard until the server's
	// order has arrived: each redraw in between moves the card in the document,
	// and a moved element loses focus.
	useLayoutEffect(() => {
		const folderId = refocusGripRef.current;
		if (folderId === null) return;
		const grip = gripOf(treeRef.current, folderId);
		if (grip !== null && document.activeElement !== grip) grip.focus();
	});

	/** The order last asked of the server and not yet answered. */
	const requestedOrderRef = useRef<string | null>(null);
	if (preview === null) requestedOrderRef.current = null;
	const commitOrder = (order: string[]) => {
		const key = order.join('\n');
		if (
			onReorderFolders === undefined ||
			key === (requestedOrderRef.current ?? serverOrderKey)
		) {
			// Nothing new to ask for: back to the server's order, or on with
			// waiting for the one already asked for.
			setPreview(requestedOrderRef.current === null ? null : { order });
			return;
		}
		requestedOrderRef.current = key;
		setPreview({ order });
		void Promise.resolve(onReorderFolders(order)).catch(() => {
			if (requestedOrderRef.current === key) setPreview(null);
		});
	};

	const startGripDrag = (folderId: string, event: ReactPointerEvent) => {
		if (onReorderFolders === undefined || event.button !== 0) return;
		// The grip's press is the grip's: it neither selects the folder nor
		// starts the drag that moves a terminal.
		event.preventDefault();
		event.stopPropagation();
		endDragRef.current?.();
		setPreview({ order: serverOrder, draggingId: folderId });
		const onMove = (move: PointerEvent) => {
			const current = previewRef.current;
			if (current === null) return;
			const index = current.order.indexOf(folderId);
			const midpoint = (id: string | undefined) => {
				const rect =
					id === undefined
						? undefined
						: cardOf(treeRef.current, id)?.getBoundingClientRect();
				return rect === undefined ? undefined : rect.top + rect.height / 2;
			};
			const above = midpoint(current.order[index - 1]);
			const below = midpoint(current.order[index + 1]);
			const target =
				above !== undefined && move.clientY < above
					? index - 1
					: below !== undefined && move.clientY > below
						? index + 1
						: index;
			const order = folderOrderAfterMove(current.order, folderId, target);
			if (order.join('\n') === current.order.join('\n')) return;
			// Drawn before the next move is read: where the cards are is what
			// that move is measured against.
			flushSync(() => setPreview({ order, draggingId: folderId }));
		};
		const end = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			endDragRef.current = null;
		};
		const onUp = () => {
			end();
			// Letting go over the card is not a press on it: the click that
			// follows a drag would otherwise select the folder that was moved.
			const swallow = (click: Event) => {
				click.stopPropagation();
				click.preventDefault();
			};
			window.addEventListener('click', swallow, { capture: true, once: true });
			window.setTimeout(
				() => window.removeEventListener('click', swallow, true),
				0,
			);
			commitOrder(previewRef.current?.order ?? serverOrder);
		};
		const onCancel = () => {
			end();
			setPreview(null);
		};
		// Listened for on the window: reordering moves the card in the
		// document, and a moved element loses the pointer it had captured.
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
		endDragRef.current = end;
	};

	const moveWithKey = (folderId: string, event: KeyboardEvent) => {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		event.stopPropagation();
		// A second press before the server has answered the first moves on from
		// where the first left the folder.
		const from = preview?.order ?? serverOrder;
		const index = from.indexOf(folderId);
		const order = folderOrderAfterMove(
			from,
			folderId,
			index + (event.key === 'ArrowUp' ? -1 : 1),
		);
		if (order.join('\n') === from.join('\n')) return;
		refocusGripRef.current = folderId;
		commitOrder(order);
	};

	const openMenu = (folderId: string, event: MouseEvent) => {
		if (onFolderMenu === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		onFolderMenu(folderId, { x: event.clientX, y: event.clientY });
	};
	const dropHandlers = (folderId: string) =>
		!acceptsTerminalDrop || onDropTerminal === undefined
			? {}
			: {
					onDragOver: (event: DragEvent) => {
						event.preventDefault();
						event.dataTransfer.dropEffect = 'move';
						setDropTargetId(folderId);
					},
					onDragLeave: (event: DragEvent) => {
						if (
							!event.currentTarget.contains(event.relatedTarget as Node | null)
						)
							setDropTargetId((current) =>
								current === folderId ? null : current,
							);
					},
					onDrop: (event: DragEvent) => {
						event.preventDefault();
						setDropTargetId(null);
						onDropTerminal(folderId);
					},
				};

	const byId = new Map(folders.map((folder) => [folder.id, folder]));
	const previewed = preview?.order
		.map((folderId) => byId.get(folderId))
		.filter((folder): folder is FolderTreeFolderRow => folder !== undefined);
	// A preview that no longer names exactly the folders there are is stale.
	const shown =
		previewed !== undefined && previewed.length === folders.length
			? previewed
			: folders;

	return (
		<div
			ref={treeRef}
			className={`folders-tree folders-tree--${variant}`}
			role="tree"
			aria-label="Folders"
		>
			{shown.map((folder) => (
				<div
					key={folder.id}
					className={`folders-tree__folder${dropTargetId === folder.id ? ' folders-tree__folder--drop-target' : ''}${preview?.draggingId === folder.id ? ' folders-tree__folder--dragging' : ''}`}
					data-folder-id={folder.id}
					{...dropHandlers(folder.id)}
				>
					<FolderHeader
						folder={folder}
						onSelect={() => onSelectFolder(folder.id)}
						onMenu={
							onFolderMenu === undefined
								? undefined
								: (event) => openMenu(folder.id, event)
						}
						{...(onReorderFolders === undefined
							? {}
							: folder.kind === 'general'
								? {}
								: {
										onGripPointerDown: (event: ReactPointerEvent) =>
											startGripDrag(folder.id, event),
										onGripKeyDown: (event: KeyboardEvent) =>
											moveWithKey(folder.id, event),
									})}
						onOpenLink={onOpenLink}
						checksOpen={openChecks.has(folder.id)}
						onToggleChecks={() => toggleChecks(folder.id)}
					/>
					{openChecks.has(folder.id) &&
					folder.checks !== undefined &&
					onOpenLink !== undefined ? (
						<FolderChecksList
							folder={folder}
							onOpenLink={onOpenLink}
							onLoadChecks={onLoadChecks}
						/>
					) : null}
					{folder.terminals.map((terminal) => (
						<TerminalRow
							key={terminal.panelId}
							terminal={terminal}
							onSelect={() => onSelectTerminal(folder.id, terminal.panelId)}
							{...(onTerminalMenu === undefined
								? {}
								: {
										onMenu: (anchor: { x: number; y: number }) =>
											onTerminalMenu(folder.id, terminal.panelId, anchor),
									})}
							{...(onRenameTerminal === undefined
								? {}
								: {
										onRename: (title: string) =>
											onRenameTerminal(folder.id, terminal.panelId, title),
									})}
							{...(onTerminalDrag === undefined
								? {}
								: {
										onDragStart: () =>
											onTerminalDrag({
												folderId: folder.id,
												panelId: terminal.panelId,
											}),
										onDragEnd: () => onTerminalDrag(null),
									})}
						/>
					))}
					{folder.offer !== undefined && onAnswerOffer !== undefined ? (
						<div className="folders-tree__offer">
							<span className="folders-tree__offer-text">
								<strong>{folder.offer.title}</strong> created this worktree.
							</span>
							<span className="folders-tree__offer-actions">
								<button
									type="button"
									className="folders-tree__offer-button folders-tree__offer-button--primary"
									onClick={() => onAnswerOffer(folder.id, 'accept')}
								>
									Move it here
								</button>
								<button
									type="button"
									className="folders-tree__offer-button"
									onClick={() => onAnswerOffer(folder.id, 'decline')}
								>
									Not now
								</button>
							</span>
						</div>
					) : null}
					{onNewTerminal === undefined ? null : (
						<button
							type="button"
							className="folders-tree__new-terminal"
							aria-label={`New terminal in ${folder.name}`}
							onClick={() => onNewTerminal(folder.id)}
						>
							<Plus size={12} aria-hidden="true" />
							<span>New terminal</span>
						</button>
					)}
				</div>
			))}
			{onCreateFolder === undefined ? null : (
				<button
					type="button"
					className="folders-tree__new"
					onClick={onCreateFolder}
				>
					<Plus size={14} aria-hidden="true" />
					<span>New folder</span>
				</button>
			)}
		</div>
	);
}

function cardOf(tree: HTMLElement | null, folderId: string) {
	return (
		Array.from(
			tree?.querySelectorAll<HTMLElement>('[data-folder-id]') ?? [],
		).find((card) => card.dataset.folderId === folderId) ?? null
	);
}

function gripOf(tree: HTMLElement | null, folderId: string) {
	return (
		cardOf(tree, folderId)?.querySelector<HTMLElement>('.folders-tree__grip') ??
		null
	);
}

/**
 * The head of a folder's card: its title, its branch, and its facts, each on a
 * line of its own. Pressing anywhere on it that is not a control selects the
 * folder.
 */
function FolderHeader({
	folder,
	onSelect,
	onMenu,
	onGripPointerDown,
	onGripKeyDown,
	onOpenLink,
	checksOpen,
	onToggleChecks,
}: Readonly<{
	folder: FolderTreeFolderRow;
	onSelect: () => void;
	onMenu?: (event: MouseEvent) => void;
	/** Absent for a folder that is not reordered: General, and any in a peek. */
	onGripPointerDown?: (event: ReactPointerEvent) => void;
	onGripKeyDown?: (event: KeyboardEvent) => void;
	onOpenLink?: (url: string) => void;
	checksOpen: boolean;
	onToggleChecks: () => void;
}>) {
	const { pullRequest, checks, change } = folder;
	const checkCount =
		checks === undefined
			? 0
			: checks.failed + checks.pending + checks.passed + checks.skipped;
	const changeChip =
		change === undefined || change.kind === 'clean' ? undefined : change;
	const noPullRequest = showsNoPullRequest(folder);
	const unmerged =
		folder.unmerged === undefined ? undefined : unmergedMark(folder.unmerged);
	const hasFacts =
		changeChip !== undefined ||
		pullRequest !== undefined ||
		noPullRequest ||
		checkCount > 0;
	// The active terminal's row is what shows where the user is. A selected
	// folder with no such row is tinted instead, so the selection is not lost.
	const isSelectedAlone =
		folder.isSelected &&
		!folder.terminals.some((terminal) => terminal.isActive);
	// A press on a control in the header is that control's, never the header's.
	const own = (act: () => void) => (event: MouseEvent) => {
		event.stopPropagation();
		act();
	};
	const pullRequestUrl = pullRequest?.url;
	return (
		<div
			className={`folders-tree__row folders-tree__row--folder${folder.isSelected ? ' folders-tree__row--selected' : ''}${isSelectedAlone ? ' folders-tree__row--selected-alone' : ''}`}
			role="treeitem"
			aria-selected={folder.isSelected}
			aria-expanded="true"
			tabIndex={0}
			{...(change === undefined ? {} : { 'data-change': change.kind })}
			onClick={onSelect}
			onContextMenu={onMenu}
			onKeyDown={activateOnKey(onSelect)}
		>
			<span className="folders-tree__title">
				{onGripPointerDown === undefined ? null : (
					<button
						type="button"
						className="folders-tree__grip"
						aria-label={`Reorder ${folder.name}`}
						title="Drag to reorder"
						onPointerDown={onGripPointerDown}
						onKeyDown={onGripKeyDown}
						onClick={(event) => event.stopPropagation()}
					>
						<GripVertical size={12} aria-hidden="true" />
					</button>
				)}
				<Folder className="folders-tree__icon" size={15} aria-hidden="true" />
				<span className="folders-tree__text">
					<span className="folders-tree__name" title={folder.name}>
						{folder.name}
					</span>
				</span>
				{onMenu === undefined ? null : (
					<button
						type="button"
						className="folders-tree__menu"
						aria-label={`Actions for ${folder.name}`}
						onClick={onMenu}
					>
						<EllipsisVertical size={14} aria-hidden="true" />
					</button>
				)}
			</span>
			{folder.branch === undefined ? null : (
				<span
					className={`folders-tree__branch${folder.isDirty ? ' folders-tree__branch--dirty' : ''}`}
				>
					<GitBranch size={12} aria-hidden="true" />
					<span title={folder.branch}>{folder.branch}</span>
					{unmerged === undefined ? null : (
						<span
							className="folders-tree__unmerged"
							role="img"
							aria-label={unmerged.label}
							title={unmerged.label}
						>
							{unmerged.text}
						</span>
					)}
				</span>
			)}
			{hasFacts ? (
				<span className="folders-tree__facts">
					{changeChip === undefined ? null : (
						<FolderChange change={changeChip} />
					)}
					{pullRequest === undefined ? null : (
						<PullRequestChip
							pullRequest={pullRequest}
							onOpen={
								onOpenLink !== undefined && pullRequestUrl !== undefined
									? own(() => onOpenLink(pullRequestUrl))
									: undefined
							}
						/>
					)}
					{noPullRequest ? (
						<span className="folders-tree__chip folders-tree__chip--quiet">
							no PR
						</span>
					) : null}
					{checks === undefined || checkCount === 0 ? null : (
						<ChecksChip
							checks={checks}
							isOpen={checksOpen}
							onToggle={
								onOpenLink === undefined ? undefined : own(onToggleChecks)
							}
						/>
					)}
				</span>
			) : null}
		</div>
	);
}

/**
 * `PR #350`, and its state when it is not open. Where the tree is narrow the
 * prefix is hidden by the stylesheet; the name and the tooltip always say it
 * in full.
 */
function PullRequestChip({
	pullRequest,
	onOpen,
}: Readonly<{
	pullRequest: NonNullable<FolderTreeFolderRow['pullRequest']>;
	onOpen?: (event: MouseEvent) => void;
}>) {
	const chip = pullRequestChip(pullRequest);
	const content = (
		<>
			<span className="folders-tree__chip-extra">{chip.prefix}</span>
			<span>{chip.number}</span>
			{chip.state === undefined ? null : <span>{chip.state}</span>}
		</>
	);
	const className = `folders-tree__chip folders-tree__pr folders-tree__pr--${pullRequest.state}`;
	return onOpen === undefined ? (
		<span className={className} title={pullRequestTitle(pullRequest)}>
			{content}
		</span>
	) : (
		<button
			type="button"
			className={`${className} folders-tree__pr--link`}
			aria-label={pullRequestAccessibleName(pullRequest)}
			title={pullRequestTitle(pullRequest)}
			onClick={onOpen}
		>
			{content}
		</button>
	);
}

/** The checks as an indicator, a count, and the word for what is counted. The
 * word is the part hidden where the tree is narrow. */
function ChecksChip({
	checks,
	isOpen,
	onToggle,
}: Readonly<{
	checks: NonNullable<FolderTreeFolderRow['checks']>;
	isOpen: boolean;
	onToggle?: (event: MouseEvent) => void;
}>) {
	const chip = checksChip(checks);
	const tone = checksTone(checks);
	const Icon = CHECK_ICONS[tone];
	const title = checksAccessibleName(checks).replace(/\. Show checks$/, '');
	const content = (
		<>
			<Icon size={9} aria-hidden="true" />
			<span>{chip.count}</span>
			<span className="folders-tree__chip-extra">{chip.word}</span>
		</>
	);
	const className = `folders-tree__chip folders-tree__checks folders-tree__checks--${tone}`;
	return onToggle === undefined ? (
		<span className={className} title={title}>
			{content}
		</span>
	) : (
		<button
			type="button"
			className={`${className} folders-tree__checks--link`}
			aria-label={checksAccessibleName(checks)}
			aria-expanded={isOpen}
			title={title}
			onClick={onToggle}
		>
			{content}
		</button>
	);
}

function TerminalRow({
	terminal,
	onSelect,
	onMenu,
	onRename,
	onDragStart,
	onDragEnd,
}: Readonly<{
	terminal: FolderTreeTerminalRow;
	onSelect: () => void;
	onMenu?: (anchor: { x: number; y: number }) => void;
	onRename?: (title: string) => void;
	onDragStart?: () => void;
	onDragEnd?: () => void;
}>) {
	// The name being typed over the title, or null while the row only shows it.
	const [draft, setDraft] = useState<string | null>(null);
	const isRenaming = draft !== null && onRename !== undefined;
	const inputRef = useRef<HTMLInputElement>(null);
	const renameStartedAtRef = useRef(0);
	useLayoutEffect(() => {
		if (!isRenaming) return;
		renameStartedAtRef.current = performance.now();
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [isRenaming]);
	const endRename = (save: boolean) => {
		// Enter and Escape remove the input, which may then report a blur.
		if (draft === null) return;
		setDraft(null);
		if (!save) return;
		const title = terminalRenameTitle(terminal.title, draft);
		if (title !== null) onRename?.(title);
	};
	return (
		<div
			className={`folders-tree__row folders-tree__row--terminal${terminal.isActive ? ' folders-tree__row--active' : ''}`}
			role="treeitem"
			aria-selected={terminal.isActive}
			tabIndex={0}
			data-folder-terminal-session={terminal.sessionId}
			draggable={onDragStart !== undefined && !isRenaming}
			onClick={(event) => {
				// The second click of a double-click is the rename, not another
				// activation.
				if (onRename !== undefined && event.detail > 1) return;
				onSelect();
			}}
			onKeyDown={activateOnKey(onSelect)}
			{...(onRename === undefined
				? {}
				: { onDoubleClick: () => setDraft(terminal.title) })}
			{...(onMenu === undefined
				? {}
				: {
						onContextMenu: (event: MouseEvent) => {
							event.preventDefault();
							event.stopPropagation();
							// The menu key reports no pointer: the menu opens on the row.
							const rect = event.currentTarget.getBoundingClientRect();
							const fromPointer = event.clientX !== 0 || event.clientY !== 0;
							onMenu(
								fromPointer
									? { x: event.clientX, y: event.clientY }
									: { x: rect.left + 16, y: rect.bottom },
							);
						},
					})}
			onDragStart={(event) => {
				event.dataTransfer.effectAllowed = 'move';
				// A drag with no data never starts in some engines. The type is
				// one nothing else reads, so the row cannot be dropped as text.
				event.dataTransfer.setData(
					'application/x-terminay-terminal',
					terminal.panelId,
				);
				onDragStart?.();
			}}
			onDragEnd={onDragEnd}
		>
			<AgentStatusIndicator
				state={terminal.status}
				showIdle
				className="folders-tree__status"
			/>
			{isRenaming ? (
				<input
					ref={inputRef}
					type="text"
					className="folders-tree__rename"
					aria-label={`Rename ${terminal.title}`}
					value={draft}
					spellCheck={false}
					onChange={(event) => setDraft(event.target.value)}
					// What happens in the input edits the name: the row is not
					// selected, dragged, or given its menu by it.
					onClick={(event) => event.stopPropagation()}
					onDoubleClick={(event) => event.stopPropagation()}
					onContextMenu={(event) => event.stopPropagation()}
					onKeyDown={(event) => {
						event.stopPropagation();
						if (event.key !== 'Enter' && event.key !== 'Escape') return;
						event.preventDefault();
						endRename(event.key === 'Enter');
						// Back to the terminal that was named.
						onSelect();
					}}
					onBlur={(event) => {
						if (
							performance.now() - renameStartedAtRef.current <
							RENAME_FOCUS_SETTLE_MS
						) {
							const input = event.currentTarget;
							window.requestAnimationFrame(() => input.focus());
							return;
						}
						endRename(true);
					}}
				/>
			) : (
				<span className="folders-tree__name" title={terminal.title}>
					{terminal.title}
				</span>
			)}
			{terminal.createdWorktree === undefined ? null : (
				<span
					className="folders-tree__tag"
					title={`Created the worktree ${terminal.createdWorktree}`}
				>
					{terminal.createdWorktree}
				</span>
			)}
		</div>
	);
}

function formatCount(value: number): string {
	if (value < 1_000) return String(value);
	return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
}

/** A checkout's unpushed work, in a few characters. A clean checkout has no
 * chip; its header says so through `data-change`. */
function FolderChange({
	change,
}: Readonly<{ change: Exclude<FolderTreeChange, { kind: 'clean' }> }>) {
	if (change.kind === 'delta')
		return (
			<span
				className="folders-tree__chip folders-tree__change"
				title={`+${change.additions} −${change.deletions} not pushed`}
			>
				<span className="folders-tree__delta folders-tree__delta--additions">
					+{formatCount(change.additions)}
				</span>
				<span className="folders-tree__delta folders-tree__delta--deletions">
					−{formatCount(change.deletions)}
				</span>
			</span>
		);
	return (
		<span
			className={`folders-tree__chip folders-tree__change folders-tree__change--${change.kind}`}
		>
			{change.kind}
		</span>
	);
}

const CHECK_ICONS: Readonly<Record<WorktreeCheckState, typeof CircleX>> = {
	failed: CircleX,
	pending: CircleDashed,
	passed: CircleCheck,
	skipped: MinusCircle,
};

/**
 * The individual checks of a folder's worktree, beneath its facts. The card holds
 * the counts; the items are fetched when the list is opened and again when the
 * counts change. Each line is one check, never wrapped.
 */
function FolderChecksList({
	folder,
	onOpenLink,
	onLoadChecks,
}: Readonly<{
	folder: FolderTreeFolderRow;
	onOpenLink: (url: string) => void;
	onLoadChecks?: (worktreePath: string) => Promise<WorktreeChecks | undefined>;
}>) {
	const [loaded, setLoaded] = useState<WorktreeChecks | undefined>(undefined);
	const counts = folder.checks;
	const countsKey =
		counts === undefined
			? ''
			: `${counts.failed}/${counts.pending}/${counts.passed}/${counts.skipped}`;
	const worktreePath = folder.worktreePath;
	// Asked again when the counts change: they are what says a check moved.
	useEffect(() => {
		if (onLoadChecks === undefined || worktreePath === undefined) return;
		let cancelled = false;
		void onLoadChecks(worktreePath)
			.then((checks) => {
				if (!cancelled) setLoaded(checks);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [countsKey, onLoadChecks, worktreePath]);
	if (loaded === undefined)
		return (
			<ul
				className="folders-tree__checks-list"
				aria-label={`Checks for ${folder.name}`}
			>
				<li className="folders-tree__check folders-tree__check--note">
					Loading checks…
				</li>
			</ul>
		);
	const { shown, hidden } = shownCheckItems(loaded);
	return (
		<ul
			className="folders-tree__checks-list"
			aria-label={`Checks for ${folder.name}`}
		>
			{shown.map((item) => {
				const Icon = CHECK_ICONS[item.state];
				const content = (
					<>
						<Icon
							size={12}
							aria-label={item.state}
							className={`folders-tree__check-icon folders-tree__check-icon--${item.state}`}
						/>
						<span>{item.name}</span>
					</>
				);
				const url = item.url;
				return url === undefined ? (
					<li key={item.name} className="folders-tree__check">
						{content}
					</li>
				) : (
					<li key={item.name} className="folders-tree__check-item">
						<button
							type="button"
							className="folders-tree__check folders-tree__check--link"
							onClick={() => onOpenLink(url)}
						>
							{content}
						</button>
					</li>
				);
			})}
			{hidden > 0 ? (
				<li className="folders-tree__check folders-tree__check--note">
					+ {hidden} more
				</li>
			) : null}
		</ul>
	);
}

function activateOnKey(activate: () => void) {
	return (event: KeyboardEvent) => {
		if (event.target !== event.currentTarget) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		activate();
	};
}
