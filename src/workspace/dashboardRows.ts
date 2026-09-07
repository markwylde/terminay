/**
 * The dashboard's row model.
 *
 * One line per project, then one line per panel it holds. Composition is a pure
 * function of the ordered project list and the published inventory so the view
 * can stay a renderer: what the dashboard shows is decided here and asserted
 * here.
 */

import type { AgentState } from '../types/agentStatus';
import { terminalOverviewStateToAgentState } from './activityStates.ts';
import type {
	WorkspaceInventoryEntry,
	WorkspaceInventoryPanelKind,
	WorkspaceInventoryStatus,
} from './workspaceInventory';

/** The status vocabulary shared with the terminal tab and activity surfaces. */
export type DashboardStatus = AgentState;

export type DashboardStatusCounts = {
	attention: number;
	done: number;
	panels: number;
	working: number;
};

export type DashboardProjectRow = {
	color: string;
	counts: DashboardStatusCounts;
	emoji: string;
	kind: 'project';
	projectId: string;
	title: string;
};

export type DashboardPanelRow = {
	color: string;
	emoji: string;
	isAgentStatus: boolean;
	kind: 'panel';
	panelId: string;
	panelKind: WorkspaceInventoryPanelKind;
	projectId: string;
	sessionId?: string;
	status: DashboardStatus;
	title: string;
};

export type DashboardRow = DashboardProjectRow | DashboardPanelRow;

export type DashboardProjectSource = {
	color: string;
	emoji: string;
	id: string;
	title: string;
};

/** An inventory status in the canonical vocabulary the indicators speak. */
export function dashboardStatusFor(
	status: WorkspaceInventoryStatus,
): DashboardStatus {
	if (status === 'idle') return 'idle';
	return terminalOverviewStateToAgentState(status);
}

function countStatuses(
	entries: readonly WorkspaceInventoryEntry[],
): DashboardStatusCounts {
	const counts: DashboardStatusCounts = {
		attention: 0,
		done: 0,
		panels: entries.length,
		working: 0,
	};
	for (const entry of entries) {
		const status = dashboardStatusFor(entry.status);
		if (status === 'waiting' || status === 'blocked') counts.attention += 1;
		else if (status === 'working') counts.working += 1;
		else if (status === 'done') counts.done += 1;
	}
	return counts;
}

/**
 * Every project in project order, each followed by its panels in panel order.
 * A project with no panels still gets its header row: the dashboard says what
 * exists, not only what is busy.
 */
export function buildDashboardRows(
	projects: readonly DashboardProjectSource[],
	inventoryByProject: Readonly<Record<string, WorkspaceInventoryEntry[]>>,
): DashboardRow[] {
	const rows: DashboardRow[] = [];
	for (const project of projects) {
		const entries = inventoryByProject[project.id] ?? [];
		rows.push({
			color: project.color,
			counts: countStatuses(entries),
			emoji: project.emoji,
			kind: 'project',
			projectId: project.id,
			title: project.title,
		});
		for (const entry of entries) {
			rows.push({
				color: entry.color,
				emoji: entry.emoji,
				isAgentStatus: entry.isAgentStatus,
				kind: 'panel',
				panelId: entry.panelId,
				panelKind: entry.kind,
				projectId: project.id,
				status: dashboardStatusFor(entry.status),
				title: entry.title,
				...(entry.sessionId === undefined
					? {}
					: { sessionId: entry.sessionId }),
			});
		}
	}
	return rows;
}

/**
 * A row activation resolved against what exists right now, so a row rendered
 * before a project or panel went away cannot act on it.
 */
export type DashboardActivation =
	| { kind: 'project'; projectId: string }
	| { kind: 'panel'; panelId: string; projectId: string; sessionId: string }
	| { kind: 'stale' };

export function resolveDashboardActivation(
	row: DashboardRow,
	projects: readonly DashboardProjectSource[],
	inventoryByProject: Readonly<Record<string, WorkspaceInventoryEntry[]>>,
): DashboardActivation {
	if (!projects.some((project) => project.id === row.projectId))
		return { kind: 'stale' };
	if (row.kind === 'project')
		return { kind: 'project', projectId: row.projectId };
	const entry = (inventoryByProject[row.projectId] ?? []).find(
		(candidate) => candidate.panelId === row.panelId,
	);
	if (entry === undefined) return { kind: 'stale' };
	if (entry.sessionId === undefined)
		return { kind: 'project', projectId: row.projectId };
	return {
		kind: 'panel',
		panelId: entry.panelId,
		projectId: row.projectId,
		sessionId: entry.sessionId,
	};
}
