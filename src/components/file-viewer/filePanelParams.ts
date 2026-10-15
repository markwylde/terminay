import type { FileViewerMode } from '../../types/fileViewer.ts';
import type { FilePanelInstanceParams } from './types.ts';

/**
 * Panel params as a file panel reads them. A panel saved while rich editing
 * was a separate presentation carries `presentation: 'documentation'`; it
 * restores on the Document view, and the retired field is not written back.
 */
export function normalizeFilePanelParams<
	Params extends FilePanelInstanceParams & { presentation?: unknown },
>(params: Params): Omit<Params, 'presentation'> & Pick<FilePanelInstanceParams, 'initialMode'> {
	if (!('presentation' in params)) return params;
	const { presentation, ...rest } = params;
	const initialMode: FileViewerMode | undefined =
		rest.initialMode ?? (presentation === 'documentation' ? 'document' : undefined);
	return initialMode === undefined ? rest : { ...rest, initialMode };
}
