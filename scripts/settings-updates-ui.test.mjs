import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.settings-updates-ui-test-'));

async function bundle(entryPoint, outputName) {
	const outputPath = join(testDirectory, outputName);
	await build({
		entryPoints: [entryPoint],
		outfile: outputPath,
		bundle: true,
		format: 'cjs',
		platform: 'node',
		external: ['react', 'react-dom'],
		loader: { '.css': 'empty' },
		logLevel: 'silent',
	});
	return require(outputPath);
}

const model = await bundle('src/components/settings/updatesPageModel.ts', 'updates-model.cjs');
const { ServerUpdatesPage } = await bundle(
	'src/components/settings/UpdatesPages.tsx',
	'updates-pages.cjs',
);
const cli = await bundle('apps/terminay-cli/src/resolve.ts', 'cli-resolve.cjs');

test.after(() => rm(testDirectory, { force: true, recursive: true }));

const render = (props) => renderToStaticMarkup(React.createElement(ServerUpdatesPage, props));

test('every track command names a ref the CLI resolves to that track', () => {
	for (const track of model.SERVER_TRACKS) {
		if (track.channel === 'tag') {
			assert.equal(track.ref, 'latest');
			assert.equal(cli.isRollingChannel(track.ref), false);
		} else {
			assert.equal(cli.isRollingChannel(track.ref), true, track.ref);
			assert.equal(track.ref, track.channel);
			assert.ok(cli.ROLLING[track.ref], track.ref);
		}
	}
});

test('a tracked server shows exact Running and Latest, and the other tracks', () => {
	const m = model.serverUpdatesModel({
		isLocal: false,
		status: {
			version: '5.1.1-main.20261112.abc1234',
			channel: 'main',
			available: { version: '5.1.1-main.20261113.def5678' },
			canUpgrade: true,
		},
	});
	assert.equal(m.kind, 'tracked');
	assert.equal(m.trackLabel, 'Nightly');
	assert.equal(m.upgradeAvailable, true);
	assert.deepEqual(
		m.commands.map((c) => c.command),
		['terminay daemon upgrade latest', 'terminay daemon upgrade canary'],
	);
	const html = render({ model: m, serverName: 'VPS', onUpgrade: () => {} });
	assert.match(html, /data-server-track="Nightly"/);
	assert.match(html, /5\.1\.1-main\.20261112\.abc1234/);
	assert.match(html, /Latest on Nightly/);
	assert.match(html, /5\.1\.1-main\.20261113\.def5678/);
	assert.match(html, /Upgrade VPS/);
	assert.match(html, /terminay daemon upgrade latest/);
	assert.doesNotMatch(html, /terminay daemon upgrade main/);
});

test('an up-to-date server offers no upgrade', () => {
	const m = model.serverUpdatesModel({
		isLocal: false,
		status: { version: '5.2.0', channel: 'tag', canUpgrade: true },
	});
	assert.equal(m.upgradeAvailable, false);
	assert.equal(m.latest.note, 'Up to date');
	const html = render({ model: m, serverName: 'VPS', onUpgrade: () => {} });
	assert.doesNotMatch(html, /Upgrade VPS/);
	assert.match(html, /Latest on Stable/);
	// Without a way to ask, there is no check; with one, it is always offered.
	assert.doesNotMatch(html, /Check for updates/);
	const checkable = render({
		model: m,
		serverName: 'VPS',
		onCheck: () => {},
		check: { checking: false, result: 'Up to date · 5.1.1' },
	});
	assert.match(checkable, /data-server-update-check[^>]*>Check for updates/);
	assert.match(checkable, /role="status"[^>]*>Up to date · 5\.1\.1/);
	const checking = render({
		model: m,
		serverName: 'VPS',
		onCheck: () => {},
		check: { checking: true },
	});
	assert.match(checking, /disabled=""[^>]*>Checking…/);
});

test('a source install has no published latest, and lists every track', () => {
	const m = model.serverUpdatesModel({
		isLocal: false,
		status: { version: '0.0.0', channel: 'source', canUpgrade: false },
	});
	assert.equal(m.trackLabel, 'Source');
	assert.equal(m.latest.version, undefined);
	assert.equal(m.commands.length, 3);
});

