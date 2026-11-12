import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
	canInstallInPlace,
	compareVersions,
	createAppUpdater,
	describeManualCheck,
	fetchStableReleaseNotes,
	releaseNotesFromUpdateInfo,
} from '../electron/appUpdater.ts';
import {
	releaseNoteLinkTarget,
	releaseTrackLabel,
	renderReleaseNotesHtml,
} from '../src/appUpdateNotes.ts';
import {
	defaultTerminalSettings,
	normalizeTerminalSettings,
	selectDeviceTerminalSettings,
} from '../src/terminalSettings.ts';

// The semver electron-updater itself decides "newer" with.
const require = createRequire(import.meta.url);
const electronUpdaterSemver = require(
	require.resolve('semver', { paths: [require.resolve('electron-updater')] }),
);

test('update channel is a device setting defaulting to stable', () => {
	assert.equal(defaultTerminalSettings.updateChannel, 'stable');
	for (const channel of ['stable', 'nightly', 'canary'])
		assert.equal(normalizeTerminalSettings({ updateChannel: channel }).updateChannel, channel);
	// Any value that is not one of the three reads as Stable.
	for (const value of ['alpha', 'main', 'Nightly', '', null, 3, undefined])
		assert.equal(normalizeTerminalSettings({ updateChannel: value }).updateChannel, 'stable', String(value));
	assert.equal(
		selectDeviceTerminalSettings(normalizeTerminalSettings({ updateChannel: 'canary' })).updateChannel,
		'canary',
	);
});

test('a stored Beta channel reads as Nightly', () => {
	assert.equal(normalizeTerminalSettings({ updateChannel: 'beta' }).updateChannel, 'nightly');
	assert.equal(
		selectDeviceTerminalSettings(normalizeTerminalSettings({ updateChannel: 'beta' })).updateChannel,
		'nightly',
	);
});

const HOUR = 60 * 60 * 1000;

class FakeUpdater extends EventEmitter {
	autoDownload = false;
	autoInstallOnAppQuit = false;
	allowDowngrade = true;
	allowPrerelease = true;
	fullChangelog = true;
	disableDifferentialDownload = false;
	feeds = [];
	checks = 0;
	installs = [];
	onCheck = async () => null;

	setFeedURL(options) {
		this.feeds.push(options);
	}

	async checkForUpdates() {
		this.checks += 1;
		this.emit('checking-for-update');
		return this.onCheck(this);
	}

	quitAndInstall(isSilent, isForceRunAfter) {
		this.installs.push([isSilent, isForceRunAfter]);
	}
}

function jsonResponse(value, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => value,
		text: async () => JSON.stringify(value),
	};
}

function textResponse(value, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => JSON.parse(value),
		text: async () => value,
	};
}

const releases = [
	{ tag_name: 'main-latest', prerelease: true, draft: false, body: 'rolling' },
	{ tag_name: 'v1.4.0', prerelease: false, draft: false, body: '## 1.4.0 notes' },
	{ tag_name: 'v1.5.0', prerelease: false, draft: true, body: 'draft' },
	{ tag_name: 'v1.2.0', prerelease: false, draft: false, body: 'installed' },
	{ tag_name: 'v1.3.0', prerelease: false, draft: false, body: '## 1.3.0 notes' },
	{ tag_name: 'v1.1.0', prerelease: false, draft: false, body: 'old' },
];

function harness(overrides = {}) {
	let clock = 1_000_000;
	const updater = new FakeUpdater();
	const fetches = [];
	const quits = [];
	const appUpdater = createAppUpdater({
		currentVersion: '1.2.0',
		isPackaged: true,
		platform: 'darwin',
		isWritable: () => true,
		channel: 'stable',
		loadUpdater: async () => updater,
		fetch: async (url) => {
			fetches.push(url);
			if (url.startsWith('https://api.github.com/')) return jsonResponse(releases);
			return textResponse('version: 1.2.0\n', 404);
		},
		now: () => clock,
		...overrides,
	});
	return {
		appUpdater,
		updater,
		fetches,
		quits,
		quit: () => quits.push('quit'),
		advance: (ms) => {
			clock += ms;
		},
	};
}

function downloadsVersion(version, releaseNotes) {
	return async (updater) => {
		updater.emit('update-available', { version, releaseNotes });
		updater.emit('download-progress', { percent: 40 });
		updater.emit('update-downloaded', { version, releaseNotes });
		return { downloadPromise: Promise.resolve([]) };
	};
}

