import { isTerminayManagerHost } from '@terminay/protocol';
import { getSessionTransportHost } from '../../web/sessionTransportHost';

export type RemoteTransportMode = 'local' | 'webrtc';
export type RemoteApiTransport = { postJson<TResponse>(pathname: string, body: unknown): Promise<TResponse> };
type RemoteRuntimeConfig = { relayOrigin?: string; sessionId?: string; transport?: RemoteTransportMode };
type RemoteWindow = Window & { __TERMINAY_REMOTE_CONFIG__?: RemoteRuntimeConfig };
export type RemoteTransportRuntime = { api: RemoteApiTransport; mode: RemoteTransportMode; pairingOrigin: string };

const WEBRTC_SESSION_STORAGE_KEY = 'terminay-remote-transport';
const WEBRTC_SESSION_ID_STORAGE_KEY = 'terminay-remote-webrtc-session-id';
const TERMINAY_REMOTE_DOMAIN = 'terminay.com';

class LocalApiTransport implements RemoteApiTransport {
	async postJson<TResponse>(pathname: string, body: unknown): Promise<TResponse> {
		const response = await fetch(pathname, { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST' });
		const payload = (await response.json().catch(() => ({}))) as { error?: string } & TResponse;
		if (!response.ok) throw new Error(payload.error ?? 'Request failed.');
		return payload;
	}
}

class HostedBootstrapApiTransport implements RemoteApiTransport {
	postJson<TResponse>(pathname: string, body: unknown): Promise<TResponse> {
		const host = getSessionTransportHost();
		if (host === undefined) throw new Error('Session bootstrap API is unavailable.');
		return host.postJson<TResponse>(pathname, body);
	}
}

export function createRemoteTransportRuntime(): RemoteTransportRuntime {
	const config = (window as RemoteWindow).__TERMINAY_REMOTE_CONFIG__ ?? {};
	const host = getSessionTransportHost();
	const searchParams = new URL(window.location.href).searchParams;
	const manager = isTerminayManagerHost(window.location.hostname);
	const query = normalizeMode(searchParams.get('transport') ?? searchParams.get('mode'));
	const stored = readStoredMode();
	const hosted = host !== undefined || isSessionHost(window.location.hostname);
	const mode = normalizeMode(config.transport) ?? (manager ? null : query) ?? stored ?? (hosted ? 'webrtc' : 'local');
	const sessionId = searchParams.get('sessionId') ?? config.sessionId ?? host?.sessionId ?? readStoredSessionId();
	const relayOrigin = config.relayOrigin ?? host?.origin;
	persist(mode, sessionId ?? undefined);
	return {
		api: mode === 'webrtc' ? new HostedBootstrapApiTransport() : new LocalApiTransport(),
		mode,
		pairingOrigin: mode === 'local'
			? window.location.origin
			: `${window.location.origin}#transport=webrtc${relayOrigin ? `:${relayOrigin}` : ''}`,
	};
}

function normalizeMode(value: unknown): RemoteTransportMode | null {
	return value === 'local' || value === 'webrtc' ? value : null;
}
function isSessionHost(hostname: string): boolean {
	const value = hostname.toLowerCase();
	return !isTerminayManagerHost(value) && value.endsWith(`.${TERMINAY_REMOTE_DOMAIN}`) && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.terminay\.com$/u.test(value);
}
function readStoredMode(): RemoteTransportMode | null {
	try { return normalizeMode(sessionStorage.getItem(WEBRTC_SESSION_STORAGE_KEY)); } catch { return null; }
}
function readStoredSessionId(): string | null {
	try { return sessionStorage.getItem(WEBRTC_SESSION_ID_STORAGE_KEY); } catch { return null; }
}
function persist(mode: RemoteTransportMode, sessionId?: string): void {
	try {
		sessionStorage.setItem(WEBRTC_SESSION_STORAGE_KEY, mode);
		if (sessionId) sessionStorage.setItem(WEBRTC_SESSION_ID_STORAGE_KEY, sessionId);
	} catch { /* Storage can be unavailable in hardened browser modes. */ }
}
