import type { JsonValue } from '@terminay/protocol';
import { classifySetting, SETTING_AUTHORITY } from './classification.js';
import { isSettingsObject, type SettingsObject } from './types.js';

/**
 * The server settings an MCP caller may read and change (ADR-0072). This is an
 * allow-list, not a deny-list: a setting added to `SETTING_AUTHORITY` later is
 * unreachable until someone adds it here, so a new credential-bearing setting
 * never becomes agent-writable by default.
 *
 * Left out, whatever `SETTING_AUTHORITY` says: the Terminay MCP settings (the
 * Enable switch and every permission policy), Remote Access, recording (which
 * would be recording control in all but name), the shell and shell profile
 * settings, which the shell profile tools manage, and shell integration, which
 * decides what runs in every new shell. Device-local settings are
 * never server-owned, so they cannot appear.
 */
export const MCP_EXCLUDED_SETTING_KEYS: ReadonlySet<string> = new Set([
	'terminayMcp',
	'remoteAccess',
	'recording',
	'shell',
	'shellIntegration',
	'shellProfiles',
]);

const ALLOWED_SETTING_KEYS = [
	'agentIntegration',
	'aiTabMetadata',
	'activityIndicators',
	'autoCloseTerminalOnExitZero',
	'convertEol',
	'dictation',
	'disableStdin',
	'fileViewer',
	'gitPushAgent',
	'ignoreBracketedPasteMode',
	'keepTerminalsAfterQuit',
	'macros',
	'moveTerminalsIntoNewWorktreeFolders',
	'pixel',
	'programSetTabTitles',
	'rightClickSelectsWord',
	'scrollback',
	'scrollOnEraseInDisplay',
	'scrollOnUserInput',
	'scrollSensitivity',
	'smoothScrollDuration',
	'tabStopWidth',
	'wordSeparator',
] as const;

/**
 * Top-level server settings MCP reaches: the allow-list above, kept only where
 * `SETTING_AUTHORITY` still names the key server-owned and it is not excluded.
 */
export const MCP_REACHABLE_SETTING_PATHS: readonly string[] = Object.freeze(
	ALLOWED_SETTING_KEYS.filter(
		(key) =>
			SETTING_AUTHORITY[key] === 'server' &&
			!MCP_EXCLUDED_SETTING_KEYS.has(key),
	),
);

const REACHABLE = new Set<string>(MCP_REACHABLE_SETTING_PATHS);
const SECRET_SEGMENT =
	/(?:secret|token|password|passphrase|credential|privatekey|api[_-]?key|plaintext|pairingpinhash)/i;
const PATH_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_/-]{0,127}$/u;
export const MAX_MCP_SETTING_PATH_CHARS = 256;

/** Why MCP may not name a setting path, or undefined when it may. */
export function mcpSettingPathRefusal(
	path: string,
): 'invalid' | 'excluded' | undefined {
	if (
		typeof path !== 'string' ||
		path.length === 0 ||
		path.length > MAX_MCP_SETTING_PATH_CHARS
	)
		return 'invalid';
	const segments = path.split('.');
	if (segments.some((segment) => !PATH_SEGMENT.test(segment))) return 'invalid';
	if (!REACHABLE.has(segments[0] as string)) return 'excluded';
	// A secret reference or a device's own value is never reachable, at any depth.
	if (segments.some((segment) => SECRET_SEGMENT.test(segment)))
		return 'excluded';
	return classifySetting(path) === 'server' ? undefined : 'excluded';
}

export function isMcpReachableSettingPath(path: string): boolean {
	return mcpSettingPathRefusal(path) === undefined;
}

/**
 * The reachable part of a server settings object: only allow-listed top-level
 * keys, with any secret-named or device-owned value removed at every depth.
 */
export function mcpReachableSettings(settings: SettingsObject): SettingsObject {
	const result: Record<string, JsonValue> = {};
	for (const key of MCP_REACHABLE_SETTING_PATHS) {
		const value = settings[key];
		if (value !== undefined) result[key] = reachableValue(value, key);
	}
	return result;
}

function reachableValue(value: JsonValue, path: string): JsonValue {
	if (!isSettingsObject(value)) return structuredClone(value);
	const result: Record<string, JsonValue> = {};
	for (const [key, child] of Object.entries(value)) {
		const childPath = `${path}.${key}`;
		if (SECRET_SEGMENT.test(key) || classifySetting(childPath) !== 'server')
			continue;
		result[key] = reachableValue(child, childPath);
	}
	return result;
}
