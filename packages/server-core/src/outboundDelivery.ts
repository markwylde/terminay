import {
	type ByteTransport,
	type TransportCloseReason,
} from '@terminay/protocol';

export interface OutboundDeliveryLimits {
	readonly maxQueuedBytes: number;
	readonly maxQueuedFrames?: number;
	readonly maxTerminalQueuedBytes?: number;
	readonly maxTerminalQueuedFrames?: number;
	readonly maxTerminalUnconfirmedBytes?: number;
}

export interface OutboundDeliverySnapshot {
	readonly queuedBytes: number;
	readonly queuedFrames: number;
}

interface PendingDelivery {
	readonly frame: Uint8Array;
	readonly resolve: () => void;
	readonly reject: (reason: OutboundDeliveryError) => void;
	readonly trafficClass: 'control' | 'terminal' | 'terminal_resync';
	readonly terminalLaneId?: string;
}

const DEFAULT_MAX_QUEUED_FRAMES = 1_024;
const DEFAULT_MAX_TERMINAL_QUEUED_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TERMINAL_QUEUED_FRAMES = 256;
const DEFAULT_MAX_TERMINAL_UNCONFIRMED_BYTES = 256 * 1024;
const MAX_CONSECUTIVE_CONTROL_DELIVERIES = 8;

export interface TerminalDeliveryAdmission {
	readonly laneId: string;
	readonly position: number;
	readonly nextPosition: number;
	readonly createResyncFrame: (boundary: {
		readonly confirmedPosition: number;
		readonly headPosition: number;
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
	resyncPending: boolean;
	releasePending: boolean;
	confirmedPosition: number;
	headPosition: number;
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
 * A bounded, connection-owned FIFO admission and delivery boundary.
 *
 * Frames are copied at admission and only this pump calls the transport's
 * writability/send methods. A terminal failure rejects all admitted and later
 * frames with the same error instance.
 */
export class OutboundDeliveryPump {
	private readonly controlQueue: PendingDelivery[] = [];
	private readonly terminalLanes = new Map<string, TerminalLane>();
	private readonly maxQueuedBytes: number;
	private readonly maxQueuedFrames: number;
	private readonly maxTerminalQueuedBytes: number;
	private readonly maxTerminalQueuedFrames: number;
	private readonly maxTerminalUnconfirmedBytes: number;
	private controlQueuedByteCount = 0;
	private terminalQueuedByteCount = 0;
	private running = false;
	private activeDelivery: PendingDelivery | undefined;
	private terminalLaneCursor = 0;
	private consecutiveControlDeliveries = 0;
	private terminalError: OutboundDeliveryError | undefined;

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
	}

	get snapshot(): OutboundDeliverySnapshot {
		return {
			queuedBytes: this.controlQueuedByteCount + this.terminalQueuedByteCount,
			queuedFrames:
				this.controlQueue.length +
				[...this.terminalLanes.values()].reduce(
					(sum, lane) => sum + lane.queue.length,
					0,
				),
		};
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
				resyncPending: false,
				releasePending: false,
				confirmedPosition: admission.position,
				headPosition: admission.position,
			};
			this.terminalLanes.set(admission.laneId, lane);
		}
		if (lane.releasePending) return Promise.resolve();
		if (lane.resyncPending) return Promise.resolve();
		if (admission.position !== lane.headPosition) {
			this.congestTerminalLane(admission.laneId, lane, admission);
			this.start();
			return Promise.resolve();
		}
		lane.headPosition = admission.nextPosition;
		if (
			lane.queue.length >= this.maxTerminalQueuedFrames ||
			lane.queuedBytes + frame.byteLength > this.maxTerminalQueuedBytes ||
			this.terminalQueuedByteCount + frame.byteLength > this.maxQueuedBytes ||
			admission.nextPosition - lane.confirmedPosition >
				this.maxTerminalUnconfirmedBytes
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
	}

	/** Release scheduler state after the authoritative attachment is detached.
	 * A later hydration receives a new opaque attachment id and a fresh lane. */
	releaseTerminal(laneId: string): void {
		const lane = this.terminalLanes.get(laneId);
		if (lane === undefined) return;
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
				await this.transport.waitForWritable(pending.frame.byteLength);
				await this.transport.send(pending.frame);
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
		if (
			control !== undefined &&
			(lanes.length === 0 ||
				this.consecutiveControlDeliveries < MAX_CONSECUTIVE_CONTROL_DELIVERIES)
		) {
			this.consecutiveControlDeliveries += 1;
			return control;
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
		const laneId = pending.terminalLaneId;
		if (laneId === undefined) return;
		const lane = this.terminalLanes.get(laneId);
		if (lane === undefined || lane.queue[0] !== pending) return;
		lane.queue.shift();
		lane.queuedBytes -= pending.frame.byteLength;
		this.terminalQueuedByteCount -= pending.frame.byteLength;
		if (lane.queue.length === 0 && lane.releasePending)
			this.terminalLanes.delete(laneId);
	}

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
		const copy = admission.createResyncFrame({
			confirmedPosition: lane.confirmedPosition,
			headPosition: lane.headPosition,
		}).slice();
		if (
			this.terminalQueuedByteCount + copy.byteLength > this.maxQueuedBytes
		) {
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
			trafficClass: 'terminal_resync',
			terminalLaneId: laneId,
		});
		lane.queuedBytes += copy.byteLength;
		this.terminalQueuedByteCount += copy.byteLength;
		lane.resyncPending = true;
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
		for (const lane of this.terminalLanes.values())
			for (const pending of lane.queue.splice(0)) pending.reject(error);
		this.terminalLanes.clear();
		this.controlQueuedByteCount = 0;
		this.terminalQueuedByteCount = 0;
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
