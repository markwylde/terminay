import assert from 'node:assert/strict';
import test from 'node:test';
import {
	CLIENT_SERVER_COMPATIBILITY,
	FEATURE_CAPABILITIES,
	SERVER_DESKTOP_CAPABILITY,
	SERVER_DESKTOP_EVENTS,
	SERVER_DESKTOP_OPERATIONS,
	SERVER_DESKTOP_PREFIX,
	isEmptyServerDesktopRequest,
	isServerDesktopName,
	parseServerDesktopController,
	parseServerDesktopDisableRequest,
	parseServerDesktopHandle,
	parseServerDesktopOpenRequest,
	parseServerDesktopStatus,
	parseServerDesktopStream,
} from '../dist/index.js';

test('the server desktop is an optional feature capability', () => {
	assert.equal(SERVER_DESKTOP_CAPABILITY, 'server-desktop.v1');
	assert.equal(FEATURE_CAPABILITIES.serverDesktop, SERVER_DESKTOP_CAPABILITY);
	assert.equal(
		CLIENT_SERVER_COMPATIBILITY.optionalCapabilities.includes(
			SERVER_DESKTOP_CAPABILITY,
		),
		true,
	);
	assert.equal(
		CLIENT_SERVER_COMPATIBILITY.requiredCapabilities.includes(
			SERVER_DESKTOP_CAPABILITY,
		),
		false,
	);
});

test('the operations and events are the named ones, all under one prefix', () => {
	assert.deepEqual(SERVER_DESKTOP_OPERATIONS, {
		status: 'server.desktop.status',
		setup: 'server.desktop.setup',
		enable: 'server.desktop.enable',
		disable: 'server.desktop.disable',
		open: 'server.desktop.open',
		takeControl: 'server.desktop.take-control',
		releaseControl: 'server.desktop.release-control',
		read: 'server.desktop.read',
		write: 'server.desktop.write',
		close: 'server.desktop.close',
	});
	assert.deepEqual(SERVER_DESKTOP_EVENTS, {
		changed: 'server.desktop.changed',
		control: 'server.desktop.control',
	});
	for (const name of [
		...Object.values(SERVER_DESKTOP_OPERATIONS),
		...Object.values(SERVER_DESKTOP_EVENTS),
	]) {
		assert.equal(name.startsWith(SERVER_DESKTOP_PREFIX), true, name);
		assert.equal(isServerDesktopName(name), true, name);
	}
	for (const name of ['server.upgrade', 'server.health', 'server.desktop', 'server.desktops.open'])
		assert.equal(isServerDesktopName(name), false, name);
});

test('setup, enable and status carry nothing: any field is refused', () => {
	assert.equal(isEmptyServerDesktopRequest(undefined), true);
	assert.equal(isEmptyServerDesktopRequest(null), true);
	assert.equal(isEmptyServerDesktopRequest({}), true);
	for (const value of [
		{ packages: ['netcat'] },
		{ source: 'deb http://example.invalid stable main' },
		{ force: true },
		{ generation: 1 },
		{ undefined: undefined },
		['tigervnc-standalone-server'],
		'install',
		1,
		true,
	])
		assert.equal(isEmptyServerDesktopRequest(value), false, JSON.stringify(value));
});

test('each state is read with exactly its own fields, and anything malformed is refused', () => {
	const command = 'sudo terminay daemon desktop install';
	const good = [
		{ state: 'unsupported', reason: 'not-debian', message: 'Needs Debian.' },
		{ state: 'needs-setup', setup: 'server', command },
		{ state: 'needs-setup', setup: 'command', command },
		{ state: 'setting-up', step: 'downloading', fraction: 0.4 },
		{ state: 'ready', display: 765 },
		{ state: 'off' },
		{ state: 'failed', reason: 'The display server exited.', setup: 'command', command },
		{ state: 'failed', step: 'downloading', reason: 'No route.', setup: 'server', command },
	];
	for (const status of good)
		assert.deepEqual(parseServerDesktopStatus(status), status);
	// Fields that belong to another state, or to none, do not come through.
	assert.deepEqual(
		parseServerDesktopStatus({ state: 'off', display: 765, password: 'x' }),
		{ state: 'off' },
	);
	assert.deepEqual(
		parseServerDesktopStatus({ state: 'ready', display: 765, socket: '/run/x' }),
		{ state: 'ready', display: 765 },
	);
	// A fraction is kept within the whole.
	assert.equal(
		parseServerDesktopStatus({ state: 'setting-up', step: 'installing', fraction: 7 }).fraction,
		1,
	);
	assert.equal(
		parseServerDesktopStatus({ state: 'setting-up', step: 'installing', fraction: -1 }).fraction,
		0,
	);
	for (const bad of [
		undefined,
		null,
		'ready',
		[],
		{},
		{ state: 'running' },
		{ state: 'unsupported', reason: 'because', message: 'x' },
		{ state: 'unsupported', reason: 'not-linux' },
		{ state: 'needs-setup', setup: 'root', command },
		{ state: 'needs-setup', setup: 'server' },
		{ state: 'needs-setup', setup: 'server', command: 'x'.repeat(513) },
		{ state: 'setting-up', step: 'compiling', fraction: 0.1 },
		{ state: 'setting-up', step: 'installing', fraction: Number.NaN },
		{ state: 'setting-up', step: 'installing' },
		{ state: 'ready' },
		{ state: 'ready', display: -1 },
		{ state: 'ready', display: 1.5 },
		{ state: 'ready', display: 70000 },
		{ state: 'ready', display: ':765' },
		{ state: 'failed', setup: 'server', command },
		{ state: 'failed', reason: '', setup: 'server', command },
		{ state: 'failed', reason: 'x', step: 'nope', setup: 'server', command },
		{ state: 'failed', reason: 'x'.repeat(2049), setup: 'server', command },
	])
		assert.equal(parseServerDesktopStatus(bad), null, JSON.stringify(bad));
});

