const DOCUMENT_PATH = /\.mdx?$/iu;

/** Whether a path names a file the Document view edits. */
export const isDocumentPath = (filePath: string): boolean =>
	DOCUMENT_PATH.test(filePath);

/**
 * Leaves the Document view only once pending edits are on disk. A failed
 * flush keeps the panel on Document; the editor already reports why.
 */
export async function leaveDocumentView(
	flush: () => Promise<boolean>,
): Promise<boolean> {
	try {
		return await flush();
	} catch {
		return false;
	}
}
