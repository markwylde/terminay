import { Reorder, useDragControls, useReducedMotion } from 'framer-motion';
import { LiveTerminalTitle } from '../../shared/useWorkspaceProjection';
import {
	CircleCheck,
	CircleDashed,
	CircleX,
	ChevronDown,
	ChevronRight,
	EllipsisVertical,
	File,
	Folder,
	GitBranch,
	MinusCircle,
	Plus,
} from 'lucide-react';
import {
	type DragEvent,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import type {
	WorktreeCheckState,
	WorktreeProperties,
} from '../../types/terminay';
import {
	type FolderTreeChange,
	type FolderTreeFolderRow,
	type FolderTreePanelRow,
	folderAttentionState,
	folderOrderAfterMove,
	terminalRenameTitle,
} from '../../workspace/folderTreeModel';
import { AgentStatusIndicator } from '../AgentStatusIndicator';
import {
	FolderDetailsTooltip,
	folderDetailsDescription,
	useFolderDetailsTooltip,
} from './FolderDetailsTooltip';
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

/**
 * How far a press on a folder's title travels before it is a drag. Short of
 * it the press is a click, however unsteady the hand: a card is never carried
 * by accident, and a click is never lost to a twitch.
 */
const CARD_DRAG_START_PX = 6;

/** How long a dropped order is shown while the server has not answered. */
const PENDING_ORDER_MS = 3_000;
/** How the other cards slide to open the place a moved card takes. */
const SLIDE = { duration: 0.18, ease: [0.2, 0, 0, 1] } as const;
/** No slide, and no settling, where the device asks for reduced motion. */
const NO_SLIDE = { duration: 0 } as const;
const NO_SETTLE = { bounceStiffness: 1_000_000, bounceDamping: 10_000_000 };

export type FoldersTreeProps = {
	folders: readonly FolderTreeFolderRow[];
	onSelectFolder: (folderId: string) => void;
	onSelectPanel: (folderId: string, panelId: string) => void;
	/** The folders drawn as their title line alone. */
	collapsedFolderIds?: ReadonlySet<string>;
	/** Collapses an open folder or opens a collapsed one. Absent where a card
	 * only lists, such as in a peek: the cards then have no toggle. */
	onToggleFolderCollapsed?: (folderId: string) => void;
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
	onSelectPanel,
	collapsedFolderIds,
	onToggleFolderCollapsed,
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
	// A drag can end before the order it last asked for has been drawn, so
	// what is in the hand is written where the drag's end reads it at once.
	const showPreview = (next: typeof preview) => {
		previewRef.current = next;
		setPreview(next);
	};
	const reduceMotion = useReducedMotion() === true;
	/** The folder whose title keeps focus across a keyboard move. */
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
		headerOf(treeRef.current, folderId)?.focus();
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

	// Kept on the title that was moved from the keyboard until the server's
	// order has arrived: each redraw in between moves the card in the document,
	// and a moved element loses focus.
	useLayoutEffect(() => {
		const folderId = refocusGripRef.current;
		if (folderId === null) return;
		const header = headerOf(treeRef.current, folderId);
		if (header !== null && document.activeElement !== header) header.focus();
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

	const startCardDrag = (folderId: string) =>
		showPreview({
			order: previewRef.current?.order ?? serverOrder,
			draggingId: folderId,
		});
	const moveCardInHand = (order: string[]) => {
		const draggingId = previewRef.current?.draggingId;
		if (draggingId !== undefined) showPreview({ order, draggingId });
	};
	const endCardDrag = () =>
		commitOrder(previewRef.current?.order ?? serverOrder);

	const moveWithKey = (folderId: string, event: KeyboardEvent) => {
		if (event.target !== event.currentTarget || !event.altKey) return;
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
	const reorderable = onReorderFolders !== undefined;

	const cards = shown.map((folder) => (
		<FolderCard
			key={folder.id}
			folderId={folder.id}
			className={`folders-tree__folder${dropTargetId === folder.id ? ' folders-tree__folder--drop-target' : ''}${preview?.draggingId === folder.id ? ' folders-tree__folder--dragging' : ''}${folder.isDeleting ? ' folders-tree__folder--deleting' : ''}`}
			dropHandlers={dropHandlers(folder.id)}
			reorderable={reorderable}
			reduceMotion={reduceMotion}
			onDragStart={() => startCardDrag(folder.id)}
			onDragEnd={endCardDrag}
		>
			{(onHandlePointerDown) => {
				const collapsed = collapsedFolderIds?.has(folder.id) === true;
				return (
				<>
					<FolderHeader
						folder={folder}
						collapsed={collapsed}
						{...(onToggleFolderCollapsed === undefined
							? {}
							: {
									onToggleCollapsed: () =>
										onToggleFolderCollapsed(folder.id),
								})}
						onSelect={() => onSelectFolder(folder.id)}
						onMenu={
							onFolderMenu === undefined
								? undefined
								: (event) => openMenu(folder.id, event)
						}
						{...(onHandlePointerDown === undefined
							? {}
							: {
									onHandlePointerDown,
									onMoveKeyDown: (event: KeyboardEvent) =>
										moveWithKey(folder.id, event),
								})}
						onOpenLink={onOpenLink}
						checksOpen={openChecks.has(folder.id)}
						onToggleChecks={() => toggleChecks(folder.id)}
					/>
					{!collapsed &&
					openChecks.has(folder.id) &&
					folder.checks !== undefined &&
					onOpenLink !== undefined ? (
						<FolderChecksList
							folder={folder}
							onOpenLink={onOpenLink}
							onLoadChecks={onLoadChecks}
						/>
					) : null}
					{(collapsed ? [] : folder.panels).map((panel) => (
						<PanelRow
							key={panel.panelId}
							panel={panel}
							onSelect={() => onSelectPanel(folder.id, panel.panelId)}
							// A row offers what its tab offers. A terminal's tab has a
							// menu, a name to change, and a move to another folder; a
							// file or folder tab has none of the three.
							{...(onTerminalMenu === undefined || panel.kind !== 'terminal'
								? {}
								: {
										onMenu: (anchor: { x: number; y: number }) =>
											onTerminalMenu(folder.id, panel.panelId, anchor),
									})}
							{...(onRenameTerminal === undefined || panel.kind !== 'terminal'
								? {}
								: {
										onRename: (title: string) =>
											onRenameTerminal(folder.id, panel.panelId, title),
									})}
							{...(onTerminalDrag === undefined || panel.kind !== 'terminal'
								? {}
								: {
										onDragStart: () =>
											onTerminalDrag({
												folderId: folder.id,
												panelId: panel.panelId,
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
					{onNewTerminal === undefined || collapsed ? null : (
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
				</>
				);
			}}
		</FolderCard>
	));
	const newFolder =
		onCreateFolder === undefined ? null : (
			<button
				type="button"
				className="folders-tree__new"
				onClick={onCreateFolder}
			>
				<Plus size={14} aria-hidden="true" />
				<span>New folder</span>
			</button>
		);
	const treeProps = {
		ref: treeRef,
		className: `folders-tree folders-tree--${variant}`,
		role: 'tree',
		'aria-label': 'Folders',
	};

	if (!reorderable)
		return (
			<div {...treeProps}>
				{cards}
				{newFolder}
			</div>
		);
	return (
		<Reorder.Group
			as="div"
			axis="y"
			values={shown.map((folder) => folder.id)}
			onReorder={moveCardInHand}
			{...treeProps}
		>
			{cards}
			{newFolder}
		</Reorder.Group>
	);
}

/**
 * One folder's card. Where folders are reordered it is carried by its grip:
 * up and down only, lifted above the others, which slide to make room for it,
 * and it settles into the place it is let go over.
 */
function FolderCard({
	folderId,
	className,
	dropHandlers,
	reorderable,
	reduceMotion,
	onDragStart,
	onDragEnd,
	children,
}: Readonly<{
	folderId: string;
	className: string;
	dropHandlers: {
		onDragOver?: (event: DragEvent) => void;
		onDragLeave?: (event: DragEvent) => void;
		onDrop?: (event: DragEvent) => void;
	};
	reorderable: boolean;
	reduceMotion: boolean;
	onDragStart: () => void;
	onDragEnd: () => void;
	/** Given the title's press where the card is reordered, and nothing where it is not. */
	children: (
		onHandlePointerDown: ((event: ReactPointerEvent) => void) | undefined,
	) => ReactNode;
}>) {
	const controls = useDragControls();
	if (!reorderable)
		return (
			<div className={className} data-folder-id={folderId} {...dropHandlers}>
				{children(undefined)}
			</div>
		);
	return (
		<Reorder.Item
			as="div"
			value={folderId}
			className={className}
			data-folder-id={folderId}
			// Only a press on the title that then travels starts a reorder: a
			// press that stays put selects the folder, and a terminal row starts
			// its own drag.
			dragListener={false}
			dragControls={controls}
			dragMomentum={false}
			layout="position"
			transition={{ layout: reduceMotion ? NO_SLIDE : SLIDE }}
			{...(reduceMotion
				? { dragTransition: NO_SETTLE }
				: { whileDrag: { scale: 1.02 } })}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			{...dropHandlers}
		>
			{children((event) => {
				// A finger on the title scrolls the tree; it does not carry a card.
				if (event.button !== 0 || event.pointerType === 'touch') return;
				// A press on a control of the title is that control's.
				if ((event.target as Element).closest('button, a, input') !== null)
					return;
				const from = { x: event.clientX, y: event.clientY };
				const stop = () => {
					window.removeEventListener('pointermove', move, true);
					window.removeEventListener('pointerup', stop, true);
					window.removeEventListener('pointercancel', stop, true);
				};
				const move = (moved: PointerEvent) => {
					if (
						Math.hypot(moved.clientX - from.x, moved.clientY - from.y) <
						CARD_DRAG_START_PX
					)
						return;
					stop();
					// From here the press is a carry: letting go selects nothing.
					swallowClickAfterRelease();
					controls.start(moved);
				};
				window.addEventListener('pointermove', move, true);
				window.addEventListener('pointerup', stop, true);
				window.addEventListener('pointercancel', stop, true);
			})}
		</Reorder.Item>
	);
}

/**
 * Letting go of a carried card is not a press on a card: the click that
 * follows a drag would otherwise select the folder the pointer ended on.
 * Armed at the press, because the drag reports its end a frame after the
 * release, and the click has been and gone by then.
 */
function swallowClickAfterRelease() {
	const swallow = (click: Event) => {
		click.stopPropagation();
		click.preventDefault();
	};
	const release = () => {
		window.removeEventListener('pointerup', release, true);
		window.removeEventListener('pointercancel', release, true);
		window.addEventListener('click', swallow, { capture: true, once: true });
		window.setTimeout(
			() => window.removeEventListener('click', swallow, true),
			0,
		);
	};
	window.addEventListener('pointerup', release, true);
	window.addEventListener('pointercancel', release, true);
}

function cardOf(tree: HTMLElement | null, folderId: string) {
	return (
		Array.from(
			tree?.querySelectorAll<HTMLElement>('[data-folder-id]') ?? [],
		).find((card) => card.dataset.folderId === folderId) ?? null
	);
}

function headerOf(tree: HTMLElement | null, folderId: string) {
	return (
		cardOf(tree, folderId)?.querySelector<HTMLElement>(
			'[data-folder-header="true"]',
		) ?? null
	);
}

/**
 * The head of a folder's card: its title, its branch, and its facts, each on a
 * line of its own. A linked folder is named by its branch, so its title line
 * is its branch line and it has no other. Pressing anywhere on the head that
 * is not a control selects the folder.
 */
function FolderHeader({
	folder,
	collapsed,
	onToggleCollapsed,
	onSelect,
	onMenu,
	onHandlePointerDown,
	onMoveKeyDown,
	onOpenLink,
	checksOpen,
	onToggleChecks,
}: Readonly<{
	folder: FolderTreeFolderRow;
	/** Drawn as its title line alone. */
	collapsed: boolean;
	/** Absent where a card only lists, such as in a peek. */
	onToggleCollapsed?: () => void;
	onSelect: () => void;
	onMenu?: (event: MouseEvent) => void;
	/** Absent where folders are not reordered, such as in a peek. */
	onHandlePointerDown?: (event: ReactPointerEvent) => void;
	onMoveKeyDown?: (event: KeyboardEvent) => void;
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
	const { isDeleting } = folder;
	// A worktree on its way out says so in place of what was measured of it.
	const hasFacts =
		!isDeleting &&
		(changeChip !== undefined ||
			pullRequest !== undefined ||
			noPullRequest ||
			checkCount > 0);
	// The active terminal's row is what shows where the user is. A selected
	// folder with no such row is tinted instead, so the selection is not lost.
	// A collapsed folder shows no rows, so its title carries both.
	const isSelectedAlone =
		folder.isSelected &&
		(collapsed || !folder.panels.some((panel) => panel.isActive));
	// What its hidden terminals are doing, as the one most urgent state.
	const attention = collapsed ? folderAttentionState(folder.panels) : undefined;
	// A press on a control in the header is that control's, never the header's.
	const own = (act: () => void) => (event: MouseEvent) => {
		event.stopPropagation();
		act();
	};
	const pullRequestUrl = pullRequest?.url;
	const { label, details } = folder;
	const tooltip = useFolderDetailsTooltip(details !== undefined);
	const unmergedElement =
		unmerged === undefined ? null : (
			<span
				className="folders-tree__unmerged"
				role="img"
				aria-label={unmerged.label}
				title={unmerged.label}
			>
				{unmerged.text}
			</span>
		);
	// Opening the menu ends the rest that would show the details beside it.
	const openMenu =
		onMenu === undefined
			? undefined
			: (event: MouseEvent) => {
					tooltip.end();
					onMenu(event);
				};
	return (
		<div
			className={`folders-tree__row folders-tree__row--folder${folder.isSelected ? ' folders-tree__row--selected' : ''}${isSelectedAlone ? ' folders-tree__row--selected-alone' : ''}`}
			role="treeitem"
			aria-selected={folder.isSelected}
			aria-expanded={!collapsed}
			data-folder-header="true"
			{...(collapsed ? { 'data-folder-collapsed': 'true' } : {})}
			{...(isDeleting ? { 'aria-busy': true } : {})}
			tabIndex={0}
			{...(change === undefined ? {} : { 'data-change': change.kind })}
			{...(details === undefined
				? {}
				: { 'aria-description': folderDetailsDescription(details) })}
			onClick={onSelect}
			onContextMenu={openMenu}
			onKeyDown={(event) => {
				activateOnKey(onSelect)(event);
				// Alt with an arrow carries the folder up or down the list.
				onMoveKeyDown?.(event);
				// Left closes the folder and Right opens it, as in any tree.
				if (
					onToggleCollapsed === undefined ||
					event.target !== event.currentTarget ||
					event.altKey
				)
					return;
				if (
					(event.key === 'ArrowLeft' && !collapsed) ||
					(event.key === 'ArrowRight' && collapsed)
				) {
					event.preventDefault();
					onToggleCollapsed();
				}
			}}
			onPointerDownCapture={tooltip.end}
			onFocus={(event) => {
				if (
					event.target === event.currentTarget &&
					event.currentTarget.matches(':focus-visible')
				)
					tooltip.rest();
			}}
			onBlur={tooltip.end}
		>
			{details === undefined || tooltip.anchor === null ? null : (
				<FolderDetailsTooltip details={details} anchor={tooltip.anchor} />
			)}
			<span
				ref={tooltip.anchorRef}
				className={`folders-tree__title${label !== undefined && folder.isDirty ? ' folders-tree__title--dirty' : ''}`}
				onPointerOver={(event) => {
					if (event.pointerType !== 'mouse') return;
					// A control on the line says what it does itself.
					if ((event.target as Element).closest('button') === null)
						tooltip.rest();
					else tooltip.end();
				}}
				onPointerLeave={tooltip.end}
				{...(onHandlePointerDown === undefined
					? {}
					: {
							onPointerDown: onHandlePointerDown,
							'data-folder-drag-handle': 'true',
						})}
			>
				{onToggleCollapsed === undefined ? null : (
					<button
						type="button"
						className="folders-tree__toggle"
						aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${folder.name}`}
						aria-expanded={!collapsed}
						title={collapsed ? 'Expand' : 'Collapse'}
						onClick={own(onToggleCollapsed)}
					>
						{collapsed ? (
							<ChevronRight size={13} aria-hidden="true" />
						) : (
							<ChevronDown size={13} aria-hidden="true" />
						)}
					</button>
				)}
				{label === undefined ? (
					<>
						<Folder
							className="folders-tree__icon"
							size={15}
							aria-hidden="true"
						/>
						<span className="folders-tree__text">
							<span className="folders-tree__name" title={folder.name}>
								{folder.name}
							</span>
						</span>
					</>
				) : (
					<>
						<GitBranch
							className="folders-tree__icon"
							size={15}
							aria-hidden="true"
						/>
						<span className="folders-tree__text folders-tree__label">
							<span className="folders-tree__name">
								{label.text}
								{label.suffix === undefined ? null : (
									<span className="folders-tree__label-suffix">
										{' '}
										{label.suffix}
									</span>
								)}
							</span>
							{unmergedElement}
						</span>
					</>
				)}
				{attention === undefined ? null : (
					<AgentStatusIndicator
						state={attention}
						className="folders-tree__status folders-tree__attention"
					/>
				)}
				{openMenu === undefined ? null : (
					<button
						type="button"
						className="folders-tree__menu"
						aria-label={`Actions for ${folder.name}`}
						onClick={openMenu}
					>
						<EllipsisVertical size={14} aria-hidden="true" />
					</button>
				)}
			</span>
			{collapsed || label !== undefined || folder.branch === undefined ? null : (
				<span
					className={`folders-tree__branch${folder.isDirty ? ' folders-tree__branch--dirty' : ''}`}
				>
					<GitBranch size={12} aria-hidden="true" />
					<span title={folder.branch}>{folder.branch}</span>
					{unmergedElement}
				</span>
			)}
			{isDeleting ? (
				<span className="folders-tree__deleting" role="status">
					Deleting…
				</span>
			) : null}
			{hasFacts && !collapsed ? (
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

function PanelRow({
	panel,
	onSelect,
	onMenu,
	onRename,
	onDragStart,
	onDragEnd,
}: Readonly<{
	panel: FolderTreePanelRow;
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
		const title = terminalRenameTitle(panel.title, draft);
		if (title !== null) onRename?.(title);
	};
	return (
		<div
			className={`folders-tree__row folders-tree__row--panel folders-tree__row--${panel.kind === 'folder' ? 'folder-tab' : panel.kind}${panel.isActive ? ' folders-tree__row--active' : ''}`}
			role="treeitem"
			aria-selected={panel.isActive}
			tabIndex={0}
			data-folder-panel={panel.panelId}
			data-folder-panel-kind={panel.kind}
			{...(panel.kind === 'terminal'
				? { 'data-folder-terminal-session': panel.sessionId }
				: {})}
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
				: { onDoubleClick: () => setDraft(panel.title) })}
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
					panel.panelId,
				);
				onDragStart?.();
			}}
			onDragEnd={onDragEnd}
		>
			{panel.kind === 'terminal' ? (
				<AgentStatusIndicator
					state={panel.status}
					showIdle
					className="folders-tree__status"
				/>
			) : (
				// The kind's icon stands where a terminal's status does, so the
				// titles of a mixed folder line up.
				<span className="folders-tree__kind" aria-hidden="true">
					{panel.kind === 'file' ? <File size={12} /> : <Folder size={12} />}
				</span>
			)}
			{isRenaming ? (
				<input
					ref={inputRef}
					type="text"
					className="folders-tree__rename"
					aria-label={`Rename ${panel.title}`}
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
				<span className="folders-tree__name" title={panel.title}>
					{panel.kind === 'terminal' ? (
						<LiveTerminalTitle panelId={panel.panelId} fallback={panel.title} />
					) : (
						panel.title
					)}
				</span>
			)}
			{panel.kind !== 'terminal' ||
			panel.createdWorktree === undefined ? null : (
				<span
					className="folders-tree__tag"
					title={`Created the worktree ${panel.createdWorktree}`}
				>
					{panel.createdWorktree}
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
