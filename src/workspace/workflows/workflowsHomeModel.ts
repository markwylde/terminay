/**
 * What Home's Workflows section shows, as pure functions.
 *
 * A row is a workflow joined to the dashboard's row for its terminal, which
 * names its project and terminal and is what activation acts on. A workflow
 * whose terminal the dashboard does not list is never shown, so the section
 * cannot name or open a terminal outside the window's reach. Rows are keyed
 * by server, so session ids are never compared across servers.
 */

import type { SessionWorkflow, WorkflowStepStatus } from '@terminay/client-core';
import type { DashboardServerSource } from '../crossServerRows.ts';
import { buildDashboardGroups, type DashboardPanelRow } from '../dashboardRows.ts';
import { doneCount, isCurrentStep, isFinished } from './workflowPanelModel.ts';
import type {
	WorkflowsHomeSort,
	WorkflowsHomeStatus,
	WorkflowsHomeView,
} from './workflowsHomeView.ts';

export type WorkflowsHomeTone = 'alert' | 'running' | 'done' | 'idle';

export const UNRESTORABLE_WORKFLOW_NAME = 'Workflow could not be restored';

export type WorkflowsHomeRow = Readonly<{
	key: string;
	serverId: string;
	sessionId: string;
	view: SessionWorkflow;
	/** The workflow's name, or what an unrestorable one is called. */
	name: string;
	projectKey: string;
	projectId: string;
	projectTitle: string;
	projectColor: string;
	terminalTitle: string;
	/** The dashboard's row for the terminal: what activation is given. */
	panel: DashboardPanelRow;
	tone: WorkflowsHomeTone;
	done: number;
	total: number;
	/** Share of steps done, 0 to 1. */
	fraction: number;
	/** Latest start or end time of any step, or null before any. */
	lastChange: number | null;
}>;

/** The server-scoped workflows a client holds, by server then session. */
export type WorkflowsByServer = ReadonlyMap<
	string,
	Readonly<{ workflows: ReadonlyMap<string, SessionWorkflow> }>
>;

/** Highlighted in a column, and kept by Current only: the panel's rule. */
export function isHighlighted(status: WorkflowStepStatus): boolean {
	return isCurrentStep(status);
}

export function workflowTone(view: SessionWorkflow): WorkflowsHomeTone {
	if (view.state === 'unrestorable') return 'alert';
	const { steps } = view.workflow;
	if (steps.some((step) => step.status === 'failed' || step.status === 'needs_input'))
		return 'alert';
	if (steps.some((step) => step.status === 'running')) return 'running';
	if (isFinished(view.workflow)) return 'done';
	return 'idle';
}

function lastChangeOf(view: SessionWorkflow): number | null {
	if (view.state !== 'attached') return null;
	let latest: number | null = null;
	for (const step of view.workflow.steps) {
		for (const time of [step.startedAt, step.endedAt]) {
			if (time !== null && (latest === null || time > latest)) latest = time;
		}
	}
	return latest;
}

const projectKeyOf = (serverId: string, projectId: string) => `${serverId}:${projectId}`;

/** Every workflow on a terminal the dashboard lists, in dashboard order. */
export function buildWorkflowRows(
	sources: readonly DashboardServerSource[],
	workflows: WorkflowsByServer,
): readonly WorkflowsHomeRow[] {
	const rows: WorkflowsHomeRow[] = [];
	for (const source of sources) {
		const server = workflows.get(source.serverId);
		if (server === undefined || server.workflows.size === 0) continue;
		for (const group of buildDashboardGroups(source.projects, source.inventoryByProject)) {
			for (const panel of group.panels) {
				if (panel.sessionId === undefined) continue;
				const view = server.workflows.get(panel.sessionId);
				if (view === undefined) continue;
				const attached = view.state === 'attached';
				const total = attached ? view.workflow.steps.length : 0;
				const done = attached
					? doneCount(view.workflow)
					: 0;
				rows.push(
					Object.freeze({
						key: `${source.serverId}:${panel.sessionId}`,
						serverId: source.serverId,
						sessionId: panel.sessionId,
						view,
						name: attached ? view.workflow.name : UNRESTORABLE_WORKFLOW_NAME,
						projectKey: projectKeyOf(source.serverId, group.project.projectId),
						projectId: group.project.projectId,
						projectTitle: group.project.title,
						projectColor: group.project.color,
						terminalTitle: panel.title,
						panel,
						tone: workflowTone(view),
						done,
						total,
						fraction: total === 0 ? 0 : done / total,
						lastChange: lastChangeOf(view),
					}),
				);
			}
		}
	}
	return Object.freeze(rows);
}

/** How many rows need the user, whatever the section's filters. */
export function needsYouCount(rows: readonly WorkflowsHomeRow[]): number {
	return rows.filter((row) => row.tone === 'alert').length;
}

const TONE_RANK: Readonly<Record<WorkflowsHomeTone, number>> = {
	alert: 0,
	running: 1,
	idle: 2,
	done: 3,
};

