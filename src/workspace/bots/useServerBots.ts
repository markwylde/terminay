/**
 * Each attached server's bots, kept current.
 *
 * Bots are server-owned: this holds a read-through projection per connection
 * that serves `bots.v1`, never a copy that could drift. A `bots.changed` event
 * carries only a bot id and a revision, so every event is a cue to refetch
 * that bot's profile and recent sessions, which revalidate authority on each
 * request. One projection feeds the dashboard and every bot tab, so they can
 * never disagree.
 */

import {
	BOTS_CAPABILITY,
	BotEngineClient,
	BotEnvironmentClient,
	BotsClient,
	type TerminayClient,
	TerminayClientFacade,
} from '@terminay/client-core';
import type {
	BotProfile,
	BotSessionRecord,
	BotUpcomingFiring,
} from '@terminay/protocol';
import { useEffect, useRef, useState } from 'react';
import type { BotEntry, BotEnvironmentSummary } from './botsModel';

export type BotConnectionEntry = Readonly<{
	serverId: string;
	label: string;
	applicationClient?: TerminayClient;
	capabilities?: readonly string[];
}>;

/** An agent a server offers bots, as its Profile picker lists it. */
export type BotAgentState =
	| 'ready'
	| 'not-signed-in'
	| 'not-installed'
	| 'unavailable';

export type BotAgentOption = Readonly<{
	extensionId: string;
	extensionName: string;
	id: string;
	displayName: string;
	autonomousOnly: boolean;
	/** Whether the agent can resume its own sessions. */
	canLoad: boolean;
	signInMethods: readonly ('device' | 'token')[];
	models: readonly Readonly<{ id: string; displayName: string }>[];
	modelsAvailable: boolean;
	status: Readonly<{
		state: BotAgentState;
		detail?: string;
		action?: Readonly<{ label: string; kind: string }>;
	}>;
}>;

const AGENT_STATES: readonly BotAgentState[] = [
	'ready',
	'not-signed-in',
	'not-installed',
	'unavailable',
];

export type ServerBots = Readonly<{
	serverId: string;
	label: string;
	sourcesSupported?: boolean;
	client: BotsClient;
	environment: BotEnvironmentClient;
	/** The raw transport, for operation families this hook does not wrap. */
	transport: TerminayClientFacade;
	status: 'loading' | 'ready' | 'error';
	error?: string;
	warning?: string;
	reportWarning?: (warning: string) => void;
	revision: number;
	bots: readonly BotProfile[];
	/** Newest first, per bot id. */
	sessions: ReadonlyMap<string, readonly BotSessionRecord[]>;
	environments: ReadonlyMap<string, BotEnvironmentSummary>;
	/** The next few trigger firings per bot id, soonest first. */
	upcoming: ReadonlyMap<string, readonly BotUpcomingFiring[]>;
	agents: readonly BotAgentOption[];
	refresh: () => void;
	/** Refetch one bot's profile, sessions, and environment now. */
	refreshBot: (botId: string) => void;
	/**
	 * Start reading the agent list. Listing agents checks the container engine
	 * and asks each extension for its models, so it waits until a Bots view is
	 * open rather than running whenever Terminay starts.
	 */
	wantAgents: () => void;
	/** Re-read the agent list now (e.g. after starting an image build). */
	refreshAgents: () => void;
}>;

/** The sessions a card and the rail show; the Sessions tab pages its own. */
const RECENT_SESSIONS = 20;
const REFETCH_DELAY_MS = 120;
const UPCOMING_COUNT = 3;
const UPCOMING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function supportsBots(capabilities: readonly string[] | undefined) {
	return capabilities?.includes(BOTS_CAPABILITY) === true;
}

export function refusalText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.length > 0 ? message : 'The server refused the request.';
}

function environmentSummary(state: unknown): BotEnvironmentSummary {
	switch (state) {
		case 'not-created':
		case 'building':
		case 'running':
		case 'starting':
		case 'stopping':
		case 'stopped':
		case 'failed':
			return state;
		default:
			return 'unknown';
	}
}

