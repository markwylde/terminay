import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { showCanonicalLaunchRecovery, stateUnreadableMessage } from '../electron/canonicalLaunchRecovery.ts';
import { loadCanonicalStateSync, StateUnreadableError } from '../packages/server-core/src/durableFile.ts';

// durable-state-files: a corrupt store with no good copy is the user's call.
// The host-owned recovery document offers Start fresh beside Retry.

function fakeWindow() {
	const listeners = new Set();
	const loaded = [];
	const webContents = {
		isDestroyed: () => false,
		isLoading: () => false,
		stop() {},
		on(event, listener) {
			if (event === 'will-navigate') listeners.add(listener);
		},
		off(event, listener) {
			if (event === 'will-navigate') listeners.delete(listener);
		},
	};
	return {
		loaded,
		window: {
			webContents,
			isDestroyed: () => false,
			show() {},
			async loadURL(url) {
				loaded.push(decodeURIComponent(url.slice(url.indexOf(',') + 1)));
			},
		},
		navigate(target) {
			let prevented = false;
			for (const listener of [...listeners]) listener({ preventDefault: () => (prevented = true) }, target);
			return prevented;
		},
	};
}

function corruptWorkspace(t) {
	const root = mkdtempSync(join(tmpdir(), 'tlr-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const target = join(root, 'workspace.v4.json');
	writeFileSync(target, Buffer.alloc(3704));
	writeFileSync(`${target}.previous`, Buffer.alloc(3000));
	let error;
	try {
		loadCanonicalStateSync(target, 'workspace');
	} catch (caught) {
		error = caught;
	}
	assert.ok(error instanceof StateUnreadableError);
	return { root, target, error };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a corrupt store with no good copy offers Start fresh and Retry, and names no path', async (t) => {
	const { root, error } = corruptWorkspace(t);
	const host = fakeWindow();
	await showCanonicalLaunchRecovery({
		window: host.window,
		error,
		retry: async () => {},
		onDiagnostic: () => {},
		onRecoveryState: () => {},
	});
	const html = host.loaded.at(-1);
	assert.match(html, /Start fresh/u);
	assert.match(html, /Retry/u);
	assert.match(html, /workspace: your projects, tabs and layout/u);
	assert.equal(html.includes(root), false);
});

test('Retry changes nothing on disk', async (t) => {
	const { target, error } = corruptWorkspace(t);
	const host = fakeWindow();
	let retried = 0;
	await showCanonicalLaunchRecovery({
		window: host.window,
		error,
		retry: async () => {
			retried += 1;
		},
		onDiagnostic: () => {},
		onRecoveryState: () => {},
	});
	assert.equal(host.navigate('https://terminay.invalid/retry'), true);
	await settle();
	await settle();
	assert.equal(retried, 1);
	assert.equal(readFileSync(target).length, 3704);
	assert.equal(readFileSync(`${target}.previous`).length, 3000);
});

test('Start fresh keeps both damaged files aside and retries, so the store begins empty', async (t) => {
	const { root, target, error } = corruptWorkspace(t);
	const host = fakeWindow();
	let retried = 0;
	await showCanonicalLaunchRecovery({
		window: host.window,
		error,
		retry: async () => {
			retried += 1;
		},
		onDiagnostic: () => {},
		onRecoveryState: () => {},
	});
	assert.equal(host.navigate('https://terminay.invalid/start-fresh'), true);
	await settle();
	await settle();
	assert.equal(retried, 1);
	assert.equal(existsSync(target), false);
	assert.equal(readdirSync(root).filter((name) => name.includes('.corrupt-')).length, 2);
	assert.equal(loadCanonicalStateSync(target, 'workspace'), undefined);
});

test('other failures keep the plain Retry document, and Start fresh does nothing there', async () => {
	const host = fakeWindow();
	await showCanonicalLaunchRecovery({
		window: host.window,
		error: new Error('Terminay could not finish starting.'),
		retry: async () => {},
		onDiagnostic: () => {},
		onRecoveryState: () => {},
	});
	assert.doesNotMatch(host.loaded.at(-1), /Start fresh/u);
	assert.equal(host.navigate('https://terminay.invalid/start-fresh'), false);
});

test('every canonical store has words for the recovery document', () => {
	for (const store of ['workspace', 'desktop-identity', 'server-settings', 'device-settings', 'remote-access-settings', 'macros', 'automations', 'connected-servers', 'connection-profiles', 'window-layout', 'extensions']) {
		assert.doesNotMatch(stateUnreadableMessage(store), /saved state is/u, store);
	}
});

test('the startup notice says what was restored or reset, in words, once', async () => {
	const { stateRecoveryNoticeText } = await import('../electron/stateRecoveryNotices.ts');
	assert.equal(stateRecoveryNoticeText([]), undefined);
	const restored = stateRecoveryNoticeText([
		{ kind: 'restored', store: 'workspace' },
		{ kind: 'restored', store: 'workspace' },
		{ kind: 'restored', store: 'server-settings' },
	]);
	assert.equal(restored.message, 'Terminay restored an earlier save');
	assert.match(restored.detail, /workspace and settings/u);
	const mixed = stateRecoveryNoticeText([
		{ kind: 'secret-reset', store: 'paired devices' },
		{ kind: 'started-fresh', store: 'macros' },
	]);
	assert.equal(mixed.message, 'Terminay recovered from damaged saved data');
	assert.match(mixed.detail, /paired devices could not be read/u);
	assert.match(mixed.detail, /macros started fresh/u);
	assert.doesNotMatch(mixed.detail, /\//u, 'no paths');
});

test('notices survive the relaunch a recovery performs, and are told once', async (t) => {
	const { carryStateRecoveryNotices, restoreCarriedStateRecoveryNotices } = await import('../electron/stateRecoveryNotices.ts');
	const { queueStateRecoveryNotices, takeStateRecoveryNotices } = await import('../packages/server-core/src/durableFile.ts');
	const root = mkdtempSync(join(tmpdir(), 'tlr-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const file = join(root, 'state-recovery-notices.v1.json');
	takeStateRecoveryNotices();
	queueStateRecoveryNotices([{ kind: 'restored', store: 'workspace' }]);
	carryStateRecoveryNotices(file);
	assert.deepEqual(takeStateRecoveryNotices(), []);
	restoreCarriedStateRecoveryNotices(file);
	assert.equal(existsSync(file), false);
	assert.deepEqual(takeStateRecoveryNotices(), [{ kind: 'restored', store: 'workspace' }]);
	writeFileSync(file, Buffer.alloc(64));
	restoreCarriedStateRecoveryNotices(file);
	assert.deepEqual(takeStateRecoveryNotices(), []);
	assert.equal(existsSync(file), false);
});
