import { createSecureWeriftHeadlessHost } from '../../apps/terminay-server/src/remote/secureWeriftHost';
import { verifySelectedSecureWeriftRuntime } from '../../apps/terminay-server/src/remote/secureWeriftRuntime';
import {
	createServerRemoteExposure,
	type ServerRemoteExposure,
} from '../../apps/terminay-server/src/remote/serverExposure';
import type { RemoteAccessStatus } from '../../src/types/terminay';
import type {
	AuthenticatedHostedSignalingRoomRegistrar,
	HostedPairingHandoff,
	HostedSignalingRoomRegistrar,
	HostedSignalingRoomRegistration,
} from './hostedSignalingRegistration';

export interface DesktopServerOwnedExposureOptions {
	readonly serverId: string;
	readonly resolveSessionOrigin: () => string;
	readonly signalingRegistrar?: HostedSignalingRoomRegistrar;
	readonly ensureWebRtcRuntimeAvailable?: () => void | Promise<void>;
	readonly webRtcUnavailableReason?: string;
	readonly secureWerift?: Readonly<{
		readonly runtimeRoot: string;
		readonly signalingRegistrar: AuthenticatedHostedSignalingRoomRegistrar;
	}>;
	readonly createExposure?: (sessionOrigin: string) => ServerRemoteExposure;
}

/** Desktop projection over the server-owned WebRTC exposure authority. */
export class DesktopServerOwnedExposure {
	private readonly serverId: string;
	private readonly factory: (sessionOrigin: string) => ServerRemoteExposure;
	private readonly resolveSessionOrigin: () => string;
	private readonly signalingRegistrar: HostedSignalingRoomRegistrar | undefined;
	private readonly ensureWebRtcRuntimeAvailable:
		| (() => void | Promise<void>)
		| undefined;
	private readonly webRtcUnavailableReason: string | undefined;
	private exposure: ServerRemoteExposure | undefined;
	private registration: HostedSignalingRoomRegistration | undefined;
	private runtimeError: string | undefined;
	private sessionOrigin: string | undefined;

	constructor(options: DesktopServerOwnedExposureOptions) {
		if (
			options.secureWerift !== undefined &&
			options.signalingRegistrar !== undefined &&
			options.signalingRegistrar !== options.secureWerift.signalingRegistrar
		) {
			throw new TypeError(
				'Desktop WebRTC runtime and hosted signaling registrar must share one authority.',
			);
		}
		this.serverId = options.serverId;
		this.resolveSessionOrigin = options.resolveSessionOrigin;
		this.signalingRegistrar =
			options.secureWerift?.signalingRegistrar ?? options.signalingRegistrar;
		this.ensureWebRtcRuntimeAvailable =
			options.ensureWebRtcRuntimeAvailable ??
			(options.secureWerift === undefined
				? undefined
				: async () => {
						await verifySelectedSecureWeriftRuntime(
							options.secureWerift!.runtimeRoot,
						);
					});
		this.webRtcUnavailableReason = options.webRtcUnavailableReason;
		this.runtimeError = options.webRtcUnavailableReason;
		this.factory =
			options.createExposure ??
			((sessionOrigin) =>
				createServerRemoteExposure({
					serverId: this.serverId,
					sessionOrigin,
					pairingUrlFormat: 'hosted-compact',
					...(options.secureWerift === undefined
						? {}
						: {
								createHeadlessHost: (manager, onEvent) =>
									createSecureWeriftHeadlessHost({
										manager,
										onEvent,
										runtimeRoot: options.secureWerift!.runtimeRoot,
										createSignaling:
											options.secureWerift!.signalingRegistrar.createSignaling,
									}),
							}),
				}));
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
			await this.registration?.close();
			this.registration = undefined;
			this.exposure.stopExposure();
			return this.getStatus();
		}
		this.runtimeError = this.webRtcUnavailableReason;
		const origin = normalizeSessionOrigin(this.resolveSessionOrigin());
		if (origin !== this.sessionOrigin) {
			await this.registration?.close();
			this.registration = undefined;
			await this.exposure?.shutdown();
			this.sessionOrigin = origin;
			this.exposure = this.factory(origin);
		}
		const exposure = this.requireExposure();
		try {
			if (this.webRtcUnavailableReason !== undefined)
				throw new Error(this.webRtcUnavailableReason);
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
			this.registration = await this.register(exposure);
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
		await this.ensureWebRtcRuntimeAvailable?.();
		const origin = this.sessionOrigin;
		if (origin === undefined)
			throw new Error('Remote Access session origin is unavailable.');
		const candidate = this.factory(origin);
		candidate.start();
		let registration: HostedSignalingRoomRegistration | undefined;
		try {
			registration = await this.register(candidate);
		} catch (error) {
			await candidate.shutdown();
			throw error;
		}
		await this.registration?.close();
		await current.shutdown();
		this.exposure = candidate;
		this.registration = registration;
		return this.getStatus();
	}

	async revokeDevice(deviceId: string): Promise<RemoteAccessStatus> {
		await this.requireExposure().revokeDevice(deviceId);
		return this.getStatus();
	}

	closeConnection(connectionId: string): RemoteAccessStatus {
		this.requireExposure().manager.closePeer(connectionId);
		return this.getStatus();
	}

	async shutdown(): Promise<void> {
		await this.registration?.close();
		this.registration = undefined;
		await this.exposure?.shutdown();
	}

	private async register(exposure: ServerRemoteExposure) {
		if (this.signalingRegistrar === undefined) return undefined;
		const handoff = exposure.pairingHandoff;
		if (handoff === undefined)
			throw new Error('Server exposure did not create a pairing handoff.');
		return this.signalingRegistrar.register(
			handoff as unknown as HostedPairingHandoff,
		);
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
	const handoffUrl =
		pairing === undefined
			? null
			: ((exposure?.pairingHandoff as unknown as
					| HostedPairingHandoff
					| undefined)?.pairingUrl ?? null);
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
		configurationIssue:
			sessionOrigin === undefined ? 'Remote Access session origin is unavailable.' : null,
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
