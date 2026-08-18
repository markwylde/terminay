import type { DiagnosticEventInput } from '../diagnostics/core';
import type { HostedPairingDiagnostic } from '../../apps/terminay-server/src/remote/hostedPairingHost';

const EVENT_NAMES = {
	advertised: 'local-server.remote-pairing.advertised',
	registered: 'local-server.remote-pairing.registered',
	'signaling-closed': 'local-server.remote-pairing.signaling-closed',
	rotated: 'local-server.remote-pairing.rotated',
	reregistered: 'local-server.remote-pairing.reregistered',
	'client-join': 'local-server.remote-pairing.client-join',
	failed: 'local-server.remote-pairing.failed',
} as const;

export function hostedPairingDiagnosticEvent(
	event: HostedPairingDiagnostic,
): DiagnosticEventInput {
	return {
		component: 'local-server',
		event: EVENT_NAMES[event.type],
		fields: {
			advertisedUrlClass: event.advertisedUrlClass,
			cause: event.cause,
			closeCode: event.closeCode,
			closeReasonClass: event.closeReasonClass,
			remainingMs: event.remainingMs,
			scope: event.scope,
			signalingHostClass: event.signalingHostClass,
		},
		severity:
			event.type === 'failed' || event.type === 'signaling-closed'
				? 'warning'
				: 'info',
		source: 'remote-pairing',
	};
}
