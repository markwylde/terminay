import type { ControlError, ControlRequestContext } from './controlEndpoint.js';

/**
 * The MCP tools that read and change the view of the client an agent is
 * talking from (ADR-0070). Parsing lives here; the binding to the relay and
 * the workspace lives in workspaceViewAdapter.ts, which loads server-core.
 */

export type ViewPosition = 'right' | 'left' | 'above' | 'below' | 'center';
export type TabArrangement = 'grid' | 'columns' | 'rows' | 'tabs';

/** A tab: a terminal handle, or a tab id from a layout. */
export type TabRef = string;

export interface GetLayoutParams {
	readonly project?: string;
}
export interface FocusTabParams {
	readonly tab: TabRef;
}
export interface MoveTabParams {
	readonly tab: TabRef;
	readonly beside: TabRef;
	readonly position: ViewPosition;
}
export interface ResizePaneParams {
	readonly tab: TabRef;
	readonly width?: number;
	readonly height?: number;
}
export interface ArrangeTabsParams {
	readonly arrangement: TabArrangement;
	readonly tabs?: readonly TabRef[];
	readonly project?: string;
}
export interface FocusProjectParams {
	readonly project: string;
}
export interface SelectFolderParams {
	readonly folder: string;
}
export interface CreateFolderParams {
	readonly name: string;
	readonly project?: string;
}
export interface RenameFolderParams {
	readonly folder: string;
	readonly name: string;
}
export interface DeleteFolderParams {
	readonly folder: string;
}
export interface ReorderFoldersParams {
	/** Every folder of one project, in the new order. */
	readonly folders: readonly string[];
}
export type HomeSection = 'home' | 'tabs' | 'automations';
export interface FocusHomeParams {
	readonly section?: HomeSection;
}
export interface MoveTabToFolderParams {
	readonly tab: TabRef;
	readonly folder: string;
}
export interface OpenFileParams {
	readonly path: string;
	readonly project?: string;
}
export interface CloseTabParams {
	readonly tab: TabRef;
}
/** Where a terminal just opened goes, on the agent's client. */
export interface PlaceTerminalParams {
	/** The terminal to place. */
	readonly terminal: string;
	/** The tab it goes beside; absent places nothing and only focuses. */
	readonly beside?: TabRef;
	readonly position?: ViewPosition;
	readonly focus: boolean;
}

type Failure = { readonly ok: false; readonly error: ControlError };
type Parsed<T> = T | Failure;
type Handler<P> = (
	params: P,
	context: ControlRequestContext,
	signal: AbortSignal,
) => unknown | Promise<unknown>;

/** Host binding for the view tools; each method is already past the MCP
 * permission gate when it is called. */
export interface WorkspaceViewControlAdapter {
	readonly getLayout: Handler<GetLayoutParams>;
	readonly focusTab: Handler<FocusTabParams>;
	readonly moveTab: Handler<MoveTabParams>;
	readonly resizePane: Handler<ResizePaneParams>;
	readonly arrangeTabs: Handler<ArrangeTabsParams>;
	readonly focusProject: Handler<FocusProjectParams>;
	readonly selectFolder: Handler<SelectFolderParams>;
	readonly createFolder: Handler<CreateFolderParams>;
	readonly renameFolder: Handler<RenameFolderParams>;
	readonly deleteFolder: Handler<DeleteFolderParams>;
	readonly reorderFolders: Handler<ReorderFoldersParams>;
	readonly focusHome: Handler<FocusHomeParams>;
	readonly moveTabToFolder: Handler<MoveTabToFolderParams>;
	readonly openFile: Handler<OpenFileParams>;
	readonly closeTab: Handler<CloseTabParams>;
	/**
	 * Before a terminal opens: the project and the tab a placed or focused
	 * terminal is anchored to. `beside` defaults to the calling terminal, or
	 * for a chat to the tab in front on its client. The project is the
	 * anchor's, as a handle, when the caller has workspace reach and named
	 * none.
	 */
	readonly anchorFor: (
		request: {
			readonly beside?: TabRef;
			readonly project?: string;
			readonly placing: boolean;
		},
		context: ControlRequestContext,
		signal: AbortSignal,
	) => Promise<{ readonly beside?: TabRef; readonly project?: string }>;
	/** After a terminal opens: place and/or focus it. Never throws; a
	 * failure is reported as `placed: false` with the reason. */
	readonly placeTerminal: (
		params: PlaceTerminalParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => Promise<Record<string, unknown>>;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PROJECT_HANDLE = /^prj_[A-Za-z0-9_-]{22}$/u;
const POSITIONS = new Set<ViewPosition>([
	'right',
	'left',
	'above',
	'below',
	'center',
]);
const ARRANGEMENTS = new Set<TabArrangement>([
	'grid',
	'columns',
	'rows',
	'tabs',
]);
/** Tabs one arrangement may name. */
export const MAX_ARRANGED_TABS = 32;
export const MIN_PANE_FRACTION = 0.05;
export const MAX_PANE_FRACTION = 0.95;
export const MAX_FOLDER_NAME_CHARS = 64;
/** Folders one reorder may list. */
export const MAX_REORDERED_FOLDERS = 256;
const HOME_SECTIONS = new Set<HomeSection>(['home', 'tabs', 'automations']);
export const MAX_OPEN_FILE_PATH_CHARS = 4096;

export function isWorkspaceViewParamFailure(value: unknown): value is Failure {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { ok?: unknown }).ok === false &&
		typeof (value as { error?: unknown }).error === 'object'
	);
}

