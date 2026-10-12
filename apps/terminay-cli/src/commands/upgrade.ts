import { readFile, writeFile } from 'node:fs/promises';

import { derivePublicHost, PUBLIC_HOST_NEEDS_LITERAL } from '../address.js';
import { ADVERTISED_PORT_SPAN } from '../advertise.js';
import type { DaemonOptions } from '../args.js';
import type { CommandContext } from '../context.js';
import {
	discardDownloads,
	downloadAsset,
	downloadBytes,
	downloadText,
} from '../download.js';
import { waitForReady } from '../health.js';
import {
	installUpgradeHelper,
	isUpgradeHelperProcess,
	upgradeHelperInstalled,
} from '../helper.js';
import { activate, activeVersion, installArchive, retain } from '../install.js';
import { stagedName, writeInstallRecord } from '../layout.js';
import { releaseLabel, writeUpgradeOutcome } from '../outcome.js';
import {
	assertChannelToFollow,
	NoChannelError,
	orderAgainstInstalled,
	resolveUpgradeTarget,
} from '../plan.js';
import { hostArchitecture } from '../platform.js';
import type { ResolvedRef } from '../resolve.js';
import { buildFromSource } from '../source.js';
import { withEnvironmentValue, withUnitKillMode } from '../unit.js';
import { verifyArchive } from '../verify.js';

/**
 * `daemon upgrade` — follow the installed channel, and never leave the machine
 * without a working server.
 *
 * The sequence is the one the release and update policy names: verify, stage
 * beside the running version, stop, switch, start, wait for readiness, and on
 * failure switch back and start what was working. No server state in the data
 * root is read or written, so a rollback restores the previous version against
 * the same state it was already running with.
 *
 * Every attempt that reaches the point of moving the active version leaves an
 * outcome record beside `versions/` (see `outcome.ts`), because the server
 * that asked for the upgrade is restarted by it and has no other way to learn
 * how it ended.
 */

