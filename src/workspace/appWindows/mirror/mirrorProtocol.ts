/**
 * Messages between the workspace and the two scripts it injects for the view
 * mirror (ADR-0039): the recorder inside a view, and the replica inside an
 * observer's window. They deliberately are not JSON-RPC, so a view's own MCP
 * Apps transport ignores them.
 */

export const MIRROR_MESSAGE_KEY = 'terminayMirror' as const;

/** One complete view snapshot may be this large; a larger view is not mirrored. */
export const MIRROR_MAX_SNAPSHOT_BYTES = 768 * 1024;
/** A batch of changes larger than this is replaced by a fresh snapshot. */
export const MIRROR_MAX_BATCH_BYTES = 256 * 1024;
/** A view that produces more than this in a second is paused until someone asks again. */
export const MIRROR_MAX_BYTES_PER_SECOND = 1024 * 1024;

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
	/** JSON text of an array of recorded events; opaque to the workspace and the server. */
	readonly data: string;
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
	| { readonly type: 'failed' };

/**
 * Runs inside every view. It does nothing until the workspace sends the
 * recorder, so a view nobody is watching carries a few lines, not a library.
 */
export const MIRROR_LOADER_SCRIPT = `(() => {
	let loaded = false;
	addEventListener('message', (event) => {
		const message = event.data && event.data.${MIRROR_MESSAGE_KEY};
		if (event.source !== parent || loaded || !message || message.type !== 'load' || typeof message.code !== 'string') return;
		loaded = true;
		const script = document.createElement('script');
		script.textContent = message.code;
		(document.head || document.documentElement).appendChild(script);
		script.remove();
	});
})();`;
