import {
	CircleCheck,
	CircleDashed,
	CircleX,
	EllipsisVertical,
	Folder,
	GitBranch,
	MinusCircle,
	Plus,
} from 'lucide-react';
import {
	type DragEvent,
	type KeyboardEvent,
	type MouseEvent,
	useEffect,
	useState,
} from 'react';
import type {
	WorktreeCheckState,
	WorktreeProperties,
} from '../../types/terminay';
import type {
	FolderTreeChange,
	FolderTreeFolderRow,
	FolderTreeTerminalRow,
} from '../../workspace/folderTreeModel';
import { AgentStatusIndicator } from '../AgentStatusIndicator';
import {
	checksAccessibleName,
	checksHeadline,
	checksTone,
	pullRequestAccessibleName,
	pullRequestTitle,
	shownCheckItems,
} from './worktreePropertyPresentation';
import './foldersTree.css';

type WorktreeChecks = NonNullable<WorktreeProperties['checks']>;

export type FoldersTreeProps = {
	folders: readonly FolderTreeFolderRow[];
	onSelectFolder: (folderId: string) => void;
	onSelectTerminal: (folderId: string, panelId: string) => void;
	/** Absent where folders cannot be created, such as in a peek. */
	onCreateFolder?: () => void;
	onFolderMenu?: (folderId: string, anchor: { x: number; y: number }) => void;
	onAnswerOffer?: (folderId: string, answer: 'accept' | 'decline') => void;
	/** True while a terminal is being dragged that a folder may take. */
	acceptsTerminalDrop?: boolean;
	onDropTerminal?: (folderId: string) => void;
	/** A terminal row started being dragged, or its drag ended. */
	onTerminalDrag?: (
		drag: { folderId: string; panelId: string } | null,
	) => void;
	/**
	 * Opens a pull request or a check in the browser. Absent where a row only
	 * reports, such as in a peek: the number and the count are then plain text.
	 */
	onOpenLink?: (url: string) => void;
	/** Every check of a folder's worktree; a row carries only the counts. */
	onLoadChecks?: (worktreePath: string) => Promise<WorktreeChecks | undefined>;
	/** A peek lists what is there and nothing else: no placeholders or actions. */
	variant?: 'tree' | 'peek';
};

/**
 * A project's folders and the terminals in each.
 *
 * It renders the model it is given and reports what the user did. Where a
 * terminal belongs, and what a folder's branch is, are decided elsewhere.
 */