test('semantic version precedence covers nightly and canary prereleases', () => {
	assert.ok(compareVersions('0.43.0-main.5.canary', '0.43.0') < 0);
	assert.ok(compareVersions('0.43.0-main.5.nightly', '0.42.9') > 0);
	assert.ok(compareVersions('0.43.0-main.10.canary', '0.43.0-main.9.nightly') > 0);
	assert.ok(compareVersions('0.43.0-main.10.nightly', '0.43.0-main.10.canary') > 0);
	assert.ok(compareVersions('0.43.0-beta.99', '0.43.0-main.1.canary') < 0);
	// The updater and electron-updater agree on every one of these.
	for (const [left, right] of [
		['0.43.0-main.10.canary', '0.43.0-main.9.nightly'],
		['0.43.0-main.10.nightly', '0.43.0-main.10.canary'],
		['0.43.0-main.1.canary', '0.43.0-beta.99'],
		['0.43.0', '0.43.0-main.10.nightly'],
	])
		assert.equal(electronUpdaterSemver.gt(left, right), compareVersions(left, right) > 0, `${left} > ${right}`);
	assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
	assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
});

test('a Windows build installs in place only from the per-user install directory', () => {
	const writable = () => true;
	const localAppData = 'C:\\Users\\ada\\AppData\\Local';
	const installed = { isPackaged: true, platform: 'win32', localAppData, isWritable: writable };
	assert.equal(
		canInstallInPlace({ ...installed, executablePath: 'C:\\Users\\ada\\AppData\\Local\\Programs\\Terminay\\Terminay.exe' }),
		true,
	);
	// Windows paths compare without case.
	assert.equal(
		canInstallInPlace({ ...installed, executablePath: 'c:\\users\\ADA\\appdata\\local\\programs\\terminay\\Terminay.exe' }),
		true,
	);
	assert.equal(canInstallInPlace({ ...installed, executablePath: 'C:\\Program Files\\Terminay\\Terminay.exe' }), false);
	assert.equal(canInstallInPlace({ ...installed, executablePath: 'D:\\portable\\Terminay.exe' }), false);
	assert.equal(canInstallInPlace({ ...installed, executablePath: undefined }), false);
	assert.equal(
		canInstallInPlace({
			...installed,
			executablePath: 'C:\\Users\\ada\\AppData\\Local\\Programs\\Terminay\\Terminay.exe',
			isWritable: () => false,
		}),
		false,
	);
	assert.equal(
		canInstallInPlace({
			...installed,
			isPackaged: false,
			executablePath: 'C:\\Users\\ada\\AppData\\Local\\Programs\\Terminay\\Terminay.exe',
		}),
		false,
	);
});

for (const [channel, metadata] of [
	['stable', 'https://github.com/markwylde/terminay/releases/latest/download/latest.yml'],
	['nightly', 'https://github.com/markwylde/terminay/releases/download/main-latest/nightly.yml'],
	['canary', 'https://github.com/markwylde/terminay/releases/download/canary-latest/canary.yml'],
]) {
	test(`a Windows build on the ${channel} channel reads ${metadata.split('/').pop()}`, async () => {
		const fetched = [];
		const h = harness({
			isPackaged: true,
			platform: 'win32',
			channel,
			executablePath: 'D:\\portable\\Terminay.exe',
			localAppData: 'C:\\Users\\ada\\AppData\\Local',
			loadUpdater: async () => assert.fail('the updater must not be loaded'),
			fetch: async (url) => {
				fetched.push(url);
				if (url.endsWith('.yml'))
					return textResponse('version: 1.4.0\nfiles:\n  - url: Terminay-Windows-1.4.0-Setup.exe\n');
				return jsonResponse([]);
			},
		});
		await h.appUpdater.check();
		assert.ok(fetched.includes(metadata), `fetched ${fetched.join(', ')}`);
	});
}

test('only packaged macOS builds and writable AppImages install in place', () => {
	const writable = () => true;
	assert.equal(canInstallInPlace({ isPackaged: false, platform: 'darwin', isWritable: writable }), false);
	assert.equal(canInstallInPlace({ isPackaged: true, platform: 'darwin', isWritable: writable }), true);
	assert.equal(canInstallInPlace({ isPackaged: true, platform: 'linux', isWritable: writable }), false);
	assert.equal(
		canInstallInPlace({ isPackaged: true, platform: 'linux', appImagePath: '/home/u/Apps/Terminay.AppImage', isWritable: writable }),
		true,
	);
	assert.equal(
		canInstallInPlace({
			isPackaged: true,
			platform: 'linux',
			appImagePath: '/opt/Terminay.AppImage',
			isWritable: (target) => target !== '/opt',
		}),
		false,
	);
});

test('stable notes list every skipped release, newest first, excluding drafts and prereleases', async () => {
	const notes = await fetchStableReleaseNotes(async () => jsonResponse(releases), '1.2.0', '1.4.0');
	assert.deepEqual(
		notes.map((note) => [note.version, note.markdown]),
		[
			['1.4.0', '## 1.4.0 notes'],
			['1.3.0', '## 1.3.0 notes'],
		],
	);
	assert.equal(notes[0].url, 'https://github.com/markwylde/terminay/releases/tag/v1.4.0');
	await assert.rejects(fetchStableReleaseNotes(async () => jsonResponse({}, 403), '1.2.0', '1.4.0'), /403/u);
});

