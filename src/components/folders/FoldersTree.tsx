import { EllipsisVertical, Folder, GitBranch, Plus } from 'lucide-react';
import {
	type DragEvent,
	type KeyboardEvent,
	type MouseEvent,
	useState,
} from 'react';
import type {
	FolderTreeFolderRow,
	FolderTreeTerminalRow,
} from '../../workspace/folderTreeModel';
import { AgentStatusIndicator } from '../AgentStatusIndicator';
import './foldersTree.css';

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
	variant = 'tree',
}: FoldersTreeProps) {
	const [dropTargetId, setDropTargetId] = useState<string | null>(null);
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
					/>
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
}: Readonly<{
	folder: FolderTreeFolderRow;
	onSelect: () => void;
	onMenu?: (event: MouseEvent) => void;
}>) {
	const { pullRequest, checks } = folder;
	const hasSecondLine = folder.branch !== undefined;
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
						<span className="folders-tree__branch" title={folder.branch}>
							<GitBranch size={12} aria-hidden="true" />
							<span>{folder.branch}</span>
						</span>
						{pullRequest === undefined ? null : (
							<span
								className={`folders-tree__pr folders-tree__pr--${pullRequest.state}`}
								title={`#${pullRequest.number} ${pullRequest.title}`}
							>
								#{pullRequest.number}
							</span>
						)}
						{checks === undefined ? null : (
							<span
								className={`folders-tree__checks folders-tree__checks--${checksTone(checks)}`}
								title={`${checks.passed} passed, ${checks.failed} failed, ${checks.pending} pending`}
							>
								{checks.passed + checks.failed + checks.pending}
							</span>
						)}
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

/** Failed wins over pending, which wins over passed, as on a worktree row. */
function checksTone(
	checks: Readonly<{ failed: number; pending: number }>,
): 'failed' | 'pending' | 'passed' {
	if (checks.failed > 0) return 'failed';
	if (checks.pending > 0) return 'pending';
	return 'passed';
}

function activateOnKey(activate: () => void) {
	return (event: KeyboardEvent) => {
		if (event.target !== event.currentTarget) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		activate();
	};
}
