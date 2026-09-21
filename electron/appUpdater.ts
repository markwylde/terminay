import type { AppUpdater as ElectronAppUpdater } from 'electron-updater';
import type {
	AppReleaseNote,
	AppUpdateChannel,
	AppUpdateState,
	AppUpdateStatus,
} from '../src/types/terminay';

const REPOSITORY_OWNER = 'markwylde';
const REPOSITORY_NAME = 'terminay';
const RELEASES_URL = `https://github.com/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/releases`;
const RELEASES_API_URL = `https://api.github.com/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/releases?per_page=100`;
// The rolling `main` prerelease (ADR-0016) is the Beta channel's feed.
const BETA_RELEASE_TAG = 'main-latest';
const BETA_FEED_URL = `${RELEASES_URL}/download/${BETA_RELEASE_TAG}/`;
const STABLE_FEED_URL = `${RELEASES_URL}/latest/download/`;

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
	isWritable: (path: string) => boolean;
	channel: AppUpdateChannel;
	loadUpdater: () => Promise<UpdaterLike>;
	fetch: FetchLike;
	now?: () => number;
	log?: (message: string, error?: unknown) => void;
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
	/** Records that the next graceful quit should install and relaunch. */
	requestRestartToUpdate(): boolean;
	cancelRestartToUpdate(): void;
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

/** Notes electron-updater read from the channel metadata (the Beta channel's source). */
export function releaseNotesFromUpdateInfo(
	info: UpdateInfoLike,
	version: string,
): AppReleaseNote[] | null {
	const notes = info.releaseNotes;
	if (typeof notes === 'string' && notes.trim() !== '')
		return [{ version, url: `${RELEASES_URL}/tag/${BETA_RELEASE_TAG}`, markdown: capNote(notes) }];
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
	isWritable: (path: string) => boolean;
}): boolean {
	if (!options.isPackaged) return false;
	if (options.platform === 'darwin') return true;
	if (options.platform !== 'linux') return false;
	const appImage = options.appImagePath;
	if (!appImage?.startsWith('/')) return false;
	const directory = appImage.slice(0, appImage.lastIndexOf('/')) || '/';
	return options.isWritable(appImage) && options.isWritable(directory);
}

/**
 * Where an offered version comes from. The Stable channel only ever reads the
 * stable source; the Beta channel reads both and takes the higher version.
 */
type UpdateSource = AppUpdateChannel;

function sourceMetadataUrl(
	source: UpdateSource,
	platform: NodeJS.Platform,
): string | null {
	const suffix =
		platform === 'darwin' ? '-mac' : platform === 'linux' ? '-linux' : null;
	if (suffix === null) return null;
	return source === 'beta'
		? `${BETA_FEED_URL}beta${suffix}.yml`
		: `${STABLE_FEED_URL}latest${suffix}.yml`;
}

function releasePageUrl(source: UpdateSource, version: string): string {
	return source === 'beta'
		? `${RELEASES_URL}/tag/${BETA_RELEASE_TAG}`
		: `${RELEASES_URL}/tag/v${version}`;
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
			detail:
				'This build cannot install updates in place. Open the release page from the title bar.',
		};
	if (status.errorMessage !== null)
		return {
			message: 'Terminay could not check for updates.',
			detail: status.errorMessage,
		};
	return {
		message: 'Terminay is up to date.',
		detail: `Version ${status.currentVersion} is the newest release on the ${
			status.channel === 'beta' ? 'Beta' : 'Stable'
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
	let inFlight: Promise<AppUpdateStatus> | null = null;
	let updaterPromise: Promise<UpdaterLike> | null = null;
	let notesPromise: Promise<void> | null = null;

	function status(): AppUpdateStatus {
		const shownVersion = downloadedVersion ?? latestVersion;
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
		if (source === 'beta') {
			releaseNotes = info ? releaseNotesFromUpdateInfo(info, version) : null;
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
					if (state !== 'downloading') state = 'checking';
				});
				updater.on('update-available', (info: UpdateInfoLike) => {
					const version = versionString(info.version);
					if (!version) return;
					latestVersion = version;
					offeredSource = checkSource;
					failure = null;
					if (downloadedVersion !== version) {
						state = 'downloading';
						downloadPercent = 0;
					}
					loadNotes(version, checkSource, info);
				});
				updater.on('update-not-available', () => {
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
				});
				updater.on('error', (error: unknown) => {
					log('[updater] update failed', error);
					failure = errorMessage(error);
					if (downloadedVersion !== null) {
						state = 'ready';
						return;
					}
					downloadPercent = null;
					// A newer release we could not install in place is still worth
					// surfacing: fall back to linking its release page.
					state = latestVersion !== null ? 'available' : 'error';
				});
				return updater;
			});
		}
		return updaterPromise;
	}

	function configureFeed(updater: UpdaterLike, source: UpdateSource): void {
		if (source === 'beta') {
			updater.setFeedURL({
				provider: 'generic',
				url: BETA_FEED_URL,
				channel: 'beta',
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
		const url = sourceMetadataUrl(source, options.platform);
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
	 * The source to check and the version it publishes. Beta is stable plus
	 * prereleases: it takes whichever source is higher, so a stable release is
	 * not held back until `main` next publishes a beta. One unreadable source
	 * leaves the other; a tie keeps the rolling prerelease.
	 */
	async function selectSource(): Promise<{
		source: UpdateSource;
		version: string;
	}> {
		if (channel === 'stable')
			return { source: 'stable', version: await probeVersion('stable') };
		const [beta, stable] = await Promise.allSettled([
			probeVersion('beta'),
			probeVersion('stable'),
		]);
		if (beta.status === 'rejected') {
			if (stable.status === 'rejected') throw beta.reason;
			return { source: 'stable', version: stable.value };
		}
		if (
			stable.status === 'fulfilled' &&
			compareVersions(stable.value, beta.value) > 0
		)
			return { source: 'stable', version: stable.value };
		return { source: 'beta', version: beta.value };
	}

	async function checkInPlace(): Promise<void> {
		const updater = await getUpdater();
		// Stable has one source, so only Beta pays for the probe. When neither
		// source can be read the updater still checks the rolling prerelease and
		// reports the failure itself.
		checkSource =
			channel === 'stable'
				? 'stable'
				: await selectSource().then(
						(selected) => selected.source,
						() => 'beta' as const,
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
		if (sourceMetadataUrl(channel, options.platform) === null) {
			state = 'idle';
			return;
		}
		const { source, version } = await selectSource();
		checkSource = source;
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
		async setChannel(next) {
			if (next === channel) return status();
			channel = next;
			generation += 1;
			// What was found on the other channel no longer applies. A payload
			// already downloaded stays installable on quit; electron-updater
			// replaces it if the new channel offers something newer.
			latestVersion = null;
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
