export type FilePresentation = 'file-viewer' | 'documentation';

export type OpenFilePresentationRequest = {
	initialMode?: unknown;
	presentation?: FilePresentation;
};

const DOCUMENT_PATH = /\.mdx?$/iu;

export const isDocumentPath = (filePath: string): boolean =>
	DOCUMENT_PATH.test(filePath);

/**
 * The presentation a file open should land in. The file type and the requested
 * mode decide it, never the surface that asked. `undefined` means an existing
 * panel keeps whatever presentation it already has.
 */
export function resolveOpenPresentation(
	filePath: string,
	request: OpenFilePresentationRequest | undefined,
	existingPresentation?: FilePresentation,
): FilePresentation | undefined {
	if (request?.presentation) return request.presentation;
	if (request?.initialMode) return 'file-viewer';
	if (existingPresentation) return undefined;
	return isDocumentPath(filePath) ? 'documentation' : 'file-viewer';
}

/**
 * Leaves the Documentation presentation only once pending edits are on disk.
 * A failed flush keeps the panel where it is; the editor's status bar already
 * reports why.
 */
export async function viewDocumentSource(
	flush: () => Promise<boolean>,
	switchToFileViewer: () => void,
): Promise<boolean> {
	let flushed: boolean;
	try {
		flushed = await flush();
	} catch {
		flushed = false;
	}
	if (flushed) switchToFileViewer();
	return flushed;
}
