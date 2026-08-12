import type { RemoteReconnectGrantRecord } from '@terminay/server-core/remote';
import { createSecureWeriftHeadlessHost } from '../../apps/terminay-server/src/remote/secureWeriftHost';
import { verifySelectedSecureWeriftRuntime } from '../../apps/terminay-server/src/remote/secureWeriftRuntime';
import {
	createServerRemoteExposure,
	type ServerPairingHandoff,
	type ServerRemoteExposure,
} from '../../apps/terminay-server/src/remote/serverExposure';
import type { RemoteAccessStatus } from '../../src/types/terminay';
import type {
	AuthenticatedHostedSignalingRoomRegistrar,
	HostedSignalingRoomRegistrar,
	HostedSignalingRoomRegistration,
} from './hostedSignalingRegistration';

export interface DesktopServerOwnedExposureOptions {
	readonly serverId: string;
	readonly sessionOrigin?: string;
	readonly pairingMode?: () => 'lan' | 'webrtc';
	readonly resolveSessionOrigin?: () => string;
	readonly signalingRegistrar?: HostedSignalingRoomRegistrar;
	readonly ensureWebRtcRuntimeAvailable?: () => void | Promise<void>;
	/** Known build/composition failure projected before the user attempts to
	 * start WebRTC. This keeps an unavailable transport from being labelled
	 * ready while retaining the same fail-closed start check. */
	readonly webRtcUnavailableReason?: string;
	readonly lanListener?: Readonly<{
		start(
			input: Readonly<{
				exposure: ServerRemoteExposure;
				handoff: ServerPairingHandoff;
				sessionOrigin: string;
			}>,
		): Promise<void>;
		stop(): Promise<void>;
	}>;
	readonly initialReconnectRecords?: readonly RemoteReconnectGrantRecord[];
	readonly onReconnectRecordsChanged?: (
		records: readonly RemoteReconnectGrantRecord[],
	) => void;
	readonly secureWerift?: Readonly<{
		readonly runtimeRoot: string;
		readonly signalingRegistrar: AuthenticatedHostedSignalingRoomRegistrar;
	}>;
	readonly createExposure?: (
		sessionOrigin: string,
		pairingMode: 'lan' | 'webrtc',
	) => ServerRemoteExposure;
}

/** Desktop projection over the same server-owned exposure authority used by
 * standalone. It translates only presentation fields; lifecycle, pairing,
 * peer admission, revocation, audit, and cleanup remain in Terminay Server. */
