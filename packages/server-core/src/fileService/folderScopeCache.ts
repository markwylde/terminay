import { FolderRootError, type FolderRootResolver } from '../folderRoots.js';
import type { FolderScopeResolver } from './folderScope.js';

export interface FolderScopeCacheOptions<
	Context extends { readonly projectId: string },
> {
	readonly roots: Pick<FolderRootResolver, 'resolve'>;
	/** The project's own context, used for General and plain folders. */
	readonly projectContext: (projectId: string) => Context | undefined;
	/** Build the services for one worktree root. */
	readonly create: (
		projectId: string,
		folderId: string,
		canonicalRoot: string,
	) => Context;
	readonly dispose?: (context: Context) => void;
}

/**
 * Supplies a file adapter's `folderScope`, keeping one set of service objects
 * per linked folder.
 *
 * What is kept is the service object, never the answer to "what is this
 * folder's root": every call asks the root resolver again, and a folder whose
 * root has changed gets new services (ADR-0050). The cache holds at most one
 * entry per linked folder and drops entries through `releaseProject` and
 * `prune`, so it cannot grow past the folders that exist.
 */
export class FolderScopeCache<Context extends { readonly projectId: string }> {
	private readonly entries = new Map<
		string,
		{ readonly projectId: string; readonly root: string; readonly context: Context }
	>();

	constructor(private readonly options: FolderScopeCacheOptions<Context>) {}

	readonly resolve: FolderScopeResolver<Context> = async (
		projectId,
		folderId,
		signal,
	) => {
		const resolved = await this.options.roots.resolve(
			projectId,
			folderId,
			signal,
		);
		if (!resolved.worktree) {
			const context = this.options.projectContext(projectId);
			if (context === undefined)
				throw new FolderRootError(
					'folder_root_unavailable',
					'the project is not available for file operations',
				);
			return context;
		}
		const existing = this.entries.get(folderId);
		if (
			existing !== undefined &&
			existing.projectId === projectId &&
			existing.root === resolved.root
		)
			return existing.context;
		if (existing !== undefined) this.drop(folderId);
		const context = this.options.create(projectId, folderId, resolved.root);
		this.entries.set(folderId, { projectId, root: resolved.root, context });
		return context;
	};

	/** Drop every folder of a project that was closed or released. */
	releaseProject(projectId: string): void {
		for (const [folderId, entry] of [...this.entries])
			if (entry.projectId === projectId) this.drop(folderId);
	}

	/** Drop folders that no longer exist. Call after a workspace change. */
	prune(folderExists: (folderId: string) => boolean): void {
		for (const folderId of [...this.entries.keys()])
			if (!folderExists(folderId)) this.drop(folderId);
	}

	get size(): number {
		return this.entries.size;
	}

	private drop(folderId: string): void {
		const entry = this.entries.get(folderId);
		if (entry === undefined) return;
		this.entries.delete(folderId);
		try {
			this.options.dispose?.(entry.context);
		} catch {
			// Disposal must not turn a lookup or a release into a failure.
		}
	}
}
