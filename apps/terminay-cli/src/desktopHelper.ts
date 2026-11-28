import { execFile } from 'node:child_process';
import type { Stats } from 'node:fs';
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import {
	DESKTOP_SETUP_PATH_UNIT_NAME,
	DESKTOP_SETUP_SERVICE_UNIT_NAME,
	type InstallLayout,
	readInstallRecord,
} from './layout.js';
import type { Systemd } from './systemd.js';
import {
	renderDesktopSetupPathUnit,
	renderDesktopSetupServiceUnit,
} from './unit.js';

/**
 * Writing, detecting, and removing the system-scope desktop-setup helper.
 *
 * The trigger lives in a directory under root control. The run-as account
 * owns the file so it can change it, and root alone can replace its name.
 */

const execFileAsync = promisify(execFile);

async function exists(path: string): Promise<boolean> {
	return (await readFile(path).catch(() => undefined)) !== undefined;
}

function entry(path: string) {
	return lstat(path).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== 'ENOENT') throw error;
		return undefined;
	});
}

function trustedDirectory(found: Stats | undefined): found is Stats {
	return found?.isDirectory() === true &&
		found.uid === process.getuid?.() && (found.mode & 0o022) === 0;
}

function singleLinkFile(found: Stats | undefined): found is Stats {
	return found?.isFile() === true && found.nlink === 1;
}

