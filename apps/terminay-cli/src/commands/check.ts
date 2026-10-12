import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { DaemonOptions } from '../args.js';
import {
	containerLayout,
	isContainerManaged,
	readStagedRecord,
	runningRelease,
	supervisedServerPid,
} from '../container.js';
import { resolveContext } from '../context.js';
import { upgradeHelperInstalled } from '../helper.js';
import type { InstallLayout } from '../layout.js';
import { readUpgradeOutcome, type UpgradeOutcome } from '../outcome.js';
import { peekPublishedIdentity } from '../peek.js';
import {
	type InstalledRelease,
	orderAgainstInstalled,
	type ReleaseSource,
	resolveUpgradeTarget,
} from '../plan.js';
import { hostArchitecture } from '../platform.js';
import type { Architecture } from '../resolve.js';
import { type RecreateDependencies, recreateOffered } from './recreate.js';

/**
 * `daemon upgrade --check` — one line of JSON describing this installation and
 * whether its channel has something newer.
 *
 * This is the whole contract between a server and the upgrader its own release
 * ships. The server knows its version and nothing about how it was installed;
 * the CLI owns the install record, the layout, and release resolution. So the
 * server asks, and reads one line back, rather than learning any of that.
 *
 * It reads only what the account the server runs as can read — the install
 * record, the unit directory, the outcome record — and changes nothing. It
 * exits zero whenever it could describe the installation, including when the
 * release metadata could not be fetched: that is reported as `checkError`
 * beside an otherwise complete description, so the server keeps what it last
 * knew.
 */

/** How an upgrade can be carried out here. A container may gain `recreate`. */
export type UpgradeMode = 'in-place' | 'recreate';

export type UpgradeTrigger =
	| { readonly kind: 'spawn' }
	| { readonly kind: 'request-file'; readonly path: string };

export interface UpgradeCheckReport {
	readonly schemaVersion: 1;
	readonly environment: 'user' | 'system' | 'container';
	readonly installed: {
		readonly channel: string;
		readonly version: string;
		readonly revision: string;
	};
	readonly available: null | {
		readonly version: string;
		readonly revision?: string;
		readonly publishedAt?: string;
	};
	readonly canUpgrade: boolean;
	readonly modes: readonly UpgradeMode[];
	readonly trigger: UpgradeTrigger;
	readonly unavailable: null | {
		readonly reason: string;
		readonly command: string;
	};
	readonly lastResult: null | Omit<UpgradeOutcome, 'schemaVersion'>;
	readonly checkError?: string;
}

export interface CheckDependencies {
	readonly home?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly repository?: string;
	readonly apiBase?: string;
	readonly webBase?: string;
	readonly architecture?: Architecture;
	/** Relocates the system layout for the tests. */
	readonly systemRoot?: string;
	/** How a container's Docker socket is reached. Overridden by the tests. */
	readonly recreate?: RecreateDependencies;
}

/** Everything about the installation that does not need the network. */
interface Described {
	readonly environment: UpgradeCheckReport['environment'];
	readonly installed: InstalledRelease;
	readonly architecture: Architecture;
	readonly trigger: UpgradeTrigger;
	readonly unavailable: UpgradeCheckReport['unavailable'];
	readonly resultPath: string;
}

/**
 * The modes an environment offers. One place, so a mode that needs detecting
 * is added here and nowhere else.
 *
 * A container gains `recreate` only where it could actually be carried out:
 * the Docker socket is mounted and answers this account, the daemon behind it
 * knows this container, and the container is one a replacement can stand in
 * for. Anything short of that offers in-place alone, and says nothing of why:
 * the socket is an operator's opt-in, and its absence is the ordinary case.
 */
async function upgradeModes(
	environment: UpgradeCheckReport['environment'],
	env: Readonly<Record<string, string | undefined>>,
	dependencies: RecreateDependencies | undefined,
): Promise<readonly UpgradeMode[]> {
	if (
		environment === 'container' &&
		(await recreateOffered(env, { ...dependencies, env }))
	)
		return Object.freeze(['in-place', 'recreate'] as const);
	return Object.freeze(['in-place'] as const);
}

async function isFile(path: string): Promise<boolean> {
	return (await stat(path).catch(() => undefined))?.isFile() === true;
}

const NO_CHANNEL =
	'This server was built from source, so it has no release channel to follow and cannot be upgraded from here.';

async function describeService(
	layout: InstallLayout,
	installed: InstalledRelease,
	architecture: Architecture,
): Promise<Described> {
	const shipped = join(layout.currentLink, 'bin/terminay');
	// The upgrader inside the installed release needs no npm on this machine;
	// a release from before the server carried one is upgraded through npx.
	const cli = (await isFile(shipped)) ? shipped : 'npx terminay';
	const command = (argument: string) =>
		layout.scope === 'system'
			? `sudo ${cli} daemon upgrade${argument} --system`
			: `${cli} daemon upgrade${argument} --user`;

	const helper = layout.upgradeHelper;
	const helperReady =
		helper !== undefined &&
		cli === shipped &&
		(await upgradeHelperInstalled(layout));
	const trigger: UpgradeTrigger =
		helper !== undefined && helperReady
			? Object.freeze({ kind: 'request-file', path: helper.requestFile })
			: Object.freeze({ kind: 'spawn' });

	let unavailable: Described['unavailable'] = null;
	if (installed.channel === 'source') {
		unavailable = Object.freeze({
			reason: NO_CHANNEL,
			command: command(' <branch-or-tag>'),
		});
	} else if (layout.scope === 'system' && !helperReady) {
		unavailable = Object.freeze({
			reason:
				'This server needs one manual upgrade before it can be upgraded from here. Run this command once on the machine it is installed on; it installs the helper that lets the server upgrade itself.',
			command: command(''),
		});
	}
	return Object.freeze({
		environment: layout.scope,
		installed,
		architecture,
		trigger,
		unavailable,
		resultPath: layout.resultPath,
	});
}

