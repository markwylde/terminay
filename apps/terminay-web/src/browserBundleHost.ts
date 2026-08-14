import {
	evaluateTerminayBundleCompatibility,
	parseTerminayHostContext,
	parseTerminayUiBundleCompatibilityManifest,
	TERMINAY_HOST_CAPABILITY_NAMES,
	type TerminayBundleCompatibilityResult,
	type TerminayHostCapability,
	type TerminayHostCompatibilityFailure,
	type TerminayHostCapabilityVersions,
	type TerminayHostContext,
	type TerminayHostRuntimeSupport,
} from '@terminay/protocol';
import type { UiBundleAsset, UiBundleManifest } from '@terminay/ui-bundle';

const HASH = /^[A-Za-z0-9_-]{43}$/u;
const MAX_ASSETS = 1_024;
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export interface VerifiedBrowserBundle {
	readonly manifest: UiBundleManifest;
	readonly assets: ReadonlyMap<string, Uint8Array>;
}

export interface BrowserBundleStore {
	current(serverId: string): Promise<VerifiedBrowserBundle | undefined>;
	/** Implementations must publish the active pointer after all assets commit. */
	commit(serverId: string, bundle: VerifiedBrowserBundle): Promise<void>;
}

export interface OpaqueBrowserByteEndpoint {
	send(frame: Uint8Array): Promise<void>;
	subscribe(listener: (frame: Uint8Array) => void): () => void;
}

/** The only browser presentation capabilities. They are derived from concrete
 * APIs, never from a browser name, runtime brand, or user-agent string. */
export interface BrowserCapabilityPlatform {
	readonly clipboard?: Readonly<{ writeText?: unknown }>;
	readonly Notification?: unknown;
}

export interface BrowserBundleLaunch {
	readonly context: TerminayHostContext;
	readonly bundle: VerifiedBrowserBundle;
	readonly entryUrl: string;
	readonly endpoint: OpaqueBrowserByteEndpoint;
	readonly compatibility: Extract<TerminayBundleCompatibilityResult, { compatible: true }>;
}

export class BrowserHostUpgradeRequiredError extends Error {
	readonly failure: Exclude<TerminayBundleCompatibilityResult, { compatible: true }>;
	readonly failures: readonly Exclude<TerminayBundleCompatibilityResult, { compatible: true }>[];
	constructor(
		failure: Exclude<TerminayBundleCompatibilityResult, { compatible: true }>,
		failures: readonly Exclude<TerminayBundleCompatibilityResult, { compatible: true }>[] = [failure],
	) {
		super(`browser host upgrade required: ${failure.component}/${failure.code}`);
		this.name = 'BrowserHostUpgradeRequiredError';
		this.failure = failure;
		this.failures = Object.freeze([...failures]);
	}
}

export class MemoryBrowserBundleStore implements BrowserBundleStore {
	private readonly bundles = new Map<string, VerifiedBrowserBundle>();
	async current(serverId: string): Promise<VerifiedBrowserBundle | undefined> {
		return this.bundles.get(serverId);
	}
	async commit(serverId: string, bundle: VerifiedBrowserBundle): Promise<void> {
		this.bundles.set(serverId, bundle);
	}
}

/** Exact-session-origin Cache Storage backend. The active metadata cache is
 * updated only after the immutable bundle cache is complete, so an interrupted
 * write cannot replace the last launchable bundle. */
export class CacheStorageBrowserBundleStore implements BrowserBundleStore {
	constructor(
		private readonly cacheStorage: CacheStorage,
		private readonly namespace = 'terminay.session-bundles.v1',
	) {}

	async current(serverId: string): Promise<VerifiedBrowserBundle | undefined> {
		const metadata = await this.cacheStorage.open(`${this.namespace}.active`);
		const record = await metadata.match(this.metadataRequest(serverId));
		if (record === undefined) return undefined;
		const manifest = parseBrowserBundleManifest(await record.json());
		const cache = await this.cacheStorage.open(this.bundleCache(serverId, manifest.bundleId));
		const assets = new Map<string, Uint8Array>();
		for (const asset of manifest.assets) {
			const response = await cache.match(this.assetRequest(asset.path));
			if (response === undefined) return undefined;
			assets.set(asset.path, new Uint8Array(await response.arrayBuffer()));
		}
		return Object.freeze({ manifest, assets: readonlyAssets(assets) });
	}

