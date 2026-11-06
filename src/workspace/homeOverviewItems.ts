/**
 * The Home overview's listed items: what needs the user, workflows, pull
 * requests, bots, bot sessions, projects, and the run history.
 *
 * Like the counts in `homeOverviewModel.ts`, every item is derived from state
 * the window already holds, so a row here never disagrees with the surface it
 * points at. Every item is keyed by its server and its own id, so equal ids on
 * two servers never collide.
 */

import type {
	SessionWorkflow,
	WorkflowStep,
	WorkflowStepStatus,
} from '@terminay/client-core';
import type {
	BotProfile,
	BotSessionRecord,
	BotSessionState,
} from '@terminay/protocol';
import type {
	BotActivity,
	BotEntry,
	BotEnvironmentSummary,
} from './bots/botsModel.ts';
import { botActivity, sessionTitle } from './bots/botsModel.ts';
import type { DashboardServerSource } from './crossServerRows.ts';
import type { DashboardAgent, DashboardStatusCounts } from './dashboardRows.ts';
import { buildDashboardGroups } from './dashboardRows.ts';
import {
	tabSummary,
	type WorkflowTabSummary,
} from './workflows/workflowPanelModel.ts';
import type { WorkspaceInventoryEntry } from './workspaceInventory.ts';

export type HomeItemServer = Readonly<{
	serverId: string;
	/** Present only when more than one connection is attached. */
	serverLabel?: string;
}>;

// --- Projects ---------------------------------------------------------------

export type HomeProjectItem = HomeItemServer &
	Readonly<{
		key: string;
		projectId: string;
		title: string;
		color: string;
		emoji: string;
		counts: DashboardStatusCounts;
		/** Undefined when this window does not hold the project's panels. */
		tabs?: number;
		terminals?: number;
	}>;

// --- Needs you --------------------------------------------------------------

export type HomeAttentionItem =
	| (HomeItemServer &
			Readonly<{
				kind: 'agent';
				key: string;
				projectId: string;
				projectTitle: string;
				agent: DashboardAgent;
				since: number;
			}>)
	| (HomeItemServer &
			Readonly<{
				kind: 'bot';
				key: string;
				bot: BotProfile;
				sessionId: string;
				summary: string;
				since: number;
			}>)
	| (HomeItemServer &
			Readonly<{
				kind: 'workflow';
				key: string;
				workflow: HomeWorkflowItem;
				since: number;
			}>);

// --- Workflows --------------------------------------------------------------

export type HomeWorkflowRank = 'alert' | 'running' | 'unfinished' | 'finished';

export type HomeWorkflowItem = HomeItemServer &
	Readonly<{
		key: string;
		projectId: string;
		projectTitle: string;
		panelId: string;
		sessionId: string;
		terminalTitle: string;
		/** Undefined for a workflow that could not be restored. */
		name?: string;
		summary: WorkflowTabSummary;
		steps: readonly WorkflowStepStatus[];
		rank: HomeWorkflowRank;
		current?: Readonly<{ title: string; status: WorkflowStepStatus }>;
		/** Set only while the current step runs or needs the user. */
		currentStartedAt?: number;
		/** The latest step end, for a finished workflow. */
		finishedAt?: number;
		/** The first failed step's end, for ordering Needs you. */
		failedAt?: number;
	}>;

// --- Pull requests ----------------------------------------------------------

export type HomePullRequestItem = HomeItemServer &
	Readonly<{
		key: string;
		projectId: string;
		projectTitle: string;
		folderId: string;
		panelId: string;
		panelTitle: string;
		number: number;
		title: string;
		draft: boolean;
		checks?: Readonly<{
			failed: number;
			passed: number;
			pending: number;
			skipped: number;
			total: number;
		}>;
	}>;

// --- Bots -------------------------------------------------------------------

export type HomeBotItem = HomeItemServer &
	Readonly<{
		key: string;
		bot: BotProfile;
		activity: BotActivity;
		environment: BotEnvironmentSummary;
		needsYou: number;
		nextTrigger?: Readonly<{ name: string; at: number }>;
	}>;

export type HomeBotSessionItem = HomeItemServer &
	Readonly<{
		key: string;
		botId: string;
		botName: string;
		sessionId: string;
		title: string;
		state: BotSessionState;
		needsYou: boolean;
		startedAt: number;
	}>;

// ---------------------------------------------------------------------------

function server(
	serverId: string,
	serverLabel: string,
	nameServers: boolean,
): HomeItemServer {
	return nameServers ? { serverId, serverLabel } : { serverId };
}

