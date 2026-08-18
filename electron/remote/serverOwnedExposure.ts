import type { ByteTransport } from '@terminay/protocol';
import type {
	AuthenticatedClient,
	ServerConnectionLike,
} from '../../packages/server-core/src/types';
import {
	startHostedPairingHost,
	type HostedPairingDiagnostic,
	type HostedPairingHost,
	type MinimalArchive,
} from '../../apps/terminay-server/src/remote/hostedPairingHost';
import type { HostedHostKey } from '../../apps/terminay-server/src/remote/hostedHostKey';
import {
	createServerRemoteExposure,
	type ServerRemoteExposure,
} from '../../apps/terminay-server/src/remote/serverExposure';
import type { RemoteAccessStatus } from '../../src/types/terminay';

export interface DesktopServerOwnedExposureOptions {
	readonly acceptApplication?: (
		transport: ByteTransport,
		client: AuthenticatedClient,
	) => ServerConnectionLike;
	readonly createExposure?: (sessionOrigin: string) => ServerRemoteExposure;
	readonly ensureWebRtcRuntimeAvailable?: () => void | Promise<void>;
	readonly getUiArchive?: () => Promise<MinimalArchive> | MinimalArchive;
	readonly hostKey?: HostedHostKey;
	readonly initialDevices?: ReturnType<ServerRemoteExposure['devices']['list']>;
	readonly persistDevices?: (
		devices: ReturnType<ServerRemoteExposure['devices']['list']>,
	) => void;
	readonly requirePairingPin?: () => void;
	readonly resolveSessionOrigin: () => string;
	readonly serverId: string;
	readonly signal?: Readonly<{
		readonly connectHost?: string;
		readonly insecureTls?: boolean;
	}>;
	readonly verifyPairingPin?: (pin: string) => boolean;
	readonly webRtcUnavailableReason?: string;
	readonly webrtcRuntimeRoot?: string;
	readonly onStatusChanged?: () => void;
	readonly onDiagnostic?: (event: HostedPairingDiagnostic) => void;
}

/** Desktop projection over the server-owned hosted pairing host. */
export class DesktopServerOwnedExposure {
	private readonly acceptApplication:
		| DesktopServerOwnedExposureOptions['acceptApplication']
		| undefined;
	private readonly factory: (sessionOrigin: string) => ServerRemoteExposure;
	private readonly getUiArchive:
		| DesktopServerOwnedExposureOptions['getUiArchive']
		| undefined;
	private readonly hostKey: HostedHostKey | undefined;
	private readonly persistDevices:
		| DesktopServerOwnedExposureOptions['persistDevices']
		| undefined;
	private readonly requirePairingPin:
		| DesktopServerOwnedExposureOptions['requirePairingPin']
		| undefined;
	private readonly resolveSessionOrigin: () => string;
	private readonly serverId: string;
	private readonly signal: DesktopServerOwnedExposureOptions['signal'];
	private readonly verifyPairingPin:
		| DesktopServerOwnedExposureOptions['verifyPairingPin']
		| undefined;
	private readonly webrtcRuntimeRoot: string | undefined;
	private readonly ensureWebRtcRuntimeAvailable:
		| (() => void | Promise<void>)
		| undefined;
	private readonly webRtcUnavailableReason: string | undefined;
	private readonly onStatusChanged: (() => void) | undefined;
	private readonly onDiagnostic:
		| ((event: HostedPairingDiagnostic) => void)
		| undefined;
	private exposure: ServerRemoteExposure | undefined;
	private hosted: HostedPairingHost | undefined;
	private runtimeError: string | undefined;
	private sessionOrigin: string | undefined;

