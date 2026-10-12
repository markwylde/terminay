import {
	type Architecture,
	type ReleaseChannel,
	type ResolvedRef,
	resolveRef,
} from './resolve.js';

/**
 * What an upgrade would move to, and whether that is forwards.
 *
 * `daemon upgrade` and `daemon upgrade --check` both need the answer, and a
 * second copy of it is how a check comes to promise an upgrade the command
 * then refuses. So the resolution and the ordering live here once: the check
 * reports what this returns, and the upgrade acts on it.
 */

/** The release an installation is running, wherever that was read from. */
export interface InstalledRelease {
	readonly channel: ReleaseChannel;
	readonly version: string;
	readonly revision: string;
	/** When the running build was published, where the install recorded it. */
	readonly publishedAt?: string;
}

export interface ReleaseSource {
	readonly repository?: string;
	readonly apiBase?: string;
	readonly webBase?: string;
	readonly architecture: Architecture;
}

export class NoChannelError extends Error {}

/** Compare two release versions by semver precedence, ignoring prerelease tags. */
export function compareVersions(left: string, right: string): number {
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

/**
 * A source install has no ordering to trust — a branch tip moves without any
 * version changing — so it must be told what to move to.
 */
export function assertChannelToFollow(
	ref: string | undefined,
	installed: Pick<InstalledRelease, 'channel'>,
): void {
	if (ref === undefined && installed.channel === 'source') {
		throw new NoChannelError(
			'this server was built from source, which has no channel to follow. Name the branch, commit, or release to upgrade to.',
		);
	}
}

/**
 * Resolve the release an upgrade moves to.
 *
 * With no reference it follows the installed channel: the newest tag for a
 * tagged install, the rolling build for a `main` install.
 */
export async function resolveUpgradeTarget(
	ref: string | undefined,
	installed: InstalledRelease,
	source: ReleaseSource,
): Promise<ResolvedRef> {
	assertChannelToFollow(ref, installed);
	const target = ref ?? (installed.channel === 'main' ? 'main' : undefined);
	return resolveRef(target, {
		architecture: source.architecture,
		...(source.repository === undefined
			? {}
			: { repository: source.repository }),
		...(source.apiBase === undefined ? {} : { apiBase: source.apiBase }),
		...(source.webBase === undefined ? {} : { webBase: source.webBase }),
	});
}

/**
 * Where the resolved release stands against the installed one.
 *
 * `unknown` is an honest answer, not a failure: releases on different
 * channels have no order between them, and a rolling build whose publication
 * time was not recorded can only be told apart by its commit, which is inside
 * the archive.
 */
export type ReleaseOrder = 'newer' | 'same' | 'older' | 'unknown';

export function orderAgainstInstalled(
	resolved: ResolvedRef,
	installed: InstalledRelease,
): ReleaseOrder {
	if (resolved.channel === 'tag' && installed.channel === 'tag') {
		const order = compareVersions(resolved.version, installed.version);
		return order === 0 ? 'same' : order < 0 ? 'older' : 'newer';
	}
	if (resolved.channel === 'main' && installed.channel === 'main') {
		// The rolling channel reuses one version string, so the published time
		// is the only ordering it has.
		const published = resolved.publishedAt;
		if (published === undefined || installed.publishedAt === undefined)
			return 'unknown';
		const difference =
			Date.parse(published) - Date.parse(installed.publishedAt);
		if (Number.isNaN(difference)) return 'unknown';
		return difference === 0 ? 'same' : difference < 0 ? 'older' : 'newer';
	}
	return 'unknown';
}
