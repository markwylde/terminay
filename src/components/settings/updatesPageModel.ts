/**
 * What the Updates pages of Settings say: the exact version each part runs,
 * the newest release on its track, and, for a server, how to move it to
 * another track. Pure, so every state is testable without a host.
 */

/** The part of the Desktop updater's status these pages read. */
export type DeviceUpdateStatusLike = Readonly<{
	checkedAt: string | null;
	currentVersion: string;
	errorMessage: string | null;
	latestVersion: string | null;
	state?: string;
}>;

/** The part of a server's published upgrade status these pages read. */
export type ServerUpgradeStatusLike = Readonly<{
	version: string;
	channel?: 'tag' | 'main' | 'canary' | 'source';
	available?: Readonly<{ version: string }>;
	canUpgrade: boolean;
}>;

export type VersionLine = Readonly<{
	label: string;
	/** The exact version string, never shortened. Absent when there is none. */
	version?: string;
	/** A short word or sentence beside it: Up to date, Update available… */
	note?: string;
	tone?: 'ok' | 'update' | 'muted' | 'error';
}>;

/** Development builds carry this version and no release to compare. */
const DEVELOPMENT_VERSION = '0.0.0';

const DEVICE_CHANNEL_LABELS: Readonly<Record<string, string>> = Object.freeze({
	stable: 'Stable',
	nightly: 'Nightly',
	canary: 'Canary',
});

export function deviceChannelLabel(channel: string | undefined): string {
	return DEVICE_CHANNEL_LABELS[channel ?? 'stable'] ?? 'Stable';
}

/**
 * Running and Latest for Terminay Desktop. `formatTime` turns the last check's
 * ISO time into words.
 */
export function deviceVersionLines(
	status: DeviceUpdateStatusLike | null,
	channel: string | undefined,
	formatTime: (iso: string) => string,
): readonly [VersionLine, VersionLine] {
	const latestLabel = `Latest on ${deviceChannelLabel(channel)}`;
	if (status === null)
		return [
			{ label: 'Running', note: 'Unknown', tone: 'muted' },
			{ label: latestLabel, note: 'Not checked yet', tone: 'muted' },
		];
	const running: VersionLine = { label: 'Running', version: status.currentVersion };
	if (status.currentVersion === DEVELOPMENT_VERSION)
		return [
			{ ...running, note: 'Development build', tone: 'muted' },
			{ label: latestLabel, note: 'A development build has no release version', tone: 'muted' },
		];
	const checked = status.checkedAt === null ? undefined : `checked ${formatTime(status.checkedAt)}`;
	if (status.latestVersion !== null)
		return [
			running,
			{
				label: latestLabel,
				version: status.latestVersion,
				note: ['Update available', checked].filter(Boolean).join(' · '),
				tone: 'update',
			},
		];
	if (status.state === 'checking')
		return [running, { label: latestLabel, note: 'Checking…', tone: 'muted' }];
	if (status.errorMessage !== null)
		return [
			running,
			{
				label: latestLabel,
				note: `The last check failed: ${status.errorMessage}`,
				tone: 'error',
			},
		];
	if (status.checkedAt === null)
		return [running, { label: latestLabel, note: 'Not checked yet', tone: 'muted' }];
	return [
		running,
		{
			label: latestLabel,
			version: status.currentVersion,
			note: ['Up to date', checked].filter(Boolean).join(' · '),
			tone: 'ok',
		},
	];
}

/** A published track a server can be moved to, and the CLI reference naming it. */
export type ServerTrack = Readonly<{
	channel: 'tag' | 'main' | 'canary';
	label: string;
	/** What `terminay daemon upgrade` is given to follow this track. */
	ref: string;
}>;

export const SERVER_TRACKS: readonly ServerTrack[] = Object.freeze([
	{ channel: 'tag', label: 'Stable', ref: 'latest' },
	{ channel: 'main', label: 'Nightly', ref: 'main' },
	{ channel: 'canary', label: 'Canary', ref: 'canary' },
]);

export function serverTrackLabel(channel: ServerUpgradeStatusLike['channel']): string {
	if (channel === undefined || channel === 'source') return 'Source';
	return SERVER_TRACKS.find((track) => track.channel === channel)?.label ?? 'Source';
}

export type TrackCommand = Readonly<{ label: string; command: string }>;

export type ServerUpdatesModel =
	| Readonly<{
			kind: 'local';
			running?: VersionLine;
	  }>
	| Readonly<{ kind: 'no-status'; running?: VersionLine }>
	| Readonly<{
			kind: 'tracked';
			trackLabel: string;
			running: VersionLine;
			latest: VersionLine;
			/** A newer release on the track that the server can install itself. */
			upgradeAvailable: boolean;
			commands: readonly TrackCommand[];
	  }>;

/**
 * The Updates page of one server. The Local server is named by the caller from
 * the host's own connection profile, never from a missing channel: a remote
 * server run from a checkout reports no channel either.
 */
export function serverUpdatesModel(
	options: Readonly<{
		isLocal: boolean;
		status?: ServerUpgradeStatusLike;
		/** The version the server said hello with, for a server that publishes
		 * no upgrade status. */
		helloVersion?: string;
		/** Terminay Desktop's own version: the Local server is built into it and
		 * runs exactly that version. */
		desktopVersion?: string;
	}>,
): ServerUpdatesModel {
	const { status } = options;
	if (options.isLocal) {
		const version = options.desktopVersion ?? status?.version;
		return {
			kind: 'local',
			...(version === undefined ? {} : { running: { label: 'Running', version } }),
		};
	}
	if (status === undefined)
		return {
			kind: 'no-status',
			...(options.helloVersion === undefined
				? {}
				: { running: { label: 'Running', version: options.helloVersion } }),
		};
	const trackLabel = serverTrackLabel(status.channel);
	const running: VersionLine = { label: 'Running', version: status.version };
	const published = status.channel !== undefined && status.channel !== 'source';
	const latest: VersionLine = !published
		? { label: 'Latest', note: 'A source install has no published latest version', tone: 'muted' }
		: status.available !== undefined
			? {
					label: `Latest on ${trackLabel}`,
					version: status.available.version,
					note: 'Update available',
					tone: 'update',
				}
			: {
					label: `Latest on ${trackLabel}`,
					version: status.version,
					note: 'Up to date',
					tone: 'ok',
				};
	return {
		kind: 'tracked',
		trackLabel,
		running,
		latest,
		upgradeAvailable: status.available !== undefined && status.canUpgrade,
		commands: SERVER_TRACKS.filter((track) => track.channel !== status.channel).map(
			(track) => ({ label: track.label, command: `terminay daemon upgrade ${track.ref}` }),
		),
	};
}