	constructor(options: DesktopServerOwnedExposureOptions) {
		this.serverId = options.serverId;
		this.resolveSessionOrigin = options.resolveSessionOrigin;
		this.acceptApplication = options.acceptApplication;
		this.getUiArchive = options.getUiArchive;
		this.hostKey = options.hostKey;
		this.persistDevices = options.persistDevices;
		this.requirePairingPin = options.requirePairingPin;
		this.signal = options.signal;
		this.verifyPairingPin = options.verifyPairingPin;
		this.webrtcRuntimeRoot = options.webrtcRuntimeRoot;
		this.ensureWebRtcRuntimeAvailable = options.ensureWebRtcRuntimeAvailable;
		this.webRtcUnavailableReason = options.webRtcUnavailableReason;
		this.onStatusChanged = options.onStatusChanged;
		this.onDiagnostic = options.onDiagnostic;
		this.runtimeError = options.webRtcUnavailableReason;
		this.factory =
			options.createExposure ??
			((sessionOrigin) => {
				const exposure = createServerRemoteExposure({
					pairingUrlFormat: 'hosted-compact',
					serverId: this.serverId,
					sessionOrigin,
				});
				if (options.initialDevices !== undefined)
					exposure.devices.restore(options.initialDevices);
				return exposure;
			});
	}

	getStatus(): RemoteAccessStatus {
		const status = projectStatus(this.exposure, this.sessionOrigin);
		if (this.runtimeError === undefined) return status;
		return {
			...status,
			errorMessage: this.runtimeError,
			isRunning: false,
			webRtcPairingExpiresAt: null,
			webRtcPairingUrl: null,
			webRtcRoomId: null,
			webRtcStatus: 'error',
			webRtcStatusMessage: this.runtimeError,
		};
	}

	async toggle(): Promise<RemoteAccessStatus> {
		if (this.exposure?.status.exposure.state === 'exposed') {
			await this.hosted?.close();
			this.hosted = undefined;
			this.exposure.stopExposure();
			return this.getStatus();
		}
		this.runtimeError = this.webRtcUnavailableReason;
		const origin = normalizeSessionOrigin(this.resolveSessionOrigin());
		if (origin !== this.sessionOrigin) {
			await this.hosted?.close();
			this.hosted = undefined;
			await this.exposure?.shutdown();
			this.sessionOrigin = origin;
			this.exposure = this.factory(origin);
		}
		const exposure = this.requireExposure();
		try {
			if (this.webRtcUnavailableReason !== undefined)
				throw new Error(this.webRtcUnavailableReason);
			this.requirePairingPin?.();
			await this.ensureWebRtcRuntimeAvailable?.();
		} catch (error) {
			this.runtimeError =
				error instanceof Error
					? error.message
					: 'Desktop WebRTC runtime is unavailable.';
			throw error;
		}
		exposure.start();
		try {
			this.hosted = await this.register(exposure);
			this.runtimeError = undefined;
		} catch (error) {
			exposure.stopExposure();
			throw error;
		}
		return this.getStatus();
	}

	async rotate(): Promise<RemoteAccessStatus> {
		const current = this.requireExposure();
		if (current.status.exposure.state !== 'exposed')
			throw new Error('Remote Access is not exposed.');
		if (this.webRtcUnavailableReason !== undefined)
			throw new Error(this.webRtcUnavailableReason);
		this.requirePairingPin?.();
		await this.ensureWebRtcRuntimeAvailable?.();
		const origin = this.sessionOrigin;
		if (origin === undefined)
			throw new Error('Remote Access session origin is unavailable.');
		const candidate = this.factory(origin);
		candidate.start();
		let hosted: HostedPairingHost | undefined;
		try {
			hosted = await this.register(candidate);
		} catch (error) {
			await candidate.shutdown();
			throw error;
		}
		await this.hosted?.close();
		await current.shutdown();
		this.exposure = candidate;
		this.hosted = hosted;
		return this.getStatus();
	}

	async revokeDevice(deviceId: string): Promise<RemoteAccessStatus> {
		await this.requireExposure().revokeDevice(deviceId);
		this.persistDevices?.(this.requireExposure().devices.list());
		return this.getStatus();
	}

	closeConnection(connectionId: string): RemoteAccessStatus {
		this.requireExposure().manager.closePeer(connectionId);
		return this.getStatus();
	}

	async shutdown(): Promise<void> {
		await this.hosted?.close();
		this.hosted = undefined;
		await this.exposure?.shutdown();
	}

