import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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
	renderReleaseNotesHtml,
} from '../src/appUpdateNotes.ts';
import {
	defaultTerminalSettings,
	normalizeTerminalSettings,
	selectDeviceTerminalSettings,
} from '../src/terminalSettings.ts';

test('update channel is a device setting defaulting to stable', () => {
	assert.equal(defaultTerminalSettings.updateChannel, 'stable');
	assert.equal(normalizeTerminalSettings({ updateChannel: 'beta' }).updateChannel, 'beta');
	assert.equal(normalizeTerminalSettings({ updateChannel: 'nightly' }).updateChannel, 'stable');
	assert.equal(
		selectDeviceTerminalSettings(normalizeTerminalSettings({ updateChannel: 'beta' })).updateChannel,
		'beta',
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

test('semantic version precedence covers beta prereleases', () => {
	assert.ok(compareVersions('0.43.0-beta.5', '0.43.0') < 0);
	assert.ok(compareVersions('0.43.0-beta.5', '0.42.9') > 0);
	assert.ok(compareVersions('0.43.0-beta.10', '0.43.0-beta.9') > 0);
	assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
	assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
});

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
	assert.equal(canInstallInPlace({ isPackaged: true, platform: 'win32', isWritable: writable }), false);
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

test('beta notes come from the channel metadata', () => {
	assert.deepEqual(releaseNotesFromUpdateInfo({ releaseNotes: '- feat: a' }, '1.3.0-beta.4'), [
		{
			version: '1.3.0-beta.4',
			url: 'https://github.com/markwylde/terminay/releases/tag/main-latest',
			markdown: '- feat: a',
		},
	]);
	assert.equal(releaseNotesFromUpdateInfo({ releaseNotes: '' }, '1.3.0-beta.4'), null);
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
		channel: 'beta',
	};
	assert.match(describeManualCheck(base).detail, /1\.0\.0.*Beta channel/u);
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

test('switching to beta repoints the feed and checks immediately without allowing downgrade', async () => {
	const h = harness();
	await h.appUpdater.check();
	h.updater.onCheck = downloadsVersion('1.3.0-beta.7', '- feat: beta thing');
	const status = await h.appUpdater.setChannel('beta');
	assert.equal(h.updater.checks, 2);
	assert.deepEqual(h.updater.feeds.at(-1), {
		provider: 'generic',
		url: 'https://github.com/markwylde/terminay/releases/download/main-latest/',
		channel: 'beta',
	});
	assert.equal(h.updater.allowDowngrade, false);
	assert.equal(h.updater.disableDifferentialDownload, true);
	assert.equal(status.channel, 'beta');
	assert.equal(status.state, 'ready');
	assert.equal(status.releaseUrl, 'https://github.com/markwylde/terminay/releases/tag/main-latest');
	assert.deepEqual(status.releaseNotes, [
		{
			version: '1.3.0-beta.7',
			url: 'https://github.com/markwylde/terminay/releases/tag/main-latest',
			markdown: '- feat: beta thing',
		},
	]);
});

test('a beta install returning to stable keeps prereleases and downgrades off', async () => {
	const h = harness({ currentVersion: '1.3.0-beta.7', channel: 'beta' });
	await h.appUpdater.check();
	await h.appUpdater.setChannel('stable');
	assert.equal(h.updater.allowPrerelease, false);
	assert.equal(h.updater.allowDowngrade, false);
	assert.equal(h.updater.feeds.at(-1).provider, 'github');
});

test('restart to update installs and relaunches only at the final quit', async () => {
	const h = harness();
	h.updater.onCheck = downloadsVersion('1.4.0');

	h.appUpdater.finishQuit(h.quit);
	assert.deepEqual(h.quits, ['quit']);

	await h.appUpdater.check();
	assert.equal(h.appUpdater.requestRestartToUpdate(), true);
	h.appUpdater.cancelRestartToUpdate();
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
