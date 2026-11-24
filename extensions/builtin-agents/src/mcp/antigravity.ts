import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { atomicWriteConfig } from './atomicConfigWrite.js';
import type {
	McpAgentRegistrationState,
	McpInstallActionResult,
	McpInstallWriteOptions,
	McpServerCommand,
} from './types.js';

const SERVER_KEY = 'terminay';

/**
 * Absolute path to Antigravity CLI's user-level MCP configuration
 * (`~/.gemini/config/mcp_config.json`), the file `agy mcp` manages.
 */
export function getAntigravityConfigPath(homeDirectory = homedir()): string {
	return join(homeDirectory, '.gemini', 'config', 'mcp_config.json');
}

interface AntigravityServerEntry {
	command: string;
	args: string[];
	env?: Record<string, string>;
}

interface AntigravityConfig {
	mcpServers?: Record<string, unknown>;
	[key: string]: unknown;
}

async function readConfig(
	path: string,
): Promise<{ config: AntigravityConfig } | { error: string }> {
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
		if (
			parsed === null ||
			typeof parsed !== 'object' ||
			Array.isArray(parsed)
		) {
			return {
				error: `${path} does not contain a JSON object; refusing to overwrite it.`,
			};
		}
		const config = parsed as AntigravityConfig;
		if (
			config.mcpServers !== undefined &&
			(config.mcpServers === null ||
				typeof config.mcpServers !== 'object' ||
				Array.isArray(config.mcpServers))
		) {
			return {
				error: `${path} contains an unsupported mcpServers value; refusing to overwrite it.`,
			};
		}
		return { config };
	} catch {
		return {
			// JSON.parse errors can quote configuration containing credentials.
			error: `Could not parse ${path} as JSON; refusing to overwrite it.`,
		};
	}
}

/**
 * agy lists an entry without `disabled` as enabled, so Terminay never writes
 * the key. An entry that carries it still differs from what Terminay writes.
 */
function expectedEntry(server: McpServerCommand): AntigravityServerEntry {
	const entry: AntigravityServerEntry = {
		command: server.command,
		args: server.args,
	};
	if (server.env !== undefined) entry.env = server.env;
	return entry;
}

/** True when a `terminay` MCP server entry already exists in Antigravity CLI's MCP configuration. */
export async function isAntigravityInstalled(
	homeDirectory?: string,
): Promise<boolean> {
	const result = await readConfig(getAntigravityConfigPath(homeDirectory));
	return (
		!('error' in result) &&
		result.config.mcpServers !== undefined &&
		SERVER_KEY in result.config.mcpServers
	);
}

export async function inspectAntigravityRegistration(
	server: McpServerCommand,
	homeDirectory?: string,
): Promise<{ state: McpAgentRegistrationState; message?: string }> {
	const result = await readConfig(getAntigravityConfigPath(homeDirectory));
	if ('error' in result) return { state: 'unavailable', message: result.error };
	const existing = result.config.mcpServers?.[SERVER_KEY];
	if (existing === undefined) return { state: 'not-installed' };
	return isDeepStrictEqual(existing, expectedEntry(server))
		? { state: 'installed' }
		: {
				state: 'changed',
				message:
					'The existing Terminay MCP entry differs from this version of Terminay.',
			};
}

/** Register the Terminay stdio server without changing agy's tool permission policy. */
export async function installAntigravity(
	server: McpServerCommand,
	homeDirectory?: string,
	/** `replace` writes over a changed `terminay` entry; set only on an explicit user request. */
	options: McpInstallWriteOptions = {},
): Promise<McpInstallActionResult> {
	const path = getAntigravityConfigPath(homeDirectory);
	try {
		const result = await readConfig(path);
		if ('error' in result)
			return {
				ok: false,
				installed: await safeIsInstalled(homeDirectory),
				error: result.error,
			};

		const config = result.config;
		const servers = config.mcpServers ?? {};
		const entry = expectedEntry(server);
		const existing = servers[SERVER_KEY];
		if (
			existing !== undefined &&
			!options.replace &&
			!isDeepStrictEqual(existing, entry)
		)
			return changedEntryResult(path);
		if (isDeepStrictEqual(existing, entry)) {
			return {
				ok: true,
				installed: true,
				message: `terminay is already registered in ${path}`,
			};
		}

		servers[SERVER_KEY] = entry;
		config.mcpServers = servers;
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

/**
 * Remove only Terminay's MCP entry from Antigravity CLI's MCP configuration.
 * A `disabled` flag set through `agy mcp disable` does not stop removal.
 */
export async function uninstallAntigravity(
	server?: McpServerCommand,
	homeDirectory?: string,
): Promise<McpInstallActionResult> {
	const path = getAntigravityConfigPath(homeDirectory);
	try {
		const result = await readConfig(path);
		if ('error' in result)
			return {
				ok: false,
				installed: await safeIsInstalled(homeDirectory),
				error: result.error,
			};

		const config = result.config;
		if (!config.mcpServers || !(SERVER_KEY in config.mcpServers)) {
			return {
				ok: true,
				installed: false,
				message: 'terminay was not registered',
			};
		}
		if (
			server !== undefined &&
			!isDeepStrictEqual(
				withoutDisabledFlag(config.mcpServers[SERVER_KEY]),
				expectedEntry(server),
			)
		) {
			return changedEntryResult(path);
		}

		delete config.mcpServers[SERVER_KEY];
		await atomicWriteConfig(path, `${JSON.stringify(config, null, 2)}\n`);
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

function withoutDisabledFlag(entry: unknown): unknown {
	if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
		return entry;
	const { disabled: _disabled, ...rest } = entry as Record<string, unknown>;
	return rest;
}

function changedEntryResult(path: string): McpInstallActionResult {
	return {
		ok: false,
		installed: true,
		error: `The existing terminay entry in ${path} has changed; review it before replacing it.`,
	};
}

async function safeIsInstalled(homeDirectory?: string): Promise<boolean> {
	try {
		return await isAntigravityInstalled(homeDirectory);
	} catch {
		return false;
	}
}

function describeError(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