test('prerelease notes come from the channel metadata and link the track release', () => {
	assert.deepEqual(releaseNotesFromUpdateInfo({ releaseNotes: '- feat: a' }, '1.3.0-main.4.nightly', 'nightly'), [
		{
			version: '1.3.0-main.4.nightly',
			url: 'https://github.com/markwylde/terminay/releases/tag/main-latest',
			markdown: '- feat: a',
		},
	]);
	assert.deepEqual(releaseNotesFromUpdateInfo({ releaseNotes: '- feat: b' }, '1.3.0-main.5.canary', 'canary'), [
		{
			version: '1.3.0-main.5.canary',
			url: 'https://github.com/markwylde/terminay/releases/tag/canary-latest',
			markdown: '- feat: b',
		},
	]);
	assert.equal(releaseNotesFromUpdateInfo({ releaseNotes: '' }, '1.3.0-main.4.nightly', 'nightly'), null);
});

test("What's new names a prerelease build's track, and a stable release's none", () => {
	assert.equal(releaseTrackLabel('1.3.0-main.4.nightly'), 'Nightly build');
	assert.equal(releaseTrackLabel('1.3.0-main.5.canary'), 'Canary build');
	for (const version of ['1.3.0', '1.3.0-beta.4', null, '1.3.0-main.0.canary'])
		assert.equal(releaseTrackLabel(version), null, String(version));
});

test('an installable build surfaces an update only once it is downloaded', async () => {
	const h = harness();
	let midDownload;
	h.updater.onCheck = async (updater) => {
		updater.emit('update-available', { version: '1.4.0' });
		midDownload = h.appUpdater.getStatus();
		updater.emit('update-downloaded', { version: '1.4.0' });
		return { downloadPromise: Promise.resolve([]) };
	};
	const status = await h.appUpdater.check();

	assert.equal(midDownload.state, 'downloading');
	assert.equal(midDownload.hasUpdate, false);
	assert.equal(status.state, 'ready');
	assert.equal(status.hasUpdate, true);
	assert.equal(status.latestVersion, '1.4.0');
	assert.equal(status.canInstallInPlace, true);
	assert.deepEqual(
		status.releaseNotes.map((note) => note.version),
		['1.4.0', '1.3.0'],
	);
	assert.equal(h.updater.autoDownload, true);
	assert.equal(h.updater.autoInstallOnAppQuit, true);
	assert.equal(h.updater.allowDowngrade, false);
	assert.equal(h.updater.allowPrerelease, false);
	assert.deepEqual(h.updater.feeds.at(-1), {
		provider: 'github',
		owner: 'markwylde',
		repo: 'terminay',
		releaseType: 'release',
	});
});

test('re-checking a downloaded update keeps it ready to install', async () => {
	const changes = [];
	const h = harness({ onStatusChanged: () => changes.push('changed') });
	h.updater.onCheck = downloadsVersion('1.4.0');
	await h.appUpdater.check();

	// The feed still names the downloaded version; its payload is re-verified
	// only after the check itself has resolved.
	h.updater.onCheck = async (updater) => {
		updater.emit('update-available', { version: '1.4.0' });
		return { downloadPromise: Promise.resolve([]) };
	};
	const status = await h.appUpdater.check({ manual: true });

	assert.equal(status.state, 'ready');
	assert.equal(status.latestVersion, '1.4.0');
	assert.equal(describeManualCheck(status).message, 'Terminay 1.4.0 is ready to install.');
	assert.equal(h.appUpdater.requestRestartToUpdate(), true);
	assert.ok(changes.length > 0);
});

test('a newer release replaces a downloaded one that was never installed', async () => {
	const h = harness();
	h.updater.onCheck = downloadsVersion('1.3.0');
	await h.appUpdater.check();

	h.updater.onCheck = async (updater) => {
		updater.emit('update-available', { version: '1.4.0' });
		return { downloadPromise: Promise.resolve([]) };
	};
	const downloading = await h.appUpdater.check({ manual: true });
	assert.equal(downloading.state, 'downloading');
	assert.equal(downloading.latestVersion, '1.4.0');
	assert.equal(describeManualCheck(downloading).message, 'Terminay 1.4.0 is downloading.');

	h.updater.emit('update-downloaded', { version: '1.4.0' });
	const ready = h.appUpdater.getStatus();
	assert.equal(ready.state, 'ready');
	assert.equal(ready.latestVersion, '1.4.0');
});

test('a newer release that fails to download leaves the waiting one ready', async () => {
	const h = harness();
	h.updater.onCheck = downloadsVersion('1.3.0');
	await h.appUpdater.check();

	h.updater.onCheck = async (updater) => {
		updater.emit('update-available', { version: '1.4.0' });
		updater.emit('error', new Error('sha512 checksum mismatch'));
		return { downloadPromise: Promise.resolve([]) };
	};
	const status = await h.appUpdater.check({ manual: true });
	assert.equal(status.state, 'ready');
	assert.equal(status.latestVersion, '1.3.0');
});

