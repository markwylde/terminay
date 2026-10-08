/**
 * Where the Folders tree gets what it shows.
 *
 * The tree's model takes three things: the workspace projection, what is
 * known about each panel, and the repository's worktrees. The last two already
 * exist for other surfaces, and the tree reads those rather than a copy: a
 * panel's status and title come from the inventory the dashboard reads, and a
 * worktree's branch, pull request, and checks from the listing the Changes pane
 * reads. A row here therefore cannot disagree with a dashboard row or the
 * Changes pane about the same thing.
 */

import type {
	ServerWorkspaceFolder,
	ServerWorkspacePanel,
	ServerWorkspaceProject,
} from '../shared/serverWorkspaceReconciliation.ts';
import type { GitWorktreeStatus, WorktreePanelStatus } from '../types/terminay';
import { dashboardStatusFor } from './dashboardRows.ts';
import {
	buildFolderTree,
	folderDisplayName,
	type FolderTreeChange,
	type FolderTreeUnmerged,
	type FolderTreeFolderRow,
	type FolderTreePanelFacts,
	type FolderTreeWorktree,
} from './folderTreeModel.ts';
import type { WorkspaceInventoryEntry } from './workspaceInventory.ts';

/**
 * What the inventory knows about each panel.
 *
 * A panel in a folder with no mounted workspace is in no inventory; the tree
 * then falls back to the projection's title and shows it idle.
 */
export function panelFactsFromInventory(
	entries: readonly WorkspaceInventoryEntry[],
): (panelId: string) => FolderTreePanelFacts | undefined {
	const facts = new Map<string, FolderTreePanelFacts>();
	for (const entry of entries)
		facts.set(entry.panelId, {
			status: dashboardStatusFor(entry.status),
			title: entry.title,
		});
	return (panelId) => facts.get(panelId);
}

/** The panel in front of the project, as its inventory marks it. */
export function activePanelIdFromInventory(
	entries: readonly WorkspaceInventoryEntry[],
): string | undefined {
	return entries.find((entry) => entry.isActivePanel === true)?.panelId;
}

/**
 * The repository's worktrees as the tree presents them, or undefined when the
 * project root is not in a repository or no listing has arrived. Undefined is
 * what keeps a branch line off every row of a project without Git.
 */
export function folderTreeWorktrees(
	status: WorktreePanelStatus | null | undefined,
): FolderTreeWorktree[] | undefined {
	if (
		status === null ||
		status === undefined ||
		!status.gitAvailable ||
		status.worktrees.length === 0
	)
		return undefined;
	return status.worktrees.map((worktree) => ({
		path: worktree.path,
		branch: worktree.branch,
		isDetached: worktree.isDetached,
		head: worktree.head,
		change: worktreeChange(worktree),
		...unmergedOf(worktree),
		...(worktree.properties?.pullRequest === undefined
			? {}
			: {
					pullRequest: {
						number: worktree.properties.pullRequest.number,
						state: worktree.properties.pullRequest.state,
						title: worktree.properties.pullRequest.title,
						url: worktree.properties.pullRequest.url,
						...(worktree.properties.pullRequest.mergeable === undefined
							? {}
							: { mergeable: worktree.properties.pullRequest.mergeable }),
					},
				}),
		...(worktree.properties?.checks === undefined
			? {}
			: {
					checks: {
						failed: worktree.properties.checks.failed,
						pending: worktree.properties.checks.pending,
						passed: worktree.properties.checks.passed,
						skipped: worktree.properties.checks.skipped,
					},
				}),
	}));
}

/**
 * What a row says about the work a worktree holds that is nowhere but this
 * machine: uncommitted or untracked changes, and commits on no remote. A
 * registration with no working tree is missing, not clean. Otherwise the
 * measured size of that work is shown when there is one. Work that is pushed
 * and not yet on the default branch is not this; see `worktreeUnmerged`.
 */
export function worktreeChange(
	worktree: Pick<
		GitWorktreeStatus,
		| 'isPrunable'
		| 'hasUnpushedCommits'
		| 'entries'
		| 'unpushedLineAdditions'
		| 'unpushedLineDeletions'
	>,
): FolderTreeChange {
	if (worktree.isPrunable) return { kind: 'missing' };
	const additions = worktree.unpushedLineAdditions ?? 0;
	const deletions = worktree.unpushedLineDeletions ?? 0;
	if (additions > 0 || deletions > 0)
		return { kind: 'delta', additions, deletions };
	return worktree.hasUnpushedCommits || worktree.entries.length > 0
		? { kind: 'changed' }
		: { kind: 'clean' };
}

/**
 * The commits a worktree's branch holds whose effect the default branch does
 * not have, pushed or not. Undefined when there are none; a null count is an
 * unmerged branch whose commits were not counted.
 */
export function worktreeUnmerged(
	worktree: Pick<
		GitWorktreeStatus,
		'isPrunable' | 'isDirtyBranch' | 'aheadOfMainCount'
	>,
): FolderTreeUnmerged | undefined {
	if (worktree.isPrunable || !worktree.isDirtyBranch) return undefined;
	const commits = worktree.aheadOfMainCount ?? 0;
	return { commits: commits > 0 ? commits : null };
}

function unmergedOf(
	worktree: Parameters<typeof worktreeUnmerged>[0],
): { unmerged?: FolderTreeUnmerged } {
	const unmerged = worktreeUnmerged(worktree);
	return unmerged === undefined ? {} : { unmerged };
}

/** A folder's name as every surface outside the tree says it, read from the
 * same listing the tree reads. */
export function folderNameFromStatus(
	folder: Pick<ServerWorkspaceFolder, 'name' | 'kind' | 'worktree'>,
	status: WorktreePanelStatus | null | undefined,
): string {
	return folderDisplayName(folder, folderTreeWorktrees(status));
}

export type ProjectFolderTreeInput = {
	project: Pick<ServerWorkspaceProject, 'id' | 'folderIds' | 'root'> | undefined;
	folders: Readonly<Record<string, ServerWorkspaceFolder>>;
	panels: Readonly<Record<string, ServerWorkspacePanel>>;
	selectedFolderId: string | undefined;
	/** The whole project's inventory, every folder's panels included. */
	inventory: readonly WorkspaceInventoryEntry[];
	worktreeStatus: WorktreePanelStatus | null | undefined;
};

/** A project's Folders tree from the sources above. Empty while no projection
 * describes the project. */
export function buildProjectFolderTree(
	input: ProjectFolderTreeInput,
): FolderTreeFolderRow[] {
	if (input.project === undefined) return [];
	const activePanelId = activePanelIdFromInventory(input.inventory);
	const worktrees = folderTreeWorktrees(input.worktreeStatus);
	return buildFolderTree({
		project: input.project,
		folders: input.folders,
		panels: input.panels,
		panelFacts: panelFactsFromInventory(input.inventory),
		...(input.selectedFolderId === undefined
			? {}
			: { selectedFolderId: input.selectedFolderId }),
		...(activePanelId === undefined ? {} : { activePanelId }),
		...(worktrees === undefined ? {} : { worktrees }),
	});
}
