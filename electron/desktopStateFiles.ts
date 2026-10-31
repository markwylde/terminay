import { mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
	loadCanonicalState,
	loadCanonicalStateSync,
	loadRebuildableStateSync,
	loadSecretStateSync,
	writeFileDurably,
	writeFileDurablySync,
} from '../packages/server-core/src/durableFile.ts';

/**
 * Desktop's own state files in the user-data root, read and replaced as
 * ADR-0088 requires. Each reader names its kind: a canonical file that is
 * corrupt falls back to its `.previous` copy or throws StateUnreadableError,
 * a secret file fails closed as empty, and a rebuildable file reads as
 * missing. None of them returns defaults for a file it could not read; the
 * caller supplies first-run state only for a file that does not exist.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const plainObject = (value: unknown): Record<string, unknown> | undefined =>
	isPlainObject(value) ? value : undefined;

const array = (value: unknown): unknown[] | undefined =>
	Array.isArray(value) ? value : undefined;

async function writeCanonical(file: string, body: string): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
	await writeFileDurably(file, body, { mode: 0o600, keepPrevious: true });
}

function writeCanonicalSync(file: string, body: string): void {
	mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	writeFileDurablySync(file, body, { mode: 0o600, keepPrevious: true });
}

function writeUnversionedSync(file: string, body: string): void {
	mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	writeFileDurablySync(file, body, { mode: 0o600 });
}

// server-settings.v1.json ---------------------------------------------------

/** The stored server settings, or `migrate()` when there are none yet. The
 * repository normalises the content, so only its outer shape is checked. */
export async function loadDesktopServerSettings(
	file: string,
	migrate: () => unknown,
): Promise<unknown> {
	const stored = await loadCanonicalState(file, 'server-settings', {
		validate: plainObject,
		mode: 0o600,
	});
	return stored === undefined ? migrate() : stored;
}

export function commitDesktopServerSettings(
	file: string,
	state: unknown,
): Promise<void> {
	return writeCanonical(file, JSON.stringify(state));
}

// server-macros.v1.json -----------------------------------------------------

/** Macro state is an object; a bare array is the pre-revision list form. */
export async function loadDesktopMacros(
	file: string,
	migrate: () => unknown,
): Promise<unknown> {
	const stored = await loadCanonicalState(file, 'macros', {
		validate: (value) =>
			isPlainObject(value) || Array.isArray(value) ? value : undefined,
		mode: 0o600,
	});
	return stored === undefined ? migrate() : stored;
}

export function commitDesktopMacros(
	file: string,
	state: unknown,
): Promise<void> {
	return writeCanonical(file, JSON.stringify(state));
}

// terminal-settings.json and remote-access-settings.json -------------------

/** Device terminal settings, or undefined when none were saved yet. */
export function readDeviceSettingsFile(file: string): unknown {
	return loadCanonicalStateSync(file, 'device-settings', {
		validate: plainObject,
		mode: 0o600,
	});
}

export function writeDeviceSettingsFile(file: string, settings: unknown): void {
	writeCanonicalSync(file, JSON.stringify(settings, null, 2));
}

/** Remote access settings, or undefined when none were saved yet. */
export function readRemoteAccessSettingsFile(file: string): unknown {
	return loadCanonicalStateSync(file, 'remote-access-settings', {
		validate: plainObject,
		mode: 0o600,
	});
}

export function writeRemoteAccessSettingsFile(
	file: string,
	settings: unknown,
): void {
	writeCanonicalSync(file, JSON.stringify(settings, null, 2));
}

// connection-profiles.json --------------------------------------------------

/** Remembered connection profiles as stored; entries are checked by the
 * caller. Undefined when the file does not exist. */
export function readConnectionProfilesFile(
	file: string,
): unknown[] | undefined {
	return loadCanonicalStateSync(file, 'connection-profiles', {
		validate: array,
		mode: 0o600,
	});
}

export function writeConnectionProfilesFile(
	file: string,
	profiles: readonly unknown[],
): void {
	writeCanonicalSync(file, JSON.stringify(profiles));
}

// remote-devices.v1.json ----------------------------------------------------

/**
 * The paired remote devices. This is a revocation store: a corrupt list, or
 * one `validate` rejects, is set aside and reads as empty, so no device is
 * admitted and every device pairs again. It never stops startup and never
 * rolls back to an older list.
 */
export function loadRemoteDeviceList(
	file: string,
	validate: (devices: unknown[]) => void,
): unknown[] {
	return (
		loadSecretStateSync(file, 'remote-devices', {
			validate: (value) => {
				if (!Array.isArray(value)) return undefined;
				validate(value);
				return value;
			},
		}) ?? []
	);
}

export function saveRemoteDeviceList(file: string, records: unknown): void {
	writeUnversionedSync(file, JSON.stringify(records));
}

// mcp-capabilities.v1.json --------------------------------------------------

/** Capability digests for live terminals. Corrupt means none: every terminal
 * must be granted again. Undefined when nothing was saved. */
export function loadMcpCapabilityDigests(file: string): unknown[] | undefined {
	return loadSecretStateSync(file, 'mcp-capabilities', { validate: array });
}

export function saveMcpCapabilityDigests(file: string, digests: unknown): void {
	writeUnversionedSync(file, JSON.stringify(digests));
}

// window-server.v1.json -----------------------------------------------------

/** Which server the workspace window last showed. Rebuildable: a corrupt
 * record reads as none and the window reopens on Local. */
export function readWindowServerMemory(file: string): string | undefined {
	return loadRebuildableStateSync(file, 'window-server', {
		validate: (value) =>
			isPlainObject(value) && typeof value.profileId === 'string'
				? value.profileId
				: undefined,
	});
}

export function writeWindowServerMemory(file: string, profileId: string): void {
	writeUnversionedSync(file, JSON.stringify({ profileId }));
}