export function FoldersTree({
	folders,
	onSelectFolder,
	onSelectTerminal,
	onCreateFolder,
	onFolderMenu,
	onAnswerOffer,
	acceptsTerminalDrop = false,
	onDropTerminal,
	onTerminalDrag,
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
	const isPeek = variant === 'peek';

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
						if (!event.currentTarget.contains(event.relatedTarget as Node | null))
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

	return (
		<div
			className={`folders-tree folders-tree--${variant}`}
			role="tree"
			aria-label="Folders"
		>
			{folders.map((folder) => (
				<div
					key={folder.id}
					className={`folders-tree__folder${dropTargetId === folder.id ? ' folders-tree__folder--drop-target' : ''}`}
					{...dropHandlers(folder.id)}
				>
					<FolderRow
						folder={folder}
						onSelect={() => onSelectFolder(folder.id)}
						onMenu={
							onFolderMenu === undefined
								? undefined
								: (event) => openMenu(folder.id, event)
						}
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
					{folder.terminals.length === 0 &&
					folder.offer === undefined &&
					!isPeek ? (
						<div className="folders-tree__empty" role="none">
							No terminals yet
						</div>
					) : null}
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

function FolderRow({
	folder,
	onSelect,
	onMenu,
	onOpenLink,
	checksOpen,
	onToggleChecks,
}: Readonly<{
	folder: FolderTreeFolderRow;
	onSelect: () => void;
	onMenu?: (event: MouseEvent) => void;
	onOpenLink?: (url: string) => void;
	checksOpen: boolean;
	onToggleChecks: () => void;
}>) {
	const { pullRequest, checks, change } = folder;
	const checkCount =
		checks === undefined
			? 0
			: checks.failed + checks.pending + checks.passed + checks.skipped;
	const hasSecondLine =
		folder.branch !== undefined ||
		pullRequest !== undefined ||
		checkCount > 0 ||
		change !== undefined;
	// A press on a control in the row is that control's, never the row's.
	const own = (act: () => void) => (event: MouseEvent) => {
		event.stopPropagation();
		act();
	};
	const pullRequestUrl = pullRequest?.url;
	return (
		<div
			className={`folders-tree__row folders-tree__row--folder${folder.isSelected ? ' folders-tree__row--selected' : ''}`}
			role="treeitem"
			aria-selected={folder.isSelected}
			aria-expanded="true"
			tabIndex={0}
			onClick={onSelect}
			onContextMenu={onMenu}
			onKeyDown={activateOnKey(onSelect)}
		>
			<Folder className="folders-tree__icon" size={15} aria-hidden="true" />
			<span className="folders-tree__text">
				<span className="folders-tree__name" title={folder.name}>
					{folder.name}
				</span>
				{hasSecondLine ? (
					<span className="folders-tree__meta">
						{folder.branch === undefined ? null : (
							<span className="folders-tree__branch" title={folder.branch}>
								<GitBranch size={12} aria-hidden="true" />
								<span>{folder.branch}</span>
							</span>
						)}
						<span className="folders-tree__facts">
							{change === undefined ? null : <FolderChange change={change} />}
							{pullRequest === undefined ? null : onOpenLink !== undefined &&
								pullRequestUrl !== undefined ? (
								<button
									type="button"
									className={`folders-tree__pr folders-tree__pr--link folders-tree__pr--${pullRequest.state}`}
									aria-label={pullRequestAccessibleName(pullRequest)}
									title={pullRequestTitle(pullRequest)}
									onClick={own(() => onOpenLink(pullRequestUrl))}
								>
									#{pullRequest.number}
								</button>
							) : (
								<span
									className={`folders-tree__pr folders-tree__pr--${pullRequest.state}`}
									title={pullRequestTitle(pullRequest)}
								>
									#{pullRequest.number}
								</span>
							)}
							{checks === undefined || checkCount === 0 ? null : onOpenLink !==
								undefined ? (
								<button
									type="button"
									className={`folders-tree__checks folders-tree__checks--link folders-tree__checks--${checksTone(checks)}`}
									aria-label={checksAccessibleName(checks)}
									aria-expanded={checksOpen}
									title={checksAccessibleName(checks).replace(
										/\. Show checks$/,
										'',
									)}
									onClick={own(onToggleChecks)}
								>
									{checksHeadline(checks)}
								</button>
							) : (
								<span
									className={`folders-tree__checks folders-tree__checks--${checksTone(checks)}`}
									title={checksAccessibleName(checks).replace(
										/\. Show checks$/,
										'',
									)}
								>
									{checksHeadline(checks)}
								</span>
							)}
						</span>
					</span>
				) : null}
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
		</div>
	);
}

function TerminalRow({
	terminal,
	onSelect,
	onDragStart,
	onDragEnd,
}: Readonly<{
	terminal: FolderTreeTerminalRow;
	onSelect: () => void;
	onDragStart?: () => void;
	onDragEnd?: () => void;
}>) {
	return (
		<div
			className={`folders-tree__row folders-tree__row--terminal${terminal.isActive ? ' folders-tree__row--active' : ''}`}
			role="treeitem"
			aria-selected={terminal.isActive}
			tabIndex={0}
			data-folder-terminal-session={terminal.sessionId}
			draggable={onDragStart !== undefined}
			onClick={onSelect}
			onKeyDown={activateOnKey(onSelect)}
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
			<span className="folders-tree__name" title={terminal.title}>
				{terminal.title}
			</span>
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

/** A linked folder's worktree against the default branch, in a few characters. */
function FolderChange({ change }: Readonly<{ change: FolderTreeChange }>) {
	if (change.kind === 'delta')
		return (
			<span
				className="folders-tree__change"
				data-change="delta"
				title={`+${change.additions} −${change.deletions} against the default branch`}
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
			className={`folders-tree__change folders-tree__change--${change.kind}`}
			data-change={change.kind}
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
 * The individual checks of a folder's worktree, beneath its row. The row holds
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