	async commit(serverId: string, bundle: VerifiedBrowserBundle): Promise<void> {
		const cacheName = this.bundleCache(serverId, bundle.manifest.bundleId);
		const cache = await this.cacheStorage.open(cacheName);
		try {
			for (const asset of bundle.manifest.assets) {
				const bytes = bundle.assets.get(asset.path);
				if (bytes === undefined) throw new Error('verified browser bundle is incomplete');
				await cache.put(this.assetRequest(asset.path), new Response(bytes as BodyInit, { headers: { 'Content-Type': asset.contentType } }));
			}
			const metadata = await this.cacheStorage.open(`${this.namespace}.active`);
			await metadata.put(this.metadataRequest(serverId), new Response(JSON.stringify(bundle.manifest), { headers: { 'Content-Type': 'application/json' } }));
		} catch (error) {
			await this.cacheStorage.delete(cacheName);
			throw error;
		}
	}

	private metadataRequest(serverId: string): Request {
		return new Request(`https://terminay.invalid/${this.namespace}/active/${encodeURIComponent(serverId)}`);
	}

	private assetRequest(path: string): Request {
		return new Request(`https://terminay.invalid${path}`);
	}

	private bundleCache(serverId: string, bundleId: string): string {
		return `${this.namespace}.bundle.${encodeURIComponent(serverId)}.${bundleId}`;
	}
}

export class BrowserSessionBundleHost {
	constructor(
		private readonly options: Readonly<{
			store: BrowserBundleStore;
			runtime: TerminayHostRuntimeSupport;
			crypto?: Pick<Crypto, 'subtle'>;
		}>,
	) {}

	async installAndPrepare(input: Readonly<{
		manifest: unknown;
		expectedServerId: string;
		sessionOrigin: string;
		context: unknown;
		endpoint: OpaqueBrowserByteEndpoint;
		readAsset(path: string): Promise<Uint8Array>;
	}>): Promise<BrowserBundleLaunch> {
		const origin = exactSessionOrigin(input.sessionOrigin);
		const manifest = parseBrowserBundleManifest(input.manifest);
		const suppliedContext = parseTerminayHostContext(input.context);
		/* The browser shell is the trusted producer of presentation capabilities.
		 * Do not accept a server/bootstrap claim that this browser has a native
		 * capability just because it appeared in the supplied host context. */
		const context = parseTerminayHostContext({
			...suppliedContext,
			capabilities: this.options.runtime.capabilities,
		});
		if (
			context.hostKind !== 'browser' ||
			context.serverId !== input.expectedServerId ||
			context.bundleId !== manifest.bundleId
		)
			throw new TypeError('browser host context does not match the selected bundle');
		const compatibility = evaluateTerminayBundleCompatibility(
			manifest,
			context,
			this.options.runtime,
		);
		if (!compatibility.compatible)
			throw new BrowserHostUpgradeRequiredError(
				compatibility,
				browserCompatibilityFailures(manifest, this.options.runtime, compatibility),
			);

		const assets = new Map<string, Uint8Array>();
		for (const asset of manifest.assets) {
			const bytes = copyBytes(await input.readAsset(asset.path));
			if (bytes.byteLength !== asset.size)
				throw new TypeError(`browser bundle asset size mismatch: ${asset.path}`);
			const actualHash = await sha256(bytes, this.options.crypto);
			if (actualHash !== asset.hash)
				throw new TypeError(`browser bundle asset hash mismatch: ${asset.path}`);
			assets.set(asset.path, bytes);
		}
		const bundle = Object.freeze({ manifest, assets: readonlyAssets(assets) });
		await this.options.store.commit(input.expectedServerId, bundle);
		return Object.freeze({
			context,
			bundle,
			entryUrl: new URL(manifest.entryPath, origin).toString(),
			endpoint: input.endpoint,
			compatibility,
		});
	}
}

