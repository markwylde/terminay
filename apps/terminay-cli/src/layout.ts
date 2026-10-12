import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
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
/** What the last upgrade attempt did, beside `versions/`. See `outcome.ts`. */
export const UPGRADE_RESULT = 'upgrade-result.json';
export const UPGRADE_PATH_UNIT_NAME = 'terminay-upgrade.path';
export const UPGRADE_SERVICE_UNIT_NAME = 'terminay-upgrade.service';
export const UPGRADE_REQUEST_FILE = 'request';

/**
 * The part of a layout that staging and switching a version needs. A container
 * has only this much: versions on its data volume and the pointer beside them.
 */
export interface ReleaseTree {
	readonly prefix: string;
	readonly versionsDirectory: string;
	readonly currentLink: string;
	/** Where the outcome of the last upgrade attempt is recorded. */
	readonly resultPath: string;
}

/**
 * The system-scope upgrade helper: two root-owned units, and the one file the
 * run-as account changes to ask for an upgrade.
 *
 * The request directory is deliberately neither the data root nor the install
 * prefix. The data root holds server state, which no upgrade path may touch,
 * and a server that is being uninstalled with `--purge` must not take the
 * helper's trigger with it half-way through. The prefix is what root executes
 * from, so nothing under it may be writable by the run-as account. `/run`
 * would be the conventional home for a trigger, but it is emptied at boot and
 * recreating it there needs a tmpfiles entry — a third file to keep in step —
 * so the directory lives under `/var/lib`, created once by root, owned by the
 * run-as account, and mode 0700.
 */
export interface UpgradeHelperLayout {
	readonly pathUnitPath: string;
	readonly serviceUnitPath: string;
	readonly requestDirectory: string;
	readonly requestFile: string;
}

export interface InstallLayout extends ReleaseTree {
	readonly scope: InstallScope;
	readonly recordPath: string;
	readonly environmentFile: string;
	readonly defaultDataRoot: string;
	readonly unitPath: string;
	/** System scope only: a user-scope service upgrades as its own account. */
	readonly upgradeHelper?: UpgradeHelperLayout;
}

/**
 * `systemRoot` relocates the system layout for the tests, which cannot write
 * `/opt` and `/etc`. The `terminay` binary never passes it.
 */
export function installLayout(
	scope: InstallScope,
	home: string = homedir(),
	systemRoot = '/',
): InstallLayout {
	if (scope === 'system') {
		const prefix = join(systemRoot, 'opt/terminay');
		const units = join(systemRoot, 'etc/systemd/system');
		const requestDirectory = join(systemRoot, 'var/lib/terminay-upgrade');
		return Object.freeze({
			scope,
			prefix,
			versionsDirectory: join(prefix, 'versions'),
			currentLink: join(prefix, 'current'),
			resultPath: join(prefix, UPGRADE_RESULT),
			recordPath: join(prefix, INSTALL_RECORD),
			environmentFile: join(systemRoot, 'etc/terminay/server.env'),
			defaultDataRoot: join(systemRoot, 'var/lib/terminay'),
			unitPath: join(units, UNIT_NAME),
			upgradeHelper: Object.freeze({
				pathUnitPath: join(units, UPGRADE_PATH_UNIT_NAME),
				serviceUnitPath: join(units, UPGRADE_SERVICE_UNIT_NAME),
				requestDirectory,
				requestFile: join(requestDirectory, UPGRADE_REQUEST_FILE),
			}),
		});
	}
	const prefix = join(home, '.local/share/terminay');
	return Object.freeze({
		scope,
		prefix,
		versionsDirectory: join(prefix, 'versions'),
		currentLink: join(prefix, 'current'),
		resultPath: join(prefix, UPGRADE_RESULT),
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
	/** The one address or name devices reach this machine at, as given. */
	readonly publicHost?: string;
	readonly directOrigin?: string;
	/** An address and UDP port offered as an additional ICE candidate. */
	readonly advertiseAddress?: string;
	readonly installedAt: string;
}

export function parseInstallRecord(value: unknown): InstallRecord {
	if (typeof value !== 'object' || value === null)
		throw new Error('the install record is not readable');
	const record = value as Record<string, unknown>;
	if (record.schemaVersion !== 1)
		throw new Error('the install record has an unsupported schema version');
	for (const field of [
		'scope',
		'channel',
		'version',
		'revision',
		'runAs',
		'dataRoot',
		'projectRoot',
		'expose',
		'hostedDomain',
	]) {
		if (
			typeof record[field] !== 'string' ||
			(record[field] as string).length === 0
		) {
			throw new Error(`the install record is missing ${field}`);
		}
	}
	if (
		!Number.isSafeInteger(record.port) ||
		!Number.isSafeInteger(record.healthPort)
	) {
		throw new Error('the install record is missing its ports');
	}
	return record as unknown as InstallRecord;
}

export async function readInstallRecord(
	layout: InstallLayout,
): Promise<InstallRecord | undefined> {
	const raw = await readFile(layout.recordPath, 'utf8').catch(() => undefined);
	if (raw === undefined) return undefined;
	return parseInstallRecord(JSON.parse(raw));
}

export async function writeInstallRecord(
	layout: InstallLayout,
	record: InstallRecord,
): Promise<void> {
	// Replaced by rename so a command interrupted mid-write never leaves a
	// half-written record that the next command would refuse to parse.
	const temporary = `${layout.recordPath}.tmp`;
	await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
		mode: 0o644,
	});
	// Set outright rather than left to the umask: the account the server runs
	// as reads this record to learn what it can upgrade to, and root's umask
	// on a hardened machine would otherwise keep it from that account.
	await chmod(temporary, 0o644);
	await rename(temporary, layout.recordPath);
}

export function versionDirectory(layout: ReleaseTree, version: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(version))
		throw new Error(`unsafe version directory name: ${version}`);
	return join(layout.versionsDirectory, version);
}

/**
 * The rolling channel reuses the version string `main` for every build, so its
 * directories are named for the commit instead. Without this an upgrade would
 * try to stage a new build on top of the running one.
 */
export function stagedName(
	channel: ReleaseChannel,
	version: string,
	revision: string,
): string {
	return channel === 'tag' ? version : `${channel}-${revision.slice(0, 12)}`;
}
