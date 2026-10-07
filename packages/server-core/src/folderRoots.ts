import type { WorkspaceFolder, WorkspaceState } from './workspace.js';

export type FolderRootErrorCode =
	| 'folder_not_found'
	| 'folder_outside_project'
	| 'folder_worktree_unregistered'
	| 'folder_root_unavailable';

/** A folder could not be turned into a root. The operation that asked fails
 * closed; it never falls back to the project root (ADR-0050). */
export class FolderRootError extends Error {
	constructor(
		readonly code: FolderRootErrorCode,
		message: string,
		options: { readonly cause?: unknown } = {},
	) {
		super(
			message,
			options.cause === undefined ? undefined : { cause: options.cause },
		);
		this.name = 'FolderRootError';
	}
}

export interface FolderRoot {
	readonly projectId: string;
	readonly folderId: string;
	/** Canonical for a worktree. For General and plain folders this is the
	 * project's configured root, which the project's own resolver canonicalizes. */
	readonly root: string;
	/** True when the root is a linked folder's worktree, not the project root. */
	readonly worktree: boolean;
}

/** One row of the server's own worktree listing for a project's repository. */
export interface ListedWorktree {
	/** The Git service's id for the worktree, when the caller has it. */
	readonly id?: string;
	readonly repositoryId: string;
	readonly path: string;
	readonly isBare?: boolean;
	readonly isPrunable?: boolean;
}

export interface FolderRootResolverOptions {
	readonly workspace: () => Pick<WorkspaceState, 'projects' | 'folders'>;
	/** The listing the Git service maintains from its registry watch. Reading it
	 * must not cost a Git process per call. */
	readonly worktrees: (
		projectId: string,
		signal?: AbortSignal,
	) => Promise<readonly ListedWorktree[]>;
	/** Resolve symlinks and confirm the path is a directory. */
	readonly canonicalize: (path: string) => Promise<string>;
}

/**
 * Turns a folder a request names by id into the root its operation is contained
 * in. The server chooses that root; a client supplies only ids.
 *
 * Nothing is remembered between calls. Each operation resolves its folder once,
 * at its start, and threads the result through, exactly as ADR-0020 requires of
 * the project root: a worktree removed, moved, or replaced between two
 * operations is caught by the next one.
 */
export class FolderRootResolver {
	constructor(private readonly options: FolderRootResolverOptions) {}

	async resolve(
		projectId: string,
		folderId: string,
		signal?: AbortSignal,
	): Promise<FolderRoot> {
		const state = this.options.workspace();
		const project = state.projects[projectId];
		const folder: WorkspaceFolder | undefined = state.folders[folderId];
		if (project === undefined || folder === undefined)
			throw new FolderRootError('folder_not_found', 'folder was not found');
		if (
			folder.projectId !== projectId ||
			!project.folderIds.includes(folderId)
		)
			throw new FolderRootError(
				'folder_outside_project',
				'folder belongs to another project',
			);
		if (folder.worktree === undefined)
			return { projectId, folderId, root: project.root, worktree: false };

		const link = folder.worktree;
		let listed: readonly ListedWorktree[];
		try {
			listed = await this.options.worktrees(projectId, signal);
		} catch (cause) {
			throw new FolderRootError(
				'folder_root_unavailable',
				'the worktree listing is unavailable',
				{ cause },
			);
		}
		const row = listed.find(
			(candidate) =>
				candidate.repositoryId === link.repositoryId &&
				candidate.path === link.path,
		);
		if (row === undefined || row.isBare === true || row.isPrunable === true)
			throw new FolderRootError(
				'folder_worktree_unregistered',
				'the folder worktree is no longer registered',
			);
		let canonical: string;
		try {
			canonical = await this.options.canonicalize(link.path);
		} catch (cause) {
			throw new FolderRootError(
				'folder_root_unavailable',
				'the folder worktree is not an accessible directory',
				{ cause },
			);
		}
		// The listing holds canonical paths. A link whose path now resolves
		// somewhere else has been replaced since it was listed.
		if (canonical !== row.path)
			throw new FolderRootError(
				'folder_worktree_unregistered',
				'the folder worktree path no longer resolves to the registered worktree',
			);
		return { projectId, folderId, root: canonical, worktree: true };
	}
}
