import { constants, verify as verifySignature } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns';
import path from 'node:path';
import QRCode from 'qrcode';
import WebSocket from 'ws';
import type { RemoteAccessStatus } from '../../src/types/terminay';
import type { RemoteAccessSettings } from '../../src/types/settings';
import {
	parseRemoteClientMessage,
	type RemoteClientMessage,
	type RemoteServerMessage,
	type RemoteSessionSnapshot,
	type RemoteSessionSummary,
} from './deployedTerminalProtocol';
import { ChallengeStore, serializeDeviceChallenge } from './challengeStore';
import { AuditStore } from './auditStore';
import { ConnectionStore, type RemoteConnectionPeer } from './connectionStore';
import { DeviceStore } from './deviceStore';
import { PairingManager } from './pairing';
import { WebRtcPairingManager } from './webrtc';
import {
	parseSignalingMessage,
	serializeSignalingMessage,
} from './signalingBoundary';
import {
	buildServerUiArchive,
	type ServerUiArchive,
} from './serverUiArchive';

type TerminalRemoteMetadata = {
	color: string;
	emoji: string;
	inheritsProjectColor?: boolean;
	title: string;
	viewportHeight?: number;
	viewportWidth?: number;
	projectId?: string;
	projectTitle?: string;
	projectEmoji?: string;
	projectColor?: string;
};

type SessionRecord = {
	buffer: string;
	cols: number;
	exitCode: number | null;
	metadata: TerminalRemoteMetadata;
	rows: number;
};

type RemoteSizeOverride =
	| { active: false }
	| {
			active: true;
			cols: number;
			rows: number;
	  };

/**
 * The remote exposure service deliberately has no Electron runtime import.
 * Its structural `app` input exists only to resolve the Desktop-owned data
 * directory; standalone hosts provide that concrete path directly.
 */
export type RemoteAccessServiceOptions = {
	app?: { getPath: (name: 'userData') => string };
	createWebRtcHostWindow: (ownerId: number) => {
		close: () => void;
		closeTerminal: (channelId: string, reason?: string) => void;
		onDestroyed?: (listener: () => void) => () => void;
		sendConfig: (config: WebRtcHostConfig) => void;
		sendSignalMessage: (message: unknown) => void;
		sendTerminalMessage: (channelId: string, message: string) => void;
		webContentsId: number;
	};
	getControllableSession: (sessionId: string) => {
		close: () => void | Promise<void>;
		resize: (cols: number, rows: number) => void | Promise<void>;
		write: (data: string) => void | Promise<void>;
	} | null;
	getRemoteAccessSettings: () => RemoteAccessSettings;
	notifyTerminalRemoteSizeOverride: (
		sessionId: string,
		override: RemoteSizeOverride,
	) => void;
	onStatusChanged: (status: RemoteAccessStatus) => void;
	publicDir: string;
	rendererDistDir: string;
	userDataPath?: string;
	/** Authenticated server identity bound to the hosted UI bootstrap. */
	serverId: string;
	serverVersion?: string;
};

type WebRtcHostConfig = {
	appOrigin: string;
	expiresAt: string;
	iceServers: RTCIceServer[];
	relayJoinTokenHash: string;
	roomId: string;
	sessionId: string;
	signalingUrl: string;
};

type WebRtcTerminalPeer = RemoteConnectionPeer & {
	channelId: string;
	webContentsId: number;
};

type WebRtcHostRuntime = {
	hostWindow: ReturnType<RemoteAccessServiceOptions['createWebRtcHostWindow']>;
	pendingSignalMessages: string[];
	phase: 'waiting' | 'pairing' | 'connected' | 'failed';
	ready: boolean;
	removeDestroyedListener?: () => void;
	signalSocket: WebSocket | null;
};

const MAX_BUFFER_LENGTH = 200_000;
const MAX_SESSION_SNAPSHOT_BUFFER_LENGTH = 50_000;

type DnsLookupOptions = {
	all?: boolean;
	family?: number;
	hints?: number;
	verbatim?: boolean;
};

type DnsLookupCallback = (
	error: NodeJS.ErrnoException | null,
	address: string | Array<{ address: string; family: number }>,
	family?: number,
) => void;

function resolveSessionLocalhost(
	hostname: string,
	options: DnsLookupOptions,
	callback: DnsLookupCallback,
): void {
	if (hostname.toLowerCase().endsWith('.localhost')) {
		if (options.all) {
			callback(null, [{ address: '127.0.0.1', family: 4 }]);
		} else {
			callback(null, '127.0.0.1', 4);
		}
		return;
	}

	const lookup = dnsLookup as (
		hostname: string,
		options: DnsLookupOptions,
		callback: DnsLookupCallback,
	) => void;
	lookup(hostname, options, callback);
}

export function createWebRtcSignalingSocketOptions(
	signalingUrl: string,
	origin: string,
) {
	const options = { origin } as WebSocket.ClientOptions & {
		lookup?: typeof resolveSessionLocalhost;
	};
	const url = new URL(signalingUrl);
	if (
		url.protocol === 'ws:' &&
		url.hostname.toLowerCase().endsWith('.localhost')
	) {
		options.lookup = resolveSessionLocalhost;
	}
	return options;
}


function appendToBuffer(current: string, chunk: string): string {
	const next = current + chunk;
	if (next.length <= MAX_BUFFER_LENGTH) {
		return next;
	}

	return next.slice(next.length - MAX_BUFFER_LENGTH);
}

function normalizePem(value: string): string {
	return value.replace(/\r\n/g, '\n').trim();
}

export function parseWebRtcIceServers(value: string): RTCIceServer[] {
	const input = String(value ?? '').trim();
	if (!input) {
		return [{ urls: 'stun:stun.l.google.com:19302' }];
	}
	if (input.length > 32 * 1024) {
		throw new Error('WebRTC ICE server configuration exceeds 32 KiB.');
	}

	if (input.startsWith('[')) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(input);
		} catch {
			throw new Error('WebRTC ICE server JSON is invalid.');
		}
		if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 8) {
			throw new Error(
				'WebRTC ICE server JSON must contain between 1 and 8 entries.',
			);
		}
		return parsed.map((entry) => normalizeStructuredIceServer(entry));
	}

	const urls = input
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (urls.length < 1 || urls.length > 16) {
		throw new Error(
			'WebRTC ICE server URL list must contain between 1 and 16 entries.',
		);
	}
	return urls.map((url) => {
		assertIceServerUrl(url);
		return { urls: url };
	});
}

