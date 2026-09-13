/**
 * Home, over every attached server.
 *
 * Home is where a window shows more than one server at once, and it
 * aggregates — it never merges. Every row keeps the server that owns it,
 * because a project id and a panel id are per-server namespaces: two servers
 * restored from one data root produce the same ids for different things.
 *
 * The activity badges the tab strip shows for other servers come from their
 * agent projections instead (`agentBadgesForOtherServers`), which is all a
 * window knows about a server it is not currently working in.
 *
 * The server is named on a row only when the window has more than one
 * attached. With one server, saying its name on every row is noise.
 */

import { compositionTabKey } from '../shared/connections/composition.ts';
import type { AgentStatusEntry } from '../types/agentStatus';
import type {
	DashboardProjectGroup,
	DashboardProjectSource,
	DashboardRow,
} from './dashboardRows.ts';
import {
	buildDashboardGroups,
	flattenDashboardGroups,
} from './dashboardRows.ts';
import type { WorkspaceInventoryEntry } from './workspaceInventory';

/** One connection's contribution to a cross-server surface. */
export type ServerRowSource<T> = Readonly<{
	serverId: string;
	serverLabel: string;
	rows: readonly T[];
}>;

/** Any row, tagged with the server that owns it. */
export type ServerScopedRow<T> = Readonly<{
	serverId: string;
	/** Present only when the window has more than one server attached. */
	serverLabel?: string;
	/** `(serverId, rowKey)`; unique across servers where the row key is not. */
	key: string;
	row: T;
}>;

export function namesServers(
	sources: readonly Readonly<{ serverId: string }>[],
): boolean {
	return new Set(sources.map((source) => source.serverId)).size > 1;
}

/** Tag every row with its server, keyed so two servers cannot collide. */
export function scopeRowsByServer<T>(
	sources: readonly ServerRowSource<T>[],
	rowKey: (row: T) => string,
): readonly ServerScopedRow<T>[] {
	const name = namesServers(sources);
	const scoped: ServerScopedRow<T>[] = [];
	for (const source of sources) {
		for (const row of source.rows) {
			scoped.push(
				Object.freeze({
					serverId: source.serverId,
					key: compositionTabKey(source.serverId, rowKey(row)),
					row,
					...(name ? { serverLabel: source.serverLabel } : {}),
				}),
			);
		}
	}
	return Object.freeze(scoped);
}

export type DashboardServerSource = Readonly<{
	serverId: string;
	serverLabel: string;
	projects: readonly DashboardProjectSource[];
	inventoryByProject: Readonly<Record<string, WorkspaceInventoryEntry[]>>;
	/**
	 * This server's live agents, already assigned to one of its projects.
	 * Absent for a connection whose agent projection has not arrived, which is
	 * a server with no agents to show rather than an error.
	 */
	agentsByProject?: Readonly<Record<string, readonly AgentStatusEntry[]>>;
}>;

/**
 * Home, over every attached server.
 *
 * Each server's rows are built by the same single-server row model, then
 * concatenated in connection order. Nothing is interleaved or summed across
 * servers: a project row still counts only its own server's panels.
 */
export function buildCrossServerDashboardGroups(
	sources: readonly DashboardServerSource[],
): readonly ServerScopedRow<DashboardProjectGroup>[] {
	return scopeRowsByServer(
		sources.map((source) =>
			Object.freeze({
				serverId: source.serverId,
				serverLabel: source.serverLabel,
				rows: buildDashboardGroups(
					source.projects,
					source.inventoryByProject,
					source.agentsByProject,
				),
			}),
		),
		(group) => `project:${group.project.projectId}`,
	);
}

/** The List view's flat rows, each still tagged with the server that owns it. */
export function flattenCrossServerDashboardGroups(
	groups: readonly ServerScopedRow<DashboardProjectGroup>[],
): readonly ServerScopedRow<DashboardRow>[] {
	return groups.flatMap((scoped) =>
		flattenDashboardGroups([scoped.row]).map((row) =>
			Object.freeze({
				...scoped,
				key: compositionTabKey(
					scoped.serverId,
					row.kind === 'project'
						? `project:${row.projectId}`
						: `panel:${row.projectId}:${row.panelId}`,
				),
				row,
			}),
		),
	);
}

export function buildCrossServerDashboardRows(
	sources: readonly DashboardServerSource[],
): readonly ServerScopedRow<DashboardRow>[] {
	return flattenCrossServerDashboardGroups(
		buildCrossServerDashboardGroups(sources),
	);
}