export function parseGetLayout(
	params: Record<string, unknown>,
): Parsed<GetLayoutParams> {
	const project = optionalProject(params.project);
	if (isWorkspaceViewParamFailure(project)) return project;
	return project === undefined ? {} : { project };
}

export function parseFocusTab(
	params: Record<string, unknown>,
): Parsed<FocusTabParams> {
	const tab = tabRef(params.tab, 'tab');
	return isWorkspaceViewParamFailure(tab) ? tab : { tab };
}

export function parseCloseTab(
	params: Record<string, unknown>,
): Parsed<CloseTabParams> {
	return parseFocusTab(params);
}

export function parseMoveTab(
	params: Record<string, unknown>,
): Parsed<MoveTabParams> {
	const tab = tabRef(params.tab, 'tab');
	if (isWorkspaceViewParamFailure(tab)) return tab;
	const beside = tabRef(params.beside, 'beside');
	if (isWorkspaceViewParamFailure(beside)) return beside;
	if (tab === beside) return badRequest('a tab cannot be moved beside itself');
	const position = params.position ?? 'right';
	if (typeof position !== 'string' || !POSITIONS.has(position as ViewPosition))
		return badRequest('position must be right, left, above, below, or center');
	return { tab, beside, position: position as ViewPosition };
}

export function parseResizePane(
	params: Record<string, unknown>,
): Parsed<ResizePaneParams> {
	const tab = tabRef(params.tab, 'tab');
	if (isWorkspaceViewParamFailure(tab)) return tab;
	const width = optionalFraction(params.width, 'width');
	if (isWorkspaceViewParamFailure(width)) return width;
	const height = optionalFraction(params.height, 'height');
	if (isWorkspaceViewParamFailure(height)) return height;
	if (width === undefined && height === undefined)
		return badRequest('give width, height, or both');
	return {
		tab,
		...(width === undefined ? {} : { width }),
		...(height === undefined ? {} : { height }),
	};
}

export function parseArrangeTabs(
	params: Record<string, unknown>,
): Parsed<ArrangeTabsParams> {
	const arrangement = params.arrangement;
	if (
		typeof arrangement !== 'string' ||
		!ARRANGEMENTS.has(arrangement as TabArrangement)
	)
		return badRequest('arrangement must be grid, columns, rows, or tabs');
	const project = optionalProject(params.project);
	if (isWorkspaceViewParamFailure(project)) return project;
	let tabs: TabRef[] | undefined;
	if (params.tabs !== undefined) {
		if (
			!Array.isArray(params.tabs) ||
			params.tabs.length === 0 ||
			params.tabs.length > MAX_ARRANGED_TABS
		)
			return badRequest(
				`tabs must list between 1 and ${MAX_ARRANGED_TABS} tabs`,
			);
		tabs = [];
		for (const value of params.tabs) {
			const tab = tabRef(value, 'tabs');
			if (isWorkspaceViewParamFailure(tab)) return tab;
			if (tabs.includes(tab)) return badRequest('tabs lists a tab twice');
			tabs.push(tab);
		}
	}
	return {
		arrangement: arrangement as TabArrangement,
		...(tabs === undefined ? {} : { tabs }),
		...(project === undefined ? {} : { project }),
	};
}

export function parseFocusProject(
	params: Record<string, unknown>,
): Parsed<FocusProjectParams> {
	const project = optionalProject(params.project);
	if (isWorkspaceViewParamFailure(project)) return project;
	if (project === undefined)
		return badRequest('project must be a project handle');
	return { project };
}

export function parseSelectFolder(
	params: Record<string, unknown>,
): Parsed<SelectFolderParams> {
	const folder = id(params.folder, 'folder');
	return isWorkspaceViewParamFailure(folder) ? folder : { folder };
}

export function parseCreateFolder(
	params: Record<string, unknown>,
): Parsed<CreateFolderParams> {
	const name = folderName(params.name);
	if (isWorkspaceViewParamFailure(name)) return name;
	const project = optionalProject(params.project);
	if (isWorkspaceViewParamFailure(project)) return project;
	return { name, ...(project === undefined ? {} : { project }) };
}

