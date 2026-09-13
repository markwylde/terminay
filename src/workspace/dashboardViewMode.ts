/**
 * The three shapes Home can take.
 *
 * They are three arrangements of one model, not three models. List inventories
 * the workspace one unwrapped line at a time; Projects groups the same panels
 * into a card per project; Board drops the project grouping entirely and sorts
 * by what each thing needs from you.
 *
 * Board is the only one that can leave a project out, because a kanban column
 * holds what is in that state and a project with nothing in any column has
 * nothing to put there. That is why List is the default and the two inventory
 * views are the ones the "never omit a project" rule is stated against.
 */

import type { AgentState } from '../types/agentStatus';
import type { ServerScopedRow } from './crossServerRows.ts';
import type {
	DashboardAgent,
	DashboardPanelRow,
	DashboardProjectGroup,
	DashboardProjectRow,
} from './dashboardRows.ts';

export const DASHBOARD_VIEW_MODES = ['list', 'board', 'projects'] as const;
export type DashboardViewMode = (typeof DASHBOARD_VIEW_MODES)[number];

export const DEFAULT_DASHBOARD_VIEW_MODE: DashboardViewMode = 'list';

export function isDashboardViewMode(
	value: unknown,
): value is DashboardViewMode {
	return (
		typeof value === 'string' &&
		(DASHBOARD_VIEW_MODES as readonly string[]).includes(value)
	);
}

export const DASHBOARD_VIEW_MODE_LABELS: Record<DashboardViewMode, string> = {
	board: 'Board',
	list: 'List',
	projects: 'Projects',
};

/** A Board column. `attention` merges waiting and blocked: both want a person. */
export type DashboardBoardColumn = 'attention' | 'working' | 'done' | 'idle';

export const DASHBOARD_BOARD_COLUMNS: readonly DashboardBoardColumn[] = [
	'attention',
	'working',
	'done',
	'idle',
];

export const DASHBOARD_BOARD_COLUMN_LABELS: Record<
	DashboardBoardColumn,
	string
> = {
	attention: 'Needs you',
	done: 'Done',
	idle: 'Idle',
	working: 'Working',
};

export const DASHBOARD_BOARD_COLUMN_EMPTY: Record<
	DashboardBoardColumn,
	string
> = {
	attention: 'Nothing is waiting on you',
	done: 'Nothing has finished',
	idle: 'Nothing is resting',
	working: 'Nothing is running',
};

/** Every canonical state lands in exactly one column. */
export function boardColumnFor(state: AgentState): DashboardBoardColumn {
	switch (state) {
		case 'blocked':
		case 'waiting':
			return 'attention';
		case 'working':
			return 'working';
		case 'done':
			return 'done';
		default:
			return 'idle';
	}
}

/**
 * One thing on the Board.
 *
 * A panel running agents contributes one card per root agent rather than one
 * for the panel: three agents in one terminal are three things that can each
 * be waiting on you, and a single card could only report one of their states.
 * A panel running none contributes itself. Either way the card names the
 * project it came from, because the Board has dropped the project grouping.
 */
export type DashboardBoardItem = Readonly<{
	agent?: DashboardAgent;
	key: string;
	panel?: DashboardPanelRow;
	project: DashboardProjectRow;
	serverId: string;
	serverLabel?: string;
	state: AgentState;
}>;

export function buildDashboardBoardItems(
	groups: readonly ServerScopedRow<DashboardProjectGroup>[],
): readonly DashboardBoardItem[] {
	const items: DashboardBoardItem[] = [];
	for (const scoped of groups) {
		const { project, panels, detachedAgents } = scoped.row;
		const base = {
			project,
			serverId: scoped.serverId,
			...(scoped.serverLabel === undefined
				? {}
				: { serverLabel: scoped.serverLabel }),
		};
		for (const panel of panels) {
			if (panel.agents.length === 0) {
				items.push(
					Object.freeze({
						...base,
						key: `${scoped.key}:panel:${panel.panelId}`,
						panel,
						state: panel.status,
					}),
				);
				continue;
			}
			for (const agent of panel.agents) {
				items.push(
					Object.freeze({
						...base,
						agent,
						key: `${scoped.key}:agent:${agent.entryId}`,
						panel,
						state: agent.state,
					}),
				);
			}
		}
		for (const agent of detachedAgents) {
			items.push(
				Object.freeze({
					...base,
					agent,
					key: `${scoped.key}:agent:${agent.entryId}`,
					state: agent.state,
				}),
			);
		}
	}
	return items;
}

/** The Board's items, bucketed into its columns in one pass. */
export function groupBoardItemsByColumn(
	items: readonly DashboardBoardItem[],
): Record<DashboardBoardColumn, readonly DashboardBoardItem[]> {
	const columns: Record<DashboardBoardColumn, DashboardBoardItem[]> = {
		attention: [],
		done: [],
		idle: [],
		working: [],
	};
	for (const item of items) columns[boardColumnFor(item.state)].push(item);
	return columns;
}