export class DesktopServerOwnedExposure {
	private readonly serverId: string;
	private readonly factory: (
		sessionOrigin: string,
		pairingMode: 'lan' | 'webrtc',
	) => ServerRemoteExposure;
	private readonly lanListener: DesktopServerOwnedExposureOptions['lanListener'];
	private readonly onReconnectRecordsChanged:
		| DesktopServerOwnedExposureOptions['onReconnectRecordsChanged']
		| undefined;
	private readonly pairingMode: () => 'lan' | 'webrtc';
	private readonly resolveSessionOrigin: (() => string) | undefined;
	private readonly signalingRegistrar: HostedSignalingRoomRegistrar | undefined;
	private readonly ensureWebRtcRuntimeAvailable:
		| (() => void | Promise<void>)
		| undefined;
	private exposure: ServerRemoteExposure | undefined;
	private registration: HostedSignalingRoomRegistration | undefined;
	private runtimeError: string | undefined;
	private readonly webRtcUnavailableReason: string | undefined;
	private sessionOrigin: string | undefined;
	private exposureMode: 'lan' | 'webrtc' | undefined;

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
		this.pairingMode = options.pairingMode ?? (() => 'webrtc');
		this.resolveSessionOrigin = options.resolveSessionOrigin;
		this.lanListener = options.lanListener;
		this.onReconnectRecordsChanged = options.onReconnectRecordsChanged;
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
			((sessionOrigin, pairingMode) =>
				createServerRemoteExposure({
					serverId: this.serverId,
					sessionOrigin,
					pairingUrlFormat:
						pairingMode === 'webrtc' ? 'hosted-compact' : 'direct-device',
					reconnect: {
						initialRecords: (options.initialReconnectRecords ?? []).filter(
							(record) =>
								record.serverId === this.serverId &&
								record.sessionOrigin === sessionOrigin,
						),
					},
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
		if (options.sessionOrigin !== undefined) {
			this.sessionOrigin = normalizeSessionOrigin(options.sessionOrigin);
			this.exposureMode = this.pairingMode();
			this.exposure = this.factory(this.sessionOrigin, this.exposureMode);
		}
	}

	getStatus(): RemoteAccessStatus {
		const status = projectStatus(
			this.registration === undefined || this.registration.active
				? this.exposure
				: undefined,
			this.sessionOrigin,
			this.pairingMode(),
		);
		if (this.runtimeError === undefined || this.pairingMode() !== 'webrtc')
			return status;
		return {
			...status,
			errorMessage: this.runtimeError,
			isRunning: false,
			pairingExpiresAt: null,
			pairingUrl: null,
			webRtcPairingExpiresAt: null,
			webRtcPairingUrl: null,
			webRtcRoomId: null,
			webRtcStatus: 'error',
			webRtcStatusMessage: this.runtimeError,
		};
	}

	setPairingAddress(address: string): RemoteAccessStatus {
		const origin = normalizeSessionOrigin(address);
		if (this.exposure?.status.exposure.state === 'exposed') {
			throw new Error('Stop Remote Access before changing its session origin.');
		}
		void this.exposure?.shutdown();
		this.sessionOrigin = origin;
		this.exposureMode = this.pairingMode();
		this.exposure = this.factory(origin, this.exposureMode);
		return this.getStatus();
	}

	async toggle(): Promise<RemoteAccessStatus> {
		if (this.exposure?.status.exposure.state === 'exposed') {
			await this.registration?.close();
			this.registration = undefined;
			await this.lanListener?.stop();
			this.exposure.stopExposure();
			return this.getStatus();
		}
		this.runtimeError = this.webRtcUnavailableReason;
		const pairingMode = this.pairingMode();
		if (this.resolveSessionOrigin !== undefined) {
			const origin = normalizeSessionOrigin(this.resolveSessionOrigin());
			if (origin !== this.sessionOrigin || pairingMode !== this.exposureMode) {
				await this.registration?.close();
				await this.lanListener?.stop();
				await this.exposure?.shutdown();
				this.sessionOrigin = origin;
				this.exposureMode = pairingMode;
				this.exposure = this.factory(origin, pairingMode);
			}
		}
		const exposure = this.requireExposure();
		if (pairingMode === 'webrtc') {
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
		}
		const handoff = exposure.start();
		try {
			if (pairingMode === 'lan') {
				if (this.lanListener === undefined)
					throw new Error(
						'Desktop Local Network exposure is unavailable in this build.',
					);
				await this.lanListener.start({
					exposure,
					handoff,
					sessionOrigin: this.sessionOrigin!,
				});
			} else {
				this.registration = await this.register(exposure);
			}
		} catch (error) {
			await this.lanListener?.stop().catch(() => undefined);
			exposure.stopExposure();
			throw error;
		}
		return this.getStatus();
	}

	async rotate(): Promise<RemoteAccessStatus> {
		const current = this.requireExposure();
		if (current.status.exposure.state !== 'exposed')
			throw new Error('Remote Access is not exposed.');
		const origin = this.sessionOrigin;
		if (origin === undefined)
			throw new Error('Remote Access session origin is unavailable.');
		const pairingMode = this.pairingMode();
		if (pairingMode === 'webrtc') {
			if (this.webRtcUnavailableReason !== undefined)
				throw new Error(this.webRtcUnavailableReason);
			await this.ensureWebRtcRuntimeAvailable?.();
		}
		const candidate = this.factory(origin, pairingMode);
		const handoff = candidate.start();
		let registration: HostedSignalingRoomRegistration | undefined;
		try {
			if (pairingMode === 'lan') {
				if (this.lanListener === undefined)
					throw new Error(
						'Desktop Local Network exposure is unavailable in this build.',
					);
				await this.lanListener.stop();
				await this.lanListener.start({
					exposure: candidate,
					handoff,
					sessionOrigin: origin,
				});
			} else {
				registration = await this.register(candidate);
			}
		} catch (error) {
			await candidate.shutdown();
			const previousHandoff = current.pairingHandoff;
			if (
				pairingMode === 'lan' &&
				this.lanListener !== undefined &&
				previousHandoff !== undefined
			) {
				await this.lanListener
					.start({
						exposure: current,
						handoff: previousHandoff,
						sessionOrigin: origin,
					})
					.catch(() => undefined);
			}
			throw error;
		}
		await this.registration?.close();
		await current.shutdown();
		this.exposure = candidate;
		this.exposureMode = pairingMode;
		this.registration = registration;
		return this.getStatus();
	}

	async revokeDevice(deviceId: string): Promise<RemoteAccessStatus> {
		await this.requireExposure().revokeDevice(deviceId);
		this.publishReconnectRecords();
		return this.getStatus();
	}

	closeConnection(connectionId: string): RemoteAccessStatus {
		this.requireExposure().manager.closePeer(connectionId);
		return this.getStatus();
	}

	async shutdown(): Promise<void> {
		await this.registration?.close();
		this.registration = undefined;
		await this.lanListener?.stop();
		await this.exposure?.shutdown();
	}

	private async register(exposure: ServerRemoteExposure) {
		if (
			this.signalingRegistrar === undefined ||
			this.pairingMode() !== 'webrtc'
		)
			return undefined;
		const handoff = exposure.pairingHandoff;
		if (handoff === undefined)
			throw new Error('Server exposure did not create a pairing handoff.');
		return this.signalingRegistrar.register(handoff);
	}

	private requireExposure(): ServerRemoteExposure {
		if (this.exposure === undefined)
			throw new Error('Configure an HTTPS Remote Access session origin first.');
		return this.exposure;
	}

	private publishReconnectRecords(): void {
		if (this.exposure !== undefined)
			this.onReconnectRecordsChanged?.(this.exposure.reconnect.list());
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
	pairingMode: 'lan' | 'webrtc',
): RemoteAccessStatus {
	const status = exposure?.status;
	const pairing = status?.pairing;
	const handoffUrl =
		pairing === undefined
			? null
			: (exposure?.pairingHandoff?.pairingUrl ?? null);
	const peers = status?.peers ?? [];
	const devices = exposure?.devices.list() ?? [];
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
		availableAddresses: sessionOrigin === undefined ? [] : [sessionOrigin],
		configurationIssue:
			sessionOrigin === undefined
				? 'Configure an HTTPS Remote Access session origin.'
				: null,
		configurationPath: 'Terminay Server',
		errorMessage: null,
		isRunning: status?.exposure.state === 'exposed',
		lanPairingExpiresAt:
			pairingMode === 'lan' && pairing !== undefined
				? new Date(pairing.expiresAt).toISOString()
				: null,
		lanPairingQrCodeDataUrl: null,
		lanPairingQrCodePath: null,
		lanPairingUrl: pairingMode === 'lan' ? handoffUrl : null,
		origin: sessionOrigin ?? null,
		pairedDeviceCount: devices.filter((device) => device.revokedAt === null)
			.length,
		pairedDevices: devices.map((device) => ({
			addedAt: new Date(device.firstSeenAt).toISOString(),
			deviceId: device.deviceId,
			lastSeenAt:
				device.lastSeenAt === null
					? null
					: new Date(device.lastSeenAt).toISOString(),
			name: device.deviceId,
			origin: sessionOrigin ?? '',
			reconnectGrantExpiresAt: null,
			reconnectGrantLastUsedAt: null,
			reconnectGrantStatus: device.revokedAt === null ? 'none' : 'revoked',
		})),
		pairingMode,
		pairingExpiresAt:
			pairing === undefined ? null : new Date(pairing.expiresAt).toISOString(),
		pairingQrCodeDataUrl: null,
		pairingQrCodePath: null,
		pairingUrl: handoffUrl,
		webRtcPairingExpiresAt:
			pairingMode === 'webrtc' && pairing !== undefined
				? new Date(pairing.expiresAt).toISOString()
				: null,
		webRtcPairingQrCodeDataUrl: null,
		webRtcPairingUrl: pairingMode === 'webrtc' ? handoffUrl : null,
		webRtcRoomId: pairingMode === 'webrtc' ? (pairing?.roomId ?? null) : null,
		webRtcStatus:
			pairingMode === 'lan'
				? 'not-configured'
				: pairing === undefined
					? sessionOrigin === undefined
						? 'not-configured'
						: 'registering'
					: 'pairing-ready',
		webRtcStatusMessage:
			pairingMode === 'webrtc' && pairing !== undefined
				? 'Terminay Server exposure is ready for pairing.'
				: null,
	};
}
