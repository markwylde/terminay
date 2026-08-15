import {
	parseTerminayHostContext,
	type TerminayHostContext,
} from '@terminay/protocol';
import {
	decompressTerminayArchive,
	extractTerminayArchive,
	type TerminayArchiveMetadata,
} from './archiveBundle.js';

const MAX_COMPRESSED_BYTES = 32 * 1024 * 1024;

export interface VerifiedBrowserBundle {
	readonly metadata: TerminayArchiveMetadata;
	/** Absolute Cache Storage paths. These are derived only after archive
	 * extraction, never supplied by a server manifest. */
	readonly assets: ReadonlyMap<string, Uint8Array>;
}

export interface BrowserBundleStore {
	current(serverId: string): Promise<VerifiedBrowserBundle | undefined>;
	/** Implementations publish the active pointer only after every asset commits. */
	commit(serverId: string, bundle: VerifiedBrowserBundle): Promise<void>;
}

export interface OpaqueBrowserByteEndpoint {
	send(frame: Uint8Array): Promise<void>;
	subscribe(listener: (frame: Uint8Array) => void): () => void;
}

/** Kept as a presentation capability seam. Archive installation itself is
 * intentionally independent of browser name and generated app layout. */
export interface BrowserCapabilityPlatform {
	readonly clipboard?: Readonly<{ writeText?: unknown }>;
	readonly Notification?: unknown;
}

export interface BrowserBundleLaunch {
	readonly context: TerminayHostContext;
	readonly bundle: VerifiedBrowserBundle;
	readonly entryUrl: string;
	readonly endpoint: OpaqueBrowserByteEndpoint;
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

/** Exact-session-origin Cache Storage backend. The immutable cache receives
 * every extracted file before the active record changes, so interruption keeps
 * the previous complete archive launchable. */
export class CacheStorageBrowserBundleStore implements BrowserBundleStore {
	constructor(
		private readonly cacheStorage: CacheStorage,
		private readonly namespace = 'terminay.session-archives.v1',
	) {}

	async current(serverId: string): Promise<VerifiedBrowserBundle | undefined> {
		const metadataCache = await this.cacheStorage.open(`${this.namespace}.active`);
		const response = await metadataCache.match(this.metadataRequest(serverId));
		if (response === undefined) return undefined;
		const value = await response.json();
		if (!record(value) || !Array.isArray(value.paths)) return undefined;
		let metadata: TerminayArchiveMetadata;
		try { metadata = parseStoredMetadata(value.metadata); } catch { return undefined; }
		const paths = value.paths;
		if (paths.length === 0 || paths.some((path) => typeof path !== 'string')) return undefined;
		const cache = await this.cacheStorage.open(this.bundleCache(serverId, metadata.bundleId));
		const assets = new Map<string, Uint8Array>();
		for (const path of paths) {
			const asset = await cache.match(this.assetRequest(path));
			if (asset === undefined) return undefined;
			assets.set(path, new Uint8Array(await asset.arrayBuffer()));
		}
		return Object.freeze({ metadata, assets: readonlyAssets(assets) });
	}

	async commit(serverId: string, bundle: VerifiedBrowserBundle): Promise<void> {
		const cacheName = this.bundleCache(serverId, bundle.metadata.bundleId);
		const cache = await this.cacheStorage.open(cacheName);
		try {
			for (const [path, bytes] of bundle.assets)
				await cache.put(this.assetRequest(path), new Response(bytes as BodyInit, { headers: { 'Content-Type': contentType(path) } }));
			const active = await this.cacheStorage.open(`${this.namespace}.active`);
			await active.put(this.metadataRequest(serverId), new Response(JSON.stringify({ metadata: bundle.metadata, paths: [...bundle.assets.keys()] }), { headers: { 'Content-Type': 'application/json' } }));
		} catch (error) {
			await this.cacheStorage.delete(cacheName);
			throw error;
		}
	}

	private metadataRequest(serverId: string): Request { return new Request(`https://terminay.invalid/${this.namespace}/active/${encodeURIComponent(serverId)}`); }
	private assetRequest(path: string): Request { return new Request(`https://terminay.invalid${path}`); }
	private bundleCache(serverId: string, bundleId: string): string { return `${this.namespace}.bundle.${encodeURIComponent(serverId)}.${bundleId}`; }
}

export class BrowserSessionBundleHost {
	constructor(private readonly options: Readonly<{ store: BrowserBundleStore; }>) {}

