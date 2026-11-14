import { win32 } from 'node:path';
import type { AppUpdater as ElectronAppUpdater } from 'electron-updater';
import type {
	AppChannelLatest,
	AppReleaseNote,
	AppUpdateChannel,
	AppUpdateState,
	AppUpdateStatus,
} from '../src/types/terminay';

const REPOSITORY_OWNER = 'markwylde';
const REPOSITORY_NAME = 'terminay';
const RELEASES_URL = `https://github.com/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/releases`;
const RELEASES_API_URL = `https://api.github.com/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/releases?per_page=100`;
const STABLE_FEED_URL = `${RELEASES_URL}/latest/download/`;

/** A channel that reads a rolling prerelease as well as the stable release. */
export type PrereleaseChannel = Exclude<AppUpdateChannel, 'stable'>;

/**
 * Each prerelease channel's own rolling release (ADR-0110): the Nightly is
 * `main-latest`, the Canary `canary-latest`. Each publishes metadata named
 * for its channel, so electron-updater reads `nightly-mac.yml` or
 * `canary-mac.yml` from its feed.
 */
export const PRERELEASE_RELEASE_TAGS: Readonly<
	Record<PrereleaseChannel, string>
> = Object.freeze({ nightly: 'main-latest', canary: 'canary-latest' });

function prereleaseFeedUrl(channel: PrereleaseChannel): string {
	return `${RELEASES_URL}/download/${PRERELEASE_RELEASE_TAGS[channel]}/`;
}

const CHANNEL_NAMES: Readonly<Record<AppUpdateChannel, string>> =
	Object.freeze({ stable: 'Stable', nightly: 'Nightly', canary: 'Canary' });

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** A forced check (the hourly timer, a retry after failure) still waits this long between network checks. */
const MIN_RECHECK_MS = 10 * 60 * 1000;
const MAX_RELEASE_NOTE_BYTES = 64 * 1024;
const MAX_RELEASE_NOTES = 50;

/** The slice of electron-updater's `AppUpdater` this module drives. */
export type UpdaterLike = Pick<
	ElectronAppUpdater,
	| 'autoDownload'
	| 'autoInstallOnAppQuit'
	| 'allowDowngrade'
	| 'allowPrerelease'
	| 'fullChangelog'
	| 'disableDifferentialDownload'
	| 'setFeedURL'
	| 'checkForUpdates'
	| 'quitAndInstall'
	| 'on'
>;

type UpdateInfoLike = {
	version?: unknown;
	releaseNotes?: unknown;
};

export type FetchLike = (
	url: string,
	init?: { headers?: Record<string, string> },
) => Promise<{
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
	text(): Promise<string>;
}>;

export interface AppUpdaterOptions {
	currentVersion: string;
	isPackaged: boolean;
	platform: NodeJS.Platform;
	/** `process.env.APPIMAGE` on Linux. */
	appImagePath?: string | undefined;
	/** `process.execPath`, which on Windows says where the installer put it. */
	executablePath?: string | undefined;
	/** `process.env.LOCALAPPDATA` on Windows. */
	localAppData?: string | undefined;
	isWritable: (path: string) => boolean;
	channel: AppUpdateChannel;
	loadUpdater: () => Promise<UpdaterLike>;
	fetch: FetchLike;
	now?: () => number;
	log?: (message: string, error?: unknown) => void;
	/** Called when a download starts, finishes, or fails outside a check's own result. */
	onStatusChanged?: () => void;
	/**
	 * Called once an Install latest download is verified and a restart to it
	 * has been requested; the host then quits gracefully, and `finishQuit`
	 * installs it.
	 */
	onRestartRequested?: () => void;
	/**
	 * A test-only feed in place of the channel's rolling prerelease. With it
	 * the stable source is not read, so a probe sees only the build it serves.
	 */
	testFeedUrl?: string | undefined;
}