test('a failed download falls back to linking the release page', async () => {
	const h = harness();
	h.updater.onCheck = async (updater) => {
		updater.emit('update-available', { version: '1.4.0' });
		updater.emit('error', new Error('sha512 checksum mismatch'));
		return { downloadPromise: Promise.reject(new Error('sha512 checksum mismatch')) };
	};
	const status = await h.appUpdater.check();
	assert.equal(status.state, 'available');
	assert.equal(status.hasUpdate, true);
	assert.equal(status.releaseUrl, 'https://github.com/markwylde/terminay/releases/tag/v1.4.0');
	assert.match(status.errorMessage, /checksum/u);
	assert.equal(h.appUpdater.requestRestartToUpdate(), false);
});

test('a failed check shows nothing and retries later', async () => {
	const h = harness();
	h.updater.onCheck = async () => {
		throw new Error('offline');
	};
	const status = await h.appUpdater.check();
	assert.equal(status.state, 'error');
	assert.equal(status.hasUpdate, false);
	h.advance(11 * 60 * 1000);
	h.updater.onCheck = async () => null;
	await h.appUpdater.check();
	assert.equal(h.updater.checks, 2);
});

test('renderer polling does not hit the network more than hourly', async () => {
	const h = harness();
	await h.appUpdater.check();
	await h.appUpdater.check();
	h.advance(30 * 60 * 1000);
	await h.appUpdater.check();
	assert.equal(h.updater.checks, 1);
	await h.appUpdater.check({ force: true });
	assert.equal(h.updater.checks, 2);
	h.advance(HOUR);
	await h.appUpdater.check();
	assert.equal(h.updater.checks, 3);
});

test('a manual check reaches the network inside the hourly pacing', async () => {
	const h = harness();
	await h.appUpdater.check();
	h.advance(60 * 1000);
	await h.appUpdater.check({ force: true });
	assert.equal(h.updater.checks, 1);
	const status = await h.appUpdater.check({ manual: true });
	assert.equal(h.updater.checks, 2);
	assert.equal(describeManualCheck(status).message, 'Terminay is up to date.');
});

test('a manual check reports what it found', () => {
	const base = {
		checkedAt: null,
		currentVersion: '1.0.0',
		errorMessage: null,
		hasUpdate: false,
		latestVersion: null,
		releaseUrl: null,
		state: 'idle',
		channel: 'nightly',
	};
	assert.match(describeManualCheck(base).detail, /1\.0\.0.*Nightly channel/u);
	assert.match(describeManualCheck({ ...base, channel: 'canary' }).detail, /Canary channel/u);
	assert.match(describeManualCheck({ ...base, channel: 'stable' }).detail, /Stable channel/u);
	assert.equal(
		describeManualCheck({ ...base, state: 'downloading', latestVersion: '1.1.0' })
			.message,
		'Terminay 1.1.0 is downloading.',
	);
	assert.equal(
		describeManualCheck({
			...base,
			state: 'ready',
			hasUpdate: true,
			latestVersion: '1.1.0',
		}).message,
		'Terminay 1.1.0 is ready to install.',
	);
	assert.equal(
		describeManualCheck({
			...base,
			state: 'available',
			hasUpdate: true,
			latestVersion: '1.1.0',
		}).message,
		'Terminay 1.1.0 is available.',
	);
	assert.deepEqual(
		describeManualCheck({ ...base, state: 'error', errorMessage: 'offline' }),
		{ message: 'Terminay could not check for updates.', detail: 'offline' },
	);
});

test('a build that cannot install in place only notifies and links', async () => {
	const h = harness({
		isPackaged: true,
		platform: 'linux',
		appImagePath: undefined,
		loadUpdater: async () => assert.fail('the updater must not be loaded'),
		fetch: async (url) => {
			assert.equal(url, 'https://github.com/markwylde/terminay/releases/latest/download/latest-linux.yml');
			return textResponse("version: 1.4.0\nfiles:\n  - url: Terminay-Linux-1.4.0.AppImage\n");
		},
	});
	const status = await h.appUpdater.check();
	assert.equal(status.state, 'available');
	assert.equal(status.hasUpdate, true);
	assert.equal(status.canInstallInPlace, false);
	assert.equal(status.releaseUrl, 'https://github.com/markwylde/terminay/releases/tag/v1.4.0');
	assert.equal(h.appUpdater.requestRestartToUpdate(), false);
});

test('a notice-only build reports nothing when it is current', async () => {
	const h = harness({
		isPackaged: false,
		fetch: async () => textResponse('version: 1.2.0\n'),
	});
	const status = await h.appUpdater.check();
	assert.equal(status.state, 'idle');
	assert.equal(status.hasUpdate, false);
});