export function createBrowserManagerBundleHost(
	cacheStorage: CacheStorage,
	capabilities: TerminayHostCapabilityVersions = negotiateBrowserHostCapabilities(),
): BrowserSessionBundleHost {
	return new BrowserSessionBundleHost({
		store: new CacheStorageBrowserBundleStore(cacheStorage, 'terminay.manager-session-bundles.v1'),
		runtime: browserRuntime(capabilities),
	});
}

export function createDirectBrowserBundleHost(
	cacheStorage: CacheStorage,
	capabilities: TerminayHostCapabilityVersions = negotiateBrowserHostCapabilities(),
): BrowserSessionBundleHost {
	return new BrowserSessionBundleHost({
		store: new CacheStorageBrowserBundleStore(cacheStorage, 'terminay.direct-session-bundles.v1'),
		runtime: browserRuntime(capabilities),
	});
}

export function negotiateBrowserHostCapabilities(
	platform: BrowserCapabilityPlatform = browserCapabilityPlatform(),
): TerminayHostCapabilityVersions {
	const capabilities: Partial<Record<TerminayHostCapability, number>> = {};
	if (typeof platform.clipboard?.writeText === 'function') capabilities.clipboardWrite = 1;
	if (typeof platform.Notification === 'function') capabilities.notifications = 1;
	return Object.freeze(capabilities);
}

function browserRuntime(capabilities: TerminayHostCapabilityVersions): TerminayHostRuntimeSupport {
	return Object.freeze({
		bootstrapVersion: 1,
		bundleFormatVersion: 1,
		hostBridgeVersion: 1,
		byteEndpointVersion: 1,
		capabilities: browserCapabilities(capabilities),
	});
}

function browserCapabilityPlatform(): BrowserCapabilityPlatform {
	const browser = globalThis as typeof globalThis & {
		navigator?: { clipboard?: Readonly<{ writeText?: unknown }> };
		Notification?: unknown;
	};
	return Object.freeze({
		clipboard: browser.navigator?.clipboard,
		Notification: browser.Notification,
	});
}

function browserCapabilities(value: TerminayHostCapabilityVersions): TerminayHostCapabilityVersions {
	const capabilities: Partial<Record<TerminayHostCapability, number>> = {};
	for (const capability of ['clipboardWrite', 'notifications'] as const) {
		if (value[capability] === 1) capabilities[capability] = 1;
	}
	return Object.freeze(capabilities);
}

function browserCompatibilityFailures(
	manifest: UiBundleManifest,
	runtime: TerminayHostRuntimeSupport,
	primary: Exclude<TerminayBundleCompatibilityResult, { compatible: true }>,
): readonly Exclude<TerminayBundleCompatibilityResult, { compatible: true }>[] {
	const failures: Exclude<TerminayBundleCompatibilityResult, { compatible: true }>[] = [primary];
	for (const capability of TERMINAY_HOST_CAPABILITY_NAMES) {
		const required = manifest.hostCompatibility?.requiredCapabilities[capability];
		if (required === undefined) continue;
		const actual = runtime.capabilities[capability];
		const failure: TerminayHostCompatibilityFailure | undefined = actual === undefined
			? Object.freeze({ compatible: false, component: 'host-capability', code: 'missing-capability', capability, required })
			: actual < required.minimum
				? Object.freeze({ compatible: false, component: 'host-capability', code: 'below-minimum', capability, required, actual })
				: actual > required.maximum
					? Object.freeze({ compatible: false, component: 'host-capability', code: 'above-maximum', capability, required, actual })
					: undefined;
		if (failure !== undefined && !failures.some((candidate) => candidate.component === failure.component && candidate.code === failure.code && candidate.capability === failure.capability)) failures.push(failure);
	}
	return Object.freeze(failures);
}

