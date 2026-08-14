import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';
import {
	BrowserHostUpgradeRequiredError,
	BrowserSessionBundleHost,
	CacheStorageBrowserBundleStore,
	createBrowserManagerBundleHost,
	createDirectBrowserBundleHost,
	MemoryBrowserBundleStore,
	negotiateBrowserHostCapabilities,
} from '../dist/index.js';
import {
	DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY,
	deriveUiBundleId,
	validateUiBundleManifest,
} from '@terminay/server-core/ui-bundle';

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

const runtime = Object.freeze({
	bootstrapVersion: 1,
	bundleFormatVersion: 1,
	hostBridgeVersion: 1,
	byteEndpointVersion: 1,
	capabilities: {},
});

const compatible = Object.freeze({
	bootstrap: { minimum: 1, maximum: 1 },
	bundleFormat: { minimum: 1, maximum: 1 },
	hostBridge: { minimum: 1, maximum: 1 },
	byteEndpoint: { minimum: 1, maximum: 1 },
	requiredCapabilities: {},
	optionalCapabilities: { notifications: { minimum: 1, maximum: 1 } },
});

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('base64url');
}

function fixture(name, options = {}) {
	const provisionalId = `bundle_${name}_0001`;
	const assets = new Map([
		[`/remote-app/${provisionalId}/index.html`, new TextEncoder().encode(`<title>${name}</title>`)],
		[`/remote-app/${provisionalId}/assets/app.js`, new TextEncoder().encode(`globalThis.bundle='${name}'`)],
	]);
	const inventory = [...assets].map(([path, bytes]) => ({ path, size: bytes.byteLength, hash: digest(bytes), contentType: path.endsWith('.html') ? 'text/html' : 'application/javascript' }));
	const identity = { bundleFormatVersion: 1, protocolVersion: '1', serverVersion: '3.0.0', hostCompatibility: options.compatibility ?? compatible };
	const bundleId = deriveUiBundleId(inventory, provisionalId, identity);
	const canonicalAssets = new Map([...assets].map(([path, bytes]) => [path.replace(provisionalId, bundleId), bytes]));
	const manifest = validateUiBundleManifest({
		schemaVersion: 1,
		bundleId,
		protocolVersion: identity.protocolVersion,
		serverVersion: identity.serverVersion,
		entryPath: `/remote-app/${bundleId}/index.html`,
		contentSecurityPolicy: DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY,
		bundleFormatVersion: 1,
		hostCompatibility: identity.hostCompatibility,
		assets: inventory.map((asset) => ({ ...asset, path: asset.path.replace(provisionalId, bundleId) })),
	}, { requireHostCompatibility: true });
	return {
		manifest,
		assets: canonicalAssets,
	};
}

function context(bundleId, overrides = {}) {
	return {
		schemaVersion: 1,
		bootstrapVersion: 1,
		sourceId: 'browser-manager',
		windowId: 'browser-session',
		serverId: 'server-prod',
		profileId: 'profile-prod',
		bundleId,
		applicationProtocolVersion: '1',
		hostKind: 'browser',
		hostBridgeVersion: 1,
		byteEndpointVersion: 1,
		capabilities: {},
		...overrides,
	};
}

function endpoint() {
	return Object.freeze({ async send() {}, subscribe() { return () => {}; } });
}

test('browser host verifies and atomically commits the selected server bundle', async () => {
	const store = new MemoryBrowserBundleStore();
	const host = new BrowserSessionBundleHost({ store, runtime, crypto: webcrypto });
	const first = fixture('first');
	const launch = await host.installAndPrepare({
		manifest: first.manifest,
		expectedServerId: 'server-prod',
		sessionOrigin: 'https://prod.example.test',
		context: context(first.manifest.bundleId),
		endpoint: endpoint(),
		readAsset: async (path) => first.assets.get(path),
	});
	assert.equal(launch.entryUrl, `https://prod.example.test${first.manifest.entryPath}`);
	assert.equal(launch.context.bundleId, first.manifest.bundleId);
	assert.deepEqual(launch.compatibility.unavailableOptionalCapabilities, ['notifications']);
	assert.equal((await store.current('server-prod')).manifest.bundleId, first.manifest.bundleId);

	const interrupted = fixture('interrupted');
	await assert.rejects(host.installAndPrepare({
		manifest: interrupted.manifest,
		expectedServerId: 'server-prod',
		sessionOrigin: 'https://prod.example.test',
		context: context(interrupted.manifest.bundleId),
		endpoint: endpoint(),
		readAsset: async (path) => path.endsWith('app.js') ? Promise.reject(new Error('transport interrupted')) : interrupted.assets.get(path),
	}), /transport interrupted/);
	assert.equal((await store.current('server-prod')).manifest.bundleId, first.manifest.bundleId);
});

