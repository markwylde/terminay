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
import { activate, activeVersion, installArchive, retain } from '../install.js';
import { stagedName, writeInstallRecord } from '../layout.js';
import { hostArchitecture } from '../platform.js';
import { resolveRef } from '../resolve.js';
import { buildFromSource } from '../source.js';
import { withEnvironmentValue, withUnitKillMode } from '../unit.js';
import { verifyArchive } from '../verify.js';

/**
 * `daemon upgrade` — follow the installed channel, and never leave the machine
 * without a working server.
 *
 * The sequence is the one the release and update policy names: verify, stage
 * beside the running version, stop, switch, start, wait for readiness, and on
 * failure switch back and start what was working. The data root is never
 * touched, so a rollback restores the previous version against the same state
 * it was already running with.
 */

export interface UpgradeDependencies {
	readonly repository?: string;
	readonly apiBase?: string;
	readonly webBase?: string;
	readonly architecture?: 'x64' | 'arm64';
	readonly readinessTimeoutMs?: number;
	/** See `InstallDependencies.releasePublicKeyPem`: a test seam, not a bypass. */
	readonly releasePublicKeyPem?: string;
}

export interface UpgradeResult {
	readonly from: string;
	readonly to: string;
	readonly rolledBack: boolean;
	readonly upToDate: boolean;
}

export class UpgradeError extends Error {}

/** Compare two release versions by semver precedence, ignoring prerelease tags. */
function compareVersions(left: string, right: string): number {
	const parse = (value: string) =>
		value.split(/[-+]/u, 1)[0]?.split('.').map(Number) ?? [];
	const a = parse(left);
	const b = parse(right);
	for (let index = 0; index < 3; index += 1) {
		const difference = (a[index] ?? 0) - (b[index] ?? 0);
		if (difference !== 0) return difference < 0 ? -1 : 1;
	}
	return 0;
}

export async function runUpgrade(
	ref: string | undefined,
	options: DaemonOptions,
	context: CommandContext,
	dependencies: UpgradeDependencies = {},
): Promise<UpgradeResult> {
	const { layout, record, systemd, write } = context;

	// A source install has no ordering the CLI can trust — a branch tip moves
	// without any version changing — so it must be told what to move to.
	if (ref === undefined && record.channel === 'source') {
		throw new UpgradeError(
			'this server was built from source, which has no channel to follow. Name the branch, commit, or release to upgrade to.',
		);
	}
	const target = ref ?? (record.channel === 'main' ? 'main' : undefined);

	const architecture = dependencies.architecture ?? hostArchitecture();
	const resolved = await resolveRef(target, {
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

	if (resolved.channel === 'tag' && record.channel === 'tag') {
		const order = compareVersions(resolved.version, record.version);
		if (order === 0) {
			write(`Already on ${record.version}. Nothing to do.`);
			return Object.freeze({
				from: record.version,
				to: record.version,
				rolledBack: false,
				upToDate: true,
			});
		}
		if (order < 0 && !options.allowDowngrade) {
			throw new UpgradeError(
				`refusing to move from ${record.version} down to ${resolved.version}. Pass --allow-downgrade if that is what you want.`,
			);
		}
	}
	if (resolved.channel === 'main' && record.channel === 'main') {
		// The rolling channel reuses one version string, so the published time
		// is the only ordering it has.
		const published = resolved.publishedAt;
		if (published !== undefined && record.publishedAt !== undefined) {
			if (
				Date.parse(published) < Date.parse(record.publishedAt) &&
				!options.allowDowngrade
			) {
				throw new UpgradeError(
					`the ${resolved.channel} release published at ${published} is older than the installed one from ${record.publishedAt}. Pass --allow-downgrade to install it anyway.`,
				);
			}
			if (Date.parse(published) === Date.parse(record.publishedAt)) {
				write(`Already on the newest ${record.channel} build. Nothing to do.`);
				return Object.freeze({
					from: record.version,
					to: record.version,
					rolledBack: false,
					upToDate: true,
				});
			}
		}
	}

	const previous =
		(await activeVersion(layout)) ??
		stagedName(record.channel, record.version, record.revision);

	// Staged beside the running version: nothing below this point has stopped
	// the service yet.
	let archivePath: string;
	if (resolved.channel === 'source') {
		write(
			`Building ${resolved.sourceRef ?? resolved.version} from source. This takes a while.`,
		);
		const built = await buildFromSource({
			ref: resolved.sourceRef ?? resolved.version,
			...(resolved.revision === undefined
				? {}
				: { revision: resolved.revision }),
			destination: layout.prefix,
			write,
		});
		archivePath = built.archivePath;
	} else {
		const assets = resolved.assets;
		if (assets === undefined)
			throw new UpgradeError(
				'the resolved release names no archive to download',
			);
		write('Downloading and verifying …');
		const asset = await downloadAsset(assets.archive, layout.prefix);
		const [sidecar, signature] = await Promise.all([
			downloadText(assets.sha256),
			downloadBytes(assets.signature),
		]);
		await verifyArchive({
			archivePath: asset.path,
			sidecar,
			signature,
			digest: asset.sha256,
			...(dependencies.releasePublicKeyPem === undefined
				? {}
				: { publicKeyPem: dependencies.releasePublicKeyPem }),
		});
		archivePath = asset.path;
	}

	const installed = await installArchive({
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
	await discardDownloads(layout.prefix);

	if (installed.name === previous) {
		write(`Already running ${installed.manifest.version}. Nothing to do.`);
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
		write('Updated the service unit so terminals keep running across restarts.');
	}
	await systemd.stop();
	await activate(layout, installed.name);
	await systemd.start();

	if (
		(await waitForReady(record.healthPort, dependencies.readinessTimeoutMs)) ===
		undefined
	) {
		write('The upgraded server did not report ready. Rolling back.');
		await systemd.stop();
		await activate(layout, previous);
		await systemd.start();
		const recovered =
			(await waitForReady(
				record.healthPort,
				dependencies.readinessTimeoutMs,
			)) !== undefined;
		write(await systemd.journal(20));
		throw new UpgradeError(
			`the upgrade to ${installed.manifest.version} did not become ready, so ${record.version} was restored and ${recovered ? 'is running again' : 'was started, but has not reported ready either'}.`,
		);
	}

	// A server installed before the renderer directory was written has an
	// environment naming only the local UI bundle, so it pairs a device and then
	// serves a placeholder workspace. The symptom gives no hint that the remedy
	// is an upgrade, so the upgrade repairs it rather than waiting to be asked.
	const environmentBefore = await readFile(layout.environmentFile, 'utf8').catch(
		() => '',
	);
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
