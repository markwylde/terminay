import { watch as watchFileSystem } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
	CanonicalProjectPathResolver,
	FileCatalog,
	type FileCatalogProjectContext,
	type FileCatalogStorage,
	type FileContentProjectContext,
	FileContentStreamService,
	type FileProjectContext,
	type FileSessionStorage,
	FolderScopeCache,
} from '../packages/server-core/src/fileService/index';
import type {
	FileObservationFolderContext,
	FileObservationHost,
} from '../packages/server-core/src/fileService/observationAdapter';
import { FolderReconciler } from '../packages/server-core/src/folderReconciler';
import {
	FolderRootResolver,
	type ListedWorktree,
} from '../packages/server-core/src/folderRoots';
import type { GitProtocolAdapterOptions } from '../packages/server-core/src/gitService/adapter';
import type { GitService } from '../packages/server-core/src/gitService/service';
import type {
	WorkspaceApplyResult,
	WorkspaceCommand,
	WorkspaceState,
} from '../packages/server-core/src/workspace';

/**
 * Watches and sizes paths under one root. A project and a linked folder differ
 * only in which root that is, so both are observed through this.
 */
export function fileObservationHostForRoot(
	rootOf: (projectId: string) => string | undefined,
): FileObservationHost {
	return {
		watch: async ({ projectId, resource, signal, publish }) => {
			const root = rootOf(projectId);
			if (root === undefined)
				throw new Error('file observation project is unavailable');
			const target = resolve(root, resource);
			const targetStats = await stat(target);
			const watchedDirectory = targetStats.isDirectory()
				? target
				: dirname(target);
			const watchedName = targetStats.isDirectory() ? null : basename(target);
			const watcher = watchFileSystem(
				watchedDirectory,
				{ persistent: false },
				(eventType, entryName) => {
					if (
						watchedName !== null &&
						entryName !== null &&
						String(entryName) !== watchedName
					)
						return;
					publish({
						resource,
						kind: eventType === 'rename' ? 'renamed' : 'changed',
						...(entryName === null
							? {}
							: { relatedResource: String(entryName) }),
					});
				},
			);
			let unavailablePublished = false;
			const publishUnavailable = () => {
				if (signal.aborted || unavailablePublished) return;
				unavailablePublished = true;
				publish({ resource, kind: 'unavailable' });
			};
			watcher.once('error', publishUnavailable);
			watcher.once('close', publishUnavailable);
			signal.addEventListener('abort', () => watcher.close(), {
				once: true,
			});
		},
		calculateFolderSize: async ({ projectId, resource, signal, progress }) => {
			const root = rootOf(projectId);
			if (root === undefined)
				throw new Error('folder-size project is unavailable');
			let bytes = 0;
			let files = 0;
			let directories = 0;
			const visit = async (directory: string): Promise<void> => {
				if (signal.aborted) throw signal.reason;
				directories += 1;
				for (const entry of await readdir(directory, {
					withFileTypes: true,
				})) {
					if (signal.aborted) throw signal.reason;
					const path = resolve(directory, entry.name);
					if (entry.isDirectory()) await visit(path);
					else if (entry.isFile()) {
						files += 1;
						bytes += (await stat(path)).size;
					}
					progress({ bytes, files, directories });
				}
			};
			await visit(resolve(root, resource));
			return { bytes, files, directories };
		},
	};
}

/** Resolve symlinks and require a directory. */
async function canonicalDirectory(path: string): Promise<string> {
	const canonical = await realpath(path);
	if (!(await stat(canonical)).isDirectory())
		throw new Error('path is not a directory');
	return canonical;
}

export interface ServerFoldersOptions {
	readonly workspace: () => WorkspaceState;
	/** The Git service's maintained listing and its change events. */
	readonly git: Pick<GitService, 'worktrees' | 'subscribe'>;
	/** The workspace operation registry's host command entry point. It is read
	 * on each call because the registry is composed after this object. */
	readonly applyHostCommand: (
		commandId: string,
		command: WorkspaceCommand,
	) => WorkspaceApplyResult | undefined;
	readonly storage: FileCatalogStorage & FileSessionStorage;
	/** The contexts the host already keeps per project, which General and plain
	 * folders use unchanged. */
	readonly projects: {
		readonly catalog: (projectId: string) => FileCatalogProjectContext | undefined;
		readonly content: (projectId: string) => FileContentProjectContext | undefined;
		readonly session: (projectId: string) => FileProjectContext | undefined;
		readonly observation: (
			projectId: string,
		) => FileObservationFolderContext | undefined;
	};
}