function parseAgents(value: unknown): BotAgentOption[] {
	if (!Array.isArray(value)) return [];
	const agents: BotAgentOption[] = [];
	for (const raw of value) {
		if (typeof raw !== 'object' || raw === null) continue;
		const r = raw as Record<string, unknown>;
		if (typeof r.id !== 'string' || typeof r.displayName !== 'string') continue;
		const models = r.models as Record<string, unknown> | undefined;
		const list = Array.isArray(models?.value) ? models.value : [];
		const status = (r.status as Record<string, unknown> | undefined) ?? {};
		const statusValue =
			(status.value as Record<string, unknown> | undefined) ?? status;
		const extensionId = typeof r.extensionId === 'string' ? r.extensionId : '';
		const action = statusValue.action as Record<string, unknown> | undefined;
		agents.push({
			extensionId,
			extensionName:
				typeof r.extensionName === 'string' && r.extensionName.length > 0
					? r.extensionName
					: extensionId,
			id: r.id,
			displayName: r.displayName,
			autonomousOnly: r.autonomousOnly === true,
			canLoad: r.canLoad === true,
			signInMethods: Array.isArray(r.signInMethods)
				? r.signInMethods.filter(
						(m): m is 'device' | 'token' => m === 'device' || m === 'token',
					)
				: [],
			modelsAvailable: models?.available === true,
			models: list.flatMap((m) =>
				typeof m === 'object' &&
				m !== null &&
				typeof (m as Record<string, unknown>).id === 'string'
					? [
							{
								id: (m as { id: string }).id,
								displayName: String(
									(m as Record<string, unknown>).displayName ??
										(m as { id: string }).id,
								),
							},
						]
					: [],
			),
			status: {
				state: AGENT_STATES.includes(statusValue.state as BotAgentState)
					? (statusValue.state as BotAgentState)
					: 'unavailable',
				...(typeof statusValue.detail === 'string'
					? { detail: statusValue.detail }
					: {}),
				...(typeof action?.label === 'string'
					? { action: { label: action.label, kind: String(action.kind ?? '') } }
					: {}),
			},
		});
	}
	return agents;
}

type Controller = Readonly<{
	applicationClient: TerminayClient;
	dispose: () => void;
}>;

function startController(
	entry: BotConnectionEntry & { applicationClient: TerminayClient },
	publish: (serverId: string, next: ServerBots | undefined) => void,
): Controller {
	const transport = new TerminayClientFacade(entry.applicationClient);
	const client = new BotsClient(transport as never);
	const environment = new BotEnvironmentClient(transport);
	let disposed = false;
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	let current: ServerBots;
	const set = (patch: Partial<ServerBots>) => {
		if (disposed) return;
		current = Object.freeze({ ...current, ...patch });
		publish(entry.serverId, current);
	};
	const loadBot = async (botId: string) => {
		const now = Date.now();
		const [profile, sessions, overview, upcoming] = await Promise.allSettled([
			client.get(botId),
			client.sessions(botId),
			environment.state(botId),
			client.upcomingTriggers(botId, now, now + UPCOMING_WINDOW_MS, {
				limit: UPCOMING_COUNT,
			}),
		]);
		if (disposed) return;
		const bots = current.bots.filter((bot) => bot.id !== botId);
		if (profile.status === 'fulfilled') bots.push(profile.value);
		const sessionMap = new Map(current.sessions);
		const environmentMap = new Map(current.environments);
		const upcomingMap = new Map(current.upcoming);
		if (profile.status === 'rejected') {
			// Deleted, or no longer ours to see.
			sessionMap.delete(botId);
			environmentMap.delete(botId);
			upcomingMap.delete(botId);
		} else {
			if (upcoming.status === 'fulfilled')
				upcomingMap.set(botId, upcoming.value.firings);
			if (sessions.status === 'fulfilled')
				sessionMap.set(
					botId,
					[...sessions.value]
						.sort((a, b) => b.startedAt - a.startedAt)
						.slice(0, RECENT_SESSIONS),
				);
			// A failed read keeps the last known state, so views that depend on
			// it (the live desktop) do not unmount and reconnect.
			if (overview.status === 'fulfilled')
				environmentMap.set(botId, environmentSummary(overview.value));
			else if (!environmentMap.has(botId)) environmentMap.set(botId, 'unknown');
		}
		set({
			bots,
			sessions: sessionMap,
			environments: environmentMap,
			upcoming: upcomingMap,
		});
	};
	let agentsWanted = false;
	const loadAll = async () => {
		try {
			const [{ revision, bots }, agents] = await Promise.all([
				client.list(),
				agentsWanted
					? client
							.agents()
							.then(parseAgents)
							.catch(() => current.agents)
					: current.agents,
			]);
			set({
				revision,
				bots,
				agents,
				status: 'ready',
				error: undefined,
			});
			await Promise.all(bots.map((bot) => loadBot(bot.id)));
		} catch (error) {
			set({ status: 'error', error: refusalText(error) });
		}
	};
	const scheduleBot = (botId: string) => {
		if (timers.has(botId)) return;
		timers.set(
			botId,
			setTimeout(() => {
				timers.delete(botId);
				void loadBot(botId);
			}, REFETCH_DELAY_MS),
		);
	};
	current = Object.freeze({
		serverId: entry.serverId,
		sourcesSupported: entry.capabilities?.includes('bots.sources.v1') === true,
		label: entry.label,
		client,
		environment,
		transport,
		status: 'loading',
		revision: 0,
		bots: Object.freeze([]),
		sessions: new Map(),
		environments: new Map(),
		upcoming: new Map(),
		agents: Object.freeze([]),
		reportWarning: (warning) => set({ warning }),
		refresh: () => void loadAll(),
		refreshBot: (botId: string) => void loadBot(botId),
		refreshAgents: () => loadAgents(),
		wantAgents: () => {
			if (agentsWanted) return;
			agentsWanted = true;
			loadAgents();
		},
	});
	publish(entry.serverId, current);
	let unsubscribe: (() => void) | undefined;
	try {
		unsubscribe = client.watch(
			(event) => {
				if (event.revision > current.revision)
					set({ revision: event.revision });
				scheduleBot(event.botId);
			},
			() => void loadAll(),
		);
	} catch {
		// Without subscriptions the initial read still answers; the section
		// offers a refresh.
	}
	// An image build or an engine change moves agent statuses.
	let unsubscribeEngine: (() => void) | undefined;
	let buildPoll: ReturnType<typeof setTimeout> | undefined;
	const loadAgents = () => {
		if (!agentsWanted) return;
		void client
			.agents()
			.then((agents) => {
				const parsed = parseAgents(agents);
				set({ agents: parsed });
				// The image build has no change event of its own; poll until it ends.
				clearTimeout(buildPoll);
				if (
					!disposed &&
					parsed.some((a) => a.status.detail === 'Building image…')
				)
					buildPoll = setTimeout(loadAgents, 3000);
			})
			.catch(() => {});
	};
	try {
		unsubscribeEngine = new BotEngineClient(transport as never).watch(
			loadAgents,
			loadAgents,
		);
	} catch {
		// As above.
	}
	void loadAll();
	return Object.freeze({
		applicationClient: entry.applicationClient,
		dispose: () => {
			disposed = true;
			for (const timer of timers.values()) clearTimeout(timer);
			clearTimeout(buildPoll);
			unsubscribe?.();
			unsubscribeEngine?.();
		},
	});
}

