import { isAbsolute } from 'node:path';
import type { ControlError, ControlRequestContext } from './controlEndpoint.js';

/**
 * The app-level MCP tools (ADR-0072): projects and workspace windows. Parsing
 * lives here; the binding to the workspace operations and the agent's client
 * lives in appControlAdapter.ts, which loads server-core. Which reach may call
 * each tool is the dispatcher's table, never decided here.
 */

/** A project's root as an agent names it: `~`, `~/…`, or an absolute path. */
export type ProjectRootRef = string;

export type ListProjectsParams = Record<string, never>;
export interface CreateProjectParams {
	readonly root: ProjectRootRef;
	readonly name?: string;
	readonly icon?: string;
	readonly color?: string;
	/** Opaque window handle; absent puts it in the window the agent's client shows. */
	readonly window?: string;
}
export interface UpdateProjectParams {
	/** Opaque project handle; project reach may omit it for its own project. */
	readonly project?: string;
	readonly name?: string;
	readonly icon?: string;
	readonly color?: string;
	/** Workspace reach only. */
	readonly root?: ProjectRootRef;
	/** Workspace reach only: a durable profile id, or null to clear it. */
	readonly shellProfile?: string | null;
}
export interface MoveProjectParams {
	readonly project: string;
	/** Absent moves it within its own window. */
	readonly window?: string;
	readonly position?: number;
}
export interface CloseProjectParams {
	readonly project: string;
	readonly force: boolean;
}
export type ListWorkspaceWindowsParams = Record<string, never>;
export interface OpenWorkspaceWindowParams {
	readonly name?: string;
	readonly projects: readonly string[];
}
export interface RenameWorkspaceWindowParams {
	readonly window: string;
	readonly name: string;
}
export interface CloseWorkspaceWindowParams {
	readonly window: string;
}

type Failure = { readonly ok: false; readonly error: ControlError };
type Parsed<T> = T | Failure;
type Handler<P> = (
	params: P,
	context: ControlRequestContext,
	signal: AbortSignal,
) => unknown | Promise<unknown>;

/** Host binding for the project and window tools; each method is already
 * past the reach check and the MCP permission gate when it is called. */
export interface AppControlAdapter {
	readonly listProjects: Handler<ListProjectsParams>;
	readonly createProject: Handler<CreateProjectParams>;
	readonly updateProject: Handler<UpdateProjectParams>;
	readonly moveProject: Handler<MoveProjectParams>;
	readonly closeProject: Handler<CloseProjectParams>;
	readonly listWorkspaceWindows: Handler<ListWorkspaceWindowsParams>;
	readonly openWorkspaceWindow: Handler<OpenWorkspaceWindowParams>;
	readonly renameWorkspaceWindow: Handler<RenameWorkspaceWindowParams>;
	readonly closeWorkspaceWindow: Handler<CloseWorkspaceWindowParams>;
}

/** The tools an `AppControlAdapter` binds; without one they are unavailable. */
export const APP_CONTROL_OPERATIONS = Object.freeze([
	'list_projects',
	'create_project',
	'update_project',
	'move_project',
	'close_project',
	'list_workspace_windows',
	'open_workspace_window',
	'rename_workspace_window',
	'close_workspace_window',
] as const);

/**
 * The only `update_project` fields a project-reach caller may send: its own
 * project's name, icon and colour. Any other field needs workspace reach.
 */
export const PROJECT_REACH_UPDATE_PROJECT_FIELDS: ReadonlySet<string> = new Set(
	['project', 'name', 'icon', 'color'],
);

const PROJECT_HANDLE = /^prj_[A-Za-z0-9_-]{22}$/u;
const WINDOW_HANDLE = /^win_[A-Za-z0-9_-]{22}$/u;
const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export const MAX_PROJECT_NAME_CHARS = 256;
export const MAX_PROJECT_PRESENTATION_CHARS = 128;
export const MAX_PROJECT_ROOT_CHARS = 4096;
export const MAX_WINDOW_NAME_CHARS = 256;
/** Projects one `open_workspace_window` may move into its window. */
export const MAX_WINDOW_PROJECTS = 32;