export interface AppUpdater {
	/**
	 * Current status. Checks the network first when the last check is over an
	 * hour old, or over ten minutes old when forced or after a failure. A
	 * manual check (Help > Check for Updates…) always checks the network.
	 */
	check(options?: {
		force?: boolean;
		manual?: boolean;
	}): Promise<AppUpdateStatus>;
	getStatus(): AppUpdateStatus;
	setChannel(channel: AppUpdateChannel): Promise<AppUpdateStatus>;
	/**
	 * Download the latest build the selected channel publishes, even when it is
	 * older than the running one, then request a restart into it (ADR-0117).
	 * `expectedVersion` is the version the user confirmed; the updater resolves
	 * the build itself and refuses when that resolution differs, or when it is
	 * the running build.
	 */
	installLatest(expectedVersion: string): Promise<AppUpdateStatus>;
	/** Records that the next graceful quit should install and relaunch. */
	requestRestartToUpdate(): boolean;
	cancelRestartToUpdate(): void;
	/** Whether the quit now in progress is a Restart to update. */
	isRestartToUpdateRequested(): boolean;
	/**
	 * The final quit of a graceful shutdown: installs and relaunches when a
	 * restart to update was requested, and otherwise (or on failure) calls `quit`.
	 */
	finishQuit(quit: () => void): void;
}

// ---------------------------------------------------------------------------
// Versions

type ParsedVersion = {
	core: [number, number, number];
	prerelease: Array<string | number>;
};

export function parseVersion(value: string): ParsedVersion | null {
	const match =
		/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
			value.trim(),
		);
	if (!match) return null;
	return {
		core: [Number(match[1]), Number(match[2]), Number(match[3])],
		prerelease:
			match[4] === undefined
				? []
				: match[4]
						.split('.')
						.map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
	};
}

/** Semantic-version precedence; unparseable versions sort lowest. */
export function compareVersions(left: string, right: string): number {
	const a = parseVersion(left);
	const b = parseVersion(right);
	if (!a || !b) return a ? 1 : b ? -1 : 0;
	for (let index = 0; index < 3; index += 1) {
		if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
	}
	if (a.prerelease.length === 0 || b.prerelease.length === 0)
		return b.prerelease.length - a.prerelease.length;
	for (
		let index = 0;
		index < Math.max(a.prerelease.length, b.prerelease.length);
		index += 1
	) {
		const x = a.prerelease[index];
		const y = b.prerelease[index];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		if (x === y) continue;
		if (typeof x === 'number' && typeof y === 'number') return x - y;
		if (typeof x === 'number') return -1;
		if (typeof y === 'number') return 1;
		return x < y ? -1 : 1;
	}
	return 0;
}

function versionString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	return parseVersion(value) ? value.trim().replace(/^v/, '') : null;
}

// ---------------------------------------------------------------------------
// Release notes

function capNote(markdown: string): string {
	if (Buffer.byteLength(markdown, 'utf8') <= MAX_RELEASE_NOTE_BYTES)
		return markdown;
	return `${Buffer.from(markdown, 'utf8')
		.subarray(0, MAX_RELEASE_NOTE_BYTES)
		.toString('utf8')
		.replace(/\uFFFD+$/u, '')}\n\n…`;
}

/**
 * Stable notes: every published, non-prerelease `vX.Y.Z` release with
 * `installed < version <= available`, newest first.
 */
export async function fetchStableReleaseNotes(
	fetchImpl: FetchLike,
	installedVersion: string,
	availableVersion: string,
): Promise<AppReleaseNote[]> {
	const response = await fetchImpl(RELEASES_API_URL, {
		headers: {
			Accept: 'application/vnd.github+json',
			'User-Agent': `Terminay/${installedVersion}`,
			'X-GitHub-Api-Version': '2022-11-28',
		},
	});
	if (!response.ok)
		throw new Error(`GitHub responded with ${response.status}`);
	const releases = await response.json();
	if (!Array.isArray(releases))
		throw new Error('GitHub returned an unexpected release list.');
	const notes: AppReleaseNote[] = [];
	for (const release of releases) {
		if (typeof release !== 'object' || release === null) continue;
		const record = release as Record<string, unknown>;
		if (record.draft === true || record.prerelease === true) continue;
		if (
			typeof record.tag_name !== 'string' ||
			!/^v\d+\.\d+\.\d+$/.test(record.tag_name)
		)
			continue;
		const version = record.tag_name.slice(1);
		if (
			compareVersions(version, installedVersion) <= 0 ||
			compareVersions(version, availableVersion) > 0
		)
			continue;
		notes.push({
			version,
			url: `${RELEASES_URL}/tag/${record.tag_name}`,
			markdown: capNote(typeof record.body === 'string' ? record.body : ''),
		});
	}
	notes.sort((left, right) => compareVersions(right.version, left.version));
	return notes.slice(0, MAX_RELEASE_NOTES);
}

