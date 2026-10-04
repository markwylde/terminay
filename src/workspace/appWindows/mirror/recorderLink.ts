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
	MIRROR_MAX_PART_BYTES,
	MIRROR_MAX_SNAPSHOT_PARTS,
	MIRROR_SNAPSHOT_PART_CHARS,
	MIRROR_MESSAGE_KEY,
	type MirrorBatch,
	type MirrorRecorderControl,
} from './mirrorProtocol.ts';
import { isNotControllerError } from '../controlErrors.ts';

export interface RecorderLinkOptions {
	/** Post a message to the view's sandbox proxy. */
	readonly post: (message: unknown) => void;
	/** The recorder script, sent to the view the first time it must record. */
	readonly recorderScript: string;
	/** Hand a batch to the server. Rejects with a not-controller refusal when this client no longer controls the terminal. */
	readonly publish: (batch: Omit<MirrorBatch, 'type'>) => Promise<void>;
}

const encoder = new TextEncoder();

/** A well-formed batch within the limits, or nothing. */
export function parseMirrorBatch(message: unknown): Omit<MirrorBatch, 'type'> | undefined {
	if (typeof message !== 'object' || message === null) return undefined;
	const value = (message as Record<string, unknown>)[MIRROR_MESSAGE_KEY];
	if (typeof value !== 'object' || value === null) return undefined;
	const { type, epoch, seq, kind, data, reason, parts } = value as Record<string, unknown>;
	if (type !== 'batch' || typeof data !== 'string') return undefined;
	if (kind !== 'snapshot' && kind !== 'events' && kind !== 'unavailable') return undefined;
	if (!Number.isSafeInteger(epoch) || (epoch as number) < 0) return undefined;
	if (!Number.isSafeInteger(seq) || (seq as number) < 0) return undefined;
	if (reason !== undefined && reason !== 'too-large' && reason !== 'too-busy') return undefined;
	if (parts !== undefined && (kind !== 'snapshot' || !Number.isSafeInteger(parts) || (parts as number) < 2 || (parts as number) > MIRROR_MAX_SNAPSHOT_PARTS))
		return undefined;
	const limit = kind === 'snapshot' ? MIRROR_MAX_PART_BYTES : MIRROR_MAX_BATCH_BYTES;
	if (data.length > limit || encoder.encode(data).byteLength > limit) return undefined;
	// A part is cut by characters, so that the parts of one snapshot, joined in
	// an observer's memory, have a known ceiling.
	if (kind === 'snapshot' && data.length > MIRROR_SNAPSHOT_PART_CHARS) return undefined;
	return {
		epoch: epoch as number,
		seq: seq as number,
		kind,
		data,
		...(parts === undefined ? {} : { parts: parts as number }),
		...(reason === undefined ? {} : { reason }),
	};
}

export class ViewRecorderLink {
	private alive = false;
	private wanted = false;
	private loaded = false;
	/** A batch has been handed to the server and not yet taken. */
	private publishing = false;

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
		// One batch at a time is a rule this side keeps, not one it trusts the
		// view to keep: the recorder runs inside the view. A batch sent before
		// the last was acknowledged is dropped, so a view cannot have the
		// workspace queue recordings without bound. An honest recorder never
		// sends one; a mirror that misses a batch asks for a fresh snapshot.
		if (this.publishing) return true;
		this.publishing = true;
		this.options.publish(batch).then(
			() => {
				this.publishing = false;
				this.control({ type: 'ack' });
			},
			(error: unknown) => {
				this.publishing = false;
				// This client stopped controlling the terminal: the recording is over.
				if (isNotControllerError(error)) this.stop();
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
