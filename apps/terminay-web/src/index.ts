import {
	type ConnectionProfile,
	type ConnectionProfileInput,
	type ConnectionProfileSnapshot,
	ConnectionProfileStore,
	type ConnectionStatus,
	createHostCapabilityProvider,
	type HostCapabilityProvider,
} from '@terminay/client-core';
import {
	TERMINAY_LEGACY_MANAGER_ORIGIN,
	TERMINAY_WEB_MANAGER_ORIGIN,
} from '@terminay/protocol';
import {
	createResponsiveWorkspaceNavigation,
	createSharedFileSelectionModel,
	createSharedWorkspaceRouteRenderModel,
	type HostBridgeMessage,
	parseHostBridgeMessage,
	type ResponsiveWorkspaceNavigation,
	type SharedWorkspaceRoute,
	type SharedWorkspaceRouteRenderModel,
} from '@terminay/responsive-ui';

export {
	consumeLegacyManagerMigration,
	LEGACY_MANAGER_HANDOFF_PREFIX,
	LEGACY_MANAGER_PENDING_ACK_KEY,
	LEGACY_MANAGER_PROFILE_STORAGE_KEY,
	type LegacyMigrationResult,
	type LegacyMigrationWindow,
	runLegacyManagerMigration,
} from './legacyMigration.js';
export {
	type SimulatedBrowserLifecycleEvent,
	SimulatedBrowserLifecycleHarness,
	type SimulatedBrowserLifecycleHost,
	type SimulatedBrowserSuspendEvent,
} from './simulatedLifecycle.js';
export {
	BrowserHostUpgradeRequiredError,
	BrowserSessionBundleHost,
	CacheStorageBrowserBundleStore,
	createBrowserManagerBundleHost,
	createDirectBrowserBundleHost,
	currentBrowserExecutionRuntime,
	MemoryBrowserBundleStore,
	parseBrowserBundleManifest,
	type BrowserBundleLaunch,
	type BrowserBundleStore,
	type OpaqueBrowserByteEndpoint,
	type VerifiedBrowserBundle,
} from './browserBundleHost.js';

/** Stable manager origin used by the hosted connection shell. */
export const WEB_MANAGER_ORIGIN = TERMINAY_WEB_MANAGER_ORIGIN;
export const LEGACY_WEB_MANAGER_ORIGIN = TERMINAY_LEGACY_MANAGER_ORIGIN;
export const WEB_PROFILE_STORAGE_KEY = 'terminay.web.connection-profiles.v1';

const RECONNECT_VAULT_DATABASE = 'terminay.web.reconnect.v1';
const RECONNECT_VAULT_STORE = 'credentials';
const RECONNECT_HKDF_INFO = 'terminay remote v1 reconnect proof verifier';
const RECONNECT_CHALLENGE_DOMAIN =
	'terminay\u0000v1\u0000remote-reconnect-challenge\u0000';

export interface OriginBoundReconnectCredential {
	readonly origin: string;
	readonly handle: string;
	readonly signingOrigin: string;
}

export interface ReversibleReconnectEnrollment {
	readonly credential: OriginBoundReconnectCredential;
	/** Restores the credential replaced by this enrollment. The rollback is
	 * conditional, so it cannot overwrite a newer enrollment from another tab. */
	rollback(): Promise<void>;
}

interface StoredReconnectCredential extends OriginBoundReconnectCredential {
	/** Changes with every enrollment so a proof started by an older pairing can
	 * never be returned after that pairing has been replaced or forgotten. */
	readonly credentialId: string;
	readonly key: CryptoKey;
}

/** Origin-bound durable proof-key storage. The pairing grant is used once to
 * derive a non-extractable HMAC key, then is discarded. This is intentionally
 * separate from connection-profile localStorage. */
export interface WebReconnectVault {
	enroll(input: {
		readonly origin: string;
		readonly handle: string;
		readonly grant: string;
		readonly signingOrigin: string;
	}): Promise<OriginBoundReconnectCredential>;
	enrollReversibly(input: {
		readonly origin: string;
		readonly handle: string;
		readonly grant: string;
		readonly signingOrigin: string;
	}): Promise<ReversibleReconnectEnrollment>;
	credential(
		origin: string,
	): Promise<OriginBoundReconnectCredential | undefined>;
	sign(input: {
		readonly origin: string;
		readonly handle: string;
		readonly signingInput: string;
	}): Promise<string>;
	forget(origin: string): Promise<void>;
}

/** Coordinates the two browser persistence authorities. Profile metadata is
 * not reported as saved unless reconnect material has committed, and a failed
 * metadata write restores the exact credential that a re-pair replaced. */
export async function commitPairedWebConnection<T>(options: Readonly<{
	vault: WebReconnectVault;
	enrollment: Readonly<{
		origin: string;
		handle: string;
		grant: string;
		signingOrigin: string;
	}>;
	persistProfile(): T;
}>): Promise<T> {
	const enrollment = await options.vault.enrollReversibly(options.enrollment);
	try {
		return options.persistProfile();
	} catch (cause) {
		await enrollment.rollback();
		throw cause;
	}
}

/** Browser implementation backed by IndexedDB. No in-memory fallback is used
 * in production: if durable browser storage is unavailable, the host reports
 * that rather than pretending a pairing will survive a reload. */
