import { execFile } from 'node:child_process';
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';

import {
	INSTALL_LATEST_PATH_UNIT_NAME,
	INSTALL_LATEST_SERVICE_UNIT_NAME,
	type InstallLayout,
	UPGRADE_PATH_UNIT_NAME,
	UPGRADE_SERVICE_UNIT_NAME,
} from './layout.js';
import type { Systemd } from './systemd.js';
import {
	renderUpgradePathUnit,
	renderUpgradeServiceUnit,
	UPGRADE_HELPER_ENVIRONMENT,
} from './unit.js';

/**
 * Writing, detecting, and removing the system-scope upgrade helper.
 *
 * Everything that writes here runs as root and only for a system-scope
 * install. The units are root-owned and 0644 like the service unit beside
 * them; the request directory is the single thing handed to the run-as
 * account.
 */

const execFileAsync = promisify(execFile);

/** Is this process the helper's own oneshot? See `UPGRADE_HELPER_ENVIRONMENT`. */
export function isUpgradeHelperProcess(
	env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	return env[UPGRADE_HELPER_ENVIRONMENT] === '1';
}

async function exists(path: string): Promise<boolean> {
	return (await readFile(path).catch(() => undefined)) !== undefined;
}

/**
 * Both units present. Read with no privilege, so the unprivileged server can
 * ask whether it is able to upgrade itself.
 */
export async function upgradeHelperInstalled(
	layout: InstallLayout,
): Promise<boolean> {
	const helper = layout.upgradeHelper;
	if (helper === undefined) return false;
	return (
		(await exists(helper.pathUnitPath)) &&
		(await exists(helper.serviceUnitPath))
	);
}

/**
 * The install-latest pair present (ADR-0117). An install whose helper predates
 * it upgrades forward as before, and gains it at its next `daemon upgrade`.
 */
export async function installLatestHelperInstalled(
	layout: InstallLayout,
): Promise<boolean> {
	const helper = layout.upgradeHelper;
	if (helper === undefined) return false;
	return (
		(await exists(helper.latestPathUnitPath)) &&
		(await exists(helper.latestServiceUnitPath))
	);
}

async function uidOf(account: string): Promise<number | undefined> {
	try {
		const { stdout } = await execFileAsync('id', ['-u', account], {
			timeout: 30_000,
		});
		const uid = Number(stdout.trim());
		return /^\d+$/u.test(stdout.trim()) && Number.isSafeInteger(uid)
			? uid
			: undefined;
	} catch {
		return undefined;
	}
}