export function buildProjectItems(
	sources: readonly (DashboardServerSource & {
		available: boolean;
		hasInventory: boolean;
	})[],
	nameServers: boolean,
): readonly HomeProjectItem[] {
	const items: HomeProjectItem[] = [];
	for (const source of sources) {
		if (!source.available) continue;
		const groups = buildDashboardGroups(
			source.projects,
			source.inventoryByProject,
			source.agentsByProject,
		);
		for (const group of groups) {
			const entries = source.inventoryByProject[group.project.projectId] ?? [];
			items.push(
				Object.freeze({
					...server(source.serverId, source.serverLabel, nameServers),
					key: `${source.serverId}:${group.project.projectId}`,
					projectId: group.project.projectId,
					title: group.project.title,
					color: group.project.color,
					emoji: group.project.emoji,
					counts: group.project.counts,
					...(source.hasInventory
						? {
								tabs: entries.length,
								terminals: entries.filter((entry) => entry.kind === 'terminal')
									.length,
							}
						: {}),
				}),
			);
		}
	}
	return Object.freeze(items);
}

/** Root agents in Needs you, with the project each runs in. */
export function needsYouAgents(
	sources: readonly (DashboardServerSource & { available: boolean })[],
	nameServers: boolean,
): HomeAttentionItem[] {
	const items: HomeAttentionItem[] = [];
	for (const source of sources) {
		if (!source.available) continue;
		const groups = buildDashboardGroups(
			source.projects,
			source.inventoryByProject,
			source.agentsByProject,
		);
		for (const group of groups) {
			const agents = [
				...group.panels.flatMap((panel) => panel.agents),
				...group.detachedAgents,
			];
			for (const agent of agents) {
				if (agent.external) continue;
				if (agent.state !== 'waiting' && agent.state !== 'blocked') continue;
				items.push(
					Object.freeze({
						...server(source.serverId, source.serverLabel, nameServers),
						kind: 'agent',
						key: `${source.serverId}:agent:${agent.entryId}`,
						projectId: group.project.projectId,
						projectTitle: group.project.title,
						agent,
						since: agent.stateStartedAt,
					}),
				);
			}
		}
	}
	return items;
}

function latestEnd(steps: readonly WorkflowStep[]): number | undefined {
	let latest: number | undefined;
	for (const step of steps)
		if (
			step.endedAt !== null &&
			(latest === undefined || step.endedAt > latest)
		)
			latest = step.endedAt;
	return latest;
}

/** The step a row names: active, else the first failed, else the first not done. */
function currentStep(steps: readonly WorkflowStep[]): WorkflowStep | undefined {
	return (
		steps.find(
			(step) => step.status === 'running' || step.status === 'needs_input',
		) ??
		steps.find((step) => step.status === 'failed') ??
		steps.find((step) => step.status !== 'done')
	);
}

const RANK_ORDER: Readonly<Record<HomeWorkflowRank, number>> = {
	alert: 0,
	running: 1,
	unfinished: 2,
	finished: 3,
};

/**
 * Workflows attached to running terminals of the server whose panels this
 * window holds, joined to their terminal by session id. A workflow whose
 * terminal is not in the inventory is not listed: it has no row to activate.
 */
