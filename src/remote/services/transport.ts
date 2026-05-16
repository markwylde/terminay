import type { RemoteServerMessage } from '../protocol';
import type {
	OutboundClientMessage,
	RemoteMessageSocket,
	RemoteSocketState,
} from './socket';
import { RemoteSocket } from './socket';

export type RemoteTransportMode = 'local' | 'webrtc';

export type RemoteApiTransport = {
	postJson<TResponse>(pathname: string, body: unknown): Promise<TResponse>;
};

export type RemoteTerminalTransport = {
	createSocket(
		ticket: string,
		onMessage: (message: RemoteServerMessage) => void,
		onStateChange: (state: RemoteSocketState) => void,
		websocketUrl?: string,
	): RemoteMessageSocket;
};

type RemoteRuntimeConfig = {
	relayOrigin?: string;
	sessionId?: string;
	transport?: RemoteTransportMode;
};

type WebRtcApiRequest = {
	body: unknown;
	id: string;
	pathname: string;
	sessionId?: string;
	type: 'api-request';
};

type WebRtcApiResponse = {
	body?: unknown;
	error?: string;
	id: string;
	ok: boolean;
	type: 'api-response';
};

type WebRtcBootstrap = {
	apiChannel?: RTCDataChannel;
	getChannel?: (
		name: 'api' | 'terminal',
	) => RTCDataChannel | Promise<RTCDataChannel>;
	relayOrigin?: string;
	sessionId?: string;
	terminalChannel?: RTCDataChannel;
};

type RemoteWindow = Window & {
	__TERMINAY_REMOTE_CONFIG__?: RemoteRuntimeConfig;
	__TERMINAY_REMOTE_WEBRTC__?: WebRtcBootstrap;
};

export type RemoteTransportRuntime = {
	api: RemoteApiTransport;
	mode: RemoteTransportMode;
	pairingOrigin: string;
	terminal: RemoteTerminalTransport;
};

const WEBRTC_SESSION_STORAGE_KEY = 'terminay-remote-transport';
const WEBRTC_SESSION_ID_STORAGE_KEY = 'terminay-remote-webrtc-session-id';
const TERMINAY_MANAGER_HOST = 'app.terminay.com';
const TERMINAY_REMOTE_DOMAIN = 'terminay.com';

function getRemoteWindow(): RemoteWindow {
	return window as RemoteWindow;
}

function normalizeTransportMode(value: unknown): RemoteTransportMode | null {
	return value === 'webrtc' || value === 'local' ? value : null;
}

function getQueryTransportMode(
	searchParams: URLSearchParams,
): RemoteTransportMode | null {
	const value = searchParams.get('transport') ?? searchParams.get('mode');
	return normalizeTransportMode(value);
}

function getSessionTransportMode(): RemoteTransportMode | null {
	try {
		const value = sessionStorage.getItem(WEBRTC_SESSION_STORAGE_KEY);
		return normalizeTransportMode(value);
	} catch {
		return null;
	}
}

function persistRuntimeHints(
	mode: RemoteTransportMode,
	sessionId?: string,
): void {
	try {
		sessionStorage.setItem(WEBRTC_SESSION_STORAGE_KEY, mode);
		if (sessionId) {
			sessionStorage.setItem(WEBRTC_SESSION_ID_STORAGE_KEY, sessionId);
		}
	} catch {
		// Session storage may be unavailable in hardened/private browser modes.
	}
}

