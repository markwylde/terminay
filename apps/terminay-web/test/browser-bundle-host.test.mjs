import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import {
	BrowserSessionBundleHost,
	CacheStorageBrowserBundleStore,
	createBrowserManagerBundleHost,
	createDirectBrowserBundleHost,
	extractTerminayArchive,
	MemoryBrowserBundleStore,
} from '../dist/index.js';

class MemoryCache {
	constructor() { this.records = new Map(); }
	async match(request) { return this.records.get(request.url)?.clone(); }
	async put(request, response) { this.records.set(request.url, response.clone()); }
}
class MemoryCacheStorage {
	constructor() { this.caches = new Map(); }
	async open(name) { if (!this.caches.has(name)) this.caches.set(name, new MemoryCache()); return this.caches.get(name); }
	async delete(name) { return this.caches.delete(name); }
}

function endpoint() { return Object.freeze({ async send() {}, subscribe() { return () => {}; } }); }
function context(bundleId, overrides = {}) {
	return {
		schemaVersion: 1, bootstrapVersion: 1, sourceId: 'browser-manager', windowId: 'browser-session',
		serverId: 'server-prod', profileId: 'profile-prod', bundleId, applicationProtocolVersion: '1',
		hostKind: 'browser', hostBridgeVersion: 1, byteEndpointVersion: 1, capabilities: {}, ...overrides,
	};
}

function fixture(name, entries = []) {
	const bundleId = `archive_${name}_0001`;
	return {
		bundleId,
		archive: gzipSync(tar([
			['terminay-bundle.json', JSON.stringify({ archiveFormatVersion: 1, bundleId, entryPath: 'generated/workspace.html', applicationProtocolVersion: '1' })],
			['generated/workspace.html', `<!doctype html><script type="module" src="./assets/${name}.mjs"></script>`],
			[`generated/assets/${name}.mjs`, `globalThis.archiveName=${JSON.stringify(name)}`],
			...entries,
		])),
	};
}

function tar(entries) {
	const records = [];
	for (const [path, value, type = '0'] of entries) {
		const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
		const header = Buffer.alloc(512);
		header.write(path, 0, 100, 'utf8');
		header.write('0000644\0', 100, 'ascii');
		header.write('0000000\0', 108, 'ascii'); header.write('0000000\0', 116, 'ascii');
		header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
		header.write('00000000000\0', 136, 'ascii');
		Buffer.alloc(8, 0x20).copy(header, 148); header.write(type, 156, 'ascii');
		header.write('ustar\0', 257, 'ascii'); header.write('00', 263, 'ascii');
		let sum = 0; for (const byte of header) sum += byte;
		header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
		records.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
	}
	return Buffer.concat([...records, Buffer.alloc(1024)]);
}

test('one gzip archive installs arbitrary nested generated names and launches its metadata entry', async () => {
	const selected = fixture('opaque-build-name');
	const host = new BrowserSessionBundleHost({ store: new MemoryBrowserBundleStore() });
	const launch = await host.installAndPrepare({ expectedServerId: 'server-prod', sessionOrigin: 'https://prod.example.test', context: context(selected.bundleId), endpoint: endpoint(), compressedArchive: selected.archive });
	assert.equal(launch.entryUrl, 'https://prod.example.test/remote-app/archive_opaque-build-name_0001/generated/workspace.html');
	assert.equal(launch.context.bundleId, selected.bundleId);
	assert.equal(launch.bundle.assets.get(`/remote-app/${selected.bundleId}/generated/assets/opaque-build-name.mjs`) instanceof Uint8Array, true);
});

test('archive extraction is atomic: malformed or interrupted replacement retains the previous bundle', async () => {
	const store = new MemoryBrowserBundleStore(); const host = new BrowserSessionBundleHost({ store });
	const first = fixture('first');
	await host.installAndPrepare({ expectedServerId: 'server-prod', sessionOrigin: 'https://prod.example.test', context: context(first.bundleId), endpoint: endpoint(), compressedArchive: first.archive });
	const broken = fixture('broken'); broken.archive[broken.archive.length - 3] ^= 0xff;
	await assert.rejects(host.installAndPrepare({ expectedServerId: 'server-prod', sessionOrigin: 'https://prod.example.test', context: context(broken.bundleId), endpoint: endpoint(), compressedArchive: broken.archive }), /gzip|archive/u);
	assert.equal((await store.current('server-prod'))?.metadata.bundleId, first.bundleId);
});

