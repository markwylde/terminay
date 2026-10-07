import { realpath, stat } from 'node:fs/promises';
import {
	CanonicalProjectPathResolver,
	FileCatalog,
	FileContentStreamService,
	type FileObservationHost,
	type FileProjectContext,
	FolderReconciler,
	FolderRootResolver,
	FolderScopeCache,
	type GitService,
	type ServerGitAdapter,
	type WorkspaceApplyResult,
	type WorkspaceCommand,
	type WorkspaceStore,
} from '@terminay/server-core';

/** The one storage object the standalone server builds every file service on. */
export type StandaloneFileStorage = CanonicalProjectPathResolver['adapter'] &
	ConstructorParameters<typeof FileContentStreamService>[1] &
	ConstructorParameters<typeof FileCatalog>[1] &
	FileProjectContext['storage'];

/** Everything the four file adapters need for one root. */
export interface FolderFileContext {
	readonly projectId: string;
	readonly resolver: CanonicalProjectPathResolver;
	readonly storage: FileProjectContext['storage'];
	readonly content: FileContentStreamService;
	readonly catalog: FileCatalog;
	readonly host: FileObservationHost;
}

export interface StandaloneFoldersOptions {
	readonly workspace: Pick<WorkspaceStore, 'state' | 'subscribe'>;
	readonly git: Pick<GitService, 'worktrees' | 'subscribe'>;
	/** The workspace operation registry's host command entry. It is composed
	 * after this, so it may be unavailable when first asked. */
	readonly applyHostCommand: (
		commandId: string,
		command: WorkspaceCommand,
	) => WorkspaceApplyResult | undefined;
	readonly onError?: (projectId: string, error: unknown) => void;
}

export interface StandaloneFolders {
	readonly roots: FolderRootResolver;
	readonly reconciler: FolderReconciler;
	/** Call when a project has been bound to Git. */
	readonly projectBound: (projectId: string) => void;
	readonly releaseProject: (projectId: string) => void;
	readonly onWorktreeMove: NonNullable<
		ConstructorParameters<typeof ServerGitAdapter>[0]['onWorktreeMove']
	>;
	readonly close: () => void;
}

/**
 * Folder roots and the worktree folder reconciler for the standalone server.
 *
 * Both read the listing the Git service already maintains, and the reconciler
 * runs only when the host says a project was bound or the Git service reports
 * a change for it. Nothing here starts a timer or a watcher (ADR-0028).
 */
export function createStandaloneFolders(
	options: StandaloneFoldersOptions,
): StandaloneFolders {
	const roots = new FolderRootResolver({
		workspace: () => options.workspace.state,
		worktrees: async (projectId, signal) =>
			(await options.git.worktrees(projectId, signal)).worktrees.map(
				(worktree) => ({
					repositoryId: worktree.repositoryId,
					path: worktree.path,
					isBare: worktree.isBare,
					isPrunable: worktree.isPrunable,
				}),
			),
		canonicalize: async (path) => {
			const canonical = await realpath(path);
			if (!(await stat(canonical)).isDirectory())
				throw new Error('folder root is not a directory');
			return canonical;
		},
	});
	const reconciler = new FolderReconciler({
		workspace: () => options.workspace.state,
		apply: (commandId, command) => {
			const applied = options.applyHostCommand(commandId, command);
			if (applied === undefined)
				throw new Error('workspace host commands are unavailable');
			return applied;
		},
		worktrees: async (projectId) => {
			const listing = await options.git.worktrees(projectId);
			return { state: listing.state, worktrees: listing.worktrees };
		},
		canonicalRoot: (root) => realpath(root).catch(() => null),
		...(options.onError === undefined ? {} : { onError: options.onError }),
	});
	const reconcile = (projectId: string): void => {
		void reconciler.reconcile(projectId);
	};
	// The registry watch the Git service already holds is the only source of
	// "a worktree was added or removed"; it surfaces as a status change.
	const unsubscribe = options.git.subscribe((event) => {
		if (event.type === 'git.status.changed') reconcile(event.projectId);
	});
	return {
		roots,
		reconciler,
		projectBound: reconcile,
		releaseProject: (projectId) => reconciler.release(projectId),
		onWorktreeMove: ({ projectId, repositoryId, fromPath }) => {
			const resume = reconciler.suspend(projectId);
			return (toPath) => {
				if (fromPath !== null && toPath !== null)
					reconciler.relink(projectId, repositoryId, fromPath, toPath);
				resume();
			};
		},
		close: () => {
			unsubscribe();
		},
	};
}

export interface FolderFileScopeOptions {
	readonly roots: Pick<FolderRootResolver, 'resolve'>;
	readonly workspace: Pick<WorkspaceStore, 'state' | 'subscribe'>;
	readonly storage: StandaloneFileStorage;
	/** The project's own services, used for General and plain folders. */
	readonly projectContext: (projectId: string) => FolderFileContext | undefined;
	/** Builds the observation host for one root, as the project's is built. */
	readonly observationHost: (
		projects: ReadonlyMap<
			string,
			{ readonly resolver: CanonicalProjectPathResolver }
		>,
	) => FileObservationHost;
}

/**
 * The `folderScope` of the four file adapters: per-root services built the way
 * the per-project ones are, kept one per linked folder, and dropped when the
 * folder goes. Each call still resolves the folder's root afresh (ADR-0050).
 */
export function createFolderFileScope(
	options: FolderFileScopeOptions,
): FolderScopeCache<FolderFileContext> {
	const { storage } = options;
	const cache = new FolderScopeCache<FolderFileContext>({
		roots: options.roots,
		projectContext: options.projectContext,
		create: (projectId, _folderId, canonicalRoot) => {
			const resolver = new CanonicalProjectPathResolver(canonicalRoot, storage);
			return {
				projectId,
				resolver,
				storage,
				content: new FileContentStreamService(resolver, storage),
				catalog: new FileCatalog(resolver, storage),
				host: options.observationHost(new Map([[projectId, { resolver }]])),
			};
		},
	});
	options.workspace.subscribe(() => {
		if (cache.size === 0) return;
		const { folders } = options.workspace.state;
		cache.prune((folderId) => folders[folderId] !== undefined);
	});
	return cache;
}
