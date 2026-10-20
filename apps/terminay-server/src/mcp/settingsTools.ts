import type { ControlError, ControlRequestContext } from './controlEndpoint.js';

/**
 * The settings and shell profile tools (ADR-0072). Parsing lives here; the
 * binding to the settings and shell profile services lives in
 * settingsAdapter.ts, which loads server-core. Which settings a caller may name
 * is decided there, from the server's allow-list, never here.
 */

export type GetSettingsParams = Record<string, never>;
export interface UpdateSettingsParams {
	/** Dotted setting path to its new value, e.g. `{ "scrollback": 10000 }`. */
	readonly settings: Readonly<Record<string, unknown>>;
}
export type ListShellProfilesParams = Record<string, never>;
export interface SaveShellProfileParams {
	/** Absent creates a profile; present updates that durable profile. */
	readonly id?: string;
	readonly name?: string;
	readonly target?: unknown;
	readonly args?: readonly string[];
	readonly startupMode?: string;
	/** Environment overlay: a value, or null to unset the variable. */
	readonly environment?: Readonly<Record<string, string | null>>;
	readonly icon?: string;
	readonly color?: string;
}
export interface ShellProfileIdParams {
	readonly profileId: string;
}
export interface ReorderShellProfilesParams {
	readonly profileIds: readonly string[];
}

type Failure = { readonly ok: false; readonly error: ControlError };
type Parsed<T> = T | Failure;
type Handler<P> = (
	params: P,
	context: ControlRequestContext,
	signal: AbortSignal,
) => unknown | Promise<unknown>;

/** Host binding for the settings and shell profile tools; each method is
 * already past the reach check and the MCP permission gate. */
export interface SettingsControlAdapter {
	readonly getSettings: Handler<GetSettingsParams>;
	readonly updateSettings: Handler<UpdateSettingsParams>;
	readonly listShellProfiles: Handler<ListShellProfilesParams>;
	readonly saveShellProfile: Handler<SaveShellProfileParams>;
	readonly deleteShellProfile: Handler<ShellProfileIdParams>;
	readonly reorderShellProfiles: Handler<ReorderShellProfilesParams>;
	readonly setDefaultShellProfile: Handler<ShellProfileIdParams>;
}

/** The tools a `SettingsControlAdapter` binds; without one they are unavailable. */
export const SETTINGS_CONTROL_OPERATIONS = Object.freeze([
	'get_settings',
	'update_settings',
	'list_shell_profiles',
	'save_shell_profile',
	'delete_shell_profile',
	'reorder_shell_profiles',
	'set_default_shell_profile',
] as const);

/** Settings one `update_settings` may change. */
export const MAX_SETTINGS_PER_UPDATE = 64;
const SETTING_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,255}$/u;
const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_PROFILE_IDS = 64;

export function isSettingsParamFailure(value: unknown): value is Failure {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { ok?: unknown }).ok === false &&
		typeof (value as { error?: unknown }).error === 'object'
	);
}

export function parseGetSettings(): Parsed<GetSettingsParams> {
	return {};
}

export function parseListShellProfiles(): Parsed<ListShellProfilesParams> {
	return {};
}

export function parseUpdateSettings(
	params: Record<string, unknown>,
): Parsed<UpdateSettingsParams> {
	const settings = params.settings;
	if (
		typeof settings !== 'object' ||
		settings === null ||
		Array.isArray(settings)
	)
		return badRequest(
			'settings must map each setting path to its new value, e.g. { "scrollback": 10000 }',
		);
	const paths = Object.keys(settings);
	if (paths.length === 0 || paths.length > MAX_SETTINGS_PER_UPDATE)
		return badRequest(
			`settings must name between 1 and ${MAX_SETTINGS_PER_UPDATE} settings`,
		);
	for (const path of paths)
		if (!SETTING_PATH.test(path) || path.includes('..') || path.endsWith('.'))
			return badRequest(`${path.slice(0, 64)} is not a setting path`);
	// A path and one inside it would change the same setting twice.
	for (const path of paths)
		if (paths.some((other) => other.startsWith(`${path}.`)))
			return badRequest(`${path} is named together with a setting inside it`);
	return { settings: settings as Record<string, unknown> };
}

export function parseSaveShellProfile(
	params: Record<string, unknown>,
): Parsed<SaveShellProfileParams> {
	const profile = params.profile;
	if (typeof profile !== 'object' || profile === null || Array.isArray(profile))
		return badRequest('profile must be an object');
	const record = profile as Record<string, unknown>;
	const id = record.id;
	if (id !== undefined && (typeof id !== 'string' || !PROFILE_ID.test(id)))
		return badRequest('profile.id must be a shell profile id');
	if (id === undefined && (record.name === undefined || record.target === undefined))
		return badRequest('a new profile needs a name and a target');
	for (const key of ['name', 'startup_mode', 'icon', 'color'] as const)
		if (record[key] !== undefined && typeof record[key] !== 'string')
			return badRequest(`profile.${key} must be a string`);
	if (
		record.args !== undefined &&
		(!Array.isArray(record.args) ||
			record.args.some((arg) => typeof arg !== 'string'))
	)
		return badRequest('profile.args must be a list of strings');
	if (record.environment !== undefined) {
		const environment = record.environment;
		if (
			typeof environment !== 'object' ||
			environment === null ||
			Array.isArray(environment) ||
			Object.values(environment).some(
				(value) => value !== null && typeof value !== 'string',
			)
		)
			return badRequest(
				'profile.environment must map variable names to a value, or null to unset it',
			);
	}
	return {
		...(id === undefined ? {} : { id: id as string }),
		...(record.name === undefined ? {} : { name: record.name as string }),
		...(record.target === undefined ? {} : { target: record.target }),
		...(record.args === undefined ? {} : { args: record.args as string[] }),
		...(record.startup_mode === undefined
			? {}
			: { startupMode: record.startup_mode as string }),
		...(record.environment === undefined
			? {}
			: {
					environment: record.environment as Record<string, string | null>,
				}),
		...(record.icon === undefined ? {} : { icon: record.icon as string }),
		...(record.color === undefined ? {} : { color: record.color as string }),
	};
}

export function parseShellProfileId(
	params: Record<string, unknown>,
): Parsed<ShellProfileIdParams> {
	const profileId = params.profile_id;
	return typeof profileId === 'string' && PROFILE_ID.test(profileId)
		? { profileId }
		: badRequest('profile_id must be a shell profile id from list_shell_profiles');
}

export function parseReorderShellProfiles(
	params: Record<string, unknown>,
): Parsed<ReorderShellProfilesParams> {
	const ids = params.profile_ids;
	if (
		!Array.isArray(ids) ||
		ids.length > MAX_PROFILE_IDS ||
		ids.some((id) => typeof id !== 'string' || !PROFILE_ID.test(id)) ||
		new Set(ids).size !== ids.length
	)
		return badRequest(
			'profile_ids must list each of your shell profiles once, in the new order',
		);
	return { profileIds: ids as string[] };
}

export function settingsFailure(
	code: ControlError['code'],
	message: string,
): Failure {
	return { ok: false, error: { code, message } };
}

function badRequest(message: string): Failure {
	return settingsFailure('bad_request', message);
}
