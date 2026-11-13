import { isAbsolute, relative, resolve } from 'node:path';
import type {
	GitObservationEntryClass,
	GitObservationScope,
	GitWorktreeId,
} from './types.js';

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

/**
 * Name the kind of entry that changed inside the common Git directory, for
 * diagnostics. Mirrors `attributeGitDirChange` branch for branch, and returns
 * a class from a fixed vocabulary rather than the path or the ref name.
 */
export function classifyGitDirEntry(
	relativePath: string | null,
	layout: ObservedRepositoryLayout,
): GitObservationEntryClass {
	if (relativePath === null) return 'unnamed';
	const parts = segments(relativePath);
	if (parts.length === 0) return 'unnamed';
	if (isLockFile(parts)) return 'lock';
	const [head = '', ...rest] = parts;
	if (INERT_GIT_DIR_ENTRIES.has(head)) return 'inert';
	if (head === 'packed-refs') return 'packed-refs';
	if (head === 'config') return 'config';
	if (head === 'refs') {
		if (rest[0] === 'tags' || rest[0] === 'stash') return 'inert';
		if (rest[0] === 'remotes') return 'remote-ref';
		if (rest[0] !== 'heads' || rest.length < 2) return 'other';
		return rest.slice(1).join('/') === layout.defaultBranch
			? 'default-branch-ref'
			: 'branch-ref';
	}
	if (head === 'worktrees') {
		if (rest.length <= 1) return 'worktree-registry';
		const [name, entry = ''] = rest;
		if (INERT_GIT_DIR_ENTRIES.has(entry)) return 'inert';
		if (!layout.worktrees.some((worktree) => worktree.gitDirName === name))
			return 'worktree-registry';
		if (entry === 'gitdir' || entry === 'locked' || entry === 'prunable')
			return 'worktree-registry';
		return 'linked-worktree-state';
	}
	if (head === 'HEAD') return 'head';
	if (head === 'index') return 'index';
	return 'other';
}

/** The diagnostic name of a scope. */
export function scopeName(scope: GitChangeScope): GitObservationScope {
	if (scope.kind === 'all') return scope.registry ? 'registry' : 'all';
	return scope.kind;
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

/**
 * Which directories a built-up Git-directory watch descends into: everything
 * observation does not already call inert. `info` stays watched because
 * `info/exclude` is an ignore input; its events still classify as inert.
 */
export function gitDirectoryWatchFilter(
	relativeDirs: readonly string[],
): string[] {
	return relativeDirs.filter((relativeDir) => {
		const [head = '', second = '', third = ''] = segments(relativeDir);
		if (head === 'info') return true;
		if (INERT_GIT_DIR_ENTRIES.has(head)) return false;
		if (head === 'refs' && (second === 'tags' || second === 'stash'))
			return false;
		if (head === 'worktrees' && INERT_GIT_DIR_ENTRIES.has(third)) return false;
		return true;
	});
}

/**
 * Whether a change in the common Git directory alters what a working tree
 * ignores (`rules`) or tracks (`tracking`), so built-up working-tree watches
 * must re-ask which directories they exclude.
 */
export function gitDirIgnoreInput(
	relativePath: string | null,
): 'rules' | 'tracking' | null {
	if (relativePath === null) return null;
	const parts = segments(relativePath);
	if (isLockFile(parts)) return null;
	const [head = '', second = '', third = ''] = parts;
	if (parts.length === 1 && (head === 'config' || head === 'config.worktree'))
		return 'rules';
	if (parts.length === 2 && head === 'info' && second === 'exclude')
		return 'rules';
	if (parts.length === 1 && head === 'index') return 'tracking';
	if (parts.length === 3 && head === 'worktrees') {
		if (third === 'index') return 'tracking';
		if (third === 'config.worktree') return 'rules';
	}
	return null;
}

/** Whether a working-tree change names an ignore-rule file. */
export function isIgnoreRuleChange(relativePath: string | null): boolean {
	if (relativePath === null) return false;
	const parts = segments(relativePath);
	return parts[parts.length - 1] === '.gitignore';
}

/**
 * Undo Git's C-style path quoting (`core.quotePath`): a path containing a
 * double quote, backslash or control character is printed in double quotes
 * with backslash escapes and octal bytes.
 */
export function unquoteGitPath(line: string): string {
	if (line.length < 2 || !line.startsWith('"') || !line.endsWith('"'))
		return line;
	const body = line.slice(1, -1);
	const escapes: Readonly<Record<string, number>> = {
		a: 7,
		b: 8,
		t: 9,
		n: 10,
		v: 11,
		f: 12,
		r: 13,
		'"': 34,
		'\\': 92,
	};
	const bytes: number[] = [];
	let run = 0;
	const flush = (end: number) => {
		if (end > run) bytes.push(...Buffer.from(body.slice(run, end), 'utf8'));
	};
	for (let index = 0; index < body.length; index++) {
		if (body[index] !== '\\') continue;
		flush(index);
		const octal = /^[0-3][0-7]{2}/u.exec(body.slice(index + 1, index + 4));
		const next = body[index + 1] ?? '';
		if (octal !== null) {
			bytes.push(Number.parseInt(octal[0], 8));
			index += 3;
		} else if (escapes[next] !== undefined) {
			bytes.push(escapes[next]);
			index += 1;
		} else bytes.push(92);
		run = index + 1;
	}
	flush(body.length);
	return Buffer.from(bytes).toString('utf8');
}
