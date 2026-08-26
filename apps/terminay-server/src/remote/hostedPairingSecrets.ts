import { createHash, hkdfSync } from 'node:crypto';

const HKDF_LABELS = {
	pairingRoomId: 'terminay remote v1 pairing room',
	pairingToken: 'terminay remote v1 pairing',
	relayJoinToken: 'terminay remote v1 relay join',
} as const;

export function deriveHostedPairingSecrets(qrSecret: string) {
	const secret = Buffer.from(qrSecret, 'base64url');
	if (secret.byteLength < 32 || secret.toString('base64url') !== qrSecret) {
		throw new Error('Hosted pairing secret is invalid.');
	}
	const derive = (label: string) =>
		Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), label, 32)).toString(
			'base64url',
		);
	const relayJoinToken = derive(HKDF_LABELS.relayJoinToken);
	return Object.freeze({
		qrSecret,
		pairingRoomId: derive(HKDF_LABELS.pairingRoomId),
		pairingToken: derive(HKDF_LABELS.pairingToken),
		relayJoinToken,
		relayJoinTokenHash: createHash('sha256').update(relayJoinToken).digest('base64url'),
	});
}

export function hostedSignalingUrl(sessionOrigin: string): string {
	const url = new URL(sessionOrigin);
	url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
	url.pathname = '/signal';
	url.search = '';
	url.hash = '';
	return url.toString();
}

/** Stable session id advertised to the hosted relay for saved-device reconnect. */
export function hostedSessionId(sessionOrigin: string): string {
	const host = new URL(sessionOrigin).hostname.toLowerCase();
	const sessionId = host.endsWith('.terminay.com')
		? host.slice(0, -'.terminay.com'.length)
		: (host.split('.')[0] ?? '');
	if (!/^[a-z0-9](?:[a-z0-9-]{6,61}[a-z0-9])$/u.test(sessionId) || sessionId.includes('.')) {
		throw new Error('Hosted session origin is invalid.');
	}
	return sessionId;
}
