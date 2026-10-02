import type { GitObservationReport } from '../../packages/server-core/src/gitService/types';
import type { DiagnosticEventInput } from './core';

const WARNINGS = new Set<GitObservationReport['kind']>([
	'watch.failed',
	'measurement.failed',
	'cache.mismatch',
]);

/**
 * The embedded Local server's Git observation report as a diagnostic event.
 * A report already names repositories and worktrees by process-local ids and
 * carries no path or ref, so its fields are recorded as they are.
 */
export function gitObservationDiagnosticEvent(
	report: GitObservationReport,
): DiagnosticEventInput {
	const { kind, ...fields } = report;
	return {
		component: 'local-server',
		event: `local-server.git.${kind}`,
		fields,
		severity: WARNINGS.has(kind) ? 'warning' : 'info',
		source: 'local-server-git',
	};
}
