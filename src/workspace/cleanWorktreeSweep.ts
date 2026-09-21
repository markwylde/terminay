import type { GitWorktreeStatus } from '../types/terminay';

type WorktreeCleanliness = Pick<
	GitWorktreeStatus,
	'isDirtyBranch' | 'entries' | 'lineAdditions' | 'lineDeletions'
>;

/** The one definition of a row reading `clean`: nothing committed that the
 * default branch lacks, and no displayed working-tree delta. */
export function isWorktreeShownClean(worktree: WorktreeCleanliness): boolean {
	return (
		!worktree.isDirtyBranch &&
		worktree.entries.length === 0 &&
		(worktree.lineAdditions ?? 0) === 0 &&
		(worktree.lineDeletions ?? 0) === 0
	);
}

/** Whether "Delete all clean worktrees" may nominate this worktree. The server
 * decides again before removing anything; this only chooses what the user is
 * asked to confirm. A lock is an explicit "keep this", and a worktree whose
 * status could not be read is not known to be clean. */
export function isBulkDeletableWorktree(
	worktree: GitWorktreeStatus,
	busyWorktreePaths?: ReadonlySet<string>,
): boolean {
	return (
		isWorktreeShownClean(worktree) &&
		!worktree.isMain &&
		!worktree.isBare &&
		!worktree.isCurrent &&
		!worktree.isLocked &&
		!worktree.isPrunable &&
		worktree.head !== null &&
		worktree.errorMessage === undefined &&
		!(busyWorktreePaths?.has(worktree.path) ?? false)
	);
}

const MAX_LISTED_WORKTREES = 20;

function listedNames(names: readonly string[]): string {
	const shown = names.slice(0, MAX_LISTED_WORKTREES).map((name) => `  ${name}`);
	const hidden = names.length - shown.length;
	if (hidden > 0) shown.push(`  …and ${hidden} more`);
	return shown.join('\n');
}

function worktreeCount(count: number): string {
	return `${count} clean worktree${count === 1 ? '' : 's'}`;
}

export function cleanWorktreeSweepConfirmation(
	names: readonly string[],
): string {
	return `Delete ${worktreeCount(names.length)}?\n\n${listedNames(names)}\n\n${
		names.length === 1 ? 'This worktree has' : 'These worktrees have'
	} no uncommitted or unmerged changes. ${
		names.length === 1 ? 'Its folder is' : 'Their folders are'
	} permanently removed. Branches are kept.`;
}

export type CleanWorktreeSweepSkip = {
	readonly name: string;
	readonly reason: string;
};

/** Null when every worktree was deleted: the rows disappearing is the feedback. */
export function cleanWorktreeSweepOutcome(
	deletedCount: number,
	skipped: readonly CleanWorktreeSweepSkip[],
): string | null {
	if (skipped.length === 0) return null;
	return `Deleted ${worktreeCount(deletedCount)}. ${skipped.length} ${
		skipped.length === 1 ? 'was' : 'were'
	} not deleted:\n\n${listedNames(
		skipped.map(({ name, reason }) => `${name} — ${reason}`),
	)}`;
}
