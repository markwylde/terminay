import type {
	BrowseRootFoldersResult,
	ProjectStartChoiceDto,
	ProjectStartResult,
	RecentListResult,
} from '@terminay/client-core';
import type { ServerWorkspaceSnapshot } from '../shared/serverWorkspaceReconciliation';

/**
 * How a project created without a root is started (ADR-0066), as the
 * renderer sees it. The server holds the project awaiting a choice; the
 * chooser sends the one `project.start` and then launches the project's first
 * terminal, which the server leaves to the client that chose.
 */

/** Whether the server holds this project awaiting its start choice. */
export function projectAwaitsStartChoice(
	snapshot: ServerWorkspaceSnapshot | null | undefined,
	projectId: string,
): boolean {
	return snapshot?.projects[projectId]?.start === 'awaiting-choice';
}

/** Whether this started project has no root folder: its sidebar panes are
 * inert and its terminals start in the server account's home. */
export function projectHasNoRoot(
	snapshot: ServerWorkspaceSnapshot | null | undefined,
	projectId: string,
): boolean {
	const project = snapshot?.projects[projectId];
	return project?.rootOrigin === 'none' && project.start === undefined;
}

/** The part of the workspace store the chooser and folder browser use. */
export type ProjectStartStore = Readonly<{
	readonly snapshot: ServerWorkspaceSnapshot | null;
	startProject: (
		request: Readonly<{ projectId: string; choice: ProjectStartChoiceDto }>,
	) => Promise<ProjectStartResult>;
	refresh: () => Promise<ServerWorkspaceSnapshot>;
	waitForSnapshot: (
		predicate: (snapshot: ServerWorkspaceSnapshot) => boolean,
		options?: { timeoutMs?: number },
	) => Promise<ServerWorkspaceSnapshot | null>;
	listRecentProjectFolders: () => Promise<RecentListResult>;
	forgetRecentProjectFolder: (path: string) => Promise<unknown>;
	browseRootFolders: (path?: string) => Promise<BrowseRootFoldersResult>;
}>;

export type StartChoiceOutcome =
	| Readonly<{ kind: 'started'; result: ProjectStartResult }>
	/** Another choice won. The store has been refreshed, so the project is
	 * shown as the server holds it. */
	| Readonly<{ kind: 'conflict' }>
	/** The server refused this choice; the project still awaits one. */
	| Readonly<{ kind: 'refused'; message: string }>;

/** The typed reason a start-choice refusal carries, if any. */
export function startRefusalReason(error: unknown): string | undefined {
	for (
		let source = error, depth = 0;
		typeof source === 'object' && source !== null && depth < 4;
		source = (source as { cause?: unknown }).cause, depth += 1
	) {
		const details = (source as { details?: unknown }).details;
		if (
			typeof details === 'object' &&
			details !== null &&
			typeof (details as { reason?: unknown }).reason === 'string'
		)
			return (details as { reason: string }).reason;
	}
	return undefined;
}

const REFUSAL_MESSAGES: Readonly<Record<string, string>> = {
	path_missing: 'That folder does not exist on the server.',
	not_directory: 'That path is not a folder.',
	unreadable: 'The server cannot read that folder.',
	invalid_path: 'That is not a folder path the server accepts.',
	start_conflict: 'This project was already started.',
};

/** Plain copy for a refused start choice or browse, naming why. */
export function startRefusalMessage(error: unknown): string {
	const reason = startRefusalReason(error);
	if (reason !== undefined && REFUSAL_MESSAGES[reason] !== undefined)
		return REFUSAL_MESSAGES[reason];
	return error instanceof Error && error.message.length > 0
		? error.message
		: 'The server refused that choice.';
}

/**
 * Send one start choice. A conflict means another client chose first: the
 * store is refreshed so the project is shown started as the server holds it,
 * and this client launches nothing.
 */
export async function commitStartChoice(
	store: Pick<ProjectStartStore, 'startProject' | 'refresh'>,
	projectId: string,
	choice: ProjectStartChoiceDto,
): Promise<StartChoiceOutcome> {
	try {
		const result = await store.startProject({ projectId, choice });
		return { kind: 'started', result };
	} catch (error) {
		if (startRefusalReason(error) === 'start_conflict') {
			await store.refresh().catch(() => undefined);
			return { kind: 'conflict' };
		}
		return { kind: 'refused', message: startRefusalMessage(error) };
	}
}

/** The last segment of a folder path, as a recent entry is named. */
export function folderName(path: string): string {
	const trimmed = path.replace(/[\\/]+$/u, '');
	if (trimmed.length === 0) return path;
	const segment = trimmed.split(/[\\/]/u).at(-1);
	return segment === undefined || segment.length === 0 ? trimmed : segment;
}

/** A directory inside a folder the server listed. */
export function childFolderPath(parent: string, name: string): string {
	const separator = !parent.includes('/') && parent.includes('\\') ? '\\' : '/';
	return parent.endsWith(separator)
		? `${parent}${name}`
		: `${parent}${separator}${name}`;
}

/**
 * The started project this window already shows whose root is `path`, other
 * than `projectId`. Opening that recent folder shows it instead of starting a
 * second project there. Paths compare as the server canonicalized them.
 */
export function openProjectWithRoot(
	snapshot: ServerWorkspaceSnapshot | null | undefined,
	path: string,
	projectId: string,
	shownProjectIds: Iterable<string>,
): string | undefined {
	if (snapshot === null || snapshot === undefined) return undefined;
	for (const id of shownProjectIds) {
		if (id === projectId) continue;
		const project = snapshot.projects[id];
		if (
			project !== undefined &&
			project.start === undefined &&
			project.rootOrigin !== 'none' &&
			project.root === path
		)
			return id;
	}
	return undefined;
}

/** The recent folders the chooser lists: the server's answer, bounded. */
export type RecentFolderRow = Readonly<{
	path: string;
	name: string;
	available: boolean;
}>;

export function recentFolderRows(
	result: RecentListResult | null,
	limit = 50,
): readonly RecentFolderRow[] {
	if (result === null) return [];
	return result.entries.slice(0, limit).map((entry) => ({
		path: entry.path,
		name: folderName(entry.path),
		available: entry.available,
	}));
}

/**
 * Where an arrow key moves focus among the chooser's controls, in order: the
 * starts, then each recent entry and its Forget. Returns the index to focus,
 * or `null` when the key is not a move.
 */
export function chooserFocusMove(
	key: string,
	index: number,
	count: number,
): number | null {
	if (count === 0) return null;
	switch (key) {
		case 'ArrowDown':
		case 'ArrowRight':
			return index < 0 ? 0 : Math.min(count - 1, index + 1);
		case 'ArrowUp':
		case 'ArrowLeft':
			return index < 0 ? 0 : Math.max(0, index - 1);
		case 'Home':
			return 0;
		case 'End':
			return count - 1;
		default:
			return null;
	}
}
