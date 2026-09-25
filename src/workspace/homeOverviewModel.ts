/**
 * The Home overview's model.
 *
 * Every number the overview shows is derived here from state the window
 * already holds — the panel inventory, the agent projection, the connection
 * list, remote access status, and each server's automations. Nothing is
 * aggregated on a server, so a count here can never disagree with the surface
 * it summarises: tabs are counted from the inventory the dashboard reads, and
 * agents from the same agent trees the dashboard builds.
 *
 * A connection that is not usable contributes nothing to a count and is named
 * as unavailable instead. Zero is a statement about the workspace; "we cannot
 * see that server right now" is a different one.
 */

import type { AgentState } from '../types/agentStatus';
import type { DashboardServerSource } from './crossServerRows.ts';
import { namesServers } from './crossServerRows.ts';
import type { DashboardAgent } from './dashboardRows.ts';
import { buildDashboardGroups } from './dashboardRows.ts';

/** One attached connection, as the overview sees it. */
export type HomeOverviewSource = DashboardServerSource &
	Readonly<{
		/** False when the connection is offline, reconnecting, or incompatible. */
		available: boolean;
		/**
		 * True for the server this window is working in: the only one whose
		 * panel inventory the window holds. Another server's tabs are known to
		 * exist, but not how many there are.
		 */
		hasInventory: boolean;
	}>;

/** Remote access status of the server the window is working in. */
export type HomeOverviewRemoteAccess = Readonly<{
	isRunning: boolean;
	connections: readonly Readonly<{ deviceId: string }>[];
	pairedDeviceCount: number;
}>;

export type HomeOverviewAutomation = Readonly<{
	automationId: string;
	name: string;
	enabled: boolean;
	/** Epoch ms of the next scheduled run; absent for an event trigger. */
	nextRunAt?: number;
}>;

export type HomeOverviewRunOutcome =
	| 'running'
	| 'success'
	| 'failure'
	| 'timed-out'
	| 'skipped'
	| 'cancelled';

export type HomeOverviewAutomationRun = Readonly<{
	runId: string;
	automationId: string;
	automationName: string;
	/** Epoch ms. */
	startedAt: number;
	outcome: HomeOverviewRunOutcome;
}>;

/** One server's automations. */
export type HomeOverviewAutomationSource = Readonly<{
	serverId: string;
	serverLabel: string;
	available: boolean;
	automations: readonly HomeOverviewAutomation[];
	runs: readonly HomeOverviewAutomationRun[];
}>;

export type HomeOverviewInput = Readonly<{
	sources: readonly HomeOverviewSource[];
	remoteAccess?: HomeOverviewRemoteAccess | null;
	/** Absent until automations are available to this window. */
	automationSources?: readonly HomeOverviewAutomationSource[];
	/** How many recent runs to list. */
	recentRunLimit?: number;
}>;

export type HomeOverviewServerRef = Readonly<{
	serverId: string;
	serverLabel: string;
	/** `offline`: the connection is not usable. `not-held`: the window does not
	 * hold this server's panels, so its tabs cannot be counted here. */
	reason: 'offline' | 'not-held';
}>;

/** A count over the connections that could answer, naming those that could not. */
export type HomeOverviewCount = Readonly<{
	value: number;
	unavailable: readonly HomeOverviewServerRef[];
}>;

export type HomeOverviewAgentGroup = 'needsYou' | 'working' | 'done' | 'idle';

export const HOME_OVERVIEW_AGENT_GROUPS: readonly HomeOverviewAgentGroup[] = [
	'needsYou',
	'working',
	'done',
	'idle',
];

export const HOME_OVERVIEW_AGENT_GROUP_LABELS: Record<
	HomeOverviewAgentGroup,
	string
> = {
	done: 'Done',
	idle: 'Idle',
	needsYou: 'Needs you',
	working: 'Working',
};

export function agentGroupFor(state: AgentState): HomeOverviewAgentGroup {
	switch (state) {
		case 'waiting':
		case 'blocked':
			return 'needsYou';
		case 'working':
			return 'working';
		case 'done':
			return 'done';
		default:
			return 'idle';
	}
}

