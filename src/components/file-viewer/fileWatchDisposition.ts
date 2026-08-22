import type { FileWatchEvent } from '../../types/fileViewer';

export type AcknowledgedFileWatchRevision = Readonly<{
	mtimeMs: number | null;
	path: string;
	size: number;
}>;

const MAX_DOCUMENTATION_ACKNOWLEDGED_REVISIONS = 4;

function sameRevision(
	left: AcknowledgedFileWatchRevision,
	right: AcknowledgedFileWatchRevision,
): boolean {
	return (
		left.path === right.path &&
		left.mtimeMs === right.mtimeMs &&
		left.size === right.size
	);
}

export function retainDocumentationAcknowledgedRevision(
	revisions: readonly AcknowledgedFileWatchRevision[],
	revision: AcknowledgedFileWatchRevision,
): readonly AcknowledgedFileWatchRevision[] {
	return [
		...revisions.filter((candidate) => !sameRevision(candidate, revision)),
		revision,
	].slice(-MAX_DOCUMENTATION_ACKNOWLEDGED_REVISIONS);
}

export function isDocumentationAcknowledgedWatchEvent(
	revisions: readonly AcknowledgedFileWatchRevision[],
	event: FileWatchEvent,
): boolean {
	return revisions.some((revision) =>
		sameRevision(revision, {
			mtimeMs: event.mtimeMs,
			path: event.path,
			size: event.size,
		}),
	);
}

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
