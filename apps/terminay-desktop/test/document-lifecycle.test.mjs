import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	closeDesktopDocumentTransport,
	DesktopDocumentLifecycle,
	handoffDocumentResource,
} from '../dist/index.js';

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

test('transport close failures and failing diagnostics remain bounded during teardown', async () => {
	let closeCalls = 0;
	const rejected = await closeDesktopDocumentTransport(
		{
			close() {
				closeCalls += 1;
				throw new Error('private transport failure');
			},
		},
		() => {
			throw new Error('diagnostic sink failed');
		},
	);
	assert.equal(rejected, false);
	assert.equal(closeCalls, 1);
	const asyncRejected = await closeDesktopDocumentTransport({
		async close() {
			closeCalls += 1;
			throw new Error('async private transport failure');
		},
	});
	assert.equal(asyncRejected, false);
	assert.equal(closeCalls, 2);

	const resolved = await closeDesktopDocumentTransport({
		async close() {
			closeCalls += 1;
		},
	});
	assert.equal(resolved, true);
	assert.equal(closeCalls, 3);
});

test('destroyed renderer handoff races release ports and stay bounded', () => {
	for (const failurePoint of ['authority', 'renderer']) {
		let releases = 0;
		const diagnostics = [];
		const accepted = [];
		assert.equal(
			handoffDocumentResource({
				acceptAuthority: () => {
					if (failurePoint === 'authority') throw new Error('destroyed secret');
					accepted.push('authority');
				},
				sendRenderer: () => {
					if (failurePoint === 'renderer') throw new Error('destroyed secret');
					accepted.push('renderer');
				},
				release: () => {
					releases += 1;
				},
				onFailure: (message) => diagnostics.push(message),
			}),
			false,
		);
		assert.equal(releases, 1);
		assert.equal(diagnostics.length, 1);
		assert.equal(diagnostics[0].includes('secret'), false);
		assert.ok(diagnostics[0].length <= 320);
	}
});

test('Electron destruction callbacks use captured ids and sessions', async () => {
	const [host, endpoint, main, diagnostics] = await Promise.all([
		readFile(
			new URL('../../../electron/serverUiHost.ts', import.meta.url),
			'utf8',
		),
		readFile(
			new URL('../../../electron/serverUiDocumentEndpoint.ts', import.meta.url),
			'utf8',
		),
		readFile(new URL('../../../electron/main.ts', import.meta.url), 'utf8'),
		readFile(
			new URL(
				'../../../electron/diagnostics/electronEvents.ts',
				import.meta.url,
			),
			'utf8',
		),
	]);
	assert.match(host, /const webContentsId = targetWebContents\.id/u);
	assert.match(host, /const targetSession = targetWebContents\.session/u);
	assert.match(host, /let targetWebContentsDestroyed = false/u);
	assert.match(host, /setPermissionCheckHandler\(null\)/u);
	assert.match(host, /setPermissionRequestHandler\(null\)/u);
	assert.match(
		host,
		/targetWebContents\.once\('destroyed', \(\) => \{\s*targetWebContentsDestroyed = true;[\s\S]{0,100}lifecycle\.release\('window-close'\)/u,
	);
	assert.match(
		host,
		/if \(targetWebContentsDestroyed\) return;[\s\S]{0,200}targetWebContents\.off/u,
	);
	assert.match(
		host,
		/denyDownloadForWindow\(webContentsId, event, item, sourceWebContents\)/u,
	);
	assert.doesNotMatch(
		host,
		/once\('destroyed',[\s\S]{0,180}targetWebContents\.(?:id|session|off)/u,
	);
	assert.match(
		main,
		/app\.on\('web-contents-created', \(_event, contents\) => \{\s*const webContentsId = contents\.id;/u,
	);
	assert.doesNotMatch(
		main,
		/contents\.once\('destroyed',[\s\S]{0,180}contents\.id/u,
	);
	assert.match(
		diagnostics,
		/registeredContents\.add\(contents\);\s*const webContentsId = contents\.id;/u,
	);
	assert.doesNotMatch(
		diagnostics,
		/contents\.once\('destroyed',[\s\S]{0,180}contents\.id/u,
	);
	assert.match(endpoint, /current\.release\('reload'\)/u);
	assert.match(endpoint, /activeRemoteEndpoints\.get\(senderId\)\?\.\(\)/u);
	assert.match(endpoint, /closeDesktopDocumentTransport\(transport/u);
	assert.match(
		endpoint,
		/Promise\.resolve\(\)\s*\.then\(\(\) => activeTransport\.open\(\)\)/u,
	);
	assert.match(endpoint, /documentPort\?\.postMessage/u);
	assert.match(endpoint, /let senderDestroyed = false/u);
	assert.match(
		endpoint,
		/destroyedListener = \(\) => \{\s*senderDestroyed = true;/u,
	);
	assert.doesNotMatch(endpoint, /sender\.isDestroyed\(\)/u);
	assert.equal(
		(endpoint.match(/handoffDocumentResource\(\{/gu) ?? []).length,
		2,
	);
	assert.match(
		main,
		/releaseServerUiWindowBinding\([\s\S]{0,100}application-quit/u,
	);
	assert.match(main, /bindLocalServerUiDocumentEndpoint/u);
	assert.match(main, /bindRemoteServerUiDocumentEndpoint/u);
});