test('cache storage publishes the active manifest last and restores the complete exact-server bundle', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const store = new CacheStorageBrowserBundleStore(cacheStorage);
	const selected = fixture('durable');
	const host = new BrowserSessionBundleHost({ store, runtime, crypto: webcrypto });
	await host.installAndPrepare({ manifest: selected.manifest, expectedServerId: 'server-prod', sessionOrigin: 'https://prod.example.test', context: context(selected.manifest.bundleId), endpoint: endpoint(), readAsset: async (path) => selected.assets.get(path) });
	const restored = await store.current('server-prod');
	assert.equal(restored.manifest.bundleId, selected.manifest.bundleId);
	assert.deepEqual([...restored.assets], [...selected.assets]);
	assert.equal(await store.current('server-other'), undefined);
});

test('browser host rejects hashes, unsafe paths, identity drift, and mismatched context without replacing the active bundle', async () => {
	const store = new MemoryBrowserBundleStore();
	const host = new BrowserSessionBundleHost({ store, runtime, crypto: webcrypto });
	const first = fixture('stable');
	await host.installAndPrepare({ manifest: first.manifest, expectedServerId: 'server-prod', sessionOrigin: 'https://prod.example.test', context: context(first.manifest.bundleId), endpoint: endpoint(), readAsset: async (path) => first.assets.get(path) });

	const invalidHash = fixture('bad_hash');
	const invalidHashManifest = { ...invalidHash.manifest, assets: invalidHash.manifest.assets.map((asset, index) => index === 0 ? { ...asset, hash: 'A'.repeat(43) } : asset) };
	await assert.rejects(host.installAndPrepare({ manifest: invalidHashManifest, expectedServerId: 'server-prod', sessionOrigin: 'https://prod.example.test', context: context(invalidHash.manifest.bundleId), endpoint: endpoint(), readAsset: async (path) => invalidHash.assets.get(path) }), /hash mismatch/);
	const wrongServer = fixture('wrong_server');
	await assert.rejects(host.installAndPrepare({ manifest: wrongServer.manifest, expectedServerId: 'server-prod', sessionOrigin: 'https://prod.example.test', context: context(wrongServer.manifest.bundleId, { serverId: 'server-other' }), endpoint: endpoint(), readAsset: async (path) => wrongServer.assets.get(path) }), /context/);
	const unsafe = fixture('unsafe');
	const unsafeManifest = { ...unsafe.manifest, assets: unsafe.manifest.assets.map((asset, index) => index === 0 ? { ...asset, path: `/remote-app/${unsafe.manifest.bundleId}/../escape.js` } : asset) };
	await assert.rejects(host.installAndPrepare({ manifest: unsafeManifest, expectedServerId: 'server-prod', sessionOrigin: 'https://prod.example.test', context: context(unsafe.manifest.bundleId), endpoint: endpoint(), readAsset: async (path) => unsafe.assets.get(path) }), /unsafe/);
	await assert.rejects(host.installAndPrepare({ manifest: first.manifest, expectedServerId: 'server-prod', sessionOrigin: 'https://prod.example.test', context: context(first.manifest.bundleId, { hostKind: 'desktop' }), endpoint: endpoint(), readAsset: async (path) => first.assets.get(path) }), /context/);
	assert.equal((await store.current('server-prod')).manifest.bundleId, first.manifest.bundleId);
});

test('a missing required browser capability is typed before asset reads while optional capabilities degrade', async () => {
	const store = new MemoryBrowserBundleStore();
	const host = new BrowserSessionBundleHost({ store, runtime, crypto: webcrypto });
	const incompatible = fixture('required-capability', {
		compatibility: {
			...compatible,
			requiredCapabilities: { clipboardWrite: { minimum: 1, maximum: 1 } },
			optionalCapabilities: {},
		},
	});
	let reads = 0;
	await assert.rejects(host.installAndPrepare({
		manifest: incompatible.manifest,
		expectedServerId: 'server-prod',
		sessionOrigin: 'https://prod.example.test',
		context: context(incompatible.manifest.bundleId),
		endpoint: endpoint(),
		readAsset: async (path) => { reads += 1; return incompatible.assets.get(path); },
	}), (error) =>
		error instanceof BrowserHostUpgradeRequiredError &&
		error.failure.component === 'host-capability' &&
		error.failure.code === 'missing-capability' &&
		error.failure.capability === 'clipboardWrite');
	assert.equal(reads, 0);
	assert.equal(await store.current('server-prod'), undefined);
});