export function buildWorkflowItems(
	serverId: string,
	serverLabel: string,
	nameServers: boolean,
	inventoryByProject: Readonly<
		Record<string, readonly WorkspaceInventoryEntry[]>
	>,
	workflows: readonly SessionWorkflow[],
	now: number,
): readonly HomeWorkflowItem[] {
	const bySession = new Map<string, WorkspaceInventoryEntry>();
	for (const entries of Object.values(inventoryByProject))
		for (const entry of entries)
			if (entry.sessionId !== undefined) bySession.set(entry.sessionId, entry);
	const items: HomeWorkflowItem[] = [];
	for (const view of workflows) {
		const entry = bySession.get(view.sessionId);
		if (entry === undefined) continue;
		const summary = tabSummary(view, now);
		if (summary === undefined) continue;
		const base = {
			...server(serverId, serverLabel, nameServers),
			key: `${serverId}:${view.sessionId}`,
			projectId: entry.projectId,
			projectTitle: entry.projectTitle,
			panelId: entry.panelId,
			sessionId: view.sessionId,
			terminalTitle: entry.title,
			summary,
		};
		if (view.state === 'unrestorable') {
			items.push(Object.freeze({ ...base, steps: [], rank: 'alert' }));
			continue;
		}
		const { steps } = view.workflow;
		const current = currentStep(steps);
		const finished = summary.completionKey !== undefined;
		const alert = steps.some(
			(step) => step.status === 'needs_input' || step.status === 'failed',
		);
		const running = steps.some((step) => step.status === 'running');
		const rank: HomeWorkflowRank = finished
			? 'finished'
			: alert
				? 'alert'
				: running
					? 'running'
					: 'unfinished';
		const active =
			current !== undefined &&
			(current.status === 'running' || current.status === 'needs_input') &&
			current.startedAt !== null;
		const firstFailed = steps.find((step) => step.status === 'failed');
		const finishedAt = finished ? latestEnd(steps) : undefined;
		items.push(
			Object.freeze({
				...base,
				name: view.workflow.name,
				steps: Object.freeze(steps.map((step) => step.status)),
				rank,
				...(current === undefined
					? {}
					: { current: { title: current.title, status: current.status } }),
				...(active ? { currentStartedAt: current.startedAt as number } : {}),
				...(finishedAt === undefined ? {} : { finishedAt }),
				...(firstFailed === undefined
					? {}
					: { failedAt: firstFailed.endedAt ?? firstFailed.startedAt ?? 0 }),
			}),
		);
	}
	items.sort(
		(left, right) =>
			RANK_ORDER[left.rank] - RANK_ORDER[right.rank] ||
			(left.rank === 'finished'
				? (right.finishedAt ?? 0) - (left.finishedAt ?? 0)
				: 0) ||
			left.key.localeCompare(right.key),
	);
	return Object.freeze(items);
}

/** Workflows that need the user, as Needs you lists them. */
export function needsYouWorkflows(workflows: readonly HomeWorkflowItem[]): {
	needsInput: HomeAttentionItem[];
	failed: HomeAttentionItem[];
} {
	const needsInput: HomeAttentionItem[] = [];
	const failed: HomeAttentionItem[] = [];
	for (const workflow of workflows) {
		const item = (since: number): HomeAttentionItem =>
			Object.freeze({
				serverId: workflow.serverId,
				...(workflow.serverLabel === undefined
					? {}
					: { serverLabel: workflow.serverLabel }),
				kind: 'workflow',
				key: `${workflow.key}:attention`,
				workflow,
				since,
			});
		if (workflow.current?.status === 'needs_input')
			needsInput.push(item(workflow.currentStartedAt ?? 0));
		else if (workflow.failedAt !== undefined)
			failed.push(item(workflow.failedAt));
	}
	return { needsInput, failed };
}

function waitsOnUser(session: BotSessionRecord): boolean {
	return session.state === 'needs-you' || session.permission !== null;
}

function toolTitle(toolCall: unknown): string | undefined {
	if (typeof toolCall !== 'object' || toolCall === null) return undefined;
	const title = (toolCall as Record<string, unknown>).title;
	return typeof title === 'string' && title.length > 0 ? title : undefined;
}

export function needsYouBotSessions(
	entries: readonly BotEntry[],
	nameServers: boolean,
): HomeAttentionItem[] {
	const items: HomeAttentionItem[] = [];
	for (const entry of entries) {
		for (const session of entry.sessions) {
			if (!waitsOnUser(session)) continue;
			const tool = toolTitle(session.permission?.toolCall);
			items.push(
				Object.freeze({
					...server(entry.serverId, entry.serverLabel, nameServers),
					kind: 'bot',
					key: `${entry.serverId}:bot-session:${session.id}`,
					bot: entry.bot,
					sessionId: session.id,
					summary:
						tool === undefined
							? 'Waiting for your decision'
							: `Wants to run: ${tool}`,
					since: session.startedAt,
				}),
			);
		}
	}
	return items;
}

/** Needs you: everything waiting on a decision, oldest first, then failures. */
export function buildAttention(
	agents: readonly HomeAttentionItem[],
	bots: readonly HomeAttentionItem[],
	workflows: { needsInput: HomeAttentionItem[]; failed: HomeAttentionItem[] },
): readonly HomeAttentionItem[] {
	const byAge = (left: HomeAttentionItem, right: HomeAttentionItem) =>
		left.since - right.since || left.key.localeCompare(right.key);
	return Object.freeze([
		...[...agents, ...bots, ...workflows.needsInput].sort(byAge),
		...[...workflows.failed].sort(byAge),
	]);
}

/**
 * One row per folder whose pull request is open or a draft, taking the
 * folder's first panel in inventory order. Failing checks first, then pending.
 */
