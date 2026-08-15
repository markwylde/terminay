import { TERMINAY_MANAGER_ORIGIN } from '@terminay/protocol';
import {
	createHostCapabilityProvider,
	type HostCapabilityProvider,
} from '@terminay/client-core';
import {
	createSharedFileSelectionModel,
	createSharedWorkspaceRouteRenderModel,
	type SharedWorkspaceRoute,
	type SharedWorkspaceRouteRenderModel,
} from '@terminay/responsive-ui';

export {
	BROWSER_BOOTSTRAP_STEPS,
	describeBrowserBootstrapFailure,
	type BrowserBootstrapFailure,
	type BrowserBootstrapStep,
} from './browserBootstrapFailure.js';
export {
	BrowserSessionBundleHost,
	CacheStorageBrowserBundleStore,
	createBrowserSessionBundleHost,
	negotiateBrowserHostCapabilities,
	MemoryBrowserBundleStore,
	type BrowserCapabilityPlatform,
	type BrowserBundleLaunch,
	type BrowserBundleStore,
	type OpaqueBrowserByteEndpoint,
	type VerifiedBrowserBundle,
} from './browserBundleHost.js';
export {
	decompressTerminayArchive,
	extractTerminayArchive,
	parseTerminayArchiveMetadata,
	TERMINAY_ARCHIVE_FORMAT_VERSION,
	TERMINAY_ARCHIVE_METADATA_PATH,
	type ArchiveEntry,
	type ArchiveExtractionLimits,
	type ExtractedTerminayArchive,
	type TerminayArchiveMetadata,
} from './archiveBundle.js';

/** Stable public PWA origin. It stores only connection bookmarks. */
export const WEB_MANAGER_ORIGIN = TERMINAY_MANAGER_ORIGIN;
export const WEB_PROFILE_STORAGE_KEY = 'terminay.web.connection-profiles.v1';

const PROFILE_SCHEMA_VERSION = 1;
const MAX_PROFILES = 128;

export interface WebStorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

/** The complete, one-time URL to hand to the session origin after bookmark
 * persistence. The manager does not retain its fragment. */
export interface PwaPairingNavigation {
	readonly pairingUrl: string;
	readonly profile: PwaConnectionProfile;
}

/** The complete manager persistence contract. No server identity, connection
 * state, URL path, pairing secret, or credential belongs in this record. */
export interface PwaConnectionProfile {
	readonly label: string;
	readonly origin: string;
	readonly createdAt: number;
	readonly lastOpenedAt: number;
}

export interface PwaConnectionManagerSnapshot {
	readonly profiles: readonly PwaConnectionProfile[];
}

export interface PwaConnectionManagerOptions {
	readonly storage?: WebStorageLike;
	readonly now?: () => number;
	readonly maxProfiles?: number;
	readonly navigate?: (url: string, target: '_self' | '_blank') => void;
}

export interface PwaOpenResult {
	readonly profile: PwaConnectionProfile;
	readonly url: string;
	readonly target: '_self' | '_blank';
}

/**
 * Browser-local bookmark manager for app.terminay.com. Session authentication,
 * WebRTC, bundle loading, and every workspace state live at the selected
 * stable session origin.
 */
export class PwaConnectionManager {
	private readonly storage: WebStorageLike | undefined;
	private readonly now: () => number;
	private readonly maxProfiles: number;
	private readonly navigate: ((url: string, target: '_self' | '_blank') => void) | undefined;
	private profiles: PwaConnectionProfile[];

	constructor(options: PwaConnectionManagerOptions = {}) {
		this.storage = options.storage ?? browserStorage();
		this.now = options.now ?? (() => Date.now());
		this.maxProfiles = options.maxProfiles ?? MAX_PROFILES;
		if (!Number.isSafeInteger(this.maxProfiles) || this.maxProfiles < 1 || this.maxProfiles > MAX_PROFILES)
			throw new RangeError(`maxProfiles must be between 1 and ${MAX_PROFILES}`);
		this.navigate = options.navigate;
		this.profiles = this.restore();
	}

	snapshot(): PwaConnectionManagerSnapshot {
		return Object.freeze({ profiles: Object.freeze(this.profiles.map(copyProfile)) });
	}

	/** Save the origin bookmark before same-tab pairing navigation. */
	addPairingUrl(pairingUrl: string, label?: string): PwaPairingNavigation {
		const parsed = parsePwaPairingUrl(pairingUrl);
		const now = validTimestamp(this.now());
		const existingIndex = this.profiles.findIndex((profile) => profile.origin === parsed.origin);
		const profile = Object.freeze({
			label: normalizeLabel(label ?? this.profiles[existingIndex]?.label ?? parsed.hostname),
			origin: parsed.origin,
			createdAt: existingIndex === -1 ? now : this.profiles[existingIndex]!.createdAt,
			lastOpenedAt: now,
		});
		const next = existingIndex === -1
			? [...this.profiles, profile]
			: this.profiles.map((candidate, index) => index === existingIndex ? profile : candidate);
		if (next.length > this.maxProfiles) throw new RangeError('connection bookmark limit reached');
		this.commit(next);
		return Object.freeze({ pairingUrl, profile: copyProfile(profile) });
	}