/** The request directory and file exist, owner-only, owned by the account. */
async function requestDirectoryPrepared(
	layout: InstallLayout,
	runAs: string,
): Promise<boolean> {
	const helper = layout.upgradeHelper;
	if (helper === undefined) return false;
	const directory = await lstat(helper.requestDirectory).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code !== 'ENOENT') throw error;
			return undefined;
		},
	);
	if (directory === undefined) return false;
	if (!directory.isDirectory())
		throw new Error(`Unsafe upgrade request directory: ${helper.requestDirectory}`);
	const [file, latest] = await Promise.all([
		lstat(helper.requestFile).catch(() => undefined),
		lstat(helper.latestRequestFile).catch(() => undefined),
	]);
	if (directory === undefined || file === undefined || latest === undefined)
		return false;
	if (
		(directory.mode & 0o777) !== 0o700 ||
		!file.isFile() || file.nlink !== 1 ||
		!latest.isFile() || latest.nlink !== 1 ||
		(file.mode & 0o777) !== 0o600 ||
		(latest.mode & 0o777) !== 0o600
	)
		return false;
	const uid = await uidOf(runAs);
	return (
		uid !== undefined &&
		directory.uid === uid &&
		file.uid === uid &&
		latest.uid === uid
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
 * Write the units and the request directory, and have systemd watch.
 *
 * Returns whether a unit file changed. A watch that is already armed over a
 * request directory that is already right is left armed and untouched.
 */
export async function installUpgradeHelper(options: {
	readonly layout: InstallLayout;
	readonly runAs: string;
	readonly systemd: Systemd;
}): Promise<boolean> {
	const { layout, runAs, systemd } = options;
	const helper = layout.upgradeHelper;
	if (helper === undefined) return false;

	// Creating the request file, or changing its mode or owner, is a change to
	// the very file the path unit watches. So a request directory that is
	// already as it should be is left untouched — re-running an install must
	// not ask for an upgrade — and one that is not is put right with the watch
	// stopped, to be armed again below.
	if (!(await requestDirectoryPrepared(layout, runAs))) {
		if (await exists(helper.pathUnitPath))
			await systemd.stopUnit(UPGRADE_PATH_UNIT_NAME);
		if (await exists(helper.latestPathUnitPath))
			await systemd.stopUnit(INSTALL_LATEST_PATH_UNIT_NAME);
		// Root creates the directory and hands it to the run-as account alone,
		// so no other account can ask for an upgrade or see that one was asked
		// for.
		await mkdir(helper.requestDirectory, { recursive: true, mode: 0o700 });
		await chmod(helper.requestDirectory, 0o700);
		// Prepare only the two upgrade files in a private sibling directory.
		// The run-as account controls the destination entries, including any
		// old desktop trigger left there, so never open or chown them.
		const staging = await mkdtemp(join(dirname(helper.requestDirectory), '.upgrade-'));
		try {
			const requests = [helper.requestFile, helper.latestRequestFile].map(
				(path) => ({ path, temporary: join(staging, basename(path)) }),
			);
			for (const { temporary: path } of requests) {
				await writeFile(path, '', { flag: 'wx', mode: 0o600 });
				await chmod(path, 0o600);
			}
			await execFileAsync(
				'chown',
				[
					`${runAs}:${runAs}`,
					helper.requestDirectory,
					...requests.map(({ temporary }) => temporary),
				],
				{ timeout: 60_000 },
			);
			for (const { path, temporary } of requests) await rename(temporary, path);
		} finally {
			await rm(staging, { recursive: true, force: true });
		}
	}

	const wrotePath = await writeIfChanged(
		helper.pathUnitPath,
		renderUpgradePathUnit(layout),
	);
	const wroteService = await writeIfChanged(
		helper.serviceUnitPath,
		renderUpgradeServiceUnit(layout),
	);
	const wroteLatestPath = await writeIfChanged(
		helper.latestPathUnitPath,
		renderUpgradePathUnit(layout, 'install-latest'),
	);
	const wroteLatestService = await writeIfChanged(
		helper.latestServiceUnitPath,
		renderUpgradeServiceUnit(layout, 'install-latest'),
	);
	const wrote = wrotePath || wroteService || wroteLatestPath || wroteLatestService;
	if (wrote) await systemd.daemonReload();
	await systemd.enableNowUnit(UPGRADE_PATH_UNIT_NAME);
	await systemd.enableNowUnit(INSTALL_LATEST_PATH_UNIT_NAME);
	return wrote;
}

export async function removeUpgradeHelper(options: {
	readonly layout: InstallLayout;
	readonly systemd: Systemd;
}): Promise<void> {
	const { layout, systemd } = options;
	const helper = layout.upgradeHelper;
	if (helper === undefined) return;
	// Disabled and stopped before its file goes, or systemd keeps a watch armed
	// for a unit whose definition no longer exists.
	await systemd.disableNowUnit(UPGRADE_PATH_UNIT_NAME);
	await systemd.disableNowUnit(INSTALL_LATEST_PATH_UNIT_NAME);
	await rm(helper.pathUnitPath, { force: true });
	await rm(helper.serviceUnitPath, { force: true });
	await rm(helper.latestPathUnitPath, { force: true });
	await rm(helper.latestServiceUnitPath, { force: true });
	await rm(helper.requestDirectory, { recursive: true, force: true });
	await systemd.resetFailedUnit(UPGRADE_PATH_UNIT_NAME);
	await systemd.resetFailedUnit(UPGRADE_SERVICE_UNIT_NAME);
	await systemd.resetFailedUnit(INSTALL_LATEST_PATH_UNIT_NAME);
	await systemd.resetFailedUnit(INSTALL_LATEST_SERVICE_UNIT_NAME);
}
