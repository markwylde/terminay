import type { TerminayVersionRange } from './host.js';
import type { IncompatibleVersionEnvelope, ServerHello } from './types.js';
import { PROTOCOL_MAX_VERSION, PROTOCOL_MIN_VERSION } from './types.js';

/**
 * Versioned feature capabilities. A server advertises the ones it serves in
 * its hello; a client declares the ones it requires and the ones it can do
 * without. The application-protocol version is a separate, coarser gate.
 */
export const FEATURE_CAPABILITIES = Object.freeze({
	workspace: 'workspace.v1',
	terminal: 'terminal.v1',
	files: 'files.v1',
	git: 'git.v1',
	agents: 'agents.v1',
	settings: 'settings.v1',
	macros: 'macros.v1',
	recording: 'recording.v1',
	dictation: 'dictation.v1',
	extensions: 'extensions.v1',
	language: 'language.v1',
	/** Liveness and health are connection mechanics, not features. */
	heartbeat: 'connection.heartbeat',
	health: 'server.health',
} as const);

export type FeatureCapability =
	(typeof FEATURE_CAPABILITIES)[keyof typeof FEATURE_CAPABILITIES];

/** What a workspace bundle's client needs from any server it attaches to.
 * Declared in the bundle manifest and carried in the client hello. */
export interface ServerCompatibilityRequirements {
	readonly protocol: TerminayVersionRange;
	readonly requiredCapabilities: readonly string[];
	readonly optionalCapabilities: readonly string[];
}

/** The requirements every workspace bundle built from this client declares. */
export const CLIENT_SERVER_COMPATIBILITY: ServerCompatibilityRequirements =
	Object.freeze({
		protocol: Object.freeze({
			minimum: PROTOCOL_MIN_VERSION,
			maximum: PROTOCOL_MAX_VERSION,
		}),
		requiredCapabilities: Object.freeze([
			FEATURE_CAPABILITIES.workspace,
			FEATURE_CAPABILITIES.terminal,
			FEATURE_CAPABILITIES.files,
		]),
		optionalCapabilities: Object.freeze([
			FEATURE_CAPABILITIES.agents,
			FEATURE_CAPABILITIES.git,
			FEATURE_CAPABILITIES.settings,
			FEATURE_CAPABILITIES.macros,
			FEATURE_CAPABILITIES.recording,
			FEATURE_CAPABILITIES.dictation,
			FEATURE_CAPABILITIES.extensions,
			FEATURE_CAPABILITIES.language,
		]),
	});

export type ConnectionCompatibility =
	| Readonly<{ state: 'compatible'; serverVersion: string; capabilities: readonly string[] }>
	| Readonly<{
			state: 'degraded';
			serverVersion: string;
			capabilities: readonly string[];
			missingOptionalCapabilities: readonly string[];
	  }>
	| Readonly<{
			state: 'incompatible';
			reason: 'protocol' | 'capability';
			/** Which side has to move for the pair to work. */
			upgrade: 'server' | 'client';
			serverVersion?: string;
			serverProtocol?: TerminayVersionRange;
			missingRequiredCapabilities?: readonly string[];
			message: string;
	  }>;

const CAPABILITY = /^[a-z][a-z0-9.-]{0,63}$/u;

export function parseServerCompatibilityRequirements(
	value: unknown,
): ServerCompatibilityRequirements {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('invalid server compatibility requirements');
	const record = value as Record<string, unknown>;
	const protocol = record.protocol;
	if (
		typeof protocol !== 'object' || protocol === null || Array.isArray(protocol)
		|| !isVersion((protocol as Record<string, unknown>).minimum)
		|| !isVersion((protocol as Record<string, unknown>).maximum)
		|| ((protocol as Record<string, number>).minimum as number) > ((protocol as Record<string, number>).maximum as number)
	)
		throw new TypeError('invalid server compatibility protocol range');
	const required = capabilityList(record.requiredCapabilities, 'requiredCapabilities');
	const optional = capabilityList(record.optionalCapabilities, 'optionalCapabilities');
	if (required.some((capability) => optional.includes(capability)))
		throw new TypeError('a capability cannot be both required and optional');
	return Object.freeze({
		protocol: Object.freeze({
			minimum: (protocol as Record<string, number>).minimum as number,
			maximum: (protocol as Record<string, number>).maximum as number,
		}),
		requiredCapabilities: Object.freeze(required),
		optionalCapabilities: Object.freeze(optional),
	});
}

