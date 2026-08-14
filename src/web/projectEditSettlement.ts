import type { ServerWorkspaceProject } from '../shared/serverWorkspaceReconciliation';
import type { ProjectEditWindowResult } from '../types/terminay';

/**
 * The edit route resolves before its caller performs the authoritative server
 * commands. Keep the route in its saving state until the canonical projection
 * contains both the profile selection and the final project presentation.
 * Matching the presentation fields makes the generic project update the
 * commit barrier even when the profile mutation completes first.
 */
export function isProjectEditCommitted(
	project: ServerWorkspaceProject | undefined,
	result: ProjectEditWindowResult,
): boolean {
	if (project === undefined) return false;
	return (
		(project.defaultShellProfileId ?? null) === result.defaultShellProfileId &&
		project.name === (result.title.trim() || 'Untitled Project') &&
		(project.color ?? '') === result.color &&
		(project.icon ?? '') === result.emoji.trim()
	);
}
