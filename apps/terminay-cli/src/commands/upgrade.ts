import type { DaemonOptions } from '../args.js';
import type { CommandContext } from '../context.js';
import { discardDownloads, downloadAsset, downloadBytes, downloadText } from '../download.js';
import { waitForReady } from '../health.js';
import { activate, activeVersion, installArchive, retain } from '../install.js';
import { stagedName, writeInstallRecord } from '../layout.js';
import { hostArchitecture } from '../platform.js';
import { resolveRef } from '../resolve.js';
import { buildFromSource } from '../source.js';
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
	const parse = (value: string) => value.split(/[-+]/u, 1)[0]?.split('.').map(Number) ?? [];
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
		...(dependencies.repository === undefined ? {} : { repository: dependencies.repository }),
		...(dependencies.apiBase === undefined ? {} : { apiBase: dependencies.apiBase }),
		...(dependencies.webBase === undefined ? {} : { webBase: dependencies.webBase }),
	});

	if (resolved.channel === 'tag' && record.channel === 'tag') {
		const order = compareVersions(resolved.version, record.version);
		if (order === 0) {
			write(`Already on ${record.version}. Nothing to do.`);
			return Object.freeze({ from: record.version, to: record.version, rolledBack: false, upToDate: true });
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
			if (Date.parse(published) < Date.parse(record.publishedAt) && !options.allowDowngrade) {
				throw new UpgradeError(
					`the ${resolved.channel} release published at ${published} is older than the installed one from ${record.publishedAt}. Pass --allow-downgrade to install it anyway.`,
				);
			}
			if (Date.parse(published) === Date.parse(record.publishedAt)) {
				write(`Already on the newest ${record.channel} build. Nothing to do.`);
				return Object.freeze({ from: record.version, to: record.version, rolledBack: false, upToDate: true });
			}
		}
	}

	const previous = (await activeVersion(layout)) ?? stagedName(record.channel, record.version, record.revision);

	// Staged beside the running version: nothing below this point has stopped
	// the service yet.
	let archivePath: string;
	if (resolved.channel === 'source') {
		write(`Building ${resolved.sourceRef ?? resolved.version} from source. This takes a while.`);
		const built = await buildFromSource({
			ref: resolved.sourceRef ?? resolved.version,
			...(resolved.revision === undefined ? {} : { revision: resolved.revision }),
			destination: layout.prefix,
			write,
		});
		archivePath = built.archivePath;
	} else {
		const assets = resolved.assets;
		if (assets === undefined) throw new UpgradeError('the resolved release names no archive to download');
		write('Downloading and verifying …');
		const asset = await downloadAsset(assets.archive, layout.prefix);
		const [sidecar, signature] = await Promise.all([downloadText(assets.sha256), downloadBytes(assets.signature)]);
		await verifyArchive({
			archivePath: asset.path,
			sidecar,
			signature,
			digest: asset.sha256,
			...(dependencies.releasePublicKeyPem === undefined ? {} : { publicKeyPem: dependencies.releasePublicKeyPem }),
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
			...(resolved.revision === undefined ? {} : { revision: resolved.revision }),
		},
	});
	await discardDownloads(layout.prefix);

	if (installed.name === previous) {
		write(`Already running ${installed.manifest.version}. Nothing to do.`);
		return Object.freeze({ from: record.version, to: installed.manifest.version, rolledBack: false, upToDate: true });
	}

	write(`Upgrading ${record.version} → ${installed.manifest.version} …`);
	await systemd.stop();
	await activate(layout, installed.name);
	await systemd.start();

	if ((await waitForReady(record.healthPort, dependencies.readinessTimeoutMs)) === undefined) {
		write('The upgraded server did not report ready. Rolling back.');
		await systemd.stop();
		await activate(layout, previous);
		await systemd.start();
		const recovered = (await waitForReady(record.healthPort, dependencies.readinessTimeoutMs)) !== undefined;
		write(await systemd.journal(20));
		throw new UpgradeError(
			`the upgrade to ${installed.manifest.version} did not become ready, so ${record.version} was restored and ${recovered ? 'is running again' : 'was started, but has not reported ready either'}.`,
		);
	}

	await writeInstallRecord(layout, {
		...record,
		channel: resolved.channel,
		version: installed.manifest.version,
		revision: installed.manifest.revision,
		...(resolved.publishedAt === undefined ? {} : { publishedAt: resolved.publishedAt }),
		installedAt: new Date().toISOString(),
	});
	const removed = await retain(layout, [installed.name, previous]);
	write(`Upgraded to ${installed.manifest.version}. Kept ${previous} to roll back to.`);
	if (removed.length > 0) write(`Removed older versions: ${removed.join(', ')}.`);

	return Object.freeze({ from: record.version, to: installed.manifest.version, rolledBack: false, upToDate: false });
}