test('the Local server follows Desktop, even without a channel', () => {
	const m = model.serverUpdatesModel({
		isLocal: true,
		status: { version: '5.2.0', canUpgrade: false },
	});
	assert.equal(m.kind, 'local');
	// It runs Desktop's version; the embedded server's hello names no release.
	const desktop = model.serverUpdatesModel({
		isLocal: true,
		helloVersion: 'desktop',
		desktopVersion: '5.3.1',
	});
	assert.equal(desktop.running.version, '5.3.1');
	assert.equal(
		model.serverUpdatesModel({ isLocal: true, helloVersion: 'desktop' }).running,
		undefined,
	);
	const html = render({ model: m, serverName: 'Local', onOpenDeviceUpdates: () => {} });
	assert.match(html, /follows its update channel/);
	assert.match(html, /Open Terminay Desktop updates/);
	assert.doesNotMatch(html, /terminay daemon upgrade/);
});

test('a remote server without status is not called Local', () => {
	const m = model.serverUpdatesModel({ isLocal: false, helloVersion: '5.0.0' });
	assert.equal(m.kind, 'no-status');
	const html = render({ model: m, serverName: 'Old box' });
	assert.match(html, /Old box does not report a release track/);
	assert.match(html, /5\.0\.0/);
});

test('device version lines cover every updater state', () => {
	const t = () => 'today';
	const base = { currentVersion: '5.1.0', checkedAt: null, errorMessage: null, latestVersion: null };
	assert.equal(model.deviceVersionLines(null, 'stable', t)[1].note, 'Not checked yet');
	assert.equal(
		model.deviceVersionLines({ ...base, currentVersion: '0.0.0' }, 'stable', t)[0].note,
		'Development build',
	);
	const available = model.deviceVersionLines(
		{ ...base, latestVersion: '5.2.0', checkedAt: '2026-11-13T00:00:00Z' },
		'nightly',
		t,
	);
	assert.equal(available[1].label, 'Latest on Nightly');
	assert.equal(available[1].version, '5.2.0');
	assert.equal(available[1].note, 'Update available · checked today');
	assert.equal(
		model.deviceVersionLines({ ...base, state: 'checking' }, 'stable', t)[1].note,
		'Checking…',
	);
	assert.match(
		model.deviceVersionLines({ ...base, errorMessage: 'offline' }, 'stable', t)[1].note,
		/offline/,
	);
	const current = model.deviceVersionLines(
		{ ...base, checkedAt: '2026-11-13T00:00:00Z' },
		'canary',
		t,
	);
	assert.equal(current[1].version, '5.1.0');
	assert.equal(current[1].note, 'Up to date · checked today');
});

test('device install latest covers every state and warns only for an older build', () => {
	const base = {
		currentVersion: '6.3.0-main.3300.nightly',
		checkedAt: '2026-11-14T00:00:00Z',
		errorMessage: null,
		latestVersion: null,
		canInstallInPlace: true,
		channelLatest: { version: '6.2.4', order: 'older' },
		installingLatest: null,
	};
	assert.equal(model.deviceInstallLatest(null, 'stable'), null);
	assert.equal(model.deviceInstallLatest({ ...base, canInstallInPlace: false }, 'stable'), null);
	const dev = model.deviceInstallLatest({ ...base, currentVersion: '0.0.0', canInstallInPlace: false }, 'stable');
	assert.equal(dev.enabled, false);
	assert.match(dev.reason, /development build/);

	const older = model.deviceInstallLatest(base, 'stable');
	assert.deepEqual(older, { label: 'Install latest on Stable', version: '6.2.4', downgrade: true, enabled: true });
	const newer = model.deviceInstallLatest({ ...base, channelLatest: { version: '6.3.1', order: 'newer' } }, 'stable');
	assert.equal(newer.downgrade, false);
	assert.equal(newer.enabled, true);
	const same = model.deviceInstallLatest({ ...base, channelLatest: { version: base.currentVersion, order: 'same' } }, 'nightly');
	assert.equal(same.enabled, false);
	assert.equal(same.reason, 'This build is already the latest on Nightly.');
	assert.equal(model.deviceInstallLatest({ ...base, channelLatest: null }, 'stable').reason, 'Not checked yet.');
	assert.match(model.deviceInstallLatest({ ...base, installingLatest: '6.2.4' }, 'stable').reason, /Downloading 6\.2\.4/);

	const lines = model.deviceVersionLines(base, 'stable', () => 'today');
	assert.equal(lines[1].version, '6.2.4');
	assert.equal(lines[1].note, 'Older than this build · checked today');
});

