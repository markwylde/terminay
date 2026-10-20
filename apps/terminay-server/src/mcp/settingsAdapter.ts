import type { JsonValue } from '@terminay/protocol';
import {
	DEFAULT_SERVER_SETTINGS,
	type McpApprovalDetail,
	mcpReachableSettings,
	mcpSettingPathRefusal,
	normalizeServerSettings,
	SETTING_AUTHORITY,
	SETTINGS_OPERATIONS,
	SHELL_PROFILE_OPERATIONS,
	type SettingsObject,
	type WorkspaceState,
} from '@terminay/server-core';
import { serverControlError } from './appControlAdapter.js';
import { ControlEndpointError } from './controlEndpoint.js';
import type {
	SaveShellProfileParams,
	SettingsControlAdapter,
} from './settingsTools.js';
import { type ProjectHandleCodec, reachOf } from './workspaceReach.js';

/**
 * Binds the settings and shell profile tools (ADR-0072) to the server's own
 * settings and shell profile operations, run as the MCP principal. A setting
 * is reachable only when the server's allow-list names it; a request naming
 * anything else, or a value the Settings normalisation would not keep, is
 * refused whole before anything is written. No stored credential, secret
 * reference or environment value ever leaves here.
 */

export interface SettingsControlAdapterOptions {
	/** Run one server query as the MCP principal and resolve with its result. */
	readonly query: (
		operation: string,
		payload: JsonValue,
		signal: AbortSignal,
	) => Promise<unknown>;
	/** Run one server command as the MCP principal. */
	readonly command: (
		operation: string,
		payload: JsonValue,
		signal: AbortSignal,
		expectedRevision?: number,
	) => Promise<unknown>;
	readonly state: () => WorkspaceState | Promise<WorkspaceState>;
	readonly projectHandles: ProjectHandleCodec;
}

/** One validated `update_settings` request, ready to commit. */
export interface SettingsUpdatePlan {
	readonly revision: number;
	/** The nested patch `settings.update` merges. */
	readonly patch: SettingsObject;
	readonly changes: readonly {
		readonly path: string;
		readonly current: JsonValue | undefined;
		readonly requested: JsonValue;
	}[];
}

/** Profiles one listing returns. */
export const MAX_LISTED_SHELL_PROFILES = 128;