const NIGHTLY_FEED_URL = 'https://github.com/markwylde/terminay/releases/download/main-latest/';
const CANARY_FEED_URL = 'https://github.com/markwylde/terminay/releases/download/canary-latest/';
const NIGHTLY_METADATA_URL = `${NIGHTLY_FEED_URL}nightly-mac.yml`;
const CANARY_METADATA_URL = `${CANARY_FEED_URL}canary-mac.yml`;
const LEGACY_BETA_METADATA_URL = `${NIGHTLY_FEED_URL}beta-mac.yml`;
const STABLE_METADATA_URL =
	'https://github.com/markwylde/terminay/releases/latest/download/latest-mac.yml';
const STABLE_FEED = {
	provider: 'github',
	owner: 'markwylde',
	repo: 'terminay',
	releaseType: 'release',
};
const NIGHTLY_FEED = { provider: 'generic', url: NIGHTLY_FEED_URL, channel: 'nightly' };
const CANARY_FEED = { provider: 'generic', url: CANARY_FEED_URL, channel: 'canary' };
const PRERELEASE = {
	nightly: { feed: NIGHTLY_FEED, metadata: NIGHTLY_METADATA_URL, tag: 'main-latest' },
	canary: { feed: CANARY_FEED, metadata: CANARY_METADATA_URL, tag: 'canary-latest' },
};

for (const channel of ['nightly', 'canary']) {
	test(`switching to ${channel} repoints the feed and checks immediately without allowing downgrade`, async () => {
		const h = harness();
		await h.appUpdater.check();
		const version = `1.3.0-main.3300.${channel}`;
		h.updater.onCheck = downloadsVersion(version, `- feat: ${channel} thing`);
		const status = await h.appUpdater.setChannel(channel);
		assert.equal(h.updater.checks, 2);
		assert.deepEqual(h.updater.feeds.at(-1), PRERELEASE[channel].feed);
		assert.equal(h.updater.allowDowngrade, false);
		assert.equal(h.updater.disableDifferentialDownload, true);
		assert.equal(status.channel, channel);
		assert.equal(status.state, 'ready');
		assert.equal(status.releaseUrl, `https://github.com/markwylde/terminay/releases/tag/${PRERELEASE[channel].tag}`);
		assert.deepEqual(status.releaseNotes, [
			{
				version,
				url: `https://github.com/markwylde/terminay/releases/tag/${PRERELEASE[channel].tag}`,
				markdown: `- feat: ${channel} thing`,
			},
		]);
	});

	test(`a ${channel} install returning to stable keeps prereleases and downgrades off`, async () => {
		const h = harness({ currentVersion: `1.3.0-main.3300.${channel}`, channel });
		await h.appUpdater.check();
		await h.appUpdater.setChannel('stable');
		assert.equal(h.updater.allowPrerelease, false);
		assert.equal(h.updater.allowDowngrade, false);
		assert.equal(h.updater.feeds.at(-1).provider, 'github');
	});
}

/**
 * A Desktop on `channel` whose sources publish the given versions (null:
 * unreadable). Every URL it fetches is recorded.
 */
function trackHarness({ channel = 'nightly', nightly = null, canary = null, stable = null, ...overrides }) {
	const h = harness({
		currentVersion: `1.3.0-main.3290.${channel === 'stable' ? 'nightly' : channel}`,
		channel,
		...overrides,
		fetch: async (url) => {
			h.fetches.push(url);
			if (url.startsWith('https://api.github.com/')) return jsonResponse(releases);
			const version =
				url === NIGHTLY_METADATA_URL
					? nightly
					: url === CANARY_METADATA_URL
						? canary
						: url === STABLE_METADATA_URL
							? stable
							: null;
			return version === null
				? textResponse('', 404)
				: textResponse(`version: ${version}\nfiles: []\n`);
		},
	});
	return h;
}

test('nightly offers a stable release that is newer than the latest nightly', async () => {
	const h = trackHarness({
		currentVersion: '5.8.0-main.3290.nightly',
		nightly: '5.8.0-main.3300.nightly',
		stable: '5.8.0',
	});
	h.updater.onCheck = downloadsVersion('5.8.0');
	const status = await h.appUpdater.check();
	assert.deepEqual(h.updater.feeds.at(-1), STABLE_FEED);
	assert.equal(h.updater.allowPrerelease, false);
	assert.equal(h.updater.allowDowngrade, false);
	assert.equal(h.updater.disableDifferentialDownload, false);
	assert.equal(status.state, 'ready');
	assert.equal(status.latestVersion, '5.8.0');
	assert.equal(status.channel, 'nightly');
	assert.equal(status.releaseUrl, 'https://github.com/markwylde/terminay/releases/tag/v5.8.0');
});