async function describeContainer(
	env: Readonly<Record<string, string | undefined>>,
): Promise<Described> {
	const layout = containerLayout(env);
	const running = await runningRelease(layout);
	// A container has no install record. What it runs is in the manifest of the
	// release the entrypoint started, and when that build was published is
	// known only for one this container staged itself.
	const staged =
		running.staged === undefined
			? undefined
			: await readStagedRecord(layout, running.staged);
	const installed: InstalledRelease = Object.freeze({
		channel: running.manifest.channel,
		version: running.manifest.version,
		revision: running.manifest.revision,
		...(staged?.publishedAt === undefined
			? {}
			: { publishedAt: staged.publishedAt }),
	});

	let unavailable: Described['unavailable'] = null;
	if (installed.channel === 'source') {
		unavailable = Object.freeze({
			reason:
				'This image was built locally, so it has no release channel to follow. Build or pull a newer image and recreate the container.',
			command: 'docker pull <image>',
		});
	} else if (
		!running.supervised ||
		(await supervisedServerPid(layout)) === undefined
	) {
		unavailable = Object.freeze({
			reason:
				'This container was not started by an entrypoint that can restart the server on a new release. Pull a newer image and recreate the container.',
			command: 'docker pull <image>',
		});
	}
	return Object.freeze({
		environment: 'container',
		installed,
		architecture: running.manifest.architecture,
		trigger: Object.freeze({ kind: 'spawn' }),
		unavailable,
		resultPath: layout.resultPath,
	});
}

/** One line for the server to log, never a page of it. */
function message(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text.replace(/\s+/gu, ' ').slice(0, 1024);
}

/**
 * Ask the channel whether it has something newer than what is installed.
 *
 * The ordering is the one `daemon upgrade` itself applies. Where that ordering
 * cannot say — a rolling build whose publication time nothing recorded — the
 * commit the published archive was built from is read instead, and an upgrade
 * is offered only when it is positively a different commit.
 */
export async function findAvailable(
	installed: InstalledRelease,
	source: ReleaseSource,
): Promise<Pick<UpgradeCheckReport, 'available' | 'checkError'>> {
	if (installed.channel === 'source') return { available: null };
	try {
		const resolved = await resolveUpgradeTarget(undefined, installed, source);
		const published =
			resolved.publishedAt === undefined
				? {}
				: { publishedAt: resolved.publishedAt };
		const order = orderAgainstInstalled(resolved, installed);
		if (order === 'newer') {
			return {
				available: Object.freeze({ version: resolved.version, ...published }),
			};
		}
		if (order !== 'unknown') return { available: null };
		if (resolved.assets === undefined) return { available: null };
		const identity = await peekPublishedIdentity(resolved.assets.archive);
		if (identity === undefined) {
			return {
				available: null,
				checkError: `the published ${resolved.channel} build does not say which commit it was built from`,
			};
		}
		if (identity.revision === installed.revision) return { available: null };
		return {
			available: Object.freeze({
				version: resolved.version,
				revision: identity.revision,
				...published,
			}),
		};
	} catch (error) {
		return { available: null, checkError: message(error) };
	}
}

export async function runUpgradeCheck(
	options: DaemonOptions,
	dependencies: CheckDependencies = {},
): Promise<UpgradeCheckReport> {
	const env = dependencies.env ?? process.env;
	let described: Described;
	if (isContainerManaged(env)) {
		described = await describeContainer(env);
	} else {
		const { layout, record } = await resolveContext({
			options,
			...(dependencies.home === undefined ? {} : { home: dependencies.home }),
			...(dependencies.env === undefined ? {} : { env: dependencies.env }),
			...(dependencies.systemRoot === undefined
				? {}
				: { systemRoot: dependencies.systemRoot }),
		});
		described = await describeService(
			layout,
			record,
			dependencies.architecture ?? hostArchitecture(),
		);
	}

	const { available, checkError } = await findAvailable(described.installed, {
		architecture: dependencies.architecture ?? described.architecture,
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
	const last = await readUpgradeOutcome(described.resultPath);
	const modes = await upgradeModes(
		described.environment,
		env,
		dependencies.recreate,
	);

	// Key order is the order the contract is written in; `checkError` is the
	// one optional member and comes last.
	return Object.freeze({
		schemaVersion: 1,
		environment: described.environment,
		installed: Object.freeze({
			channel: described.installed.channel,
			version: described.installed.version,
			revision: described.installed.revision,
		}),
		available,
		canUpgrade: described.unavailable === null,
		modes,
		trigger: described.trigger,
		unavailable: described.unavailable,
		lastResult:
			last === undefined
				? null
				: Object.freeze({
						from: last.from,
						to: last.to,
						outcome: last.outcome,
						...(last.reason === undefined ? {} : { reason: last.reason }),
						at: last.at,
					}),
		...(checkError === undefined ? {} : { checkError }),
	});
}