function getSessionId(
	searchParams: URLSearchParams,
	config: RemoteRuntimeConfig,
	bridge?: WebRtcBootstrap,
): string | undefined {
	const querySessionId =
		searchParams.get('sessionId') ??
		searchParams.get('webrtcSessionId') ??
		undefined;
	if (querySessionId) {
		return querySessionId;
	}
	if (config.sessionId) {
		return config.sessionId;
	}
	if (bridge?.sessionId) {
		return bridge.sessionId;
	}
	try {
		return sessionStorage.getItem(WEBRTC_SESSION_ID_STORAGE_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}

function createPairingOrigin(
	mode: RemoteTransportMode,
	relayOrigin?: string,
): string {
	if (mode === 'local') {
		return window.location.origin;
	}

	const relayMarker = relayOrigin ? `:${relayOrigin}` : '';
	return `${window.location.origin}#transport=webrtc${relayMarker}`;
}

function isTerminaySessionHost(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return (
		normalized !== TERMINAY_MANAGER_HOST &&
		normalized.endsWith(`.${TERMINAY_REMOTE_DOMAIN}`) &&
		/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.terminay\.com$/.test(normalized)
	);
}

async function postJson<TResponse>(
	pathname: string,
	body: unknown,
): Promise<TResponse> {
	const response = await fetch(pathname, {
		body: JSON.stringify(body),
		headers: {
			'content-type': 'application/json',
		},
		method: 'POST',
	});

	const payload = (await response.json().catch(() => ({}))) as {
		error?: string;
	} & TResponse;

	if (!response.ok) {
		throw new Error(payload.error ?? 'Request failed.');
	}

	return payload;
}

class LocalApiTransport implements RemoteApiTransport {
	postJson<TResponse>(pathname: string, body: unknown): Promise<TResponse> {
		return postJson<TResponse>(pathname, body);
	}
}

class LocalTerminalTransport implements RemoteTerminalTransport {
	createSocket(
		_ticket: string,
		onMessage: (message: RemoteServerMessage) => void,
		onStateChange: (state: RemoteSocketState) => void,
		websocketUrl?: string,
	): RemoteMessageSocket {
		if (!websocketUrl) {
			throw new Error('The remote host did not provide a WebSocket URL.');
		}

		return new RemoteSocket(websocketUrl, onMessage, onStateChange);
	}
}

function isWebRtcApiResponse(value: unknown): value is WebRtcApiResponse {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as WebRtcApiResponse).type === 'api-response' &&
		typeof (value as WebRtcApiResponse).id === 'string' &&
		typeof (value as WebRtcApiResponse).ok === 'boolean'
	);
}

function waitForOpenChannel(channel: RTCDataChannel): Promise<void> {
	if (channel.readyState === 'open') {
		return Promise.resolve();
	}
	if (channel.readyState === 'closing' || channel.readyState === 'closed') {
		return Promise.reject(new Error('WebRTC data channel is closed.'));
	}

	return new Promise<void>((resolve, reject) => {
		const handleOpen = () => {
			cleanup();
			resolve();
		};
		const handleClose = () => {
			cleanup();
			reject(new Error('WebRTC data channel closed before it opened.'));
		};
		const handleError = () => {
			cleanup();
			reject(new Error('WebRTC data channel failed.'));
		};
		const cleanup = () => {
			channel.removeEventListener('open', handleOpen);
			channel.removeEventListener('close', handleClose);
			channel.removeEventListener('error', handleError);
		};

		channel.addEventListener('open', handleOpen);
		channel.addEventListener('close', handleClose);
		channel.addEventListener('error', handleError);
	});
}

function parseJsonMessage(raw: unknown): unknown {
	if (typeof raw !== 'string') {
		return null;
	}

	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
}

async function resolveWebRtcChannel(
	name: 'api' | 'terminal',
): Promise<RTCDataChannel> {
	const bridge = getRemoteWindow().__TERMINAY_REMOTE_WEBRTC__;
	const directChannel =
		name === 'api' ? bridge?.apiChannel : bridge?.terminalChannel;

	if (directChannel) {
		return directChannel;
	}
	if (bridge?.getChannel) {
		return bridge.getChannel(name);
	}

	throw new Error(
		'WebRTC transport is not ready. Reopen this page from the Terminay WebRTC QR code.',
	);
}

class WebRtcApiTransport implements RemoteApiTransport {
	private requestSequence = 0;
	private readonly pending = new Map<
		string,
		{
			reject: (reason?: unknown) => void;
			resolve: (value: unknown) => void;
		}
	>();
	private channelPromise: Promise<RTCDataChannel> | null = null;

	constructor(private readonly sessionId?: string) {}

	async postJson<TResponse>(
		pathname: string,
		body: unknown,
	): Promise<TResponse> {
		const channel = await this.getChannel();
		this.requestSequence += 1;
		const id = `api-${Date.now()}-${this.requestSequence}`;
		const request: WebRtcApiRequest = {
			body,
			id,
			pathname,
			sessionId: this.sessionId,
			type: 'api-request',
		};

		return new Promise<TResponse>((resolve, reject) => {
			this.pending.set(id, {
				reject,
				resolve: (value) => resolve(value as TResponse),
			});
			channel.send(JSON.stringify(request));
		});
	}

	private async getChannel(): Promise<RTCDataChannel> {
		this.channelPromise ??= this.initializeChannel();
		return this.channelPromise;
	}

	private async initializeChannel(): Promise<RTCDataChannel> {
		const channel = await resolveWebRtcChannel('api');
		await waitForOpenChannel(channel);
		channel.addEventListener('message', (event) => {
			const message = parseJsonMessage(event.data);
			if (!isWebRtcApiResponse(message)) {
				return;
			}

			const pending = this.pending.get(message.id);
			if (!pending) {
				return;
			}

			this.pending.delete(message.id);
			if (message.ok) {
				pending.resolve(message.body);
			} else {
				pending.reject(new Error(message.error ?? 'Request failed.'));
			}
		});
		channel.addEventListener('close', () => {
			this.rejectPending(new Error('WebRTC API channel closed.'));
		});
		channel.addEventListener('error', () => {
			this.rejectPending(new Error('WebRTC API channel failed.'));
		});

		return channel;
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
	}
}

