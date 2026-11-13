import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

// Settings edits and resets stay in their place (ADR-0115, change
// settings-server-rail): a device change never reaches a server, and a server
// change or reset never rewrites the device's store.
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(process.cwd(), '.settings-place-writes-test-'));
test.after(() => rm(directory, { force: true, recursive: true }));
const outfile = join(directory, 'settings.cjs');
await build({
	stdin: {
		contents: [
			"export { createServerTerminalSettingsClient } from './src/hooks/useTerminalSettings';",
			"export { defaultTerminalSettings } from './src/terminalSettings';",
		].join('\n'),
		resolveDir: process.cwd(),
		loader: 'ts',
	},
	outfile,
	bundle: true,
	format: 'cjs',
	platform: 'node',
	external: ['react', 'react-dom'],
	loader: { '.css': 'empty' },
	logLevel: 'silent',
});
const { createServerTerminalSettingsClient, defaultTerminalSettings } = require(outfile);
const HOST_KEY = 'terminay.connection-host-settings.v1';

/** A browser host: device settings live in localStorage. */
function installBrowserHost() {
	const store = new Map();
	globalThis.window = {
		localStorage: {
			getItem: (key) => store.get(key) ?? null,
			setItem: (key, value) => store.set(key, value),
		},
		addEventListener: () => {},
		removeEventListener: () => {},
	};
	return store;
}

function fakeServer({ offline = false } = {}) {
	const calls = [];
	let settings = { scrollback: 5000 };
	const answer = () => ({ settings });
	const fail = () => Promise.reject(new Error('server offline'));
	return {
		calls,
		client: {
			async get() {
				calls.push('get');
				return offline ? fail() : answer();
			},
			async update(patch) {
				calls.push('update');
				if (offline) return fail();
				settings = { ...settings, ...patch };
				return answer();
			},
			async reset() {
				calls.push('reset');
				if (offline) return fail();
				settings = {};
				return answer();
			},
			onChanged: () => () => {},
		},
	};
}

test('a device edit writes only this device and sends the server nothing', async () => {
	const store = installBrowserHost();
	const server = fakeServer({ offline: true });
	const client = createServerTerminalSettingsClient(server.client);
	const saved = await client.updatePlace('device', {
		...defaultTerminalSettings,
		cursorStyle: 'underline',
	});
	assert.equal(saved.cursorStyle, 'underline');
	assert.deepEqual(server.calls, []);
	assert.match(store.get(HOST_KEY) ?? '', /underline/);
});

test('a server edit commits server settings and leaves this device alone', async () => {
	const store = installBrowserHost();
	store.set(HOST_KEY, JSON.stringify({ cursorStyle: 'bar' }));
	const server = fakeServer();
	const client = createServerTerminalSettingsClient(server.client);
	const saved = await client.updatePlace('server', {
		...defaultTerminalSettings,
		scrollback: 9000,
		cursorStyle: 'block',
	});
	assert.equal(saved.scrollback, 9000);
	// The device's own value still wins in the effective read, unrewritten.
	assert.equal(saved.cursorStyle, 'bar');
	assert.equal(store.get(HOST_KEY), JSON.stringify({ cursorStyle: 'bar' }));
	assert.deepEqual(server.calls, ['get', 'update']);
});

test('resetting this device leaves the server untouched', async () => {
	const store = installBrowserHost();
	store.set(HOST_KEY, JSON.stringify({ cursorStyle: 'bar' }));
	const server = fakeServer();
	const client = createServerTerminalSettingsClient(server.client);
	const saved = await client.resetPlace('device');
	assert.equal(saved.cursorStyle, defaultTerminalSettings.cursorStyle);
	assert.deepEqual(server.calls, []);
});

test('resetting a server leaves this device untouched', async () => {
	const store = installBrowserHost();
	store.set(HOST_KEY, JSON.stringify({ cursorStyle: 'bar' }));
	const server = fakeServer();
	const client = createServerTerminalSettingsClient(server.client);
	const saved = await client.resetPlace('server');
	assert.deepEqual(server.calls, ['reset']);
	assert.equal(saved.cursorStyle, 'bar');
	assert.equal(store.get(HOST_KEY), JSON.stringify({ cursorStyle: 'bar' }));
});

test('device values are readable while the server is offline', async () => {
	const store = installBrowserHost();
	store.set(HOST_KEY, JSON.stringify({ cursorStyle: 'bar' }));
	const server = fakeServer({ offline: true });
	const client = createServerTerminalSettingsClient(server.client);
	const device = await client.getDevice();
	assert.equal(device.cursorStyle, 'bar');
	assert.deepEqual(server.calls, []);
});
