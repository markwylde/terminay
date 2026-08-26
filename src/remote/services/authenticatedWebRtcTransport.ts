import {
	assertAuthenticatedWebRtcTransportTranscript,
	validateAuthenticatedWebRtcTransportTranscript,
	verifyAuthenticatedWebRtcHostSignature,
	verifyAuthenticatedWebRtcPairingAuthenticator,
	type AuthenticatedWebRtcTransportScope,
	type AuthenticatedWebRtcTransportTranscript,
} from '@terminay/protocol';

export type PinnedServerHostKey = Readonly<{
	algorithm: 'ed25519';
	publicKey: string;
}>;

export type AuthenticatedWebRtcOfferProof = Readonly<{
	transcript: AuthenticatedWebRtcTransportTranscript;
	hostSignature: string;
	pairingAuthenticator?: string;
}>;

export class AuthenticatedWebRtcOfferVerifier {
	private readonly seenOfferIds = new Set<string>();

	constructor(private readonly maximumSeenOfferIds = 256) {
		if (!Number.isSafeInteger(maximumSeenOfferIds) || maximumSeenOfferIds < 1 || maximumSeenOfferIds > 1_024) {
			throw new RangeError('Authenticated WebRTC offer replay limit is invalid.');
		}
	}

	async verifyPairing(options: Readonly<{
		proof: unknown;
		pairingSecret: string;
		scopeId: string;
		sessionOrigin: string;
		serverId: string;
		clientNonce: string;
		sdp: string;
		now?: number;
	}>): Promise<PinnedServerHostKey> {
		const proof = parseProof(options.proof, true);
		const transcript = await this.verifyTranscript(proof, 'pairing', options);
		await verifyAuthenticatedWebRtcPairingAuthenticator(
			options.pairingSecret,
			transcript,
			proof.pairingAuthenticator!,
		);
		await verifyAuthenticatedWebRtcHostSignature(transcript, proof.hostSignature);
		this.remember(transcript.offerId);
		return Object.freeze({ algorithm: 'ed25519', publicKey: transcript.hostPublicKey });
	}

	async verifyReconnect(options: Readonly<{
		proof: unknown;
		pinnedHostKey: PinnedServerHostKey;
		scopeId: string;
		sessionOrigin: string;
		serverId: string;
		clientNonce: string;
		sdp: string;
		now?: number;
	}>): Promise<void> {
		if (options.pinnedHostKey.algorithm !== 'ed25519') throw new Error('Pinned server host key algorithm is unsupported.');
		const proof = parseProof(options.proof, false);
		const transcript = await this.verifyTranscript(proof, 'reconnect', options);
		if (transcript.hostPublicKey !== options.pinnedHostKey.publicKey) {
			throw new Error('Server host identity changed; explicit re-pairing is required.');
		}
		await verifyAuthenticatedWebRtcHostSignature(transcript, proof.hostSignature);
		this.remember(transcript.offerId);
	}

	private async verifyTranscript(
		proof: AuthenticatedWebRtcOfferProof,
		scope: AuthenticatedWebRtcTransportScope,
		options: Readonly<{
			scopeId: string;
			sessionOrigin: string;
			serverId: string;
			clientNonce: string;
			sdp: string;
			now?: number;
		}>,
	): Promise<AuthenticatedWebRtcTransportTranscript> {
		const transcript = await assertAuthenticatedWebRtcTransportTranscript(proof.transcript, {
			scope,
			scopeId: options.scopeId,
			sessionOrigin: options.sessionOrigin,
			serverId: options.serverId,
			clientNonce: options.clientNonce,
			sdp: options.sdp,
			...(options.now === undefined ? {} : { now: options.now }),
		});
		if (this.seenOfferIds.has(transcript.offerId)) throw new Error('Authenticated WebRTC offer was replayed.');
		if (this.seenOfferIds.size >= this.maximumSeenOfferIds) throw new Error('Authenticated WebRTC offer replay window is full.');
		return transcript;
	}

	private remember(offerId: string): void { this.seenOfferIds.add(offerId); }
}

function parseProof(value: unknown, pairing: boolean): AuthenticatedWebRtcOfferProof {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Authenticated WebRTC offer proof is invalid.');
	const input = value as Record<string, unknown>;
	const allowed = new Set(['hostSignature', 'pairingAuthenticator', 'transcript']);
	if (Object.keys(input).some((key) => !allowed.has(key)) || Object.keys(input).length !== (pairing ? 3 : 2) ||
		typeof input.hostSignature !== 'string' || (pairing ? typeof input.pairingAuthenticator !== 'string' : input.pairingAuthenticator !== undefined)) {
		throw new TypeError('Authenticated WebRTC offer proof fields are invalid.');
	}
	return Object.freeze({
		transcript: validateAuthenticatedWebRtcTransportTranscript(input.transcript),
		hostSignature: input.hostSignature,
		...(pairing ? { pairingAuthenticator: input.pairingAuthenticator as string } : {}),
	});
}