function normalizeStructuredIceServer(value: unknown): RTCIceServer {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Each WebRTC ICE server entry must be an object.');
	}
	const entry = value as Record<string, unknown>;
	const allowedKeys = new Set(['credential', 'urls', 'username']);
	if (Object.keys(entry).some((key) => !allowedKeys.has(key))) {
		throw new Error('WebRTC ICE server entries contain an unsupported field.');
	}
	const urls =
		typeof entry.urls === 'string'
			? [entry.urls]
			: Array.isArray(entry.urls) &&
					entry.urls.every((url) => typeof url === 'string')
				? entry.urls
				: null;
	if (!urls || urls.length < 1 || urls.length > 4) {
		throw new Error(
			'Each WebRTC ICE server entry requires between 1 and 4 URLs.',
		);
	}
	for (const url of urls) assertIceServerUrl(url);

	const hasUsername = Reflect.has(entry, 'username');
	const hasCredential = Reflect.has(entry, 'credential');
	if (hasUsername !== hasCredential) {
		throw new Error('TURN username and credential must be supplied together.');
	}
	if (hasUsername) {
		if (
			typeof entry.username !== 'string' ||
			entry.username.length < 1 ||
			entry.username.length > 512 ||
			typeof entry.credential !== 'string' ||
			entry.credential.length < 1 ||
			entry.credential.length > 2048
		) {
			throw new Error('TURN username or credential has an invalid length.');
		}
		if (urls.some((url) => !/^turns?:/i.test(url))) {
			throw new Error('WebRTC ICE credentials apply only to TURN URLs.');
		}
	}

	return {
		...(hasCredential
			? {
					credential: entry.credential as string,
					username: entry.username as string,
				}
			: {}),
		urls: typeof entry.urls === 'string' ? urls[0] : urls,
	};
}

function assertIceServerUrl(value: string): void {
	if (
		value.length < 1 ||
		value.length > 2048 ||
		!/^(stun|stuns|turn|turns):/i.test(value) ||
		value.includes('@') ||
		/\s/.test(value) ||
		Array.from(value).some((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint < 0x20 || codePoint === 0x7f;
		})
	) {
		throw new Error('WebRTC ICE server configuration contains an invalid URL.');
	}
}

export class RemoteAccessService {
	private readonly auditStore: AuditStore;
	private readonly clientOperationQueues = new Map<string, Promise<void>>();
	private readonly challengeStore = new ChallengeStore();
	private readonly connectionStore = new ConnectionStore();
	private readonly createWebRtcHostWindow: RemoteAccessServiceOptions['createWebRtcHostWindow'];
	private readonly deviceStore: DeviceStore;
	private readonly getControllableSession: RemoteAccessServiceOptions['getControllableSession'];
	private readonly getRemoteAccessSettings: RemoteAccessServiceOptions['getRemoteAccessSettings'];
	private readonly notifyTerminalRemoteSizeOverride: RemoteAccessServiceOptions['notifyTerminalRemoteSizeOverride'];
	private readonly onStatusChanged: RemoteAccessServiceOptions['onStatusChanged'];
	private readonly pairingManager = new PairingManager();
	private readonly publicDir: string;
	private readonly remoteDir: string;
	private readonly rendererDistDir: string;
	private readonly remoteSizeOverrideOwners = new Map<
		string,
		{ cols: number; connectionId: string; rows: number }
	>();
	private readonly sessions = new Map<string, SessionRecord>();
	private errorMessage: string | null = null;
	private readonly webRtcPairingManager = new WebRtcPairingManager();
	private webRtcPairingExpiresAt: string | null = null;
	private webRtcPairingQrCodeDataUrl: string | null = null;
	private webRtcPairingUrl: string | null = null;
	private webRtcRoomId: string | null = null;
	private webRtcSessionId: string | null = null;
	private webRtcActivePairingWebContentsId: number | null = null;
	private webRtcHostConfigByWebContentsId = new Map<number, WebRtcHostConfig>();
	private readonly webRtcHostRuntimesByWebContentsId = new Map<
		number,
		WebRtcHostRuntime
	>();
	/** Immutable archive promise, prepared at most once per built server UI. */
	private webRtcUiArchive: Promise<ServerUiArchive> | undefined;
	private readonly webRtcTerminalConnectionsByChannelId = new Map<
		string,
		string
	>();
	private readonly webRtcApplicationConnectionsByChannelId = new Map<
		string,
		string
	>();
	private webRtcStatus: RemoteAccessStatus['webRtcStatus'] = 'not-configured';
	private webRtcStatusMessage: string | null = null;
	private readonly serverId: string;

	constructor(options: RemoteAccessServiceOptions) {
		const userDataPath =
			options.userDataPath ?? options.app?.getPath('userData');
		if (typeof userDataPath !== 'string' || userDataPath.length === 0) {
			throw new TypeError('remote access user data path is required');
		}
		this.createWebRtcHostWindow = options.createWebRtcHostWindow;
		this.getControllableSession = options.getControllableSession;
		this.getRemoteAccessSettings = options.getRemoteAccessSettings;
		this.notifyTerminalRemoteSizeOverride =
			options.notifyTerminalRemoteSizeOverride;
		this.onStatusChanged = options.onStatusChanged;
		this.publicDir = options.publicDir;
		this.rendererDistDir = options.rendererDistDir;
		if (typeof options.serverId !== 'string' || options.serverId.length === 0)
			throw new TypeError('remote access server identity is required');
		this.serverId = options.serverId;
		this.remoteDir = path.join(userDataPath, 'remote-access');
		this.auditStore = new AuditStore(
			path.join(this.remoteDir, 'audit-log.json'),
		);
		this.deviceStore = new DeviceStore(
			path.join(this.remoteDir, 'devices.json'),
		);
	}