test('canary keeps its rolling prerelease when it is newer than stable', async () => {
	const h = trackHarness({
		channel: 'canary',
		currentVersion: '5.8.0',
		canary: '5.9.0-main.3320.canary',
		stable: '5.8.0',
	});
	h.updater.onCheck = downloadsVersion('5.9.0-main.3320.canary', '- feat: canary thing');
	const status = await h.appUpdater.check();
	assert.deepEqual(h.updater.feeds.at(-1), CANARY_FEED);
	assert.equal(h.updater.allowPrerelease, true);
	assert.equal(h.updater.allowDowngrade, false);
	assert.equal(status.latestVersion, '5.9.0-main.3320.canary');
	assert.equal(status.releaseUrl, 'https://github.com/markwylde/terminay/releases/tag/canary-latest');
	assert.equal(status.releaseNotes[0].markdown, '- feat: canary thing');
	assert.equal(releaseTrackLabel(status.latestVersion), 'Canary build');
});

test('nightly resumes after a stable release without leaving the channel', async () => {
	const h = trackHarness({
		currentVersion: '5.8.0',
		nightly: '5.9.0-main.3330.nightly',
		stable: '5.8.0',
	});
	h.updater.onCheck = downloadsVersion('5.9.0-main.3330.nightly', '- next');
	const status = await h.appUpdater.check();
	assert.deepEqual(h.updater.feeds.at(-1), NIGHTLY_FEED);
	assert.equal(status.latestVersion, '5.9.0-main.3330.nightly');
	assert.equal(status.channel, 'nightly');
});

test('moving from nightly to canary offers the later canary commit', async () => {
	const h = trackHarness({
		channel: 'nightly',
		currentVersion: '6.3.0-main.3300.nightly',
		nightly: '6.3.0-main.3300.nightly',
		canary: '6.3.0-main.3312.canary',
		stable: '6.2.0',
	});
	await h.appUpdater.check();
	h.updater.onCheck = downloadsVersion('6.3.0-main.3312.canary', '- later');
	const status = await h.appUpdater.setChannel('canary');
	assert.deepEqual(h.updater.feeds.at(-1), CANARY_FEED);
	assert.equal(status.channel, 'canary');
	assert.equal(status.latestVersion, '6.3.0-main.3312.canary');
	assert.equal(h.updater.allowDowngrade, false);
});

test('moving from canary to nightly offers nothing until nightly reaches that commit', async () => {
	// A notice-only build decides itself, so the version comparison is visible.
	const behind = trackHarness({
		isPackaged: false,
		channel: 'canary',
		currentVersion: '6.3.0-main.3312.canary',
		nightly: '6.3.0-main.3300.nightly',
		canary: '6.3.0-main.3312.canary',
		stable: '6.2.0',
	});
	await behind.appUpdater.check();
	const waiting = await behind.appUpdater.setChannel('nightly');
	assert.equal(waiting.channel, 'nightly');
	assert.equal(waiting.hasUpdate, false);
	assert.equal(waiting.latestVersion, null);

	// A nightly of the same commit is offered: it swaps in the notarized build.
	const same = trackHarness({
		isPackaged: false,
		channel: 'nightly',
		currentVersion: '6.3.0-main.3312.canary',
		nightly: '6.3.0-main.3312.nightly',
		stable: '6.2.0',
	});
	const offered = await same.appUpdater.check();
	assert.equal(offered.hasUpdate, true);
	assert.equal(offered.latestVersion, '6.3.0-main.3312.nightly');
	assert.equal(offered.releaseUrl, 'https://github.com/markwylde/terminay/releases/tag/main-latest');
});

test('canary reads its own prerelease and stable, never the nightly prerelease', async () => {
	const h = trackHarness({
		channel: 'canary',
		currentVersion: '6.3.0-main.3312.canary',
		nightly: '6.3.0-main.3400.nightly',
		canary: '6.3.0-main.3312.canary',
		stable: '6.2.0',
	});
	h.updater.onCheck = async () => null;
	await h.appUpdater.check();
	assert.ok(h.fetches.includes(CANARY_METADATA_URL), h.fetches.join(', '));
	assert.ok(h.fetches.includes(STABLE_METADATA_URL), h.fetches.join(', '));
	assert.equal(h.fetches.some((url) => url.includes('/main-latest/')), false);
	assert.deepEqual(h.updater.feeds.at(-1), CANARY_FEED);
});

test('nightly reads its own prerelease and stable, never the canary prerelease', async () => {
	const h = trackHarness({
		isPackaged: false,
		channel: 'nightly',
		currentVersion: '6.3.0-main.3300.nightly',
		nightly: '6.3.0-main.3300.nightly',
		canary: '6.3.0-main.3400.canary',
		stable: '6.2.0',
	});
	const status = await h.appUpdater.check();
	assert.equal(status.hasUpdate, false);
	assert.ok(h.fetches.includes(NIGHTLY_METADATA_URL), h.fetches.join(', '));
	assert.equal(h.fetches.some((url) => url.includes('/canary-latest/')), false);
});

