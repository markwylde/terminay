import type { ByteTransport } from '@terminay/protocol';
import type { OpaqueBrowserByteEndpoint } from '@terminay/web';

export type BrowserDeviceEnrollment = Readonly<{
	deviceId: string;
	deviceName: string;
	origin: string;
}>;

type SessionTransportEndpoint = ByteTransport;

export type SessionTransportHost = Readonly<{
	version: 1;
	sessionId: string;
	origin: string;
	managerUrl?: string;
	managerAction?: string;
	prepareWorkspace(): Promise<Readonly<{
		expectedServerId: string;
		context: unknown;
		endpoint: OpaqueBrowserByteEndpoint;
		compressedArchive: Uint8Array;
	}>>;
	postJson<TResponse>(pathname: string, body: unknown): Promise<TResponse>;
	acquireApplicationEndpoint(ticket: string): Promise<Readonly<{
		generation: number;
		endpoint: SessionTransportEndpoint;
	}>>;
	registerApplication(delegate: Readonly<{
		connect(options: Readonly<{
			onStateChange: (state: 'closed' | 'connecting' | 'live') => void;
			origin: string;
			pairingPin?: string;
		}>): Promise<ByteTransport>;
		enroll(options: Readonly<{
			deviceName: string;
			isCurrent: () => boolean;
			origin: string;
			pairingPin: string;
			pairingUrl: string;
		}>): Promise<BrowserDeviceEnrollment>;
	}>): void;
	connect(options: Readonly<{
		onStateChange: (state: 'closed' | 'connecting' | 'live') => void;
		origin: string;
		pairingPin?: string;
	}>): Promise<ByteTransport>;
	enroll(options: Readonly<{
		deviceName: string;
		isCurrent: () => boolean;
		origin: string;
		pairingPin: string;
		pairingUrl: string;
	}>): Promise<BrowserDeviceEnrollment>;
}>;

export type HostedBrowserSessionAuthority = Omit<SessionTransportHost, 'version' | 'prepareWorkspace'> & Readonly<{
	serverId: string;
	hostContext: unknown;
	readBundle(): Promise<Uint8Array>;
	byteEndpoint: OpaqueBrowserByteEndpoint;
}>;

declare global {
	interface Window {
		__TERMINAY_HOSTED_SESSION_AUTHORITY__?: unknown;
		__TERMINAY_SESSION_TRANSPORT__?: unknown;
	}
}

/** Consume the hosted shell's narrow authority exactly once. The shell cannot
 * install or replace the application-facing host contract itself. */
export function bootstrapHostedBrowserSession(): SessionTransportHost | undefined {
	const installed = getSessionTransportHost();
	if (installed !== undefined) return installed;
	const authority = window.__TERMINAY_HOSTED_SESSION_AUTHORITY__;
	if (!isHostedBrowserSessionAuthority(authority)) return undefined;
	return installHostedBrowserSession(authority);
}

/** Sole browser producer for the privileged session host. Hosted bootstrap
 * installs one closed contract before the server application module loads. */
export function installSessionTransportHost(host: SessionTransportHost): SessionTransportHost {
	if (window.__TERMINAY_SESSION_TRANSPORT__ !== undefined)
		throw new Error('Terminay session transport host is already installed.');
	const installed = Object.freeze({ ...host });
	Object.defineProperty(window, '__TERMINAY_SESSION_TRANSPORT__', {
		configurable: false,
		enumerable: false,
		writable: false,
		value: installed,
	});
	return getSessionTransportHost()!;
}

/** Production hosted-bootstrap composition. Authentication/signaling owns the
 * authority inputs; the page receives one closed session contract. */
export function installHostedBrowserSession(authority: HostedBrowserSessionAuthority): SessionTransportHost {
	const {
		serverId,
		hostContext,
		readBundle,
		byteEndpoint,
		...lifecycle
	} = authority;
	return installSessionTransportHost(Object.freeze({
		...lifecycle,
		version: 1,
		prepareWorkspace: async () => Object.freeze({
			expectedServerId: serverId,
			context: hostContext,
			endpoint: byteEndpoint,
			compressedArchive: await readBundle(),
		}),
	}));
}

export function getSessionTransportHost(): SessionTransportHost | undefined {
	const value = window.__TERMINAY_SESSION_TRANSPORT__;
	if (value === undefined) return undefined;
	if (!isRecord(value) || value.version !== 1) fail('version');
	for (const name of ['sessionId', 'origin'] as const) {
		if (typeof value[name] !== 'string' || value[name].length === 0) fail(name);
	}
	if (new URL(value.origin as string).origin !== window.location.origin) fail('origin binding');
	for (const name of ['prepareWorkspace', 'postJson', 'acquireApplicationEndpoint', 'registerApplication', 'connect', 'enroll'] as const) {
		if (typeof value[name] !== 'function') fail(name);
	}
	return value as SessionTransportHost;
}

export async function acquireHostedApplicationTransport(ticket: string): Promise<ByteTransport | undefined> {
	const host = getSessionTransportHost();
	if (host === undefined) return undefined;
	const acquired = await host.acquireApplicationEndpoint(ticket);
	if (!isRecord(acquired) || !Number.isSafeInteger(acquired.generation) || acquired.generation < 1) fail('generation');
	return validateEndpoint(acquired.endpoint);
}

function validateEndpoint(value: unknown): ByteTransport {
	if (!isRecord(value)) fail('endpoint');
	for (const name of ['open', 'send', 'waitForWritable', 'close', 'onStateChange'] as const) {
		if (typeof value[name] !== 'function') fail(`endpoint.${name}`);
	}
	if (!isRecord(value.incoming) || typeof value.incoming[Symbol.asyncIterator] !== 'function') fail('endpoint.incoming');
	if (!['open', 'closing', 'closed', 'failed'].includes(String(value.state))) fail('endpoint.state');
	return value as unknown as ByteTransport;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === 'object' && value !== null;
}

function isHostedBrowserSessionAuthority(
	value: unknown,
): value is HostedBrowserSessionAuthority {
	if (!isRecord(value)) return false;
	const allowed = new Set([
		'sessionId', 'origin', 'managerUrl', 'managerAction', 'serverId',
		'hostContext', 'readBundle', 'byteEndpoint', 'postJson',
		'acquireApplicationEndpoint', 'registerApplication', 'connect', 'enroll',
	]);
	if (Object.keys(value).some((name) => !allowed.has(name))) return false;
	for (const name of ['sessionId', 'origin', 'serverId'] as const) {
		if (typeof value[name] !== 'string' || value[name].length === 0) return false;
	}
	const origin = value.origin;
	if (typeof origin !== 'string') return false;
	try {
		if (new URL(origin).origin !== window.location.origin) return false;
	} catch {
		return false;
	}
	for (const name of ['managerUrl', 'managerAction'] as const) {
		if (value[name] !== undefined && typeof value[name] !== 'string') return false;
	}
	for (const name of [
		'readBundle', 'postJson', 'acquireApplicationEndpoint',
		'registerApplication', 'connect', 'enroll',
	] as const) {
		if (typeof value[name] !== 'function') return false;
	}
	if (!isRecord(value.byteEndpoint)) return false;
	if (typeof value.byteEndpoint.send !== 'function' || typeof value.byteEndpoint.subscribe !== 'function') return false;
	return isRecord(value.hostContext);
}

function fail(field: string): never {
	throw new Error(`Terminay session transport host has an incompatible ${field} contract.`);
}
