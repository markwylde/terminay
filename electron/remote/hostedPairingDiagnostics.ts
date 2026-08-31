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
	'peer-state': 'local-server.remote-webrtc.peer-state',
	'ice-grace': 'local-server.remote-webrtc.ice-grace',
	'channel-state': 'local-server.remote-webrtc.channel-state',
	'application-lane': 'local-server.remote-webrtc.application-lane',
	'peer-closed': 'local-server.remote-webrtc.peer-closed',
} as const;

const STREAM_TYPES = new Set([
	'peer-state',
	'ice-grace',
	'channel-state',
	'application-lane',
	'peer-closed',
]);

export function hostedPairingDiagnosticEvent(
	event: HostedPairingDiagnostic,
): DiagnosticEventInput {
	const stream = STREAM_TYPES.has(event.type);
	const warning =
		event.type === 'failed' ||
		event.type === 'signaling-closed' ||
		event.type === 'peer-closed' ||
		event.sendFailure === true ||
		event.channelState === 'closed' ||
		event.channelState === 'failed';
	return {
		component: 'local-server',
		event: EVENT_NAMES[event.type],
		fields: {
			advertisedUrlClass: event.advertisedUrlClass,
			bufferedAmount: event.bufferedAmount,
			cause: event.cause,
			channel: event.channel,
			channelState: event.channelState,
			closeCode: event.closeCode,
			closeReasonClass: event.closeReasonClass,
			droppedClass: event.droppedClass,
			droppedFrames: event.droppedFrames,
			hangup: event.hangup,
			first: event.first,
			firstInboundAgeMs: event.firstInboundAgeMs,
			firstOutboundAgeMs: event.firstOutboundAgeMs,
			iceGracePhase: event.iceGracePhase,
			iceState: event.iceState,
			inboundBytes: event.inboundBytes,
			inboundFrames: event.inboundFrames,
			inboundKind: event.inboundKind,
			lastInboundAgeMs: event.lastInboundAgeMs,
			lastOutboundAgeMs: event.lastOutboundAgeMs,
			liveGenerationCount: event.liveGenerationCount,
			outboundBytes: event.outboundBytes,
			outboundFrames: event.outboundFrames,
			peerState: event.peerState,
			reasonClass: event.reasonClass,
			remainingMs: event.remainingMs,
			scope: event.scope,
			sendFailure: event.sendFailure,
			sendFailures: event.sendFailures,
			signalingHostClass: event.signalingHostClass,
			summary: event.summary,
		},
		severity: warning ? 'warning' : 'info',
		source: stream ? 'remote-webrtc' : 'remote-pairing',
	};
}