export function createSettingsControlAdapter(
	options: SettingsControlAdapterOptions,
): SettingsControlAdapter {
	const query = async (operation: string, payload: JsonValue, signal: AbortSignal) => {
		try {
			return await options.query(operation, payload, signal);
		} catch (error) {
			throw profileError(error);
		}
	};
	const command = async (
		operation: string,
		payload: JsonValue,
		signal: AbortSignal,
		expectedRevision?: number,
	) => {
		try {
			return await options.command(operation, payload, signal, expectedRevision);
		} catch (error) {
			throw profileError(error);
		}
	};
	const current = async (signal: AbortSignal) =>
		settingsState(await query(SETTINGS_OPERATIONS.get, {}, signal));

	return {
		getSettings: async (_params, _context, signal) => {
			const state = await current(signal);
			return {
				revision: state.revision,
				settings: mcpReachableSettings(state.settings),
			};
		},
		updateSettings: async (params, _context, signal) => {
			const state = await current(signal);
			const plan = planSettingsUpdate(params.settings, state);
			await command(
				SETTINGS_OPERATIONS.update,
				{ settings: plan.patch } as JsonValue,
				signal,
				plan.revision,
			);
			const after = await current(signal);
			return {
				updated: plan.changes.map((change) => change.path),
				settings: Object.fromEntries(
					plan.changes.map((change) => [
						change.path,
						readPath(after.settings, change.path) ?? null,
					]),
				),
				revision: after.revision,
			};
		},
		listShellProfiles: async (_params, context, signal) => {
			const catalogue = record(
				await query(SHELL_PROFILE_OPERATIONS.catalogue, {}, signal),
			);
			const workspace = await options.state();
			const entries = Array.isArray(catalogue.entries) ? catalogue.entries : [];
			const listed = entries.slice(0, MAX_LISTED_SHELL_PROFILES);
			return {
				default_profile: catalogue.defaultProfileId,
				new_terminal_cwd: catalogue.cwdPolicy,
				profiles: listed.map((entry) =>
					describeProfile(record(entry), (projectId) =>
						workspace.projects[projectId] !== undefined &&
						(reachOf(context) === 'workspace' ||
							projectId === context.projectId)
							? options.projectHandles.handleFor(projectId)
							: undefined,
					),
				),
				...(listed.length < entries.length ? { truncated: true } : {}),
			};
		},
		saveShellProfile: async (params, _context, signal) => {
			if (params.id === undefined) {
				const created = await command(
					SHELL_PROFILE_OPERATIONS.create,
					{ profile: newProfile(params) } as JsonValue,
					signal,
				);
				const entry = (
					Array.isArray(record(created).entries)
						? (record(created).entries as unknown[])
						: []
				)
					.map(record)
					.find(
						(candidate) =>
							candidate.kind === 'custom' &&
							typeof candidate.name === 'string' &&
							candidate.name.toLocaleLowerCase() ===
								(params.name ?? '').trim().toLocaleLowerCase(),
					);
				return {
					...(typeof entry?.id === 'string' ? { profile: entry.id } : {}),
					created: true,
				};
			}
			// An update keeps every field the caller left out, including the
			// arguments and environment it is never shown.
			const existing = record(
				await query(
					SHELL_PROFILE_OPERATIONS.detail,
					{ profileId: params.id },
					signal,
				),
			);
			await command(
				SHELL_PROFILE_OPERATIONS.update,
				{
					profile: {
						...existing,
						...newProfile(params, existing),
						id: params.id,
					},
				} as JsonValue,
				signal,
			);
			return { profile: params.id, updated: true };
		},
		deleteShellProfile: async (params, _context, signal) => {
			await command(
				SHELL_PROFILE_OPERATIONS.delete,
				{ profileId: params.profileId },
				signal,
			);
			return { profile: params.profileId, deleted: true };
		},
		reorderShellProfiles: async (params, _context, signal) => {
			await command(
				SHELL_PROFILE_OPERATIONS.reorder,
				{ profileIds: [...params.profileIds] },
				signal,
			);
			return { profiles: params.profileIds, reordered: true };
		},
		setDefaultShellProfile: async (params, _context, signal) => {
			await command(
				SHELL_PROFILE_OPERATIONS.setDefault,
				{ profileId: params.profileId },
				signal,
			);
			return { default_profile: params.profileId };
		},
	};
}

/**
 * Validate an `update_settings` request against the current settings, exactly
 * as the Settings normalisation would take it. Any excluded, unknown or
 * invalid path refuses the whole request, naming that path.
 */
export function planSettingsUpdate(
	requested: Readonly<Record<string, unknown>>,
	state: { readonly revision: number; readonly settings: SettingsObject },
): SettingsUpdatePlan {
	const candidate = structuredClone(state.settings) as Record<string, JsonValue>;
	const patch: Record<string, JsonValue> = {};
	const changes: SettingsUpdatePlan['changes'][number][] = [];
	for (const [path, value] of Object.entries(requested)) {
		const refusal = mcpSettingPathRefusal(path);
		// An excluded setting is named as such; a name no setting has is unknown.
		if (
			refusal === 'excluded' &&
			Object.hasOwn(SETTING_AUTHORITY, path.split('.')[0] as string)
		)
			throw new ControlEndpointError(
				'bad_request',
				`${path} cannot be read or changed through Terminay MCP; nothing was changed.`,
			);
		const known =
			refusal === undefined &&
			(readPath(DEFAULT_SERVER_SETTINGS, path) !== undefined ||
				readPath(state.settings, path) !== undefined);
		if (!known)
			throw new ControlEndpointError(
				'bad_request',
				`${path.slice(0, 256)} is not a setting; nothing was changed. get_settings lists them.`,
			);
		if (!isJson(value))
			throw new ControlEndpointError(
				'bad_request',
				`${path} needs a JSON value; nothing was changed.`,
			);
		writePath(candidate, path, value);
		writePath(patch, path, value);
		changes.push({
			path,
			current: readPath(state.settings, path),
			requested: value,
		});
	}
	// What Settings would keep: a value it replaces or clamps is refused.
	const normalized = normalizeServerSettings(candidate);
	for (const change of changes)
		if (!keeps(change.requested, readPath(normalized, change.path)))
			throw new ControlEndpointError(
				'bad_request',
				`${change.path} cannot be set to ${preview(change.requested)}; nothing was changed.`,
			);
	return { revision: state.revision, patch, changes };
}

/**
 * The approval prompt for `update_settings`: every path with its current and
 * requested value, so the prompt is the whole request.
 */
