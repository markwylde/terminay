import {
	AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
	type ByteTransport,
	type TerminayHostConnectionStatus,
	type TerminayWorkspaceComposition,
} from '@terminay/protocol';
import type { OpaqueBrowserByteEndpoint } from '@terminay/web';
import {
	type ServerMessagePort,
	ServerPortTransport,
} from '../shared/serverPortTransport';

/** Sanitized manager profile projection. It carries no origin, credential, or
 * workspace value across the framed-host boundary. */
export type AttachedConnectionProfile = Readonly<{
	id: string;
	label: string;
	status: TerminayHostConnectionStatus;
	serverId?: string;
}>;

export type AttachedConnection = Readonly<{
	serverId: string;
	transport: ByteTransport;
}>;

export type SessionTransportHost = Readonly<{
	version: 1;
	authenticatedTransportVersion: typeof AUTHENTICATED_WEBRTC_TRANSPORT_VERSION;
	sessionId: string;
	origin: string;
	hostName?: string;
	managerUrl?: string;
	managerAction?: string;
	leaveManager?: () => void;
	prepareWorkspace(): Promise<
		Readonly<{
			expectedServerId: string;
			context: unknown;
			endpoint: OpaqueBrowserByteEndpoint;
			compressedArchive: Uint8Array;
		}>
	>;
	connect(
		options: Readonly<{
			onStateChange: (state: 'closed' | 'connecting' | 'live') => void;
			origin: string;
		}>,
	): Promise<ByteTransport>;
	/** The attached-connection surface. Present only when this shell is framed
	 * by a manager that supports the framed connection schema; Desktop and a
	 * first-party session tab leave every member undefined. The manager opens
	 * each attached transport with the vaulted credential for that server's own
	 * origin and hands back one opaque byte endpoint. */
	connectAttached?(profileId: string): Promise<AttachedConnection>;
	listConnections?(): Promise<readonly AttachedConnectionProfile[]>;
	detachConnection?(profileId: string): Promise<void>;
	subscribeConnections?(
		listener: (profiles: readonly AttachedConnectionProfile[]) => void,
	): () => void;
	readComposition?(): Promise<TerminayWorkspaceComposition | undefined>;
	writeComposition?(composition: TerminayWorkspaceComposition): Promise<void>;
}>;

export const SESSION_TRANSPORT_CONNECTION_MEMBERS = [
	'connectAttached',
	'listConnections',
	'detachConnection',
	'subscribeConnections',
	'readComposition',
	'writeComposition',
] as const;

export type SessionTransportConnectionSurface = Required<
	Pick<
		SessionTransportHost,
		(typeof SESSION_TRANSPORT_CONNECTION_MEMBERS)[number]
	>
>;

export type HostedBrowserSessionAuthority = Omit<
	SessionTransportHost,
	| 'version'
	| 'prepareWorkspace'
	| (typeof SESSION_TRANSPORT_CONNECTION_MEMBERS)[number]
> &
	Readonly<{
		serverId: string;
		hostContext: unknown;
		readBundle(): Promise<Uint8Array>;
		byteEndpoint: OpaqueBrowserByteEndpoint;
		/** Set by the framed bootstrap once the manager has announced the framed
		 * connection schema version it speaks. Absent for an unframed session. */
		managerConnectionsVersion?: number;
	}>;

declare global {
	interface Window {
		__TERMINAY_HOSTED_SESSION_AUTHORITY__?: unknown;
		__TERMINAY_SESSION_TRANSPORT__?: unknown;
	}
}

/** Consume the hosted shell's narrow authority exactly once. The shell cannot
 * install or replace the application-facing host contract itself. */
export function bootstrapHostedBrowserSession():
	| SessionTransportHost
	| undefined {
	const installed = getSessionTransportHost();
	if (installed !== undefined) return installed;
	const authority = window.__TERMINAY_HOSTED_SESSION_AUTHORITY__;
	if (!isHostedBrowserSessionAuthority(authority)) return undefined;
	return installHostedBrowserSession(authority);
}

/** Sole browser producer for the privileged session host. Hosted bootstrap
 * installs one closed contract before the server application module loads. */
