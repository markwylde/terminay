import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DaemonOptions } from '../args.js';
import {
	type ContainerLayout,
	containerLayout,
	containerReleaseLabel,
	isAlive,
	markRelease,
	readPendingUpgrade,
	readStagedRecord,
	removeStagedRecord,
	runningRelease,
	selectRelease,
	supervisedServerPid,
	writePendingUpgrade,
	writeStagedRecord,
} from '../container.js';
import { discardDownloads } from '../download.js';
import { probeHealth, READINESS_TIMEOUT_MS } from '../health.js';
import { activeVersion, installArchive, retain } from '../install.js';
import { readArchiveManifest } from '../manifest.js';
import { releaseLabel, writeUpgradeOutcome } from '../outcome.js';
import {
	type InstalledRelease,
	NoChannelError,
	orderAgainstInstalled,
	resolveUpgradeTarget,
} from '../plan.js';
import type { ResolvedRef } from '../resolve.js';
import { obtainArchive, UpgradeError, type UpgradeResult } from './upgrade.js';

/**
 * `daemon upgrade` inside the official image — an upgrade in place.
 *
 * The image is fixed, so the new release is staged on the data volume instead:
 * downloaded and verified exactly as on a systemd host, unpacked under
 * `<data root>/releases/versions/`, and marked. The entrypoint, which stays
 * the container's main process, is then asked to start the server again and
 * selects the marked release. The container never stops, so the terminal
 * sessions held outside the server process carry on, and nothing here needs
 * the Docker socket or a writable root filesystem.
 *
 * The same promise holds as on a host: a release that does not come up ready
 * is unmarked and the previous one started again. Because a release that
 * cannot start at all would take the container down with it, the upgrade is
 * recorded as pending before the mark moves, and the entrypoint undoes a
 * pending upgrade itself if the server exits before this command confirms it.
 */

const POLL_INTERVAL_MS = 250;
/** The server's own graceful shutdown is bounded well inside this. */
const STOP_TIMEOUT_MS = 30_000;

export interface ContainerUpgradeDependencies {
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly repository?: string;
	readonly apiBase?: string;
	readonly webBase?: string;
	readonly readinessTimeoutMs?: number;
	readonly stopTimeoutMs?: number;
	/** See `InstallDependencies.releasePublicKeyPem`: a test seam, not a bypass. */
	readonly releasePublicKeyPem?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function reasonOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function readTrimmed(path: string): Promise<string> {
	return (await readFile(path, 'utf8').catch(() => '')).trim();
}

/**
 * Ask the entrypoint for a restart and end the running server.
 *
 * The marker is written first, so the entrypoint can never see the server exit
 * without it. Only the server's own process is signalled: the session holder
 * is a separate process and must keep running.
 */
async function restartServer(
	layout: ContainerLayout,
	pid: number,
	stopTimeoutMs: number,
): Promise<void> {
	await writeFile(layout.restartMarker, '', { mode: 0o644 });
	const signal = (name: NodeJS.Signals) => {
		try {
			process.kill(pid, name);
		} catch {
			// Already gone, which is the state being asked for.
		}
	};
	signal('SIGTERM');
	const deadline = Date.now() + stopTimeoutMs;
	while (isAlive(pid) && Date.now() < deadline) await sleep(POLL_INTERVAL_MS);
	if (isAlive(pid)) {
		// A server that outlives its own bounded shutdown is ended, as a
		// service manager would end it after its stop timeout.
		signal('SIGKILL');
		const killed = Date.now() + 5_000;
		while (isAlive(pid) && Date.now() < killed) await sleep(POLL_INTERVAL_MS);
	}
}

type Arrival = 'ready' | 'timed-out' | 'undone';

/**
 * Wait until a different server process, started from `release`, reports
 * ready. `undone` means the entrypoint gave up on the upgrade first: the
 * pending record is gone, so it has already restored the previous release.
 */
async function waitForRelease(
	layout: ContainerLayout,
	release: string,
	previousPid: number | undefined,
	timeoutMs: number,
	watchPending: boolean,
): Promise<Arrival> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (watchPending && (await readPendingUpgrade(layout)) === undefined)
			return 'undone';
		const pid = await supervisedServerPid(layout);
		if (
			pid !== undefined &&
			pid !== previousPid &&
			(await readTrimmed(layout.runningPath)) === release &&
			(await probeHealth(layout.healthPort))?.ready === true
		)
			return 'ready';
		if (Date.now() >= deadline) return 'timed-out';
		await sleep(POLL_INTERVAL_MS);
	}
}