export class IndexedDbWebReconnectVault implements WebReconnectVault {
	private database: Promise<IDBDatabase> | undefined;

	constructor(
		private readonly indexedDb: IDBFactory | undefined = typeof indexedDB ===
		'undefined'
			? undefined
			: indexedDB,
		private readonly cryptoApi: Crypto | undefined = typeof crypto ===
		'undefined'
			? undefined
			: crypto,
	) {}

	async enroll(input: {
		readonly origin: string;
		readonly handle: string;
		readonly grant: string;
		readonly signingOrigin: string;
	}): Promise<OriginBoundReconnectCredential> {
		return (await this.enrollReversibly(input)).credential;
	}

	async enrollReversibly(input: {
		readonly origin: string;
		readonly handle: string;
		readonly grant: string;
		readonly signingOrigin: string;
	}): Promise<ReversibleReconnectEnrollment> {
		const origin = requireReconnectOrigin(input.origin);
		const signingOrigin = requireReconnectSigningOrigin(input.signingOrigin);
		if (!isReconnectHandle(input.handle) || !isReconnectGrant(input.grant))
			throw new TypeError('reconnect enrollment is invalid');
		const key = await deriveReconnectProofKey(
			this.requireCrypto(),
			input.grant,
		);
		const replacement = {
			origin,
			handle: input.handle,
			signingOrigin,
			credentialId: createReconnectCredentialId(this.requireCrypto()),
			key,
		};
		const previous = await this.get(origin);
		await this.put(replacement);
		return Object.freeze({
			credential: Object.freeze({ origin, handle: input.handle, signingOrigin }),
			rollback: async () => {
				const current = await this.get(origin);
				if (current?.credentialId !== replacement.credentialId) return;
				if (previous === undefined) await this.forget(origin);
				else await this.put(previous);
			},
		});
	}

	async sign(input: {
		readonly origin: string;
		readonly handle: string;
		readonly signingInput: string;
	}): Promise<string> {
		const origin = requireReconnectOrigin(input.origin);
		if (!isReconnectHandle(input.handle))
			throw new TypeError('reconnect proof request is invalid');
		const credential = await this.get(origin);
		if (credential === undefined || credential.handle !== input.handle)
			throw new Error('reconnect credential is unavailable for this server');
		if (
			!isReconnectSigningInput(
				input.signingInput,
				credential.signingOrigin,
				input.handle,
			)
		)
			throw new TypeError('reconnect proof request is invalid');
		const signature = await this.requireCrypto().subtle.sign(
			'HMAC',
			credential.key,
			new TextEncoder().encode(input.signingInput),
		);
		/* Enrollment/forget can run in another browser tab while WebCrypto signs.
		 * Re-read the durable record before disclosing the proof so a stale key
		 * cannot complete an already-replaced pairing. */
		const current = await this.get(origin);
		if (
			current === undefined ||
			current.handle !== credential.handle ||
			current.credentialId !== credential.credentialId
		) {
			throw new Error('reconnect credential changed while signing');
		}
		return base64url(new Uint8Array(signature));
	}

	async credential(
		origin: string,
	): Promise<OriginBoundReconnectCredential | undefined> {
		const credential = await this.get(requireReconnectOrigin(origin));
		return credential === undefined
			? undefined
			: Object.freeze({
					origin: credential.origin,
					handle: credential.handle,
					signingOrigin: credential.signingOrigin,
				});
	}

	async forget(origin: string): Promise<void> {
		const database = await this.open();
		await transaction(database, 'readwrite', (store) => {
			for (const candidate of reconnectOriginAliases(
				requireReconnectOrigin(origin),
			))
				store.delete(candidate);
		});
	}

	private async get(
		origin: string,
	): Promise<StoredReconnectCredential | undefined> {
		const database = await this.open();
		for (const candidate of reconnectOriginAliases(origin)) {
			const value = await requestValue<unknown>(
				database
					.transaction(RECONNECT_VAULT_STORE, 'readonly')
					.objectStore(RECONNECT_VAULT_STORE)
					.get(candidate),
			);
			if (!isStoredReconnectCredential(value, candidate)) {
				if (value !== undefined)
					await transaction(database, 'readwrite', (store) => {
						store.delete(candidate);
					});
				continue;
			}
			if (candidate !== origin) {
				const migrated = { ...value, origin };
				await this.put(migrated);
				await transaction(database, 'readwrite', (store) => {
					store.delete(candidate);
				});
				return migrated;
			}
			return value;
		}
		return undefined;
	}

	private async put(credential: StoredReconnectCredential): Promise<void> {
		const database = await this.open();
		await transaction(database, 'readwrite', (store) => {
			store.put(credential);
		});
	}

	private open(): Promise<IDBDatabase> {
		if (this.indexedDb === undefined)
			throw new Error(
				'durable reconnect storage is unavailable in this browser',
			);
		this.database ??= new Promise((resolve, reject) => {
			const request = this.indexedDb!.open(RECONNECT_VAULT_DATABASE, 1);
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(RECONNECT_VAULT_STORE))
					request.result.createObjectStore(RECONNECT_VAULT_STORE, {
						keyPath: 'origin',
					});
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () =>
				reject(request.error ?? new Error('unable to open reconnect storage'));
			request.onblocked = () =>
				reject(new Error('reconnect storage is blocked'));
		});
		return this.database;
	}

	private requireCrypto(): Crypto {
		if (this.cryptoApi === undefined || this.cryptoApi.subtle === undefined)
			throw new Error('WebCrypto is unavailable in this browser');
		return this.cryptoApi;
	}
}

