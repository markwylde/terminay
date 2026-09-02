import {
	type ByteTransport,
	type TransportCloseReason,
} from '@terminay/protocol';
import {
	recordStreamDiagnostic,
	recordVerboseStreamDiagnostic,
	registerStreamStateProvider,
} from './streamDiagnostics.js';

export interface OutboundDeliveryLimits {
	readonly maxQueuedBytes: number;
	readonly maxQueuedFrames?: number;
	readonly maxTerminalQueuedBytes?: number;
	readonly maxTerminalQueuedFrames?: number;
	readonly maxTerminalUnconfirmedBytes?: number;
	readonly maxTerminalUnconfirmedAgeMs?: number;
	readonly maxStateQueuedBytes?: number;
	readonly maxStateQueuedFrames?: number;
}

export interface OutboundDeliverySnapshot {
	readonly queuedBytes: number;
	readonly queuedFrames: number;
}

interface PendingDelivery {
	readonly frame: Uint8Array;
	readonly resolve: () => void;
	readonly reject: (reason: OutboundDeliveryError) => void;
	readonly trafficClass: 'control' | 'state' | 'state_resync' | 'terminal' | 'terminal_skip';
	readonly terminalLaneId?: string;
	/** End of this terminal frame's byte range, used to advance `sentPosition`
	 * once the transport has actually accepted it. */
	readonly nextPosition?: number;
	readonly stateLaneId?: string;
	readonly stateKey?: string;
}

const DEFAULT_MAX_QUEUED_FRAMES = 1_024;
const DEFAULT_MAX_TERMINAL_QUEUED_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TERMINAL_QUEUED_FRAMES = 256;
export const DEFAULT_MAX_TERMINAL_UNCONFIRMED_BYTES = 256 * 1024;

/**
 * How far a prepared checkpoint may lag the live head before hydration
 * stops replaying that difference through the presentation lane.
 *
 * Half the connection's unconfirmed-bytes bound: a recovery that can
 * congest the lane it is recovering never converges. Hosts that lower
 * the lane limit therefore also lower this catch-up.
 */
export function checkpointCatchupBytes(
	maxTerminalUnconfirmedBytes: number = DEFAULT_MAX_TERMINAL_UNCONFIRMED_BYTES,
): number {
	return Math.floor(maxTerminalUnconfirmedBytes / 2);
}

const DEFAULT_MAX_TERMINAL_UNCONFIRMED_AGE_MS = 5_000;
const DEFAULT_MAX_STATE_QUEUED_BYTES = 1024 * 1024;
const DEFAULT_MAX_STATE_QUEUED_FRAMES = 256;
const MAX_CONSECUTIVE_CONTROL_DELIVERIES = 8;

export interface TerminalDeliveryAdmission {
	readonly laneId: string;
	readonly position: number;
	readonly nextPosition: number;
	/** Build the in-band marker for a byte range this lane will never deliver.
	 * It is enqueued in the lane's own FIFO, in the position the skipped bytes
	 * would have occupied, so the client cannot observe the gap out of order. */
	readonly createSkipFrame: (gap: {
		readonly fromPosition: number;
		readonly toPosition: number;
	}) => Uint8Array;
}

export interface TerminalDeliveryCongestion {
	readonly laneId: string;
	readonly queuedBytes: number;
	readonly queuedFrames: number;
	readonly confirmedPosition: number;
	readonly headPosition: number;
}

interface TerminalLane {
	readonly queue: PendingDelivery[];
	queuedBytes: number;
	/** Set after one skip is emitted. Exits only when the attachment is
	 * released, never on an acknowledgement: a congested client is precisely
	 * the client that cannot acknowledge the bytes it was denied. */
	suppressed: boolean;
	releasePending: boolean;
	confirmedPosition: number;
	/** End of the last frame admitted or skipped. */
	headPosition: number;
	/** End of the last frame the transport actually accepted. This lane is the
	 * only component that knows it, and the only one allowed to drop bytes. */
	sentPosition: number;
	unconfirmedSince: number | undefined;
}

interface StateLane {
	readonly queue: PendingDelivery[];
	queuedBytes: number;
	resyncPending: boolean;
}