export type HomeOverviewAgents = Readonly<
	Record<HomeOverviewAgentGroup, number> & {
		total: number;
		unavailable: readonly HomeOverviewServerRef[];
	}
>;

export type HomeOverviewDevices =
	| Readonly<{ state: 'unknown' }>
	| Readonly<{ state: 'off'; paired: number }>
	| Readonly<{ state: 'on'; connected: number; paired: number }>;

export type HomeOverviewConnections = Readonly<{
	attached: number;
	available: number;
	unavailable: readonly HomeOverviewServerRef[];
	devices: HomeOverviewDevices;
}>;

export type HomeOverviewActiveAutomation = Readonly<{
	serverId: string;
	/** Present only when more than one connection is attached. */
	serverLabel?: string;
	automationId: string;
	name: string;
	nextRunAt?: number;
}>;

export type HomeOverviewRecentRun = Readonly<{
	serverId: string;
	serverLabel?: string;
	runId: string;
	automationId: string;
	automationName: string;
	startedAt: number;
	outcome: HomeOverviewRunOutcome;
}>;

export type HomeOverviewAutomations = Readonly<{
	/** Enabled automations, soonest next run first, then by name. */
	active: readonly HomeOverviewActiveAutomation[];
	/** The soonest scheduled run among the active automations. */
	nextRun?: HomeOverviewActiveAutomation;
	/** Most recent first. */
	recentRuns: readonly HomeOverviewRecentRun[];
	/** Every automation, enabled or not, over the servers that answered. */
	total: number;
	unavailable: readonly HomeOverviewServerRef[];
	/** Nothing to list anywhere: the widget offers to create an automation. */
	isEmpty: boolean;
}>;

export type HomeOverview = Readonly<{
	projects: HomeOverviewCount;
	tabs: HomeOverviewCount;
	terminals: HomeOverviewCount;
	agents: HomeOverviewAgents;
	connections: HomeOverviewConnections;
	automations: HomeOverviewAutomations;
}>;

export const DEFAULT_RECENT_RUN_LIMIT = 5;

function ref(
	source: Readonly<{ serverId: string; serverLabel: string }>,
	reason: HomeOverviewServerRef['reason'],
): HomeOverviewServerRef {
	return Object.freeze({
		serverId: source.serverId,
		serverLabel: source.serverLabel,
		reason,
	});
}

/** Root agents in a server's projects, as the dashboard trees them. */
function rootAgents(source: HomeOverviewSource): readonly DashboardAgent[] {
	const groups = buildDashboardGroups(
		source.projects,
		source.inventoryByProject,
		source.agentsByProject,
	);
	return groups.flatMap((group) => [
		...group.panels.flatMap((panel) => panel.agents),
		...group.detachedAgents,
	]);
}

function countWorkspace(sources: readonly HomeOverviewSource[]) {
	const offline = sources
		.filter((source) => !source.available)
		.map((source) => ref(source, 'offline'));
	const notHeld = sources
		.filter((source) => source.available && !source.hasInventory)
		.map((source) => ref(source, 'not-held'));
	let projects = 0;
	let tabs = 0;
	let terminals = 0;
	const agents: Record<HomeOverviewAgentGroup, number> = {
		done: 0,
		idle: 0,
		needsYou: 0,
		working: 0,
	};
	for (const source of sources) {
		if (!source.available) continue;
		projects += source.projects.length;
		for (const agent of rootAgents(source)) {
			// An external agent runs outside Terminay: listed, never counted.
			if (agent.external) continue;
			agents[agentGroupFor(agent.state)] += 1;
		}
		if (!source.hasInventory) continue;
		for (const project of source.projects) {
			for (const entry of source.inventoryByProject[project.id] ?? []) {
				tabs += 1;
				if (entry.kind === 'terminal') terminals += 1;
			}
		}
	}
	const tabUnavailable = Object.freeze([...offline, ...notHeld]);
	return {
		projects: Object.freeze({ value: projects, unavailable: offline }),
		tabs: Object.freeze({ value: tabs, unavailable: tabUnavailable }),
		terminals: Object.freeze({ value: terminals, unavailable: tabUnavailable }),
		agents: Object.freeze({
			...agents,
			total: agents.needsYou + agents.working + agents.done + agents.idle,
			unavailable: offline,
		}),
	};
}

