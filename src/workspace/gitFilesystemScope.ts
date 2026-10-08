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
export function owningWorktreeForPath<
	Worktree extends { readonly path: string },
>(
	path: string,
	worktrees: readonly Worktree[] | undefined,
): Worktree | undefined {
	if (worktrees === undefined || worktrees.length === 0) return undefined;
	const candidate = normalizeComparablePath(path);
	let best: Worktree | undefined;
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