/** Bots of every attached server that serves them, by server id. */
export function useServerBots(
	entries: readonly BotConnectionEntry[],
): ReadonlyMap<string, ServerBots> {
	const [byServer, setByServer] = useState<ReadonlyMap<string, ServerBots>>(
		() => new Map(),
	);
	const controllers = useRef(new Map<string, Controller>());

	useEffect(() => {
		const publish = (serverId: string, next: ServerBots | undefined) =>
			setByServer((previous) => {
				const map = new Map(previous);
				if (next === undefined) map.delete(serverId);
				else map.set(serverId, next);
				return map;
			});
		const wanted = new Set<string>();
		for (const entry of entries) {
			const { applicationClient } = entry;
			if (applicationClient === undefined || !supportsBots(entry.capabilities))
				continue;
			wanted.add(entry.serverId);
			const existing = controllers.current.get(entry.serverId);
			if (existing?.applicationClient === applicationClient) continue;
			existing?.dispose();
			controllers.current.set(
				entry.serverId,
				startController({ ...entry, applicationClient }, publish),
			);
		}
		for (const [serverId, controller] of controllers.current) {
			if (wanted.has(serverId)) continue;
			controller.dispose();
			controllers.current.delete(serverId);
			publish(serverId, undefined);
		}
	}, [entries]);

	useEffect(() => {
		const owned = controllers.current;
		return () => {
			for (const controller of owned.values()) controller.dispose();
			owned.clear();
		};
	}, []);

	return byServer;
}

/** Every bot across servers, as the dashboard lists them. */
export function botEntries(
	servers: ReadonlyMap<string, ServerBots>,
): BotEntry[] {
	const entries: BotEntry[] = [];
	for (const server of servers.values()) {
		for (const bot of server.bots) {
			const agent = server.agents.find((a) => a.id === bot.agentId);
			const next = server.upcoming.get(bot.id)?.[0];
			entries.push({
				serverId: server.serverId,
				serverLabel: server.label,
				bot,
				sessions: server.sessions.get(bot.id) ?? [],
				environment: server.environments.get(bot.id) ?? 'unknown',
				...(agent === undefined ? {} : { agentName: agent.displayName }),
				...(next === undefined
					? {}
					: { nextTrigger: { name: next.triggerName, at: next.at } }),
			});
		}
	}
	return entries;
}