export function parseRenameFolder(
	params: Record<string, unknown>,
): Parsed<RenameFolderParams> {
	const folder = id(params.folder, 'folder');
	if (isWorkspaceViewParamFailure(folder)) return folder;
	const name = folderName(params.name);
	if (isWorkspaceViewParamFailure(name)) return name;
	return { folder, name };
}

export function parseDeleteFolder(
	params: Record<string, unknown>,
): Parsed<DeleteFolderParams> {
	const folder = id(params.folder, 'folder');
	return isWorkspaceViewParamFailure(folder) ? folder : { folder };
}

export function parseReorderFolders(
	params: Record<string, unknown>,
): Parsed<ReorderFoldersParams> {
	const folders = params.folders;
	if (
		!Array.isArray(folders) ||
		folders.length === 0 ||
		folders.length > MAX_REORDERED_FOLDERS
	)
		return badRequest(
			'folders must list every folder of one project, in the new order',
		);
	for (const folder of folders) {
		const parsed = id(folder, 'folders');
		if (isWorkspaceViewParamFailure(parsed)) return parsed;
	}
	if (new Set(folders).size !== folders.length)
		return badRequest('folders lists a folder twice');
	return { folders: folders as string[] };
}

export function parseFocusHome(
	params: Record<string, unknown>,
): Parsed<FocusHomeParams> {
	const section = params.section;
	if (section === undefined) return {};
	return typeof section === 'string' &&
		HOME_SECTIONS.has(section as HomeSection)
		? { section: section as HomeSection }
		: badRequest('section must be home, tabs, or automations');
}

export function parseMoveTabToFolder(
	params: Record<string, unknown>,
): Parsed<MoveTabToFolderParams> {
	const tab = tabRef(params.tab, 'tab');
	if (isWorkspaceViewParamFailure(tab)) return tab;
	const folder = id(params.folder, 'folder');
	if (isWorkspaceViewParamFailure(folder)) return folder;
	return { tab, folder };
}

export function parseOpenFile(
	params: Record<string, unknown>,
): Parsed<OpenFileParams> {
	const path = params.path;
	if (
		typeof path !== 'string' ||
		path.trim().length === 0 ||
		path.length > MAX_OPEN_FILE_PATH_CHARS ||
		path.includes('\0')
	)
		return badRequest('path must be a file path');
	const project = optionalProject(params.project);
	if (isWorkspaceViewParamFailure(project)) return project;
	return { path, ...(project === undefined ? {} : { project }) };
}

/** Parse the placement fields `open_terminal` and `split_terminal` share. */
export function parsePlacementFields(params: Record<string, unknown>): Parsed<{
	readonly beside?: TabRef;
	readonly focus?: boolean;
}> {
	let beside: TabRef | undefined;
	if (params.beside !== undefined) {
		const parsed = tabRef(params.beside, 'beside');
		if (isWorkspaceViewParamFailure(parsed)) return parsed;
		beside = parsed;
	}
	if (params.focus !== undefined && typeof params.focus !== 'boolean')
		return badRequest('focus must be a boolean');
	return {
		...(beside === undefined ? {} : { beside }),
		...(params.focus === undefined ? {} : { focus: params.focus as boolean }),
	};
}

export function workspaceViewFailure(
	code: ControlError['code'],
	message: string,
): Failure {
	return { ok: false, error: { code, message } };
}

function tabRef(value: unknown, name: string): Parsed<TabRef> {
	return typeof value === 'string' && ID_PATTERN.test(value)
		? value
		: badRequest(`${name} must be a tab id or terminal handle`);
}

function id(value: unknown, name: string): Parsed<string> {
	return typeof value === 'string' && ID_PATTERN.test(value)
		? value
		: badRequest(`${name} must be an id from get_layout`);
}

function optionalProject(value: unknown): Parsed<string | undefined> {
	if (value === undefined) return undefined;
	return typeof value === 'string' && PROJECT_HANDLE.test(value)
		? value
		: badRequest('project must be a project handle');
}

function optionalFraction(
	value: unknown,
	name: string,
): Parsed<number | undefined> {
	if (value === undefined) return undefined;
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		value < MIN_PANE_FRACTION ||
		value > MAX_PANE_FRACTION
	)
		return badRequest(
			`${name} must be a fraction between ${MIN_PANE_FRACTION} and ${MAX_PANE_FRACTION}`,
		);
	return value;
}

function folderName(value: unknown): Parsed<string> {
	if (typeof value !== 'string') return badRequest('name must be a string');
	const name = value.trim();
	if (name.length === 0 || [...name].length > MAX_FOLDER_NAME_CHARS)
		return badRequest(
			`name must be between 1 and ${MAX_FOLDER_NAME_CHARS} characters`,
		);
	return name;
}

function badRequest(message: string): Failure {
	return workspaceViewFailure('bad_request', message);
}