export interface StateDeliveryAdmission {
	readonly laneId: string;
	readonly key: string;
	readonly createResyncFrame: () => Uint8Array;
}

/** The single stable reason returned by a failed or closed outbound lane. */
export class OutboundDeliveryError extends Error {
	readonly reason: TransportCloseReason;

	constructor(reason: TransportCloseReason) {
		super(reason.message ?? 'connection outbound delivery failed', {
			cause: reason.cause,
		});
		this.name = 'OutboundDeliveryError';
		this.reason = reason;
	}
}

/**
 * Live pumps, so a diagnostic snapshot can read lane state directly instead of
 * relying on whatever happened to still be in the record history. A frozen
 * terminal is diagnosed by what its lane looks like now.
 */
const livePumps = new Set<OutboundDeliveryPump>();
let deliveryProviderRegistered = false;

function ensureDeliveryProvider(): void {
	if (deliveryProviderRegistered) return;
	deliveryProviderRegistered = true;
	registerStreamStateProvider('delivery', () =>
		[...livePumps].map((pump) => pump.diagnosticState()),
	);
}

/**
 * A bounded, connection-owned FIFO admission and delivery boundary.
 *
 * Frames are copied at admission and only this pump calls the transport's
 * writability/send methods. A terminal failure rejects all admitted and later
 * frames with the same error instance.
 */
export class OutboundDeliveryPump {
	private readonly controlQueue: PendingDelivery[] = [];
	private readonly terminalLanes = new Map<string, TerminalLane>();
	private readonly stateLanes = new Map<string, StateLane>();
	private readonly maxQueuedBytes: number;
	private readonly maxQueuedFrames: number;
	private readonly maxTerminalQueuedBytes: number;
	private readonly maxTerminalQueuedFrames: number;
	private readonly maxTerminalUnconfirmedBytes: number;
	private readonly maxTerminalUnconfirmedAgeMs: number;
	private readonly maxStateQueuedBytes: number;
	private readonly maxStateQueuedFrames: number;
	private controlQueuedByteCount = 0;
	private terminalQueuedByteCount = 0;
	private stateQueuedByteCount = 0;
	private running = false;
	private activeDelivery: PendingDelivery | undefined;
	private terminalLaneCursor = 0;
	private stateLaneCursor = 0;
	private consecutiveControlDeliveries = 0;
	private terminalError: OutboundDeliveryError | undefined;
	private diagnosticLabel = 'unlabelled';
	private suppressedDrops = 0;

	constructor(
		private readonly transport: ByteTransport,
		limits: OutboundDeliveryLimits,
		private readonly onFailure: (
			error: OutboundDeliveryError,
			snapshot: OutboundDeliverySnapshot,
		) => void,
		private readonly onTerminalCongestion?: (
			congestion: TerminalDeliveryCongestion,
		) => void,
		private readonly now: () => number = () => Date.now(),
	) {
		this.maxQueuedBytes = positiveInteger(
			limits.maxQueuedBytes,
			'maxQueuedBytes',
		);
		this.maxQueuedFrames = positiveInteger(
			limits.maxQueuedFrames ?? DEFAULT_MAX_QUEUED_FRAMES,
			'maxQueuedFrames',
		);
		this.maxTerminalQueuedBytes = positiveInteger(
			limits.maxTerminalQueuedBytes ?? DEFAULT_MAX_TERMINAL_QUEUED_BYTES,
			'maxTerminalQueuedBytes',
		);
		this.maxTerminalQueuedFrames = positiveInteger(
			limits.maxTerminalQueuedFrames ?? DEFAULT_MAX_TERMINAL_QUEUED_FRAMES,
			'maxTerminalQueuedFrames',
		);
		this.maxTerminalUnconfirmedBytes = positiveInteger(
			limits.maxTerminalUnconfirmedBytes ??
				DEFAULT_MAX_TERMINAL_UNCONFIRMED_BYTES,
			'maxTerminalUnconfirmedBytes',
		);
		this.maxTerminalUnconfirmedAgeMs = positiveInteger(
			limits.maxTerminalUnconfirmedAgeMs ??
				DEFAULT_MAX_TERMINAL_UNCONFIRMED_AGE_MS,
			'maxTerminalUnconfirmedAgeMs',
		);
		this.maxStateQueuedBytes = positiveInteger(limits.maxStateQueuedBytes ?? DEFAULT_MAX_STATE_QUEUED_BYTES, 'maxStateQueuedBytes');
		this.maxStateQueuedFrames = positiveInteger(limits.maxStateQueuedFrames ?? DEFAULT_MAX_STATE_QUEUED_FRAMES, 'maxStateQueuedFrames');
		ensureDeliveryProvider();
		livePumps.add(this);
	}