/** Test-friendly volatile vault. Production code must use IndexedDB above. */
export class MemoryWebReconnectVault implements WebReconnectVault {
	private readonly credentials = new Map<string, StoredReconnectCredential>();

	constructor(private readonly cryptoApi: Crypto = crypto) {}

	async enroll(input: {
		readonly origin: string;
		readonly handle: string;
		readonly grant: string;
		readonly signingOrigin: string;
	}): Promise<OriginBoundReconnectCredential> {
		return (await this.enrollReversibly(input)).credential;
	}

	async enrollReversibly(input: {
		readonly origin: string;
		readonly handle: string;
		readonly grant: string;
		readonly signingOrigin: string;
	}): Promise<ReversibleReconnectEnrollment> {
		const origin = requireReconnectOrigin(input.origin);
		const signingOrigin = requireReconnectSigningOrigin(input.signingOrigin);
		if (!isReconnectHandle(input.handle) || !isReconnectGrant(input.grant))
			throw new TypeError('reconnect enrollment is invalid');
		const previous = this.credentials.get(origin);
		const replacement = {
			origin,
			handle: input.handle,
			signingOrigin,
			credentialId: createReconnectCredentialId(this.cryptoApi),
			key: await deriveReconnectProofKey(this.cryptoApi, input.grant),
		};
		this.credentials.set(origin, replacement);
		return Object.freeze({
			credential: Object.freeze({ origin, handle: input.handle, signingOrigin }),
			rollback: async () => {
				if (this.credentials.get(origin)?.credentialId !== replacement.credentialId)
					return;
				if (previous === undefined) this.credentials.delete(origin);
				else this.credentials.set(origin, previous);
			},
		});
	}

	async sign(input: {
		readonly origin: string;
		readonly handle: string;
		readonly signingInput: string;
	}): Promise<string> {
		const origin = requireReconnectOrigin(input.origin);
		const credential = this.credentials.get(origin);
		if (
			credential === undefined ||
			credential.handle !== input.handle ||
			!isReconnectSigningInput(
				input.signingInput,
				credential.signingOrigin,
				input.handle,
			)
		)
			throw new Error('reconnect credential is unavailable for this server');
		const signature = await this.cryptoApi.subtle.sign(
			'HMAC',
			credential.key,
			new TextEncoder().encode(input.signingInput),
		);
		const current = this.credentials.get(origin);
		if (
			current === undefined ||
			current.handle !== credential.handle ||
			current.credentialId !== credential.credentialId
		) {
			throw new Error('reconnect credential changed while signing');
		}
		return base64url(new Uint8Array(signature));
	}

	async credential(
		origin: string,
	): Promise<OriginBoundReconnectCredential | undefined> {
		const credential = this.credentials.get(requireReconnectOrigin(origin));
		return credential === undefined
			? undefined
			: Object.freeze({
					origin: credential.origin,
					handle: credential.handle,
					signingOrigin: credential.signingOrigin,
				});
	}

	async forget(origin: string): Promise<void> {
		this.credentials.delete(requireReconnectOrigin(origin));
	}
}

/** Web keeps file selection in the shared workspace. The same model is used
 * by Desktop, but a browser host does not invent a native dialog capability. */
export function createWebFileSelectionActionModel(
	capabilities: HostCapabilityProvider = createHostCapabilityProvider(),
) {
	return createSharedFileSelectionModel(capabilities);
}

export interface WebStorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface WebConnectionHostOptions {
	/** Browser hosts never create an embedded Local server. */
	readonly storage?: WebStorageLike;
	readonly now?: () => number;
	readonly maxProfiles?: number;
	readonly managerOrigin?: string;
	readonly openWindow?: (url: string, target: '_self' | '_blank') => void;
}

export interface WebConnectionHostSnapshot {
	readonly mode: 'disconnected' | 'connected';
	readonly managerOrigin: string;
	readonly profiles: ConnectionProfileSnapshot;
	readonly current?: ConnectionProfile;
}

export interface WebOpenOptions {
	readonly route?: SharedWorkspaceRoute;
	readonly projectId?: string;
	readonly viewId?: string;
	readonly panelId?: string;
	readonly newTab?: boolean;
}

export interface WebOpenResult {
	readonly profile: ConnectionProfile;
	readonly navigation: ResponsiveWorkspaceNavigation;
	readonly url: string;
	readonly target: '_self' | '_blank';
}

export interface WebManagerMigrationResult {
	readonly sourceOrigin: typeof LEGACY_WEB_MANAGER_ORIGIN;
	readonly destinationOrigin: string;
	readonly profiles: readonly ConnectionProfile[];
}

/** Web renders every shared route in-page. The route component and semantic
 * regions come from the shared package; this adapter only fixes the web host
 * presentation policy. */
export function createWebWorkspaceRouteRenderModel(
	route: SharedWorkspaceRoute,
): SharedWorkspaceRouteRenderModel {
	return createSharedWorkspaceRouteRenderModel(route);
}

/**
 * Browser connection manager. Only the profile metadata listed by the
 * ConnectionProfileStore is persisted; credentials and origin-local keys stay
 * on the selected server origin and never enter this manager's storage.
 */