export function isAppControlParamFailure(value: unknown): value is Failure {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { ok?: unknown }).ok === false &&
		typeof (value as { error?: unknown }).error === 'object'
	);
}

export function parseListProjects(): Parsed<ListProjectsParams> {
	return {};
}

export function parseCreateProject(
	params: Record<string, unknown>,
): Parsed<CreateProjectParams> {
	const root = projectRoot(params.root);
	if (isAppControlParamFailure(root)) return root;
	const presentation = parsePresentation(params);
	if (isAppControlParamFailure(presentation)) return presentation;
	const window = optionalWindow(params.window);
	if (isAppControlParamFailure(window)) return window;
	return {
		root,
		...presentation,
		...(window === undefined ? {} : { window }),
	};
}

export function parseUpdateProject(
	params: Record<string, unknown>,
): Parsed<UpdateProjectParams> {
	const project = optionalProject(params.project);
	if (isAppControlParamFailure(project)) return project;
	const presentation = parsePresentation(params);
	if (isAppControlParamFailure(presentation)) return presentation;
	let root: string | undefined;
	if (params.root !== undefined) {
		const parsed = projectRoot(params.root);
		if (isAppControlParamFailure(parsed)) return parsed;
		root = parsed;
	}
	let shellProfile: string | null | undefined;
	if (params.shell_profile !== undefined) {
		if (
			params.shell_profile !== null &&
			(typeof params.shell_profile !== 'string' ||
				!PROFILE_ID.test(params.shell_profile))
		)
			return badRequest('shell_profile must be a shell profile id, or null');
		shellProfile = params.shell_profile as string | null;
	}
	if (
		presentation.name === undefined &&
		presentation.icon === undefined &&
		presentation.color === undefined &&
		root === undefined &&
		shellProfile === undefined
	)
		return badRequest(
			'name, icon, color, root, or shell_profile must be given',
		);
	return {
		...(project === undefined ? {} : { project }),
		...presentation,
		...(root === undefined ? {} : { root }),
		...(shellProfile === undefined ? {} : { shellProfile }),
	};
}

export function parseMoveProject(
	params: Record<string, unknown>,
): Parsed<MoveProjectParams> {
	const project = requiredProject(params.project);
	if (isAppControlParamFailure(project)) return project;
	const window = optionalWindow(params.window);
	if (isAppControlParamFailure(window)) return window;
	if (
		params.position !== undefined &&
		(typeof params.position !== 'number' ||
			!Number.isSafeInteger(params.position) ||
			params.position < 0)
	)
		return badRequest('position must be a non-negative integer');
	if (window === undefined && params.position === undefined)
		return badRequest('window or position must be given');
	return {
		project,
		...(window === undefined ? {} : { window }),
		...(params.position === undefined
			? {}
			: { position: params.position as number }),
	};
}

export function parseCloseProject(
	params: Record<string, unknown>,
): Parsed<CloseProjectParams> {
	const project = requiredProject(params.project);
	if (isAppControlParamFailure(project)) return project;
	if (params.force !== undefined && typeof params.force !== 'boolean')
		return badRequest('force must be a boolean');
	return { project, force: params.force === true };
}

export function parseListWorkspaceWindows(): Parsed<ListWorkspaceWindowsParams> {
	return {};
}

