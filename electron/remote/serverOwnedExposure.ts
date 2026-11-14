import { AUTHENTICATED_WEBRTC_TRANSPORT_VERSION, type ByteTransport } from '@terminay/protocol';
import type {
	AuthenticatedClient,
	ServerConnectionLike,
} from '../../packages/server-core/src/types';
import {
	startHostedPairingHost,
	type HostedIceServer,
	type HostedPairingDiagnostic,
	type HostedPairingHost,
	type MinimalArchive,
} from '../../apps/terminay-server/src/remote/hostedPairingHost';
import type { HostedHostKey, HostKeyStore } from '../../apps/terminay-server/src/remote/hostedHostKey';
import {
	createServerRemoteExposure,
	type ServerRemoteExposure,
} from '../../apps/terminay-server/src/remote/serverExposure';
import { projectRemoteAccessStatus } from '../../apps/terminay-server/src/remote/remoteAccessStatus';
import type { RemoteAccessStatus } from '../../src/types/terminay';
import { assertAuthenticatedRemoteAccessContract } from './desktopAuthenticatedWebRtc';

export interface DesktopServerOwnedExposureOptions {
	readonly acceptApplication?: (
		transport: ByteTransport,
		client: AuthenticatedClient,
	) => ServerConnectionLike;
	readonly createExposure?: (sessionOrigin: string) => ServerRemoteExposure;
	readonly ensureWebRtcRuntimeAvailable?: () => void | Promise<void>;
	readonly getUiArchive?: () => Promise<MinimalArchive> | MinimalArchive;
	/** Loads the host key lazily so a missing OS protector refuses exposure
	 * with a visible reason instead of failing Desktop startup. */
	readonly hostKeyStore?: HostKeyStore;
	readonly initialDevices?: ReturnType<ServerRemoteExposure['devices']['list']>;
	readonly persistDevices?: (
		devices: ReturnType<ServerRemoteExposure['devices']['list']>,
	) => void;
	readonly resolveSessionOrigin: () => string;
	/** A device is waiting for approval; Desktop raises a notification. */
	readonly onApprovalRequested?: (approval: Readonly<{ approvalId: string; deviceName: string; matchCode: string; expiresAt: number }>) => void;
	readonly serverId: string;
	readonly signal?: Readonly<{
		readonly connectHost?: string;
		readonly insecureTls?: boolean;
	}>;
	readonly webRtcUnavailableReason?: string;
	readonly webrtcRuntimeRoot?: string;
	readonly iceServers?: readonly HostedIceServer[];
	readonly resolveIceServers?: () => readonly HostedIceServer[];
	readonly iceRecoveryGraceMs?: number;
	readonly onStatusChanged?: () => void;
	/** Called once per admitted remote device connection. */
	readonly onConnectionAdmitted?: (
		admission: Readonly<{ connectionId: string; deviceId: string; deviceName: string }>,
	) => void;
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
	private readonly hostKeyStore: HostKeyStore | undefined;
	private hostKey: HostedHostKey | undefined;
	private readonly persistDevices:
		| DesktopServerOwnedExposureOptions['persistDevices']
		| undefined;
	private readonly resolveSessionOrigin: () => string;
	private readonly serverId: string;
	private readonly signal: DesktopServerOwnedExposureOptions['signal'];
	private readonly onApprovalRequested:
		| DesktopServerOwnedExposureOptions['onApprovalRequested']
		| undefined;
	private stopApprovalSubscriptions: (() => void) | undefined;
	private readonly webrtcRuntimeRoot: string | undefined;
	private readonly iceServers: readonly HostedIceServer[] | undefined;
	private readonly resolveIceServers: (() => readonly HostedIceServer[]) | undefined;
	private readonly iceRecoveryGraceMs: number | undefined;
	private readonly ensureWebRtcRuntimeAvailable:
		| (() => void | Promise<void>)
		| undefined;
	private readonly webRtcUnavailableReason: string | undefined;
	private readonly onStatusChanged: (() => void) | undefined;
	private readonly onConnectionAdmitted: DesktopServerOwnedExposureOptions['onConnectionAdmitted'];
	private readonly onDiagnostic:
		| ((event: HostedPairingDiagnostic) => void)
		| undefined;
	private exposure: ServerRemoteExposure | undefined;
	private hosted: HostedPairingHost | undefined;
	private runtimeError: string | undefined;
	private sessionOrigin: string | undefined;
	private hostedConnections: Array<{
		attachedSessionCount: number;
		connectionId: string;
		deviceId: string;
		deviceName: string;
	}> = [];

