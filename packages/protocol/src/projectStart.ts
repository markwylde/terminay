/**
 * Starting a project created without a root, and choosing a project root on
 * the server that will own it (ADR-0066).
 *
 * A connection that negotiated `project-start-choice.v1` gets a project that
 * waits for a start choice when it creates one without a root. The choice is
 * one `project.start` command. The server keeps its own recent project
 * folders, and browses its own directory names for a root, so every client
 * host picks a root on the right machine.
 */

/** Stable protocol names for the start-choice surface. */
export const PROJECT_START_OPERATIONS = Object.freeze({
	/** Command: the first start choice for a project awaiting one. */
	start: 'project.start',
	/** Query: the server's recent project folders, with availability. */
	recentList: 'recent.list',
	/** Command: drop one folder from the server's recent project folders. */
	recentForget: 'recent.forget',
	/** Query: the directory names of one folder on the server. */
	browseRootFolders: 'fs.browseRootFolders',
} as const);

/** Most recent project folders a server keeps. */
export const MAX_RECENT_PROJECT_FOLDERS = 50;
/** Most directory names one `fs.browseRootFolders` answer carries. */
export const MAX_BROWSE_ROOT_FOLDER_ENTRIES = 1000;
const MAX_PATH_CHARS = 4096;
const MAX_NAME_CHARS = 1024;

/**
 * Why a start-choice operation was refused, carried in the protocol error's
 * `details.reason`:
 *
 * - `start_conflict`: the project already started (another choice won).
 * - `no_project_root`: the project has no root folder, so a filesystem, Git,
 *   watch, or Documentation operation has nothing to act on.
 * - `path_missing`, `not_directory`, `unreadable`, `invalid_path`: the folder
 *   named cannot be used.
 */
export const PROJECT_START_REFUSALS = Object.freeze({
	startConflict: 'start_conflict',
	noProjectRoot: 'no_project_root',
	pathMissing: 'path_missing',
	notDirectory: 'not_directory',
	unreadable: 'unreadable',
	invalidPath: 'invalid_path',
} as const);
export type ProjectStartRefusal =
	(typeof PROJECT_START_REFUSALS)[keyof typeof PROJECT_START_REFUSALS];

export type ProjectStartChoiceDto =
	| { readonly kind: 'folder'; readonly path: string }
	| { readonly kind: 'home' };

export interface ProjectStartRequest {
	readonly projectId: string;
	readonly choice: ProjectStartChoiceDto;
}

export interface ProjectStartResult {
	readonly projectId: string;
	/** The canonical root, or empty for a project with no root folder. */
	readonly root: string;
	readonly rootOrigin: 'explicit' | 'none';
	readonly revision: number;
	readonly cursor: string;
}

export interface RecentProjectFolderEntry {
	readonly path: string;
	readonly usedAt: number;
	/** Whether the folder exists as a directory now, checked for this answer. */
	readonly available: boolean;
}

export interface RecentListResult {
	readonly revision: number;
	readonly entries: readonly RecentProjectFolderEntry[];
}

export interface RecentForgetRequest {
	readonly path: string;
}

export interface RecentForgetResult {
	readonly forgotten: boolean;
	readonly revision: number;
	readonly cursor: string;
}

export interface BrowseRootFoldersRequest {
	/** Absent means the server account's home directory. */
	readonly path?: string;
}

export interface BrowseRootFoldersResult {
	/** The canonical folder listed. */
	readonly path: string;
	/** Its canonical parent; absent at a filesystem root. */
	readonly parent?: string;
	/** Names of its subdirectories, sorted, at most the bound. */
	readonly entries: readonly { readonly name: string }[];
	/** More directories exist than were returned. */
	readonly truncated: boolean;
}

export function parseProjectStartRequest(value: unknown): ProjectStartRequest {
	if (!isRecord(value) || !isProjectId(value.projectId))
		throw new TypeError('project start request is invalid');
	return { projectId: value.projectId, choice: parseChoice(value.choice) };
}

function parseChoice(value: unknown): ProjectStartChoiceDto {
	if (!isRecord(value)) throw new TypeError('project start choice is invalid');
	if (value.kind === 'home' && onlyKeys(value, ['kind']))
		return { kind: 'home' };
	if (
		value.kind === 'folder' &&
		onlyKeys(value, ['kind', 'path']) &&
		isPath(value.path)
	)
		return { kind: 'folder', path: value.path };
	throw new TypeError('project start choice is invalid');
}

export function parseProjectStartResult(value: unknown): ProjectStartResult {
	if (
		!isRecord(value) ||
		!isProjectId(value.projectId) ||
		typeof value.root !== 'string' ||
		!(
			(value.rootOrigin === 'none' && value.root === '') ||
			(value.rootOrigin === 'explicit' && isPath(value.root))
		) ||
		!isRevision(value.revision) ||
		value.cursor !== String(value.revision)
	)
		throw new TypeError('project start result is invalid');
	return value as unknown as ProjectStartResult;
}

export function parseRecentForgetRequest(value: unknown): RecentForgetRequest {
	if (!isRecord(value) || !onlyKeys(value, ['path']) || !isPath(value.path))
		throw new TypeError('recent folder request is invalid');
	return { path: value.path };
}

export function parseRecentListResult(value: unknown): RecentListResult {
	if (
		!isRecord(value) ||
		!isRevision(value.revision) ||
		!Array.isArray(value.entries) ||
		value.entries.length > MAX_RECENT_PROJECT_FOLDERS
	)
		throw new TypeError('recent folders result is invalid');
	const seen = new Set<string>();
	for (const entry of value.entries) {
		if (
			!isRecord(entry) ||
			!isPath(entry.path) ||
			!isRevision(entry.usedAt) ||
			typeof entry.available !== 'boolean' ||
			seen.has(entry.path)
		)
			throw new TypeError('recent folders result is invalid');
		seen.add(entry.path);
	}
	return value as unknown as RecentListResult;
}

export function parseBrowseRootFoldersRequest(
	value: unknown,
): BrowseRootFoldersRequest {
	if (value === undefined || value === null) return {};
	if (!isRecord(value) || !onlyKeys(value, ['path']))
		throw new TypeError('folder browse request is invalid');
	if (value.path === undefined) return {};
	if (!isPath(value.path))
		throw new TypeError('folder browse request is invalid');
	return { path: value.path };
}

export function parseBrowseRootFoldersResult(
	value: unknown,
): BrowseRootFoldersResult {
	if (
		!isRecord(value) ||
		!isPath(value.path) ||
		(value.parent !== undefined && !isPath(value.parent)) ||
		typeof value.truncated !== 'boolean' ||
		!Array.isArray(value.entries) ||
		value.entries.length > MAX_BROWSE_ROOT_FOLDER_ENTRIES ||
		value.entries.some(
			(entry) =>
				!isRecord(entry) ||
				!onlyKeys(entry, ['name']) ||
				!isEntryName(entry.name),
		)
	)
		throw new TypeError('folder browse result is invalid');
	return value as unknown as BrowseRootFoldersResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function onlyKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	return Object.keys(value).every((key) => keys.includes(key));
}
function isProjectId(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
	);
}
function isPath(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAX_PATH_CHARS &&
		!value.includes('\0')
	);
}
function isEntryName(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAX_NAME_CHARS &&
		value !== '.' &&
		value !== '..' &&
		!value.includes('\0') &&
		!value.includes('/')
	);
}
function isRevision(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
