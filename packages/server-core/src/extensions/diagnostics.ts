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
}

export type ExtensionHostDiagnosticListener = (
	diagnostic: ExtensionHostDiagnostic,
) => void;

/** How far a terminal got towards being observed by an agent provider. */
export type AgentObservationTransition =
	/** A provider matched the terminal's foreground process. */
	| 'matched'
	/** The provider accepted the terminal and began observing. */
	| 'admitted'
	/** The provider bound a session, so the terminal shows agent state. */
	| 'bound'
	/** Admission failed; the terminal falls back to activity signalling. */
	| 'admission-failed'
	/** The observer was released, by shell return, replacement, or shutdown. */
	| 'released';

/** The opaque terminal an observation record is about. */
export interface AgentObservationTerminal {
	readonly serverId: string;
	readonly projectId: string;
	readonly sessionId: string;
}

/**
 * One agent observation outcome for one terminal.
 *
 * A terminal that never shows an agent has several possible causes, and only
 * these records separate them: no provider matched, admission failed, or
 * admission succeeded and no session was ever bound.
 */
export interface AgentObservationDiagnostic {
	readonly providerId: string;
	readonly terminal: AgentObservationTerminal;
	readonly transition: AgentObservationTransition;
	readonly at: number;
	readonly failureClass?: string;
	readonly reason?: string;
	readonly error?: ExtensionErrorDetail;
}

export type AgentObservationDiagnosticListener = (
	diagnostic: AgentObservationDiagnostic,
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
