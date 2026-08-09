import {
	TERMINAY_LEGACY_MANAGER_ORIGIN,
	TERMINAY_WEB_MANAGER_ORIGIN,
} from '@terminay/protocol';
import type { WebConnectionHost, WebStorageLike } from './index.js';

export const LEGACY_MANAGER_PROFILE_STORAGE_KEY =
	'terminay.web.connection-profiles.v1';
export const LEGACY_MANAGER_HANDOFF_PREFIX = 'terminay-manager-migration-v1:';
export const LEGACY_MANAGER_PENDING_ACK_KEY =
	'terminay.web.connection-profiles.migration-pending.v1';

const MAX_HANDOFF_BYTES = 128 * 1024;
const MAX_PROFILES = 128;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

type MigrationProfile = Readonly<{
	id: string;
	serverId: string;
	label: string;
	origin: string;
}>;

type Offer = Readonly<{
	type: 'offer';
	version: 1;
	id: string;
	sourceOrigin: typeof TERMINAY_LEGACY_MANAGER_ORIGIN;
	destinationOrigin: typeof TERMINAY_WEB_MANAGER_ORIGIN;
	profiles: readonly MigrationProfile[];
}>;

type Ack = Readonly<{
	type: 'ack';
	version: 1;
	id: string;
	sourceOrigin: typeof TERMINAY_LEGACY_MANAGER_ORIGIN;
	destinationOrigin: typeof TERMINAY_WEB_MANAGER_ORIGIN;
}>;

export interface LegacyMigrationWindow {
	readonly location: {
		readonly origin: string;
		replace(url: string): void;
	};
	name: string;
}

export type LegacyMigrationResult =
	| Readonly<{
			status: 'ignored' | 'redirected' | 'offered' | 'imported' | 'completed';
			count: number;
	  }>
	| Readonly<{ status: 'recovery'; count: 0; message: string }>;

/** Run on the retired web.terminay.com authority. The offer travels in the browsing context's
 * window.name rather than a URL, request, referrer, log, or shared storage.
 * The legacy record remains untouched until the canonical origin acknowledges
 * a durable import and bounces back for cleanup. */
export function runLegacyManagerMigration(input: {
	readonly window: LegacyMigrationWindow;
	readonly storage?: WebStorageLike;
	readonly createId?: () => string;
}): LegacyMigrationResult {
	if (input.window.location.origin !== TERMINAY_LEGACY_MANAGER_ORIGIN)
		return { status: 'ignored', count: 0 };
	try {
		const envelope = decodeEnvelope(input.window.name);
		if (envelope?.type === 'ack') {
			if (input.storage === undefined)
				throw new Error(
					'Browser storage is unavailable. Your saved connections were not changed.',
				);
			if (input.storage.getItem(LEGACY_MANAGER_PENDING_ACK_KEY) !== envelope.id)
				throw new TypeError(
					'Migration acknowledgement does not match the pending import.',
				);
			input.storage.removeItem(LEGACY_MANAGER_PROFILE_STORAGE_KEY);
			input.storage.removeItem(LEGACY_MANAGER_PENDING_ACK_KEY);
			input.window.name = '';
			input.window.location.replace(TERMINAY_WEB_MANAGER_ORIGIN);
			return { status: 'completed', count: 0 };
		}
		if (input.storage === undefined)
			throw new Error(
				'Browser storage is unavailable. Your saved connections were not changed.',
			);
		const encoded = input.storage.getItem(LEGACY_MANAGER_PROFILE_STORAGE_KEY);
		if (encoded === null) {
			input.window.name = '';
			input.window.location.replace(TERMINAY_WEB_MANAGER_ORIGIN);
			return { status: 'redirected', count: 0 };
		}
		if (utf8Length(encoded) > MAX_HANDOFF_BYTES)
			throw new RangeError(
				'Saved connection metadata is too large to migrate.',
			);
		const profiles = sanitizeLegacyRecord(JSON.parse(encoded));
		const offer: Offer = Object.freeze({
			type: 'offer',
			version: 1,
			id: input.createId?.() ?? createMigrationId(),
			sourceOrigin: TERMINAY_LEGACY_MANAGER_ORIGIN,
			destinationOrigin: TERMINAY_WEB_MANAGER_ORIGIN,
			profiles,
		});
		input.storage.setItem(LEGACY_MANAGER_PENDING_ACK_KEY, offer.id);
		input.window.name = encodeEnvelope(offer);
		input.window.location.replace(TERMINAY_WEB_MANAGER_ORIGIN);
		return { status: 'offered', count: profiles.length };
	} catch (error) {
		return { status: 'recovery', count: 0, message: recoveryMessage(error) };
	}
}

/** Run before rendering the canonical app.terminay.com manager. A valid offer is imported once. An
 * acknowledgement is installed only after WebConnectionHost has committed the
 * canonical localStorage record; import failure leaves the offer and source
 * record available for retry. */