export class WebConnectionHost {
	readonly profiles: ConnectionProfileStore;
	readonly managerOrigin: string;
	private readonly storage: WebStorageLike | undefined;
	private readonly openWindow:
		| ((url: string, target: '_self' | '_blank') => void)
		| undefined;
	private readonly maxProfiles: number;

	constructor(options: WebConnectionHostOptions = {}) {
		this.managerOrigin = requireManagerOrigin(
			options.managerOrigin ?? WEB_MANAGER_ORIGIN,
		);
		this.storage = options.storage ?? browserStorage();
		this.openWindow = options.openWindow;
		this.maxProfiles = options.maxProfiles ?? 128;
		this.profiles = new ConnectionProfileStore({
			local: false,
			...(options.now === undefined ? {} : { now: options.now }),
			...(options.maxProfiles === undefined
				? {}
				: { maxProfiles: options.maxProfiles }),
		});
		this.restore();
	}

	snapshot(): WebConnectionHostSnapshot {
		const profiles = this.profiles.snapshot();
		const current = this.profiles.currentProfile;
		return Object.freeze({
			mode:
				current === undefined
					? 'disconnected'
					: connectionIsUsable(current)
						? 'connected'
						: 'disconnected',
			managerOrigin: this.managerOrigin,
			profiles,
			...(current === undefined ? {} : { current }),
		});
	}

	/** Add an explicitly sanitized profile, then persist only metadata. */
	addConnection(input: ConnectionProfileInput): ConnectionProfile {
		const origin = requireSessionOrigin(input.origin);
		const existing = this.profiles
			.snapshot()
			.profiles.find((profile) => profile.origin === origin);
		const authenticatingProvisionalProfile =
			existing?.status === 'connecting' && input.status === 'connected';
		if (
			existing !== undefined &&
			existing.serverId !== input.serverId &&
			!authenticatingProvisionalProfile
		) {
			throw new TypeError(
				'saved server identity does not match its canonical origin',
			);
		}
		const profile = this.profiles.remember({
			...input,
			origin,
			isLocal: false,
			...(existing === undefined
				? {}
				: { id: existing.id, archived: existing.archived }),
		});
		try {
			this.persist();
		} catch (cause) {
			// localStorage can fail after the in-memory store has accepted the
			// profile (quota, blocked storage, browser shutdown). Restore the exact
			// prior projection so callers cannot observe a metadata-only success.
			if (existing === undefined) this.profiles.forget(profile.id, true);
			else this.profiles.remember(existing);
			throw cause;
		}
		return profile;
	}

	/** Import metadata from a picker or deep-link handler without accepting
	 * pairing fragments, credentials, terminal fields, or project paths. */
	importConnection(value: unknown): ConnectionProfile {
		/* Validate untrusted imported metadata with the strict profile parser in
		 * an isolated store. Actual insertion then uses the canonical-origin
		 * upsert, so one origin cannot acquire competing saved identities while
		 * its reconnect credential remains origin-bound. */
		const imported = new ConnectionProfileStore({
			local: false,
			maxProfiles: 1,
		}).import(value);
		if (imported.isLocal === true)
			throw new TypeError('web host cannot import a Local profile');
		return this.addConnection(imported);
	}

	/**
	 * Consume a one-time pairing URL in memory. The fragment is deliberately
	 * never returned, persisted, logged, or included in the resulting session
	 * URL; a caller performs the protocol pairing against the exact origin.
	 */
	consumePairingUrl(
		rawUrl: string,
		metadata: Omit<ConnectionProfileInput, 'origin'>,
	): ConnectionProfile {
		const parsed = parseSessionOrigin(rawUrl);
		if (parsed.hash.length === 0)
			throw new TypeError('pairing URL has no one-time fragment');
		const profile = this.addConnection({ ...metadata, origin: parsed.origin });
		parsed.hash = '';
		return profile;
	}

	open(profileId: string, options: WebOpenOptions = {}): WebOpenResult {
		const existing = this.profiles.get(profileId);
		if (existing === undefined)
			throw new Error(`unknown connection profile: ${profileId}`);
		if (existing?.archived === true)
			throw new Error('archived connection profile cannot be opened');
		if (existing.isLocal === true)
			throw new Error('web host cannot open a Local profile');
		const navigation = createResponsiveWorkspaceNavigation({
			...(options.route === undefined ? {} : { route: options.route }),
			...(options.projectId === undefined
				? {}
				: { projectId: options.projectId }),
			...(options.viewId === undefined ? {} : { viewId: options.viewId }),
			...(options.panelId === undefined ? {} : { panelId: options.panelId }),
		});
		const profile = this.profiles.select(profileId);
		const url = sessionUrl(profile.origin, navigation);
		const target = options.newTab === true ? '_blank' : '_self';
		this.openWindow?.(url, target);
		this.persist();
		return Object.freeze({ profile, navigation, url, target });
	}

	/** Open the manager itself from a direct server session without sharing a
	 * secret or a session-origin credential. */
	openManager(newTab = false): string {
		const target = newTab ? '_blank' : '_self';
		this.openWindow?.(this.managerOrigin, target);
		return this.managerOrigin;
	}