function describeDevices(
	remoteAccess: HomeOverviewRemoteAccess | null | undefined,
): HomeOverviewDevices {
	if (remoteAccess === null || remoteAccess === undefined)
		return Object.freeze({ state: 'unknown' });
	if (!remoteAccess.isRunning)
		return Object.freeze({
			state: 'off',
			paired: remoteAccess.pairedDeviceCount,
		});
	// A device holding two connections is still one device.
	const connected = new Set(
		remoteAccess.connections.map((connection) => connection.deviceId),
	).size;
	return Object.freeze({
		state: 'on',
		connected,
		paired: remoteAccess.pairedDeviceCount,
	});
}

function summarizeAutomations(
	automationSources: readonly HomeOverviewAutomationSource[],
	nameServers: boolean,
	recentRunLimit: number,
): HomeOverviewAutomations {
	const unavailable: HomeOverviewServerRef[] = [];
	const active: HomeOverviewActiveAutomation[] = [];
	const runs: HomeOverviewRecentRun[] = [];
	let total = 0;
	for (const source of automationSources) {
		if (!source.available) {
			unavailable.push(ref(source, 'offline'));
			continue;
		}
		const server = {
			serverId: source.serverId,
			...(nameServers ? { serverLabel: source.serverLabel } : {}),
		};
		total += source.automations.length;
		for (const automation of source.automations) {
			if (!automation.enabled) continue;
			active.push(
				Object.freeze({
					...server,
					automationId: automation.automationId,
					name: automation.name,
					...(automation.nextRunAt === undefined
						? {}
						: { nextRunAt: automation.nextRunAt }),
				}),
			);
		}
		for (const run of source.runs) {
			runs.push(
				Object.freeze({
					...server,
					runId: run.runId,
					automationId: run.automationId,
					automationName: run.automationName,
					startedAt: run.startedAt,
					outcome: run.outcome,
				}),
			);
		}
	}
	active.sort(
		(left, right) =>
			(left.nextRunAt ?? Number.POSITIVE_INFINITY) -
				(right.nextRunAt ?? Number.POSITIVE_INFINITY) ||
			left.name.localeCompare(right.name) ||
			left.serverId.localeCompare(right.serverId),
	);
	runs.sort(
		(left, right) =>
			right.startedAt - left.startedAt || left.runId.localeCompare(right.runId),
	);
	const nextRun = active.find(
		(automation) => automation.nextRunAt !== undefined,
	);
	return Object.freeze({
		active: Object.freeze(active),
		...(nextRun === undefined ? {} : { nextRun }),
		recentRuns: Object.freeze(runs.slice(0, Math.max(0, recentRunLimit))),
		total,
		unavailable: Object.freeze(unavailable),
		isEmpty: total === 0 && runs.length === 0 && unavailable.length === 0,
	});
}

export function buildHomeOverview(input: HomeOverviewInput): HomeOverview {
	const { sources } = input;
	const workspace = countWorkspace(sources);
	const offline = sources
		.filter((source) => !source.available)
		.map((source) => ref(source, 'offline'));
	const nameServers = namesServers([
		...sources,
		...(input.automationSources ?? []),
	]);
	return Object.freeze({
		...workspace,
		connections: Object.freeze({
			attached: sources.length,
			available: sources.length - offline.length,
			unavailable: Object.freeze(offline),
			devices: describeDevices(input.remoteAccess),
		}),
		automations: summarizeAutomations(
			input.automationSources ?? [],
			nameServers,
			input.recentRunLimit ?? DEFAULT_RECENT_RUN_LIMIT,
		),
	});
}