export async function runContainerUpgrade(
	ref: string | undefined,
	options: DaemonOptions,
	context: { readonly write: (line: string) => void },
	dependencies: ContainerUpgradeDependencies = {},
): Promise<UpgradeResult> {
	const { write } = context;
	const env = dependencies.env ?? process.env;
	const layout = containerLayout(env);
	const readinessTimeoutMs =
		dependencies.readinessTimeoutMs ?? READINESS_TIMEOUT_MS;

	if (
		options.publicHost !== undefined ||
		options.advertiseAddress !== undefined
	) {
		throw new UpgradeError(
			'how a container is reached is set on the container, not by an upgrade. Set TERMINAY_PUBLIC_HOST or TERMINAY_WEBRTC_ADVERTISE_ADDRESS and recreate it.',
		);
	}

	const running = await runningRelease(layout);
	const serverPid = await supervisedServerPid(layout);
	if (!running.supervised || serverPid === undefined) {
		throw new UpgradeError(
			'the server in this container was not started by an entrypoint that can restart it on a new release, so it cannot be upgraded in place. Pull a newer image and recreate the container.',
		);
	}

	// One upgrade at a time. A pending record whose release is the one running
	// and ready belongs to an upgrade that finished without being confirmed;
	// anything else is an upgrade still under way.
	const unconfirmed = await readPendingUpgrade(layout);
	if (unconfirmed !== undefined) {
		const settled =
			running.staged === unconfirmed.next &&
			(await probeHealth(layout.healthPort))?.ready === true;
		if (!settled)
			throw new UpgradeError(
				'an upgrade is already in progress in this container.',
			);
		await rm(layout.pendingPath, { force: true });
	}

	// There is no install record in a container: what is running is whatever
	// the manifest of the running release says it is.
	const stagedRecord =
		running.staged === undefined
			? undefined
			: await readStagedRecord(layout, running.staged);
	const installed: InstalledRelease = {
		channel: running.manifest.channel,
		version: running.manifest.version,
		revision: running.manifest.revision,
		...(stagedRecord?.publishedAt === undefined
			? {}
			: { publishedAt: stagedRecord.publishedAt }),
	};
	const architecture = running.manifest.architecture;

	let resolved: ResolvedRef;
	try {
		resolved = await resolveUpgradeTarget(ref, installed, {
			architecture,
			...(dependencies.repository === undefined
				? {}
				: { repository: dependencies.repository }),
			...(dependencies.apiBase === undefined
				? {}
				: { apiBase: dependencies.apiBase }),
			...(dependencies.webBase === undefined
				? {}
				: { webBase: dependencies.webBase }),
		});
	} catch (error) {
		if (error instanceof NoChannelError) {
			throw new UpgradeError(
				'this image was built locally, so it has no release channel to follow. Name the release to upgrade to, or pull a newer image and recreate the container.',
			);
		}
		throw error;
	}

	const upToDate = (to: string): UpgradeResult =>
		Object.freeze({
			from: installed.version,
			to,
			rolledBack: false,
			upToDate: true,
		});
	const order = orderAgainstInstalled(resolved, installed);
	if (order === 'same') {
		write(
			resolved.channel === 'tag'
				? `Already on ${installed.version}. Nothing to do.`
				: `Already on the newest ${installed.channel} build. Nothing to do.`,
		);
		return upToDate(installed.version);
	}
	if (order === 'older' && !options.allowDowngrade) {
		throw new UpgradeError(
			resolved.channel === 'tag'
				? `refusing to move from ${installed.version} down to ${resolved.version}. Pass --allow-downgrade if that is what you want.`
				: `the ${resolved.channel} release published at ${resolved.publishedAt} is older than the running one from ${installed.publishedAt}. Pass --allow-downgrade to install it anyway.`,
		);
	}

	const fromLabel = containerReleaseLabel(running.manifest);
	await mkdir(layout.prefix, { recursive: true, mode: 0o755 });

	// Staged beside whatever is running: nothing below this point has touched
	// the server yet.
	let staged: Awaited<ReturnType<typeof installArchive>>;
	try {
		const archivePath = await obtainArchive({
			resolved,
			prefix: layout.prefix,
			write,
			...(dependencies.releasePublicKeyPem === undefined
				? {}
				: { releasePublicKeyPem: dependencies.releasePublicKeyPem }),
		});
		staged = await installArchive({
			layout,
			archivePath,
			channel: resolved.channel,
			expected: {
				channel: resolved.channel,
				architecture,
				...(resolved.channel === 'tag' ? { version: resolved.version } : {}),
				...(resolved.revision === undefined
					? {}
					: { revision: resolved.revision }),
			},
		});
	} catch (error) {
		await writeUpgradeOutcome(layout.resultPath, {
			from: fromLabel,
			to: releaseLabel(resolved.channel, resolved.version, resolved.revision),
			outcome: 'rolled-back',
			reason: `the new release could not be staged, so nothing was changed: ${reasonOf(error)}`,
		}).catch(() => undefined);
		await discardDownloads(layout.prefix).catch(() => undefined);
		throw error;
	}
	await discardDownloads(layout.prefix);
	const toLabel = containerReleaseLabel(staged.manifest);

	const image = await readArchiveManifest(layout.imageRelease).catch(
		() => undefined,
	);
	const describeStaged = () =>
		writeStagedRecord(layout, {
			name: staged.name,
			imageRevision: image?.revision ?? '',
			...(resolved.publishedAt === undefined
				? {}
				: { publishedAt: resolved.publishedAt }),
		});

	if (
		staged.manifest.revision === running.manifest.revision &&
		staged.manifest.version === running.manifest.version
	) {
		write(`Already running ${staged.manifest.version}. Nothing to do.`);
		if (running.staged === staged.name) {
			// Now known to be the published build, so the next check can answer
			// from the release metadata alone.
			await describeStaged();
		} else if ((await activeVersion(layout)) !== staged.name) {
			// The image already carries this build; a second copy is only disk.
			await rm(staged.directory, { recursive: true, force: true });
		}
		return upToDate(staged.manifest.version);
	}

	write(`Upgrading ${fromLabel} → ${toLabel} …`);
	const previous = running.staged ?? null;
	await describeStaged();
	await writePendingUpgrade(layout, {
		previous,
		next: staged.name,
		from: fromLabel,
		to: toLabel,
	});
	await markRelease(layout, staged.name);

	// The entrypoint starts what selection names, not what was marked. A
	// release it would pass over — one older than the image — is refused here
	// rather than discovered after the server has been stopped for nothing.
	const selected = await selectRelease(layout);
	if (selected.staged !== staged.name) {
		await markRelease(layout, previous);
		await rm(layout.pendingPath, { force: true });
		const reason = `this image would not start ${toLabel}: ${selected.skipped ?? 'it is not the release selection names'}.`;
		await writeUpgradeOutcome(layout.resultPath, {
			from: fromLabel,
			to: toLabel,
			outcome: 'rolled-back',
			reason,
		}).catch(() => undefined);
		throw new UpgradeError(reason);
	}

	await restartServer(
		layout,
		serverPid,
		dependencies.stopTimeoutMs ?? STOP_TIMEOUT_MS,
	);
	const arrival = await waitForRelease(
		layout,
		staged.directory,
		serverPid,
		readinessTimeoutMs,
		true,
	);

	if (arrival !== 'ready') {
		write('The upgraded server did not report ready. Rolling back.');
		const previousRoot =
			previous === null
				? layout.imageRelease
				: join(layout.versionsDirectory, previous);
		if (arrival === 'timed-out') {
			// Still pending, so the entrypoint has not acted: the mark goes back
			// and the server is restarted on it. The pending record is cleared
			// only once the marker is down, so a server that exits in between is
			// still undone by the entrypoint rather than ending the container.
			await markRelease(layout, previous).catch(() =>
				markRelease(layout, null),
			);
			const failedPid = await supervisedServerPid(layout);
			if (failedPid === undefined) {
				await writeFile(layout.restartMarker, '', { mode: 0o644 });
			} else {
				await restartServer(
					layout,
					failedPid,
					dependencies.stopTimeoutMs ?? STOP_TIMEOUT_MS,
				);
			}
			await rm(layout.pendingPath, { force: true });
		}
		const recovered =
			(await waitForRelease(
				layout,
				previousRoot,
				undefined,
				readinessTimeoutMs,
				false,
			)) === 'ready';
		const reason = `the upgrade to ${toLabel} did not become ready, so ${fromLabel} was restored and ${recovered ? 'is running again' : 'was started, but has not reported ready either'}.`;
		await writeUpgradeOutcome(layout.resultPath, {
			from: fromLabel,
			to: toLabel,
			outcome: 'rolled-back',
			reason,
		}).catch(() => undefined);
		throw new UpgradeError(reason);
	}

	// Confirmed: from here a server that exits is a server that exited, not an
	// upgrade that failed.
	await rm(layout.pendingPath, { force: true });
	const removed = await retain(layout, [staged.name, previous ?? '']);
	for (const name of removed) await removeStagedRecord(layout, name);
	await writeUpgradeOutcome(layout.resultPath, {
		from: fromLabel,
		to: toLabel,
		outcome: 'succeeded',
	});
	write(
		previous === null
			? `Upgraded to ${toLabel}. The release this image carries is kept to roll back to.`
			: `Upgraded to ${toLabel}. Kept ${previous} to roll back to.`,
	);
	if (removed.length > 0)
		write(`Removed older releases: ${removed.join(', ')}.`);
	write(
		'This release runs after every restart of this container, and of any container created from this image on the same data volume.',
	);

	return Object.freeze({
		from: installed.version,
		to: staged.manifest.version,
		rolledBack: false,
		upToDate: false,
	});
}