class WebRtcTerminalSocket implements RemoteMessageSocket {
	private channel: RTCDataChannel | null = null;
	private connectionId = '';
	private hasHandshake = false;
	private sequence = 0;

	constructor(
		private readonly ticket: string,
		private readonly onMessage: (message: RemoteServerMessage) => void,
		private readonly onStateChange: (state: RemoteSocketState) => void,
	) {}

	async connect(): Promise<void> {
		this.onStateChange('connecting');
		this.connectionId = '';
		this.sequence = 0;
		this.hasHandshake = false;

		const channel = await resolveWebRtcChannel('terminal');
		this.channel = channel;
		await waitForOpenChannel(channel);

		await new Promise<void>((resolve, reject) => {
			let settled = false;

			const handleMessage = (event: MessageEvent<string>) => {
				const message = parseJsonMessage(
					event.data,
				) as RemoteServerMessage | null;
				if (!message || typeof message !== 'object' || !('type' in message)) {
					return;
				}

				if (message.type === 'session-list') {
					this.connectionId = message.connectionId;
					if (!this.hasHandshake) {
						this.hasHandshake = true;
						if (!settled) {
							settled = true;
							this.onStateChange('live');
							resolve();
						}
					}
				}
				this.onMessage(message);
			};

			const handleClose = () => {
				if (!settled) {
					settled = true;
					reject(
						new Error(
							'WebRTC terminal channel closed before initialization completed.',
						),
					);
				}
				this.hasHandshake = false;
				this.connectionId = '';
				this.onStateChange('closed');
			};

			const handleError = () => {
				if (!settled) {
					settled = true;
					reject(new Error('WebRTC terminal channel failed.'));
				}
			};

			channel.addEventListener('message', handleMessage);
			channel.addEventListener('close', handleClose);
			channel.addEventListener('error', handleError);
			channel.send(
				JSON.stringify({ ticket: this.ticket, type: 'terminal-auth' }),
			);
		});
	}

	close(): void {
		this.channel?.close();
		this.channel = null;
	}

	send(message: OutboundClientMessage): void {
		if (
			!this.channel ||
			this.channel.readyState !== 'open' ||
			!this.hasHandshake ||
			!this.connectionId
		) {
			throw new Error('The remote connection is not open.');
		}

		this.sequence += 1;
		this.channel.send(
			JSON.stringify({
				...message,
				connectionId: this.connectionId,
				seq: this.sequence,
			}),
		);
	}
}

class WebRtcTerminalTransport implements RemoteTerminalTransport {
	createSocket(
		ticket: string,
		onMessage: (message: RemoteServerMessage) => void,
		onStateChange: (state: RemoteSocketState) => void,
	): RemoteMessageSocket {
		return new WebRtcTerminalSocket(ticket, onMessage, onStateChange);
	}
}

export function createRemoteTransportRuntime(): RemoteTransportRuntime {
	const remoteWindow = getRemoteWindow();
	const searchParams = new URL(window.location.href).searchParams;
	const config = remoteWindow.__TERMINAY_REMOTE_CONFIG__ ?? {};
	const bridge = remoteWindow.__TERMINAY_REMOTE_WEBRTC__;
	const isManagerHost = window.location.hostname.toLowerCase() === TERMINAY_MANAGER_HOST;
	const queryMode = isManagerHost ? null : getQueryTransportMode(searchParams);
	const configMode = normalizeTransportMode(config.transport);
	const sessionMode = getSessionTransportMode();
	const hasExplicitWebRtcRuntime = Boolean(bridge ?? config.sessionId);
	const hostedWebRtcMode =
		hasExplicitWebRtcRuntime || isTerminaySessionHost(window.location.hostname);
	const mode =
		configMode ??
		queryMode ??
		sessionMode ??
		(hostedWebRtcMode ? 'webrtc' : 'local');
	const sessionId = getSessionId(searchParams, config, bridge);
	const relayOrigin = config.relayOrigin ?? bridge?.relayOrigin;

	persistRuntimeHints(mode, sessionId);

	if (mode === 'webrtc') {
		return {
			api: new WebRtcApiTransport(sessionId),
			mode,
			pairingOrigin: createPairingOrigin(mode, relayOrigin),
			terminal: new WebRtcTerminalTransport(),
		};
	}

	return {
		api: new LocalApiTransport(),
		mode,
		pairingOrigin: createPairingOrigin(mode),
		terminal: new LocalTerminalTransport(),
	};
}
