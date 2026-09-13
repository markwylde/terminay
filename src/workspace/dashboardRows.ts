/**
 * The dashboard's model.
 *
 * One group per project, holding its panels, and — for a terminal under agent
 * authority — the agents running in them. Composition is a pure function of the
 * ordered project list, the published inventory, and the agent projection, so
 * the views can stay renderers: what the dashboard shows is decided here and
 * asserted here.
 *
 * The three views are three arrangements of this one model, never three sets of
 * facts. The List view's flat rows are derived from the groups rather than
 * built alongside them, so a card and a row have nothing to disagree from.
 */

import {
	agentModelLabel,
	resolveAgentPresentation,
} from '../agents/agentPresentation.ts';
import type { AgentState, AgentStatusEntry } from '../types/agentStatus';
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

/**
 * One agent, named by the rule every surface names agents by.
 *
 * A subagent is never here at top level: it sits in its root's `subagents`, and
 * is counted on the root. A root's card says "3 subagents"; it does not spill
 * three more cards into a column.
 */
export type DashboardAgent = {
	/** The terminal the agent was started in — how a card finds its panel. */
	activationTerminalSessionId: string;
	activeToolName?: string;
	entryId: string;
	/** Provider · model, with anything the name already said left out. */
	metadata?: string;
	model?: string;
	name: string;
	prompt?: string;
	provider: string;
	state: AgentState;
	/** When the agent entered its current state, for "waiting for 4m". */
	stateStartedAt: number;
	subagents: readonly DashboardAgent[];
	/** Every descendant, not only the immediate children. */
	subagentCount: number;
	unread: boolean;
	waitingReason?: string;
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
	/** Root agents running in this panel, most urgent first. */
	agents: readonly DashboardAgent[];
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

/**
 * A project and everything under it.
 *
 * `detachedAgents` are the agents of a server whose panels this window does not
 * hold. That server publishes an agent projection but no panel inventory here,
 * so the dashboard can say the agent exists and which project it is in — which
 * is all that is true across a server boundary.
 */
export type DashboardProjectGroup = {
	detachedAgents: readonly DashboardAgent[];
	panels: readonly DashboardPanelRow[];
	project: DashboardProjectRow;
};

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

/** Most urgent first, then most recently changed. The sidebar's order. */
const STATE_PRIORITY: Record<AgentState, number> = {
	blocked: 0,
	waiting: 1,
	working: 2,
	done: 3,
	idle: 4,
};

function byUrgency(left: AgentStatusEntry, right: AgentStatusEntry): number {
	return (
		STATE_PRIORITY[left.state] - STATE_PRIORITY[right.state] ||
		right.updatedAt - left.updatedAt ||
		left.entryId.localeCompare(right.entryId)
	);
}

function toDashboardAgent(
	entry: AgentStatusEntry,
	children: readonly DashboardAgent[],
	terminalTitle: string | undefined,
	siblingIndex: number,
	parent: AgentStatusEntry | undefined,
): DashboardAgent {
	const model = agentModelLabel(entry);
	const presentation = resolveAgentPresentation(
		entry,
		{
			...(model === undefined ? {} : { model }),
			...(entry.promptText === undefined ? {} : { prompt: entry.promptText }),
			...(terminalTitle === undefined ? {} : { terminalTitle }),
		},
		{
			siblingIndex,
			...(parent === undefined
				? {}
				: {
						parentProvider: parent.provider,
						...(agentModelLabel(parent) === undefined
							? {}
							: { parentModel: agentModelLabel(parent) }),
					}),
		},
	);
	const activeTool = entry.activeTools.at(-1);
	return {
		activationTerminalSessionId: entry.activationTerminalSessionId,
		entryId: entry.entryId,
		name: presentation.name,
		provider: presentation.provider,
		state: entry.state,
		stateStartedAt: entry.stateStartedAt,
		subagents: children,
		subagentCount: children.reduce(
			(total, child) => total + 1 + child.subagentCount,
			0,
		),
		unread: entry.unread,
		...(presentation.metadata === undefined
			? {}
			: { metadata: presentation.metadata }),
		...(model === undefined ? {} : { model }),
		...(presentation.prompt === undefined
			? {}
			: { prompt: presentation.prompt }),
		...(entry.waitingReason === undefined
			? {}
			: { waitingReason: entry.waitingReason }),
		...(activeTool === undefined ? {} : { activeToolName: activeTool.name }),
	};
}

/**
 * Roots with their subagents nested underneath, by `parentEntryId`.
 *
 * A subagent whose root is not in this set — its root ended, or belongs to
 * another project — is promoted rather than dropped: an agent that is running
 * is worth showing even when its parentage cannot be drawn.
 */
function buildAgentTree(
	entries: readonly AgentStatusEntry[],
	terminalTitleFor: (entry: AgentStatusEntry) => string | undefined,
): readonly DashboardAgent[] {
	const byId = new Map(entries.map((entry) => [entry.entryId, entry]));
	const childrenByParent = new Map<string, AgentStatusEntry[]>();
	const roots: AgentStatusEntry[] = [];
	for (const entry of entries) {
		if (entry.kind === 'subagent' && byId.has(entry.parentEntryId)) {
			const bucket = childrenByParent.get(entry.parentEntryId) ?? [];
			bucket.push(entry);
			childrenByParent.set(entry.parentEntryId, bucket);
			continue;
		}
		roots.push(entry);
	}

	const build = (
		entry: AgentStatusEntry,
		siblingIndex: number,
		parent: AgentStatusEntry | undefined,
	): DashboardAgent => {
		const children = [...(childrenByParent.get(entry.entryId) ?? [])]
			.sort(byUrgency)
			.map((child, index) => build(child, index, entry));
		return toDashboardAgent(
			entry,
			children,
			terminalTitleFor(entry),
			siblingIndex,
			parent,
		);
	};

	return [...roots]
		.sort(byUrgency)
		.map((entry, index) => build(entry, index, undefined));
}

function countStatuses(
	entries: readonly WorkspaceInventoryEntry[],
	detachedAgents: readonly DashboardAgent[],
): DashboardStatusCounts {
	const counts: DashboardStatusCounts = {
		attention: 0,
		done: 0,
		panels: entries.length,
		working: 0,
	};
	// A panel and the agent inside it are one thing to attend to, so a panel is
	// counted once by its own canonical status — which is already its agent's
	// state when an agent owns it. Only an agent with no panel here adds a count
	// of its own.
	const statuses = [
		...entries.map((entry) => dashboardStatusFor(entry.status)),
		...detachedAgents.map((agent) => agent.state),
	];
	for (const status of statuses) {
		if (status === 'waiting' || status === 'blocked') counts.attention += 1;
		else if (status === 'working') counts.working += 1;
		else if (status === 'done') counts.done += 1;
	}
	return counts;
}

/**
 * Every project in project order, each holding its panels in panel order and
 * the agents running in them. A project with no panels still gets its group:
 * the dashboard says what exists, not only what is busy.
 */
export function buildDashboardGroups(
	projects: readonly DashboardProjectSource[],
	inventoryByProject: Readonly<Record<string, WorkspaceInventoryEntry[]>>,
	agentsByProject: Readonly<
		Record<string, readonly AgentStatusEntry[]>
	> = {},
): readonly DashboardProjectGroup[] {
	return projects.map((project) => {
		const entries = inventoryByProject[project.id] ?? [];
		const agents = agentsByProject[project.id] ?? [];
		// An agent joins a panel on the terminal it was activated in — the same
		// join that decides a tab is under agent authority, so a panel reading as
		// an agent state is exactly the panel that gets agent detail.
		const panelTitleBySession = new Map(
			entries
				.filter((entry) => entry.sessionId !== undefined)
				.map((entry) => [entry.sessionId as string, entry.title]),
		);
		const terminalTitleFor = (entry: AgentStatusEntry) =>
			panelTitleBySession.get(entry.activationTerminalSessionId);
		const agentsBySession = new Map<string, AgentStatusEntry[]>();
		const detached: AgentStatusEntry[] = [];
		for (const agent of agents) {
			const sessionId = agent.activationTerminalSessionId;
			if (!panelTitleBySession.has(sessionId)) {
				detached.push(agent);
				continue;
			}
			const bucket = agentsBySession.get(sessionId) ?? [];
			bucket.push(agent);
			agentsBySession.set(sessionId, bucket);
		}

		const panels = entries.map((entry): DashboardPanelRow => {
			const panelAgents =
				entry.sessionId === undefined
					? []
					: buildAgentTree(
							agentsBySession.get(entry.sessionId) ?? [],
							terminalTitleFor,
						);
			return {
				agents: panelAgents,
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
			};
		});
		const detachedAgents = buildAgentTree(detached, terminalTitleFor);

		return {
			detachedAgents,
			panels,
			project: {
				color: project.color,
				counts: countStatuses(entries, detachedAgents),
				emoji: project.emoji,
				kind: 'project',
				projectId: project.id,
				title: project.title,
			},
		};
	});
}

/** The List view: each project's header row, then its panels, in order. */
export function flattenDashboardGroups(
	groups: readonly DashboardProjectGroup[],
): DashboardRow[] {
	const rows: DashboardRow[] = [];
	for (const group of groups) {
		rows.push(group.project);
		rows.push(...group.panels);
	}
	return rows;
}

export function buildDashboardRows(
	projects: readonly DashboardProjectSource[],
	inventoryByProject: Readonly<Record<string, WorkspaceInventoryEntry[]>>,
	agentsByProject?: Readonly<Record<string, readonly AgentStatusEntry[]>>,
): DashboardRow[] {
	return flattenDashboardGroups(
		buildDashboardGroups(projects, inventoryByProject, agentsByProject),
	);
}

export type DashboardSummary = {
	attention: number;
	done: number;
	idle: number;
	projects: number;
	working: number;
};

/**
 * The whole workspace in five numbers, over every attached connection.
 *
 * Counted in the same unit the project roll-up counts in, so the summary and
 * the roll-ups can only ever add up.
 */
export function summarizeDashboard(
	groups: readonly DashboardProjectGroup[],
): DashboardSummary {
	const summary: DashboardSummary = {
		attention: 0,
		done: 0,
		idle: 0,
		projects: groups.length,
		working: 0,
	};
	for (const group of groups) {
		const { attention, done, panels, working } = group.project.counts;
		summary.attention += attention;
		summary.done += done;
		summary.working += working;
		summary.idle +=
			panels + group.detachedAgents.length - attention - done - working;
	}
	return summary;
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

/**
 * Activating an agent is activating the panel it runs in. An agent with no
 * panel in this window is a place to go rather than a panel to focus, so it
 * resolves to its project.
 */
export function resolveAgentActivation(
	agent: DashboardAgent,
	projectId: string,
	projects: readonly DashboardProjectSource[],
	inventoryByProject: Readonly<Record<string, WorkspaceInventoryEntry[]>>,
): DashboardActivation {
	if (!projects.some((project) => project.id === projectId))
		return { kind: 'stale' };
	const entry = (inventoryByProject[projectId] ?? []).find(
		(candidate) =>
			candidate.sessionId === agent.activationTerminalSessionId,
	);
	if (entry?.sessionId === undefined) return { kind: 'project', projectId };
	return {
		kind: 'panel',
		panelId: entry.panelId,
		projectId,
		sessionId: entry.sessionId,
	};
}