test('cache storage publishes archive metadata last and restores only the exact server bundle', async () => {
	const cacheStorage = new MemoryCacheStorage(); const store = new CacheStorageBrowserBundleStore(cacheStorage);
	const selected = fixture('durable'); const host = new BrowserSessionBundleHost({ store });
	await host.installAndPrepare({ expectedServerId: 'server-prod', sessionOrigin: 'https://prod.example.test', context: context(selected.bundleId), endpoint: endpoint(), compressedArchive: selected.archive });
	const restored = await store.current('server-prod');
	assert.equal(restored?.metadata.bundleId, selected.bundleId);
	assert.ok(restored?.assets.has(`/remote-app/${selected.bundleId}/generated/workspace.html`));
	assert.equal(await store.current('server-other'), undefined);
});

test('the generic manager and direct hosts never gate on browser brand or generated filenames', async () => {
	const selected = fixture('any-output-name');
	for (const host of [createDirectBrowserBundleHost(new MemoryCacheStorage()), createBrowserManagerBundleHost(new MemoryCacheStorage())]) {
		const launch = await host.installAndPrepare({ expectedServerId: 'server-prod', sessionOrigin: 'https://prod.example.test', context: context(selected.bundleId), endpoint: endpoint(), compressedArchive: selected.archive });
		assert.equal(launch.bundle.metadata.entryPath, 'generated/workspace.html');
	}
});

test('direct browser archives accept exact IPv4 and IPv6 loopback session origins', async () => {
	const selected = fixture('loopback-origin');
	for (const origin of ['http://127.0.0.1:4317', 'http://[::1]:4317']) {
		const host = createDirectBrowserBundleHost(new MemoryCacheStorage());
		const launch = await host.installAndPrepare({ expectedServerId: 'server-prod', sessionOrigin: origin, context: context(selected.bundleId), endpoint: endpoint(), compressedArchive: selected.archive });
		assert.equal(launch.entryUrl, `${origin}/remote-app/${selected.bundleId}/generated/workspace.html`);
	}
});

test('tar extraction rejects traversal, links, duplicates, metadata drift, and every configured resource limit', () => {
	const bundleId = 'archive_security_0001';
	const metadata = JSON.stringify({ archiveFormatVersion: 1, bundleId, entryPath: 'index.html', applicationProtocolVersion: '1' });
	const good = () => [['terminay-bundle.json', metadata], ['index.html', 'ok']];
	assert.throws(() => extractTerminayArchive(tar([...good(), ['../escape', 'no']])), /unsafe/u);
	assert.throws(() => extractTerminayArchive(tar([...good(), ['linked', 'target', '2']])), /only regular/u);
	assert.throws(() => extractTerminayArchive(tar([...good(), ['index.html', 'second']])), /duplicate/u);
	assert.throws(() => extractTerminayArchive(tar([['terminay-bundle.json', JSON.stringify({ archiveFormatVersion: 1, bundleId, entryPath: 'missing.html', applicationProtocolVersion: '1' })], ['index.html', 'ok']])), /entry is missing/u);
	assert.throws(() => extractTerminayArchive(tar(good()), { maxEntries: 1 }), /entry limit/u);
	assert.throws(() => extractTerminayArchive(tar([...good(), ['large.bin', Buffer.alloc(8)]]), { maxEntryBytes: 4 }), /size limit/u);
	assert.throws(() => extractTerminayArchive(tar(good()), { maxExpandedBytes: 1 }), /expanded size/u);
	assert.throws(() => extractTerminayArchive(tar([['terminay-bundle.json', metadata], ['a'.repeat(20), 'x'], ['index.html', 'ok']]), { maxPathBytes: 10 }), /unsafe/u);
});

test('browser archive handling imports only the browser-safe shared archive subpath', async () => {
	const [source, packageJson] = await Promise.all([
		readFile(new URL('../src/archiveBundle.ts', import.meta.url), 'utf8'),
		readFile(new URL('../../../packages/ui-bundle/package.json', import.meta.url), 'utf8'),
	]);
	assert.match(source, /from '@terminay\/ui-bundle\/archive'/u);
	assert.doesNotMatch(source, /from '@terminay\/ui-bundle';/u);
	const exports = JSON.parse(packageJson).exports;
	assert.equal(exports['./archive'].import, './dist/archive.js');
});