export function buildPullRequestItems(
	serverId: string,
	serverLabel: string,
	nameServers: boolean,
	projects: readonly { id: string }[],
	inventoryByProject: Readonly<
		Record<string, readonly WorkspaceInventoryEntry[]>
	>,
): readonly HomePullRequestItem[] {
	const items: HomePullRequestItem[] = [];
	const seen = new Set<string>();
	for (const project of projects) {
		for (const entry of inventoryByProject[project.id] ?? []) {
			const pullRequest = entry.worktree?.pullRequest;
			if (pullRequest === undefined || entry.folderId === undefined) continue;
			if (pullRequest.state !== 'open' && pullRequest.state !== 'draft')
				continue;
			const folderKey = `${entry.projectId}:${entry.folderId}`;
			if (seen.has(folderKey)) continue;
			seen.add(folderKey);
			const checks = entry.worktree?.checks;
			items.push(
				Object.freeze({
					...server(serverId, serverLabel, nameServers),
					key: `${serverId}:${folderKey}`,
					projectId: entry.projectId,
					projectTitle: entry.projectTitle,
					folderId: entry.folderId,
					panelId: entry.panelId,
					panelTitle: entry.title,
					number: pullRequest.number,
					title: pullRequest.title,
					draft: pullRequest.state === 'draft',
					...(checks === undefined || checks.total === 0 ? {} : { checks }),
				}),
			);
		}
	}
	const weight = (item: HomePullRequestItem) =>
		(item.checks?.failed ?? 0) > 0
			? 0
			: (item.checks?.pending ?? 0) > 0
				? 1
				: 2;
	// A stable sort keeps the Tabs section's order within each group.
	return Object.freeze(
		[...items].sort((left, right) => weight(left) - weight(right)),
	);
}

export function buildBotItems(
	entries: readonly BotEntry[],
	nameServers: boolean,
): readonly HomeBotItem[] {
	const ACTIVITY_ORDER: Readonly<Record<BotActivity, number>> = {
		'needs-you': 0,
		working: 1,
		queued: 2,
		idle: 3,
		stopped: 4,
	};
	return Object.freeze(
		entries
			.map((entry) =>
				Object.freeze({
					...server(entry.serverId, entry.serverLabel, nameServers),
					key: `${entry.serverId}:${entry.bot.id}`,
					bot: entry.bot,
					activity: botActivity(entry.sessions, entry.environment),
					environment: entry.environment,
					needsYou: entry.sessions.filter(waitsOnUser).length,
					...(entry.nextTrigger === undefined
						? {}
						: { nextTrigger: entry.nextTrigger }),
				}),
			)
			.sort(
				(left, right) =>
					ACTIVITY_ORDER[left.activity] - ACTIVITY_ORDER[right.activity] ||
					left.bot.name.localeCompare(right.bot.name) ||
					left.key.localeCompare(right.key),
			),
	);
}

/** The soonest trigger firing across bots. */
export function nextBotTrigger(
	bots: readonly HomeBotItem[],
): (HomeBotItem & { nextTrigger: { name: string; at: number } }) | undefined {
	let soonest:
		| (HomeBotItem & { nextTrigger: { name: string; at: number } })
		| undefined;
	for (const bot of bots) {
		const next = bot.nextTrigger;
		if (next === undefined) continue;
		if (soonest === undefined || next.at < soonest.nextTrigger.at)
			soonest = { ...bot, nextTrigger: next };
	}
	return soonest;
}

export const DEFAULT_BOT_SESSION_LIMIT = 6;

export function buildBotSessionItems(
	entries: readonly BotEntry[],
	nameServers: boolean,
	limit = DEFAULT_BOT_SESSION_LIMIT,
): readonly HomeBotSessionItem[] {
	const items: HomeBotSessionItem[] = [];
	for (const entry of entries)
		for (const session of entry.sessions)
			items.push(
				Object.freeze({
					...server(entry.serverId, entry.serverLabel, nameServers),
					key: `${entry.serverId}:${session.id}`,
					botId: entry.bot.id,
					botName: entry.bot.name,
					sessionId: session.id,
					title: sessionTitle(session),
					state: session.state,
					needsYou: waitsOnUser(session),
					startedAt: session.startedAt,
				}),
			);
	items.sort(
		(left, right) =>
			right.startedAt - left.startedAt || left.key.localeCompare(right.key),
	);
	return Object.freeze(items.slice(0, Math.max(0, limit)));
}