	/** Import the legacy manager's non-secret profile metadata and return the
	 * stable manager destination. Session-origin grants remain at their exact
	 * server origin; pairing fragments and credential-bearing fields are never
	 * accepted into this manager store. */
	migrateLegacyManagerRecord(
		value: unknown,
		options: {
			readonly sourceOrigin?: string;
			readonly maxProfiles?: number;
		} = {},
	): WebManagerMigrationResult {
		const sourceOrigin = options.sourceOrigin ?? LEGACY_WEB_MANAGER_ORIGIN;
		if (sourceOrigin !== LEGACY_WEB_MANAGER_ORIGIN)
			throw new TypeError('legacy manager origin is not supported');
		if (!isRecord(value) || !Array.isArray(value.profiles))
			throw new TypeError('legacy manager record is invalid');
		const maxProfiles = options.maxProfiles ?? 1024;
		if (
			!Number.isSafeInteger(maxProfiles) ||
			maxProfiles < 1 ||
			maxProfiles > 1024
		)
			throw new RangeError('legacy manager profile limit is invalid');
		if (value.profiles.length > maxProfiles)
			throw new RangeError('legacy manager profile count exceeds the limit');
		const pending: ConnectionProfileInput[] = [];
		const ids = new Set<string>();
		const origins = new Set<string>();
		for (const candidate of value.profiles) {
			if (
				!isRecord(candidate) ||
				typeof candidate.id !== 'string' ||
				typeof candidate.serverId !== 'string' ||
				typeof candidate.label !== 'string' ||
				typeof candidate.origin !== 'string'
			)
				throw new TypeError('legacy manager profile is invalid');
			if (candidate.kind === 'local' || candidate.isLocal === true) continue;
			if (ids.has(candidate.id))
				throw new TypeError('legacy manager profile ids must be unique');
			ids.add(candidate.id);
			const origin = requireSessionOrigin(candidate.origin);
			if (origins.has(origin))
				throw new TypeError('legacy manager profile origins must be unique');
			origins.add(origin);
			if (
				!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate.id) ||
				!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate.serverId)
			)
				throw new TypeError('legacy manager profile identity is invalid');
			if (
				candidate.label.trim().length === 0 ||
				candidate.label.length > 128 ||
				hasControlCharacter(candidate.label)
			)
				throw new TypeError('legacy manager profile label is invalid');
			const status = legacyStatus(candidate.status);
			pending.push({
				id: candidate.id,
				serverId: candidate.serverId,
				label: candidate.label,
				origin,
				status,
				...(typeof candidate.createdAt === 'number'
					? { createdAt: candidate.createdAt }
					: {}),
				...(typeof candidate.lastOpenedAt === 'number'
					? { lastOpenedAt: candidate.lastOpenedAt }
					: {}),
				...(typeof candidate.lastConnectedAt === 'number'
					? { lastConnectedAt: candidate.lastConnectedAt }
					: {}),
				...(candidate.archived === true ? { archived: true } : {}),
				isLocal: false,
			});
		}
		const existingProfiles = this.profiles.snapshot().profiles;
		const existingIds = new Set(existingProfiles.map((profile) => profile.id));
		for (const profile of pending) {
			const byId = existingProfiles.find((existing) => existing.id === profile.id);
			if (byId !== undefined && byId.origin !== profile.origin)
				throw new TypeError(
					'legacy manager profile identity does not match its saved origin',
				);
			const byOrigin = existingProfiles.find(
				(existing) => existing.origin === profile.origin,
			);
			if (byOrigin !== undefined && byOrigin.serverId !== profile.serverId)
				throw new TypeError(
					'legacy manager profile server does not match its saved origin',
				);
		}
		const newCount = pending.reduce(
			(count, profile) =>
				count +
				(profile.id !== undefined && existingIds.has(profile.id) ? 0 : 1),
			0,
		);
		if (existingIds.size + newCount > this.maxProfiles)
			throw new RangeError('legacy manager profiles exceed the host limit');
		const imported = pending.map((profile) => this.addConnection(profile));
		return Object.freeze({
			sourceOrigin: LEGACY_WEB_MANAGER_ORIGIN,
			destinationOrigin: this.managerOrigin,
			profiles: Object.freeze(imported),
		});
	}

	retry(profileId: string): ConnectionProfile {
		const profile = this.profiles.markStatus(profileId, 'connecting');
		this.persist();
		return profile;
	}
	markStatus(profileId: string, status: ConnectionStatus): ConnectionProfile {
		const profile = this.profiles.markStatus(profileId, status);
		this.persist();
		return profile;
	}
	disconnect(profileId: string): ConnectionProfile {
		const profile = this.profiles.disconnect(profileId);
		this.persist();
		return profile;
	}
	archive(profileId: string, confirmed = false): ConnectionProfile {
		const prior = this.profiles.get(profileId);
		if (prior === undefined)
			throw new Error(`unknown connection profile: ${profileId}`);
		if (prior.isLocal === true)
			throw new Error('the Local profile cannot be archived');
		if (!confirmed) throw new Error('archive requires confirmation');
		const profile = this.profiles.remember({
			...prior,
			archived: true,
			status: 'offline',
		});
		this.persist();
		return profile;
	}
	unarchive(profileId: string): ConnectionProfile {
		const prior = this.profiles.get(profileId);
		if (prior === undefined)
			throw new Error(`unknown connection profile: ${profileId}`);
		const profile = this.profiles.remember({
			...prior,
			archived: false,
			status: 'offline',
		});
		this.persist();
		return profile;
	}
	forget(profileId: string, confirmed = false): boolean {
		const forgotten = this.profiles.forget(profileId, confirmed);
		this.persist();
		return forgotten;
	}
	revoke(profileId: string, confirmed = false): ConnectionProfile {
		const profile = this.profiles.revoke(profileId, confirmed);
		this.persist();
		return profile;
	}
	rename(profileId: string, label: string): ConnectionProfile {
		const profile = this.profiles.rename(profileId, label);
		this.persist();
		return profile;
	}

	private restore(): void {
		const encoded = this.storage?.getItem(WEB_PROFILE_STORAGE_KEY);
		if (encoded === null || encoded === undefined) return;
		try {
			const parsed: unknown = JSON.parse(encoded);
			if (
				!isRecord(parsed) ||
				parsed.version !== 1 ||
				!Array.isArray(parsed.profiles)
			)
				return;
			const restoredOrigins = new Map<string, string>();
			const restoredIdAliases = new Map<string, string>();
			const restoredIds = new Set<string>();
			for (const candidate of parsed.profiles) {
				try {
					if (!isRecord(candidate)) continue;
					/* Validate through the same strict metadata parser used for imports
					 * before applying browser-host invariants. A stale/corrupt record
					 * must not recreate competing saved identities for an origin whose
					 * reconnect proof is origin-bound. */
					const restored = new ConnectionProfileStore({
						local: false,
						maxProfiles: 1,
					}).import(candidate);
					if (restored.isLocal === true || restoredIds.has(restored.id))
						continue;
					const origin = requireSessionOrigin(restored.origin);
					const existingId = restoredOrigins.get(origin);
					if (existingId !== undefined) {
						restoredIdAliases.set(restored.id, existingId);
						continue;
					}
					this.profiles.remember({
						...restored,
						origin,
						isLocal: false,
					});
					restoredIds.add(restored.id);
					restoredOrigins.set(origin, restored.id);
				} catch {
					// Ignore one malformed profile without preventing healthy entries
					// from being recovered from the host-local store.
				}
			}
			if (typeof parsed.currentProfileId === 'string') {
				const currentId =
					restoredIdAliases.get(parsed.currentProfileId) ??
					parsed.currentProfileId;
				if (this.profiles.get(currentId) !== undefined)
					this.profiles.select(currentId);
			}
		} catch {
			// A corrupt manager record is equivalent to an empty disconnected host.
		}
	}

	private persist(): void {
		if (this.storage === undefined) return;
		const snapshot = this.profiles.snapshot();
		this.storage.setItem(
			WEB_PROFILE_STORAGE_KEY,
			JSON.stringify({
				version: 1,
				currentProfileId: snapshot.currentProfileId,
				profiles: snapshot.profiles,
			}),
		);
	}
}

