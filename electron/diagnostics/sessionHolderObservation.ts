import type { SessionHolderObservationReport } from '../../packages/server-core/src/sessionHolder/observation';
import type { DiagnosticEventInput } from './core';

type Report = SessionHolderObservationReport;

/**
 * Turns the embedded Local server's session-holder reports into diagnostic
 * events. A report names a holder by its process id and start time, which is
 * what ties a close reported late to the launch that attached it; within one
 * launch every record for that holder also carries the same short id.
 */
export function createSessionHolderDiagnostics(): (
	report: Report,
) => DiagnosticEventInput {
	const holders = new Map<string, string>();
	const holderFields = (identity: {
		readonly pid: number;
		readonly startedAt: number;
	}) => {
		const key = `${identity.pid}:${identity.startedAt}`;
		let holder = holders.get(key);
		if (holder === undefined) {
			holder = `h${holders.size + 1}`;
			holders.set(key, holder);
		}
		return {
			holder,
			holderPid: identity.pid,
			holderStartedAt: identity.startedAt,
		};
	};
	return (report) => {
		const { kind, ...rest } = report;
		const fields: Record<string, unknown> = { ...rest };
		if ('holder' in report) {
			delete fields.holder;
			Object.assign(fields, holderFields(report.holder));
		}
		if (report.kind === 'session-ended') fields.session = `s${report.session}`;
		return {
			component: 'local-server',
			event: `local-server.session-holder.${kind}`,
			fields,
			severity: isWarning(report) ? 'warning' : 'info',
			source: 'local-server-session-holder',
		};
	};
}

/** The reports that mean sessions were, or are about to be, lost unasked. */
function isWarning(report: Report): boolean {
	switch (report.kind) {
		case 'closed':
			return report.liveSessions > 0 && report.reason !== 'end-all';
		case 'connection-closed':
			return !report.requested;
		case 'launch-failed':
		case 'incompatible':
		case 'unreachable':
			return true;
		default:
			return false;
	}
}