	private async register(exposure: ServerRemoteExposure) {
		const handoff = exposure.pairingHandoff;
		if (handoff === undefined)
			throw new Error('Server exposure did not create a pairing handoff.');
		if (this.hostKey === undefined || this.webrtcRuntimeRoot === undefined) {
			throw new Error('Desktop hosted signaling host is not configured.');
		}
		return startHostedPairingHost({
			handoff,
			hostKey: this.hostKey,
			persistDevices: this.persistDevices ?? (() => undefined),
			remote: exposure,
			serverId: this.serverId,
			webrtcRuntimeRoot: this.webrtcRuntimeRoot,
			rotateHandoff: () => exposure.rotateHostedPairing(),
			onHandoff: () => this.onStatusChanged?.(),
			onPeerConnected: () => this.onStatusChanged?.(),
			...(this.onDiagnostic === undefined ? {} : { onDiagnostic: this.onDiagnostic }),
			...(this.acceptApplication === undefined
				? {}
				: { acceptApplication: this.acceptApplication }),
			...(this.getUiArchive === undefined ? {} : { getUiArchive: this.getUiArchive }),
			...(this.signal === undefined ? {} : { signal: this.signal }),
			...(this.verifyPairingPin === undefined
				? {}
				: { verifyPairingPin: this.verifyPairingPin }),
		});
	}

	private requireExposure(): ServerRemoteExposure {
		if (this.exposure === undefined)
			throw new Error('Remote Access session origin is unavailable.');
		return this.exposure;
	}
}

function normalizeSessionOrigin(address: string): string {
	let parsed: URL;
	try {
		parsed = new URL(address);
	} catch {
		throw new TypeError('Remote Access session origin is invalid.');
	}
	const loopbackHttp =
		parsed.protocol === 'http:' &&
		(parsed.hostname === 'localhost' || parsed.hostname.endsWith('.localhost'));
	if (
		(!loopbackHttp && parsed.protocol !== 'https:') ||
		parsed.username ||
		parsed.password ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	) {
		throw new TypeError(
			'Remote Access session origin must be an exact HTTPS or loopback HTTP origin.',
		);
	}
	return parsed.origin;
}

function projectStatus(
	exposure: ServerRemoteExposure | undefined,
	sessionOrigin: string | undefined,
): RemoteAccessStatus {
	const status = exposure?.status;
	const pairing = status?.pairing;
	const handoffUrl = exposure?.pairingHandoff?.pairingUrl ?? null;
	const peers = (status?.peers ?? []) as readonly Readonly<{
		state: string;
		peerId: string;
		deviceId: string;
	}>[];
	const devices = (exposure?.devices.list() ?? []) as readonly Readonly<{
		createdAt: number;
		deviceId: string;
		deviceName: string;
		lastSeenAt: number | null;
		revokedAt: number | null;
	}>[];
	return {
		activeConnectionCount: peers.filter((peer) => peer.state === 'connected')
			.length,
		pendingWebRtcConnectionCount: 0,
		auditEvents: [],
		connections: peers.map((peer) => ({
			attachedSessionCount: 0,
			connectionId: peer.peerId,
			deviceId: peer.deviceId,
			deviceName: peer.deviceId,
		})),
		// Idle (not yet exposed) is not a settings problem. The renderer treats
		// configurationIssue as "open settings and abort" instead of exposing.
		configurationIssue: null,
		configurationPath: 'Terminay Server',
		errorMessage: null,
		isRunning: status?.exposure.state === 'exposed',
		pairedDeviceCount: devices.filter((device) => device.revokedAt === null)
			.length,
		pairedDevices: devices.map((device) => ({
			addedAt: new Date(device.createdAt).toISOString(),
			deviceId: device.deviceId,
			lastSeenAt:
				device.lastSeenAt === null
					? null
					: new Date(device.lastSeenAt).toISOString(),
			name: device.deviceName,
		})),
		webRtcPairingExpiresAt:
			pairing === undefined ? null : new Date(pairing.expiresAt).toISOString(),
		webRtcPairingQrCodeDataUrl: null,
		webRtcPairingUrl: handoffUrl,
		webRtcRoomId: pairing?.roomId ?? null,
		webRtcStatus:
			pairing === undefined
				? sessionOrigin === undefined
					? 'not-configured'
					: 'registering'
				: 'pairing-ready',
		webRtcStatusMessage:
			pairing === undefined
				? null
				: 'Terminay Server exposure is ready for pairing.',
	};
}
