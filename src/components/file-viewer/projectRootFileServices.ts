/**
 * Which file-panel services a folder may use.
 *
 * The MDX runtime and language intelligence are bound to the project root on
 * the server (ADR-0050 leaves moving them to a later change). A file panel of
 * a linked folder names its file relative to that folder's worktree, so
 * handing the same relative path to one of those services would render or
 * analyse the main checkout's file of that name while the panel showed the
 * worktree's. Wrong content under the right title is worse than a plainer
 * panel, so a linked folder's file panels use neither. Editing, including the
 * Document view, goes through the folder's own file client and is unaffected.
 *
 * This is the one place that says so. General and plain folders are rooted at
 * the project root and are unaffected.
 */

export type ProjectRootFileServices = {
	/** The live MDX preview, and running MDX components in the Document view. */
	mdxPreview: boolean;
	/** Diagnostics, completion, and navigation from a language server. */
	languageIntelligence: boolean;
};

const ALL: ProjectRootFileServices = Object.freeze({
	mdxPreview: true,
	languageIntelligence: true,
});
const NONE: ProjectRootFileServices = Object.freeze({
	mdxPreview: false,
	languageIntelligence: false,
});

/** `linkedFolderId` is the linked folder a panel belongs to, if it is in one. */
export function projectRootFileServices(
	linkedFolderId: string | undefined,
): ProjectRootFileServices {
	return linkedFolderId === undefined ? ALL : NONE;
}