export interface WebMessageEventLike {
	readonly origin: string;
	readonly source: unknown;
	readonly data: unknown;
}

export interface WebMessageTargetLike {
	postMessage(message: unknown, targetOrigin: string): void;
}

export interface WebHostBridgeOptions {
	readonly managerOrigin?: string;
	readonly workspaceOrigin: string;
	readonly workspaceSource: unknown;
}

/** Strict source/origin checked browser host bridge. */
export class WebHostBridge {
	readonly managerOrigin: string;
	readonly workspaceOrigin: string;
	private readonly workspaceSource: unknown;

	constructor(options: WebHostBridgeOptions) {
		this.managerOrigin = requireManagerOrigin(
			options.managerOrigin ?? WEB_MANAGER_ORIGIN,
		);
		this.workspaceOrigin = requireSessionOrigin(options.workspaceOrigin);
		this.workspaceSource = options.workspaceSource;
	}

	receive(event: WebMessageEventLike): HostBridgeMessage | undefined {
		if (
			event.origin !== this.workspaceOrigin ||
			event.source !== this.workspaceSource
		)
			return undefined;
		return parseHostBridgeMessage(event.data);
	}

	send(target: WebMessageTargetLike, message: HostBridgeMessage): void {
		if (target !== this.workspaceSource)
			throw new Error('host bridge target window mismatch');
		if (parseHostBridgeMessage(message) === undefined)
			throw new TypeError('host bridge message is invalid');
		target.postMessage(message, this.workspaceOrigin);
	}
}

export function sessionUrl(
	origin: string,
	navigation: ResponsiveWorkspaceNavigation,
): string {
	const url = new URL('/', requireSessionOrigin(origin));
	url.searchParams.set('route', navigation.route);
	if (navigation.projectId !== undefined)
		url.searchParams.set('project', navigation.projectId);
	if (navigation.viewId !== undefined)
		url.searchParams.set('view', navigation.viewId);
	if (navigation.panelId !== undefined)
		url.searchParams.set('panel', navigation.panelId);
	url.hash = '';
	return url.toString();
}

function connectionIsUsable(profile: ConnectionProfile): boolean {
	return profile.archived !== true && profile.status === 'connected';
}

function legacyStatus(value: unknown): ConnectionStatus {
	if (
		value === 'connected' ||
		value === 'connecting' ||
		value === 'offline' ||
		value === 'relay-unavailable' ||
		value === 'webrtc-failed' ||
		value === 'expired' ||
		value === 'revoked' ||
		value === 'identity-mismatch' ||
		value === 'incompatible' ||
		value === 'unreachable'
	)
		return value;
	return 'offline';
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code < 0x20 || code === 0x7f;
	});
}

