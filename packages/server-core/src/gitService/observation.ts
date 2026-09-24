import { isAbsolute, relative, resolve } from 'node:path';
import type { GitWorktreeId } from './types.js';

/**
 * What a watch event invalidates. `all` re-measures every worktree; `registry`
 * additionally means the set of worktrees itself may have changed, so the watch
 * set has to be re-derived from the next listing.
 */
export type GitChangeScope =
	| { readonly kind: 'ignore' }
	| { readonly kind: 'all'; readonly registry: boolean }
	| { readonly kind: 'worktrees'; readonly ids: readonly GitWorktreeId[] };

export interface ObservedWorktree {
	readonly id: GitWorktreeId;
	/** Canonical working-tree root. */
	readonly path: string;
	readonly branch: string | null;
	/** Directory name under `<common-dir>/worktrees/`, for linked worktrees. */
	readonly gitDirName: string | null;
	/** Bare or prunable worktrees have no working tree to watch. */
	readonly hasWorkingTree: boolean;
}

export interface ObservedRepositoryLayout {
	readonly mainWorktreeId: GitWorktreeId | null;
	readonly defaultBranch: string | null;
	readonly worktrees: readonly ObservedWorktree[];
}

const IGNORE: GitChangeScope = Object.freeze({ kind: 'ignore' });
const ALL: GitChangeScope = Object.freeze({ kind: 'all', registry: false });
const REGISTRY: GitChangeScope = Object.freeze({ kind: 'all', registry: true });

/** Git directory entries whose writes never change status on their own. */
const INERT_GIT_DIR_ENTRIES = new Set([
	'objects',
	'logs',
	'hooks',
	'info',
	'lfs',
	'modules',
	'FETCH_HEAD',
	'COMMIT_EDITMSG',
	'description',
	'gc.log',
]);

function segments(relativePath: string): string[] {
	return relativePath.split(/[\\/]+/u).filter((part) => part.length > 0);
}

function isLockFile(parts: readonly string[]): boolean {
	const last = parts[parts.length - 1] ?? '';
	return last.endsWith('.lock');
}

function only(ids: readonly GitWorktreeId[]): GitChangeScope {
	return ids.length === 0 ? IGNORE : { kind: 'worktrees', ids };
}

/**
 * Attribute a change inside the repository's common Git directory. `HEAD` and
 * `index` at the top belong to the main worktree; `worktrees/<name>/…` belongs
 * to that linked worktree; a branch ref belongs to the worktrees that have it
 * checked out, and to every worktree when it is the default branch that ahead
 * counts are measured against.
 */
export function attributeGitDirChange(
	relativePath: string | null,
	layout: ObservedRepositoryLayout,
): GitChangeScope {
	if (relativePath === null) return ALL;
	const parts = segments(relativePath);
	if (parts.length === 0) return ALL;
	if (isLockFile(parts)) return IGNORE;
	const [head = '', ...rest] = parts;
	if (INERT_GIT_DIR_ENTRIES.has(head)) return IGNORE;
	if (head === 'packed-refs' || head === 'config') return ALL;
	if (head === 'refs') {
		if (rest[0] === 'tags' || rest[0] === 'stash') return IGNORE;
		if (rest[0] !== 'heads' || rest.length < 2) return ALL;
		const branch = rest.slice(1).join('/');
		if (branch === layout.defaultBranch) return ALL;
		return only(
			layout.worktrees
				.filter((worktree) => worktree.branch === branch)
				.map((worktree) => worktree.id),
		);
	}
	if (head === 'worktrees') {
		// The registry directory itself, or one entry appearing or going away.
		if (rest.length <= 1) return REGISTRY;
		const [name, entry = ''] = rest;
		if (INERT_GIT_DIR_ENTRIES.has(entry)) return IGNORE;
		const owner = layout.worktrees.find(
			(worktree) => worktree.gitDirName === name,
		);
		if (owner === undefined) return REGISTRY;
		// `gitdir`, `locked`, and `prunable` describe the registration itself.
		if (entry === 'gitdir' || entry === 'locked' || entry === 'prunable')
			return REGISTRY;
		return only([owner.id]);
	}
	// Remaining top-level state (HEAD, index, ORIG_HEAD, MERGE_HEAD, rebase
	// directories, …) belongs to the main worktree.
	return layout.mainWorktreeId === null ? ALL : only([layout.mainWorktreeId]);
}

function isWithin(root: string, candidate: string): boolean {
	const rest = relative(root, candidate);
	return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest));
}

/**
 * Attribute a change under a watched working-tree root to the innermost
 * worktree that contains it, so a linked worktree nested inside the main
 * checkout is not mistaken for an edit to the main worktree.
 */
export function attributeWorkingTreeChange(
	root: string,
	relativePath: string | null,
	layout: ObservedRepositoryLayout,
): GitChangeScope {
	const parts = relativePath === null ? [] : segments(relativePath);
	// The Git directory is observed by its own watch.
	if (parts.includes('.git')) return IGNORE;
	const changed = resolve(root, ...parts);
	let owner: ObservedWorktree | undefined;
	for (const worktree of layout.worktrees) {
		if (!worktree.hasWorkingTree || !isWithin(worktree.path, changed)) continue;
		if (owner === undefined || worktree.path.length > owner.path.length)
			owner = worktree;
	}
	if (owner === undefined) return ALL;
	return only([owner.id]);
}

/**
 * The working-tree roots to watch recursively: every worktree with a working
 * tree, minus any already covered by a watch on a containing root.
 */
export function workingTreeWatchRoots(
	layout: ObservedRepositoryLayout,
): string[] {
	const roots = [
		...new Set(
			layout.worktrees
				.filter((worktree) => worktree.hasWorkingTree)
				.map((worktree) => resolve(worktree.path)),
		),
	].sort((first, second) => first.length - second.length);
	const kept: string[] = [];
	for (const root of roots)
		if (!kept.some((outer) => isWithin(outer, root))) kept.push(root);
	return kept;
}

/** The `<name>` in a linked worktree's `.git` file (`gitdir: …/worktrees/<name>`). */
export function linkedGitDirName(gitFileContents: string): string | null {
	const match = /^gitdir:\s*(.+?)\s*$/mu.exec(gitFileContents);
	if (match === null) return null;
	const parts = (match[1] ?? '')
		.split(/[\\/]+/u)
		.filter((part) => part.length > 0);
	const index = parts.lastIndexOf('worktrees');
	return index >= 0 && index === parts.length - 2
		? (parts[index + 1] ?? null)
		: null;
}
