import type { FileWatchEvent } from '../../types/fileViewer';

export type AcknowledgedFileWatchRevision = Readonly<{
	mtimeMs: number | null;
	path: string;
	size: number;
}>;

export function resolveFileWatchDisposition(
	options: Readonly<{
		acknowledgedRevision: AcknowledgedFileWatchRevision | null;
		event: FileWatchEvent;
		isDirty: boolean;
	}>,
): 'acknowledged-write' | 'external-conflict' | 'refresh' {
	const { acknowledgedRevision, event } = options;
	if (
		acknowledgedRevision &&
		acknowledgedRevision.path === event.path &&
		acknowledgedRevision.mtimeMs === event.mtimeMs &&
		acknowledgedRevision.size === event.size
	) {
		return 'acknowledged-write';
	}
	return options.isDirty ? 'external-conflict' : 'refresh';
}
