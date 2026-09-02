import { randomBytes } from 'node:crypto';
import {
	AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
	type AuthenticatedWebRtcTransportScope,
} from '@terminay/protocol';
import {
	AuthenticatedWebRtcOfferVerifier,
	type PinnedServerHostKey,
} from '../../src/remote/services/authenticatedWebRtcTransport';

export type DesktopAuthenticatedWebRtcAuth = Readonly<{
	clientNonce: string;
	scope: AuthenticatedWebRtcTransportScope;
	scopeId: string;
	sessionOrigin: string;
	serverId: string;
	pairingSecret?: string;
	pinnedHostKey?: PinnedServerHostKey;
	now?: () => number;
	onPinned?: (pin: PinnedServerHostKey) => void | Promise<void>;
}>;

export type DesktopAuthenticatedOfferGate = Readonly<{
	clientNonce: string;
	verifier: AuthenticatedWebRtcOfferVerifier;
	verifyRemoteDescription(sdp: string, proof: unknown): Promise<PinnedServerHostKey | void>;
}>;

const CLIENT_NONCE_BYTES = 32;

export function createDesktopClientNonce(): string {
	return randomBytes(CLIENT_NONCE_BYTES).toString('base64url');
}

export function assertAuthenticatedRemoteAccessContract(
	clientVersion: unknown,
	serverVersion: unknown,
): void {
	if (
		clientVersion !== AUTHENTICATED_WEBRTC_TRANSPORT_VERSION ||
		serverVersion !== AUTHENTICATED_WEBRTC_TRANSPORT_VERSION
	) {
		throw new Error(
			'Remote Access cannot be advertised when its client or server lacks the authenticated transport contract.',
		);
	}
}

/**
 * Verify a remote WebRTC description against the shared transcript contract
 * before any caller may install it with `setRemoteDescription`.
 */
export function createDesktopAuthenticatedOfferGate(auth: DesktopAuthenticatedWebRtcAuth): DesktopAuthenticatedOfferGate {
	if (auth.scope === 'pairing') {
		if (typeof auth.pairingSecret !== 'string' || auth.pairingSecret.length === 0) {
			throw new Error('Desktop pairing transport authentication requires the fragment-derived secret.');
		}
	} else if (auth.pinnedHostKey === undefined) {
		throw new Error('Server host identity is not pinned; explicit re-pairing is required.');
	}
	const verifier = new AuthenticatedWebRtcOfferVerifier();
	return {
		clientNonce: auth.clientNonce,
		verifier,
		async verifyRemoteDescription(sdp, proof) {
			const now = auth.now?.();
			if (auth.scope === 'pairing') {
				const pin = await verifier.verifyPairing({
					proof,
					pairingSecret: auth.pairingSecret!,
					scopeId: auth.scopeId,
					sessionOrigin: auth.sessionOrigin,
					serverId: auth.serverId,
					clientNonce: auth.clientNonce,
					sdp,
					...(now === undefined ? {} : { now }),
				});
				await auth.onPinned?.(pin);
				return pin;
			}
			await verifier.verifyReconnect({
				proof,
				pinnedHostKey: auth.pinnedHostKey!,
				scopeId: auth.scopeId,
				sessionOrigin: auth.sessionOrigin,
				serverId: auth.serverId,
				clientNonce: auth.clientNonce,
				sdp,
				...(now === undefined ? {} : { now }),
			});
			return auth.pinnedHostKey;
		},
	};
}
