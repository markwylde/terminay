import { GitBranch } from 'lucide-react';
import type { JSX } from 'react';
import type { GitChangeEntry } from '../../types/terminay';
import type { FolderChanges } from '../../workspace/folderWorktree';
import { GitPanel } from './GitPanel';
import './gitPanel.css';

export type ChangesPaneProps = {
	/** The one worktree this pane reports: the selected folder's. */
	changes: FolderChanges;
	viewMode: 'list' | 'tree';
	isDeleting?: boolean;
	isPulling?: boolean;
	onDelete: (path: string) => void;
	onNewFile: (path: string) => void;
	onNewFolder: (path: string) => void;
	onOpenEntry: (entry: GitChangeEntry) => void;
	onOpenFolder: (path: string) => void;
	onOpenTerminal?: (path: string) => void;
	onRename: (path: string) => void;
};

/**
 * The branch and working-tree changes of one worktree.
 *
 * Which worktree that is has been decided before this renders: it is handed
 * the selected folder's, and lists no other. A folder outside a repository is
 * told so and offered nothing to do.
 */
export function ChangesPane(props: ChangesPaneProps): JSX.Element {
	return (
		<div className="changes-pane" data-changes-state={props.changes.kind}>
			<ChangesBody {...props} />
		</div>
	);
}

function ChangesBody({
	changes,
	viewMode,
	isDeleting = false,
	isPulling = false,
	onDelete,
	onNewFile,
	onNewFolder,
	onOpenEntry,
	onOpenFolder,
	onOpenTerminal,
	onRename,
}: ChangesPaneProps): JSX.Element {
	if (changes.kind === 'loading')
		return <div className="git-panel__message">Loading…</div>;
	if (changes.kind === 'git-unavailable')
		return <div className="git-panel__message">Git is not available</div>;
	if (changes.kind === 'not-a-repository')
		return (
			<div className="git-panel__message">
				This folder is not in a Git repository
			</div>
		);
	if (changes.kind === 'worktree-unlisted')
		return (
			<div className="git-panel__message">
				Git does not list this folder&apos;s worktree
			</div>
		);

	const { worktree } = changes;
	return (
		<>
			<div
				className="changes-pane__branch"
				title={worktree.path}
				aria-busy={isDeleting || isPulling}
			>
				<GitBranch size={12} aria-hidden="true" />
				<span className="changes-pane__branch-name">
					{worktree.branch ?? 'No branch'}
				</span>
				{isDeleting ? (
					<span className="changes-pane__activity">deleting…</span>
				) : isPulling ? (
					<span className="changes-pane__activity">pulling…</span>
				) : null}
			</div>
			{isDeleting ? null : worktree.errorMessage ? (
				<div className="git-panel__message">{worktree.errorMessage}</div>
			) : worktree.isBare ? (
				<div className="git-panel__message">Bare worktree</div>
			) : worktree.isPrunable ? (
				<div className="git-panel__message">
					Working tree is missing. Delete it to remove Git&apos;s record.
				</div>
			) : (
				<GitPanel
					status={changes.status}
					viewMode={viewMode}
					onDelete={onDelete}
					onNewFile={onNewFile}
					onNewFolder={onNewFolder}
					onOpenEntry={onOpenEntry}
					onOpenFolder={onOpenFolder}
					onOpenTerminal={onOpenTerminal}
					onRename={onRename}
				/>
			)}
		</>
	);
}