	constructor(options: DesktopServerOwnedExposureOptions) {
		this.serverId = options.serverId;
		this.resolveSessionOrigin = options.resolveSessionOrigin;
		this.acceptApplication = options.acceptApplication;
		this.getUiArchive = options.getUiArchive;
		this.hostKeyStore = options.hostKeyStore;
		this.persistDevices = options.persistDevices;
		this.signal = options.signal;
		this.onApprovalRequested = options.onApprovalRequested;
		this.webrtcRuntimeRoot = options.webrtcRuntimeRoot;
		this.iceServers = options.iceServers;
		this.resolveIceServers = options.resolveIceServers;
		this.iceRecoveryGraceMs = options.iceRecoveryGraceMs;
		this.ensureWebRtcRuntimeAvailable = options.ensureWebRtcRuntimeAvailable;
		this.webRtcUnavailableReason = options.webRtcUnavailableReason;
		this.onStatusChanged = options.onStatusChanged;
		this.onConnectionAdmitted = options.onConnectionAdmitted;
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
		const status = projectStatus(
			this.exposure,
			this.sessionOrigin,
			this.hostedConnections,
		);
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
			this.hostedConnections = [];
			this.exposure.stopExposure();
			return this.getStatus();
		}
		this.runtimeError = this.webRtcUnavailableReason;
		const origin = normalizeSessionOrigin(this.resolveSessionOrigin());
		if (origin !== this.sessionOrigin) {
			await this.hosted?.close();
			this.hosted = undefined;
			this.hostedConnections = [];
			await this.exposure?.shutdown();
			this.sessionOrigin = origin;
			this.exposure = this.factory(origin);
		}
		const exposure = this.requireExposure();
		try {
			if (this.webRtcUnavailableReason !== undefined)
				throw new Error(this.webRtcUnavailableReason);
			this.hostKey = this.requireHostKey();
			await this.ensureWebRtcRuntimeAvailable?.();
		} catch (error) {
			this.runtimeError =
				error instanceof Error
					? error.message
					: 'Desktop WebRTC runtime is unavailable.';
			return this.getStatus();
		}
		exposure.start();
		try {
			this.hosted = await this.register(exposure);
			this.runtimeError = undefined;
		} catch (error) {
			this.hosted = undefined;
			exposure.stopExposure();
			this.runtimeError =
				error instanceof Error
					? error.message
					: 'Hosted signaling could not connect.';
			return this.getStatus();
		}
		return this.getStatus();
	}

	async createPairingLink(): Promise<RemoteAccessStatus> {
		if (this.requireExposure().status.exposure.state !== 'exposed')
			throw new Error('Remote Access is not exposed.');
		const hosted = this.hosted;
		if (hosted === undefined)
			throw new Error('Hosted pairing is not available.');
		await hosted.mintPairing();
		return this.getStatus();
	}

	async rotate(): Promise<RemoteAccessStatus> {
		const current = this.requireExposure();
		if (current.status.exposure.state !== 'exposed')
			throw new Error('Remote Access is not exposed.');
		if (this.webRtcUnavailableReason !== undefined)
			throw new Error(this.webRtcUnavailableReason);
		this.hostKey = this.requireHostKey();
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
		this.hostedConnections = [];
		return this.getStatus();
	}

	/** Where this server is exposed, once it has been. */
	get currentSessionOrigin(): string | undefined {
		return this.sessionOrigin;
	}

	async revokeDevice(deviceId: string): Promise<RemoteAccessStatus> {
		await this.requireExposure().revokeDevice(deviceId);
		this.persistDevices?.(this.requireExposure().devices.list());
		this.onStatusChanged?.();
		return this.getStatus();
	}

	/** The administrator compared the match code and confirmed the device. */
	approveDevice(approvalId: string): RemoteAccessStatus {
		this.requireExposure().approveEnrollment(approvalId);
		this.onStatusChanged?.();
		return this.getStatus();
	}

	denyDevice(approvalId: string): RemoteAccessStatus {
		this.requireExposure().denyEnrollment(approvalId);
		this.onStatusChanged?.();
		return this.getStatus();
	}

	/**
	 * Explicit trust reset: a new host key, every device revoked, live peers
	 * closed, and the reconnect host re-registered under the new key.
	 */
	async resetIdentity(): Promise<RemoteAccessStatus> {
		const store = this.hostKeyStore;
		if (store === undefined)
			throw new Error('Desktop hosted signaling host is not configured.');
		const exposure = this.exposure;
		if (exposure !== undefined) {
			await exposure.revokeAllDevices();
			this.persistDevices?.(exposure.devices.list());
		}
		this.hostKey = store.rotate();
		if (exposure?.status.exposure.state === 'exposed') {
			await this.rotate();
		}
		this.onStatusChanged?.();
		return this.getStatus();
	}

	/** Close a live connection. A hosted connection belongs to a device, and
	 * closing it closes every window that device has open; the device stays
	 * trusted. */
	async closeConnection(connectionId: string): Promise<RemoteAccessStatus> {
		const hosted = this.hostedConnections.find(
			(connection) => connection.connectionId === connectionId,
		);
		if (hosted !== undefined && this.hosted !== undefined) {
			await this.hosted.closeDevice(hosted.deviceId);
			this.hostedConnections = this.hostedConnections.filter(
				(connection) => connection.deviceId !== hosted.deviceId,
			);
			this.onStatusChanged?.();
			return this.getStatus();
		}
		this.requireExposure().manager.closePeer(connectionId);
		return this.getStatus();
	}

	async shutdown(): Promise<void> {
		this.stopApprovalSubscriptions?.();
		this.stopApprovalSubscriptions = undefined;
		await this.hosted?.close();
		this.hosted = undefined;
		this.hostedConnections = [];
		await this.exposure?.shutdown();
	}

	private requireHostKey(): HostedHostKey {
		if (this.hostKeyStore === undefined)
			throw new Error('Desktop hosted signaling host is not configured.');
		return this.hostKey ?? this.hostKeyStore.loadOrCreate();
	}

	private async register(exposure: ServerRemoteExposure) {
		assertAuthenticatedRemoteAccessContract(
			AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
			AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
		);
		const handoff = exposure.pairingHandoff;
		if (handoff === undefined)
			throw new Error('Server exposure did not create a pairing handoff.');
		if (this.webrtcRuntimeRoot === undefined) {
			throw new Error('Desktop hosted signaling host is not configured.');
		}
		const hostKey = this.requireHostKey();
		this.hostKey = hostKey;
		this.stopApprovalSubscriptions?.();
		const stopRequested = exposure.onApprovalRequested((approval) => {
			this.onApprovalRequested?.(approval);
			this.onStatusChanged?.();
		});
		const stopResolved = exposure.onApprovalResolved(() => {
			this.onStatusChanged?.();
		});
		this.stopApprovalSubscriptions = () => {
			stopRequested();
			stopResolved();
		};
		return startHostedPairingHost({
			handoff,
			hostKey,
			persistDevices: (devices) => {
				this.persistDevices?.(devices);
				this.onStatusChanged?.();
			},
			remote: exposure,
			serverId: this.serverId,
			webrtcRuntimeRoot: this.webrtcRuntimeRoot,
			rotateHandoff: () => exposure.rotateHostedPairing(),
			onHandoff: () => this.onStatusChanged?.(),
			onPeerConnected: (peer) => {
				this.hostedConnections = [
					...this.hostedConnections.filter(
						(connection) => connection.connectionId !== peer.connectionId,
					),
					{
						attachedSessionCount: 1,
						connectionId: peer.connectionId,
						deviceId: peer.deviceId,
						deviceName: peer.deviceName,
					},
				];
				this.onStatusChanged?.();
				try {
					// The connected trigger is for a device coming online, not for
					// each further window it opens.
					if (peer.firstWindowOfDevice)
						this.onConnectionAdmitted?.({
							connectionId: peer.connectionId,
							deviceId: peer.deviceId,
							deviceName: peer.deviceName,
						});
				} catch {
					// An observer failure never undoes an admission.
				}
			},
			onPeerDisconnected: (connectionId) => {
				this.hostedConnections = this.hostedConnections.filter(
					(connection) => connection.connectionId !== connectionId,
				);
				this.onStatusChanged?.();
			},
			...(this.onDiagnostic === undefined ? {} : { onDiagnostic: this.onDiagnostic }),
			...(this.acceptApplication === undefined
				? {}
				: { acceptApplication: this.acceptApplication }),
			...(this.getUiArchive === undefined ? {} : { getUiArchive: this.getUiArchive }),
			...(this.signal === undefined ? {} : { signal: this.signal }),
			...(this.resolveIceServers === undefined
				? this.iceServers === undefined
					? {}
					: { iceServers: this.iceServers }
				: { resolveIceServers: this.resolveIceServers }),
			...(this.iceRecoveryGraceMs === undefined
				? {}
				: { iceRecoveryGraceMs: this.iceRecoveryGraceMs }),
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
	hostedConnections: readonly Readonly<{
		attachedSessionCount: number;
		connectionId: string;
		deviceId: string;
		deviceName: string;
	}>[] = [],
): RemoteAccessStatus {
	return projectRemoteAccessStatus({
		exposure,
		hasSessionOrigin: sessionOrigin !== undefined,
		hostedConnections,
	});
}