export function consumeLegacyManagerMigration(input: {
	readonly window: LegacyMigrationWindow;
	readonly host: WebConnectionHost;
}): LegacyMigrationResult {
	if (input.window.location.origin !== TERMINAY_WEB_MANAGER_ORIGIN)
		return { status: 'ignored', count: 0 };
	try {
		const envelope = decodeEnvelope(input.window.name);
		if (envelope === undefined || envelope.type !== 'offer')
			return { status: 'ignored', count: 0 };
		const migration = input.host.migrateLegacyManagerRecord(
			{ profiles: envelope.profiles },
			{ maxProfiles: MAX_PROFILES },
		);
		const ack: Ack = Object.freeze({
			type: 'ack',
			version: 1,
			id: envelope.id,
			sourceOrigin: TERMINAY_LEGACY_MANAGER_ORIGIN,
			destinationOrigin: TERMINAY_WEB_MANAGER_ORIGIN,
		});
		input.window.name = encodeEnvelope(ack);
		input.window.location.replace(TERMINAY_LEGACY_MANAGER_ORIGIN);
		return { status: 'imported', count: migration.profiles.length };
	} catch (error) {
		return { status: 'recovery', count: 0, message: recoveryMessage(error) };
	}
}

function sanitizeLegacyRecord(value: unknown): readonly MigrationProfile[] {
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.profiles))
		throw new TypeError('Saved connection metadata is malformed.');
	if (value.profiles.length > MAX_PROFILES)
		throw new RangeError('Too many saved connections to migrate.');
	const ids = new Set<string>();
	const origins = new Set<string>();
	const profiles: MigrationProfile[] = [];
	for (const candidate of value.profiles) {
		if (!isRecord(candidate))
			throw new TypeError('A saved connection is malformed.');
		if (candidate.isLocal === true || candidate.kind === 'local') continue;
		const id = boundedId(candidate.id);
		const serverId = boundedId(candidate.serverId);
		if (ids.has(id))
			throw new TypeError('Saved connection identities are duplicated.');
		ids.add(id);
		if (typeof candidate.label !== 'string')
			throw new TypeError('A saved connection label is malformed.');
		const label = candidate.label.trim();
		if (label.length === 0 || label.length > 128 || hasControl(label))
			throw new TypeError('A saved connection label is malformed.');
		if (typeof candidate.origin !== 'string')
			throw new TypeError('A saved connection origin is malformed.');
		const origin = exactRemoteOrigin(candidate.origin);
		if (origins.has(origin))
			throw new TypeError('Saved connection origins are duplicated.');
		origins.add(origin);
		profiles.push(Object.freeze({ id, serverId, label, origin }));
	}
	return Object.freeze(profiles);
}

function decodeEnvelope(value: string): Offer | Ack | undefined {
	if (!value.startsWith(LEGACY_MANAGER_HANDOFF_PREFIX)) return undefined;
	if (utf8Length(value) > MAX_HANDOFF_BYTES)
		throw new RangeError('Migration handoff is too large.');
	const parsed: unknown = JSON.parse(
		value.slice(LEGACY_MANAGER_HANDOFF_PREFIX.length),
	);
	if (
		!isRecord(parsed) ||
		parsed.version !== 1 ||
		!ID.test(String(parsed.id ?? '')) ||
		parsed.sourceOrigin !== TERMINAY_LEGACY_MANAGER_ORIGIN ||
		parsed.destinationOrigin !== TERMINAY_WEB_MANAGER_ORIGIN
	)
		throw new TypeError('Migration handoff is invalid.');
	if (parsed.type === 'ack' && Object.keys(parsed).length === 5)
		return parsed as unknown as Ack;
	if (parsed.type !== 'offer' || Object.keys(parsed).length !== 6)
		throw new TypeError('Migration handoff is invalid.');
	return Object.freeze({
		...parsed,
		profiles: sanitizeLegacyRecord({ version: 1, profiles: parsed.profiles }),
	}) as Offer;
}

function encodeEnvelope(value: Offer | Ack): string {
	const encoded = `${LEGACY_MANAGER_HANDOFF_PREFIX}${JSON.stringify(value)}`;
	if (utf8Length(encoded) > MAX_HANDOFF_BYTES)
		throw new RangeError('Migration handoff is too large.');
	return encoded;
}

function exactRemoteOrigin(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError('A saved connection origin is malformed.');
	}
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	)
		throw new TypeError('A saved connection must use an exact HTTPS origin.');
	if (
		url.origin === TERMINAY_LEGACY_MANAGER_ORIGIN ||
		url.origin === TERMINAY_WEB_MANAGER_ORIGIN
	)
		throw new TypeError('A manager origin cannot be imported as a session.');
	return url.origin;
}

function boundedId(value: unknown): string {
	if (typeof value !== 'string' || !ID.test(value))
		throw new TypeError('A saved connection identity is malformed.');
	return value;
}

function createMigrationId(): string {
	const cryptoApi = globalThis.crypto;
	if (cryptoApi === undefined)
		throw new Error('Secure migration identifiers are unavailable.');
	return `migration-${cryptoApi.randomUUID()}`;
}

function utf8Length(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}
function hasControl(value: string): boolean {
	return [...value].some(
		(character) =>
			(character.codePointAt(0) ?? 0) < 0x20 ||
			(character.codePointAt(0) ?? 0) === 0x7f,
	);
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function recoveryMessage(error: unknown): string {
	return error instanceof Error
		? error.message
		: 'Saved connections could not be migrated. Try again or continue without importing them.';
}
