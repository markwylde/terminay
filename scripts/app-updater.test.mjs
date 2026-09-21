import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
	canInstallInPlace,
	compareVersions,
	createAppUpdater,
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

const BETA_METADATA_URL =
	'https://github.com/markwylde/terminay/releases/download/main-latest/beta-mac.yml';
const STABLE_METADATA_URL =
	'https://github.com/markwylde/terminay/releases/latest/download/latest-mac.yml';
const STABLE_FEED = {
	provider: 'github',
	owner: 'markwylde',
	repo: 'terminay',
	releaseType: 'release',
};
const BETA_FEED = {
	provider: 'generic',
	url: 'https://github.com/markwylde/terminay/releases/download/main-latest/',
	channel: 'beta',
};

/** A Beta install whose two sources publish the given versions (null: unreadable). */
function betaHarness({ beta, stable, ...overrides }) {
	const h = harness({
		currentVersion: '1.3.0-beta.14',
		channel: 'beta',
		...overrides,
		fetch: async (url) => {
			h.fetches.push(url);
			if (url.startsWith('https://api.github.com/')) return jsonResponse(releases);
			const version =
				url === BETA_METADATA_URL ? beta : url === STABLE_METADATA_URL ? stable : null;
			return version === null
				? textResponse('', 404)
				: textResponse(`version: ${version}\nfiles: []\n`);
		},
	});
	return h;
}

test('beta offers a stable release that is newer than the latest beta', async () => {
	const h = betaHarness({ beta: '1.3.0-beta.15', stable: '1.3.0' });
	h.updater.onCheck = downloadsVersion('1.3.0');
	const status = await h.appUpdater.check();
	assert.deepEqual(h.updater.feeds.at(-1), STABLE_FEED);
	assert.equal(h.updater.allowPrerelease, false);
	assert.equal(h.updater.allowDowngrade, false);
	assert.equal(h.updater.disableDifferentialDownload, false);
	assert.equal(status.state, 'ready');
	assert.equal(status.latestVersion, '1.3.0');
	assert.equal(status.channel, 'beta');
	assert.equal(status.releaseUrl, 'https://github.com/markwylde/terminay/releases/tag/v1.3.0');
	assert.deepEqual(
		status.releaseNotes.map((note) => note.version),
		['1.3.0'],
	);
});

test('beta keeps the rolling prerelease when it is newer than stable', async () => {
	const h = betaHarness({ beta: '1.4.0-beta.3', stable: '1.3.0' });
	h.updater.onCheck = downloadsVersion('1.4.0-beta.3', '- feat: beta thing');
	const status = await h.appUpdater.check();
	assert.deepEqual(h.updater.feeds.at(-1), BETA_FEED);
	assert.equal(h.updater.allowPrerelease, true);
	assert.equal(h.updater.allowDowngrade, false);
	assert.equal(status.latestVersion, '1.4.0-beta.3');
	assert.equal(status.releaseUrl, 'https://github.com/markwylde/terminay/releases/tag/main-latest');
	assert.equal(status.releaseNotes[0].markdown, '- feat: beta thing');
});

test('beta resumes after a stable release without leaving the channel', async () => {
	const h = betaHarness({ currentVersion: '1.3.0', beta: '1.4.0-beta.1', stable: '1.3.0' });
	h.updater.onCheck = downloadsVersion('1.4.0-beta.1', '- next');
	const status = await h.appUpdater.check();
	assert.deepEqual(h.updater.feeds.at(-1), BETA_FEED);
	assert.equal(status.latestVersion, '1.4.0-beta.1');
	assert.equal(status.channel, 'beta');
});

test('beta proceeds with whichever source can be read', async () => {
	const stableDown = betaHarness({ beta: '1.3.0-beta.15', stable: null });
	stableDown.updater.onCheck = downloadsVersion('1.3.0-beta.15', '- beta');
	const fromBeta = await stableDown.appUpdater.check();
	assert.deepEqual(stableDown.updater.feeds.at(-1), BETA_FEED);
	assert.equal(fromBeta.state, 'ready');
	assert.equal(fromBeta.errorMessage, null);

	const betaDown = betaHarness({ beta: null, stable: '1.3.0' });
	betaDown.updater.onCheck = downloadsVersion('1.3.0');
	const fromStable = await betaDown.appUpdater.check();
	assert.deepEqual(betaDown.updater.feeds.at(-1), STABLE_FEED);
	assert.equal(fromStable.latestVersion, '1.3.0');
	assert.equal(fromStable.errorMessage, null);
});

test('beta with neither source readable fails through the updater and retries', async () => {
	const h = betaHarness({ beta: null, stable: null });
	h.updater.onCheck = async () => {
		throw new Error('net::ERR_INTERNET_DISCONNECTED');
	};
	const status = await h.appUpdater.check();
	assert.deepEqual(h.updater.feeds.at(-1), BETA_FEED);
	assert.equal(status.state, 'error');
	assert.equal(status.hasUpdate, false);
	h.advance(11 * 60 * 1000);
	await h.appUpdater.check();
	assert.equal(h.updater.checks, 2);
});

test('the stable channel never reads the rolling prerelease', async () => {
	const h = betaHarness({
		currentVersion: '1.2.0',
		channel: 'stable',
		beta: '1.4.0-beta.3',
		stable: '1.3.0',
	});
	h.updater.onCheck = downloadsVersion('1.3.0');
	await h.appUpdater.check();
	assert.deepEqual(h.updater.feeds.at(-1), STABLE_FEED);
	assert.equal(h.fetches.includes(BETA_METADATA_URL), false);
	assert.equal(h.fetches.includes(STABLE_METADATA_URL), false);
});

test('a notice-only beta build is told about a newer stable release and downloads nothing', async () => {
	const h = betaHarness({
		isPackaged: false,
		beta: '1.3.0-beta.15',
		stable: '1.3.0',
		loadUpdater: async () => assert.fail('the updater must not be loaded'),
	});
	const status = await h.appUpdater.check();
	assert.equal(status.state, 'available');
	assert.equal(status.hasUpdate, true);
	assert.equal(status.latestVersion, '1.3.0');
	assert.equal(status.channel, 'beta');
	assert.equal(status.releaseUrl, 'https://github.com/markwylde/terminay/releases/tag/v1.3.0');
	assert.deepEqual(
		status.releaseNotes.map((note) => note.version),
		['1.3.0'],
	);
});

test('a notice-only beta build offers nothing when neither source is newer', async () => {
	const h = betaHarness({
		isPackaged: false,
		currentVersion: '1.3.0',
		beta: '1.3.0-beta.15',
		stable: '1.3.0',
	});
	const status = await h.appUpdater.check();
	assert.equal(status.state, 'idle');
	assert.equal(status.hasUpdate, false);
	assert.equal(status.releaseUrl, null);
});

test('a notice-only beta build fails only when neither source can be read', async () => {
	const h = betaHarness({ isPackaged: false, beta: null, stable: null });
	const status = await h.appUpdater.check();
	assert.equal(status.state, 'error');
	assert.equal(status.hasUpdate, false);
	assert.match(status.errorMessage, /404/u);
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
