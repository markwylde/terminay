import type { ServerRemoteExposure } from './serverExposure.js';

/**
 * The remote-access status every server host reports to clients
 * (ADR-0120). Structurally identical to the client's `RemoteAccessStatus`.
 */
export type RemoteAccessStatus = {
	activeConnectionCount: number;
	pendingApprovals: Array<{
		approvalId: string;
		deviceName: string;
		matchCode: string;
		expiresAt: string;
	}>;
	pendingWebRtcConnectionCount: number;
	auditEvents: Array<{
		action:
			| 'pairing-completed'
			| 'auth-verified'
			| 'device-revoked'
			| 'connection-opened'
			| 'connection-closed'
			| 'connection-revoked';
		connectionId: string | null;
		deviceId: string | null;
		deviceName: string | null;
		occurredAt: string;
		reason?: string;
	}>;
	connections: Array<{
		attachedSessionCount: number;
		connectionId: string;
		deviceId: string;
		deviceName: string;
	}>;
	configurationIssue: string | null;
	configurationPath: string;
	errorMessage: string | null;
	isRunning: boolean;
	pairedDeviceCount: number;
	pairedDevices: Array<{
		addedAt: string;
		deviceId: string;
		lastSeenAt: string | null;
		name: string;
	}>;
	webRtcPairingExpiresAt: string | null;
	webRtcPairingQrCodeDataUrl: string | null;
	webRtcPairingUrl: string | null;
	webRtcRoomId: string | null;
	webRtcStatus: 'error' | 'not-configured' | 'pairing-ready' | 'registering';
	webRtcStatusMessage: string | null;
};

export type RemoteAccessConnection = Readonly<{
	attachedSessionCount: number;
	connectionId: string;
	deviceId: string;
	deviceName: string;
}>;

export interface RemoteAccessStatusInput {
	readonly exposure: ServerRemoteExposure | undefined;
	/** Whether the administrator's exposure is on. Defaults to the manager's
	 * exposure state, which is what Desktop reports. */
	readonly isRunning?: boolean;
	/** Whether a session origin is known; without one the status is
	 * `not-configured` rather than `registering`. */
	readonly hasSessionOrigin: boolean;
	/** The pairing link to show. Defaults to the exposure's handoff URL. */
	readonly pairingUrl?: string | null;
	readonly hostedConnections?: readonly RemoteAccessConnection[];
	readonly errorMessage?: string | null;
}

/** One projection of server-owned exposure state for every server host. */
export function projectRemoteAccessStatus(
	input: RemoteAccessStatusInput,
): RemoteAccessStatus {
	const exposure = input.exposure;
	const status = exposure?.status;
	const isRunning = input.isRunning ?? status?.exposure.state === 'exposed';
	// A host that reports its own running state (standalone) shows pairing only
	// while running: its manager stays exposed for the local endpoint.
	const showPairing = input.isRunning === undefined || input.isRunning;
	const pairing = showPairing ? status?.pairing : undefined;
	const handoffUrl = !showPairing
		? null
		: input.pairingUrl !== undefined
			? input.pairingUrl
			: (exposure?.pairingHandoff?.pairingUrl ?? null);
	const peers = (status?.peers ?? []) as readonly Readonly<{
		state: string;
		peerId: string;
		deviceId: string;
	}>[];
	const devices = (
		(exposure?.devices.list() ?? []) as readonly Readonly<{
			createdAt: number;
			deviceId: string;
			deviceName: string;
			lastSeenAt: number | null;
			revokedAt: number | null;
		}>[]
	).filter((device) => device.revokedAt === null);
	const namedDevice = (deviceId: string) =>
		devices.find((device) => device.deviceId === deviceId)?.deviceName ??
		deviceId;
	const managerConnections = peers
		.filter((peer) => peer.state === 'connected')
		.map((peer) => ({
			attachedSessionCount: 0,
			connectionId: peer.peerId,
			deviceId: peer.deviceId,
			deviceName: namedDevice(peer.deviceId),
		}));
	const connections = [
		...managerConnections,
		...(input.hostedConnections ?? []).map((connection) => ({
			...connection,
		})),
	];
	const pendingApprovals = (exposure?.listPendingApprovals() ?? []).map(
		(approval) => ({
			approvalId: approval.approvalId,
			deviceName: approval.deviceName,
			matchCode: approval.matchCode,
			expiresAt: new Date(approval.expiresAt).toISOString(),
		}),
	);
	const errorMessage = input.errorMessage ?? null;
	return {
		activeConnectionCount: connections.length,
		pendingApprovals,
		pendingWebRtcConnectionCount: 0,
		auditEvents: [],
		connections,
		// Idle (not yet exposed) is not a settings problem. The renderer treats
		// configurationIssue as "open settings and abort" instead of exposing.
		configurationIssue: null,
		configurationPath: 'Terminay Server',
		errorMessage,
		isRunning,
		pairedDeviceCount: devices.length,
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
			errorMessage !== null && !isRunning
				? 'error'
				: pairing === undefined
					? input.hasSessionOrigin
						? 'registering'
						: 'not-configured'
					: 'pairing-ready',
		webRtcStatusMessage:
			errorMessage !== null && !isRunning
				? errorMessage
				: pairing === undefined
					? null
					: 'Terminay Server exposure is ready for pairing.',
	};
}
