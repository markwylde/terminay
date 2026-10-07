/**
 * Which file-panel services a folder may use.
 *
 * Documentation, the MDX runtime, and language intelligence are bound to the
 * project root on the server (ADR-0050 leaves moving them to a later change).
 * A file panel of a linked folder names its file relative to that folder's
 * worktree, so handing the same relative path to one of those services would
 * read, render, or analyse the main checkout's file of that name while the
 * panel showed the worktree's. Wrong content under the right title is worse
 * than a plainer panel, so a linked folder's file panels use none of them.
 *
 * This is the one place that says so. General and plain folders are rooted at
 * the project root and are unaffected.
 */

import type { FilePresentation } from './openFilePresentation.ts';

export type ProjectRootFileServices = {
	/** The Documentation presentation, and the action that switches to it. */
	documentation: boolean;
	/** The live MDX preview. */
	mdxPreview: boolean;
	/** Diagnostics, completion, and navigation from a language server. */
	languageIntelligence: boolean;
};

const ALL: ProjectRootFileServices = Object.freeze({
	documentation: true,
	mdxPreview: true,
	languageIntelligence: true,
});
const NONE: ProjectRootFileServices = Object.freeze({
	documentation: false,
	mdxPreview: false,
	languageIntelligence: false,
});

/** `linkedFolderId` is the linked folder a panel belongs to, if it is in one. */
export function projectRootFileServices(
	linkedFolderId: string | undefined,
): ProjectRootFileServices {
	return linkedFolderId === undefined ? ALL : NONE;
}

/**
 * The presentation a file panel actually shows. A request for Documentation
 * in a linked folder, whether from a link, the Documentation pane, or a panel
 * carried over from another folder, lands in the plain file viewer.
 */
export function presentationForFolder<
	Presentation extends FilePresentation | undefined,
>(
	presentation: Presentation,
	linkedFolderId: string | undefined,
): Presentation | 'file-viewer' {
	return presentation === 'documentation' &&
		!projectRootFileServices(linkedFolderId).documentation
		? 'file-viewer'
		: presentation;
}
