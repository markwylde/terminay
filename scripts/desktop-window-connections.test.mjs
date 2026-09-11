import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { build } from 'esbuild';

/**
 * One window, one primary connection, many attached ones.
 *
 * The host hands the renderer a connection id per attached profile and keeps
 * the transport, the credential, and the MessagePort in main. These tests
 * exercise that bookkeeping directly: two profiles attached from one window
 * must produce two endpoints bound to two distinct server identities, the
 * primary must never be rebound by an attach, and closing the window must
 * release every attached lane.
 */
let compiled;
async function loadModule(entry, name) {
	compiled ??= (async () => ({
		directory: await mkdtemp(join(tmpdir(), 'terminay-desktop-connections-')),
	}))();
	const { directory } = await compiled;
	const outfile = join(directory, name);
	await build({
		entryPoints: [entry],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		external: ['electron'],
		logLevel: 'silent',
	});
	return import(`file://${outfile}`);
}

after(async () => {
	if (compiled === undefined) return;
	const { directory } = await compiled;
	await rm(directory, { recursive: true, force: true });
});

const PROFILES = Object.freeze([
	Object.freeze({ id: 'local:one', isLocal: true, label: 'Local', serverId: 'server-local' }),
	Object.freeze({ id: 'remote:build', isLocal: false, label: 'Build box', serverId: 'server-build' }),
	Object.freeze({ id: 'remote:vps', isLocal: false, label: 'VPS' }),
]);

function harness(overrides = {}) {
	const opened = [];
	const changes = [];
	return {
		opened,
		changes,
		options: {
			primaryProfileId: 'local:one',
			primaryServerId: 'server-local',
			listProfiles: () => PROFILES,
			openLane: async (profile, connectionId, onLost) => {
				const lane = {
					serverId: profile.serverId ?? `server-${profile.id}`,
					closed: false,
					close() {
						lane.closed = true;
					},
				};
				opened.push({ profile, connectionId, lane, onLost });
				return lane;
			},
			onChanged: (profiles) => changes.push(profiles),
			...overrides,
		},
	};
}

test('one window attaches two profiles and gets two endpoints with distinct server ids', async () => {
	const { DesktopWindowConnections } = await loadModule(
		'electron/desktopWindowConnections.ts',
		'desktopWindowConnections.mjs',
	);
	const { options, opened } = harness();
	const connections = new DesktopWindowConnections(options);

	const build = await connections.attach('remote:build');
	const vps = await connections.attach('remote:vps');

	assert.equal(opened.length, 2);
	assert.notEqual(build.connectionId, vps.connectionId);
	assert.equal(build.serverId, 'server-build');
	assert.equal(vps.serverId, 'server-remote:vps');
	assert.notEqual(build.serverId, vps.serverId);

	const listed = connections.list();
	assert.deepEqual(
		listed.map((profile) => [profile.id, profile.status, profile.attached]),
		[
			['local:one', 'connected', true],
			['remote:build', 'connected', true],
			['remote:vps', 'connected', true],
		],
	);
	// The window's primary keeps its own server identity; an attached profile
	// never borrows it.
	assert.equal(
		listed.find((profile) => profile.id === 'local:one').serverId,
		'server-local',
	);
});

test('attach never rebinds the window primary and detach closes only its own lane', async () => {
	const { DesktopWindowConnections } = await loadModule(
		'electron/desktopWindowConnections.ts',
		'desktopWindowConnections.mjs',
	);
	const { options, opened } = harness();
	const connections = new DesktopWindowConnections(options);

	await assert.rejects(
		() => connections.attach('local:one'),
		/primary connection is already attached/u,
	);
	await connections.attach('remote:build');
	await connections.attach('remote:vps');
	await assert.rejects(
		() => connections.detach('local:one'),
		/primary connection cannot be detached/u,
	);

	await connections.detach('remote:build');
	assert.equal(opened[0].lane.closed, true);
	assert.equal(opened[1].lane.closed, false);
	assert.equal(
		connections.list().find((profile) => profile.id === 'remote:build').attached,
		false,
	);
});

test('re-attaching an open profile reuses its connection id', async () => {
	const { DesktopWindowConnections } = await loadModule(
		'electron/desktopWindowConnections.ts',
		'desktopWindowConnections.mjs',
	);
	const { options, opened } = harness();
	const connections = new DesktopWindowConnections(options);
	const first = await connections.attach('remote:build');
	const second = await connections.attach('remote:build');
	assert.equal(first.connectionId, second.connectionId);
	assert.equal(opened.length, 1);
});

test('a lost lane is reported offline and keeps the profile in the window', async () => {
	const { DesktopWindowConnections } = await loadModule(
		'electron/desktopWindowConnections.ts',
		'desktopWindowConnections.mjs',
	);
	const { options, opened, changes } = harness();
	const connections = new DesktopWindowConnections(options);
	await connections.attach('remote:build');
	opened[0].onLost();
	const profile = connections
		.list()
		.find((candidate) => candidate.id === 'remote:build');
	assert.equal(profile.status, 'offline');
	assert.equal(profile.attached, true);
	assert.ok(changes.length >= 2);
});

test('every attached connection is released with the window', async () => {
	const { DesktopWindowConnections } = await loadModule(
		'electron/desktopWindowConnections.ts',
		'desktopWindowConnections.mjs',
	);
	const { options, opened } = harness();
	const connections = new DesktopWindowConnections(options);
	await connections.attach('remote:build');
	await connections.attach('remote:vps');
	await connections.dispose();
	assert.deepEqual(
		opened.map((entry) => entry.lane.closed),
		[true, true],
	);
	await assert.rejects(
		() => connections.attach('remote:build'),
		/window is closed/u,
	);
});