	/** Label this pump with its connection so a snapshot can be read against the
	 * client that owns it. Terminal lanes are opaque attachment ids otherwise. */
	setDiagnosticLabel(label: string): void {
		this.diagnosticLabel = label;
	}

	/** Live lane state. Read at snapshot time, never cached, because the whole
	 * point is to answer what a stuck lane looks like right now. */
	diagnosticState(): Readonly<Record<string, unknown>> {
		return {
			connection: this.diagnosticLabel,
			failed: this.terminalError?.reason.code,
			running: this.running,
			queuedBytes: this.snapshot.queuedBytes,
			terminalLanes: [...this.terminalLanes].map(([laneId, lane]) => ({
				laneId,
				suppressed: lane.suppressed,
				releasePending: lane.releasePending,
				queuedFrames: lane.queue.length,
				queuedBytes: lane.queuedBytes,
				confirmedPosition: lane.confirmedPosition,
				sentPosition: lane.sentPosition,
				headPosition: lane.headPosition,
				unconfirmedFor:
					lane.unconfirmedSince === undefined
						? undefined
						: this.now() - lane.unconfirmedSince,
			})),
		};
	}

	get snapshot(): OutboundDeliverySnapshot {
		return {
			queuedBytes: this.controlQueuedByteCount + this.stateQueuedByteCount + this.terminalQueuedByteCount,
			queuedFrames:
				this.controlQueue.length +
				[...this.stateLanes.values()].reduce((sum, lane) => sum + lane.queue.length, 0) +
				[...this.terminalLanes.values()].reduce(
					(sum, lane) => sum + lane.queue.length,
					0,
				),
		};
	}

	/** Deliver reconstructible latest-value state outside the reliable control
	 * queue. Pending values with the same key supersede one another. If a
	 * subscription exceeds its independent bound, one resync marker replaces
	 * its backlog; this lane can never fail the application connection. */
	sendState(frame: Uint8Array, admission: StateDeliveryAdmission): Promise<void> {
		if (this.terminalError !== undefined) return Promise.reject(this.terminalError);
		if (admission.laneId.length === 0 || admission.key.length === 0) return Promise.reject(new TypeError('state delivery identity is invalid'));
		let lane = this.stateLanes.get(admission.laneId);
		if (lane === undefined) {
			lane = { queue: [], queuedBytes: 0, resyncPending: false };
			this.stateLanes.set(admission.laneId, lane);
		}
		if (lane.resyncPending) return Promise.resolve();
		const replaceIndex = lane.queue.findIndex((pending) => pending !== this.activeDelivery && pending.stateKey === admission.key);
		if (replaceIndex >= 0) {
			const replaced = lane.queue[replaceIndex];
			if (replaced !== undefined) {
				lane.queue.splice(replaceIndex, 1);
				lane.queuedBytes -= replaced.frame.byteLength;
				this.stateQueuedByteCount -= replaced.frame.byteLength;
				replaced.resolve();
			}
		}
		if (lane.queue.length >= this.maxStateQueuedFrames || lane.queuedBytes + frame.byteLength > this.maxStateQueuedBytes || this.stateQueuedByteCount + frame.byteLength > this.maxStateQueuedBytes) {
			this.congestStateLane(admission.laneId, lane, admission.createResyncFrame);
			this.start();
			return Promise.resolve();
		}
		const copy = frame.slice();
		const result = new Promise<void>((resolve, reject) => {
			lane.queue.push({ frame: copy, resolve, reject, trafficClass: 'state', stateLaneId: admission.laneId, stateKey: admission.key });
			lane.queuedBytes += copy.byteLength;
			this.stateQueuedByteCount += copy.byteLength;
		});
		this.start();
		return result;
	}

