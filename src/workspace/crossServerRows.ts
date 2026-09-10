/**
 * The three surfaces that look across every attached server.
 *
 * Home, the activity badges, and the agent sidebar are the only places a
 * window shows more than one server at once, and they aggregate — they never
 * merge. Every row keeps the server that owns it, because a project id, a
 * panel id, and an agent entry id are all per-server namespaces: two servers
 * restored from one data root produce the same ids for different things.
 *
 * The server is named on a row only when the window has more than one
 * attached. With one server, saying its name on every row is noise.
 */

import type { AgentsSidebarItem } from '../components/AgentsSidebar';
import { compositionTabKey } from '../shared/connections/composition.ts';
import {
	type ActivityBadgeSourceState,
	type ActivityCountBadge,
	summarizeActivityBadge,
} from './activityCountBadge.ts';
import type { DashboardProjectSource, DashboardRow } from './dashboardRows.ts';
import { buildDashboardRows } from './dashboardRows.ts';
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
}>;

/**
 * Home, over every attached server.
 *
 * Each server's rows are built by the same single-server row model, then
 * concatenated in connection order. Nothing is interleaved or summed across
 * servers: a project row still counts only its own server's panels.
 */
export function buildCrossServerDashboardRows(
	sources: readonly DashboardServerSource[],
): readonly ServerScopedRow<DashboardRow>[] {
	return scopeRowsByServer(
		sources.map((source) =>
			Object.freeze({
				serverId: source.serverId,
				serverLabel: source.serverLabel,
				rows: buildDashboardRows(source.projects, source.inventoryByProject),
			}),
		),
		(row) =>
			row.kind === 'project'
				? `project:${row.projectId}`
				: `panel:${row.projectId}:${row.panelId}`,
	);
}

/**
 * The header's activity badge over every attached server.
 *
 * One badge for the window, because there is one header. Its count is the
 * total across servers and its state is the most urgent of them, which is the
 * same rule the single-server badge already uses.
 */
export function summarizeCrossServerActivityBadge(
	sources: readonly ServerRowSource<ActivityBadgeSourceState>[],
): ActivityCountBadge | null {
	return summarizeActivityBadge(sources.flatMap((source) => [...source.rows]));
}

/** Per-server badge counts, for a control that lists servers rather than
 * summing them. Servers with nothing to report are omitted. */
export function activityBadgesByServer(
	sources: readonly ServerRowSource<ActivityBadgeSourceState>[],
): readonly Readonly<{
	serverId: string;
	serverLabel: string;
	badge: ActivityCountBadge;
}>[] {
	const badges: Array<
		Readonly<{ serverId: string; serverLabel: string; badge: ActivityCountBadge }>
	> = [];
	for (const source of sources) {
		const badge = summarizeActivityBadge(source.rows);
		if (badge === null) continue;
		badges.push(
			Object.freeze({
				serverId: source.serverId,
				serverLabel: source.serverLabel,
				badge,
			}),
		);
	}
	return Object.freeze(badges);
}

/**
 * The agent sidebar over every attached server.
 *
 * Agent entry ids are unique only within one server's projection, so the row
 * key carries the server. Acknowledging a row therefore reaches exactly one
 * server's agent store, which is the one that owns the entry.
 */
export function buildCrossServerAgentRows(
	sources: readonly ServerRowSource<AgentsSidebarItem>[],
): readonly ServerScopedRow<AgentsSidebarItem>[] {
	return scopeRowsByServer(
		sources,
		(item) => `${item.projectId}:${item.entry.entryId}`,
	);
}
