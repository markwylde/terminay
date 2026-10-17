/**
 * Terminals this window does not show.
 *
 * A window presents the projects of its own workspace view. A terminal can
 * still be running in the automation space, which no project tab presents,
 * or in a project of another view that no window is showing. The Tabs
 * section lists those too, so no running terminal is ever out of sight
 * (ADR-0071). Activating one goes to where it can be shown.
 */

import type {
	ServerWorkspacePanel,
	ServerWorkspaceProject,
	ServerWorkspaceSnapshot,
} from '../shared/serverWorkspaceReconciliation.ts';
import type { DashboardProjectSource } from './dashboardRows.ts';
import type { WorkspaceInventoryEntry } from './workspaceInventory.ts';

export type ElsewherePlacement = 'automations' | 'other-view';

export type ElsewhereTerminals = Readonly<{
	projects: readonly DashboardProjectSource[];
	inventoryByProject: Readonly<Record<string, WorkspaceInventoryEntry[]>>;
	/** Where each listed project is, by id. */
	placement: Readonly<Record<string, ElsewherePlacement>>;
}>;

const NOT_IN_THIS_WINDOW = 'not in this window';

/**
 * Every project this window does not present that holds a terminal, with
 * those terminals, in the server's view and project order. The automation
 * space comes last.
 */
export function elsewhereTerminals(
	snapshot: Pick<
		ServerWorkspaceSnapshot,
		'viewOrder' | 'views' | 'projects' | 'panels' | 'terminalSessions'
	>,
	windowProjectIds: ReadonlySet<string>,
): ElsewhereTerminals {
	const ordered: ServerWorkspaceProject[] = [];
	const seen = new Set<string>();
	for (const viewId of snapshot.viewOrder)
		for (const projectId of snapshot.views[viewId]?.projectIds ?? []) {
			const project = snapshot.projects[projectId];
			if (project === undefined || seen.has(projectId)) continue;
			seen.add(projectId);
			ordered.push(project);
		}
	for (const project of Object.values(snapshot.projects))
		if (!seen.has(project.id)) ordered.push(project);
	const projects: DashboardProjectSource[] = [];
	const inventoryByProject: Record<string, WorkspaceInventoryEntry[]> = {};
	const placement: Record<string, ElsewherePlacement> = {};
	const automations: ServerWorkspaceProject[] = [];
	for (const project of ordered) {
		if (windowProjectIds.has(project.id)) continue;
		if (project.kind !== undefined) {
			automations.push(project);
			continue;
		}
		add(project, `${project.name} · ${NOT_IN_THIS_WINDOW}`, 'other-view');
	}
	for (const project of automations) add(project, project.name, 'automations');
	return { projects, inventoryByProject, placement };

	function add(
		project: ServerWorkspaceProject,
		title: string,
		where: ElsewherePlacement,
	): void {
		const entries = project.panelIds.flatMap((panelId) => {
			const panel = snapshot.panels[panelId];
			return panel?.type === 'terminal' && panel.sessionId !== undefined
				? [entryFor(project, title, panel)]
				: [];
		});
		if (entries.length === 0) return;
		projects.push({
			id: project.id,
			title,
			color: project.color ?? '',
			emoji: project.icon ?? '',
		});
		inventoryByProject[project.id] = entries;
		placement[project.id] = where;
	}

	function entryFor(
		project: ServerWorkspaceProject,
		projectTitle: string,
		panel: ServerWorkspacePanel,
	): WorkspaceInventoryEntry {
		return {
			color: panel.color ?? project.color ?? '',
			emoji: panel.emoji ?? '',
			isAgentStatus: false,
			kind: 'terminal',
			panelId: panel.id,
			projectEmoji: project.icon ?? '',
			projectId: project.id,
			projectTitle,
			...(panel.folderId === undefined ? {} : { folderId: panel.folderId }),
			...(panel.sessionId === undefined ? {} : { sessionId: panel.sessionId }),
			status: 'idle',
			title: panel.title ?? 'Terminal',
		};
	}
}