export function parseOpenWorkspaceWindow(
	params: Record<string, unknown>,
): Parsed<OpenWorkspaceWindowParams> {
	let name: string | undefined;
	if (params.name !== undefined) {
		const parsed = boundedText(params.name, 'name', MAX_WINDOW_NAME_CHARS);
		if (isAppControlParamFailure(parsed)) return parsed;
		name = parsed;
	}
	const projects = params.projects ?? [];
	if (
		!Array.isArray(projects) ||
		projects.length > MAX_WINDOW_PROJECTS ||
		projects.some(
			(project) => typeof project !== 'string' || !PROJECT_HANDLE.test(project),
		)
	)
		return badRequest(
			`projects must be at most ${MAX_WINDOW_PROJECTS} project handles`,
		);
	if (new Set(projects).size !== projects.length)
		return badRequest('projects must not repeat a project');
	return { ...(name === undefined ? {} : { name }), projects };
}

export function parseRenameWorkspaceWindow(
	params: Record<string, unknown>,
): Parsed<RenameWorkspaceWindowParams> {
	const window = requiredWindow(params.window);
	if (isAppControlParamFailure(window)) return window;
	const name = boundedText(params.name, 'name', MAX_WINDOW_NAME_CHARS);
	if (isAppControlParamFailure(name)) return name;
	return { window, name };
}

export function parseCloseWorkspaceWindow(
	params: Record<string, unknown>,
): Parsed<CloseWorkspaceWindowParams> {
	const window = requiredWindow(params.window);
	return isAppControlParamFailure(window) ? window : { window };
}

export function appControlFailure(
	code: ControlError['code'],
	message: string,
): Failure {
	return { ok: false, error: { code, message } };
}

/** `~`, `~/…`, or an absolute path; never a relative one. Nothing is read. */
function projectRoot(value: unknown): Parsed<ProjectRootRef> {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > MAX_PROJECT_ROOT_CHARS ||
		value.includes('\0')
	)
		return badRequest('root must be a folder path');
	if (value === '~' || value.startsWith('~/') || isAbsolute(value))
		return value;
	return badRequest(
		'root must be an absolute path, ~ for the home folder, or a path beginning ~/',
	);
}

function parsePresentation(params: Record<string, unknown>): Parsed<{
	readonly name?: string;
	readonly icon?: string;
	readonly color?: string;
}> {
	let name: string | undefined;
	if (params.name !== undefined) {
		const parsed = boundedText(params.name, 'name', MAX_PROJECT_NAME_CHARS);
		if (isAppControlParamFailure(parsed)) return parsed;
		name = parsed;
	}
	const result: { name?: string; icon?: string; color?: string } =
		name === undefined ? {} : { name };
	for (const key of ['icon', 'color'] as const) {
		const value = params[key];
		if (value === undefined) continue;
		if (
			typeof value !== 'string' ||
			value.length > MAX_PROJECT_PRESENTATION_CHARS ||
			value.includes('\0')
		)
			return badRequest(
				`${key} must be at most ${MAX_PROJECT_PRESENTATION_CHARS} characters`,
			);
		result[key] = value;
	}
	return result;
}

function boundedText(
	value: unknown,
	name: string,
	max: number,
): Parsed<string> {
	if (typeof value !== 'string') return badRequest(`${name} must be a string`);
	const text = value.trim();
	if (text.length === 0 || text.length > max || text.includes('\0'))
		return badRequest(`${name} must be between 1 and ${max} characters`);
	return text;
}

function optionalProject(value: unknown): Parsed<string | undefined> {
	return value === undefined ? undefined : requiredProject(value);
}

function requiredProject(value: unknown): Parsed<string> {
	return typeof value === 'string' && PROJECT_HANDLE.test(value)
		? value
		: badRequest('project must be a project handle from list_projects');
}

function optionalWindow(value: unknown): Parsed<string | undefined> {
	return value === undefined ? undefined : requiredWindow(value);
}

function requiredWindow(value: unknown): Parsed<string> {
	return typeof value === 'string' && WINDOW_HANDLE.test(value)
		? value
		: badRequest('window must be a window handle from list_workspace_windows');
}

function badRequest(message: string): Failure {
	return appControlFailure('bad_request', message);
}