	send(frame: Uint8Array): Promise<void> {
		if (this.terminalError !== undefined)
			return Promise.reject(this.terminalError);
		if (
			this.controlQueue.length >= this.maxQueuedFrames ||
			this.controlQueuedByteCount + frame.byteLength > this.maxQueuedBytes
		) {
			const error = this.fail({
				code: 'resource',
				message: 'connection outbound queue limit reached',
			});
			return Promise.reject(error);
		}

		const copy = frame.slice();
		const result = new Promise<void>((resolve, reject) => {
			this.controlQueue.push({
				frame: copy,
				resolve,
				reject,
				trafficClass: "control",
			});
			this.controlQueuedByteCount += copy.byteLength;
		});
		this.start();
		return result;
	}

	/** Admit raw presentation output without allowing that feature stream to
	 * consume the reliable control queue. Congestion supersedes obsolete raw
	 * frames with one attachment-scoped resync notification. */
	sendTerminal(
		frame: Uint8Array,
		admission: TerminalDeliveryAdmission,
	): Promise<void> {
		if (this.terminalError !== undefined)
			return Promise.reject(this.terminalError);
		if (admission.laneId.length === 0)
			return Promise.reject(new TypeError('terminal lane id is invalid'));
		if (
			!Number.isSafeInteger(admission.position) ||
			!Number.isSafeInteger(admission.nextPosition) ||
			admission.position < 0 ||
			admission.nextPosition <= admission.position
		)
			return Promise.reject(new TypeError('terminal output position is invalid'));
		let lane = this.terminalLanes.get(admission.laneId);
		if (lane === undefined) {
			lane = {
				queue: [],
				queuedBytes: 0,
				suppressed: false,
				releasePending: false,
				confirmedPosition: admission.position,
				headPosition: admission.position,
				sentPosition: admission.position,
				unconfirmedSince: undefined,
			};
			this.terminalLanes.set(admission.laneId, lane);
			recordStreamDiagnostic('delivery', 'lane_opened', {
				connection: this.diagnosticLabel,
				laneId: admission.laneId,
				position: admission.position,
			});
		}
		if (lane.releasePending) return Promise.resolve();
		if (lane.suppressed) {
			// Every byte dropped here is output the user will never see unless the
			// attachment is replaced. The count is the size of the silence.
			this.suppressedDrops += 1;
			recordVerboseStreamDiagnostic('delivery', 'suppressed_drop', () => ({
				connection: this.diagnosticLabel,
				laneId: admission.laneId,
				drops: this.suppressedDrops,
				bytes: admission.nextPosition - admission.position,
				headPosition: lane.headPosition,
			}));
			return Promise.resolve();
		}
		// Duplicate delivery from overlapping subscriptions. The bytes are
		// already accounted for on this lane, so dropping them is not a gap.
		if (admission.nextPosition <= lane.headPosition) return Promise.resolve();
		if (admission.position !== lane.headPosition) {
			recordStreamDiagnostic('delivery', 'admit_out_of_order', {
				connection: this.diagnosticLabel,
				laneId: admission.laneId,
				position: admission.position,
				headPosition: lane.headPosition,
			});
			this.congestTerminalLane(admission.laneId, lane, admission);
			this.start();
			return Promise.resolve();
		}
		if (lane.unconfirmedSince === undefined)
			lane.unconfirmedSince = this.now();
		lane.headPosition = admission.nextPosition;
		if (
			lane.queue.length >= this.maxTerminalQueuedFrames ||
			lane.queuedBytes + frame.byteLength > this.maxTerminalQueuedBytes ||
			this.terminalQueuedByteCount + frame.byteLength > this.maxQueuedBytes ||
			admission.nextPosition - lane.confirmedPosition >
				this.maxTerminalUnconfirmedBytes ||
			this.now() - lane.unconfirmedSince > this.maxTerminalUnconfirmedAgeMs
		) {
			this.congestTerminalLane(admission.laneId, lane, admission);
			this.start();
			return Promise.resolve();
		}
		const copy = frame.slice();
		const result = new Promise<void>((resolve, reject) => {
			lane.queue.push({
				frame: copy,
				resolve,
				reject,
				trafficClass: "terminal",
				terminalLaneId: admission.laneId,
				nextPosition: admission.nextPosition,
			});
			lane.queuedBytes += copy.byteLength;
			this.terminalQueuedByteCount += copy.byteLength;
		});
		this.start();
		return result;
	}