for (const channel of ['nightly', 'canary']) {
	test(`${channel} proceeds with whichever source can be read`, async () => {
		const version = `1.3.0-main.3300.${channel}`;
		const stableDown = trackHarness({ channel, [channel]: version, stable: null });
		stableDown.updater.onCheck = downloadsVersion(version, '- prerelease');
		const fromPrerelease = await stableDown.appUpdater.check();
		assert.deepEqual(stableDown.updater.feeds.at(-1), PRERELEASE[channel].feed);
		assert.equal(fromPrerelease.state, 'ready');
		assert.equal(fromPrerelease.errorMessage, null);

		const prereleaseDown = trackHarness({ channel, [channel]: null, stable: '1.3.0' });
		prereleaseDown.updater.onCheck = downloadsVersion('1.3.0');
		const fromStable = await prereleaseDown.appUpdater.check();
		assert.deepEqual(prereleaseDown.updater.feeds.at(-1), STABLE_FEED);
		assert.equal(fromStable.latestVersion, '1.3.0');
		assert.equal(fromStable.errorMessage, null);
	});

	test(`${channel} with neither source readable fails through the updater and retries`, async () => {
		const h = trackHarness({ channel });
		h.updater.onCheck = async () => {
			throw new Error('net::ERR_INTERNET_DISCONNECTED');
		};
		const status = await h.appUpdater.check();
		assert.deepEqual(h.updater.feeds.at(-1), PRERELEASE[channel].feed);
		assert.equal(status.state, 'error');
		assert.equal(status.hasUpdate, false);
		h.advance(11 * 60 * 1000);
		await h.appUpdater.check();
		assert.equal(h.updater.checks, 2);
	});
}

test('a test feed replaces the rolling prerelease and the stable source is not read', async () => {
	const feed = 'http://127.0.0.1:41234/';
	const fetches = [];
	const h = harness({
		currentVersion: '1.3.0-main.3290.nightly',
		channel: 'nightly',
		testFeedUrl: feed,
		fetch: async (url) => {
			fetches.push(url);
			if (url.startsWith('https://api.github.com/')) return jsonResponse(releases);
			return url === `${feed}nightly-mac.yml`
				? textResponse('version: 1.3.0-main.3291.nightly\nfiles: []\n')
				: textResponse('version: 1.9.0\nfiles: []\n');
		},
	});
	h.updater.onCheck = downloadsVersion('1.3.0-main.3291.nightly');
	const status = await h.appUpdater.check();
	assert.deepEqual(h.updater.feeds.at(-1), { provider: 'generic', url: feed, channel: 'nightly' });
	assert.equal(fetches.includes(STABLE_METADATA_URL), false);
	assert.equal(fetches.includes(NIGHTLY_METADATA_URL), false);
	assert.equal(status.latestVersion, '1.3.0-main.3291.nightly');
});

test('the stable channel never reads a rolling prerelease', async () => {
	const h = trackHarness({
		currentVersion: '1.2.0',
		channel: 'stable',
		nightly: '1.4.0-main.3300.nightly',
		canary: '1.4.0-main.3312.canary',
		stable: '1.3.0',
	});
	h.updater.onCheck = downloadsVersion('1.3.0');
	await h.appUpdater.check();
	assert.deepEqual(h.updater.feeds.at(-1), STABLE_FEED);
	assert.equal(h.fetches.includes(NIGHTLY_METADATA_URL), false);
	assert.equal(h.fetches.includes(CANARY_METADATA_URL), false);
	assert.equal(h.fetches.includes(STABLE_METADATA_URL), false);
});

test('a notice-only nightly build is told about a newer stable release and downloads nothing', async () => {
	const h = trackHarness({
		isPackaged: false,
		nightly: '1.3.0-main.3300.nightly',
		stable: '1.3.0',
		loadUpdater: async () => assert.fail('the updater must not be loaded'),
	});
	const status = await h.appUpdater.check();
	assert.equal(status.state, 'available');
	assert.equal(status.hasUpdate, true);
	assert.equal(status.latestVersion, '1.3.0');
	assert.equal(status.channel, 'nightly');
	assert.equal(status.releaseUrl, 'https://github.com/markwylde/terminay/releases/tag/v1.3.0');
	assert.deepEqual(
		status.releaseNotes.map((note) => note.version),
		['1.3.0'],
	);
	assert.equal(releaseTrackLabel(status.latestVersion), null);
});

test('a notice-only canary build offers nothing when neither source is newer', async () => {
	const h = trackHarness({
		isPackaged: false,
		channel: 'canary',
		currentVersion: '1.3.0',
		canary: '1.3.0-main.3300.canary',
		stable: '1.3.0',
	});
	const status = await h.appUpdater.check();
	assert.equal(status.state, 'idle');
	assert.equal(status.hasUpdate, false);
	assert.equal(status.releaseUrl, null);
});

test('a notice-only prerelease build fails only when neither source can be read', async () => {
	const h = trackHarness({ isPackaged: false, channel: 'canary' });
	const status = await h.appUpdater.check();
	assert.equal(status.state, 'error');
	assert.equal(status.hasUpdate, false);
	assert.match(status.errorMessage, /404/u);
});

