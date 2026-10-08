import type { HolderCloseNotice, HolderCloseReason } from './protocol.js';

/**
 * What a server learns about its session holders, reported to the host that
 * composed it. server-core owns no log: the host decides where a report goes.
 *
 * A report names a holder by its process id and start time and a session by an
 * ordinal this server assigned. It never carries a session id, a generation, a
 * credential, a path, a command, or output.
 */

export interface SessionHolderIdentity {
	readonly pid: number;
	readonly startedAt: number;
}

export type SessionHolderObservationReport =
	| {
			readonly kind: 'attached';
			readonly holder: SessionHolderIdentity;
			readonly buildId: string;
			readonly sameBuild: boolean;
			readonly draining: boolean;
			readonly liveSessions: number;
			readonly endedSessions: number;
			readonly limitMs: number | null;
	  }
	/** A record whose process was gone. */
	| {
			readonly kind: 'record-removed';
			readonly holder: SessionHolderIdentity;
	  }
	/** A holder this server shares no protocol version with, told to end. */
	| {
			readonly kind: 'incompatible';
			readonly holder: SessionHolderIdentity;
			readonly signal: 'SIGTERM';
	  }
	/** A live holder that would not take this server, and was left alone. */
	| {
			readonly kind: 'unreachable';
			readonly holder: SessionHolderIdentity;
			readonly reason: string;
	  }
	| {
			readonly kind: 'launched';
			readonly holder: SessionHolderIdentity;
			readonly durationMs: number;
			readonly limitMs: number | null;
	  }
	| {
			readonly kind: 'launch-failed';
			readonly durationMs: number;
			readonly error: string;
	  }
	| {
			readonly kind: 'drained';
			readonly holder: SessionHolderIdentity;
			readonly cause: 'build-mismatch';
	  }
	| {
			readonly kind: 'limit-set';
			readonly limitMs: number | null;
			readonly holders: number;
	  }
	| {
			readonly kind: 'connection-closed';
			readonly holder: SessionHolderIdentity;
			/** This server closed it, by detaching or by ending every session. */
			readonly requested: boolean;
			/** The holder said it was closing before the connection went. */
			readonly announced: boolean;
			readonly liveSessions: number;
	  }
	| {
			readonly kind: 'closed';
			readonly holder: SessionHolderIdentity;
			/** Read from a record left by a holder that had nobody to tell. */
			readonly late: boolean;
			readonly reason: HolderCloseReason;
			readonly signal?: string;
			readonly error?: string;
			readonly closedAt: number;
			readonly liveSessions: number;
			readonly endedSessions: number;
			readonly attached: boolean;
			readonly draining: boolean;
			readonly limitMs: number | null;
			readonly attachCount: number;
			readonly sinceAttachMs: number | null;
			readonly sinceDetachMs: number | null;
	  }
	| {
			readonly kind: 'session-ended';
			readonly holder: SessionHolderIdentity;
			readonly session: number;
			readonly exitCode: number | null;
			readonly signal: number | null;
			/** This server signalled or ended the session before it exited. */
			readonly requested: boolean;
			/** It ended with no server watching, and is reported on adoption. */
			readonly endedUnattached: boolean;
	  };

export type SessionHolderObserver = (
	report: SessionHolderObservationReport,
) => void;

export function holderClosedReport(
	notice: HolderCloseNotice,
	late: boolean,
): Extract<SessionHolderObservationReport, { kind: 'closed' }> {
	const since = (at: number | null): number | null =>
		at === null ? null : Math.max(0, notice.closedAt - at);
	return {
		kind: 'closed',
		holder: { pid: notice.pid, startedAt: notice.startedAt },
		late,
		reason: notice.reason,
		...(notice.signal === undefined ? {} : { signal: notice.signal }),
		...(notice.error === undefined ? {} : { error: notice.error }),
		closedAt: notice.closedAt,
		liveSessions: notice.liveSessions,
		endedSessions: notice.endedSessions,
		attached: notice.attached,
		draining: notice.draining,
		limitMs: notice.limitMs,
		attachCount: notice.attachCount,
		sinceAttachMs: since(notice.lastAttachAt),
		sinceDetachMs: since(notice.lastDetachAt),
	};
}
