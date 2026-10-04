/**
 * Messages between the workspace and the two scripts it injects for the view
 * mirror (ADR-0039): the recorder inside a view, and the replica inside an
 * observer's window. They deliberately are not JSON-RPC, so a view's own MCP
 * Apps transport ignores them.
 */

export const MIRROR_MESSAGE_KEY = 'terminayMirror' as const;

/**
 * A snapshot is streamed as a run of parts of at most this many characters, so
 * a view of any size can be mirrored without one message outgrowing what the
 * server will queue for a client.
 */
export const MIRROR_SNAPSHOT_PART_CHARS = 128 * 1024;
/** The most bytes one part can be: three per UTF-16 unit, with room to spare. */
export const MIRROR_MAX_PART_BYTES = 512 * 1024;
/** A snapshot of more parts than this is a runaway, not a view. */
export const MIRROR_MAX_SNAPSHOT_PARTS = 128;
/** A batch of changes larger than this is replaced by a fresh snapshot. */
export const MIRROR_MAX_BATCH_BYTES = 256 * 1024;

export type MirrorBatchKind =
	/** Starts an epoch: everything a replica needs to draw the view. */
	| 'snapshot'
	/** Changes since the previous batch of the same epoch. */
	| 'events'
	/** The view cannot be mirrored for now; `reason` says why. */
	| 'unavailable';

export type MirrorUnavailableReason = 'too-large' | 'too-busy';

/** Workspace → recorder. */
export type MirrorRecorderControl =
	/** Begin recording, or begin a new epoch if already recording. */
	| { readonly type: 'start' }
	| { readonly type: 'stop' }
	/** The previous batch was handed on; the next may be sent. */
	| { readonly type: 'ack' };

/** Recorder → workspace. */
export interface MirrorBatch {
	readonly type: 'batch';
	readonly epoch: number;
	readonly seq: number;
	readonly kind: MirrorBatchKind;
	/**
	 * JSON text of an array of recorded events, or one part of it; opaque to the
	 * workspace and the server.
	 */
	readonly data: string;
	/**
	 * On a snapshot: how many consecutive batches, starting at sequence 0, carry
	 * it. Their `data` joined in order is the snapshot. Absent means one.
	 */
	readonly parts?: number;
	readonly reason?: MirrorUnavailableReason;
}

/** Workspace → replica. */
export type MirrorReplicaControl =
	| { readonly type: 'apply'; readonly kind: 'snapshot' | 'events'; readonly data: string };

/** Replica → workspace. */
export type MirrorReplicaReport =
	| { readonly type: 'ready' }
	/** The size of the mirrored view's viewport, and of its content, in its own pixels. */
	| { readonly type: 'size'; readonly width: number; readonly height: number; readonly contentHeight: number }
	/** The replica could not apply what it was given and needs a fresh snapshot. */
	| { readonly type: 'failed' }
	/** What the mirrored view's controls hold and where it is scrolled; see `fieldState.ts`. */
	| { readonly type: 'state'; readonly state: unknown };

/** Workspace → a view's loader, beside the recorder script it sends. */
export type MirrorLoaderControl =
	/** Put back what a person had put into the view this one replaces. */
	{ readonly type: 'restore'; readonly state: unknown };
