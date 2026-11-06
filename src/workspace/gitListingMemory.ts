/**
 * The last Git worktree listing a window published for each project.
 *
 * A window mounts one workspace per folder, the first time that folder is
 * shown, and each keeps its own copy of the repository's listing. A workspace
 * mounted with an empty copy would draw every folder card without its facts
 * until its own listing arrived. It starts instead from what the window
 * already knows about the same project, and its own listing replaces that.
 *
 * One entry per project, stored with the project root it was taken under: a
 * listing is never recalled for another project, nor for a root the project
 * has since left, even if it later returns to it.
 */

import type { GitWorktreeReference } from '@terminay/client-core';
import type {
	FileExplorerGitStatus,
	WorktreePanelStatus,
} from '../types/terminay';

export type GitListing = {
	readonly referencesByPath: ReadonlyMap<string, GitWorktreeReference>;
	readonly statuses: Readonly<Record<string, FileExplorerGitStatus>>;
	readonly worktrees: WorktreePanelStatus;
};

export type GitListingMemory = {
	recall(projectId: string, projectRoot: string): GitListing | undefined;
	remember(projectId: string, projectRoot: string, listing: GitListing): void;
};

export function createGitListingMemory(): GitListingMemory {
	const entries = new Map<string, { root: string; listing: GitListing }>();
	return {
		recall(projectId, projectRoot) {
			const entry = entries.get(projectId);
			return entry !== undefined && entry.root === projectRoot
				? entry.listing
				: undefined;
		},
		remember(projectId, projectRoot, listing) {
			entries.set(projectId, { root: projectRoot, listing });
		},
	};
}
