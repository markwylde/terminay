/**
 * The workspace's end of one view's recorder (ADR-0039).
 *
 * A view is untrusted, and so is everything its recorder sends: the link
 * checks the envelope of a batch and its size, and passes the recording on as
 * text it never reads. It acknowledges a batch only once the server has taken
 * it, which is what paces the recorder.
 */
import {
	MIRROR_MAX_BATCH_BYTES,
	MIRROR_MAX_SNAPSHOT_BYTES,
	MIRROR_MESSAGE_KEY,
	type MirrorBatch,
	type MirrorRecorderControl,
} from './mirrorProtocol.ts';

export interface RecorderLinkOptions {
	/** Post a message to the view's sandbox proxy. */
	readonly post: (message: unknown) => void;
	/** The recorder script, sent to the view the first time it must record. */
	readonly recorderScript: string;
	/** Hand a batch to the server. Rejects with `code: 'forbidden'` when this client no longer controls the terminal. */
	readonly publish: (batch: Omit<MirrorBatch, 'type'>) => Promise<void>;
}

const encoder = new TextEncoder();

/** A well-formed batch within the limits, or nothing. */
export function parseMirrorBatch(message: unknown): Omit<MirrorBatch, 'type'> | undefined {
	if (typeof message !== 'object' || message === null) return undefined;
	const value = (message as Record<string, unknown>)[MIRROR_MESSAGE_KEY];
	if (typeof value !== 'object' || value === null) return undefined;
	const { type, epoch, seq, kind, data, reason } = value as Record<string, unknown>;
	if (type !== 'batch' || typeof data !== 'string') return undefined;
	if (kind !== 'snapshot' && kind !== 'events' && kind !== 'unavailable') return undefined;
	if (!Number.isSafeInteger(epoch) || (epoch as number) < 0) return undefined;
	if (!Number.isSafeInteger(seq) || (seq as number) < 0) return undefined;
	if (reason !== undefined && reason !== 'too-large' && reason !== 'too-busy') return undefined;
	const limit = kind === 'snapshot' ? MIRROR_MAX_SNAPSHOT_BYTES : MIRROR_MAX_BATCH_BYTES;
	if (data.length > limit || encoder.encode(data).byteLength > limit) return undefined;
	return {
		epoch: epoch as number,
		seq: seq as number,
		kind,
		data,
		...(reason === undefined ? {} : { reason }),
	};
}

export class ViewRecorderLink {
	private alive = false;
	private wanted = false;
	private loaded = false;

	private readonly options: RecorderLinkOptions;

	constructor(options: RecorderLinkOptions) {
		this.options = options;
	}

	/** The view's document is running and can be reached. */
	viewAlive(): void {
		if (this.alive) return;
		this.alive = true;
		if (this.wanted) this.begin();
	}

	/** Someone is watching, or wants a fresh snapshot. */
	start(): void {
		this.wanted = true;
		if (this.alive) this.begin();
	}

	stop(): void {
		if (!this.wanted) return;
		this.wanted = false;
		if (this.loaded) this.control({ type: 'stop' });
	}

	/**
	 * Take a message from the view's proxy. Returns whether it was a mirror
	 * message, well formed or not, so the caller does not treat it as anything else.
	 */
	handle(message: unknown): boolean {
		if (typeof message !== 'object' || message === null || !(MIRROR_MESSAGE_KEY in message)) return false;
		const batch = parseMirrorBatch(message);
		// A view that sends rubbish is not paced by it: nothing is acknowledged.
		if (batch === undefined || !this.wanted) return true;
		this.options.publish(batch).then(
			() => this.control({ type: 'ack' }),
			(error: unknown) => {
				// This client stopped controlling the terminal: the recording is over.
				if ((error as { code?: unknown } | null)?.code === 'forbidden') this.stop();
				// Anything else lost one batch; the mirrors notice the gap and ask again.
				else this.control({ type: 'ack' });
			},
		);
		return true;
	}

	private begin(): void {
		if (!this.loaded) {
			this.loaded = true;
			this.options.post({ [MIRROR_MESSAGE_KEY]: { type: 'load', code: this.options.recorderScript } });
		}
		this.control({ type: 'start' });
	}

	private control(control: MirrorRecorderControl): void {
		this.options.post({ [MIRROR_MESSAGE_KEY]: control });
	}
}
