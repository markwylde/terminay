import { FolderRootError } from '../folderRoots.js';
import { FileServiceError } from './types.js';

/**
 * Supplies the service context for one folder of a project, for one operation.
 *
 * The host resolves the folder's root through `FolderRootResolver` every time
 * it is called, so a worktree that was removed or replaced since the previous
 * operation is caught here. It may reuse the service object it built for the
 * same canonical root; it must not reuse the resolution (ADR-0050).
 */
export type FolderScopeResolver<Context extends { readonly projectId: string }> =
	(projectId: string, folderId: string, signal?: AbortSignal) => Promise<Context>;

/** Resolve a request's folder to its context, failing closed with a typed
 * file-service error. The caller has already authorized the project. */
export async function resolveFolderScope<
	Context extends { readonly projectId: string },
>(
	resolver: FolderScopeResolver<Context> | undefined,
	projectId: string,
	folderId: string,
	signal?: AbortSignal,
): Promise<Context | undefined> {
	if (resolver === undefined)
		throw new FileServiceError(
			'path_escape',
			'this server does not scope file operations to a folder',
		);
	let context: Context;
	try {
		context = await resolver(projectId, folderId, signal);
	} catch (error) {
		if (!(error instanceof FolderRootError)) throw error;
		// An unknown or foreign folder is an authorization failure. A folder
		// whose worktree has gone is a missing path the user can recover from.
		throw new FileServiceError(
			error.code === 'folder_not_found' ||
				error.code === 'folder_outside_project'
				? 'path_escape'
				: 'path_missing',
			error.message,
		);
	}
	if (context.projectId !== projectId)
		throw new FileServiceError('path_escape', 'folder is outside the project');
	return context;
}

/** Parse a request payload's optional folder id into a request field. */
export function folderIdField(value: unknown): { readonly folderId?: string } {
	if (value === undefined) return {};
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > 128 ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
	)
		throw new FileServiceError('invalid_path', 'folder id is invalid');
	return { folderId: value };
}