test('an installed beta build is offered the first nightly on its legacy feed, and becomes Nightly', async () => {
	// The installed Beta build runs the updater it shipped with: the generic
	// provider on main-latest, channel `beta`, so it reads beta-mac.yml. While
	// the legacy feed lasts, the nightly workflow publishes byte copies of the
	// nightly metadata under that name, naming the same main payloads.
	const legacyMetadata = 'version: 6.3.0-main.3300.nightly\nfiles:\n  - url: terminay-desktop-main-mac.zip\n';
	const fetched = [];
	const fetchLegacy = async (url) => {
		fetched.push(url);
		return url === LEGACY_BETA_METADATA_URL ? textResponse(legacyMetadata) : textResponse('', 404);
	};
	const offered = /^version:\s*(\S+)$/mu.exec(await (await fetchLegacy(LEGACY_BETA_METADATA_URL)).text())[1];
	assert.equal(offered, '6.3.0-main.3300.nightly');
	// electron-updater offers a feed's version when it is semver-greater than the
	// running one, with downgrades off; the Beta build compares exactly so.
	assert.ok(electronUpdaterSemver.gt(offered, '6.3.0-beta.812'));
	assert.ok(compareVersions(offered, '6.3.0-beta.812') > 0);
	// Older betas on an earlier base version move too.
	assert.ok(electronUpdaterSemver.gt(offered, '6.2.9-beta.700'));
	// On first launch the nightly build reads the stored Beta setting as Nightly,
	// and from then on reads nightly-mac.yml on the same release.
	const settings = normalizeTerminalSettings({ updateChannel: 'beta' });
	assert.equal(settings.updateChannel, 'nightly');
	const h = trackHarness({
		channel: settings.updateChannel,
		currentVersion: offered,
		nightly: '6.3.0-main.3301.nightly',
		stable: '6.2.0',
	});
	h.updater.onCheck = downloadsVersion('6.3.0-main.3301.nightly');
	const status = await h.appUpdater.check();
	assert.deepEqual(h.updater.feeds.at(-1), NIGHTLY_FEED);
	assert.equal(status.latestVersion, '6.3.0-main.3301.nightly');
	assert.equal(h.fetches.includes(LEGACY_BETA_METADATA_URL), false);
});

test('restart to update installs and relaunches only at the final quit', async () => {
	const h = harness();
	h.updater.onCheck = downloadsVersion('1.4.0');

	h.appUpdater.finishQuit(h.quit);
	assert.deepEqual(h.quits, ['quit']);

	assert.equal(h.appUpdater.isRestartToUpdateRequested(), false);
	await h.appUpdater.check();
	assert.equal(h.appUpdater.isRestartToUpdateRequested(), false);
	assert.equal(h.appUpdater.requestRestartToUpdate(), true);
	// The quit path reads this to skip its confirmation for an update restart.
	assert.equal(h.appUpdater.isRestartToUpdateRequested(), true);
	h.appUpdater.cancelRestartToUpdate();
	assert.equal(h.appUpdater.isRestartToUpdateRequested(), false);
	h.appUpdater.finishQuit(h.quit);
	assert.deepEqual(h.quits, ['quit', 'quit']);
	assert.deepEqual(h.updater.installs, []);

	assert.equal(h.appUpdater.requestRestartToUpdate(), true);
	h.appUpdater.finishQuit(h.quit);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(h.updater.installs, [[false, true]]);
	assert.deepEqual(h.quits, ['quit', 'quit']);
});

test('release notes render untrusted markdown without script, handlers, or remote loads', () => {
	const html = renderReleaseNotesHtml(
		[
			'# Title',
			'<script>alert(1)</script>',
			'<img src=x onerror=alert(1)>',
			'![tracker](https://example.com/pixel.png)',
			'[bad](javascript:alert(1))',
			'[good](https://github.com/markwylde/terminay)',
		].join('\n\n'),
	);
	assert.doesNotMatch(html, /<script/iu);
	assert.doesNotMatch(html, /<img/iu);
	assert.doesNotMatch(html, /href="javascript:/iu);
	assert.doesNotMatch(html, /<[^>]+\sonerror=/iu);
	assert.match(html, /<a href="https:\/\/github\.com\/markwylde\/terminay">good<\/a>/u);
	assert.equal(releaseNoteLinkTarget('https://github.com/x'), 'https://github.com/x');
	assert.equal(releaseNoteLinkTarget('javascript:alert(1)'), null);
	assert.equal(releaseNoteLinkTarget('file:///etc/passwd'), null);
	assert.equal(releaseNoteLinkTarget(null), null);
});

test('the Windows installer is per-user and one-click, so updates never need elevation', () => {
	const config = readFileSync(new URL('../electron-builder.json5', import.meta.url), 'utf8');
	const nsis = /"nsis":\s*\{([^}]*)\}/u.exec(config)?.[1] ?? '';
	assert.match(nsis, /"oneClick":\s*true/u);
	assert.match(nsis, /"perMachine":\s*false/u);
	assert.match(nsis, /"allowToChangeInstallationDirectory":\s*false/u);
});