	/** Advance the presentation watermark only after the client confirms that
	 * xterm has rendered through this byte position. Transport acceptance is not
	 * consumer progress, particularly for local MessagePorts. */
	acknowledgeTerminal(laneId: string, position: number): void {
		const lane = this.terminalLanes.get(laneId);
		if (
			lane === undefined ||
			!Number.isSafeInteger(position) ||
			position < lane.confirmedPosition ||
			position > lane.headPosition
		) return;
		lane.confirmedPosition = position;
		lane.unconfirmedSince = position >= lane.headPosition ? undefined : this.now();
		recordVerboseStreamDiagnostic('delivery', 'ack', () => ({
			connection: this.diagnosticLabel,
			laneId,
			confirmedPosition: position,
			headPosition: lane.headPosition,
		}));
	}

	/** Release scheduler state after the authoritative attachment is detached.
	 * A later hydration receives a new opaque attachment id and a fresh lane. */
	releaseTerminal(laneId: string): void {
		const lane = this.terminalLanes.get(laneId);
		if (lane === undefined) return;
		recordStreamDiagnostic('delivery', 'lane_released', {
			connection: this.diagnosticLabel,
			laneId,
			suppressed: lane.suppressed,
			suppressedDrops: this.suppressedDrops,
			confirmedPosition: lane.confirmedPosition,
			headPosition: lane.headPosition,
		});
		lane.releasePending = true;
		const retained =
			this.activeDelivery?.terminalLaneId === laneId
				? this.activeDelivery
				: undefined;
		for (const pending of lane.queue.splice(0)) {
			if (pending === retained) continue;
			lane.queuedBytes -= pending.frame.byteLength;
			this.terminalQueuedByteCount -= pending.frame.byteLength;
			pending.resolve();
		}
		if (retained !== undefined) lane.queue.push(retained);
		else this.terminalLanes.delete(laneId);
	}

	close(reason: TransportCloseReason): OutboundDeliveryError {
		return this.fail(reason, false);
	}

	private start(): void {
		if (this.running || this.terminalError !== undefined) return;
		this.running = true;
		void this.drain().catch((cause: unknown) => {
			this.fail({
				code: 'unavailable',
				message: 'connection outbound delivery failed',
				cause,
			});
		});
	}

	private async drain(): Promise<void> {
		try {
			while (this.terminalError === undefined) {
				const pending = this.nextDelivery();
				if (pending === undefined) return;
				this.activeDelivery = pending;
				try {
					await this.transport.waitForWritable(pending.frame.byteLength);
					await this.transport.send(pending.frame);
				} catch (cause) {
					// A transport that is still open rejected this one frame — an
					// unsendable request/response message. Fail its sender, which
					// answers that request with an error, and keep the connection and
					// every other lane alive. Terminal and state lanes stay terminal:
					// their frames carry stream positions and event revisions, so a
					// silently dropped frame would desync a client that is never told.
					if (this.transport.state !== 'open' || pending.trafficClass !== 'control') throw cause;
					recordStreamDiagnostic('delivery', 'control_frame_rejected', {
						connection: this.diagnosticLabel,
						frameBytes: pending.frame.byteLength,
						message: cause instanceof Error ? cause.message : String(cause),
					});
					this.completeDelivery(pending);
					pending.reject(
						new OutboundDeliveryError({
							code: 'resource',
							message: 'connection frame could not be delivered',
							cause,
						}),
					);
					this.activeDelivery = undefined;
					continue;
				}
				this.completeDelivery(pending);
				pending.resolve();
				this.activeDelivery = undefined;
			}
		} finally {
			this.activeDelivery = undefined;
			this.running = false;
			if (this.snapshot.queuedFrames > 0 && this.terminalError === undefined)
				this.start();
		}
	}

