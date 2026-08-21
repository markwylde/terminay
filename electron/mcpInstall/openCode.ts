import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type {
	McpAgentRegistrationState,
	McpInstallActionResult,
} from '../../src/types/terminay';
import { atomicWriteConfig } from './atomicConfigWrite';
import type { McpServerCommand } from './index';

const SERVER_KEY = 'terminay';
const CONFIG_DIRECTORY = ['.config', 'opencode'];
const JSON_CONFIG = 'opencode.json';
const JSONC_CONFIG = 'opencode.jsonc';

interface OpenCodeServerEntry {
	type: 'local';
	command: string[];
	environment?: Record<string, string>;
}

interface OpenCodeConfig {
	mcp?: {
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

type ConfigResolution = { path: string } | { error: string; path: string };

/**
 * The default, deterministic OpenCode user configuration location. The async
 * resolver selects an existing .jsonc file when it is the sole candidate.
 */
export function getOpenCodeConfigPath(homeDirectory = homedir()): string {
	return join(homeDirectory, ...CONFIG_DIRECTORY, JSON_CONFIG);
}

/**
 * Return the one existing OpenCode user configuration candidate, or the
 * deterministic JSON default when no candidate (or an ambiguity) exists.
 * Registration inspection carries ambiguity details as an unavailable state.
 */
export async function resolveOpenCodeConfigPath(
	homeDirectory?: string,
): Promise<string> {
	return (await resolveConfig(homeDirectory)).path;
}

function getOpenCodeJsoncConfigPath(homeDirectory = homedir()): string {
	return join(homeDirectory, ...CONFIG_DIRECTORY, JSONC_CONFIG);
}

/**
 * OpenCode supports both JSON and JSONC user configuration. Do not guess
 * precedence when both files exist: the two files can be merged differently by
 * different OpenCode versions, so changing either could register the wrong
 * effective server.
 */
async function resolveConfig(
	homeDirectory?: string,
): Promise<ConfigResolution> {
	const jsonPath = getOpenCodeConfigPath(homeDirectory);
	const jsoncPath = getOpenCodeJsoncConfigPath(homeDirectory);
	const [json, jsonc] = await Promise.all([
		candidateExists(jsonPath),
		candidateExists(jsoncPath),
	]);

	if ('error' in json) return { path: jsonPath, error: json.error };
	if ('error' in jsonc) return { path: jsonPath, error: jsonc.error };
	if (json.exists && jsonc.exists) {
		return {
			path: jsonPath,
			error: `Both ${jsonPath} and ${jsoncPath} exist; unable to choose an OpenCode user configuration safely.`,
		};
	}
	return { path: jsonc.exists ? jsoncPath : jsonPath };
}

async function candidateExists(
	path: string,
): Promise<{ exists: boolean } | { error: string }> {
	try {
		const details = await stat(path);
		if (!details.isFile()) {
			return {
				error: `${path} is not a regular file; refusing to overwrite it.`,
			};
		}
		return { exists: true };
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === 'ENOENT')
			return { exists: false };
		return { error: `Could not inspect ${path}: ${describeError(cause)}` };
	}
}

async function readConfig(
	path: string,
): Promise<{ config: OpenCodeConfig } | { error: string }> {
	let raw: string;
	try {
		raw = await readFile(path, 'utf8');
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === 'ENOENT')
			return { config: {} };
		return { error: `Could not read ${path}: ${describeError(cause)}` };
	}

	if (raw.trim().length === 0) return { config: {} };

	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!isPlainObject(parsed)) {
			return {
				error: `${path} does not contain a JSON object; refusing to overwrite it.`,
			};
		}
		if (parsed.mcp !== undefined && !isPlainObject(parsed.mcp)) {
			return {
				error: `${path} has a non-object mcp setting; refusing to overwrite it.`,
			};
		}
		return { config: parsed as OpenCodeConfig };
	} catch (cause) {
		const format = path.endsWith(JSONC_CONFIG)
			? 'JSONC that cannot safely round-trip'
			: 'JSON';
		return {
			error: `Could not parse ${path} as ${format}: ${describeError(cause)}`,
		};
	}
}

/** True when any Terminay entry is present in the resolved OpenCode config. */
export async function isOpenCodeInstalled(
	homeDirectory?: string,
): Promise<boolean> {
	try {
		const resolution = await resolveConfig(homeDirectory);
		if ('error' in resolution) return false;
		const result = await readConfig(resolution.path);
		return (
			!('error' in result) &&
			(result.config.mcp?.[SERVER_KEY] !== undefined ||
				legacyServerEntry(result.config) !== undefined)
		);
	} catch {
		return false;
	}
}

export async function inspectOpenCodeRegistration(
	server: McpServerCommand,
	homeDirectory?: string,
): Promise<{ state: McpAgentRegistrationState; message?: string }> {
	const resolution = await resolveConfig(homeDirectory);
	if ('error' in resolution)
		return { state: 'unavailable', message: resolution.error };

	const result = await readConfig(resolution.path);
	if ('error' in result) return { state: 'unavailable', message: result.error };
	const legacy = legacyServerEntry(result.config);
	if (legacy !== undefined) return legacyEntryUnavailable(resolution.path);
	const existing = result.config.mcp?.[SERVER_KEY];
	if (existing === undefined) return { state: 'not-installed' };
	return isDeepStrictEqual(existing, openCodeEntry(server))
		? { state: 'installed' }
		: {
				state: 'changed',
				message:
					'The existing Terminay MCP entry differs from this version of Terminay.',
			};
}

