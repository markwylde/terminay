import type { HostedPairingDiagnostic } from './hostedPairingHost.js';

export const APPLICATION_SUMMARY_MS = 10_000;

const CHANNEL_LABELS = new Set([
	'api',
	'asset',
	'assets',
	'application',
	'control',
	'terminal',
]);

export type HostedInboundKind = 'bytes' | 'blob' | 'string' | 'empty' | 'other';
export type HostedIceGracePhase = 'started' | 'cleared' | 'expired';

export function inboundKind(value: unknown): HostedInboundKind {
	if (value === undefined || value === null) return 'empty';
	if (typeof value === 'string') return value.length === 0 ? 'empty' : 'string';
	if (typeof Blob !== 'undefined' && value instanceof Blob) return 'blob';
	if (value instanceof ArrayBuffer) return value.byteLength === 0 ? 'empty' : 'bytes';
	if (ArrayBuffer.isView(value)) return value.byteLength === 0 ? 'empty' : 'bytes';
	return 'other';
}

export function frameByteLength(value: unknown): number {
	if (typeof value === 'string') return value.length;
	if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
	if (value instanceof ArrayBuffer) return value.byteLength;
	if (ArrayBuffer.isView(value)) return value.byteLength;
	return 0;
}

export function classifyPeerCloseReason(reason: string): string {
	const text = String(reason ?? '').toLowerCase();
	if (text.includes('grace period expired')) return 'ice-grace-expired';
	if (text.includes('ice connection failed') || text.includes('ice connection closed')) {
		return 'ice-failed';
	}
	if (text.includes('peer connection failed') || text.includes('peer connection closed')) {
		return 'peer-failed';
	}
	if (text.includes('replaced')) return 'replaced-by-rejoin';
	if (text.includes('heartbeat')) return 'heartbeat-timeout';
	if (text.includes('disconnected')) return 'disconnected';
	if (text.includes('lane closed') || text.includes('lane closing') || text.includes('lane failed')) {
		return 'required-lane-closed';
	}
	if (!text.trim()) return 'empty';
	return 'other';
}

export function createHostedStreamDiagnostics(options: {
	readonly emit: (event: HostedPairingDiagnostic) => void;
	readonly now?: () => number;
	readonly summaryMs?: number;
	readonly setIntervalFn?: typeof setInterval;
	readonly clearIntervalFn?: typeof clearInterval;
}) {
	const now = options.now ?? Date.now;
	const summaryMs = options.summaryMs ?? APPLICATION_SUMMARY_MS;
	const setIntervalFn = options.setIntervalFn ?? setInterval;
	const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
	let inboundFrames = 0;
	let outboundFrames = 0;
	let inboundBytes = 0;
	let outboundBytes = 0;
	let firstInboundAt: number | null = null;
	let firstOutboundAt: number | null = null;
	let lastInboundAt: number | null = null;
	let lastOutboundAt: number | null = null;
	let lastInboundKind: HostedInboundKind | undefined;
	let droppedFrames = 0;
	let sendFailures = 0;
	let lastPeerState: string | undefined;
	let lastIceState: string | undefined;
	let lastClosedChannel:
		| 'api'
		| 'asset'
		| 'assets'
		| 'application'
		| 'control'
		| 'terminal'
		| undefined;
	let stopped = false;
	let summaryTimer: ReturnType<typeof setInterval> | undefined;

	function emit(event: HostedPairingDiagnostic): void {
		if (stopped) return;
		options.emit(event);
	}

	function laneFields(extra: Record<string, unknown> = {}): HostedPairingDiagnostic {
		const current = now();
		return {
			type: 'application-lane',
			channel: 'application',
			inboundFrames,
			outboundFrames,
			inboundBytes,
			outboundBytes,
			lastInboundAgeMs: lastInboundAt === null ? null : Math.max(0, current - lastInboundAt),
			lastOutboundAgeMs:
				lastOutboundAt === null ? null : Math.max(0, current - lastOutboundAt),
			firstInboundAgeMs:
				firstInboundAt === null ? null : Math.max(0, current - firstInboundAt),
			firstOutboundAgeMs:
				firstOutboundAt === null ? null : Math.max(0, current - firstOutboundAt),
			inboundKind: lastInboundKind,
			droppedFrames,
			sendFailures,
			peerState: lastPeerState,
			iceState: lastIceState,
			...extra,
		};
	}

	function startSummary(): void {
		if (summaryTimer !== undefined) return;
		summaryTimer = setIntervalFn(() => {
			if (stopped) return;
			emit(laneFields({ summary: true }));
		}, summaryMs);
		summaryTimer.unref?.();
	}

	function stop(): void {
		if (stopped) return;
		stopped = true;
		if (summaryTimer !== undefined) clearIntervalFn(summaryTimer);
		summaryTimer = undefined;
	}

	return {
		peerState(peerState: string | undefined, iceState: string | undefined): void {
			if (peerState === lastPeerState && iceState === lastIceState) return;
			lastPeerState = peerState;
			lastIceState = iceState;
			emit({ type: 'peer-state', peerState, iceState });
			if (peerState === 'connected' || iceState === 'connected' || iceState === 'completed') {
				startSummary();
			}
		},
		iceGrace(
			phase: HostedIceGracePhase,
			peerState: string | undefined,
			iceState: string | undefined,
		): void {
			lastPeerState = peerState;
			lastIceState = iceState;
			emit({ type: 'ice-grace', iceGracePhase: phase, peerState, iceState });
		},
		channelState(channel: string, channelState: string | undefined, hangup = false): void {
			if (!CHANNEL_LABELS.has(channel)) return;
			const label = channel as
				| 'api'
				| 'asset'
				| 'assets'
				| 'application'
				| 'control'
				| 'terminal';
			const closed =
				channelState === 'closed' ||
				channelState === 'closing' ||
				channelState === 'failed';
			if (closed) lastClosedChannel = label;
			emit({
				type: 'channel-state',
				channel: label,
				channelState,
				peerState: lastPeerState,
				iceState: lastIceState,
				...(closed ? { hangup } : {}),
			});
		},
		noteInbound(value: unknown): void {
			const kind = inboundKind(value);
			lastInboundKind = kind;
			if (kind !== 'bytes' && kind !== 'blob') {
				droppedFrames += 1;
				emit(laneFields({ droppedClass: kind }));
				return;
			}
			inboundFrames += 1;
			inboundBytes += frameByteLength(value);
			const at = now();
			firstInboundAt ??= at;
			lastInboundAt = at;
			if (inboundFrames === 1) emit(laneFields({ first: 'inbound' }));
		},
		noteOutbound(byteLength: number, ok = true): void {
			if (!ok) {
				sendFailures += 1;
				emit(laneFields({ sendFailure: true }));
				return;
			}
			outboundFrames += 1;
			outboundBytes += byteLength;
			const at = now();
			firstOutboundAt ??= at;
			lastOutboundAt = at;
			if (outboundFrames === 1) emit(laneFields({ first: 'outbound' }));
		},
		peerClosed(reason: string): void {
			if (stopped) return;
			emit({
				type: 'peer-closed',
				reasonClass: classifyPeerCloseReason(reason),
				peerState: lastPeerState,
				iceState: lastIceState,
				inboundFrames,
				outboundFrames,
				inboundBytes,
				outboundBytes,
				droppedFrames,
				sendFailures,
				hangup: true,
				...(lastClosedChannel === undefined
					? {}
					: { channel: lastClosedChannel }),
			});
			stop();
		},
		snapshot: () => laneFields(),
		stop,
	};
}

export type HostedStreamDiagnostics = ReturnType<typeof createHostedStreamDiagnostics>;