const newestFirst = (a: number | null, b: number | null) => {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return b - a;
};

export function compareWorkflowRows(
	sort: WorkflowsHomeSort,
): (a: WorkflowsHomeRow, b: WorkflowsHomeRow) => number {
	const tieBreak = (a: WorkflowsHomeRow, b: WorkflowsHomeRow) =>
		a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
	switch (sort) {
		case 'recent':
			return (a, b) => newestFirst(a.lastChange, b.lastChange) || tieBreak(a, b);
		case 'progress':
			return (a, b) => b.fraction - a.fraction || tieBreak(a, b);
		case 'name':
			return (a, b) =>
				a.name.localeCompare(b.name) ||
				a.terminalTitle.localeCompare(b.terminalTitle) ||
				tieBreak(a, b);
		default:
			return (a, b) =>
				TONE_RANK[a.tone] - TONE_RANK[b.tone] ||
				newestFirst(a.lastChange, b.lastChange) ||
				tieBreak(a, b);
	}
}

export type WorkflowsHomeProject = Readonly<{
	key: string;
	title: string;
	color: string;
	count: number;
	included: boolean;
}>;

export type WorkflowsHomeGroupModel = Readonly<{
	key: string;
	title: string;
	/** Set when grouped by project. */
	color?: string;
	rows: readonly WorkflowsHomeRow[];
	counts: Readonly<Record<WorkflowsHomeStatus, number>>;
	folded: boolean;
}>;

export type WorkflowsHomeModel = Readonly<{
	/** Every row there is. */
	total: number;
	/** The rows shown, in order. */
	shown: readonly WorkflowsHomeRow[];
	/** Set while grouped. */
	groups?: readonly WorkflowsHomeGroupModel[];
	/** Per status, over the included projects. */
	statusCounts: Readonly<Record<WorkflowsHomeStatus, number>>;
	projects: readonly WorkflowsHomeProject[];
}>;

function countTones(rows: readonly WorkflowsHomeRow[]) {
	return Object.freeze({
		alert: rows.filter((row) => row.tone === 'alert').length,
		running: rows.filter((row) => row.tone === 'running').length,
		done: rows.filter((row) => row.tone === 'done').length,
	});
}

function matchesText(row: WorkflowsHomeRow, text: string): boolean {
	const needle = text.trim().toLocaleLowerCase();
	if (needle === '') return true;
	return [row.name, row.terminalTitle, row.projectTitle].some((field) =>
		field.toLocaleLowerCase().includes(needle),
	);
}

/** The rows a view shows, sorted, grouped, and counted. */
export function applyWorkflowsHomeView(
	rows: readonly WorkflowsHomeRow[],
	view: WorkflowsHomeView,
): WorkflowsHomeModel {
	const excluded = new Set(view.excludedProjects);
	const projectsByKey = new Map<string, { title: string; color: string; count: number }>();
	for (const row of rows) {
		const project = projectsByKey.get(row.projectKey);
		if (project === undefined)
			projectsByKey.set(row.projectKey, {
				title: row.projectTitle,
				color: row.projectColor,
				count: 1,
			});
		else project.count += 1;
	}
	const projects = [...projectsByKey].map(([key, project]) =>
		Object.freeze({ key, ...project, included: !excluded.has(key) }),
	);
	const included = rows.filter((row) => !excluded.has(row.projectKey));
	const statusCounts = countTones(included);
	const statuses = new Set<WorkflowsHomeTone>(view.statuses);
	const shown = included
		.filter((row) => view.showFinished || row.tone !== 'done')
		.filter((row) => statuses.size === 0 || statuses.has(row.tone))
		.filter((row) => matchesText(row, view.text))
		.sort(compareWorkflowRows(view.sort));

	let groups: WorkflowsHomeGroupModel[] | undefined;
	if (view.group !== 'none') {
		const folded = new Set(view.folded);
		const byKey = new Map<string, WorkflowsHomeRow[]>();
		for (const row of shown) {
			const key = view.group === 'project' ? row.projectKey : `workflow:${row.name}`;
			const bucket = byKey.get(key);
			if (bucket === undefined) byKey.set(key, [row]);
			else bucket.push(row);
		}
		// `shown` is sorted, so each group is placed by its first member.
		groups = [...byKey].map(([key, members]) => {
			const first = members[0] as WorkflowsHomeRow;
			return Object.freeze({
				key,
				title: view.group === 'project' ? first.projectTitle : first.name,
				...(view.group === 'project' ? { color: first.projectColor } : {}),
				rows: Object.freeze(members),
				counts: countTones(members),
				folded: folded.has(key),
			});
		});
	}

	return Object.freeze({
		total: rows.length,
		shown: Object.freeze(shown),
		...(groups === undefined ? {} : { groups: Object.freeze(groups) }),
		statusCounts,
		projects: Object.freeze(projects),
	});
}