async function replaceTrigger(directory: string, path: string, uid: number) {
	// Apply metadata to a newly created inode in a private directory, then
	// replace the destination name without opening any previous entry.
	const staging = await mkdtemp(join(directory, '.trigger-'));
	const temporary = join(staging, 'request');
	try {
		const file = await open(temporary, 'wx', 0o600);
		try {
			if (uid !== process.getuid?.()) await file.chown(uid, -1);
			await file.chmod(0o600);
		} finally {
			await file.close();
		}
		await rename(temporary, path);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

/** Both units and the trigger present. Read with no privilege. */
export async function desktopSetupHelperInstalled(
	layout: InstallLayout,
): Promise<boolean> {
	const helper = layout.upgradeHelper;
	if (helper === undefined) return false;
	return (
		(await exists(helper.desktopPathUnitPath)) &&
		(await exists(helper.desktopServiceUnitPath)) &&
		(await lstat(helper.desktopRequestDirectory).then(
			(found) => found.isDirectory() && (found.mode & 0o022) === 0,
			() => false,
		)) &&
		(await lstat(helper.desktopRequestFile).then(singleLinkFile, () => false))
	);
}

async function writeIfChanged(
	path: string,
	contents: string,
): Promise<boolean> {
	const current = await readFile(path, 'utf8').catch(() => undefined);
	if (current === contents) return false;
	await mkdir(dirname(path), { recursive: true, mode: 0o755 });
	await writeFile(path, contents, { mode: 0o644 });
	await chmod(path, 0o644);
	return true;
}

/**
 * Write the units and the trigger file, and have systemd watch. Returns
 * whether anything changed. A watch already armed over a trigger that is
 * already there is left alone: re-running an install must not ask for setup.
 */
export async function installDesktopSetupHelper(options: {
	readonly layout: InstallLayout;
	readonly runAs: string;
	readonly systemd: Systemd;
}): Promise<boolean> {
	const { layout, runAs, systemd } = options;
	const helper = layout.upgradeHelper;
	if (helper === undefined) return false;

	const { stdout } = await execFileAsync('id', ['-u', runAs], { timeout: 30_000 });
	const uid = Number(stdout.trim());
	if (!/^\d+$/u.test(stdout.trim()) || !Number.isSafeInteger(uid))
		throw new Error(`Could not determine the UID of ${runAs}.`);

	const directory = await entry(helper.desktopRequestDirectory);
	if (directory !== undefined && !trustedDirectory(directory))
		throw new Error(`Unsafe desktop setup directory: ${helper.desktopRequestDirectory}`);
	const trigger = await entry(helper.desktopRequestFile);
	const needsTrigger = !singleLinkFile(trigger) ||
		trigger.uid !== uid || (trigger.mode & 0o7777) !== 0o600;
	const needsDirectoryMode = ((directory?.mode ?? 0) & 0o7777) !== 0o755;
	const changed = needsDirectoryMode || needsTrigger;
	const pathUnit = renderDesktopSetupPathUnit(layout);
	const previousPathUnit = await readFile(helper.desktopPathUnitPath, 'utf8')
		.catch(() => undefined);
	if (previousPathUnit !== undefined && (changed || previousPathUnit !== pathUnit)) {
		const stopped = await systemd.stopUnit(DESKTOP_SETUP_PATH_UNIT_NAME);
		if (stopped.code !== 0 && await systemd.isActive(DESKTOP_SETUP_PATH_UNIT_NAME))
			throw new Error(`Could not stop ${DESKTOP_SETUP_PATH_UNIT_NAME}: ${stopped.stderr.trim()}`);
	}
	if (directory === undefined) {
		await mkdir(dirname(helper.desktopRequestDirectory), { recursive: true });
		await mkdir(helper.desktopRequestDirectory, { mode: 0o755 });
	}
	if (needsDirectoryMode)
		await chmod(helper.desktopRequestDirectory, 0o755);
	if (needsTrigger) {
		await replaceTrigger(helper.desktopRequestDirectory, helper.desktopRequestFile, uid);
	}
	const wrotePath = await writeIfChanged(
		helper.desktopPathUnitPath,
		pathUnit,
	);
	const wroteService = await writeIfChanged(
		helper.desktopServiceUnitPath,
		renderDesktopSetupServiceUnit(layout),
	);
	if (wrotePath || wroteService) await systemd.daemonReload();
	// A previous attempt may have written both units without arming the watch.
	const needsActivation =
		changed ||
		wrotePath ||
		wroteService ||
		!(await systemd.isEnabled(DESKTOP_SETUP_PATH_UNIT_NAME)) ||
		!(await systemd.isActive(DESKTOP_SETUP_PATH_UNIT_NAME));
	if (needsActivation)
		await systemd.enableNowUnit(DESKTOP_SETUP_PATH_UNIT_NAME);
	return needsActivation;
}

/** Apply the new release's helper when an older CLI drives the upgrade. */
export async function installDesktopSetupHelperFromRecord(
	layout: InstallLayout,
	systemd: Systemd,
): Promise<boolean> {
	if (layout.upgradeHelper === undefined) return false;
	const prefix = await entry(layout.prefix);
	if (prefix === undefined) return false;
	if (!trustedDirectory(prefix))
		throw new Error(`Unsafe system install directory: ${layout.prefix}`);
	const file = await entry(layout.recordPath);
	if (file === undefined) return false;
	if (
		!singleLinkFile(file) ||
		file.uid !== prefix.uid ||
		(file.mode & 0o022) !== 0
	)
		throw new Error(`Unsafe system install record: ${layout.recordPath}`);
	const record = await readInstallRecord(layout);
	if (record?.scope !== 'system') return false;
	return installDesktopSetupHelper({ layout, runAs: record.runAs, systemd });
}

/** Disarm the watch and remove the units and the trigger. */
export async function removeDesktopSetupHelper(options: {
	readonly layout: InstallLayout;
	readonly systemd: Systemd;
}): Promise<void> {
	const { layout, systemd } = options;
	const helper = layout.upgradeHelper;
	if (helper === undefined) return;
	if (await exists(helper.desktopPathUnitPath))
		await systemd.disableNowUnit(DESKTOP_SETUP_PATH_UNIT_NAME);
	// A setup that is running is ended with its helper: nothing would read
	// its outcome.
	if (await exists(helper.desktopServiceUnitPath))
		await systemd.stopUnit(DESKTOP_SETUP_SERVICE_UNIT_NAME);
	await rm(helper.desktopPathUnitPath, { force: true });
	await rm(helper.desktopServiceUnitPath, { force: true });
	if (trustedDirectory(await entry(helper.desktopRequestDirectory)))
		await rm(helper.desktopRequestDirectory, { recursive: true, force: true });
	await systemd.resetFailedUnit(DESKTOP_SETUP_PATH_UNIT_NAME);
	await systemd.resetFailedUnit(DESKTOP_SETUP_SERVICE_UNIT_NAME);
}
