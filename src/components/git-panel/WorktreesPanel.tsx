import {
	ChevronDown,
	FileEdit,
	FolderInput,
	FolderOpen,
	GitBranch,
	FolderGit,
	Terminal,
	Trash2,
} from 'lucide-react';
import { type JSX, type MouseEvent, useEffect, useRef, useState } from 'react';
import type {
	GitChangeEntry,
	GitWorktreeStatus,
	WorktreePanelStatus,
} from '../../types/terminay';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import { GitPanel } from './GitPanel';
import './gitPanel.css';

export type WorktreesPanelProps = {
	status: WorktreePanelStatus | null;
	viewMode: 'list' | 'tree';
	onDeleteWorktree: (worktree: GitWorktreeStatus) => void;
	onOpenEntry: (entry: GitChangeEntry) => void;
	onOpenTerminal: (worktree: GitWorktreeStatus) => void;
	onRenameWorktree: (worktree: GitWorktreeStatus) => void;
	onRevealWorktree: (worktree: GitWorktreeStatus) => void;
	onSwitchProjectRoot: (worktree: GitWorktreeStatus) => void;
};

function getWorktreeTitle(worktree: GitWorktreeStatus): string {
	const parts = [worktree.path];
	if (worktree.branch) {
		parts.push(`Branch: ${worktree.branch}`);
	}
	if (worktree.head) {
		parts.push(`HEAD: ${worktree.head.slice(0, 12)}`);
	}
	if (worktree.aheadOfMainCount !== null) {
		parts.push(
			worktree.aheadOfMainCount > 0
				? `${worktree.aheadOfMainCount} commit${worktree.aheadOfMainCount === 1 ? '' : 's'} ahead of main`
				: 'No commits ahead of main',
		);
	}
	if (worktree.entries.length > 0) {
		parts.push(
			`${worktree.entries.length} file change${worktree.entries.length === 1 ? '' : 's'}`,
		);
	}
	if (worktree.lineAdditions !== null || worktree.lineDeletions !== null) {
		parts.push(`+${worktree.lineAdditions ?? 0} -${worktree.lineDeletions ?? 0}`);
	}
	if (worktree.lastChangedAt) {
		parts.push(`Last changed: ${formatWorktreeDate(worktree.lastChangedAt)}`);
	}
	return parts.join('\n');
}

function formatWorktreeDate(value: string | null): string {
	if (!value) {
		return 'No changes';
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return 'Unknown date';
	}

	return new Intl.DateTimeFormat(undefined, {
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		month: 'short',
	}).format(date);
}

