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
import { isWorktreeShownClean } from './cleanWorktreeSweep.ts';
import { dashboardStatusFor } from './dashboardRows.ts';
import {
	buildFolderTree,
	type FolderTreeChange,
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
		change: worktreeChange(worktree),
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
 * What a row says about a worktree's work. A registration with no working tree
 * is missing, not clean. Otherwise the measured size of the change is shown
 * when there is one, and `clean` only under the one definition of it.
 */
export function worktreeChange(
	worktree: Pick<
		GitWorktreeStatus,
		| 'isPrunable'
		| 'isDirtyBranch'
		| 'entries'
		| 'lineAdditions'
		| 'lineDeletions'
	>,
): FolderTreeChange {
	if (worktree.isPrunable) return { kind: 'missing' };
	const additions = worktree.lineAdditions ?? 0;
	const deletions = worktree.lineDeletions ?? 0;
	if (additions > 0 || deletions > 0)
		return { kind: 'delta', additions, deletions };
	return isWorktreeShownClean(worktree) ? { kind: 'clean' } : { kind: 'changed' };
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