export function parseBrowserBundleManifest(value: unknown): UiBundleManifest {
	const compatibility = parseTerminayUiBundleCompatibilityManifest(value);
	if (!record(value)) throw new TypeError('browser bundle manifest is invalid');
	const bundleId = compatibility.bundleId;
	if (!Array.isArray(value.assets) || value.assets.length === 0 || value.assets.length > MAX_ASSETS)
		throw new TypeError('browser bundle asset count is invalid');
	const prefix = `/remote-app/${bundleId}/`;
	const seen = new Set<string>();
	let total = 0;
	const assets = value.assets.map((raw): UiBundleAsset => {
		if (!record(raw)) throw new TypeError('browser bundle asset is invalid');
		if (Object.keys(raw).sort().join('|') !== ['contentType', 'hash', 'path', 'size'].join('|'))
			throw new TypeError('browser bundle asset contains an unknown field');
		const path = safeBundlePath(raw.path, prefix);
		if (seen.has(path)) throw new TypeError('browser bundle asset path is duplicated');
		seen.add(path);
		const size = raw.size;
		if (!Number.isSafeInteger(size) || (size as number) < 0 || (size as number) > MAX_ASSET_BYTES)
			throw new TypeError('browser bundle asset size is invalid');
		total += size as number;
		if (total > MAX_TOTAL_BYTES) throw new TypeError('browser bundle total size exceeds limit');
		return Object.freeze({
			path,
			hash: bounded(raw.hash, 'asset hash', HASH),
			size: size as number,
			contentType: bounded(raw.contentType, 'asset content type', /^[^\r\n]{1,256}$/u),
		});
	});
	const entryPath = safeBundlePath(value.entryPath, prefix);
	if (!seen.has(entryPath)) throw new TypeError('browser bundle entry is not an asset');
	const entry = assets.find((asset) => asset.path === entryPath);
	if (entry === undefined || !/^text\/html(?:;|$)/iu.test(entry.contentType))
		throw new TypeError('browser bundle entry must be an HTML document');
	if (value.contentSecurityPolicy !== "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		throw new TypeError('browser bundle content security policy is unsupported');
	const serverVersion = bounded(value.serverVersion, 'server version', /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/u);
	return Object.freeze({
		schemaVersion: 1,
		bundleId,
		entryPath,
		protocolVersion: compatibility.protocolVersion,
		serverVersion,
		contentSecurityPolicy: value.contentSecurityPolicy,
		bundleFormatVersion: compatibility.bundleFormatVersion,
		assets: Object.freeze(assets),
		hostCompatibility: compatibility.hostCompatibility,
	});
}

function safeBundlePath(value: unknown, prefix: string): string {
	if (typeof value !== 'string' || value.length > 512 || !value.startsWith(prefix))
		throw new TypeError('browser bundle asset path is outside its namespace');
	const suffix = value.slice(prefix.length);
	if (!suffix || suffix.startsWith('/') || suffix.split('/').some((part) => !part || part === '.' || part === '..' || /[%\\\0]/u.test(part)))
		throw new TypeError('browser bundle asset path is unsafe');
	return value;
}

function exactSessionOrigin(value: string): string {
	const parsed = new URL(value);
	const loopback = parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname.endsWith('.localhost'));
	if ((!loopback && parsed.protocol !== 'https:') || parsed.origin !== value || parsed.username || parsed.password)
		throw new TypeError('browser session origin must be an exact HTTPS or loopback origin');
	return parsed.origin;
}

function bounded(value: unknown, name: string, pattern: RegExp): string {
	if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`${name} is invalid`);
	return value;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function copyBytes(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array)) throw new TypeError('browser bundle asset reader returned invalid bytes');
	return Uint8Array.from(value);
}

function readonlyAssets(assets: Map<string, Uint8Array>): ReadonlyMap<string, Uint8Array> {
	return new Map([...assets].map(([path, bytes]) => [path, Uint8Array.from(bytes)]));
}

async function sha256(bytes: Uint8Array, cryptoApi?: Pick<Crypto, 'subtle'>): Promise<string> {
	const subtle = cryptoApi?.subtle ?? globalThis.crypto?.subtle;
	if (subtle === undefined) throw new Error('WebCrypto SHA-256 is unavailable');
	const digest = new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource));
	let binary = '';
	for (const byte of digest) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
