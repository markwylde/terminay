/**
 * Extension host lifecycle diagnostics.
 *
 * An extension host that dies takes its cause with it: the child suppresses
 * Node's own stack print so it can report the error itself, and a packaged
 * child has no readable stderr. These records are the only place that answer
 * survives, so every transition that ends or resumes a host emits one.
 *
 * Server Core never writes them anywhere. The privileged host supplies a
 * listener and decides where the records go; an absent listener is a silent
 * no-op, which keeps a standalone server free to route them to its own sink.
 */

/** What happened to a host. One record per transition, never a summary. */
export type ExtensionHostTransition =
	/** A child process was forked for this extension. */
	| 'spawned'
	/** The child activated and published its contributions. */
	| 'ready'
	/** The child process ended, whatever the reason. */
	| 'child-exited'
	/** A frame could not be written because the child's channel had closed. */
	| 'channel-closed'
	/** The operating system refused a frame the channel had accepted, the
	 * first time for this child; later refusals are counted on its exit. */
	| 'channel-write-failed'
	/** The child process emitted an `error` event (spawn, kill, or write). */
	| 'child-error'
	/** The host killed the child itself, rather than observing it exit. */
	| 'child-terminated'
	/** A failure was counted against the crash window. */
	| 'failed'
	/** A restart was scheduled for `restartAt`. */
	| 'restart-scheduled'
	/** The supervisor is restarting the host now. */
	| 'restart-attempted'
	/** Failures reached the crash threshold; no further restart is automatic. */
	| 'quarantined'
	/** An explicit restart cleared quarantine and the crash window. */
	| 'quarantine-cleared'
	/** The host was stopped deliberately. */
	| 'stopped';

/**
 * The error a child reported before exiting, recorded as the child gave it.
 *
 * Extensions are trusted Node programs and this history is local and never
 * uploaded automatically, so the text is not truncated, redacted, or
 * path-stripped. What stays out is terminal output, provider journal records,
 * prompts, tool inputs and results, and credentials — none of which is an
 * error's own text.
 */
export interface ExtensionErrorDetail {
	readonly name: string;
	readonly message: string;
	readonly stack?: string;
}

export interface ExtensionHostDiagnostic {
	readonly extensionId: string;
	readonly transition: ExtensionHostTransition;
	readonly at: number;
	/** Exit status observed by the host, independent of any child report. */
	readonly exitCode?: number | null;
	readonly signal?: string | null;
	/** Failures inside the current crash window, after this transition. */
	readonly consecutiveFailures?: number;
	readonly restartAt?: number;
	readonly error?: ExtensionErrorDetail;
	/** True when a stop was asked for rather than suffered. */
	readonly deliberate?: boolean;
	/** True for a failure discovered after this incarnation's child had gone,
	 * recorded for the reader but not counted again against the threshold. */
	readonly afterChildGone?: boolean;
	/** The system error code, such as `EPIPE`, when the error carried one. */
	readonly errorCode?: string;
	/** Frames the operating system refused for this child before it exited. */
	readonly failedWrites?: number;
	/** Calls to the child still awaiting a reply when it exited. */
	readonly pendingCalls?: number;
	/** Lifecycle publications still being ingested when the child exited. */
	readonly activeAgentPublications?: number;
}

export type ExtensionHostDiagnosticListener = (
	diagnostic: ExtensionHostDiagnostic,
) => void;

/** Reduce an unknown thrown value to the detail these records carry. */
export function extensionErrorDetail(cause: unknown): ExtensionErrorDetail {
	if (cause instanceof Error)
		return {
			name: cause.name,
			message: cause.message,
			...(typeof cause.stack === 'string' ? { stack: cause.stack } : {}),
		};
	return {
		name: 'Error',
		message: typeof cause === 'string' ? cause : String(cause),
	};
}
