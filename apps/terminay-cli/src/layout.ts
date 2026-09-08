import { readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { InstallScope } from './args.js';
import type { ReleaseChannel } from './resolve.js';

/**
 * Where an installation lives, and the one small record that describes it.
 *
 * Every version sits under `versions/<version>` and is immutable once
 * verified; `current` is a symbolic link swapped by rename. Nothing the CLI
 * does later edits a versioned directory, so an upgrade that fails can put
 * the link back and be exactly where it started.
 */

export const UNIT_NAME = 'terminay-server.service';
export const INSTALL_RECORD = 'install.json';

export interface InstallLayout {
	readonly scope: InstallScope;
	readonly prefix: string;
	readonly versionsDirectory: string;
	readonly currentLink: string;
	readonly recordPath: string;
	readonly environmentFile: string;
	readonly defaultDataRoot: string;
	readonly unitPath: string;
}

export function installLayout(scope: InstallScope, home: string = homedir()): InstallLayout {
	if (scope === 'system') {
		const prefix = '/opt/terminay';
		return Object.freeze({
			scope,
			prefix,
			versionsDirectory: join(prefix, 'versions'),
			currentLink: join(prefix, 'current'),
			recordPath: join(prefix, INSTALL_RECORD),
			environmentFile: '/etc/terminay/server.env',
			defaultDataRoot: '/var/lib/terminay',
			unitPath: join('/etc/systemd/system', UNIT_NAME),
		});
	}
	const prefix = join(home, '.local/share/terminay');
	return Object.freeze({
		scope,
		prefix,
		versionsDirectory: join(prefix, 'versions'),
		currentLink: join(prefix, 'current'),
		recordPath: join(prefix, INSTALL_RECORD),
		environmentFile: join(home, '.config/terminay/server.env'),
		defaultDataRoot: join(prefix, 'data'),
		unitPath: join(home, '.config/systemd/user', UNIT_NAME),
	});
}

/** What the CLI needs to remember between commands. It holds no secrets. */
export interface InstallRecord {
	readonly schemaVersion: 1;
	readonly scope: InstallScope;
	readonly channel: ReleaseChannel;
	readonly version: string;
	/** The commit the installed archive records in its own signed manifest. */
	readonly revision: string;
	readonly publishedAt?: string;
	readonly runAs: string;
	readonly dataRoot: string;
	readonly projectRoot: string;
	readonly port: number;
	readonly healthPort: number;
	readonly expose: string;
	readonly hostedDomain: string;
	readonly directOrigin?: string;
	readonly installedAt: string;
}

export function parseInstallRecord(value: unknown): InstallRecord {
	if (typeof value !== 'object' || value === null) throw new Error('the install record is not readable');
	const record = value as Record<string, unknown>;
	if (record.schemaVersion !== 1) throw new Error('the install record has an unsupported schema version');
	for (const field of ['scope', 'channel', 'version', 'revision', 'runAs', 'dataRoot', 'projectRoot', 'expose', 'hostedDomain']) {
		if (typeof record[field] !== 'string' || (record[field] as string).length === 0) {
			throw new Error(`the install record is missing ${field}`);
		}
	}
	if (!Number.isSafeInteger(record.port) || !Number.isSafeInteger(record.healthPort)) {
		throw new Error('the install record is missing its ports');
	}
	return record as unknown as InstallRecord;
}

export async function readInstallRecord(layout: InstallLayout): Promise<InstallRecord | undefined> {
	const raw = await readFile(layout.recordPath, 'utf8').catch(() => undefined);
	if (raw === undefined) return undefined;
	return parseInstallRecord(JSON.parse(raw));
}

export async function writeInstallRecord(layout: InstallLayout, record: InstallRecord): Promise<void> {
	// Replaced by rename so a command interrupted mid-write never leaves a
	// half-written record that the next command would refuse to parse.
	const temporary = `${layout.recordPath}.tmp`;
	await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
	await rename(temporary, layout.recordPath);
}

export function versionDirectory(layout: InstallLayout, version: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(version)) throw new Error(`unsafe version directory name: ${version}`);
	return join(layout.versionsDirectory, version);
}

/**
 * The rolling channel reuses the version string `main` for every build, so its
 * directories are named for the commit instead. Without this an upgrade would
 * try to stage a new build on top of the running one.
 */
export function stagedName(channel: ReleaseChannel, version: string, revision: string): string {
	return channel === 'tag' ? version : `${channel}-${revision.slice(0, 12)}`;
}
