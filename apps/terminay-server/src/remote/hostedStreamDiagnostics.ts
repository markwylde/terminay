import type { HostedPairingDiagnostic } from './hostedPairingHost.js';

export const APPLICATION_STALL_MS = 3_000;
export const APPLICATION_SUMMARY_MS = 10_000;
export const APPLICATION_STALL_REPEAT_MS = 15_000;

const CHANNEL_LABELS = new Set([
	'api',
	'asset',
	'assets',
	'application',
	'control',
	'terminal',
]);

export type HostedInboundKind = 'bytes' | 'blob' | 'string' | 'empty' | 'other';
export type HostedStallClass = 'no-outbound' | 'outbound-stalled';
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
	if (text.includes('disconnected')) return 'disconnected';
	if (!text.trim()) return 'empty';
	return 'other';
}

export function stallClass(input: {
	readonly inboundFrames: number;
	readonly outboundFrames: number;
	readonly firstInboundAt: number | null;
	readonly lastInboundAt: number | null;
	readonly lastOutboundAt: number | null;
	readonly now: number;
	readonly stallMs: number;
}): HostedStallClass | undefined {
	if (input.inboundFrames < 1) return undefined;
	if (input.outboundFrames < 1) {
		if (input.firstInboundAt === null) return undefined;
		if (input.now - input.firstInboundAt < input.stallMs) return undefined;
		return 'no-outbound';
	}
	if (input.lastOutboundAt === null || input.lastInboundAt === null) return undefined;
	if (input.now - input.lastOutboundAt < input.stallMs) return undefined;
	if (input.lastInboundAt <= input.lastOutboundAt) return undefined;
	return 'outbound-stalled';
}

export function createHostedStreamDiagnostics(options: {
	readonly emit: (event: HostedPairingDiagnostic) => void;
	readonly now?: () => number;
	readonly stallMs?: number;
	readonly summaryMs?: number;
	readonly setIntervalFn?: typeof setInterval;
	readonly clearIntervalFn?: typeof clearInterval;
}) {
	const now = options.now ?? Date.now;
	const stallMs = options.stallMs ?? APPLICATION_STALL_MS;
	const summaryMs = options.summaryMs ?? APPLICATION_SUMMARY_MS;
	const setIntervalFn = options.setIntervalFn ?? setInterval;
	const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
	let inboundFrames = 0;
	let outboundFrames = 0;
	let inboundBytes = 0;
	let outboundBytes = 0;
	let firstInboundAt: number | null = null;
	let lastInboundAt: number | null = null;
	let lastOutboundAt: number | null = null;
	let lastInboundKind: HostedInboundKind | undefined;
	let droppedFrames = 0;
	let sendFailures = 0;
	let lastPeerState: string | undefined;
	let lastIceState: string | undefined;
	let lastStallAt = 0;
	let lastStallClass: HostedStallClass | undefined;
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
			inboundKind: lastInboundKind,
			droppedFrames,
			sendFailures,
			peerState: lastPeerState,
			iceState: lastIceState,
			...extra,
		};
	}

	function maybeStall(): void {
		const next = stallClass({
			inboundFrames,
			outboundFrames,
			firstInboundAt,
			lastInboundAt,
			lastOutboundAt,
			now: now(),
			stallMs,
		});
		if (!next) return;
		if (next === lastStallClass && now() - lastStallAt < APPLICATION_STALL_REPEAT_MS) return;
		lastStallClass = next;
		lastStallAt = now();
		emit(laneFields({ stallClass: next }));
	}

	function startSummary(): void {
		if (summaryTimer !== undefined) return;
		summaryTimer = setIntervalFn(() => {
			if (stopped) return;
			maybeStall();
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
		channelState(channel: string, channelState: string | undefined): void {
			if (!CHANNEL_LABELS.has(channel)) return;
			emit({
				type: 'channel-state',
				channel: channel as
					| 'api'
					| 'asset'
					| 'assets'
					| 'application'
					| 'control'
					| 'terminal',
				channelState,
				peerState: lastPeerState,
				iceState: lastIceState,
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
			maybeStall();
		},
		noteOutbound(byteLength: number, ok = true): void {
			if (!ok) {
				sendFailures += 1;
				emit(laneFields({ sendFailure: true }));
				return;
			}
			outboundFrames += 1;
			outboundBytes += byteLength;
			lastOutboundAt = now();
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
			});
			stop();
		},
		snapshot: () => laneFields(),
		stop,
	};
}

export type HostedStreamDiagnostics = ReturnType<typeof createHostedStreamDiagnostics>;