/** Classifies one server against the client's requirements. The host never
 * runs this; it is the bundle's client that knows what it needs. */
export function evaluateServerCompatibility(
	requirements: ServerCompatibilityRequirements,
	hello: ServerHello | IncompatibleVersionEnvelope,
): ConnectionCompatibility {
	if (hello.type === 'incompatible_version') {
		const serverProtocol = { minimum: hello.supportedMin, maximum: hello.supportedMax };
		const upgrade = hello.supportedMax < requirements.protocol.minimum ? 'server' : 'client';
		return Object.freeze({
			state: 'incompatible',
			reason: 'protocol',
			upgrade,
			serverProtocol,
			message: upgrade === 'server'
				? `This server speaks protocol ${hello.supportedMin}–${hello.supportedMax}; this Terminay needs at least ${requirements.protocol.minimum}. Update the server.`
				: `This server needs protocol ${hello.supportedMin}–${hello.supportedMax}; this Terminay speaks up to ${requirements.protocol.maximum}. Update Terminay.`,
		});
	}
	if (hello.protocolVersion < requirements.protocol.minimum || hello.protocolVersion > requirements.protocol.maximum) {
		const upgrade = hello.protocolVersion < requirements.protocol.minimum ? 'server' : 'client';
		return Object.freeze({
			state: 'incompatible',
			reason: 'protocol',
			upgrade,
			serverVersion: hello.serverVersion,
			serverProtocol: { minimum: hello.protocolVersion, maximum: hello.protocolVersion },
			message: upgrade === 'server'
				? `Server ${hello.serverVersion} speaks protocol ${hello.protocolVersion}; this Terminay needs at least ${requirements.protocol.minimum}. Update the server.`
				: `Server ${hello.serverVersion} speaks protocol ${hello.protocolVersion}; this Terminay speaks up to ${requirements.protocol.maximum}. Update Terminay.`,
		});
	}
	const advertised = new Set(hello.capabilities);
	const missingRequired = requirements.requiredCapabilities.filter((capability) => !advertised.has(capability));
	if (missingRequired.length > 0) {
		return Object.freeze({
			state: 'incompatible',
			reason: 'capability',
			upgrade: 'server',
			serverVersion: hello.serverVersion,
			missingRequiredCapabilities: Object.freeze(missingRequired),
			message: `Server ${hello.serverVersion} does not provide ${missingRequired.join(', ')}. Update the server.`,
		});
	}
	const missingOptional = requirements.optionalCapabilities.filter((capability) => !advertised.has(capability));
	if (missingOptional.length > 0) {
		return Object.freeze({
			state: 'degraded',
			serverVersion: hello.serverVersion,
			capabilities: Object.freeze([...hello.capabilities]),
			missingOptionalCapabilities: Object.freeze(missingOptional),
		});
	}
	return Object.freeze({ state: 'compatible', serverVersion: hello.serverVersion, capabilities: Object.freeze([...hello.capabilities]) });
}

function isVersion(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 65_535;
}

function capabilityList(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.length > 256) throw new TypeError(`invalid ${field}`);
	const list = value.map((entry) => {
		if (typeof entry !== 'string' || !CAPABILITY.test(entry)) throw new TypeError(`invalid ${field}`);
		return entry;
	});
	if (new Set(list).size !== list.length) throw new TypeError(`duplicate ${field}`);
	return list;
}
