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

/**
 * A Board column. `attention` merges waiting and blocked: both want a person.
 * `untracked` holds terminals with Track activity off, which have no state to
 * sort by.
 */
export type DashboardBoardColumn =
	| 'attention'
	| 'working'
	| 'done'
	| 'idle'
	| 'untracked';

/**
 * Lifecycle order: an agent rests, works, may stop for a person, then
 * finishes. What is not tracked comes after all of it.
 */
export const DASHBOARD_BOARD_COLUMNS: readonly DashboardBoardColumn[] = [
	'idle',
	'working',
	'attention',
	'done',
	'untracked',
];

export const DASHBOARD_BOARD_COLUMN_LABELS: Record<
	DashboardBoardColumn,
	string
> = {
	attention: 'Needs you',
	done: 'Done',
	idle: 'Idle',
	untracked: 'Untracked',
	working: 'Working',
};

export const DASHBOARD_BOARD_COLUMN_EMPTY: Record<
	DashboardBoardColumn,
	string
> = {
	attention: 'Nothing is waiting on you',
	done: 'Nothing has finished',
	idle: 'Nothing is resting',
	untracked: 'Every tab is tracked',
	working: 'Nothing is running',
};

/** Every canonical state lands in exactly one status column. */
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
	/** Track activity is off for its terminal: it goes in Untracked. */
	untracked?: true;
}>;

/** The column an item belongs in. */
export function boardColumnForItem(
	item: DashboardBoardItem,
): DashboardBoardColumn {
	return item.untracked ? 'untracked' : boardColumnFor(item.state);
}

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
						...(panel.untracked ? { untracked: true as const } : {}),
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
						...(panel.untracked || agent.untracked
							? { untracked: true as const }
							: {}),
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
					...(agent.untracked ? { untracked: true as const } : {}),
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
		untracked: [],
		working: [],
	};
	for (const item of items) columns[boardColumnForItem(item)].push(item);
	return columns;
}

/**
 * One project's band on the grouped Board.
 *
 * Grouping is a second arrangement of the same cards, not a second Board: a
 * lane holds exactly the items the ungrouped Board would have shown for its
 * project, bucketed into the same five columns. A project with nothing in any
 * column gets no lane, for the same reason it gets no card ungrouped.
 */
export type DashboardBoardLane = Readonly<{
	columns: Record<DashboardBoardColumn, readonly DashboardBoardItem[]>;
	key: string;
	project: DashboardProjectRow;
	serverId: string;
	serverLabel?: string;
	total: number;
}>;

/** The Board's lanes, in the order the projects arrived in. */
export function buildDashboardBoardLanes(
	groups: readonly ServerScopedRow<DashboardProjectGroup>[],
): readonly DashboardBoardLane[] {
	const lanes: DashboardBoardLane[] = [];
	for (const scoped of groups) {
		const items = buildDashboardBoardItems([scoped]);
		if (items.length === 0) continue;
		lanes.push(
			Object.freeze({
				columns: groupBoardItemsByColumn(items),
				key: scoped.key,
				project: scoped.row.project,
				serverId: scoped.serverId,
				...(scoped.serverLabel === undefined
					? {}
					: { serverLabel: scoped.serverLabel }),
				total: items.length,
			}),
		);
	}
	return lanes;
}