function parseSessionOrigin(rawUrl: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new TypeError('pairing URL is invalid');
	}
	if (!isAllowedSessionProtocol(parsed))
		throw new TypeError('pairing URL must use HTTPS or loopback HTTP');
	if (parsed.username || parsed.password || parsed.search)
		throw new TypeError('pairing URL contains credentials or query data');
	return parsed;
}

function requireManagerOrigin(value: string): string {
	const parsed = parseOrigin(value, 'manager origin');
	if (parsed.protocol !== 'https:')
		throw new TypeError('manager origin must use HTTPS');
	return parsed.origin;
}

function requireReconnectOrigin(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new TypeError('reconnect origin is invalid');
	}
	const loopback = isLoopbackHostname(parsed.hostname);
	if (
		(parsed.protocol !== 'https:' &&
			!(parsed.protocol === 'http:' && loopback)) ||
		parsed.origin !== value ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash
	) {
		throw new TypeError(
			'reconnect origin must be an exact HTTPS or loopback HTTP origin',
		);
	}
	return canonicalBrowserServerOrigin(parsed);
}

function isReconnectOrigin(value: string): boolean {
	try {
		requireReconnectOrigin(value);
		return true;
	} catch {
		return false;
	}
}

function requireReconnectSigningOrigin(value: string): string {
	requireReconnectOrigin(value);
	return new URL(value).origin;
}

function reconnectOriginAliases(origin: string): readonly string[] {
	const parsed = new URL(origin);
	if (parsed.protocol !== 'http:' || !isLoopbackAddressAlias(parsed.hostname))
		return [origin];
	const port = parsed.port === '' ? '' : `:${parsed.port}`;
	return [
		`http://localhost${port}`,
		`http://127.0.0.1${port}`,
		`http://[::1]${port}`,
	];
}

function isReconnectHandle(value: string): boolean {
	return (
		value.length >= 32 && value.length <= 512 && /^[A-Za-z0-9_-]+$/u.test(value)
	);
}

function isReconnectGrant(value: string): boolean {
	return (
		value.length >= 16 && value.length <= 512 && /^[A-Za-z0-9_-]+$/u.test(value)
	);
}

function createReconnectCredentialId(cryptoApi: Crypto): string {
	const bytes = new Uint8Array(18);
	cryptoApi.getRandomValues(bytes);
	return base64url(bytes);
}

/**
 * The proof key is deliberately non-extractable, but that alone is not enough:
 * accepting an arbitrary string here would still make it a signing oracle for
 * any script that can reach this client boundary. Only the canonical v1
 * reconnect challenge for this exact origin and credential handle is allowed.
 */
function isReconnectSigningInput(
	value: string,
	origin: string,
	handle: string,
): boolean {
	if (
		value.length < RECONNECT_CHALLENGE_DOMAIN.length + 32 ||
		value.length > 4096 ||
		!value.startsWith(RECONNECT_CHALLENGE_DOMAIN)
	)
		return false;
	let payload: unknown;
	try {
		payload = JSON.parse(value.slice(RECONNECT_CHALLENGE_DOMAIN.length));
	} catch {
		return false;
	}
	if (!isRecord(payload)) return false;
	const keys = Object.keys(payload).sort();
	const expectedKeys = [
		'action',
		'attemptId',
		'clientNonce',
		'expiresAt',
		'handle',
		'issuedAt',
		'nonce',
		'origin',
		'protocolVersion',
		'serverId',
	];
	if (
		keys.length !== expectedKeys.length ||
		keys.some((key, index) => key !== expectedKeys[index])
	)
		return false;
	const {
		action,
		attemptId,
		clientNonce,
		expiresAt,
		handle: challengeHandle,
		issuedAt,
		nonce,
		origin: challengeOrigin,
		protocolVersion,
		serverId,
	} = payload;
	if (
		action !== 'reconnect' ||
		protocolVersion !== 'v1' ||
		challengeOrigin !== origin ||
		challengeHandle !== handle ||
		!isProtocolIdentifier(serverId) ||
		!isProtocolIdentifier(attemptId) ||
		!isClientReconnectNonce(clientNonce) ||
		!isServerReconnectNonce(nonce) ||
		!isSafeInteger(issuedAt) ||
		!isSafeInteger(expiresAt) ||
		expiresAt <= issuedAt
	)
		return false;
	// JSON.parse accepts whitespace, a different key order, and duplicate keys.
	// The server verifies its own exact serialization, so reject all of those
	// non-canonical representations before WebCrypto sees the request.
	return (
		value ===
		`${RECONNECT_CHALLENGE_DOMAIN}${JSON.stringify({
			action,
			attemptId,
			clientNonce,
			expiresAt,
			handle: challengeHandle,
			issuedAt,
			nonce,
			origin: challengeOrigin,
			protocolVersion,
			serverId,
		})}`
	);
}

function isProtocolIdentifier(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
	);
}

function isClientReconnectNonce(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9_-]{8,256}$/u.test(value);
}

function isServerReconnectNonce(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9_-]{16,512}$/u.test(value);
}

function isSafeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value);
}

