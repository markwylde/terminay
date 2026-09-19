import { execFile } from 'node:child_process';
import { type FSWatcher, watch as watchFileSystem } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { parseWorktreeList } from '../gitService/parse.js';
import {
	createRampSchedule,
	type RampSchedule,
	type RampScheduleOptions,
} from './rampSchedule.js';

/** A project's repository: where its worktree metadata lives, and every
 * worktree it lists. Absent for a project outside any Git repository. */
export interface ProjectRepositoryWorktrees {
	readonly commonDir: string;
	readonly worktrees: readonly string[];
}

export type WorktreeResolver = (
	root: string,
) => Promise<ProjectRepositoryWorktrees | undefined>;

/** Watches one directory; returns a function that stops watching. */
export type DirectoryWatcher = (
	directory: string,
	onChange: () => void,
) => (() => void) | undefined;

export interface ProjectAgentScopeOptions {
	readonly resolveWorktrees?: WorktreeResolver;
	readonly watch?: DirectoryWatcher;
	readonly canonicalize?: (path: string) => Promise<string>;
	readonly ramp?: RampScheduleOptions;
}

interface ProjectScope {
	readonly projectId: string;
	root: string;
	worktrees: readonly string[];
	commonDir?: string;
	stopWatches: Array<() => void>;
	ramp: RampSchedule;
	generation: number;
}

/**
 * Which projects a session's working directory belongs to.
 *
 * A directory belongs to a project when it is the project root or below it,
 * or is (below) any worktree of the Git repository containing the root —
 * wherever that worktree lives on disk. The worktree set is read with
 * `git worktree list --porcelain` when a project is bound, and again when the
 * repository's worktree metadata changes, observed by a directory watch damped
 * by the shared ramp schedule. Nothing here runs on a timer.
 *
 * Roots come only from the server's own canonical project bindings, never from
 * a client or an extension.
 */
export class ProjectAgentScope {
	private readonly projects = new Map<string, ProjectScope>();
	private readonly listeners = new Set<() => void>();
	private readonly canonicalCache = new Map<string, string>();
	private readonly pending = new Set<Promise<void>>();
	private readonly resolveWorktrees: WorktreeResolver;
	private readonly watch: DirectoryWatcher;
	private readonly canonicalize: (path: string) => Promise<string>;
	private readonly rampOptions: RampScheduleOptions | undefined;
	private disposed = false;

	constructor(options: ProjectAgentScopeOptions = {}) {
		this.resolveWorktrees = options.resolveWorktrees ?? gitWorktrees;
		this.watch = options.watch ?? watchDirectory;
		this.canonicalize = options.canonicalize ?? canonicalPath;
		this.rampOptions = options.ramp;
	}

	/** Bind or re-bind a project to its canonical root. */
	setProject(projectId: string, root: string): void {
		if (this.disposed) return;
		if (!isAbsolute(root)) throw new TypeError('project root must be absolute');
		const existing = this.projects.get(projectId);
		if (existing !== undefined && existing.root === root) return;
		if (existing !== undefined) this.release(existing);
		const scope: ProjectScope = {
			projectId,
			root: resolve(root),
			worktrees: [],
			stopWatches: [],
			ramp: createRampSchedule(() => {
				this.track(this.refresh(projectId));
			}, this.rampOptions),
			generation: 0,
		};
		this.projects.set(projectId, scope);
		this.notify();
		this.track(this.refresh(projectId));
	}

	removeProject(projectId: string): void {
		const scope = this.projects.get(projectId);
		if (scope === undefined) return;
		this.release(scope);
		this.projects.delete(projectId);
		this.notify();
	}

	/** Every project a canonical working directory belongs to. */
	projectIdsFor(cwd: string | undefined): readonly string[] {
		if (cwd === undefined || !isAbsolute(cwd)) return [];
		const matches: string[] = [];
		for (const scope of this.projects.values())
			if (
				within(cwd, scope.root) ||
				scope.worktrees.some((worktree) => within(cwd, worktree))
			)
				matches.push(scope.projectId);
		return matches.sort();
	}

	/** The canonical form of a reported working directory, cached per input. */
	async canonical(cwd: string): Promise<string> {
		const cached = this.canonicalCache.get(cwd);
		if (cached !== undefined) return cached;
		let value: string;
		try {
			value = await this.canonicalize(cwd);
		} catch {
			value = resolve(cwd);
		}
		if (this.canonicalCache.size >= 4_096)
			this.canonicalCache.delete(this.canonicalCache.keys().next().value!);
		this.canonicalCache.set(cwd, value);
		return value;
	}