export function describeSettingsUpdate(plan: SettingsUpdatePlan): {
	readonly summary: string;
	readonly details: readonly McpApprovalDetail[];
} {
	return {
		summary:
			plan.changes.length === 1
				? `change the setting ${plan.changes[0]?.path}`
				: `change ${plan.changes.length} settings`,
		details: plan.changes.map((change) => ({
			label: change.path,
			value: `${preview(change.current)} → ${preview(change.requested)}`,
			code: true,
		})),
	};
}

/** The server settings and revision from a `settings.get` result. */
export function settingsState(value: unknown): {
	readonly revision: number;
	readonly settings: SettingsObject;
} {
	const state = record(value);
	return {
		revision: typeof state.revision === 'number' ? state.revision : 0,
		settings: record(state.settings) as SettingsObject,
	};
}

function describeProfile(
	entry: Record<string, unknown>,
	projectHandle: (projectId: string) => string | undefined,
): Record<string, unknown> {
	const availability = record(entry.availability);
	const references = Array.isArray(entry.projectReferences)
		? entry.projectReferences.flatMap((projectId) => {
				const handle =
					typeof projectId === 'string' ? projectHandle(projectId) : undefined;
				return handle === undefined ? [] : [handle];
			})
		: [];
	// Only fields a catalogue entry carries publicly: never an environment value.
	return {
		id: entry.id,
		name: entry.name,
		kind: entry.kind,
		source: entry.source,
		read_only: entry.readOnly,
		target: entry.target,
		startup_mode: entry.startupMode,
		...(typeof entry.icon === 'string' ? { icon: entry.icon } : {}),
		...(typeof entry.color === 'string' ? { color: entry.color } : {}),
		argument_count: entry.argumentCount,
		environment_variable_count: entry.environmentEntryCount,
		available: availability.available === true,
		...(typeof availability.reason === 'string'
			? { reason: availability.reason }
			: {}),
		...(references.length === 0 ? {} : { default_for_projects: references }),
	};
}

/** A profile definition from the caller's fields, over `existing` when given. */
function newProfile(
	params: SaveShellProfileParams,
	existing: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		name: params.name ?? existing.name,
		target: params.target ?? existing.target,
		args: params.args ?? existing.args ?? [],
		startupMode: params.startupMode ?? existing.startupMode ?? 'default',
		environment: params.environment ?? existing.environment ?? {},
		...((params.icon ?? existing.icon) === undefined
			? {}
			: { icon: params.icon ?? existing.icon }),
		...((params.color ?? existing.color) === undefined
			? {}
			: { color: params.color ?? existing.color }),
	};
}

/** Whether normalisation kept the requested value: every field it names. */
function keeps(requested: JsonValue, actual: JsonValue | undefined): boolean {
	if (isObject(requested))
		return (
			isObject(actual) &&
			Object.entries(requested).every(([key, value]) =>
				keeps(value, actual[key]),
			)
		);
	return JSON.stringify(requested) === JSON.stringify(actual);
}

function readPath(
	settings: SettingsObject,
	path: string,
): JsonValue | undefined {
	let value: JsonValue | undefined = settings as JsonValue;
	for (const part of path.split('.')) {
		if (!isObject(value)) return undefined;
		value = value[part];
	}
	return value;
}

function writePath(
	target: Record<string, JsonValue>,
	path: string,
	value: JsonValue,
): void {
	const parts = path.split('.');
	let current = target;
	for (const part of parts.slice(0, -1)) {
		const child = current[part];
		if (!isObject(child)) current[part] = {};
		current = current[part] as Record<string, JsonValue>;
	}
	current[parts.at(-1) as string] = structuredClone(value);
}

function preview(value: JsonValue | undefined): string {
	if (value === undefined) return 'not set';
	const text = JSON.stringify(value);
	return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

function isJson(value: unknown): value is JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean')
		return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJson);
	return isObject(value as JsonValue) && Object.values(value as object).every(isJson);
}

function isObject(
	value: JsonValue | undefined,
): value is { [key: string]: JsonValue } {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** A shell profile refusal: "unavailable" there means no such profile. */
function profileError(error: unknown): ControlEndpointError {
	if (error instanceof ControlEndpointError) return error;
	if (record(error).code === 'unavailable')
		return new ControlEndpointError(
			'not_found',
			'No shell profile you can change has that id. list_shell_profiles lists them.',
		);
	return serverControlError(error);
}