test('the install latest row and confirmation say what they install and warn on a downgrade', async () => {
	const pages = await bundle('src/components/settings/UpdatesPages.tsx', 'updates-pages-2.cjs');
	const older = { label: 'Install latest on Stable', version: '6.2.4', downgrade: true, enabled: true };
	const row = renderToStaticMarkup(React.createElement(pages.InstallLatestRow, { action: older, onChoose: () => {} }));
	assert.match(row, /Install latest on Stable/);
	assert.match(row, /older than the running build/);
	assert.match(row, /data-install-latest="enabled"/);
	const dialog = renderToStaticMarkup(
		React.createElement(pages.DeviceInstallLatestConfirmation, {
			action: older,
			currentVersion: '6.3.0-main.3300.nightly',
			onCancel: () => {},
			onConfirm: () => {},
		}),
	);
	assert.match(dialog, /6\.3\.0-main\.3300\.nightly/);
	assert.match(dialog, /6\.2\.4/);
	assert.match(dialog, /might not carry over/);
	const forward = renderToStaticMarkup(
		React.createElement(pages.DeviceInstallLatestConfirmation, {
			action: { ...older, downgrade: false, version: '6.3.1' },
			currentVersion: '6.3.0',
			onCancel: () => {},
			onConfirm: () => {},
		}),
	);
	assert.doesNotMatch(forward, /might not carry over/);
	const disabled = renderToStaticMarkup(
		React.createElement(pages.InstallLatestRow, {
			action: { label: 'Install latest on Stable', downgrade: false, enabled: false, reason: 'Not checked yet.' },
			onChoose: () => {},
		}),
	);
	assert.match(disabled, /disabled=""/);
	assert.match(disabled, /Not checked yet/);
});

test("a server ahead of its channel offers Install latest, and Local never does", () => {
	const ahead = {
		version: '5.3.0-main.40.nightly',
		channel: 'main',
		canUpgrade: true,
		latest: { version: '5.3.0-main.38.nightly', order: 'older', canInstall: true },
		upgrade: { state: 'none' },
	};
	const m = model.serverUpdatesModel({ isLocal: false, status: ahead });
	assert.equal(m.latest.version, '5.3.0-main.38.nightly');
	assert.equal(m.latest.note, 'Older than this server');
	assert.deepEqual(m.installLatest, {
		label: 'Install latest on Nightly',
		version: '5.3.0-main.38.nightly',
		downgrade: true,
		enabled: true,
	});
	const html = render({ model: m, serverName: 'VPS', onInstallLatest: () => {} });
	assert.match(html, /Install latest on Nightly/);
	assert.match(html, /data-install-latest="enabled"/);

	const same = model.serverUpdatesModel({
		isLocal: false,
		status: { ...ahead, latest: { version: ahead.version, order: 'same', canInstall: false } },
	});
	assert.equal(same.installLatest.enabled, false);
	assert.match(same.installLatest.reason, /already runs the latest release on Nightly/);

	const blocked = model.serverUpdatesModel({
		isLocal: false,
		status: {
			...ahead,
			latest: {
				...ahead.latest,
				canInstall: false,
				unavailable: { reason: 'needs the helper', command: 'sudo terminay daemon upgrade --allow-downgrade --system' },
			},
		},
	});
	assert.equal(blocked.installLatest.enabled, false);
	assert.equal(blocked.installLatest.command, 'sudo terminay daemon upgrade --allow-downgrade --system');
	const blockedHtml = render({ model: blocked, serverName: 'VPS', onInstallLatest: () => {} });
	assert.match(blockedHtml, /needs the helper/);
	assert.match(blockedHtml, /--allow-downgrade/);

	const busy = model.serverUpdatesModel({ isLocal: false, status: { ...ahead, upgrade: { state: 'in-progress' } } });
	assert.equal(busy.installLatest.enabled, false);

	// A server whose upgrader predates install-latest names no latest release.
	const old = model.serverUpdatesModel({ isLocal: false, status: { version: '5.2.0', channel: 'tag', canUpgrade: true } });
	assert.equal(old.installLatest, undefined);

	const local = model.serverUpdatesModel({ isLocal: true, status: ahead });
	assert.equal(local.kind, 'local');
	assert.doesNotMatch(render({ model: local, serverName: 'Local', onInstallLatest: () => {} }), /Install latest/);
});
