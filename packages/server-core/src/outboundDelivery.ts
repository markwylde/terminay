import {
	type ByteTransport,
	type TransportCloseReason,
} from '@terminay/protocol';

export interface OutboundDeliveryLimits {
	readonly maxQueuedBytes: number;
	readonly maxQueuedFrames?: number;
}

export interface OutboundDeliverySnapshot {
	readonly queuedBytes: number;
	readonly queuedFrames: number;
}

interface PendingDelivery {
	readonly frame: Uint8Array;
	readonly resolve: () => void;
	readonly reject: (reason: OutboundDeliveryError) => void;
}

const DEFAULT_MAX_QUEUED_FRAMES = 1_024;

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
	private readonly queue: PendingDelivery[] = [];
	private readonly maxQueuedBytes: number;
	private readonly maxQueuedFrames: number;
	private queuedByteCount = 0;
	private running = false;
	private terminalError: OutboundDeliveryError | undefined;

	constructor(
		private readonly transport: ByteTransport,
		limits: OutboundDeliveryLimits,
		private readonly onFailure: (
			error: OutboundDeliveryError,
			snapshot: OutboundDeliverySnapshot,
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
	}

	get snapshot(): OutboundDeliverySnapshot {
		return {
			queuedBytes: this.queuedByteCount,
			queuedFrames: this.queue.length,
		};
	}

	send(frame: Uint8Array): Promise<void> {
		if (this.terminalError !== undefined)
			return Promise.reject(this.terminalError);
		if (
			this.queue.length >= this.maxQueuedFrames ||
			this.queuedByteCount + frame.byteLength > this.maxQueuedBytes
		) {
			const error = this.fail({
				code: 'resource',
				message: 'connection outbound queue limit reached',
			});
			return Promise.reject(error);
		}

		const copy = frame.slice();
		const result = new Promise<void>((resolve, reject) => {
			this.queue.push({
				frame: copy,
				resolve,
				reject,
			});
			this.queuedByteCount += copy.byteLength;
		});
		this.start();
		return result;
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
				const pending = this.queue[0];
				if (pending === undefined) return;
				await this.transport.waitForWritable(pending.frame.byteLength);
				await this.transport.send(pending.frame);
				if (this.queue[0] !== pending) return;
				this.queue.shift();
				this.queuedByteCount -= pending.frame.byteLength;
				pending.resolve();
			}
		} finally {
			this.running = false;
			if (this.queue.length > 0 && this.terminalError === undefined)
				this.start();
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
		for (const pending of this.queue.splice(0)) pending.reject(error);
		this.queuedByteCount = 0;
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
