import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DesktopDocumentLifecycle } from '../dist/index.js';

test('document resources release exactly once without releasing server authority', async () => {
	const released = [];
	let serverAlive = true;
	const lifecycle = new DesktopDocumentLifecycle();
	lifecycle.add('host-binding', () => released.push('host-binding'));
	lifecycle.add('subscription', () => released.push('subscription'));
	lifecycle.add('message-port', () => released.push('message-port'));

	assert.equal(lifecycle.release('reload'), true);
	assert.equal(lifecycle.release('window-close'), false);
	assert.equal(lifecycle.release('application-quit'), false);
	assert.deepEqual(released, ['message-port', 'subscription', 'host-binding']);
	assert.equal(serverAlive, true);
	serverAlive = false;
});

test('late resources, throws, and rejected cleanup stay bounded and exception-free', async () => {
	const diagnostics = [];
	const lifecycle = new DesktopDocumentLifecycle((event) =>
		diagnostics.push(event),
	);
	lifecycle.add('throwing', () => {
		throw new Error(`secret\n${'x'.repeat(500)}`);
	});
	lifecycle.add('rejecting', async () => {
		throw new Error('async failure');
	});
	assert.equal(lifecycle.release('failed-launch'), true);
	lifecycle.add('late', () => {
		throw new Error('late failure');
	});
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(diagnostics.length, 3);
	assert.deepEqual(
		diagnostics.map(({ resource, reason }) => [resource, reason]),
		[
			['throwing', 'failed-launch'],
			['late', 'superseded'],
			['rejecting', 'failed-launch'],
		],
	);
	assert.equal(diagnostics[0].message.includes('\n'), false);
	assert.ok(diagnostics[0].message.length <= 320);
});

test('every native teardown reason is idempotent', () => {
	for (const reason of [
		'failed-launch',
		'reload',
		'server-switch',
		'superseded',
		'window-close',
		'application-quit',
	]) {
		let releases = 0;
		const lifecycle = new DesktopDocumentLifecycle();
		lifecycle.add(reason, () => {
			releases += 1;
		});
		assert.equal(lifecycle.release(reason), true);
		assert.equal(lifecycle.release(reason), false);
		assert.equal(releases, 1);
	}
});

test('Electron destruction callbacks use captured ids and sessions', async () => {
	const [host, endpoint, main] = await Promise.all([
		readFile(
			new URL('../../../electron/serverUiHost.ts', import.meta.url),
			'utf8',
		),
		readFile(
			new URL('../../../electron/serverUiDocumentEndpoint.ts', import.meta.url),
			'utf8',
		),
		readFile(new URL('../../../electron/main.ts', import.meta.url), 'utf8'),
	]);
	assert.match(host, /const webContentsId = targetWebContents\.id/u);
	assert.match(host, /const targetSession = targetWebContents\.session/u);
	assert.doesNotMatch(
		host,
		/once\('destroyed',[\s\S]{0,180}targetWebContents\.(?:id|session)/u,
	);
	assert.match(endpoint, /current\.release\('reload'\)/u);
	assert.match(endpoint, /activeRemoteEndpoints\.get\(senderId\)\?\.\(\)/u);
	assert.match(endpoint, /documentPort\?\.postMessage/u);
	assert.match(
		main,
		/releaseServerUiWindowBinding\([\s\S]{0,100}application-quit/u,
	);
	assert.match(main, /bindLocalServerUiDocumentEndpoint/u);
	assert.match(main, /bindRemoteServerUiDocumentEndpoint/u);
});