	async installAndPrepare(input: Readonly<{
		expectedServerId: string;
		sessionOrigin: string;
		context: unknown;
		endpoint: OpaqueBrowserByteEndpoint;
		compressedArchive: Uint8Array;
	}>): Promise<BrowserBundleLaunch> {
		const origin = exactSessionOrigin(input.sessionOrigin);
		const archive = extractTerminayArchive(await decompressTerminayArchive(input.compressedArchive, MAX_COMPRESSED_BYTES));
		const suppliedContext = parseTerminayHostContext(input.context);
		if (
			suppliedContext.hostKind !== 'browser' ||
			suppliedContext.serverId !== input.expectedServerId ||
			suppliedContext.bundleId !== archive.metadata.bundleId ||
			suppliedContext.applicationProtocolVersion !== archive.metadata.applicationProtocolVersion
		) throw new TypeError('browser host context does not match the server UI archive');
		const prefix = `/remote-app/${archive.metadata.bundleId}/`;
		const assets = new Map<string, Uint8Array>();
		for (const entry of archive.entries) assets.set(`${prefix}${entry.path}`, Uint8Array.from(entry.bytes));
		const entryPath = `${prefix}${archive.metadata.entryPath}`;
		if (!assets.has(entryPath)) throw new TypeError('server UI archive entry is missing');
		const bundle = Object.freeze({ metadata: archive.metadata, assets: readonlyAssets(assets) });
		await this.options.store.commit(input.expectedServerId, bundle);
		return Object.freeze({ context: suppliedContext, bundle, entryUrl: new URL(entryPath, origin).toString(), endpoint: input.endpoint });
	}
}

export function createBrowserManagerBundleHost(cacheStorage: CacheStorage): BrowserSessionBundleHost {
	return new BrowserSessionBundleHost({ store: new CacheStorageBrowserBundleStore(cacheStorage, 'terminay.manager-session-archives.v1') });
}

export function createDirectBrowserBundleHost(cacheStorage: CacheStorage): BrowserSessionBundleHost {
	return new BrowserSessionBundleHost({ store: new CacheStorageBrowserBundleStore(cacheStorage, 'terminay.direct-session-archives.v1') });
}

/** No browser brand detection: capability negotiation remains available to the
 * application bridge but is not a server-archive acceptance gate. */
export function negotiateBrowserHostCapabilities(platform: BrowserCapabilityPlatform = browserCapabilityPlatform()): Readonly<Record<'clipboardWrite' | 'notifications', 1 | undefined>> {
	return Object.freeze({
		clipboardWrite: typeof platform.clipboard?.writeText === 'function' ? 1 : undefined,
		notifications: typeof platform.Notification === 'function' ? 1 : undefined,
	});
}

function browserCapabilityPlatform(): BrowserCapabilityPlatform {
	const browser = globalThis as typeof globalThis & { navigator?: { clipboard?: Readonly<{ writeText?: unknown }> }; Notification?: unknown; };
	return Object.freeze({ clipboard: browser.navigator?.clipboard, Notification: browser.Notification });
}
function parseStoredMetadata(value: unknown): TerminayArchiveMetadata {
	// Reuse full archive parser's strict metadata shape without accepting a
	// synthetic file inventory in the cache pointer.
	if (!record(value) || value.archiveFormatVersion !== 1 || typeof value.bundleId !== 'string' || typeof value.entryPath !== 'string' || typeof value.applicationProtocolVersion !== 'string') throw new TypeError('stored archive metadata is invalid');
	return Object.freeze({ archiveFormatVersion: 1, bundleId: value.bundleId, entryPath: value.entryPath, applicationProtocolVersion: value.applicationProtocolVersion });
}
function contentType(path: string): string {
	const lower = path.toLowerCase();
	if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html; charset=utf-8';
	if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
	if (lower.endsWith('.css')) return 'text/css; charset=utf-8';
	if (lower.endsWith('.json') || lower.endsWith('.webmanifest')) return 'application/json; charset=utf-8';
	if (lower.endsWith('.svg')) return 'image/svg+xml';
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.woff2')) return 'font/woff2';
	return 'application/octet-stream';
}
function exactSessionOrigin(value: string): string {
	const parsed = new URL(value);
	const loopback = parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname.endsWith('.localhost'));
	if ((!loopback && parsed.protocol !== 'https:') || parsed.origin !== value || parsed.username || parsed.password) throw new TypeError('browser session origin must be an exact HTTPS or loopback origin');
	return parsed.origin;
}
function readonlyAssets(assets: Map<string, Uint8Array>): ReadonlyMap<string, Uint8Array> { return new Map([...assets].map(([path, bytes]) => [path, Uint8Array.from(bytes)])); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
