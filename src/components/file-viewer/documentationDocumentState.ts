const LARGE_FILE_THRESHOLD_BYTES = 100 * 1024 * 1024;

export type DocumentationDocumentReason =
	| 'ready'
	| 'too-large'
	| 'binary'
	| 'invalid-encoding'
	| 'missing'
	| 'unavailable'
	| 'parser-failure'
	| 'not-markdown';

export function documentationDocumentReason(input: {
	readonly path?: string;
	readonly size?: number;
	readonly isBinary?: boolean;
	readonly invalidEncoding?: boolean;
	readonly missing?: boolean;
	readonly authorityAvailable?: boolean;
	readonly parserFailed?: boolean;
}): DocumentationDocumentReason {
	if (input.authorityAvailable === false) return 'unavailable';
	if (input.missing) return 'missing';
	if (input.parserFailed) return 'parser-failure';
	if (!input.path || !/\.mdx?$/iu.test(input.path)) return 'not-markdown';
	if (input.isBinary) return 'binary';
	if (input.invalidEncoding) return 'invalid-encoding';
	if ((input.size ?? 0) > LARGE_FILE_THRESHOLD_BYTES) return 'too-large';
	return 'ready';
}

export function documentationUnsupportedMessage(
	reason: DocumentationDocumentReason,
): string {
	switch (reason) {
		case 'too-large':
			return 'This document is too large for Documentation mode. Open it in the normal File Viewer.';
		case 'binary':
			return 'Binary files cannot be edited in Documentation mode. Open this file in the normal File Viewer.';
		case 'invalid-encoding':
			return 'This document is not valid UTF-8. Open it in the normal File Viewer.';
		case 'missing':
			return 'This document is no longer available at its canonical path.';
		case 'unavailable':
			return 'The file session authority is unavailable. Reconnect to the selected server and retry.';
		case 'parser-failure':
			return 'The editor could not parse this document. Your draft is retained; retry or open the File Viewer.';
		case 'not-markdown':
			return 'Documentation mode requires a Markdown or MDX document. Open this file in the normal File Viewer.';
		case 'ready':
			return '';
	}
}