	private nextDelivery(): PendingDelivery | undefined {
		const lanes = [...this.terminalLanes.entries()].filter(
			([, lane]) => lane.queue.length > 0,
		);
		const control = this.controlQueue[0];
		const stateLanes = [...this.stateLanes.entries()].filter(([, lane]) => lane.queue.length > 0);
		if (
			control !== undefined &&
			((lanes.length === 0 && stateLanes.length === 0) ||
				this.consecutiveControlDeliveries < MAX_CONSECUTIVE_CONTROL_DELIVERIES)
		) {
			this.consecutiveControlDeliveries += 1;
			return control;
		}
		if (stateLanes.length > 0) {
			this.consecutiveControlDeliveries = 0;
			this.stateLaneCursor %= stateLanes.length;
			const pending = stateLanes[this.stateLaneCursor]?.[1].queue[0];
			this.stateLaneCursor = (this.stateLaneCursor + 1) % stateLanes.length;
			return pending;
		}
		if (lanes.length === 0) return undefined;
		this.consecutiveControlDeliveries = 0;
		this.terminalLaneCursor %= lanes.length;
		const pending = lanes[this.terminalLaneCursor]?.[1].queue[0];
		this.terminalLaneCursor = (this.terminalLaneCursor + 1) % lanes.length;
		return pending;
	}

	private completeDelivery(pending: PendingDelivery): void {
		if (pending.trafficClass === 'control') {
			if (this.controlQueue[0] !== pending) return;
			this.controlQueue.shift();
			this.controlQueuedByteCount -= pending.frame.byteLength;
			return;
		}
		if (pending.trafficClass === 'state' || pending.trafficClass === 'state_resync') {
			const lane = pending.stateLaneId === undefined ? undefined : this.stateLanes.get(pending.stateLaneId);
			if (lane === undefined || lane.queue[0] !== pending) return;
			lane.queue.shift();
			lane.queuedBytes -= pending.frame.byteLength;
			this.stateQueuedByteCount -= pending.frame.byteLength;
			if (lane.queue.length === 0) this.stateLanes.delete(pending.stateLaneId as string);
			return;
		}
		const laneId = pending.terminalLaneId;
		if (laneId === undefined) return;
		const lane = this.terminalLanes.get(laneId);
		if (lane === undefined || lane.queue[0] !== pending) return;
		lane.queue.shift();
		lane.queuedBytes -= pending.frame.byteLength;
		this.terminalQueuedByteCount -= pending.frame.byteLength;
		if (pending.nextPosition !== undefined)
			lane.sentPosition = Math.max(lane.sentPosition, pending.nextPosition);
		if (pending.trafficClass === 'terminal_skip')
			recordStreamDiagnostic('delivery', 'skip_sent', {
				connection: this.diagnosticLabel,
				laneId,
				sentPosition: lane.sentPosition,
			});
		else
			recordVerboseStreamDiagnostic('delivery', 'sent', () => ({
				connection: this.diagnosticLabel,
				laneId,
				sentPosition: lane.sentPosition,
				queuedFrames: lane.queue.length,
			}));
		if (lane.queue.length === 0 && lane.releasePending)
			this.terminalLanes.delete(laneId);
	}

	private congestStateLane(laneId: string, lane: StateLane, createResyncFrame: () => Uint8Array): void {
		const retained = this.activeDelivery?.stateLaneId === laneId ? this.activeDelivery : undefined;
		for (const pending of lane.queue.splice(0)) {
			if (pending === retained) continue;
			lane.queuedBytes -= pending.frame.byteLength;
			this.stateQueuedByteCount -= pending.frame.byteLength;
			pending.resolve();
		}
		if (retained !== undefined) lane.queue.push(retained);
		const copy = createResyncFrame().slice();
		if (copy.byteLength > this.maxStateQueuedBytes) return;
		lane.queue.push({ frame: copy, resolve: () => undefined, reject: () => undefined, trafficClass: 'state_resync', stateLaneId: laneId });
		lane.queuedBytes += copy.byteLength;
		this.stateQueuedByteCount += copy.byteLength;
		lane.resyncPending = true;
	}