	getStatus(): RemoteAccessStatus {
		const webRtcHostReady = this.isActiveWebRtcHostReady();

		return {
			activeConnectionCount: this.connectionStore.count(),
			pendingApprovals: [],
			pendingWebRtcConnectionCount: this.getPendingWebRtcConnectionCount(),
			auditEvents: this.auditStore.listRecent(),
			connections: this.connectionStore.list().map((connection) => {
				const device = this.deviceStore.get(connection.deviceId);
				return {
					attachedSessionCount: connection.attachedSessionIds.size,
					connectionId: connection.connectionId,
					deviceId: connection.deviceId,
					deviceName: device?.name ?? 'Unknown Device',
				};
			}),
			configurationIssue: null,
			configurationPath: 'File > Settings > Remote Access',
			errorMessage: this.errorMessage,
			isRunning: this.isRunning(),
			pairedDeviceCount: this.deviceStore.listActive().length,
			pairedDevices: this.deviceStore.listActive().map((device) => ({
					addedAt: device.addedAt,
					deviceId: device.id,
					lastSeenAt: device.lastSeenAt,
					name: device.name,
			})),
			webRtcPairingExpiresAt: this.webRtcPairingExpiresAt,
			webRtcPairingQrCodeDataUrl: this.webRtcPairingQrCodeDataUrl,
			webRtcPairingUrl: this.webRtcPairingUrl,
			webRtcRoomId: this.webRtcRoomId,
			webRtcStatus: webRtcHostReady ? 'pairing-ready' : this.webRtcStatus,
			webRtcStatusMessage:
				this.webRtcStatusMessage ??
				(this.webRtcPairingUrl
					? 'The WebRTC pairing room exists, but this Terminay host is not ready yet. Keep Terminay open and retry; check Remote Access settings if this persists.'
					: null),
		};
	}

	notifyStatusChanged(): void {
		this.emitStatus();
	}

	async toggle(): Promise<RemoteAccessStatus> {
		if (this.isRunning()) {
			await this.stop();
			return this.getStatus();
		}

		try {
			await this.start();
		} catch {
			// `start()` records the configuration/runtime error into service state.
			// The renderer should receive status, not a thrown IPC exception.
		}
		return this.getStatus();
	}

	async revokeDevice(deviceId: string): Promise<RemoteAccessStatus> {
		const device = this.deviceStore.get(deviceId);
		await this.deviceStore.revoke(deviceId);
		for (const connection of this.connectionStore.list()) {
			if (connection.deviceId === deviceId) {
				this.clearRemoteSizeOverridesForConnection(connection.connectionId);
			}
		}
		this.connectionStore.closeConnectionsForDevice(deviceId);
		await this.auditStore.append({
			action: 'device-revoked',
			connectionId: null,
			deviceId,
			deviceName: device?.name ?? null,
		});
		this.emitStatus();
		return this.getStatus();
	}

	async closeConnection(connectionId: string): Promise<RemoteAccessStatus> {
		const connection = this.connectionStore.get(connectionId);
		if (connection) {
			const device = this.deviceStore.get(connection.deviceId);
			await this.auditStore.append({
				action: 'connection-revoked',
				connectionId,
				deviceId: connection.deviceId,
				deviceName: device?.name ?? null,
			});
			this.clearRemoteSizeOverridesForConnection(connectionId);
			this.connectionStore.closeConnection(
				connectionId,
				4002,
				'Connection closed by host',
			);
		}

		this.emitStatus();
		return this.getStatus();
	}

	ensureSession(id: string): void {
		if (!this.sessions.has(id)) {
			this.sessions.set(id, {
				buffer: '',
				cols: 80,
				exitCode: null,
				metadata: {
					color: '#4db5ff',
					emoji: '',
					title: 'Terminal',
					viewportHeight: 0,
					viewportWidth: 0,
				},
				rows: 24,
			});
		}

		this.broadcast({
			session: this.toSessionSummary(id, this.sessions.get(id)!),
			type: 'session-updated',
		});
	}

	appendSessionData(id: string, data: string): void {
		const session = this.sessions.get(id);
		if (!session) {
			return;
		}

		session.buffer = appendToBuffer(session.buffer, data);
		for (const connection of this.connectionStore.list()) {
			if (connection.attachedSessionIds.has(id)) {
				this.send(connection.socket, {
					payload: data,
					sessionId: id,
					type: 'output',
				});
			}
		}
	}

	getSessionBuffer(id: string): string | null {
		const session = this.sessions.get(id);
		if (!session) {
			return null;
		}

		return session.buffer.length > MAX_SESSION_SNAPSHOT_BUFFER_LENGTH
			? session.buffer.slice(-MAX_SESSION_SNAPSHOT_BUFFER_LENGTH)
			: session.buffer;
	}

	markSessionExit(
		id: string,
		exitCode: number,
		signal: number | null = null,
	): void {
		const session = this.sessions.get(id);
		if (!session) {
			return;
		}

		session.exitCode = exitCode;
		this.broadcast({
			exitCode,
			sessionId: id,
			signal,
			type: 'exit',
		});
		this.removeSession(id);
	}

	removeSession(id: string): void {
		this.clearRemoteSizeOverride(id);
		this.sessions.delete(id);
		for (const connection of this.connectionStore.list()) {
			connection.attachedSessionIds.delete(id);
		}
		this.broadcast({ id, type: 'session-closed' });
	}

	updateSessionMetadata(
		id: string,
		metadata: Partial<TerminalRemoteMetadata>,
	): void {
		const session = this.sessions.get(id);
		if (!session) {
			return;
		}

		session.metadata = { ...session.metadata, ...metadata };
		this.broadcast({
			session: this.toSessionSummary(id, session),
			type: 'session-updated',
		});
	}

	updateSessionSize(id: string, cols: number, rows: number): void {
		const session = this.sessions.get(id);
		if (!session) {
			return;
		}

		const nextCols = Math.max(2, Math.floor(cols));
		const nextRows = Math.max(1, Math.floor(rows));
		if (session.cols === nextCols && session.rows === nextRows) {
			return;
		}

		session.cols = nextCols;
		session.rows = nextRows;
		this.broadcast({
			session: this.toSessionSummary(id, session),
			type: 'session-updated',
		});
	}

