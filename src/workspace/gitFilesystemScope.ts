export function sameFilesystemPath(left: string, right: string): boolean {
	return normalizeComparablePath(left) === normalizeComparablePath(right);
}

function normalizeComparablePath(path: string): string {
	const normalized = path.replace(/\\/g, '/').replace(/\/+$/u, '') || path;
	return normalized.startsWith('/private/var/')
		? normalized.slice('/private'.length)
		: normalized;
}

/** Longest listed worktree whose root contains `path`. Prefix matching requires
 * a directory boundary so `/repo` does not claim `/repo-feature`. */
export function owningWorktreeForPath(
	path: string,
	worktrees: readonly { readonly path: string }[] | undefined,
): { readonly path: string } | undefined {
	if (worktrees === undefined || worktrees.length === 0) return undefined;
	const candidate = normalizeComparablePath(path);
	let best: { readonly path: string } | undefined;
	for (const worktree of worktrees) {
		const root = normalizeComparablePath(worktree.path);
		if (candidate === root || candidate.startsWith(`${root}/`)) {
			if (best === undefined || worktree.path.length > best.path.length) {
				best = worktree;
			}
		}
	}
	return best;
}

/** Returns the listed worktree root that must become the project root before
 * an Explorer mutation, or undefined when `path` is already in scope. */
export function gitFilesystemActionWorktreeRoot(
	path: string,
	projectRoot: string,
	worktrees: readonly { readonly path: string }[] | undefined,
): string | undefined {
	const owning = owningWorktreeForPath(path, worktrees);
	if (owning === undefined) return undefined;
	if (sameFilesystemPath(owning.path, projectRoot)) return undefined;
	return owning.path;
}
