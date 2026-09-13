/**
 * Narrowing the dashboard.
 *
 * A filter runs over the model, not over a view, so all three views narrow to
 * the same thing. A project is kept when it matches or when anything inside it
 * matches, and a kept project keeps only the panels and agents that matched —
 * a project full of idle shells should not survive a search for the one agent
 * that is blocked.
 *
 * A panel matched by its own title keeps all of its agents: you asked for that
 * panel, so you get what is in it.
 */

import type { ServerScopedRow } from './crossServerRows.ts';
import type {
	DashboardAgent,
	DashboardPanelRow,
	DashboardProjectGroup,
} from './dashboardRows.ts';

function matches(text: string | undefined, needle: string): boolean {
	return text?.toLowerCase().includes(needle) ?? false;
}

function agentMatches(agent: DashboardAgent, needle: string): boolean {
	return (
		matches(agent.name, needle) ||
		matches(agent.provider, needle) ||
		matches(agent.model, needle) ||
		matches(agent.metadata, needle) ||
		matches(agent.prompt, needle) ||
		agent.subagents.some((child) => agentMatches(child, needle))
	);
}

/** Keep a root whose own fields matched, or that holds a matching subagent. */
function filterAgents(
	agents: readonly DashboardAgent[],
	needle: string,
): readonly DashboardAgent[] {
	return agents.filter((agent) => agentMatches(agent, needle));
}

function filterPanel(
	panel: DashboardPanelRow,
	needle: string,
): DashboardPanelRow | undefined {
	if (matches(panel.title, needle)) return panel;
	const agents = filterAgents(panel.agents, needle);
	return agents.length === 0 ? undefined : { ...panel, agents };
}

/**
 * Empty or whitespace-only text is no filter at all and returns the groups
 * untouched — identity, so a memo over an empty box costs nothing.
 */
export function filterDashboardGroups(
	scoped: readonly ServerScopedRow<DashboardProjectGroup>[],
	text: string,
): readonly ServerScopedRow<DashboardProjectGroup>[] {
	const needle = text.trim().toLowerCase();
	if (needle.length === 0) return scoped;
	const kept: ServerScopedRow<DashboardProjectGroup>[] = [];
	for (const scopedGroup of scoped) {
		const group = scopedGroup.row;
		// A project named by the filter keeps everything it holds.
		if (matches(group.project.title, needle)) {
			kept.push(scopedGroup);
			continue;
		}
		const panels = group.panels
			.map((panel) => filterPanel(panel, needle))
			.filter((panel): panel is DashboardPanelRow => panel !== undefined);
		const detachedAgents = filterAgents(group.detachedAgents, needle);
		if (panels.length === 0 && detachedAgents.length === 0) continue;
		kept.push({
			...scopedGroup,
			row: { ...group, detachedAgents, panels },
		});
	}
	return kept;
}
