import type { ByteTransport } from '@terminay/protocol';

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

declare global {
	interface Window {
		__TERMINAY_SESSION_TRANSPORT__?: unknown;
	}
}

export function getSessionTransportHost(): SessionTransportHost | undefined {
	const value = window.__TERMINAY_SESSION_TRANSPORT__;
	if (value === undefined) return undefined;
	if (!isRecord(value) || value.version !== 1) fail('version');
	for (const name of ['sessionId', 'origin'] as const) {
		if (typeof value[name] !== 'string' || value[name].length === 0) fail(name);
	}
	for (const name of ['postJson', 'acquireApplicationEndpoint', 'registerApplication', 'connect', 'enroll'] as const) {
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

function fail(field: string): never {
	throw new Error(`Terminay session transport host has an incompatible ${field} contract.`);
}