export function WorktreesPanel(props: WorktreesPanelProps): JSX.Element {
	const {
		status,
		viewMode,
		onDeleteWorktree,
		onOpenEntry,
		onOpenTerminal,
		onRenameWorktree,
		onRevealWorktree,
		onSwitchProjectRoot,
	} = props;
	const initializedWorktreesRef = useRef<Set<string>>(new Set());
	const [collapsedWorktrees, setCollapsedWorktrees] = useState<Set<string>>(
		() => new Set(),
	);
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		worktree: GitWorktreeStatus;
	} | null>(null);

	useEffect(() => {
		if (!status?.repoRoot) {
			initializedWorktreesRef.current = new Set();
			setCollapsedWorktrees(new Set());
			return;
		}

		const currentPaths = new Set(status.worktrees.map((worktree) => worktree.path));
		setCollapsedWorktrees((prev) => {
			const next = new Set(
				Array.from(prev).filter((worktreePath) =>
					currentPaths.has(worktreePath),
				),
			);

			for (const worktreePath of currentPaths) {
				if (!initializedWorktreesRef.current.has(worktreePath)) {
					next.add(worktreePath);
				}
			}

			return next;
		});
		initializedWorktreesRef.current = currentPaths;
	}, [status]);

	const toggleWorktree = (worktreePath: string) => {
		setCollapsedWorktrees((prev) => {
			const next = new Set(prev);
			if (next.has(worktreePath)) {
				next.delete(worktreePath);
			} else {
				next.add(worktreePath);
			}
			return next;
		});
	};

	const openContextMenu = (
		event: MouseEvent<HTMLElement>,
		worktree: GitWorktreeStatus,
	) => {
		event.preventDefault();
		event.stopPropagation();
		setContextMenu({
			x: event.clientX,
			y: event.clientY,
			worktree,
		});
	};

	if (status === null) {
		return (
			<div className="worktrees-panel">
				<div className="git-panel__message">Loading…</div>
			</div>
		);
	}

	if (!status.gitAvailable) {
		return (
			<div className="worktrees-panel">
				<div className="git-panel__message">Git is not available</div>
			</div>
		);
	}

	if (!status.repoRoot) {
		return (
			<div className="worktrees-panel">
				<div className="git-panel__message">Not a git repository</div>
			</div>
		);
	}

	if (status.worktrees.length === 0) {
		return (
			<div className="worktrees-panel">
				<div className="git-panel__message">No worktrees</div>
			</div>
		);
	}

	return (
		<div className="worktrees-panel">
			{status.worktrees.map((worktree) => {
				const collapsed = collapsedWorktrees.has(worktree.path);
				const branchLabel = worktree.branch ?? (worktree.isDetached ? 'HEAD' : '');
				const hasUnmergedOrUncommittedWork =
					worktree.isDirtyBranch || worktree.entries.length > 0;
				const WorktreeIcon = worktree.isMain ? FolderGit : GitBranch;
				const worktreeStatus = {
					gitAvailable: status.gitAvailable,
					repoRoot: worktree.path,
					branch: worktree.branch,
					entries: worktree.entries,
				};

				return (
					<section key={worktree.path} className="worktrees-panel__worktree">
						<button
							type="button"
							className={[
								'worktrees-panel__worktree-header',
								collapsed ? 'worktrees-panel__worktree-header--collapsed' : '',
								worktree.isCurrent
									? 'worktrees-panel__worktree-header--current'
									: '',
								hasUnmergedOrUncommittedWork
									? 'worktrees-panel__worktree-header--dirty'
									: '',
							]
								.filter(Boolean)
								.join(' ')}
							onClick={() => toggleWorktree(worktree.path)}
							onContextMenu={(event) => openContextMenu(event, worktree)}
							title={getWorktreeTitle(worktree)}
							aria-expanded={!collapsed}
						>
							<span
								className={`git-panel__folder-chevron${
									collapsed ? ' git-panel__folder-chevron--collapsed' : ''
								}`}
								aria-hidden="true"
							>
								<ChevronDown size={14} aria-hidden />
							</span>
							<span className="worktrees-panel__worktree-main">
								<span className="worktrees-panel__worktree-topline">
									<span
										className={`worktrees-panel__worktree-icon${
											hasUnmergedOrUncommittedWork
												? ' worktrees-panel__worktree-icon--dirty'
												: ''
										}`}
										aria-hidden="true"
									>
										<WorktreeIcon size={14} aria-hidden />
									</span>
									<span className="worktrees-panel__worktree-name">
										{worktree.name}
									</span>
									<span className="worktrees-panel__spacer" />
									{worktree.isCurrent ? (
										<span className="worktrees-panel__pill">current</span>
									) : null}
									{branchLabel ? (
										<span className="worktrees-panel__branch">{branchLabel}</span>
									) : null}
								</span>
								<span className="worktrees-panel__worktree-meta">
									<span className="worktrees-panel__delta worktrees-panel__delta--additions">
										+{worktree.lineAdditions ?? 0}
									</span>
									<span className="worktrees-panel__delta worktrees-panel__delta--deletions">
										-{worktree.lineDeletions ?? 0}
									</span>
									<span className="worktrees-panel__date">
										{formatWorktreeDate(worktree.lastChangedAt)}
									</span>
									<span className="worktrees-panel__spacer" />
									<span className="worktrees-panel__count">
										{worktree.entries.length}
									</span>
								</span>
							</span>
						</button>
						{collapsed ? null : worktree.errorMessage ? (
							<div className="git-panel__message">{worktree.errorMessage}</div>
						) : worktree.isBare ? (
							<div className="git-panel__message">Bare worktree</div>
						) : worktree.isPrunable ? (
							<div className="git-panel__message">Prunable worktree</div>
						) : (
							<div className="worktrees-panel__changes">
								<GitPanel
									status={worktreeStatus}
									viewMode={viewMode}
									onOpenEntry={onOpenEntry}
								/>
							</div>
						)}
					</section>
				);
			})}
			{contextMenu ? (
				<ContextMenu
					x={contextMenu.x}
					y={contextMenu.y}
					onClose={() => setContextMenu(null)}
					items={buildWorktreeContextMenuItems({
						onDeleteWorktree,
						onOpenTerminal,
						onRenameWorktree,
						onRevealWorktree,
						onSwitchProjectRoot,
						worktree: contextMenu.worktree,
					})}
				/>
			) : null}
		</div>
	);
}

function buildWorktreeContextMenuItems(options: {
	onDeleteWorktree: (worktree: GitWorktreeStatus) => void;
	onOpenTerminal: (worktree: GitWorktreeStatus) => void;
	onRenameWorktree: (worktree: GitWorktreeStatus) => void;
	onRevealWorktree: (worktree: GitWorktreeStatus) => void;
	onSwitchProjectRoot: (worktree: GitWorktreeStatus) => void;
	worktree: GitWorktreeStatus;
}): ContextMenuItem[] {
	const {
		onDeleteWorktree,
		onOpenTerminal,
		onRenameWorktree,
		onRevealWorktree,
		onSwitchProjectRoot,
		worktree,
	} = options;
	const unavailable = worktree.isBare || worktree.isPrunable;
	const cannotMoveOrRemove =
		worktree.isCurrent || worktree.isMain || worktree.isBare;

	return [
		{
			label: 'Switch project root',
			icon: <FolderInput size={14} />,
			disabled: worktree.isCurrent || unavailable,
			onClick: () => onSwitchProjectRoot(worktree),
		},
		{
			label: 'Rename worktree',
			icon: <FileEdit size={14} />,
			disabled: cannotMoveOrRemove || worktree.isPrunable,
			onClick: () => onRenameWorktree(worktree),
		},
		{
			label: 'Delete worktree',
			icon: <Trash2 size={14} />,
			danger: true,
			disabled: cannotMoveOrRemove,
			onClick: () => onDeleteWorktree(worktree),
		},
		{ separator: true, label: '', onClick: () => {} },
		{
			label: 'Open terminal here',
			icon: <Terminal size={14} />,
			disabled: unavailable,
			onClick: () => onOpenTerminal(worktree),
		},
		{
			label: 'Reveal in OS',
			icon: <FolderOpen size={14} />,
			disabled: unavailable,
			onClick: () => onRevealWorktree(worktree),
		},
	];
}