	private async start(): Promise<void> {
		this.errorMessage = null;

		try {
			await this.deviceStore.load();
			await this.auditStore.load();
			await this.rotateWebRtcPairingCode();
			this.emitStatus();
		} catch (error) {
			this.errorMessage =
				error instanceof Error
					? error.message
					: 'Unable to start remote access.';
			await this.stop();
			throw error;
		}
	}

	private async stop(): Promise<void> {
		for (const connection of this.connectionStore.list()) {
			connection.socket.close(1001, 'Remote access stopped');
		}
		this.clearAllRemoteSizeOverrides();

		this.webRtcPairingExpiresAt = null;
		this.webRtcPairingQrCodeDataUrl = null;
		this.webRtcPairingUrl = null;
		this.webRtcRoomId = null;
		this.webRtcActivePairingWebContentsId = null;
		this.closeWebRtcPairingHost();
		this.webRtcStatus = 'not-configured';
		this.webRtcStatusMessage = null;
		this.emitStatus();
	}

	private emitStatus(): void {
		this.onStatusChanged(this.getStatus());
	}

	private isActiveWebRtcHostReady(): boolean {
		return this.webRtcActivePairingWebContentsId !== null
			? this.webRtcHostRuntimesByWebContentsId.get(
					this.webRtcActivePairingWebContentsId,
				)?.ready === true
			: false;
	}

	private getPendingWebRtcConnectionCount(): number {
		let count = 0;
		for (const runtime of this.webRtcHostRuntimesByWebContentsId.values()) {
			if (runtime.phase === 'pairing') {
				count += 1;
			}
		}
		return count;
	}

	private isRunning(): boolean {
		return this.webRtcHostRuntimesByWebContentsId.size > 0;
	}

	private async rotateWebRtcPairingCode(): Promise<void> {
		const settings = this.getRemoteAccessSettings();

		try {
			this.webRtcStatus = 'registering';
			this.webRtcStatusMessage =
				'WebRTC relay room is registering. Keep Terminay open while the browser connects.';
			const payload = this.webRtcPairingManager.create({
				hostedDomain: settings.webRtcHostedDomain,
				sessionId: this.webRtcSessionId ?? undefined,
			});
			this.webRtcSessionId = payload.sessionId;
			this.webRtcPairingExpiresAt = payload.expiresAt;
			this.webRtcPairingUrl = payload.pairingUrl;
			this.webRtcRoomId = payload.roomId;
			this.pairingManager.adoptSession({
				expiresAt: payload.pairing.expiresAt,
				origin: this.createWebRtcPairingOrigin(payload.appOrigin),
				pairingSessionId: payload.pairing.sessionId,
				pairingToken: payload.pairing.token,
			});
			this.webRtcPairingQrCodeDataUrl = await QRCode.toDataURL(
				payload.pairingUrl,
				{
					errorCorrectionLevel: 'H',
					margin: 2,
					width: 720,
				},
			);
			this.openWebRtcPairingHost({
				appOrigin: payload.appOrigin,
				expiresAt: payload.expiresAt,
				iceServers: parseWebRtcIceServers(settings.webRtcIceServers),
				relayJoinTokenHash: payload.relayJoinTokenHash,
				roomId: payload.roomId,
				sessionId: payload.sessionId,
				signalingUrl: payload.signalingUrl,
			});
		} catch (error) {
			this.webRtcPairingExpiresAt = null;
			this.webRtcPairingUrl = null;
			this.webRtcRoomId = null;
			this.webRtcActivePairingWebContentsId = null;
			this.webRtcPairingQrCodeDataUrl = null;
			this.webRtcStatus = 'error';
			this.webRtcStatusMessage =
				error instanceof Error
					? error.message
					: 'Unable to generate WebRTC pairing QR.';
		}
	}

	private createWebRtcPairingOrigin(appOrigin: string): string {
		return new URL(appOrigin).origin;
	}

	private createWebRtcSessionId(appOrigin: string): string {
		try {
			return new URL(appOrigin).hostname.split('.')[0] || appOrigin;
		} catch {
			return appOrigin;
		}
	}

	private closeWebRtcPairingHost(): void {
		for (const webContentsId of Array.from(
			this.webRtcHostRuntimesByWebContentsId.keys(),
		)) {
			this.closeWebRtcHostRuntime(webContentsId, 'Pairing stopped');
		}
		this.webRtcActivePairingWebContentsId = null;
	}

	private closeWebRtcSignalSocket(
		runtime: WebRtcHostRuntime,
		reason = 'Pairing rotated',
	): void {
		const socket = runtime.signalSocket;
		runtime.signalSocket = null;
		if (
			socket &&
			socket.readyState !== WebSocket.CLOSING &&
			socket.readyState !== WebSocket.CLOSED
		) {
			socket.close(1000, reason);
		}
	}

	private getWebRtcHostRuntime(
		webContentsId: number,
	): WebRtcHostRuntime | null {
		return this.webRtcHostRuntimesByWebContentsId.get(webContentsId) ?? null;
	}

	private openWebRtcPairingHost(options: {
		appOrigin: string;
		expiresAt: string;
		iceServers: RTCIceServer[];
		relayJoinTokenHash: string;
		roomId: string;
		sessionId: string;
		signalingUrl: string;
	}): void {
		const hostWindow = this.createWebRtcHostWindow(0);
		const hostConfig = {
			appOrigin: options.appOrigin,
			expiresAt: options.expiresAt,
			iceServers: options.iceServers,
			relayJoinTokenHash: options.relayJoinTokenHash,
			roomId: options.roomId,
			sessionId: options.sessionId,
			signalingUrl: options.signalingUrl,
		};
		this.webRtcHostConfigByWebContentsId.set(
			hostWindow.webContentsId,
			hostConfig,
		);
		const runtime: WebRtcHostRuntime = {
			hostWindow,
			pendingSignalMessages: [],
			phase: 'waiting',
			ready: false,
			signalSocket: null,
		};
		this.webRtcHostRuntimesByWebContentsId.set(
			hostWindow.webContentsId,
			runtime,
		);
		runtime.removeDestroyedListener = hostWindow.onDestroyed?.(() => {
			this.handleWebRtcHostDestroyed(hostWindow.webContentsId);
		});
		this.webRtcActivePairingWebContentsId = hostWindow.webContentsId;
		this.webRtcStatus = 'registering';
		hostWindow.sendConfig(hostConfig);
	}

