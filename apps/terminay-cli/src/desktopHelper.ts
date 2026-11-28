import { execFile } from 'node:child_process';
import {
	chmod,
	mkdir,
	open,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import {
	DESKTOP_SETUP_PATH_UNIT_NAME,
	DESKTOP_SETUP_SERVICE_UNIT_NAME,
	type InstallLayout,
} from './layout.js';
import type { Systemd } from './systemd.js';
import {
	renderDesktopSetupPathUnit,
	renderDesktopSetupServiceUnit,
} from './unit.js';

/**
 * Writing, detecting, and removing the system-scope desktop-setup helper.
 *
 * It sits beside the upgrade helper and shares its request directory, which
 * only the run-as account can enter. Everything that writes here runs as
 * root. Unlike the upgrade helper's units, these are never the unit a
 * running upgrade is inside, so an upgrade may write them whoever started it.
 */

const execFileAsync = promisify(execFile);

async function exists(path: string): Promise<boolean> {
	return (await readFile(path).catch(() => undefined)) !== undefined;
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
		(await stat(helper.desktopRequestFile).then(
			() => true,
			() => false,
		))
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

	let changed = false;
	const trigger = await stat(helper.desktopRequestFile).catch(() => undefined);
	if (trigger === undefined || (trigger.mode & 0o777) !== 0o600) {
		// Creating the file is a change to what the path unit watches, so it is
		// made with the watch stopped.
		if (await exists(helper.desktopPathUnitPath))
			await systemd.stopUnit(DESKTOP_SETUP_PATH_UNIT_NAME);
		await mkdir(helper.requestDirectory, { recursive: true, mode: 0o700 });
		await chmod(helper.requestDirectory, 0o700);
		await (await open(helper.desktopRequestFile, 'a', 0o600)).close();
		await chmod(helper.desktopRequestFile, 0o600);
		await execFileAsync(
			'chown',
			[`${runAs}:${runAs}`, helper.requestDirectory, helper.desktopRequestFile],
			{ timeout: 60_000 },
		);
		changed = true;
	}
	const wrotePath = await writeIfChanged(
		helper.desktopPathUnitPath,
		renderDesktopSetupPathUnit(layout),
	);
	const wroteService = await writeIfChanged(
		helper.desktopServiceUnitPath,
		renderDesktopSetupServiceUnit(layout),
	);
	if (wrotePath || wroteService) await systemd.daemonReload();
	// Nothing written means an earlier run armed the watch: an upgrade with
	// nothing to repair touches no unit.
	if (changed || wrotePath || wroteService)
		await systemd.enableNowUnit(DESKTOP_SETUP_PATH_UNIT_NAME);
	return changed || wrotePath || wroteService;
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
	await rm(helper.desktopRequestFile, { force: true });
	await systemd.resetFailedUnit(DESKTOP_SETUP_PATH_UNIT_NAME);
	await systemd.resetFailedUnit(DESKTOP_SETUP_SERVICE_UNIT_NAME);
}