	/** Called whenever any project's membership may have changed. */
	onChanged(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Settles once every in-flight worktree resolution has. */
	async settled(): Promise<void> {
		while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
	}

	dispose(): void {
		this.disposed = true;
		for (const scope of this.projects.values()) this.release(scope);
		this.projects.clear();
		this.listeners.clear();
	}

	private async refresh(projectId: string): Promise<void> {
		const scope = this.projects.get(projectId);
		if (scope === undefined) return;
		const generation = ++scope.generation;
		let repository: ProjectRepositoryWorktrees | undefined;
		try {
			repository = await this.resolveWorktrees(scope.root);
		} catch {
			repository = undefined;
		}
		const worktrees =
			repository === undefined
				? []
				: await Promise.all(
						repository.worktrees.map((path) => this.canonical(path)),
					);
		if (
			this.disposed ||
			this.projects.get(projectId) !== scope ||
			scope.generation !== generation
		)
			return;
		const commonDir = repository?.commonDir;
		if (commonDir !== scope.commonDir) {
			for (const stop of scope.stopWatches.splice(0)) stop();
			scope.commonDir = commonDir;
			if (commonDir !== undefined) this.watchMetadata(scope, commonDir);
		} else if (commonDir !== undefined && scope.stopWatches.length < 2) {
			// `worktrees/` appears with the first linked worktree.
			this.watchMetadata(scope, commonDir);
		}
		const changed =
			worktrees.length !== scope.worktrees.length ||
			worktrees.some((path, index) => path !== scope.worktrees[index]);
		scope.worktrees = Object.freeze(worktrees);
		if (changed) this.notify();
	}

	private watchMetadata(scope: ProjectScope, commonDir: string): void {
		for (const stop of scope.stopWatches.splice(0)) stop();
		const request = () => scope.ramp.request();
		// The common dir sees `worktrees/` created or removed; the directory
		// itself sees each linked worktree registered or pruned.
		for (const directory of [commonDir, join(commonDir, 'worktrees')]) {
			const stop = this.watch(directory, request);
			if (stop !== undefined) scope.stopWatches.push(stop);
		}
	}

	private release(scope: ProjectScope): void {
		scope.generation += 1;
		scope.ramp.dispose();
		for (const stop of scope.stopWatches.splice(0)) stop();
	}

	private track(work: Promise<void>): void {
		const tracked = work.catch(() => undefined);
		this.pending.add(tracked);
		void tracked.finally(() => this.pending.delete(tracked));
	}

	private notify(): void {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch {
				/* a listener cannot stop scope changes */
			}
		}
	}
}

function within(path: string, root: string): boolean {
	if (root === sep) return true;
	return path === root || path.startsWith(`${root}${sep}`);
}

async function canonicalPath(path: string): Promise<string> {
	return realpath(path);
}

function watchDirectory(
	directory: string,
	onChange: () => void,
): (() => void) | undefined {
	let watcher: FSWatcher;
	try {
		watcher = watchFileSystem(directory, { persistent: false }, onChange);
	} catch {
		return undefined;
	}
	watcher.on('error', () => watcher.close());
	return () => watcher.close();
}

function git(
	root: string,
	args: readonly string[],
): Promise<string | undefined> {
	return new Promise((resolvePromise) => {
		execFile(
			'git',
			['-C', root, ...args],
			{ timeout: 10_000, maxBuffer: 1024 * 1024 },
			(error, stdout) => {
				resolvePromise(error ? undefined : stdout);
			},
		);
	});
}

/** `git worktree list --porcelain` for the repository containing `root`. */
export async function gitWorktrees(
	root: string,
): Promise<ProjectRepositoryWorktrees | undefined> {
	const commonDir = (
		await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
	)?.trim();
	if (commonDir === undefined || commonDir.length === 0) return undefined;
	const listing = await git(root, ['worktree', 'list', '--porcelain']);
	if (listing === undefined) return { commonDir, worktrees: [] };
	return {
		commonDir,
		worktrees: parseWorktreeList(listing)
			.filter((record) => !record.isBare)
			.map((record) => record.path),
	};
}