test('one server bundle/context stays identical across all four host launch paths', async () => {
	const selected = fixture('shared');
	const paths = ['local-desktop', 'remote-desktop', 'direct-browser', 'browser-manager'];
	const launches = [];
	for (const path of paths) {
		const host = new BrowserSessionBundleHost({ store: new MemoryBrowserBundleStore(), runtime, crypto: webcrypto });
		const launched = await host.installAndPrepare({ manifest: selected.manifest, expectedServerId: 'server-prod', sessionOrigin: 'https://prod.example.test', context: context(selected.manifest.bundleId, { sourceId: path }), endpoint: endpoint(), readAsset: async (assetPath) => selected.assets.get(assetPath) });
		launches.push({ path, bundleId: launched.bundle.manifest.bundleId, serverId: launched.context.serverId, profileId: launched.context.profileId });
	}
	assert.deepEqual(new Set(launches.map(({ bundleId }) => bundleId)), new Set([selected.manifest.bundleId]));
	assert.deepEqual(new Set(launches.map(({ serverId }) => serverId)), new Set(['server-prod']));
	assert.deepEqual(new Set(launches.map(({ profileId }) => profileId)), new Set(['profile-prod']));
});

test('browser launch URLs remain exact-origin and carry no credentials', async () => {
	const selected = fixture('isolated');
	const host = new BrowserSessionBundleHost({ store: new MemoryBrowserBundleStore(), runtime, crypto: webcrypto });
	const launch = await host.installAndPrepare({ manifest: selected.manifest, expectedServerId: 'server-prod', sessionOrigin: 'https://session.example.test', context: context(selected.manifest.bundleId), endpoint: endpoint(), readAsset: async (path) => selected.assets.get(path) });
	const url = new URL(launch.entryUrl);
	assert.equal(url.origin, 'https://session.example.test');
	assert.equal(url.search, '');
	assert.equal(url.hash, '');
	await assert.rejects(host.installAndPrepare({ manifest: selected.manifest, expectedServerId: 'server-prod', sessionOrigin: 'https://user:secret@session.example.test', context: context(selected.manifest.bundleId), endpoint: endpoint(), readAsset: async (path) => selected.assets.get(path) }), /exact HTTPS/);
});

test('direct-browser and manager launches accept Firefox, Chromium, and reduced or spoofed UAs with the same required capabilities', async () => {
	const requiredCapabilities = Object.freeze({ clipboardWrite: { minimum: 1, maximum: 1 } });
	const selected = fixture('ua-neutral', {
		compatibility: {
			...compatible,
			requiredCapabilities,
			optionalCapabilities: {},
		},
	});
	const userAgents = [
		'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36',
		'TerminayBrowser/1.0',
		'Mozilla/5.0 Chrome/999.0.0.0 Safari/537.36 Terminay-spoof',
	];
	for (const [userAgentIndex, userAgent] of userAgents.entries()) {
		const capabilities = negotiateBrowserHostCapabilities({
			// A user agent is deliberately irrelevant to negotiation. Keeping it on
			// the platform fixture makes this a regression test against brand gates.
			userAgent,
			clipboard: { writeText() {} },
			Notification: function Notification() {},
		});
		assert.deepEqual(capabilities, { clipboardWrite: 1, notifications: 1 }, userAgent);
		assert.ok(Object.isFrozen(capabilities), userAgent);
		for (const [kind, host] of [
			['direct', createDirectBrowserBundleHost(new MemoryCacheStorage(), capabilities)],
			['manager', createBrowserManagerBundleHost(new MemoryCacheStorage(), capabilities)],
		]) {
			const launch = await host.installAndPrepare({
				manifest: selected.manifest,
				expectedServerId: 'server-prod',
				sessionOrigin: 'https://prod.example.test',
				context: context(selected.manifest.bundleId, { sourceId: `${kind}-${userAgentIndex}` }),
				endpoint: endpoint(),
				readAsset: async (path) => selected.assets.get(path),
			});
			assert.equal(launch.bundle.manifest.bundleId, selected.manifest.bundleId, `${kind}: ${userAgent}`);
		}
	}
});

test('direct-browser reports a typed missing capability rather than accepting a reduced platform', async () => {
	const selected = fixture('reduced-browser', {
		compatibility: {
			...compatible,
			requiredCapabilities: { clipboardWrite: { minimum: 1, maximum: 1 } },
			optionalCapabilities: {},
		},
	});
	const host = createDirectBrowserBundleHost(
		new MemoryCacheStorage(),
		negotiateBrowserHostCapabilities({}),
	);
	await assert.rejects(host.installAndPrepare({
		manifest: selected.manifest,
		expectedServerId: 'server-prod',
		sessionOrigin: 'https://prod.example.test',
		context: context(selected.manifest.bundleId),
		endpoint: endpoint(),
		readAsset: async (path) => selected.assets.get(path),
	}), (error) =>
		error instanceof BrowserHostUpgradeRequiredError &&
		error.failure.component === 'host-capability' &&
		error.failure.code === 'missing-capability' &&
		error.failure.capability === 'clipboardWrite');
});