/** Notes electron-updater read from a prerelease channel's own metadata. */
export function releaseNotesFromUpdateInfo(
	info: UpdateInfoLike,
	version: string,
	channel: PrereleaseChannel,
): AppReleaseNote[] | null {
	const notes = info.releaseNotes;
	if (typeof notes === 'string' && notes.trim() !== '')
		return [
			{
				version,
				url: `${RELEASES_URL}/tag/${PRERELEASE_RELEASE_TAGS[channel]}`,
				markdown: capNote(notes),
			},
		];
	if (Array.isArray(notes)) {
		const entries: AppReleaseNote[] = [];
		for (const entry of notes) {
			if (typeof entry !== 'object' || entry === null) continue;
			const record = entry as Record<string, unknown>;
			const entryVersion = versionString(record.version);
			if (!entryVersion || typeof record.note !== 'string') continue;
			entries.push({
				version: entryVersion,
				url: null,
				markdown: capNote(record.note),
			});
		}
		return entries.length > 0 ? entries : null;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Capability

export function canInstallInPlace(options: {
	isPackaged: boolean;
	platform: NodeJS.Platform;
	appImagePath?: string | undefined;
	executablePath?: string | undefined;
	localAppData?: string | undefined;
	isWritable: (path: string) => boolean;
}): boolean {
	if (!options.isPackaged) return false;
	if (options.platform === 'darwin') return true;
	if (options.platform === 'win32') return canInstallInPlaceOnWindows(options);
	if (options.platform !== 'linux') return false;
	const appImage = options.appImagePath;
	if (!appImage?.startsWith('/')) return false;
	const directory = appImage.slice(0, appImage.lastIndexOf('/')) || '/';
	return options.isWritable(appImage) && options.isWritable(directory);
}

/**
 * The per-user installer puts Terminay in `%LOCALAPPDATA%\Programs\Terminay`,
 * which the user owns, so an update runs without elevation into the directory
 * it replaces. A build that runs from anywhere else was not put there by the
 * installer and is only told about updates.
 */
function canInstallInPlaceOnWindows(options: {
	executablePath?: string | undefined;
	localAppData?: string | undefined;
	isWritable: (path: string) => boolean;
}): boolean {
	const { executablePath, localAppData } = options;
	if (executablePath === undefined || localAppData === undefined) return false;
	const installDirectory = win32.join(localAppData, 'Programs', 'Terminay');
	const directory = win32.dirname(win32.resolve(executablePath));
	if (directory.toLowerCase() !== win32.resolve(installDirectory).toLowerCase())
		return false;
	return options.isWritable(directory);
}

/**
 * Where an offered version comes from. The Stable channel only ever reads the
 * stable source; a Nightly or Canary channel reads its own rolling prerelease
 * and the stable source, and takes the higher version. Neither reads the
 * other's prerelease.
 */
type UpdateSource = AppUpdateChannel;

function sourceMetadataUrl(
	source: UpdateSource,
	platform: NodeJS.Platform,
	feedUrl: (channel: PrereleaseChannel) => string = prereleaseFeedUrl,
): string | null {
	// electron-updater's Windows metadata carries no platform suffix.
	const suffix =
		platform === 'darwin'
			? '-mac'
			: platform === 'linux'
				? '-linux'
				: platform === 'win32'
					? ''
					: null;
	if (suffix === null) return null;
	return source === 'stable'
		? `${STABLE_FEED_URL}latest${suffix}.yml`
		: `${feedUrl(source)}${source}${suffix}.yml`;
}

function releasePageUrl(source: UpdateSource, version: string): string {
	return source === 'stable'
		? `${RELEASES_URL}/tag/v${version}`
		: `${RELEASES_URL}/tag/${PRERELEASE_RELEASE_TAGS[source]}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unable to check for updates.';
}

/** What Help > Check for Updates… tells the user once its check settles. */
export function describeManualCheck(status: AppUpdateStatus): {
	message: string;
	detail: string;
} {
	const version = status.latestVersion;
	if (status.state === 'ready' && version !== null)
		return {
			message: `Terminay ${version} is ready to install.`,
			detail:
				'Choose Restart to Update in the title bar, or quit Terminay to install it.',
		};
	if (status.state === 'downloading' && version !== null)
		return {
			message: `Terminay ${version} is downloading.`,
			detail:
				'Restart to Update appears in the title bar once the download has been verified.',
		};
	if (status.hasUpdate && version !== null)
		return {
			message: `Terminay ${version} is available.`,
			detail: `${
				status.canInstallInPlace === true
					? 'The update could not be downloaded.'
					: 'This build cannot install updates in place.'
			} Open the release page from the title bar.`,
		};
	if (status.errorMessage !== null)
		return {
			message: 'Terminay could not check for updates.',
			detail: status.errorMessage,
		};
	return {
		message: 'Terminay is up to date.',
		detail: `Version ${status.currentVersion} is the newest release on the ${
			CHANNEL_NAMES[status.channel ?? 'stable'] ?? CHANNEL_NAMES.stable
		} channel.`,
	};
}

// ---------------------------------------------------------------------------
// Updater

export function createAppUpdater(options: AppUpdaterOptions): AppUpdater {
	const now = options.now ?? Date.now;
	const log = options.log ?? (() => {});
	const currentVersion = versionString(options.currentVersion) ?? '0.0.0';
	const installable = canInstallInPlace(options);
	const feedUrl = (prerelease: PrereleaseChannel): string =>
		options.testFeedUrl ?? prereleaseFeedUrl(prerelease);

	let channel = options.channel;
	let generation = 0;
	let state: AppUpdateState = 'idle';
	let checkedAt: string | null = null;
	let lastCheckStartedAt = Number.NEGATIVE_INFINITY;
	let latestVersion: string | null = null;
	/** The source the running check reads, and the one the shown version came from. */
	let checkSource: UpdateSource = channel;
	let offeredSource: UpdateSource | null = null;
	let downloadedVersion: string | null = null;
	let downloadPercent: number | null = null;
	let failure: string | null = null;
	let notesVersion: string | null = null;
	let releaseNotes: AppReleaseNote[] | null = null;
	let releaseNotesError: string | null = null;
	let restartRequested = false;
	/** The latest version on the channel, as the last check resolved it. */
	let channelLatest: AppChannelLatest | null = null;
	/** The version an Install latest is downloading, to restart into once verified. */
	let installingLatest: string | null = null;
	let inFlight: Promise<AppUpdateStatus> | null = null;
	let updaterPromise: Promise<UpdaterLike> | null = null;
	let notesPromise: Promise<void> | null = null;

	function status(): AppUpdateStatus {
		// While a newer release downloads over a waiting one, name the newer.
		const shownVersion =
			state === 'downloading'
				? (latestVersion ?? downloadedVersion)
				: (downloadedVersion ?? latestVersion);
		const hasUpdate =
			downloadedVersion !== null ||
			(state === 'available' && latestVersion !== null);
		return {
			state,
			channel,
			checkedAt,
			currentVersion,
			canInstallInPlace: installable,
			downloadPercent,
			errorMessage: failure,
			hasUpdate,
			latestVersion: shownVersion,
			releaseUrl:
				shownVersion === null
					? null
					: releasePageUrl(offeredSource ?? channel, shownVersion),
			releaseNotes,
			releaseNotesError,
			channelLatest: installable ? channelLatest : null,
			installingLatest,
		};
	}

	function noteChannelLatest(version: string, source: UpdateSource): void {
		const compared = compareVersions(version, currentVersion);
		channelLatest = {
			version,
			source,
			order: compared > 0 ? 'newer' : compared < 0 ? 'older' : 'same',
		};
	}

	function loadNotes(
		version: string,
		source: UpdateSource,
		info: UpdateInfoLike | null,
	): void {
		if (notesVersion === version) return;
		notesVersion = version;
		releaseNotes = null;
		releaseNotesError = null;
		if (source !== 'stable') {
			releaseNotes = info
				? releaseNotesFromUpdateInfo(info, version, source)
				: null;
			if (releaseNotes === null)
				releaseNotesError = 'No release notes were published with this build.';
			return;
		}
		const requested = version;
		notesPromise = fetchStableReleaseNotes(
			options.fetch,
			currentVersion,
			version,
		)
			.then((notes) => {
				if (notesVersion !== requested) return;
				releaseNotes = notes;
				if (notes.length === 0)
					releaseNotesError = 'No release notes were found for this update.';
			})
			.catch((error) => {
				if (notesVersion !== requested) return;
				// Allow the next check to try again.
				notesVersion = null;
				releaseNotesError = `Release notes could not be loaded: ${errorMessage(error)}`;
				log('[updater] release notes failed', error);
			});
	}

	async function getUpdater(): Promise<UpdaterLike> {
		if (!updaterPromise) {
			updaterPromise = options.loadUpdater().then((updater) => {
				updater.autoDownload = true;
				updater.autoInstallOnAppQuit = true;
				updater.fullChangelog = false;
				updater.on('checking-for-update', () => {
					// A downloaded update stays ready while the feed is re-read.
					if (state !== 'downloading' && downloadedVersion === null)
						state = 'checking';
				});
				updater.on('update-available', (info: UpdateInfoLike) => {
					const version = versionString(info.version);
					if (!version) return;
					noteChannelLatest(version, checkSource);
					latestVersion = version;
					offeredSource = checkSource;
					failure = null;
					if (downloadedVersion !== version) {
						state = 'downloading';
						downloadPercent = 0;
					}
					loadNotes(version, checkSource, info);
					options.onStatusChanged?.();
				});
				updater.on('update-not-available', (info?: UpdateInfoLike) => {
					const version = versionString(info?.version);
					if (version) noteChannelLatest(version, checkSource);
					if (downloadedVersion === null) {
						state = 'idle';
						latestVersion = null;
						offeredSource = null;
					}
				});
				updater.on('download-progress', (progress: { percent?: unknown }) => {
					if (typeof progress.percent === 'number')
						downloadPercent = Math.max(0, Math.min(100, progress.percent));
				});
				updater.on('update-downloaded', (info: UpdateInfoLike) => {
					const version = versionString(info.version);
					if (!version) return;
					downloadedVersion = version;
					latestVersion = version;
					offeredSource = checkSource;
					downloadPercent = 100;
					failure = null;
					state = 'ready';
					loadNotes(version, checkSource, info);
					if (installingLatest === version) {
						// The user confirmed this build: go straight to it.
						installingLatest = null;
						restartRequested = true;
						options.onStatusChanged?.();
						options.onRestartRequested?.();
						return;
					}
					options.onStatusChanged?.();
				});
				updater.on('error', (error: unknown) => {
					log('[updater] update failed', error);
					failure = errorMessage(error);
					installingLatest = null;
					if (downloadedVersion !== null) {
						// The update already waiting is still the one to install.
						state = 'ready';
						latestVersion = downloadedVersion;
						downloadPercent = 100;
					} else {
						downloadPercent = null;
						// A newer release we could not install in place is still worth
						// surfacing: fall back to linking its release page.
						state = latestVersion !== null ? 'available' : 'error';
					}
					options.onStatusChanged?.();
				});
				return updater;
			});
		}
		return updaterPromise;
	}

	function configureFeed(updater: UpdaterLike, source: UpdateSource): void {
		if (source !== 'stable') {
			updater.setFeedURL({
				provider: 'generic',
				url: feedUrl(source),
				channel: source,
			});
			// The rolling release replaces its payloads, so the previous
			// build's blockmap is never there to diff against.
			updater.disableDifferentialDownload = true;
			updater.allowPrerelease = true;
		} else {
			updater.setFeedURL({
				provider: 'github',
				owner: REPOSITORY_OWNER,
				repo: REPOSITORY_NAME,
				releaseType: 'release',
			});
			updater.disableDifferentialDownload = false;
			updater.allowPrerelease = false;
		}
		// Changing channel never installs something older than what runs.
		updater.allowDowngrade = false;
	}

	async function probeVersion(source: UpdateSource): Promise<string> {
		if (source === 'stable' && options.testFeedUrl !== undefined)
			throw new Error('A test feed serves no stable source.');
		const url = sourceMetadataUrl(source, options.platform, feedUrl);
		if (url === null)
			throw new Error('This platform publishes no update metadata.');
		const response = await options.fetch(url, {
			headers: { 'User-Agent': `Terminay/${currentVersion}` },
		});
		if (!response.ok)
			throw new Error(`GitHub responded with ${response.status}`);
		const metadata = await response.text();
		const version = versionString(
			/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(metadata)?.[1],
		);
		if (!version)
			throw new Error('The update metadata did not name a valid version.');
		return version;
	}

	/**
	 * The source to check and the version it publishes. A prerelease channel is
	 * stable plus its own prerelease: it takes whichever source is higher, so a
	 * stable release is not held back until `main` next publishes a build on
	 * that track. One unreadable source leaves the other; a tie keeps the
	 * rolling prerelease. Canary never reads the nightly prerelease: every
	 * nightly commit was pushed first, so canary already offered it or
	 * something newer.
	 */
	async function selectSource(): Promise<{
		source: UpdateSource;
		version: string;
	}> {
		const prereleaseChannel = channel;
		if (prereleaseChannel === 'stable')
			return { source: 'stable', version: await probeVersion('stable') };
		const [prerelease, stable] = await Promise.allSettled([
			probeVersion(prereleaseChannel),
			probeVersion('stable'),
		]);
		if (prerelease.status === 'rejected') {
			if (stable.status === 'rejected') throw prerelease.reason;
			return { source: 'stable', version: stable.value };
		}
		if (
			stable.status === 'fulfilled' &&
			compareVersions(stable.value, prerelease.value) > 0
		)
			return { source: 'stable', version: stable.value };
		return { source: prereleaseChannel, version: prerelease.value };
	}

	async function checkInPlace(): Promise<void> {
		const updater = await getUpdater();
		// Stable has one source, so only a prerelease channel pays for the
		// probe. When neither source can be read the updater still checks the
		// channel's rolling prerelease and reports the failure itself.
		const checking = channel;
		checkSource =
			checking === 'stable'
				? 'stable'
				: await selectSource().then(
						(selected) => {
							noteChannelLatest(selected.version, selected.source);
							return selected.source;
						},
						() => checking,
					);
		configureFeed(updater, checkSource);
		const result = (await updater.checkForUpdates()) as {
			downloadPromise?: Promise<unknown> | null;
		} | null;
		// Download progress and failure arrive as events; the promise itself only
		// needs containing so a failed download is not an unhandled rejection.
		void result?.downloadPromise?.catch(() => {});
	}

	async function checkForNotice(): Promise<void> {
		if (sourceMetadataUrl(channel, options.platform, feedUrl) === null) {
			state = 'idle';
			return;
		}
		const { source, version } = await selectSource();
		checkSource = source;
		noteChannelLatest(version, source);
		if (compareVersions(version, currentVersion) > 0) {
			latestVersion = version;
			offeredSource = source;
			state = 'available';
			loadNotes(version, source, null);
		} else {
			latestVersion = null;
			offeredSource = null;
			state = 'idle';
		}
	}

	async function runCheck(): Promise<AppUpdateStatus> {
		const startedGeneration = generation;
		lastCheckStartedAt = now();
		if (currentVersion === '0.0.0') {
			// Development builds carry no release version to compare.
			checkedAt = new Date(now()).toISOString();
			return status();
		}
		if (state !== 'downloading' && state !== 'ready') state = 'checking';
		failure = null;
		try {
			if (installable) await checkInPlace();
			else await checkForNotice();
		} catch (error) {
			if (startedGeneration === generation) {
				log('[updater] check failed', error);
				failure = errorMessage(error);
				if (downloadedVersion !== null) state = 'ready';
				else state = latestVersion !== null ? 'available' : 'error';
			}
		}
		if (state === 'checking') state = latestVersion !== null ? 'available' : 'idle';
		checkedAt = new Date(now()).toISOString();
		if (notesPromise) await notesPromise.catch(() => {});
		return status();
	}

	async function runInstallLatest(
		expectedVersion: string,
	): Promise<AppUpdateStatus> {
		const updater = await getUpdater();
		const selected = await selectSource();
		noteChannelLatest(selected.version, selected.source);
		if (compareVersions(selected.version, currentVersion) === 0)
			throw new Error(
				`Terminay ${currentVersion} is already the latest on the ${CHANNEL_NAMES[channel]} channel.`,
			);
		if (selected.version !== expectedVersion)
			throw new Error(
				`The ${CHANNEL_NAMES[channel]} channel now publishes ${selected.version}, not ${expectedVersion}. Review it and try again.`,
			);
		checkSource = selected.source;
		configureFeed(updater, selected.source);
		installingLatest = selected.version;
		failure = null;
		// The one check that may move backwards (ADR-0117). Downloading needs no
		// permission of its own, so it is withdrawn as soon as the check settles.
		updater.allowDowngrade = true;
		let result: { downloadPromise?: Promise<unknown> | null } | null;
		try {
			result = (await updater.checkForUpdates()) as typeof result;
		} catch (error) {
			installingLatest = null;
			throw error;
		} finally {
			updater.allowDowngrade = false;
		}
		void result?.downloadPromise?.catch(() => {});
		if (installingLatest !== null && state !== 'downloading' && state !== 'ready') {
			installingLatest = null;
			throw new Error(
				`Terminay ${selected.version} could not be fetched from the ${CHANNEL_NAMES[channel]} channel.`,
			);
		}
		return status();
	}

	function installLatest(expectedVersion: string): Promise<AppUpdateStatus> {
		if (!installable)
			return Promise.reject(
				new Error('This build cannot install updates in place.'),
			);
		if (currentVersion === '0.0.0')
			return Promise.reject(
				new Error('A development build has no release version to replace.'),
			);
		const run = (async () => {
			if (inFlight) await inFlight.catch(() => {});
			return runInstallLatest(expectedVersion);
		})();
		const tracked: Promise<AppUpdateStatus> = run.finally(() => {
			if (inFlight === tracked) inFlight = null;
		});
		inFlight = tracked;
		return tracked;
	}

	function check(checkOptions?: {
		force?: boolean;
		manual?: boolean;
	}): Promise<AppUpdateStatus> {
		if (inFlight) return inFlight;
		const elapsed = now() - lastCheckStartedAt;
		const due =
			checkOptions?.manual === true ||
			elapsed >= UPDATE_CHECK_INTERVAL_MS ||
			(checkOptions?.force === true && elapsed >= MIN_RECHECK_MS) ||
			(state === 'error' && elapsed >= MIN_RECHECK_MS);
		if (!due) return Promise.resolve(status());
		inFlight = runCheck().finally(() => {
			inFlight = null;
		});
		return inFlight;
	}

	return {
		check,
		getStatus: status,
		installLatest,
		async setChannel(next) {
			if (next === channel) return status();
			channel = next;
			generation += 1;
			// What was found on the other channel no longer applies. A payload
			// already downloaded stays installable on quit; electron-updater
			// replaces it if the new channel offers something newer.
			latestVersion = null;
			channelLatest = null;
			notesVersion = null;
			releaseNotes = null;
			releaseNotesError = null;
			if (downloadedVersion === null) {
				state = 'idle';
				offeredSource = null;
			}
			if (inFlight) await inFlight.catch(() => {});
			lastCheckStartedAt = Number.NEGATIVE_INFINITY;
			return check({ force: true });
		},
		requestRestartToUpdate() {
			if (!installable || downloadedVersion === null) return false;
			restartRequested = true;
			return true;
		},
		cancelRestartToUpdate() {
			restartRequested = false;
		},
		isRestartToUpdateRequested() {
			return restartRequested && downloadedVersion !== null;
		},
		finishQuit(quit) {
			if (!restartRequested || downloadedVersion === null || !updaterPromise) {
				quit();
				return;
			}
			restartRequested = false;
			void updaterPromise
				.then((updater) => updater.quitAndInstall(false, true))
				.catch((error) => {
					log('[updater] restart to update failed', error);
					quit();
				});
		},
	};
}