/** Register Terminay as an OpenCode local MCP server. */
export async function installOpenCode(
	server: McpServerCommand,
	homeDirectory?: string,
): Promise<McpInstallActionResult> {
	const resolution = await resolveConfig(homeDirectory);
	if ('error' in resolution)
		return unavailableResult(resolution, homeDirectory);
	const path = resolution.path;
	try {
		const result = await readConfig(path);
		if ('error' in result)
			return {
				ok: false,
				installed: await safeIsInstalled(homeDirectory),
				error: result.error,
			};

		const config = result.config;
		const legacy = legacyServerEntry(config);
		if (legacy !== undefined) return legacyEntryActionResult(path);
		const mcp = config.mcp ?? {};
		const entry = openCodeEntry(server);
		const existing = mcp[SERVER_KEY];
		if (existing !== undefined && !isDeepStrictEqual(existing, entry))
			return changedEntryResult(path);
		if (isDeepStrictEqual(existing, entry)) {
			return {
				ok: true,
				installed: true,
				message: `terminay is already registered in ${path}`,
			};
		}

		mcp[SERVER_KEY] = entry;
		config.mcp = mcp;
		await atomicWriteConfig(path, `${JSON.stringify(config, null, 2)}\n`);
		return {
			ok: true,
			installed: true,
			message: `Registered terminay in ${path}`,
		};
	} catch (cause) {
		return {
			ok: false,
			installed: await safeIsInstalled(homeDirectory),
			error: describeError(cause),
		};
	}
}

/** Remove only an exact Terminay OpenCode registration. */
export async function uninstallOpenCode(
	server?: McpServerCommand,
	homeDirectory?: string,
): Promise<McpInstallActionResult> {
	const resolution = await resolveConfig(homeDirectory);
	if ('error' in resolution)
		return unavailableResult(resolution, homeDirectory);
	const path = resolution.path;
	try {
		const result = await readConfig(path);
		if ('error' in result)
			return {
				ok: false,
				installed: await safeIsInstalled(homeDirectory),
				error: result.error,
			};

		const legacy = legacyServerEntry(result.config);
		if (legacy !== undefined) return legacyEntryActionResult(path);
		const mcp = result.config.mcp;
		if (mcp === undefined || !(SERVER_KEY in mcp)) {
			return {
				ok: true,
				installed: false,
				message: 'terminay was not registered',
			};
		}
		if (
			server !== undefined &&
			!isDeepStrictEqual(mcp[SERVER_KEY], openCodeEntry(server))
		) {
			return changedEntryResult(path);
		}

		delete mcp[SERVER_KEY];
		await atomicWriteConfig(
			path,
			`${JSON.stringify(result.config, null, 2)}\n`,
		);
		return {
			ok: true,
			installed: false,
			message: `Removed terminay from ${path}`,
		};
	} catch (cause) {
		return {
			ok: false,
			installed: await safeIsInstalled(homeDirectory),
			error: describeError(cause),
		};
	}
}

function openCodeEntry(server: McpServerCommand): OpenCodeServerEntry {
	return {
		type: 'local',
		command: [server.command, ...server.args],
		...(server.env === undefined ? {} : { environment: server.env }),
	};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function changedEntryResult(path: string): McpInstallActionResult {
	return {
		ok: false,
		installed: true,
		error: `The existing terminay entry in ${path} has changed; review it before replacing it.`,
	};
}

/**
 * `mcp.servers` is the V2 beta layout. Stable OpenCode uses `mcp.<name>`.
 * A beta Terminay entry must be reviewed rather than shadowed with a second
 * stable entry, since clients may merge the two layouts differently.
 */
function legacyServerEntry(config: OpenCodeConfig): unknown {
	const servers = config.mcp?.servers;
	return isPlainObject(servers) ? servers[SERVER_KEY] : undefined;
}

function legacyEntryUnavailable(path: string): {
	state: McpAgentRegistrationState;
	message: string;
} {
	return {
		state: 'unavailable',
		message: `The existing ${path} uses the incompatible mcp.servers.terminay layout; review it before changing the OpenCode registration.`,
	};
}

function legacyEntryActionResult(path: string): McpInstallActionResult {
	return {
		ok: false,
		installed: true,
		error: `The existing terminay entry in ${path} uses the incompatible mcp.servers layout; review it before changing it.`,
	};
}

async function unavailableResult(
	resolution: Extract<ConfigResolution, { error: string }>,
	homeDirectory?: string,
): Promise<McpInstallActionResult> {
	return {
		ok: false,
		installed: await safeIsInstalled(homeDirectory),
		error: resolution.error,
	};
}

async function safeIsInstalled(homeDirectory?: string): Promise<boolean> {
	try {
		return await isOpenCodeInstalled(homeDirectory);
	} catch {
		return false;
	}
}

function describeError(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
