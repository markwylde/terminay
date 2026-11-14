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
