import type { WorktreeCaptureReport } from '../../packages/server-core/src/worktreeCapture';
import type { DiagnosticEventInput } from './core';

/**
 * What worktree capture saw and decided, as a diagnostic event. A report names
 * the project and counts what was weighed; it carries no path, directory name,
 * or token, so its fields are recorded as they are.
 */
export function worktreeCaptureDiagnosticEvent(
	report: WorktreeCaptureReport,
): DiagnosticEventInput {
	const { kind, ...fields } = report;
	return {
		component: 'local-server',
		event: `local-server.worktree-capture.${kind}`,
		fields,
		severity: 'info',
		source: 'local-server-worktree-capture',
	};
}