	handleWebRtcHostSignalReady(webContentsId: number): void {
		const config = this.webRtcHostConfigByWebContentsId.get(webContentsId);
		const runtime = this.getWebRtcHostRuntime(webContentsId);
		if (!config || !runtime) return;

		this.closeWebRtcSignalSocket(runtime);
		const socket = new WebSocket(
			config.signalingUrl,
			createWebRtcSignalingSocketOptions(config.signalingUrl, config.appOrigin),
		);
		runtime.signalSocket = socket;

		socket.on('open', () => {
			if (runtime.signalSocket !== socket) return;
			socket.send(
				JSON.stringify({
					expiresAt: config.expiresAt,
					relayJoinTokenHash: config.relayJoinTokenHash,
					roomId: config.roomId,
					sessionId: config.sessionId,
					type: 'host-ready',
				}),
			);
		});

		socket.on('message', (raw) => {
			if (runtime.signalSocket !== socket) return;
			let message: unknown;
			try {
				message = parseSignalingMessage(raw.toString());
			} catch {
				return;
			}

			if (message && typeof message === 'object' && 'type' in message) {
				this.handleWebRtcHostStatus(webContentsId, {
					detail:
						'message' in message && typeof message.message === 'string'
							? message.message
							: undefined,
					type: typeof message.type === 'string' ? message.type : undefined,
				});
			}
			runtime.hostWindow.sendSignalMessage(message);
		});

		socket.on('error', () => {
			if (runtime.signalSocket !== socket) return;
			this.handleWebRtcHostStatus(webContentsId, {
				detail: 'Could not reach the WebRTC signaling relay.',
				type: 'error',
			});
		});

		socket.on('close', () => {
			if (runtime.signalSocket !== socket) return;
			runtime.signalSocket = null;
			this.handleWebRtcHostStatus(webContentsId, { type: 'closed' });
		});
	}

