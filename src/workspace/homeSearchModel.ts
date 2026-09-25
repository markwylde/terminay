/**
 * Home's search: one box that finds anything Home can take you to.
 *
 * It searches the same model the Tabs section shows — every project, tab, and
 * agent of every attached server — plus Home's own sections and each server's
 * automations. A result is a place to go, never a filter: choosing one leaves
 * the search and opens that thing.
 *
 * Matching is case-insensitive substring matching, as the dashboard filter's
 * is, so a word that finds a row in Tabs finds it here too. A match at the start
 * of the name, or of a word in it, ranks above one in the middle.
 */

import type { ServerScopedRow } from './crossServerRows.ts';
import type {
	DashboardAgent,
	DashboardPanelRow,
	DashboardProjectGroup,
	DashboardProjectRow,
} from './dashboardRows.ts';
import {
	HOME_SECTION_LABELS,
	HOME_SECTIONS,
	type HomeSection,
} from './homeSection.ts';

/** One automation, as the search needs it. */
export type HomeSearchAutomation = Readonly<{
	serverId: string;
	id: string;
	name: string;
	/** The trigger in words, e.g. "Every hour, on the hour". */
	detail: string;
}>;

export type HomeSearchResult =
	| Readonly<{ kind: 'section'; key: string; section: HomeSection; title: string }>
	| Readonly<{
			kind: 'project';
			key: string;
			serverId: string;
			row: DashboardProjectRow;
			title: string;
			detail?: string;
	  }>
	| Readonly<{
			kind: 'panel';
			key: string;
			serverId: string;
			row: DashboardPanelRow;
			title: string;
			detail: string;
	  }>
	| Readonly<{
			kind: 'agent';
			key: string;
			serverId: string;
			projectId: string;
			agent: DashboardAgent;
			title: string;
			detail: string;
	  }>
	| Readonly<{
			kind: 'automation';
			key: string;
			serverId: string;
			automationId: string;
			title: string;
			detail: string;
	  }>;

export type HomeSearchResultKind = HomeSearchResult['kind'];

export const HOME_SEARCH_KIND_LABELS: Readonly<
	Record<HomeSearchResultKind, string>
> = {
	section: 'Home',
	project: 'Projects',
	panel: 'Tabs',
	agent: 'Agents',
	automation: 'Automations',
};

/** The order result groups are listed in. */
export const HOME_SEARCH_KIND_ORDER: readonly HomeSearchResultKind[] = [
	'section',
	'project',
	'panel',
	'agent',
	'automation',
];

/** Most results shown per group, so one busy kind cannot bury the others. */
export const HOME_SEARCH_GROUP_LIMIT = 6;

/**
 * How well `text` matches `needle`: 0 for a match at the very start, 1 at the
 * start of a word, 2 anywhere else, undefined for no match.
 */
export function matchRank(
	text: string | undefined,
	needle: string,
): number | undefined {
	if (text === undefined || needle.length === 0) return undefined;
	const haystack = text.toLowerCase();
	const at = haystack.indexOf(needle);
	if (at === -1) return undefined;
	if (at === 0) return 0;
	return /[\s\-_./:·]/.test(haystack.charAt(at - 1)) ? 1 : 2;
}

function best(...ranks: readonly (number | undefined)[]): number | undefined {
	let result: number | undefined;
	for (const rank of ranks)
		if (rank !== undefined && (result === undefined || rank < result))
			result = rank;
	return result;
}

function collectAgents(
	agents: readonly DashboardAgent[],
	into: DashboardAgent[],
): void {
	for (const agent of agents) {
		into.push(agent);
		collectAgents(agent.subagents, into);
	}
}

/**
 * The results for `query`, grouped in `HOME_SEARCH_KIND_ORDER`, best match
 * first within a group, at most `HOME_SEARCH_GROUP_LIMIT` per group. An empty
 * or whitespace-only query has no results.
 */
export function searchHome(
	groups: readonly ServerScopedRow<DashboardProjectGroup>[],
	automations: readonly HomeSearchAutomation[],
	query: string,
): readonly HomeSearchResult[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return [];
	const ranked: { result: HomeSearchResult; rank: number; order: number }[] =
		[];
	let order = 0;
	const add = (result: HomeSearchResult, rank: number | undefined) => {
		if (rank !== undefined) ranked.push({ result, rank, order: order++ });
	};

	for (const section of HOME_SECTIONS) {
		const title = HOME_SECTION_LABELS[section];
		add(
			{ kind: 'section', key: `section:${section}`, section, title },
			matchRank(title, needle),
		);
	}

	for (const { key, row: group, serverId, serverLabel } of groups) {
		const project = group.project;
		add(
			{
				kind: 'project',
				key: `project:${key}`,
				serverId,
				row: project,
				title: project.title,
				...(serverLabel === undefined ? {} : { detail: serverLabel }),
			},
			matchRank(project.title, needle),
		);
		for (const panel of group.panels) {
			add(
				{
					kind: 'panel',
					key: `panel:${serverId}:${panel.panelId}`,
					serverId,
					row: panel,
					title: panel.title,
					detail: project.title,
				},
				matchRank(panel.title, needle),
			);
			const agents: DashboardAgent[] = [];
			collectAgents(panel.agents, agents);
			for (const agent of agents)
				add(
					{
						kind: 'agent',
						key: `agent:${serverId}:${agent.entryId}`,
						serverId,
						projectId: panel.projectId,
						agent,
						title: agent.name,
						detail: `${project.title} · ${panel.title}`,
					},
					best(
						matchRank(agent.name, needle),
						matchRank(agent.provider, needle),
						matchRank(agent.prompt, needle),
					),
				);
		}
		const detached: DashboardAgent[] = [];
		collectAgents(group.detachedAgents, detached);
		for (const agent of detached)
			add(
				{
					kind: 'agent',
					key: `agent:${serverId}:${agent.entryId}`,
					serverId,
					projectId: project.projectId,
					agent,
					title: agent.name,
					detail: project.title,
				},
				best(
					matchRank(agent.name, needle),
					matchRank(agent.provider, needle),
					matchRank(agent.prompt, needle),
				),
			);
	}

	for (const automation of automations)
		add(
			{
				kind: 'automation',
				key: `automation:${automation.serverId}:${automation.id}`,
				serverId: automation.serverId,
				automationId: automation.id,
				title: automation.name,
				detail: automation.detail,
			},
			best(
				matchRank(automation.name, needle),
				matchRank(automation.detail, needle),
			),
		);

	const results: HomeSearchResult[] = [];
	for (const kind of HOME_SEARCH_KIND_ORDER) {
		const ofKind = ranked
			.filter((entry) => entry.result.kind === kind)
			.sort((left, right) => left.rank - right.rank || left.order - right.order)
			.slice(0, HOME_SEARCH_GROUP_LIMIT);
		for (const entry of ofKind) results.push(entry.result);
	}
	return results;
}
