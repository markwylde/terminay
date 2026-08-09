/**
 * Redirect only non-secret manager metadata between the historical app origin
 * and the current web manager origin.  Device keys, pairing fragments, grants,
 * and server credentials are deliberately not represented by the return type.
 */
import {
	TERMINAY_LEGACY_MANAGER_ORIGIN,
	TERMINAY_WEB_MANAGER_ORIGIN,
} from '@terminay/protocol';

export const LEGACY_MANAGER_ORIGIN = TERMINAY_LEGACY_MANAGER_ORIGIN;
export const CURRENT_MANAGER_ORIGIN = TERMINAY_WEB_MANAGER_ORIGIN;

export interface SanitizedManagerProfile {
	readonly id: string;
	readonly serverId: string;
	readonly origin: string;
	readonly label: string;
	readonly kind: 'local' | 'remote';
	readonly fingerprint?: string;
}

export interface ManagerProfileMigration {
	readonly sourceOrigin: string;
	readonly destinationOrigin: typeof CURRENT_MANAGER_ORIGIN;
	readonly profiles: readonly SanitizedManagerProfile[];
}

export interface ManagerProfileMigrationOptions {
	readonly sourceOrigin?: string;
	readonly maxProfiles?: number;
}

export interface ServerTrustRecord {
	readonly serverId: string;
	readonly origin: string;
	readonly fingerprint?: string;
}