/**
 * Everything the embedded server keeps so that a project's folders reach its
 * repository's worktrees: the root resolver, the per-folder file services, and
 * the reconciler that keeps one linked folder per worktree (ADR-0050).
 *
 * It starts no timer and no filesystem watcher. The reconciler runs when the
 * host says a project was bound and when the Git service, from the registry
 * watch it already holds, reports a change (ADR-0028).
 */
export class ServerFolders {
	readonly roots: FolderRootResolver;
	readonly reconciler: FolderReconciler;
	readonly catalog: FolderScopeCache<FileCatalogProjectContext>;
	readonly content: FolderScopeCache<FileContentProjectContext>;
	readonly session: FolderScopeCache<FileProjectContext>;
	readonly observation: FolderScopeCache<FileObservationFolderContext>;
	private readonly unsubscribeGit: () => void;

	constructor(private readonly options: ServerFoldersOptions) {
		const { git, storage, projects } = options;
		const listed = async (
			projectId: string,
			signal?: AbortSignal,
		): Promise<{ state: string; worktrees: ListedWorktree[] }> => {
			const listing = await git.worktrees(projectId, signal);
			return {
				state: listing.state,
				worktrees: listing.worktrees.map((worktree) => ({
					repositoryId: worktree.repositoryId,
					path: worktree.path,
					isBare: worktree.isBare,
					isPrunable: worktree.isPrunable,
				})),
			};
		};
		this.roots = new FolderRootResolver({
			workspace: options.workspace,
			worktrees: async (projectId, signal) =>
				(await listed(projectId, signal)).worktrees,
			canonicalize: canonicalDirectory,
		});
		const resolver = (root: string) =>
			new CanonicalProjectPathResolver(root, storage);
		this.catalog = new FolderScopeCache({
			roots: this.roots,
			projectContext: projects.catalog,
			create: (projectId, _folderId, root) => ({
				projectId,
				catalog: new FileCatalog(resolver(root), storage),
			}),
		});
		this.content = new FolderScopeCache({
			roots: this.roots,
			projectContext: projects.content,
			create: (projectId, _folderId, root) => ({
				projectId,
				content: new FileContentStreamService(resolver(root), storage),
			}),
		});
		this.session = new FolderScopeCache({
			roots: this.roots,
			projectContext: projects.session,
			create: (projectId, _folderId, root) => ({
				projectId,
				resolver: resolver(root),
				storage,
			}),
		});
		this.observation = new FolderScopeCache({
			roots: this.roots,
			projectContext: projects.observation,
			create: (projectId, _folderId, root) => ({
				projectId,
				host: fileObservationHostForRoot(() => root),
			}),
		});
		this.reconciler = new FolderReconciler({
			workspace: options.workspace,
			apply: (commandId, command) => {
				const applied = options.applyHostCommand(commandId, command);
				if (applied === undefined)
					throw new Error('workspace operation registry is unavailable');
				return applied;
			},
			worktrees: (projectId) => listed(projectId),
			canonicalRoot: (root) => realpath(root).catch(() => null),
		});
		this.unsubscribeGit = git.subscribe((event) => {
			if (event.type === 'git.status.changed')
				void this.reconciler.reconcile(event.projectId);
		});
	}

	/** A project was bound to Git, or bound again at a new root. */
	projectBound(projectId: string): void {
		void this.reconciler.reconcile(projectId);
	}

	projectReleased(projectId: string): void {
		this.reconciler.release(projectId);
		for (const cache of this.caches()) cache.releaseProject(projectId);
	}

	/** Drop the services of folders the workspace no longer has. */
	workspaceChanged(): void {
		const { folders } = this.options.workspace();
		for (const cache of this.caches())
			if (cache.size > 0)
				cache.prune((folderId) => folders[folderId] !== undefined);
	}

	/** Keeps a worktree's folder through a rename or move made by Terminay. */
	readonly onWorktreeMove: NonNullable<
		GitProtocolAdapterOptions['onWorktreeMove']
	> = ({ projectId, repositoryId, fromPath }) => {
		const resume = this.reconciler.suspend(projectId);
		return (toPath) => {
			if (fromPath !== null && toPath !== null)
				this.reconciler.relink(projectId, repositoryId, fromPath, toPath);
			resume();
		};
	};

	dispose(): void {
		this.unsubscribeGit();
	}

	private caches() {
		return [this.catalog, this.content, this.session, this.observation];
	}
}