export interface UpgradeDependencies {
	readonly repository?: string;
	readonly apiBase?: string;
	readonly webBase?: string;
	readonly architecture?: 'x64' | 'arm64';
	readonly readinessTimeoutMs?: number;
	/** See `InstallDependencies.releasePublicKeyPem`: a test seam, not a bypass. */
	readonly releasePublicKeyPem?: string;
	/** Who is running this. Overridden by tests; root maintains the helper. */
	readonly uid?: number;
	readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface UpgradeResult {
	readonly from: string;
	readonly to: string;
	readonly rolledBack: boolean;
	readonly upToDate: boolean;
}

export class UpgradeError extends Error {}

/**
 * Fetch a release archive and verify it against its published checksum and
 * the release signature, or build one when the reference is a source ref.
 * Shared by every upgrade path, so none of them can verify less than another.
 */
export async function obtainArchive(options: {
	readonly resolved: ResolvedRef;
	/** Where the download is staged; discarded by the caller afterwards. */
	readonly prefix: string;
	readonly write: (line: string) => void;
	readonly releasePublicKeyPem?: string;
}): Promise<string> {
	const { resolved, prefix, write } = options;
	if (resolved.channel === 'source') {
		write(
			`Building ${resolved.sourceRef ?? resolved.version} from source. This takes a while.`,
		);
		const built = await buildFromSource({
			ref: resolved.sourceRef ?? resolved.version,
			...(resolved.revision === undefined
				? {}
				: { revision: resolved.revision }),
			destination: prefix,
			write,
		});
		return built.archivePath;
	}
	const assets = resolved.assets;
	if (assets === undefined)
		throw new UpgradeError('the resolved release names no archive to download');
	write('Downloading and verifying …');
	const asset = await downloadAsset(assets.archive, prefix);
	const [sidecar, signature] = await Promise.all([
		downloadText(assets.sha256),
		downloadBytes(assets.signature),
	]);
	await verifyArchive({
		archivePath: asset.path,
		sidecar,
		signature,
		digest: asset.sha256,
		...(options.releasePublicKeyPem === undefined
			? {}
			: { publicKeyPem: options.releasePublicKeyPem }),
	});
	return asset.path;
}

function reasonOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function runUpgrade(
	ref: string | undefined,
	options: DaemonOptions,
	context: CommandContext,
	dependencies: UpgradeDependencies = {},
): Promise<UpgradeResult> {
	const { layout, record, systemd, write } = context;

	// A system-scope service cannot upgrade itself, so root leaves it the
	// helper that can (see `helper.ts`). An install made before the helper
	// existed gains it here, on the one manual upgrade it needs — whether or
	// not there turns out to be a newer release to move to. The helper's own
	// oneshot never touches its units while it is running inside one.
	if (
		layout.upgradeHelper !== undefined &&
		(dependencies.uid ?? process.getuid?.()) === 0 &&
		!isUpgradeHelperProcess(dependencies.env) &&
		!(await upgradeHelperInstalled(layout))
	) {
		await installUpgradeHelper({ layout, runAs: record.runAs, systemd });
		write('Installed the upgrade helper, so this server can upgrade itself.');
	}

	let architecture: 'x64' | 'arm64';
	let resolved: ResolvedRef;
	try {
		// Said before anything else is asked of the machine: an install with
		// no channel has nothing to resolve, whatever host it is on.
		assertChannelToFollow(ref, record);
		architecture = dependencies.architecture ?? hostArchitecture();
		resolved = await resolveUpgradeTarget(ref, record, {
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
		if (error instanceof NoChannelError) throw new UpgradeError(error.message);
		throw error;
	}

	const order = orderAgainstInstalled(resolved, record);
	if (order === 'same') {
		write(
			resolved.channel === 'tag'
				? `Already on ${record.version}. Nothing to do.`
				: `Already on the newest ${record.channel} build. Nothing to do.`,
		);
		return Object.freeze({
			from: record.version,
			to: record.version,
			rolledBack: false,
			upToDate: true,
		});
	}
	if (order === 'older' && !options.allowDowngrade) {
		throw new UpgradeError(
			resolved.channel === 'tag'
				? `refusing to move from ${record.version} down to ${resolved.version}. Pass --allow-downgrade if that is what you want.`
				: `the ${resolved.channel} release published at ${resolved.publishedAt} is older than the installed one from ${record.publishedAt}. Pass --allow-downgrade to install it anyway.`,
		);
	}

	const previous =
		(await activeVersion(layout)) ??
		stagedName(record.channel, record.version, record.revision);

	const fromLabel = releaseLabel(
		record.channel,
		record.version,
		record.revision,
	);

	// Staged beside the running version: nothing below this point has stopped
	// the service yet.
	let installed: Awaited<ReturnType<typeof installArchive>>;
	try {
		const archivePath = await obtainArchive({
			resolved,
			prefix: layout.prefix,
			write,
			...(dependencies.releasePublicKeyPem === undefined
				? {}
				: { releasePublicKeyPem: dependencies.releasePublicKeyPem }),
		});
		installed = await installArchive({
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
		// Nothing was switched, so the release that was running still is. The
		// record says so, because a server that asked for this upgrade through
		// the helper sees neither this process nor its exit status.
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
	const toLabel = releaseLabel(
		resolved.channel,
		installed.manifest.version,
		installed.manifest.revision,
	);

	if (installed.name === previous) {
		write(`Already running ${installed.manifest.version}. Nothing to do.`);
		// The build is the one already running, but the record may not have
		// known when it was published. Learning it here is what lets the next
		// check answer from the release metadata alone.
		if (
			resolved.publishedAt !== undefined &&
			resolved.publishedAt !== record.publishedAt &&
			resolved.channel === record.channel
		) {
			await writeInstallRecord(layout, {
				...record,
				publishedAt: resolved.publishedAt,
			});
		}
		return Object.freeze({
			from: record.version,
			to: installed.manifest.version,
			rolledBack: false,
			upToDate: true,
		});
	}

	write(`Upgrading ${record.version} → ${installed.manifest.version} …`);
	// A unit written before terminal sessions outlived the server stops its
	// whole control group, which would end every shell on this very upgrade.
	// It is repaired before the stop, so the stop already honours it.
	const unitBefore = await readFile(layout.unitPath, 'utf8').catch(() => '');
	const unitAfter = withUnitKillMode(unitBefore);
	if (unitAfter !== unitBefore) {
		await writeFile(layout.unitPath, unitAfter, { mode: 0o644 });
		await systemd.daemonReload();
		write(
			'Updated the service unit so terminals keep running across restarts.',
		);
	}
	await systemd.stop();
	await activate(layout, installed.name);
	// A unit that will not start is the same failure as one that starts and
	// never reports ready: either way the previous version goes back.
	const started = await systemd.start().then(
		() => true,
		() => false,
	);

	if (
		!started ||
		(await waitForReady(record.healthPort, dependencies.readinessTimeoutMs)) ===
			undefined
	) {
		write('The upgraded server did not report ready. Rolling back.');
		await systemd.stop().catch(() => undefined);
		await activate(layout, previous);
		const restarted = await systemd.start().then(
			() => true,
			() => false,
		);
		const recovered =
			restarted &&
			(await waitForReady(
				record.healthPort,
				dependencies.readinessTimeoutMs,
			)) !== undefined;
		const reason = `the upgrade to ${installed.manifest.version} did not become ready, so ${record.version} was restored and ${recovered ? 'is running again' : 'was started, but has not reported ready either'}.`;
		await writeUpgradeOutcome(layout.resultPath, {
			from: fromLabel,
			to: toLabel,
			outcome: 'rolled-back',
			reason,
		}).catch(() => undefined);
		write(await systemd.journal(20));
		throw new UpgradeError(reason);
	}

	// A server installed before the renderer directory was written has an
	// environment naming only the local UI bundle, so it pairs a device and then
	// serves a placeholder workspace. The symptom gives no hint that the remedy
	// is an upgrade, so the upgrade repairs it rather than waiting to be asked.
	const environmentBefore = await readFile(
		layout.environmentFile,
		'utf8',
	).catch(() => '');
	if (
		environmentBefore.length > 0 &&
		!/^TERMINAY_UI_RENDERER_DIRECTORY=/mu.test(environmentBefore)
	) {
		const uiBundle = /^TERMINAY_UI_BUNDLE=(.*)$/mu.exec(environmentBefore)?.[1];
		if (uiBundle !== undefined && uiBundle.length > 0) {
			await writeFile(
				layout.environmentFile,
				withEnvironmentValue(
					environmentBefore,
					'TERMINAY_UI_RENDERER_DIRECTORY',
					uiBundle,
				),
				{ mode: 0o640 },
			);
			write('Added the workspace UI directory the server reads.');
		}
	}

	// A public host given here stands for both routes, exactly as at install.
	// An advertised address given beside it still wins for that one setting,
	// and a host that is a name or loopback leaves the advertised address as it
	// was. Absent, the recorded host and what it derived carry forward untouched.
	const derived =
		options.publicHost === undefined
			? undefined
			: derivePublicHost(options.publicHost, record.port);
	const advertiseAddress =
		options.advertiseAddress ?? derived?.advertiseAddress;

	// How the server is reached lives in the environment file rather than in the
	// version that was staged. Absent, the recorded values carry forward with
	// the rest of the record.
	if (derived !== undefined || advertiseAddress !== undefined) {
		let environment = await readFile(layout.environmentFile, 'utf8').catch(
			() => '',
		);
		if (derived !== undefined) {
			environment = withEnvironmentValue(
				withEnvironmentValue(
					environment,
					'TERMINAY_PUBLIC_HOST',
					options.publicHost,
				),
				'TERMINAY_DIRECT_ORIGIN',
				derived.directOrigin,
			);
		}
		if (advertiseAddress !== undefined) {
			environment = withEnvironmentValue(
				environment,
				'TERMINAY_WEBRTC_ADVERTISE_ADDRESS',
				advertiseAddress === '' ? undefined : advertiseAddress,
			);
		}
		await writeFile(layout.environmentFile, environment, { mode: 0o640 });
		// The upgraded service was started against the previous environment, and
		// a public host is only worth recording if the server is serving it.
		if (derived !== undefined) {
			await systemd.restart();
			await waitForReady(record.healthPort, dependencies.readinessTimeoutMs);
		}
	}

	// Cleared means the key is absent, not present and undefined, so the record
	// is rebuilt without it rather than assigned over.
	const { advertiseAddress: recorded, ...withoutAdvertised } = record;
	const advertisedFields =
		advertiseAddress === undefined
			? recorded === undefined
				? {}
				: { advertiseAddress: recorded }
			: advertiseAddress === ''
				? {}
				: { advertiseAddress };

	await writeInstallRecord(layout, {
		...withoutAdvertised,
		...advertisedFields,
		...(derived === undefined
			? {}
			: {
					publicHost: options.publicHost as string,
					directOrigin: derived.directOrigin,
				}),
		channel: resolved.channel,
		version: installed.manifest.version,
		revision: installed.manifest.revision,
		...(resolved.publishedAt === undefined
			? {}
			: { publishedAt: resolved.publishedAt }),
		installedAt: new Date().toISOString(),
	});
	const removed = await retain(layout, [installed.name, previous]);
	await writeUpgradeOutcome(layout.resultPath, {
		from: fromLabel,
		to: toLabel,
		outcome: 'succeeded',
	});
	write(
		`Upgraded to ${installed.manifest.version}. Kept ${previous} to roll back to.`,
	);
	if (removed.length > 0)
		write(`Removed older versions: ${removed.join(', ')}.`);
	if (derived !== undefined) {
		const advertised = advertisedFields.advertiseAddress;
		write(`  public host  ${options.publicHost}`);
		write(`  direct URL   ${derived.directOrigin}`);
		if (advertised !== undefined) {
			const first = Number(advertised.slice(advertised.lastIndexOf(':') + 1));
			const last = first + ADVERTISED_PORT_SPAN - 1;
			write(`  advertised   ${advertised}`);
			write(
				`UDP ports ${first}-${last} must reach this machine for that address to work.`,
			);
		}
		if (derived.advertiseAddress === undefined)
			write(PUBLIC_HOST_NEEDS_LITERAL);
	}

	return Object.freeze({
		from: record.version,
		to: installed.manifest.version,
		rolledBack: false,
		upToDate: false,
	});
}