export interface ConnectionStateMigration {
	readonly manager: ManagerProfileMigration;
	/** Trust metadata remains a server-side handoff and is never mixed into the
	 * manager profile store. Credential-bearing fields are not represented. */
	readonly serverTrust: readonly ServerTrustRecord[];
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const FINGERPRINT = /^[A-Za-z0-9._:+/=-]{1,256}$/u;
const DEFAULT_MAX_PROFILES = 1024;

/**
 * Accept the known legacy/current manager envelope and return an immutable
 * metadata-only profile list.  Unknown profile fields are ignored rather than
 * copied; malformed identity/origin fields fail closed before any migration
 * write can occur.
 */
export function sanitizeManagerProfiles(
	input: unknown,
	options: ManagerProfileMigrationOptions = {},
): ManagerProfileMigration {
	const sourceOrigin = normalizeManagerOrigin(
		options.sourceOrigin ?? LEGACY_MANAGER_ORIGIN,
	);
	const maxProfiles = options.maxProfiles ?? DEFAULT_MAX_PROFILES;
	if (
		!Number.isSafeInteger(maxProfiles) ||
		maxProfiles < 1 ||
		maxProfiles > DEFAULT_MAX_PROFILES
	)
		throw new RangeError('maxProfiles must be between 1 and 1024');
	const record = asRecord(input);
	const rawProfiles = Array.isArray(input)
		? input
		: record === undefined
			? undefined
			: record.profiles;
	if (!Array.isArray(rawProfiles))
		throw new TypeError('manager profile source is invalid');
	if (rawProfiles.length > maxProfiles)
		throw new RangeError('manager profile count exceeds the limit');
	const profiles: SanitizedManagerProfile[] = [];
	const ids = new Set<string>();
	for (const raw of rawProfiles) {
		const profile = normalizeProfile(raw);
		if (ids.has(profile.id))
			throw new TypeError('manager profile ids must be unique');
		ids.add(profile.id);
		profiles.push(profile);
	}
	return Object.freeze({
		sourceOrigin,
		destinationOrigin: CURRENT_MANAGER_ORIGIN,
		profiles: Object.freeze(profiles),
	});
}

/**
 * Partition a legacy Desktop snapshot into host-local profile metadata and a
 * separate server trust handoff. The two lists have different authorities and
 * are intentionally returned under distinct keys.
 */
export function separateConnectionProfilesFromTrust(
	input: unknown,
	options: ManagerProfileMigrationOptions = {},
): ConnectionStateMigration {
	const record = asRecord(input);
	if (record === undefined)
		throw new TypeError('connection state source is invalid');
	const manager = sanitizeManagerProfiles(record.profiles, options);
	const rawTrust = record.serverTrust ?? record.trust ?? [];
	if (!Array.isArray(rawTrust))
		throw new TypeError('server trust source is invalid');
	const maxProfiles = options.maxProfiles ?? DEFAULT_MAX_PROFILES;
	if (rawTrust.length > maxProfiles)
		throw new RangeError('server trust count exceeds the limit');
	const ids = new Set<string>();
	const serverTrust = rawTrust.map((value) => {
		const trust = asRecord(value);
		if (trust === undefined)
			throw new TypeError('server trust record is invalid');
		const serverId = requiredId(trust.serverId, 'server trust server id');
		if (ids.has(serverId))
			throw new TypeError('server trust ids must be unique');
		ids.add(serverId);
		if (typeof trust.origin !== 'string')
			throw new TypeError('server trust origin is invalid');
		const origin = normalizeOrigin(trust.origin, 'server trust origin');
		const fingerprint =
			trust.fingerprint === undefined
				? undefined
				: normalizeFingerprint(trust.fingerprint);
		return Object.freeze({
			serverId,
			origin,
			...(fingerprint === undefined ? {} : { fingerprint }),
		});
	});
	return Object.freeze({ manager, serverTrust: Object.freeze(serverTrust) });
}

function normalizeProfile(value: unknown): SanitizedManagerProfile {
	const input = asRecord(value);
	if (input === undefined) throw new TypeError('manager profile is invalid');
	const id = requiredId(input.id, 'manager profile id');
	const serverId = requiredId(input.serverId, 'manager profile server id');
	const label = normalizeLabel(input.label);
	const kind =
		input.kind === 'local' || input.kind === 'remote' ? input.kind : 'remote';
	const origin = normalizeProfileOrigin(input.origin, kind);
	const fingerprint =
		input.fingerprint === undefined
			? undefined
			: normalizeFingerprint(input.fingerprint);
	return Object.freeze({
		id,
		serverId,
		origin,
		label,
		kind,
		...(fingerprint === undefined ? {} : { fingerprint }),
	});
}

function normalizeManagerOrigin(value: string): string {
	const origin = normalizeOrigin(value, 'manager origin');
	if (origin !== LEGACY_MANAGER_ORIGIN && origin !== CURRENT_MANAGER_ORIGIN)
		throw new TypeError('manager origin is not supported');
	return origin;
}

function normalizeProfileOrigin(
	value: unknown,
	kind: 'local' | 'remote',
): string {
	if (typeof value !== 'string')
		throw new TypeError('manager profile origin is invalid');
	const origin = normalizeOrigin(value, 'manager profile origin');
	if (kind === 'remote' && !origin.startsWith('https://'))
		throw new TypeError('remote profile origin must use HTTPS');
	return origin;
}

function normalizeOrigin(value: string, label: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new TypeError(`${label} is invalid`);
	}
	const loopback =
		parsed.protocol === 'http:' &&
		['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
	if (parsed.protocol !== 'https:' && !loopback)
		throw new TypeError(`${label} must use HTTPS or loopback HTTP`);
	if (parsed.username || parsed.password)
		throw new TypeError(`${label} must not contain credentials`);
	if (parsed.pathname !== '/' || parsed.search || parsed.hash)
		throw new TypeError(
			`${label} must be an origin without path, query, or fragment`,
		);
	return parsed.origin;
}

function requiredId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value))
		throw new TypeError(`${label} is invalid`);
	return value;
}

function normalizeLabel(value: unknown): string {
	if (typeof value !== 'string')
		throw new TypeError('manager profile label is invalid');
	const label = value.trim();
	if (
		label.length === 0 ||
		label.length > 160 ||
		[...label].some(
			(character) =>
				(character.codePointAt(0) ?? 0) < 0x20 ||
				(character.codePointAt(0) ?? 0) === 0x7f,
		)
	)
		throw new TypeError('manager profile label is invalid');
	return label;
}

function normalizeFingerprint(value: unknown): string {
	if (typeof value !== 'string' || !FINGERPRINT.test(value))
		throw new TypeError('manager profile fingerprint is invalid');
	return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