	/**
	 * Stop delivering this attachment and represent the loss in band.
	 *
	 * The discarded range is bounded by what actually reached the wire, not by
	 * a position sampled elsewhere and consumed later: the marker is enqueued in
	 * the same ordered FIFO as the bytes it replaces, so there is no window in
	 * which the client's position and the server's can disagree.
	 */
	private congestTerminalLane(
		laneId: string,
		lane: TerminalLane,
		admission: TerminalDeliveryAdmission,
	): void {
		const snapshot = {
			laneId,
			queuedBytes: lane.queuedBytes,
			queuedFrames: lane.queue.length,
			confirmedPosition: lane.confirmedPosition,
			headPosition: Math.max(lane.headPosition, admission.nextPosition),
		};
		const retained =
			this.activeDelivery?.terminalLaneId === laneId
				? this.activeDelivery
				: undefined;
		for (const pending of lane.queue.splice(0)) {
			if (pending === retained) continue;
			lane.queuedBytes -= pending.frame.byteLength;
			this.terminalQueuedByteCount -= pending.frame.byteLength;
			pending.resolve();
		}
		if (retained !== undefined) lane.queue.push(retained);
		lane.headPosition = Math.max(lane.headPosition, admission.nextPosition);
		// A frame already handed to the transport still arrives, so the gap
		// starts after it rather than after the last completed delivery.
		const fromPosition = Math.max(
			lane.sentPosition,
			retained?.nextPosition ?? lane.sentPosition,
		);
		const copy = admission
			.createSkipFrame({ fromPosition, toPosition: lane.headPosition })
			.slice();
		if (this.terminalQueuedByteCount + copy.byteLength > this.maxQueuedBytes) {
			recordStreamDiagnostic('delivery', 'skip_capacity_exhausted', {
				connection: this.diagnosticLabel,
				laneId,
			});
			this.fail({
				code: 'resource',
				message: 'terminal resynchronization capacity exhausted',
			});
			return;
		}
		lane.queue.push({
			frame: copy,
			resolve: () => undefined,
			reject: () => undefined,
			trafficClass: 'terminal_skip',
			terminalLaneId: laneId,
		});
		lane.queuedBytes += copy.byteLength;
		this.terminalQueuedByteCount += copy.byteLength;
		lane.suppressed = true;
		// The latch opens only when this attachment is replaced. From here the
		// stream is silent until the queued skip reaches the client and it
		// re-attaches, so this record is the start of every freeze.
		recordStreamDiagnostic('delivery', 'lane_suppressed', {
			connection: this.diagnosticLabel,
			laneId,
			fromPosition,
			toPosition: lane.headPosition,
			queuedBytes: snapshot.queuedBytes,
			queuedFrames: snapshot.queuedFrames,
			confirmedPosition: lane.confirmedPosition,
			sentPosition: lane.sentPosition,
			unconfirmedFor:
				lane.unconfirmedSince === undefined
					? undefined
					: this.now() - lane.unconfirmedSince,
		});
		try {
			this.onTerminalCongestion?.(snapshot);
		} catch {
			/* Diagnostics cannot affect delivery. */
		}
	}

	private fail(
		reason: TransportCloseReason,
		notify = true,
	): OutboundDeliveryError {
		if (this.terminalError !== undefined) return this.terminalError;
		const snapshot = this.snapshot;
		const error = new OutboundDeliveryError(reason);
		this.terminalError = error;
		for (const pending of this.controlQueue.splice(0)) pending.reject(error);
		for (const lane of this.stateLanes.values()) for (const pending of lane.queue.splice(0)) pending.reject(error);
		this.stateLanes.clear();
		for (const lane of this.terminalLanes.values())
			for (const pending of lane.queue.splice(0)) pending.reject(error);
		this.terminalLanes.clear();
		this.controlQueuedByteCount = 0;
		this.stateQueuedByteCount = 0;
		this.terminalQueuedByteCount = 0;
		livePumps.delete(this);
		recordStreamDiagnostic('delivery', 'pump_closed', {
			connection: this.diagnosticLabel,
			code: reason.code,
			message: reason.message,
			notified: notify,
		});
		if (notify) {
			try {
				this.onFailure(error, snapshot);
			} catch {
				/* Diagnostics/lifecycle observers cannot escape the delivery boundary. */
			}
		}
		return error;
	}
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive integer`);
	}
	return value;
}
