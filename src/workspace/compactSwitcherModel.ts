/**
 * The compact switcher's model.
 *
 * One list answering "which panel", over every project of every attached
 * connection. It is a rearrangement of the dashboard's model rather than a
 * second set of facts: the same groups, the same panels, the same status
 * vocabulary, so a row and a card can never disagree about a panel.
 *
 * A connection heading appears even with one server attached. The dashboard can
 * drop that name as noise because its rows are already inside a server's
 * section; here the list is the only thing telling a user where a panel
 * lives, and a row whose server is unsaid is a row that can be activated by
 * mistake.
 *
 * Preview text is passed in, never fetched: it is a read of a buffer this
 * window already renders, so a terminal on another connection simply has none.
 */

import { compositionTabKey } from '../shared/connections/composition.ts';
import type { ActivityCountBadge } from './activityCountBadge.ts';
import type { DashboardServerSource } from './crossServerRows.ts';
import type { DashboardStatus } from './dashboardRows.ts';
import { buildDashboardGroups } from './dashboardRows.ts';
import type { WorkspaceInventoryPanelKind } from './workspaceInventory.ts';

/** How much of a preview line survives; a row is one line, not a viewport. */
export const COMPACT_SWITCHER_PREVIEW_MAX_LENGTH = 120;

export type CompactSwitcherPanelRow = Readonly<{
	isAgentStatus: boolean;
	key: string;
	panelId: string;
	panelKind: WorkspaceInventoryPanelKind;
	/** Absent only while a terminal panel has not yet bound its session. */
	preview?: string;
	projectId: string;
	serverId: string;
	sessionId?: string;
	state: DashboardStatus;
	title: string;
}>;

export type CompactSwitcherProjectGroup = Readonly<{
	badge?: ActivityCountBadge;
	color: string;
	emoji: string;
	key: string;
	panels: readonly CompactSwitcherPanelRow[];
	projectId: string;
	serverId: string;
	title: string;
}>;

export type CompactSwitcherConnectionGroup = Readonly<{
	projects: readonly CompactSwitcherProjectGroup[];
	serverId: string;
	serverLabel: string;
}>;

export type CompactSwitcherInput = Readonly<{
	activityBadgesByProject?: Readonly<Record<string, ActivityCountBadge>>;
	/** Resolves this window's rendered buffer for a session, when it holds one. */
	previewForSession?: (sessionId: string) => string | undefined;
	sources: readonly DashboardServerSource[];
}>;

/**
 * The most recent line a terminal actually printed.
 *
 * Trailing blank lines are what a prompt leaves behind, so the last *non-empty*
 * line is the one that says what happened. Nothing here is authority: it is
 * text to recognise a terminal by.
 */
export function previewLineFromOutput(
	output: string | undefined,
): string | undefined {
	if (output === undefined) return undefined;
	const lines = output.split('\n');
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index]?.trim();
		if (line === undefined || line.length === 0) continue;
		return line.length > COMPACT_SWITCHER_PREVIEW_MAX_LENGTH
			? `${line.slice(0, COMPACT_SWITCHER_PREVIEW_MAX_LENGTH - 1)}…`
			: line;
	}
	return undefined;
}

export function buildCompactSwitcherGroups(
	input: CompactSwitcherInput,
): readonly CompactSwitcherConnectionGroup[] {
	const badges = input.activityBadgesByProject ?? {};
	return Object.freeze(
		input.sources.map((source) => {
			const groups = buildDashboardGroups(
				source.projects,
				source.inventoryByProject,
				source.agentsByProject ?? {},
			);
			return Object.freeze({
				projects: Object.freeze(
					groups.map((group) => {
						const key = compositionTabKey(
							source.serverId,
							group.project.projectId,
						);
						const badge = badges[key];
						return Object.freeze({
							color: group.project.color,
							emoji: group.project.emoji,
							key,
							projectId: group.project.projectId,
							serverId: source.serverId,
							panels: Object.freeze(
								group.panels.map((panel) =>
									Object.freeze({
										isAgentStatus: panel.isAgentStatus,
										key: compositionTabKey(source.serverId, panel.panelId),
										panelId: panel.panelId,
										panelKind: panel.panelKind,
										projectId: panel.projectId,
										serverId: source.serverId,
										state: panel.status,
										title: panel.title,
										...(panel.sessionId === undefined
											? {}
											: { sessionId: panel.sessionId }),
										...(() => {
											if (panel.sessionId === undefined) return {};
											const preview = previewLineFromOutput(
												input.previewForSession?.(panel.sessionId),
											);
											return preview === undefined ? {} : { preview };
										})(),
									}),
								),
							),
							title: group.project.title,
							...(badge === undefined || badge.count <= 0 ? {} : { badge }),
						});
					}),
				),
				serverId: source.serverId,
				serverLabel: source.serverLabel,
			});
		}),
	);
}

const matches = (haystack: string, needle: string) =>
	haystack.toLocaleLowerCase().includes(needle);

/**
 * Filtering keeps whole groups, not just matching leaves.
 *
 * Typing a project's name is asking for that project, so its panels come
 * with it; typing a panel's name narrows to that panel. A group left with
 * nothing goes away rather than standing as an empty heading.
 */
export function filterCompactSwitcherGroups(
	groups: readonly CompactSwitcherConnectionGroup[],
	query: string,
): readonly CompactSwitcherConnectionGroup[] {
	const needle = query.trim().toLocaleLowerCase();
	if (needle.length === 0) return groups;
	const filtered: CompactSwitcherConnectionGroup[] = [];
	for (const connection of groups) {
		const connectionMatches = matches(connection.serverLabel, needle);
		const projects: CompactSwitcherProjectGroup[] = [];
		for (const project of connection.projects) {
			if (connectionMatches || matches(project.title, needle)) {
				projects.push(project);
				continue;
			}
			const panels = project.panels.filter((panel) =>
				matches(panel.title, needle),
			);
			if (panels.length > 0)
				projects.push(
					Object.freeze({ ...project, panels: Object.freeze(panels) }),
				);
		}
		if (projects.length > 0)
			filtered.push(
				Object.freeze({ ...connection, projects: Object.freeze(projects) }),
			);
	}
	return Object.freeze(filtered);
}

export function compactSwitcherIsEmpty(
	groups: readonly CompactSwitcherConnectionGroup[],
): boolean {
	return groups.every((connection) => connection.projects.length === 0);
}