test('an unknown profile is refused and leaves no attachment behind', async () => {
	const { DesktopWindowConnections } = await loadModule(
		'electron/desktopWindowConnections.ts',
		'desktopWindowConnections.mjs',
	);
	const { options, opened } = harness();
	const connections = new DesktopWindowConnections(options);
	await assert.rejects(
		() => connections.attach('remote:missing'),
		/no longer available/u,
	);
	assert.equal(opened.length, 0);
	assert.equal(connections.list().length, PROFILES.length);
});

test('a window composition round-trips through the host store and keeps unreachable profiles', async () => {
	const { DesktopWindowCompositionStore, desktopWindowCompositionKey } =
		await loadModule(
			'electron/desktopWindowComposition.ts',
			'desktopWindowComposition.mjs',
		);
	const { directory } = await compiled;
	const file = join(directory, 'window-composition.v1.json');
	const composition = {
		version: 1,
		primaryProfileId: 'local:one',
		attached: [
			{ profileId: 'local:one' },
			{ profileId: 'remote:build', viewId: 'view-2' },
		],
		tabOrder: [
			{ serverId: 'server-local', projectId: 'project-a' },
			{ serverId: 'server-build', projectId: 'project-a' },
		],
	};
	const key = desktopWindowCompositionKey('local:one', 'view-1');
	new DesktopWindowCompositionStore(file).write(key, composition);

	// A fresh store is what a restart sees.
	const restored = new DesktopWindowCompositionStore(file).read(key);
	assert.deepEqual(JSON.parse(JSON.stringify(restored)), composition);
	assert.equal(new DesktopWindowCompositionStore(file).read('other'), undefined);

	// Nothing server-owned may reach the host store.
	const body = await readFile(file, 'utf8');
	assert.doesNotMatch(body, /workspace|snapshot|panel|terminal|root/iu);
});

test('a composition carrying workspace state is refused rather than persisted', async () => {
	const { DesktopWindowCompositionStore } = await loadModule(
		'electron/desktopWindowComposition.ts',
		'desktopWindowComposition.mjs',
	);
	const { directory } = await compiled;
	const store = new DesktopWindowCompositionStore(
		join(directory, 'rejected-composition.json'),
	);
	assert.throws(() =>
		store.write('local:one:primary', {
			version: 1,
			primaryProfileId: 'local:one',
			attached: [],
			tabOrder: [],
			workspaceSnapshot: { projects: [] },
		}),
	);
});

test('Desktop declares the connections host capability and keeps no bundle cache', async () => {
	const [main, session, hostState] = await Promise.all([
		readFile('electron/main.ts', 'utf8'),
		readFile('apps/terminay-desktop/src/main/localServerUiSession.ts', 'utf8'),
		readFile('apps/terminay-desktop/src/main/hostState.ts', 'utf8'),
	]);
	assert.match(main, /connections: 1,/u);
	assert.match(session, /connections: 1,/u);
	assert.match(main, /case 'connections\.attach':/u);
	assert.match(main, /case 'connections\.detach':/u);
	assert.match(main, /case 'connections\.composition\.write':/u);
	assert.match(main, /case 'connections\.list':/u);
	// Desktop runs its packaged bundle for every connection.
	assert.doesNotMatch(main, /prepareRemote|installRemoteArchive/u);
	assert.doesNotMatch(hostState, /readonly bundleCache/u);
});

test('two windows on one profile keep separate compositions', async () => {
	const { DesktopWindowCompositionStore, desktopWindowCompositionKey } =
		await loadModule(
			'electron/desktopWindowComposition.ts',
			'desktopWindowComposition.mjs',
		);
	const { directory } = await compiled;
	const file = join(directory, 'window-composition-two-windows.v1.json');
	const composition = (profileId) => ({
		version: 1,
		primaryProfileId: 'local:one',
		attached: [{ profileId }],
		tabOrder: [],
	});
	// Two Local windows share a profile and a view; without the window slot in
	// the key they would share one record and overwrite each other's attached
	// set and tab order.
	const first = desktopWindowCompositionKey('local:one', undefined, 0);
	const second = desktopWindowCompositionKey('local:one', undefined, 1);
	assert.notEqual(first, second);
	// The first window keys exactly as a single window always did, so records
	// written before the slot existed are still found.
	assert.equal(first, desktopWindowCompositionKey('local:one'));

	const store = new DesktopWindowCompositionStore(file);
	store.write(first, composition('remote:build'));
	store.write(second, composition('remote:vps'));
	const reopened = new DesktopWindowCompositionStore(file);
	assert.deepEqual(reopened.read(first).attached, [{ profileId: 'remote:build' }]);
	assert.deepEqual(reopened.read(second).attached, [{ profileId: 'remote:vps' }]);
});

test('an attached Local lane owns its own port slot in the authority', async () => {
	const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
	// The authority evicts an owner slot when it is claimed again. The window's
	// primary document endpoint claims the webContents id, so an attached lane
	// claiming the same id would silently close the connection it replaced.
	assert.match(main, /ownerId: `\$\{ownerId\}:\$\{connectionId\}`/u);
	const authority = await readFile(
		new URL('../electron/serverTerminalAuthority.ts', import.meta.url),
		'utf8',
	);
	assert.match(authority, /rendererConnectionsByOwner/u);
});