async function deriveReconnectProofKey(
	cryptoApi: Crypto,
	grant: string,
): Promise<CryptoKey> {
	const material = await cryptoApi.subtle.importKey(
		'raw',
		toArrayBuffer(base64urlBytes(grant)),
		'HKDF',
		false,
		['deriveKey'],
	);
	return cryptoApi.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new ArrayBuffer(0),
			info: toArrayBuffer(new TextEncoder().encode(RECONNECT_HKDF_INFO)),
		},
		material,
		{ name: 'HMAC', hash: 'SHA-256', length: 256 },
		false,
		['sign'],
	);
}

function base64urlBytes(value: string): Uint8Array {
	if (!isReconnectGrant(value))
		throw new TypeError('reconnect grant is invalid');
	const padded = `${value.replace(/-/gu, '+').replace(/_/gu, '/')}${'='.repeat((4 - (value.length % 4)) % 4)}`;
	if (typeof atob !== 'function')
		throw new Error('base64 decoding is unavailable in this browser');
	const binary = atob(padded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64url(value: Uint8Array): string {
	let binary = '';
	for (const byte of value) binary += String.fromCharCode(byte);
	if (typeof btoa !== 'function')
		throw new Error('base64 encoding is unavailable in this browser');
	const encoded = btoa(binary);
	return encoded.replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
	return value.buffer.slice(
		value.byteOffset,
		value.byteOffset + value.byteLength,
	) as ArrayBuffer;
}

function isStoredReconnectCredential(
	value: unknown,
	origin: string,
): value is StoredReconnectCredential {
	return (
		value !== null &&
		typeof value === 'object' &&
		(value as { origin?: unknown }).origin === origin &&
		typeof (value as { handle?: unknown }).handle === 'string' &&
		isReconnectHandle((value as { handle: string }).handle) &&
		typeof (value as { signingOrigin?: unknown }).signingOrigin === 'string' &&
		isReconnectOrigin((value as { signingOrigin: string }).signingOrigin) &&
		typeof (value as { credentialId?: unknown }).credentialId === 'string' &&
		isReconnectCredentialId((value as { credentialId: string }).credentialId) &&
		isReconnectProofKey((value as { key?: unknown }).key)
	);
}

function isReconnectCredentialId(value: string): boolean {
	return value.length === 24 && /^[A-Za-z0-9_-]+$/u.test(value);
}

function isReconnectProofKey(value: unknown): value is CryptoKey {
	if (value === null || typeof value !== 'object') return false;
	const key = value as Partial<CryptoKey>;
	const algorithm = key.algorithm as
		| { readonly name?: unknown; readonly hash?: { readonly name?: unknown } }
		| undefined;
	return (
		key.type === 'secret' &&
		key.extractable === false &&
		Array.isArray(key.usages) &&
		key.usages.length === 1 &&
		key.usages[0] === 'sign' &&
		algorithm?.name === 'HMAC' &&
		algorithm.hash?.name === 'SHA-256'
	);
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error('reconnect storage request failed'));
	});
}

function transaction(
	database: IDBDatabase,
	mode: IDBTransactionMode,
	action: (store: IDBObjectStore) => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = database.transaction(RECONNECT_VAULT_STORE, mode);
		tx.oncomplete = () => resolve();
		tx.onabort = () =>
			reject(tx.error ?? new Error('reconnect storage transaction aborted'));
		tx.onerror = () =>
			reject(tx.error ?? new Error('reconnect storage transaction failed'));
		try {
			action(tx.objectStore(RECONNECT_VAULT_STORE));
		} catch (error) {
			tx.abort();
			reject(error);
		}
	});
}

function requireSessionOrigin(value: string): string {
	const parsed = parseOrigin(value, 'session origin');
	if (!isAllowedSessionProtocol(parsed))
		throw new TypeError('session origin must use HTTPS or loopback HTTP');
	return canonicalBrowserServerOrigin(parsed);
}

function canonicalBrowserServerOrigin(parsed: URL): string {
	if (parsed.protocol !== 'http:' || !isLoopbackAddressAlias(parsed.hostname))
		return parsed.origin;
	const port = parsed.port === '' ? '' : `:${parsed.port}`;
	return `http://localhost${port}`;
}

function isLoopbackHostname(hostname: string): boolean {
	return (
		hostname === 'localhost' ||
		hostname.endsWith('.localhost') ||
		hostname === '127.0.0.1' ||
		hostname === '[::1]'
	);
}

function isLoopbackAddressAlias(hostname: string): boolean {
	return (
		hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
	);
}

function parseOrigin(value: string, name: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new TypeError(`${name} is invalid`);
	}
	if (
		parsed.username ||
		parsed.password ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	)
		throw new TypeError(`${name} must be an exact origin`);
	return parsed;
}

function isAllowedSessionProtocol(parsed: URL): boolean {
	if (parsed.protocol === 'https:') return true;
	return parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function browserStorage(): WebStorageLike | undefined {
	try {
		const candidate = (globalThis as { readonly localStorage?: unknown })
			.localStorage;
		if (
			!isRecord(candidate) ||
			typeof candidate.getItem !== 'function' ||
			typeof candidate.setItem !== 'function' ||
			typeof candidate.removeItem !== 'function'
		)
			return undefined;
		return candidate as unknown as WebStorageLike;
	} catch {
		// Storage can be unavailable in private/sandboxed browsing contexts.
		return undefined;
	}
}
