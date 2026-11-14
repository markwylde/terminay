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
	canInstallInPlace?: boolean;
	channelLatest?: Readonly<{
		version: string;
		order: 'newer' | 'same' | 'older';
	}> | null;
	installingLatest?: string | null;
}>;

/** The part of a server's published upgrade status these pages read. */
export type ServerUpgradeStatusLike = Readonly<{
	version: string;
	channel?: 'tag' | 'main' | 'canary' | 'source';
	available?: Readonly<{ version: string }>;
	canUpgrade: boolean;
	latest?: Readonly<{
		version: string;
		order: 'newer' | 'same' | 'older';
		canInstall: boolean;
		unavailable?: Readonly<{ reason: string; command: string }>;
	}>;
	upgrade?: Readonly<{ state: string }>;
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
	if (status.channelLatest?.order === 'older')
		return [
			running,
			{
				label: latestLabel,
				version: status.channelLatest.version,
				note: ['Older than this build', checked].filter(Boolean).join(' · '),
				tone: 'muted',
			},
		];
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

/**
 * Install latest on <channel>: the one action that may move backwards
 * (ADR-0117). Shown disabled, with the reason, when it cannot run.
 */
export type InstallLatestAction = Readonly<{
	label: string;
	/** The build it installs. Absent until a check has resolved one. */
	version?: string;
	/** The build is older than the running one, so the confirmation warns. */
	downgrade: boolean;
	enabled: boolean;
	reason?: string;
	/** A command to run on the host instead, with a copy action. */
	command?: string;
}>;

/** Install latest for Terminay Desktop, or null where it cannot update itself. */
export function deviceInstallLatest(
	status: DeviceUpdateStatusLike | null,
	channel: string | undefined,
): InstallLatestAction | null {
	const label = `Install latest on ${deviceChannelLabel(channel)}`;
	if (status === null) return null;
	const disabled = (reason: string, version?: string): InstallLatestAction => ({
		label,
		...(version === undefined ? {} : { version }),
		downgrade: false,
		enabled: false,
		reason,
	});
	if (status.currentVersion === DEVELOPMENT_VERSION)
		return disabled('A development build has no release version.');
	if (status.canInstallInPlace !== true) return null;
	if (status.installingLatest != null)
		return disabled(`Downloading ${status.installingLatest}…`, status.installingLatest);
	if (status.state === 'downloading')
		return disabled('Wait for the download in progress to finish.');
	const latest = status.channelLatest;
	if (latest == null)
		return disabled(status.state === 'checking' ? 'Checking…' : 'Not checked yet.');
	if (latest.order === 'same')
		return disabled(
			`This build is already the latest on ${deviceChannelLabel(channel)}.`,
			latest.version,
		);
	return {
		label,
		version: latest.version,
		downgrade: latest.order === 'older',
		enabled: true,
	};
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
			/** Install latest on the track (ADR-0117), when the status names one. */
			installLatest?: InstallLatestAction;
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
			: status.latest?.order === 'older'
				? {
						label: `Latest on ${trackLabel}`,
						version: status.latest.version,
						note: 'Older than this server',
						tone: 'muted',
					}
				: {
						label: `Latest on ${trackLabel}`,
						version: status.version,
						note: 'Up to date',
						tone: 'ok',
					};
	const installLatest = serverInstallLatest(status, trackLabel);
	return {
		kind: 'tracked',
		trackLabel,
		running,
		latest,
		upgradeAvailable: status.available !== undefined && status.canUpgrade,
		...(installLatest === undefined ? {} : { installLatest }),
		commands: SERVER_TRACKS.filter((track) => track.channel !== status.channel).map(
			(track) => ({ label: track.label, command: `terminay daemon upgrade ${track.ref}` }),
		),
	};
}

/** Install latest for a remote server, from the status it publishes. */
function serverInstallLatest(
	status: ServerUpgradeStatusLike,
	trackLabel: string,
): InstallLatestAction | undefined {
	const latest = status.latest;
	if (latest === undefined || status.channel === undefined || status.channel === 'source')
		return undefined;
	const label = `Install latest on ${trackLabel}`;
	const base = {
		label,
		version: latest.version,
		downgrade: latest.order === 'older',
	};
	if (latest.order === 'same')
		return {
			...base,
			downgrade: false,
			enabled: false,
			reason: `This server already runs the latest release on ${trackLabel}.`,
		};
	if (status.upgrade?.state === 'in-progress')
		return { ...base, enabled: false, reason: 'An upgrade is in progress.' };
	if (!latest.canInstall)
		return {
			...base,
			enabled: false,
			reason:
				latest.unavailable?.reason ?? 'This server cannot install this release itself.',
			...(latest.unavailable === undefined ? {} : { command: latest.unavailable.command }),
		};
	return { ...base, enabled: true };
}
