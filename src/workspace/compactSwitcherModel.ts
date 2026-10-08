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
import type { DashboardServerSource } from './crossServerRows.ts';
import type { DashboardStatus } from './dashboardRows.ts';
import { buildDashboardGroups } from './dashboardRows.ts';
import type { WorkspaceInventoryPanelKind } from './workspaceInventory.ts';

/** How much of a preview line survives; a row is one line, not a viewport. */
export const COMPACT_SWITCHER_PREVIEW_MAX_LENGTH = 120;

export type CompactSwitcherPanelRow = Readonly<{
	/** The folder that holds the panel, when this window knows it. */
	folderId?: string;
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

/** One folder of a project and the panels it holds. */
export type CompactSwitcherFolderGroup = Readonly<{
	folderId: string;
	key: string;
	name: string;
	panels: readonly CompactSwitcherPanelRow[];
}>;

/**
 * How many of a project's terminals are in each state, most urgent first.
 *
 * Counted from the state each terminal row presents, so a header can never say
 * something its own rows do not. `waiting` and `blocked` are one group because
 * they ask the same thing of a user.
 */
export type CompactSwitcherStatusSummary = Readonly<{
	attention: number;
	working: number;
	done: number;
	idle: number;
}>;

export type CompactSwitcherStatusGroup = keyof CompactSwitcherStatusSummary;

export type CompactSwitcherProjectGroup = Readonly<{
	color: string;
	emoji: string;
	/**
	 * The project's folders in order, each with its panels. Empty for a project
	 * whose folders this window does not know, such as one on a connection it
	 * is not working in; `panels` is then the whole list.
	 */
	folders: readonly CompactSwitcherFolderGroup[];
	key: string;
	/** Every panel of the project, in folder order. */
	panels: readonly CompactSwitcherPanelRow[];
	projectId: string;
	serverId: string;
	/** Every terminal of the project, whatever a filter has narrowed the rows to. */
	summary: CompactSwitcherStatusSummary;
	title: string;
}>;

export type CompactSwitcherConnectionGroup = Readonly<{
	projects: readonly CompactSwitcherProjectGroup[];
	serverId: string;
	serverLabel: string;
}>;

/** A folder as the switcher names it. */
export type CompactSwitcherFolderSource = Readonly<{
	id: string;
	name: string;
	/** True for the project's General folder, wherever it is in the order. */
	isGeneral?: boolean;
}>;

export type CompactSwitcherInput = Readonly<{
	/** Each project's folders in order, keyed by server and project. */
	foldersByProject?: Readonly<
		Record<string, readonly CompactSwitcherFolderSource[]>
	>;
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

export function summariseCompactSwitcherStates(
	panels: readonly Pick<CompactSwitcherPanelRow, 'panelKind' | 'state'>[],
): CompactSwitcherStatusSummary {
	const summary = { attention: 0, working: 0, done: 0, idle: 0 };
	for (const panel of panels) {
		// A file or a folder panel has no activity to report.
		if (panel.panelKind !== 'terminal') continue;
		if (panel.state === 'waiting' || panel.state === 'blocked')
			summary.attention += 1;
		else summary[panel.state] += 1;
	}
	return Object.freeze(summary);
}

const STATUS_GROUP_ORDER: readonly CompactSwitcherStatusGroup[] = [
	'attention',
	'working',
	'done',
	'idle',
];

/** How many groups a header has room for beside a project's name. */
export const COMPACT_SWITCHER_SUMMARY_MAX_GROUPS = 2;

const statusGroupText = (group: CompactSwitcherStatusGroup, count: number) => {
	if (group !== 'attention') return `${count} ${group}`;
	return count === 1 ? '1 needs you' : `${count} need you`;
};

/**
 * A summary as a header shows it and as it is read out.
 *
 * The header has room for the two most urgent groups; the accessible text
 * names every one, so nothing is known only to a sighted user. A project with
 * no terminal has nothing to say and says nothing.
 */
export function formatCompactSwitcherSummary(
	summary: CompactSwitcherStatusSummary,
): Readonly<{
	accessible: string;
	groups: readonly Readonly<{
		group: CompactSwitcherStatusGroup;
		text: string;
	}>[];
}> {
	const all = STATUS_GROUP_ORDER.filter((group) => summary[group] > 0).map(
		(group) =>
			Object.freeze({ group, text: statusGroupText(group, summary[group]) }),
	);
	return Object.freeze({
		accessible: all.map((entry) => entry.text).join(', '),
		groups: Object.freeze(all.slice(0, COMPACT_SWITCHER_SUMMARY_MAX_GROUPS)),
	});
}

export function buildCompactSwitcherGroups(
	input: CompactSwitcherInput,
): readonly CompactSwitcherConnectionGroup[] {
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
						const panels = Object.freeze(
							group.panels.map((panel) =>
								Object.freeze({
									...(panel.folderId === undefined
										? {}
										: { folderId: panel.folderId }),
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
						);
						return Object.freeze({
							color: group.project.color,
							emoji: group.project.emoji,
							folders: groupPanelsByFolder(
								source.serverId,
								input.foldersByProject?.[key] ?? [],
								panels,
							),
							key,
							projectId: group.project.projectId,
							serverId: source.serverId,
							panels,
							summary: summariseCompactSwitcherStates(panels),
							title: group.project.title,
						});
					}),
				),
				serverId: source.serverId,
				serverLabel: source.serverLabel,
			});
		}),
	);
}

/**
 * A project's panels under the folders that hold them.
 *
 * Every folder is listed, with or without panels, so a terminal in any folder
 * is reachable and an empty folder is still somewhere to open one. A panel
 * whose folder is unknown, or is not among the project's, is shown under
 * General rather than dropped: a row that cannot be reached is worse than one
 * under the wrong heading.
 */
function groupPanelsByFolder(
	serverId: string,
	folders: readonly CompactSwitcherFolderSource[],
	panels: readonly CompactSwitcherPanelRow[],
): readonly CompactSwitcherFolderGroup[] {
	const fallback = folders.find((folder) => folder.isGeneral) ?? folders[0];
	if (fallback === undefined) return Object.freeze([]);
	const known = new Set(folders.map((folder) => folder.id));
	const folderOf = (panel: CompactSwitcherPanelRow) =>
		panel.folderId !== undefined && known.has(panel.folderId)
			? panel.folderId
			: fallback.id;
	return Object.freeze(
		folders.map((folder) =>
			Object.freeze({
				folderId: folder.id,
				key: compositionTabKey(serverId, `folder:${folder.id}`),
				name: folder.name,
				panels: Object.freeze(
					panels.filter((panel) => folderOf(panel) === folder.id),
				),
			}),
		),
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
			// A folder's name asks for that folder, as a project's does for the
			// project; otherwise a folder stays only for the panels that match.
			const folders = project.folders.flatMap((folder) => {
				if (matches(folder.name, needle)) return [folder];
				const kept = folder.panels.filter((panel) =>
					matches(panel.title, needle),
				);
				return kept.length === 0
					? []
					: [Object.freeze({ ...folder, panels: Object.freeze(kept) })];
			});
			const panels =
				project.folders.length === 0
					? project.panels.filter((panel) => matches(panel.title, needle))
					: folders.flatMap((folder) => folder.panels);
			if (panels.length > 0 || folders.length > 0)
				projects.push(
					Object.freeze({
						...project,
						folders: Object.freeze(folders),
						panels: Object.freeze(panels),
					}),
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
