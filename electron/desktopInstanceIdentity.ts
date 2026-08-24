import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
	chmodSync,
	closeSync,
	existsSync,
	fsyncSync,
	linkSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';

/** The historical embedded identity was shared by every Desktop profile. */
export const LEGACY_EMBEDDED_SERVER_ID = 'desktop-local';
export const DESKTOP_INSTANCE_ID_FILE = 'desktop-instance.v1.json';

const INSTANCE_ID = /^desktop-[A-Za-z0-9_-]{32,96}$/u;
const INSTANCE_FILE_KEYS = new Set(['id', 'schemaVersion']);

export interface DesktopInstanceIdentity {
	readonly id: string;
	readonly dataRoot: string;
}

/**
 * Resolve the embedded server authority for exactly one Electron user-data
 * root. The identifier is intentionally random and durable: application
 * names, project names, process ids, paths, and window ids are not identity.
 */
export function resolveDesktopInstanceIdentity(
	dataRoot: string,
): DesktopInstanceIdentity {
	if (typeof dataRoot !== 'string' || dataRoot.trim().length === 0)
		throw new TypeError('desktop user-data root is required');
	const resolvedDataRoot = path.resolve(dataRoot);
	const filePath = path.join(resolvedDataRoot, DESKTOP_INSTANCE_ID_FILE);
	mkdirSync(resolvedDataRoot, { recursive: true, mode: 0o700 });
	try {
		chmodSync(resolvedDataRoot, 0o700);
	} catch {
		// Windows does not expose POSIX directory modes.
	}
	if (!existsSync(filePath)) writeNewIdentityFile(filePath);
	return Object.freeze({
		dataRoot: resolvedDataRoot,
		id: readIdentityFile(filePath),
	});
}

/** Local profile ids are namespaced by the same opaque server authority. */
export function localEmbeddedProfileId(serverId: string): string {
	assertDesktopInstanceId(serverId);
	return `local:${createHash('sha256')
		.update(`embedded-local-profile\0${serverId}`)
		.digest('base64url')}`;
}

/** The persistent Chromium partition never shares Local cookies/cache between
 * two Desktop data roots, even when their project/session ids happen to match. */
export function desktopLocalServerUiPartitionKey(
	serverId: string,
	profileId = localEmbeddedProfileId(serverId),
): string {
	assertDesktopInstanceId(serverId);
	if (profileId !== localEmbeddedProfileId(serverId))
		throw new TypeError(
			'desktop Local profile does not belong to this instance',
		);
	return randomFreeHash(`${serverId}\0${profileId}`);
}

/** Electron-owned embedded storage locations. Keeping this map central makes
 * new services opt into the exact user-data-root boundary rather than recreate
 * a name-derived authority. */
export function desktopEmbeddedStorePaths(identity: DesktopInstanceIdentity): {
	readonly projectEnvironments: string;
	readonly recordingLibrary: string;
	readonly recordings: string;
	readonly uiBundles: string;
	readonly workspace: string;
} {
	assertDesktopInstanceId(identity.id);
	const root = path.resolve(identity.dataRoot);
	return Object.freeze({
		projectEnvironments: path.join(root, 'project-environments.v1.json'),
		recordingLibrary: path.join(root, 'server-recording-roots.v1.json'),
		recordings: path.join(root, 'server-recordings'),
		uiBundles: path.join(root, 'ui-bundles'),
		workspace: path.join(root, 'workspace.v3.json'),
	});
}

/** Rewrite only the historical canonical identity, retaining every opaque
 * workspace/project/session id. A foreign identity remains foreign and is
 * rejected by the normal repository validation boundary. */
export function migrateLegacyEmbeddedWorkspaceServerId(
	input: unknown,
	serverId: string,
): unknown {
	assertDesktopInstanceId(serverId);
	if (!record(input) || input.serverId !== LEGACY_EMBEDDED_SERVER_ID)
		return input;
	return {
		...input,
		serverId,
		views: migrateNestedServerRecords(input.views, serverId),
		projects: migrateNestedServerRecords(input.projects, serverId),
		terminalSessions: migrateNestedServerRecords(
			input.terminalSessions,
			serverId,
		),
	};
}

export function migrateLegacyEmbeddedProjectEnvironmentServerId(
	input: unknown,
	serverId: string,
): unknown {
	assertDesktopInstanceId(serverId);
	if (!record(input) || input.serverId !== LEGACY_EMBEDDED_SERVER_ID)
		return input;
	return { ...input, serverId };
}

export function migrateLegacyEmbeddedRecordingServerId<
	T extends {
		readonly serverId: string | null;
	},
>(input: T, serverId: string): T {
	assertDesktopInstanceId(serverId);
	return input.serverId === LEGACY_EMBEDDED_SERVER_ID
		? ({ ...input, serverId } as T)
		: input;
}

function migrateNestedServerRecords(value: unknown, serverId: string): unknown {
	if (!record(value)) return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [
			key,
			record(entry) && entry.serverId === LEGACY_EMBEDDED_SERVER_ID
				? { ...entry, serverId }
				: entry,
		]),
	);
}

function writeNewIdentityFile(filePath: string): void {
	const candidate = JSON.stringify({
		id: `desktop-${randomBytes(32).toString('base64url')}`,
		schemaVersion: 1,
	});
	const temporary = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${randomUUID()}.tmp`,
	);
	let descriptor: number | undefined;
	try {
		descriptor = openSync(temporary, 'wx', 0o600);
		writeFileSync(descriptor, `${candidate}\n`, 'utf8');
		fsyncSync(descriptor);
		closeSync(descriptor);
		descriptor = undefined;
		try {
			// Hard-link creation is no-clobber. A concurrent Electron process
			// therefore adopts the winning identity instead of rotating it.
			linkSync(temporary, filePath);
		} catch (error) {
			if (!isAlreadyExists(error)) throw error;
		}
		try {
			chmodSync(filePath, 0o600);
		} catch {
			// Windows does not expose POSIX file modes.
		}
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
		rmSync(temporary, { force: true });
	}
}

function readIdentityFile(filePath: string): string {
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(filePath, 'utf8'));
	} catch (error) {
		throw new Error('Desktop instance identity cannot be read.', {
			cause: error,
		});
	}
	if (
		!record(value) ||
		Object.keys(value).some((key) => !INSTANCE_FILE_KEYS.has(key))
	)
		throw new Error('Desktop instance identity is invalid.');
	if (value.schemaVersion !== 1 || typeof value.id !== 'string')
		throw new Error('Desktop instance identity is invalid.');
	assertDesktopInstanceId(value.id);
	return value.id;
}

function assertDesktopInstanceId(value: string): void {
	if (!INSTANCE_ID.test(value))
		throw new TypeError('desktop instance identity is invalid');
}

function randomFreeHash(value: string): string {
	// Stable, opaque and safe for Electron's persistent partition namespace.
	return createHash('sha256').update(value).digest('base64url');
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAlreadyExists(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		(error as { code?: unknown }).code === 'EEXIST'
	);
}