	handleWebRtcHostSignalMessage(webContentsId: number, message: unknown): void {
		if (!this.webRtcHostConfigByWebContentsId.has(webContentsId)) return;
		const runtime = this.getWebRtcHostRuntime(webContentsId);
		const socket = runtime?.signalSocket ?? null;
		let serializedMessage: string;
		try {
			serializedMessage = serializeSignalingMessage(message);
		} catch {
			this.handleWebRtcHostStatus(webContentsId, {
				detail: 'The WebRTC signaling message was not serializable.',
				type: 'error',
			});
			return;
		}
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			if (
				runtime && runtime.pendingSignalMessages.length < 256
			) {
				const pendingBytes = runtime.pendingSignalMessages.reduce(
					(total, pending) => total + Buffer.byteLength(pending),
					0,
				);
				const messageBytes = Buffer.byteLength(serializedMessage);
				if (pendingBytes + messageBytes <= 128 * 1024) {
					runtime.pendingSignalMessages.push(serializedMessage);
					return;
				}
			}
			this.handleWebRtcHostStatus(webContentsId, {
				detail: 'The WebRTC signaling relay is not connected.',
				type: 'error',
			});
			return;
		}
		socket.send(serializedMessage);
	}

	handleWebRtcHostStatus(
		webContentsId: number,
		message: { detail?: string; type?: string },
	): void {
		const runtime = this.getWebRtcHostRuntime(webContentsId);
		if (!runtime) return;

		if (message.type === 'host-registered') {
			runtime.ready = true;
			const socket = runtime.signalSocket;
			if (socket?.readyState === WebSocket.OPEN) {
				for (const pending of runtime.pendingSignalMessages.splice(0)) {
					socket.send(pending);
				}
			}
			if (this.webRtcActivePairingWebContentsId === webContentsId) {
				this.webRtcStatus = 'pairing-ready';
				this.webRtcStatusMessage =
					'WebRTC relay room is ready. Scan the QR code to connect another browser.';
				this.emitStatus();
			}
			return;
		}

		if (message.type === 'client-join') {
			runtime.phase = 'pairing';
			if (this.webRtcActivePairingWebContentsId === webContentsId) {
				// The admitted room now belongs to this browser's handshake. Stop
				// advertising its one-time QR immediately and prepare a fresh room for
				// another browser without disturbing the peer that is connecting.
				this.webRtcActivePairingWebContentsId = null;
				this.webRtcStatus = 'registering';
				this.webRtcStatusMessage =
					'A browser is pairing, but is not connected yet. Preparing a fresh QR for another browser.';
				this.emitStatus();
				void this.rotateWebRtcPairingCode().then(() => this.emitStatus());
			} else {
				this.emitStatus();
			}
			return;
		}

		if (message.type === 'error') {
			runtime.ready = false;
			if (runtime.phase === 'pairing') {
				runtime.phase = 'failed';
			}
			if (this.webRtcActivePairingWebContentsId === webContentsId) {
				if (this.webRtcActivePairingWebContentsId === webContentsId) {
					this.webRtcStatus = 'error';
				}
				this.webRtcStatusMessage =
					message.detail || 'The WebRTC relay rejected the pairing room.';
				this.emitStatus();
			}
			return;
		}

		if (message.type === 'closed') {
			const wasReady = runtime.ready;
			runtime.ready = false;
			if (runtime.phase !== 'connected') {
				runtime.phase = 'failed';
			}
			if (this.webRtcActivePairingWebContentsId === webContentsId) {
				this.webRtcStatus = 'error';
				this.webRtcStatusMessage =
					message.detail ||
					(wasReady
						? 'The WebRTC signaling connection was lost after this Terminay host became ready. Retry to advertise a fresh pairing room.'
						: 'The WebRTC signaling connection closed before this Terminay host became ready. Retry or check Remote Access settings.');
				this.emitStatus();
			}
		}
	}

	private closeWebRtcHostRuntime(
		webContentsId: number,
		reason = 'Pairing rotated',
	): void {
		const runtime = this.webRtcHostRuntimesByWebContentsId.get(webContentsId);
		if (!runtime) return;

		runtime.removeDestroyedListener?.();
		runtime.removeDestroyedListener = undefined;
		this.closeWebRtcSignalSocket(runtime, reason);
		this.webRtcHostRuntimesByWebContentsId.delete(webContentsId);
		this.webRtcHostConfigByWebContentsId.delete(webContentsId);
		if (this.webRtcActivePairingWebContentsId === webContentsId) {
			this.webRtcActivePairingWebContentsId = null;
		}
		runtime.hostWindow.close();
	}

	handleWebRtcHostDestroyed(webContentsId: number): void {
		const wasActivePairingHost =
			this.webRtcActivePairingWebContentsId === webContentsId;
		this.closeWebRtcHostRuntime(
			webContentsId,
			'WebRTC host renderer was destroyed',
		);
		if (wasActivePairingHost) {
			this.webRtcStatus = 'error';
			this.webRtcStatusMessage =
				'The WebRTC host renderer closed unexpectedly. Retry to advertise a fresh pairing room.';
			this.emitStatus();
		}
	}

	getWebRtcHostConfig(webContentsId: number): WebRtcHostConfig | null {
		return this.webRtcHostConfigByWebContentsId.get(webContentsId) ?? null;
	}

	/**
	 * Return the immutable server UI archive used by every authenticated WebRTC
	 * client. The hosted connection manager never receives a file manifest or
	 * needs to understand a generated filename.
	 */
	getWebRtcUiArchive(): Promise<ServerUiArchive> {
		this.webRtcUiArchive ??= buildServerUiArchive({
			entryPath: 'server.html',
			protocolVersion: '1',
			publicDirectory: this.publicDir,
			rendererDirectory: this.rendererDistDir,
		});
		return this.webRtcUiArchive;
	}

	async handleWebRtcApiRequest(
		pathname: string,
		body: Record<string, unknown>,
		appOrigin: string,
	): Promise<unknown> {
		const origin = this.createWebRtcPairingOrigin(appOrigin);

		if (pathname === '/api/host-context') {
			const archive = await this.getWebRtcUiArchive();
			const sessionId = this.createWebRtcSessionId(appOrigin);
			return {
				schemaVersion: 1,
				bootstrapVersion: 1,
				applicationProtocolVersion: '1',
				bundleId: archive.bundleId,
				byteEndpointVersion: 1,
				capabilities: { clipboardWrite: 1, notifications: 1 },
				hostBridgeVersion: 1,
				hostKind: 'browser',
				profileId: this.serverId,
				serverId: this.serverId,
				sourceId: `browser-${sessionId}`,
				windowId: `browser-${sessionId}`,
			};
		}

		if (pathname === '/api/devices/enroll') {
			const registration = this.pairingManager.startRegistration({
				deviceName: String(body.deviceName ?? ''),
				origin,
				pairingSessionId: String(body.pairingSessionId ?? ''),
				pairingToken: String(body.pairingToken ?? ''),
				publicKeyPem: normalizePem(String(body.publicKeyPem ?? '')),
			});
			const pending = this.pairingManager.consumeRegistration({
				origin,
				provisionalDeviceId: registration.provisionalDeviceId,
			});
			const device = await this.deviceStore.create({
				name: pending.deviceName,
				origin: pending.origin,
				publicKeyPem: pending.publicKeyPem,
			});
			this.pairingManager.invalidateSession(pending.pairingSessionId);
			await this.auditStore.append({
				action: 'pairing-completed',
				connectionId: null,
				deviceId: device.id,
				deviceName: device.name,
			});
			this.emitStatus();
			const ticket = this.connectionStore.issueConnectionTicket(device.id);
			return { deviceId: device.id, deviceName: device.name, ...ticket };
		}

		if (pathname === '/api/devices/challenge') {
			const device = this.deviceStore.get(String(body.deviceId ?? ''));
			if (!device) throw new Error('This device is not paired with this host.');
			if (device.origin !== origin)
				throw new Error('This device is paired with a different origin.');
			const challenge = await this.challengeStore.create({
				deviceId: device.id,
				origin: device.origin,
				serverId: this.serverId,
			});
			return {
				challenge: challenge.payload,
				signingInput: challenge.signingInput,
			};
		}

		if (pathname === '/api/devices/verify') {
			const device = this.deviceStore.get(String(body.deviceId ?? ''));
			if (!device) throw new Error('This device is no longer trusted.');
			if (device.origin !== origin)
				throw new Error('This device is paired with a different origin.');
			const challenge = this.challengeStore.consume(
				String(body.challengeId ?? ''),
				device.id,
				origin,
			);
			const verifiedDeviceSignature = verifySignature(
				'sha256',
				Buffer.from(serializeDeviceChallenge(challenge.payload)),
				{
					key: normalizePem(device.publicKeyPem),
					padding: constants.RSA_PKCS1_PSS_PADDING,
					saltLength: 32,
				},
				Buffer.from(String(body.deviceSignature ?? ''), 'base64url'),
			);
			if (!verifiedDeviceSignature)
				throw new Error('The paired device key signature was invalid.');
			await this.deviceStore.updateAuthentication(device.id);
			await this.auditStore.append({
				action: 'auth-verified',
				connectionId: null,
				deviceId: device.id,
				deviceName: device.name,
			});
			const ticket = this.connectionStore.issueConnectionTicket(device.id);
			this.emitStatus();
			return ticket;
		}

		throw new Error('Not found');
	}

	async attachWebRtcTerminal(
		webContentsId: number,
		channelId: string,
		ticket: string,
	): Promise<void> {
		const ticketInfo = this.connectionStore.consumeTicket(ticket);
		const device = this.deviceStore.get(ticketInfo.deviceId);
		if (!device) throw new Error('This device is no longer trusted.');
		const runtime = this.getWebRtcHostRuntime(webContentsId);
		if (!runtime)
			throw new Error('The WebRTC host connection is no longer available.');
		const peer: WebRtcTerminalPeer = {
			channelId,
			webContentsId,
			close: (_code?: number, reason?: string) => {
				const closeReason = reason || 'Remote connection closed by Terminay.';
				this.getWebRtcHostRuntime(webContentsId)?.hostWindow.closeTerminal(
					channelId,
					closeReason,
				);
				this.closeWebRtcTerminal(channelId, closeReason);
			},
			getReadyState: () => WebSocket.OPEN,
			send: (message) => {
				this.getWebRtcHostRuntime(
					webContentsId,
				)?.hostWindow.sendTerminalMessage(channelId, message);
			},
		};
		const connection = this.connectionStore.register(
			peer,
			ticketInfo.connectionId,
			ticketInfo.deviceId,
		);
		runtime.phase = 'connected';
		this.webRtcTerminalConnectionsByChannelId.set(
			channelId,
			connection.connectionId,
		);
		await this.auditStore.append({
			action: 'connection-opened',
			connectionId: connection.connectionId,
			deviceId: connection.deviceId,
			deviceName: this.deviceStore.get(connection.deviceId)?.name ?? null,
		});
		this.webRtcStatusMessage =
			'Browser connected over WebRTC. A fresh pairing QR remains available for another browser.';
		this.sendSessionList(connection.socket, connection.connectionId);
		this.emitStatus();
	}

	async attachWebRtcApplication(
		webContentsId: number,
		channelId: string,
		ticket: string,
		closePeer: (reason?: string) => void,
	): Promise<Readonly<{ connectionId: string; deviceId: string }>> {
		const ticketInfo = this.connectionStore.consumeTicket(ticket);
		const device = this.deviceStore.get(ticketInfo.deviceId);
		if (!device) throw new Error('This device is no longer trusted.');
		const runtime = this.getWebRtcHostRuntime(webContentsId);
		if (!runtime)
			throw new Error('The WebRTC host connection is no longer available.');
		const peer: RemoteConnectionPeer = {
			close: (_code, reason) =>
				closePeer(reason || 'Remote connection closed by Terminay.'),
			getReadyState: () => WebSocket.OPEN,
			// Canonical application events travel through ServerCore on the framed
			// application lane; the legacy connection store is lifecycle-only here.
			send: () => undefined,
		};
		const connection = this.connectionStore.register(
			peer,
			ticketInfo.connectionId,
			ticketInfo.deviceId,
		);
		runtime.phase = 'connected';
		this.webRtcApplicationConnectionsByChannelId.set(
			channelId,
			connection.connectionId,
		);
		await this.auditStore.append({
			action: 'connection-opened',
			connectionId: connection.connectionId,
			deviceId: connection.deviceId,
			deviceName: device.name,
		});
		this.webRtcStatusMessage =
			'Browser connected over WebRTC. A fresh pairing QR remains available for another browser.';
		this.emitStatus();
		return {
			connectionId: connection.connectionId,
			deviceId: connection.deviceId,
		};
	}

	closeWebRtcApplication(channelId: string): void {
		const connectionId =
			this.webRtcApplicationConnectionsByChannelId.get(channelId);
		if (!connectionId) return;
		this.webRtcApplicationConnectionsByChannelId.delete(channelId);
		this.connectionStore.unregister(connectionId);
		this.emitStatus();
	}

	handleWebRtcTerminalMessage(channelId: string, raw: string): void {
		const connectionId =
			this.webRtcTerminalConnectionsByChannelId.get(channelId);
		if (!connectionId) return;
		const parsed = parseRemoteClientMessage(raw);
		if (!parsed) {
			const connection = this.connectionStore.get(connectionId);
			if (connection)
				this.send(connection.socket, {
					message: 'Invalid remote message.',
					type: 'error',
				});
			return;
		}
		void this.handleClientMessage(connectionId, parsed);
	}

	closeWebRtcTerminal(
		channelId: string,
		reason = 'WebRTC terminal channel closed.',
	): void {
		const connectionId =
			this.webRtcTerminalConnectionsByChannelId.get(channelId);
		if (!connectionId) return;
		const connection = this.connectionStore.get(connectionId);
		this.webRtcTerminalConnectionsByChannelId.delete(channelId);
		this.clearRemoteSizeOverridesForConnection(connectionId);
		this.clientOperationQueues.delete(connectionId);
		this.connectionStore.unregister(connectionId);
		void this.auditStore
			.append({
				action: 'connection-closed',
				connectionId,
				deviceId: connection?.deviceId ?? null,
				deviceName: connection
					? (this.deviceStore.get(connection.deviceId)?.name ?? null)
					: null,
				reason,
			})
			.then(() => this.emitStatus());
		this.emitStatus();
	}

	private handleClientMessage(
		connectionId: string,
		message: RemoteClientMessage,
	): Promise<void> {
		const previous =
			this.clientOperationQueues.get(connectionId) ?? Promise.resolve();
		const operation = previous
			.catch(() => undefined)
			.then(() => this.processClientMessage(connectionId, message))
			.catch(() => {
				const connection = this.connectionStore.get(connectionId);
				if (connection) {
					this.send(connection.socket, {
						message: 'Remote terminal operation failed.',
						type: 'error',
					});
				}
			});
		this.clientOperationQueues.set(connectionId, operation);
		void operation.finally(() => {
			if (this.clientOperationQueues.get(connectionId) === operation) {
				this.clientOperationQueues.delete(connectionId);
			}
		});
		return operation;
	}

	private async processClientMessage(
		connectionId: string,
		message: RemoteClientMessage,
	): Promise<void> {
		const connection = this.connectionStore.get(connectionId);
		if (!connection) {
			return;
		}

		if (message.connectionId !== connection.connectionId) {
			this.send(connection.socket, {
				message: 'Connection identity mismatch.',
				type: 'error',
			});
			return;
		}

		if (message.seq <= connection.highestSeq) {
			this.send(connection.socket, {
				message: 'Stale or replayed message rejected.',
				type: 'error',
			});
			return;
		}

		connection.highestSeq = message.seq;

		switch (message.type) {
			case 'list-sessions':
				this.sendSessionList(connection.socket, connection.connectionId);
				return;
			case 'attach-session': {
				const session = this.sessions.get(message.sessionId);
				if (!session) {
					this.send(connection.socket, {
						message: 'That terminal session no longer exists.',
						type: 'error',
					});
					return;
				}

				if (
					this.remoteSizeOverrideOwners.get(message.sessionId)?.connectionId !==
					connection.connectionId
				) {
					this.clearRemoteSizeOverridesForConnection(connection.connectionId);
				}
				connection.attachedSessionIds.add(message.sessionId);
				this.send(connection.socket, {
					session: this.toSessionSnapshot(message.sessionId, session),
					type: 'session-opened',
				});
				return;
			}
			case 'detach-session':
				connection.attachedSessionIds.delete(message.sessionId);
				this.clearRemoteSizeOverride(
					message.sessionId,
					connection.connectionId,
				);
				return;
			case 'write': {
				if (!connection.attachedSessionIds.has(message.sessionId)) {
					this.send(connection.socket, {
						message: 'Attach to a session before sending input.',
						type: 'error',
					});
					return;
				}

				const controllableSession = this.getControllableSession(
					message.sessionId,
				);
				if (!controllableSession) {
					this.send(connection.socket, {
						message: 'That terminal session is no longer controllable.',
						type: 'error',
					});
					return;
				}

				try {
					await controllableSession.write(message.payload);
				} catch {
					this.send(connection.socket, {
						message: 'Terminal input was rejected.',
						type: 'error',
					});
				}
				return;
			}
			case 'resize': {
				if (!connection.attachedSessionIds.has(message.sessionId)) {
					this.send(connection.socket, {
						message: 'Attach to a session before resizing it.',
						type: 'error',
					});
					return;
				}

				const controllableSession = this.getControllableSession(
					message.sessionId,
				);
				if (!controllableSession) {
					this.send(connection.socket, {
						message: 'That terminal session is no longer controllable.',
						type: 'error',
					});
					return;
				}

				const cols = Math.max(2, Math.floor(message.cols));
				const rows = Math.max(1, Math.floor(message.rows));
				try {
					await controllableSession.resize(cols, rows);
				} catch {
					this.send(connection.socket, {
						message: 'Terminal resize was rejected.',
						type: 'error',
					});
					return;
				}

				if (this.connectionStore.get(connectionId) === connection) {
					this.setRemoteSizeOverrideOwner(
						message.sessionId,
						connection.connectionId,
						cols,
						rows,
					);
				}
				return;
			}
			case 'ping':
				this.send(connection.socket, { seq: message.seq, type: 'pong' });
				return;
		}
	}

	private sendSessionList(
		socket: RemoteConnectionPeer,
		connectionId: string,
	): void {
		this.send(socket, {
			connectionCount: this.connectionStore.count(),
			connectionId,
			sessions: Array.from(this.sessions.entries()).map(([id, session]) =>
				this.toSessionSummary(id, session),
			),
			type: 'session-list',
		});
	}

	private toSessionSummary(
		id: string,
		session: SessionRecord,
	): RemoteSessionSummary {
		return {
			color: session.metadata.color,
			cols: session.cols,
			emoji: session.metadata.emoji,
			exitCode: session.exitCode,
			id,
			rows: session.rows,
			title: session.metadata.title,
			viewportHeight: session.metadata.viewportHeight,
			viewportWidth: session.metadata.viewportWidth,
			projectId: session.metadata.projectId,
			projectTitle: session.metadata.projectTitle,
			projectEmoji: session.metadata.projectEmoji,
			projectColor: session.metadata.projectColor,
		};
	}

	private toSessionSnapshot(
		id: string,
		session: SessionRecord,
	): RemoteSessionSnapshot {
		const buffer =
			session.buffer.length > MAX_SESSION_SNAPSHOT_BUFFER_LENGTH
				? session.buffer.slice(-MAX_SESSION_SNAPSHOT_BUFFER_LENGTH)
				: session.buffer;

		return {
			...this.toSessionSummary(id, session),
			buffer,
		};
	}

	private setRemoteSizeOverrideOwner(
		sessionId: string,
		connectionId: string,
		cols: number,
		rows: number,
	): void {
		this.remoteSizeOverrideOwners.set(sessionId, { cols, connectionId, rows });
		this.notifyTerminalRemoteSizeOverride(sessionId, {
			active: true,
			cols,
			rows,
		});
	}

	private clearRemoteSizeOverride(
		sessionId: string,
		connectionId?: string,
	): void {
		const owner = this.remoteSizeOverrideOwners.get(sessionId);
		if (!owner || (connectionId && owner.connectionId !== connectionId)) {
			return;
		}

		this.remoteSizeOverrideOwners.delete(sessionId);
		this.notifyTerminalRemoteSizeOverride(sessionId, { active: false });
	}

	private clearRemoteSizeOverridesForConnection(connectionId: string): void {
		for (const [sessionId, owner] of Array.from(
			this.remoteSizeOverrideOwners.entries(),
		)) {
			if (owner.connectionId === connectionId) {
				this.clearRemoteSizeOverride(sessionId, connectionId);
			}
		}
	}

	private clearAllRemoteSizeOverrides(): void {
		const sessionIds = Array.from(this.remoteSizeOverrideOwners.keys());
		this.remoteSizeOverrideOwners.clear();
		for (const sessionId of sessionIds) {
			this.notifyTerminalRemoteSizeOverride(sessionId, { active: false });
		}
	}

	private broadcast(message: RemoteServerMessage): void {
		for (const connection of this.connectionStore.list()) {
			if (
				message.type === 'output' &&
				!connection.attachedSessionIds.has(message.sessionId)
			) {
				continue;
			}

			this.send(connection.socket, message);
		}
	}

	private send(
		socket: RemoteConnectionPeer,
		message: RemoteServerMessage,
	): void {
		if (socket.getReadyState() !== WebSocket.OPEN) {
			return;
		}

		socket.send(JSON.stringify(message));
	}

}