test('a stream handle, an open request and a disable request admit only their own fields', () => {
	assert.deepEqual(parseServerDesktopHandle({ streamId: 's1', generation: 3 }), {
		streamId: 's1',
		generation: 3,
	});
	for (const bad of [
		null,
		{},
		{ streamId: 's1' },
		{ streamId: '', generation: 1 },
		{ streamId: 's1', generation: 0 },
		{ streamId: 's1', generation: 1.5 },
		{ streamId: 's1', generation: '1' },
		{ streamId: 'x'.repeat(129), generation: 1 },
		{ streamId: 's1', generation: 1, botId: 'abc' },
		{ streamId: 's1', generation: 1, mode: 'control' },
	])
		assert.equal(parseServerDesktopHandle(bad), null, JSON.stringify(bad));

	assert.deepEqual(parseServerDesktopOpenRequest({ generation: 2 }), { generation: 2 });
	for (const bad of [
		undefined,
		{},
		{ generation: 0 },
		{ generation: 2, mode: 'control' },
		{ generation: 2, display: 0 },
		{ generation: 2, password: 'x' },
	])
		assert.equal(parseServerDesktopOpenRequest(bad), null, JSON.stringify(bad));

	assert.deepEqual(parseServerDesktopDisableRequest(undefined), { confirmed: false });
	assert.deepEqual(parseServerDesktopDisableRequest({}), { confirmed: false });
	assert.deepEqual(parseServerDesktopDisableRequest({ confirmed: true }), { confirmed: true });
	assert.deepEqual(parseServerDesktopDisableRequest({ confirmed: false }), { confirmed: false });
	for (const bad of [{ confirmed: 'yes' }, { confirmed: true, force: true }, { kill: true }, 'off', []])
		assert.equal(parseServerDesktopDisableRequest(bad), null, JSON.stringify(bad));
});

test('a stream answer names its handle, its mode and who controls the desktop', () => {
	const controller = { clientId: 'client-2', deviceName: "Mark's iPad" };
	assert.deepEqual(
		parseServerDesktopStream({
			handle: { streamId: 's1', generation: 1 },
			mode: 'view-only',
			controller,
		}),
		{ handle: { streamId: 's1', generation: 1 }, mode: 'view-only', controller },
	);
	assert.deepEqual(
		parseServerDesktopStream({
			handle: { streamId: 's1', generation: 1 },
			mode: 'control',
			controller: null,
		}),
		{ handle: { streamId: 's1', generation: 1 }, mode: 'control', controller: null },
	);
	assert.equal(parseServerDesktopController(null), null);
	assert.deepEqual(parseServerDesktopController(controller), controller);
	assert.equal(parseServerDesktopController({ clientId: 'c' }), undefined);
	assert.equal(parseServerDesktopController({ clientId: '', deviceName: 'x' }), undefined);
	assert.equal(parseServerDesktopController('client-2'), undefined);
	for (const bad of [
		{ handle: { streamId: 's1', generation: 1 }, mode: 'admin', controller: null },
		{ handle: { streamId: 's1' }, mode: 'control', controller: null },
		{ handle: { streamId: 's1', generation: 1 }, mode: 'control' },
		{ handle: { streamId: 's1', generation: 1 }, mode: 'control', controller: {} },
	])
		assert.equal(parseServerDesktopStream(bad), null, JSON.stringify(bad));
});
