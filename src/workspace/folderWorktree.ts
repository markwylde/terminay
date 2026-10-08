/**
 * Which worktree a folder stands for.
 *
 * The Git service lists every worktree of the repository that holds the
 * project root. A folder is one of them: a linked folder is the worktree its
 * link names, and General and a plain folder are the checkout at the project
 * root. The Changes pane and the folder menu both ask this one question, so
 * they cannot disagree about whose branch and changes they are showing.
 *
 * A Git request addresses a worktree by its own id, so nothing here turns a
 * folder into a path to send: it only finds the listed row.
 */

import type { ServerWorkspaceFolder } from '../shared/serverWorkspaceReconciliation.ts';
import type {
	GitPanelStatus,
	GitWorktreeStatus,
	WorktreePanelStatus,
} from '../types/terminay';
import { owningWorktreeForPath, sameFilesystemPath } from './gitFilesystemScope.ts';

type FolderLink = Pick<ServerWorkspaceFolder, 'kind' | 'worktree'>;

/** True once a listing says the project root is inside a repository. */
export function isGitProject(
	status: WorktreePanelStatus | null | undefined,
): boolean {
	return status?.gitAvailable === true && status.repoRoot !== null;
}

/**
 * The listed worktree a folder stands for, or undefined when there is none:
 * the project is not in a repository, the listing has not arrived, or a linked
 * folder's worktree has left it.
 */
export function worktreeOfFolder(
	folder: FolderLink,
	projectRoot: string,
	status: WorktreePanelStatus | null | undefined,
): GitWorktreeStatus | undefined {
	if (!isGitProject(status) || status == null) return undefined;
	if (folder.kind === 'linked') {
		const linkedPath = folder.worktree?.path;
		if (linkedPath === undefined) return undefined;
		return status.worktrees.find((worktree) =>
			sameFilesystemPath(worktree.path, linkedPath),
		);
	}
	// The listing marks the checkout that holds the project root. A listing
	// that marks none still names it by containing the root.
	return (
		status.worktrees.find((worktree) => worktree.isCurrent) ??
		owningWorktreeForPath(projectRoot, status.worktrees)
	);
}

/**
 * The directory a folder's menu copies and opens. A linked folder's is its
 * worktree; General's is the checkout that holds the project root; a plain
 * folder's, and General's outside a repository, is the project root itself.
 * For showing and copying only: a request names the folder, never this path.
 */
export function folderDirectory(
	folder: FolderLink,
	projectRoot: string,
	status: WorktreePanelStatus | null | undefined,
): string {
	if (folder.kind === 'linked')
		return folder.worktree?.path ?? projectRoot;
	if (folder.kind === 'plain') return projectRoot;
	return worktreeOfFolder(folder, projectRoot, status)?.path ?? projectRoot;
}

/** What the Changes pane shows for one folder. */
export type FolderChanges =
	| { readonly kind: 'loading' }
	| { readonly kind: 'git-unavailable' }
	| { readonly kind: 'not-a-repository' }
	/** A linked folder whose worktree the listing does not hold yet. */
	| { readonly kind: 'worktree-unlisted' }
	| {
			readonly kind: 'worktree';
			readonly worktree: GitWorktreeStatus;
			/** The one worktree as the changes tree takes it. */
			readonly status: GitPanelStatus;
	  };

export function folderChanges(
	folder: FolderLink,
	projectRoot: string,
	status: WorktreePanelStatus | null | undefined,
): FolderChanges {
	if (status === null || status === undefined) return { kind: 'loading' };
	if (!status.gitAvailable) return { kind: 'git-unavailable' };
	if (status.repoRoot === null) return { kind: 'not-a-repository' };
	const worktree = worktreeOfFolder(folder, projectRoot, status);
	if (worktree === undefined)
		return folder.kind === 'linked'
			? { kind: 'worktree-unlisted' }
			: { kind: 'not-a-repository' };
	return {
		kind: 'worktree',
		worktree,
		status: {
			gitAvailable: true,
			repoRoot: worktree.path,
			branch: worktree.branch,
			entries: worktree.entries,
		},
	};
}