	/** Navigate only to the stored stable origin, never a pairing URL. */
	open(origin: string, newTab = false): PwaOpenResult {
		const canonicalOrigin = requireStableOrigin(origin);
		const index = this.profiles.findIndex((profile) => profile.origin === canonicalOrigin);
		if (index === -1) throw new Error('unknown connection bookmark');
		const profile = Object.freeze({ ...this.profiles[index]!, lastOpenedAt: validTimestamp(this.now()) });
		this.commit(this.profiles.map((candidate, candidateIndex) => candidateIndex === index ? profile : candidate));
		const target = newTab ? '_blank' : '_self';
		this.navigate?.(profile.origin, target);
		return Object.freeze({ profile: copyProfile(profile), url: profile.origin, target });
	}

	rename(origin: string, label: string): PwaConnectionProfile {
		const canonicalOrigin = requireStableOrigin(origin);
		const index = this.profiles.findIndex((profile) => profile.origin === canonicalOrigin);
		if (index === -1) throw new Error('unknown connection bookmark');
		const profile = Object.freeze({ ...this.profiles[index]!, label: normalizeLabel(label) });
		this.commit(this.profiles.map((candidate, candidateIndex) => candidateIndex === index ? profile : candidate));
		return copyProfile(profile);
	}

	forget(origin: string): boolean {
		const canonicalOrigin = requireStableOrigin(origin);
		const next = this.profiles.filter((profile) => profile.origin !== canonicalOrigin);
		if (next.length === this.profiles.length) return false;
		this.commit(next);
		return true;
	}

	private commit(next: readonly PwaConnectionProfile[]): void {
		const prior = this.profiles;
		this.profiles = next.map(copyProfile);
		try {
			this.storage?.setItem(WEB_PROFILE_STORAGE_KEY, JSON.stringify({
				version: PROFILE_SCHEMA_VERSION,
				profiles: this.profiles,
			}));
		} catch (error) {
			this.profiles = prior;
			throw error;
		}
	}

	private restore(): PwaConnectionProfile[] {
		const encoded = this.storage?.getItem(WEB_PROFILE_STORAGE_KEY);
		if (encoded === null || encoded === undefined) return [];
		try {
			const value: unknown = JSON.parse(encoded);
			if (!isExactRecord(value, ['version', 'profiles']) || value.version !== PROFILE_SCHEMA_VERSION || !Array.isArray(value.profiles)) return [];
			const profiles: PwaConnectionProfile[] = [];
			const origins = new Set<string>();
			for (const candidate of value.profiles) {
				try {
					const profile = parseStoredProfile(candidate);
					if (origins.has(profile.origin) || profiles.length >= this.maxProfiles) continue;
					origins.add(profile.origin);
					profiles.push(profile);
				} catch { /* A malformed bookmark never prevents valid bookmarks restoring. */ }
			}
			return profiles;
		} catch { return []; }
	}
}

/** Validate a pairing URL without returning its secret fragment. */
export function parsePwaPairingUrl(pairingUrl: string): Readonly<{ origin: string; hostname: string }> {
	if (typeof pairingUrl !== 'string' || pairingUrl.length === 0) throw new TypeError('pairing URL is invalid');
	let parsed: URL;
	try { parsed = new URL(pairingUrl); } catch { throw new TypeError('pairing URL is invalid'); }
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash.length < 2 || (parsed.pathname !== '/v1/' && parsed.pathname !== '/v1'))
		throw new TypeError('pairing URL must be a secure v1 URL with a one-time fragment');
	if (parsed.origin === WEB_MANAGER_ORIGIN) throw new TypeError('pairing URL must target a Terminay Server');
	return Object.freeze({ origin: parsed.origin, hostname: parsed.hostname });
}

/** Web keeps file selection in the shared workspace. */
export function createWebFileSelectionActionModel(capabilities: HostCapabilityProvider = createHostCapabilityProvider()) {
	return createSharedFileSelectionModel(capabilities);
}

/** Browser routes remain in-page. */
export function createWebWorkspaceRouteRenderModel(route: SharedWorkspaceRoute): SharedWorkspaceRouteRenderModel {
	return createSharedWorkspaceRouteRenderModel(route);
}

function parseStoredProfile(value: unknown): PwaConnectionProfile {
	if (!isExactRecord(value, ['label', 'origin', 'createdAt', 'lastOpenedAt'])) throw new TypeError('bookmark is invalid');
	return Object.freeze({
		label: normalizeLabel(value.label),
		origin: requireStableOrigin(value.origin),
		createdAt: validTimestamp(value.createdAt),
		lastOpenedAt: validTimestamp(value.lastOpenedAt),
	});
}

function requireStableOrigin(value: unknown): string {
	if (typeof value !== 'string') throw new TypeError('connection origin is invalid');
	let parsed: URL;
	try { parsed = new URL(value); } catch { throw new TypeError('connection origin is invalid'); }
	if (parsed.protocol !== 'https:' || parsed.origin !== value || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin === WEB_MANAGER_ORIGIN)
		throw new TypeError('connection origin must be an exact HTTPS server origin');
	return parsed.origin;
}

function normalizeLabel(value: unknown): string {
	if (typeof value !== 'string') throw new TypeError('connection label is invalid');
	const label = value.trim();
	if (label.length === 0 || label.length > 128 || [...label].some((character) => (character.codePointAt(0) ?? 0) < 0x20 || (character.codePointAt(0) ?? 0) === 0x7f))
		throw new TypeError('connection label is invalid');
	return label;
}

function validTimestamp(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('connection timestamp is invalid');
	return value;
}

function copyProfile(profile: PwaConnectionProfile): PwaConnectionProfile {
	return Object.freeze({ ...profile });
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function browserStorage(): WebStorageLike | undefined {
	try {
		const storage = globalThis.localStorage;
		return storage === undefined ? undefined : storage;
	} catch { return undefined; }
}