export function installSessionTransportHost(
	host: SessionTransportHost,
): SessionTransportHost {
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
export function installHostedBrowserSession(
	authority: HostedBrowserSessionAuthority,
): SessionTransportHost {
	const {
		serverId,
		hostContext,
		readBundle,
		byteEndpoint,
		managerConnectionsVersion,
		...lifecycle
	} = authority;
	const managerOrigin = framedManagerOrigin(lifecycle.managerUrl);
	// The attached-connection surface exists only for a framed session whose
	// manager announced the schema. Everywhere else the members stay absent.
	const connections =
		managerConnectionsVersion === FRAMED_CONNECTION_SCHEMA_VERSION &&
		managerOrigin !== undefined
			? createFramedConnectionSurface({ managerOrigin })
			: undefined;
	return installSessionTransportHost(
		Object.freeze({
			...lifecycle,
			...(connections ?? {}),
			authenticatedTransportVersion: AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
			version: 1,
			prepareWorkspace: async () =>
				Object.freeze({
					expectedServerId: serverId,
					context: hostContext,
					endpoint: byteEndpoint,
					compressedArchive: await readBundle(),
				}),
		}),
	);
}

export function getSessionTransportHost(): SessionTransportHost | undefined {
	const value = window.__TERMINAY_SESSION_TRANSPORT__;
	if (value === undefined) return undefined;
	if (!isRecord(value) || value.version !== 1) fail('version');
	if (value.authenticatedTransportVersion !== AUTHENTICATED_WEBRTC_TRANSPORT_VERSION)
		fail('authenticated transport version');
	for (const name of ['sessionId', 'origin'] as const) {
		if (typeof value[name] !== 'string' || value[name].length === 0) fail(name);
	}
	if (
		value.hostName !== undefined &&
		(typeof value.hostName !== 'string' || value.hostName.length === 0)
	) {
		fail('hostName');
	}
	if (new URL(value.origin as string).origin !== window.location.origin)
		fail('origin binding');
	for (const name of ['prepareWorkspace', 'connect'] as const) {
		if (typeof value[name] !== 'function') fail(name);
	}
	for (const name of ['managerUrl', 'managerAction'] as const) {
		if (value[name] !== undefined && typeof value[name] !== 'string')
			fail(name);
	}
	if (
		value.leaveManager !== undefined &&
		typeof value.leaveManager !== 'function'
	) {
		fail('leaveManager');
	}
	// The attached-connection surface is optional and all-or-nothing: a partial
	// surface is a broken contract, not a degraded one.
	const present = SESSION_TRANSPORT_CONNECTION_MEMBERS.filter(
		(name) => value[name] !== undefined,
	);
	for (const name of present)
		if (typeof value[name] !== 'function') fail(name);
	if (present.length !== 0 && present.length !== SESSION_TRANSPORT_CONNECTION_MEMBERS.length)
		fail('attached connections');
	return value as SessionTransportHost;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === 'object' && value !== null;
}

function isHostedBrowserSessionAuthority(
	value: unknown,
): value is HostedBrowserSessionAuthority {
	if (!isRecord(value)) return false;
	if (value.authenticatedTransportVersion !== AUTHENTICATED_WEBRTC_TRANSPORT_VERSION) return false;
	for (const name of ['sessionId', 'origin', 'serverId'] as const) {
		if (typeof value[name] !== 'string' || value[name].length === 0)
			return false;
	}
	if (
		value.hostName !== undefined &&
		(typeof value.hostName !== 'string' || value.hostName.length === 0)
	) {
		return false;
	}
	const origin = value.origin;
	if (typeof origin !== 'string') return false;
	try {
		if (new URL(origin).origin !== window.location.origin) return false;
	} catch {
		return false;
	}
	for (const name of ['managerUrl', 'managerAction'] as const) {
		if (value[name] !== undefined && typeof value[name] !== 'string')
			return false;
	}
	if (
		value.leaveManager !== undefined &&
		typeof value.leaveManager !== 'function'
	) {
		return false;
	}
	for (const name of ['readBundle', 'connect'] as const) {
		if (typeof value[name] !== 'function') return false;
	}
	if (
		value.managerConnectionsVersion !== undefined &&
		typeof value.managerConnectionsVersion !== 'number'
	) {
		return false;
	}
	if (!isRecord(value.byteEndpoint)) return false;
	if (
		typeof value.byteEndpoint.send !== 'function' ||
		typeof value.byteEndpoint.subscribe !== 'function'
	)
		return false;
	return isRecord(value.hostContext);
}

function fail(field: string): never {
	throw new Error(
		`Terminay session transport host has an incompatible ${field} contract.`,
	);
}

/** True when this browser session can return to the `app.terminay.com`
 * manager. Desktop has no manager session, so the connection menu omits
 * **Switch connections** there. */
export function canLeaveManagerSession(
	host = getSessionTransportHost(),
): boolean {
	if (typeof host?.leaveManager === 'function') return true;
	return typeof host?.managerUrl === 'string' && host.managerUrl.length > 0;
}

/** Return to the PWA connection list. Framed sessions post `shell.back`;
 * first-party session tabs navigate to the manager origin. Electron has no
 * manager session, so this is a no-op there. */
export function leaveManagerSession(
	host = getSessionTransportHost(),
	win: Pick<Window, 'parent' | 'location' | 'postMessage'> & {
		parent: Pick<Window, 'postMessage'>;
	} = window,
): boolean {
	if (typeof host?.leaveManager === 'function') {
		host.leaveManager();
		return true;
	}
	if (typeof host?.managerUrl !== 'string' || host.managerUrl.length === 0) {
		return false;
	}
	let managerOrigin: string;
	try {
		managerOrigin = new URL(host.managerUrl).origin;
	} catch {
		return false;
	}
	if (isFramedWindow(win)) {
		win.parent.postMessage({ type: 'shell.back', v: 1 }, managerOrigin);
		return true;
	}
	win.location.assign(host.managerUrl);
	return true;
}

/** Version of the closed framed-host connection schema this shell speaks. */
export const FRAMED_CONNECTION_SCHEMA_VERSION = 1 as const;

const FRAMED_REQUEST_TIMEOUT_MS = 30_000;

type FramedIncomingMessage = Readonly<{
	data: unknown;
	origin: string;
	source?: unknown;
	ports?: readonly unknown[];
}>;

export type FramedConnectionPeerWindow = Readonly<{
	parent: Readonly<{
		postMessage(message: unknown, targetOrigin: string): void;
	}>;
	addEventListener(
		type: 'message',
		listener: (event: FramedIncomingMessage) => void,
	): void;
	removeEventListener(
		type: 'message',
		listener: (event: FramedIncomingMessage) => void,
	): void;
}>;

/**
 * The session-origin half of the framed connection schema. Every message is
 * origin-checked against the manager and validated with a closed shape; the
 * only thing that crosses for an attached server is a `MessagePort` of opaque
 * byte frames.
 */
export function createFramedConnectionSurface(
	options: Readonly<{
		managerOrigin: string;
		win?: FramedConnectionPeerWindow;
		timeoutMs?: number;
		newRequestId?: () => string;
	}>,
): SessionTransportConnectionSurface {
	const win =
		options.win ?? (window as unknown as FramedConnectionPeerWindow);
	const managerOrigin = new URL(options.managerOrigin).origin;
	const timeoutMs = options.timeoutMs ?? FRAMED_REQUEST_TIMEOUT_MS;
	let sequence = 0;
	const nextId =
		options.newRequestId ??
		(() => {
			sequence += 1;
			return `req-${sequence}-${Date.now()}`;
		});
	const pending = new Map<
		string,
		Readonly<{
			resolve: (value: FramedReply) => void;
			reject: (reason: Error) => void;
			timer?: ReturnType<typeof setTimeout>;
		}>
	>();
	const watchers = new Set<
		(profiles: readonly AttachedConnectionProfile[]) => void
	>();

	win.addEventListener('message', (event) => {
		if (event.origin !== managerOrigin) return;
		if (event.source !== undefined && event.source !== win.parent) return;
		let response: FramedResponse;
		try {
			response = parseFramedResponse(event.data);
		} catch {
			return;
		}
		if (response.type === 'connections.changed') {
			for (const watcher of [...watchers]) {
				try {
					watcher(response.profiles);
				} catch {
					// A workspace observer never disturbs the host contract.
				}
			}
			return;
		}
		const waiter = pending.get(response.requestId);
		if (waiter === undefined) return;
		pending.delete(response.requestId);
		if (waiter.timer !== undefined) clearTimeout(waiter.timer);
		if (response.type === 'connections.error') {
			waiter.reject(new Error(`${response.code}: ${response.message}`));
			return;
		}
		waiter.resolve({ result: response.result, ports: event.ports ?? [] });
	});

	function request(
		message: Readonly<Record<string, unknown>>,
	): Promise<FramedReply> {
		const requestId = nextId();
		return new Promise<FramedReply>((resolve, reject) => {
			const timer =
				timeoutMs > 0
					? setTimeout(() => {
							pending.delete(requestId);
							reject(new Error('the manager did not answer in time'));
						}, timeoutMs)
					: undefined;
			pending.set(requestId, { resolve, reject, timer });
			try {
				win.parent.postMessage(
					{ v: FRAMED_CONNECTION_SCHEMA_VERSION, ...message, requestId },
					managerOrigin,
				);
			} catch (cause) {
				pending.delete(requestId);
				if (timer !== undefined) clearTimeout(timer);
				reject(cause instanceof Error ? cause : new Error('post failed'));
			}
		});
	}

	return Object.freeze({
		async listConnections() {
			const reply = await request({ type: 'connections.list' });
			if (reply.result.kind !== 'profiles')
				throw new Error('the manager answered with an unexpected result');
			return reply.result.profiles;
		},
		async connectAttached(profileId: string) {
			const reply = await request({ type: 'connections.attach', profileId });
			if (reply.result.kind !== 'attached')
				throw new Error('the manager answered with an unexpected result');
			const port = reply.ports[0];
			if (!isBytePort(port))
				throw new Error('the manager transferred no byte endpoint');
			const transport = new ServerPortTransport(port);
			await transport.open();
			return Object.freeze({ serverId: reply.result.serverId, transport });
		},
		async detachConnection(profileId: string) {
			const reply = await request({ type: 'connections.detach', profileId });
			if (reply.result.kind !== 'detached')
				throw new Error('the manager answered with an unexpected result');
		},
		subscribeConnections(listener) {
			watchers.add(listener);
			return () => watchers.delete(listener);
		},
		async readComposition() {
			const reply = await request({ type: 'connections.composition.read' });
			if (reply.result.kind !== 'composition')
				throw new Error('the manager answered with an unexpected result');
			return reply.result.composition;
		},
		async writeComposition(composition: TerminayWorkspaceComposition) {
			const reply = await request({
				type: 'connections.composition.write',
				composition,
			});
			if (reply.result.kind !== 'ok')
				throw new Error('the manager answered with an unexpected result');
		},
	});
}

type FramedResult =
	| Readonly<{ kind: 'profiles'; profiles: readonly AttachedConnectionProfile[] }>
	| Readonly<{ kind: 'attached'; profileId: string; serverId: string }>
	| Readonly<{ kind: 'detached'; profileId: string }>
	| Readonly<{ kind: 'composition'; composition?: TerminayWorkspaceComposition }>
	| Readonly<{ kind: 'ok' }>;

type FramedResponse =
	| Readonly<{ type: 'connections.result'; requestId: string; result: FramedResult }>
	| Readonly<{
			type: 'connections.error';
			requestId: string;
			code: string;
			message: string;
	  }>
	| Readonly<{
			type: 'connections.changed';
			profiles: readonly AttachedConnectionProfile[];
	  }>;

type FramedReply = Readonly<{
	result: FramedResult;
	ports: readonly unknown[];
}>;

const FRAMED_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const FRAMED_STATUSES: readonly TerminayHostConnectionStatus[] = [
	'connected',
	'connecting',
	'offline',
	'unavailable',
	'unauthenticated',
	'incompatible',
];

/** Closed validation of everything the manager sends. The manager is trusted
 * with credentials, never with the shape of a message. */
function parseFramedResponse(value: unknown): FramedResponse {
	if (!isRecord(value) || value.v !== FRAMED_CONNECTION_SCHEMA_VERSION)
		throw new Error('unsupported framed connection message');
	switch (value.type) {
		case 'connections.result':
			return {
				type: 'connections.result',
				requestId: framedId(value.requestId),
				result: parseFramedResult(value.result),
			};
		case 'connections.error':
			if (typeof value.code !== 'string' || typeof value.message !== 'string')
				throw new Error('invalid framed connection error');
			return {
				type: 'connections.error',
				requestId: framedId(value.requestId),
				code: value.code,
				message: value.message,
			};
		case 'connections.changed':
			return {
				type: 'connections.changed',
				profiles: parseFramedProfiles(value.profiles),
			};
		default:
			throw new Error('unknown framed connection message');
	}
}

function parseFramedResult(value: unknown): FramedResult {
	if (!isRecord(value)) throw new Error('invalid framed connection result');
	switch (value.kind) {
		case 'profiles':
			return { kind: 'profiles', profiles: parseFramedProfiles(value.profiles) };
		case 'attached':
			return {
				kind: 'attached',
				profileId: framedId(value.profileId),
				serverId: framedId(value.serverId),
			};
		case 'detached':
			return { kind: 'detached', profileId: framedId(value.profileId) };
		case 'composition':
			return value.composition === undefined
				? { kind: 'composition' }
				: {
						kind: 'composition',
						composition: parseFramedComposition(value.composition),
					};
		case 'ok':
			return { kind: 'ok' };
		default:
			throw new Error('unknown framed connection result');
	}
}

function parseFramedProfiles(
	value: unknown,
): readonly AttachedConnectionProfile[] {
	if (!Array.isArray(value) || value.length > 128)
		throw new Error('invalid framed connection profiles');
	return Object.freeze(
		value.map((entry) => {
			if (!isRecord(entry)) throw new Error('invalid framed connection profile');
			const status = entry.status;
			if (
				typeof status !== 'string' ||
				!(FRAMED_STATUSES as readonly string[]).includes(status)
			)
				throw new Error('invalid framed connection status');
			if (
				typeof entry.label !== 'string' ||
				entry.label.length === 0 ||
				entry.label.length > 128
			)
				throw new Error('invalid framed connection label');
			return Object.freeze({
				id: framedId(entry.id),
				label: entry.label,
				status: status as TerminayHostConnectionStatus,
				...(entry.serverId === undefined
					? {}
					: { serverId: framedId(entry.serverId) }),
			});
		}),
	);
}

function parseFramedComposition(value: unknown): TerminayWorkspaceComposition {
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		!Array.isArray(value.attached) ||
		!Array.isArray(value.tabOrder)
	)
		throw new Error('invalid workspace composition');
	return Object.freeze({
		version: 1,
		primaryProfileId: framedId(value.primaryProfileId),
		attached: Object.freeze(
			value.attached.map((entry) => {
				if (!isRecord(entry)) throw new Error('invalid attached entry');
				return Object.freeze({
					profileId: framedId(entry.profileId),
					...(entry.viewId === undefined
						? {}
						: { viewId: framedId(entry.viewId) }),
				});
			}),
		),
		tabOrder: Object.freeze(
			value.tabOrder.map((entry) => {
				if (!isRecord(entry)) throw new Error('invalid tab handle');
				return Object.freeze({
					serverId: framedId(entry.serverId),
					projectId: framedId(entry.projectId),
				});
			}),
		),
	});
}

function framedId(value: unknown): string {
	if (typeof value !== 'string' || !FRAMED_ID.test(value))
		throw new Error('invalid framed connection identifier');
	return value;
}

function isBytePort(value: unknown): value is ServerMessagePort {
	return (
		isRecord(value) &&
		typeof (value as unknown as ServerMessagePort).postMessage === 'function'
	);
}

function framedManagerOrigin(managerUrl: unknown): string | undefined {
	if (typeof managerUrl !== 'string' || managerUrl.length === 0)
		return undefined;
	try {
		return new URL(managerUrl).origin;
	} catch {
		return undefined;
	}
}

function isFramedWindow(win: Pick<Window, 'parent'>): boolean {
	try {
		return win.parent !== win;
	} catch {
		return true;
	}
}
