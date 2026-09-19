/** Auto-expansion is a per-app-session nicety rather than persisted state: the
 * set lives for the lifetime of this workspace bundle instance, so a manual
 * collapse is respected until the app is reloaded and the next session expands
 * the pane again on its first visit. */
const autoExpandedProjectIds = new Set<string>();

/** Marks the project as visited and reports whether the Documentation pane
 * should be expanded now. Returns false on every later visit in this session,
 * so a collapse the user made themselves stays put. */
export function shouldAutoExpandDocumentationPane(
	projectId: string,
	isCollapsed: boolean,
	visitedProjectIds: Set<string> = autoExpandedProjectIds,
): boolean {
	if (visitedProjectIds.has(projectId)) return false;
	visitedProjectIds.add(projectId);
	return isCollapsed;
}
