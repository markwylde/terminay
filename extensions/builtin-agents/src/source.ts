import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import type {
	AgentsError,
	AllYourAgentsInstance,
	EventMeta,
	InstanceOptions,
	Provider,
	Session,
	Subagent,
} from '@markwylde/all-your-agents';
import AllYourAgents, {
	claudeCode,
	codexCli,
	grokBuild,
	ohMyPi,
} from '@markwylde/all-your-agents';
import type {
	AgentSessionPublisher,
	AgentSessionSnapshot,
	AgentSessionSourceRuntime,
	AgentSubagentSnapshot,
} from '@terminay/extension-api';
import {
	boundedAgentText,
	defineSessionSource,
	EXTENSION_LIMITS,
} from '@terminay/extension-api';

export type HarnessDefinition = Readonly<{
	id: string;
	displayName: string;
	createProvider(): Provider;
}>;

/** The declared harnesses, each backed by exactly one library provider. */
export const HARNESSES: readonly HarnessDefinition[] = [
	{
		id: 'claude-code',
		displayName: 'Claude Code',
		createProvider: () => claudeCode(),
	},
	{ id: 'codex', displayName: 'Codex', createProvider: () => codexCli() },
	{ id: 'grok', displayName: 'Grok', createProvider: () => grokBuild() },
	{ id: 'oh-my-pi', displayName: 'oh-my-pi', createProvider: () => ohMyPi() },
];

export type SessionSourceOptions = {
	harnesses?: readonly HarnessDefinition[];
	/** Passed to the library as-is, except `providers`, which the enabled harnesses decide. */
	instanceOptions?: Omit<InstanceOptions, 'providers'>;
	/** Whether the library's native process-exit watch can load. */
	processWatchAvailable?: () => boolean;
};

type Tracked = {
	session: Session;
	harness: string;
	subagents: Map<string, AgentSubagentSnapshot>;
};

/**
 * Reports every live session the library sees on this machine. All detection,
 * status, titles, and subagents come from the library; this adapter only
 * bounds what crosses to the host and restarts the library when the set of
 * enabled harnesses changes.
 */
export function createSessionSource(
	options: SessionSourceOptions = {},
): AgentSessionSourceRuntime {
	const harnesses = options.harnesses ?? HARNESSES;
	const processWatchAvailable =
		options.processWatchAvailable ?? libraryProcessWatchAvailable;

	return defineSessionSource({
		async start({
			enabledHarnesses,
			publisher,
			signal,
			onEnabledHarnessesChanged,
		}) {
			if (!processWatchAvailable()) {
				publisher.diagnostic({
					code: 'process-watch-degraded',
					message:
						'Native process-exit watching is unavailable; closed agents are noticed on their next file change.',
				});
			}

			let running: Running | undefined;
			// Restarts run one at a time, in the order the switches changed.
			let queue: Promise<void> = Promise.resolve();
			const restart = (enabled: readonly string[]): Promise<void> => {
				queue = queue.then(async () => {
					await running?.stop();
					running = undefined;
					if (signal.aborted) return;
					const selected = harnesses.filter((harness) =>
						enabled.includes(harness.id),
					);
					if (selected.length === 0) {
						publisher.reset([]);
						return;
					}
					running = await run(
						selected,
						publisher,
						options.instanceOptions,
						signal,
					);
				});
				return queue;
			};

			const subscription = onEnabledHarnessesChanged((next) => {
				void restart(next);
			});
			signal.addEventListener(
				'abort',
				() => {
					void subscription.dispose();
					void restart([]);
				},
				{ once: true },
			);
			await restart(enabledHarnesses);
		},
	});
}

type Running = { stop(): Promise<void> };

async function run(
	selected: readonly HarnessDefinition[],
	publisher: AgentSessionPublisher,
	instanceOptions: SessionSourceOptions['instanceOptions'],
	signal: AbortSignal,
): Promise<Running> {
	const providers = selected.map((harness) => ({
		harness: harness.id,
		provider: harness.createProvider(),
	}));
	const harnessByProvider = new Map(
		providers.map(({ harness, provider }) => [provider.id, harness]),
	);
	const aya: AllYourAgentsInstance = AllYourAgents({
		...instanceOptions,
		providers: providers.map(({ provider }) => provider),
	});
	const tracked = new Map<string, Tracked>();
	// Ids the host currently holds, so a removal is sent only for a session it knows.
	const published = new Set<string>();
	let ready = false;
	let stopped = false;
	const active = (): boolean => ready && !stopped && !signal.aborted;

	const publish = (entry: Tracked): void => {
		if (!active()) return;
		const snapshot = toSnapshot(entry);
		if (snapshot) {
			published.add(snapshot.id);
			publisher.upsert(snapshot);
		} else if (published.delete(entry.session.id)) {
			publisher.remove(entry.session.id);
		}
	};

	const track = (session: Session): Tracked | undefined => {
		const harness = harnessByProvider.get(session.provider);
		if (harness === undefined) return undefined;
		const existing = tracked.get(session.id);
		if (existing) {
			existing.session = session;
			return existing;
		}
		const entry: Tracked = { session, harness, subagents: new Map() };
		tracked.set(session.id, entry);
		return entry;
	};

	const upsert = (session: Session): void => {
		const entry = track(session);
		if (entry) publish(entry);
	};

	const onSession = (session: Session, _meta: EventMeta): void =>
		upsert(session);
	aya.on('session:create', onSession);
	aya.on('session:open', onSession);
	aya.on('session:status', onSession);
	aya.on('session:update', onSession);
	aya.on('session:activity', onSession);
	aya.on('session:close', (session: Session) => {
		tracked.delete(session.id);
		if (active() && published.delete(session.id)) publisher.remove(session.id);
	});
	const onSubagent = (subagent: Subagent, session: Session): void => {
		const entry = track(session);
		if (!entry) return;
		entry.subagents.set(subagent.id, toSubagent(subagent));
		publish(entry);
	};
	aya.on('subagent:start', onSubagent);
	aya.on('subagent:end', onSubagent);
	aya.on('ready', () => {
		if (stopped || signal.aborted) return;
		ready = true;
		const sessions: AgentSessionSnapshot[] = [];
		for (const entry of tracked.values()) {
			const snapshot = toSnapshot(entry);
			if (snapshot) sessions.push(snapshot);
		}
		const reset = sessions.slice(0, EXTENSION_LIMITS.agentSessionsPerReset);
		for (const snapshot of reset) published.add(snapshot.id);
		publisher.reset(reset);
	});
	aya.on('error', (error: AgentsError) => {
		if (stopped || signal.aborted) return;
		// Provider and listener failures carry paths and conversation text; only their kind crosses.
		publisher.diagnostic(
			error.source === 'provider'
				? {
						code: 'provider-error',
						message: `The ${error.provider} provider failed.`,
					}
				: {
						code: 'listener-error',
						message: `Handling ${error.event} failed.`,
					},
		);
	});

	await aya.start();
	return {
		async stop() {
			stopped = true;
			tracked.clear();
			await aya.stop();
		},
	};
}

/** Only live sessions with a usable id and absolute cwd cross to the host. */
function toSnapshot({
	session,
	harness,
	subagents,
}: Tracked): AgentSessionSnapshot | undefined {
	const { pid, cwd, id } = session;
	if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0)
		return undefined;
	if (id.length === 0 || id.length > EXTENSION_LIMITS.agentSessionIdLength)
		return undefined;
	if (
		cwd === undefined ||
		!isAbsolute(cwd) ||
		cwd.length > EXTENSION_LIMITS.agentPathLength
	)
		return undefined;

	const snapshot: AgentSessionSnapshot = { id, harness, pid, cwd };
	const title = boundedAgentText(
		session.title?.trim(),
		EXTENSION_LIMITS.agentTitleLength,
	);
	if (title) snapshot.title = title;
	const model = boundedAgentText(
		session.model,
		EXTENSION_LIMITS.agentModelLength,
	);
	if (model) snapshot.model = model;
	// The library also reports `waiting` for an ended turn whose background
	// shell or monitor will wake the session. Nothing is asked of the user
	// there, so it crosses as `running`.
	const backgroundWait =
		session.status === 'waiting' &&
		(session.waitingFor === 'shell' || session.waitingFor === 'monitor');
	if (session.status)
		snapshot.status = backgroundWait ? 'running' : session.status;
	const waitingFor = boundedAgentText(
		backgroundWait ? undefined : session.waitingFor,
		EXTENSION_LIMITS.agentWaitingForLength,
	);
	if (waitingFor) snapshot.waitingFor = waitingFor;
	const tool = boundedAgentText(
		session.activity.tool?.name,
		EXTENSION_LIMITS.agentToolNameLength,
	);
	if (tool) snapshot.tool = tool;
	if (session.activity.lastTurn) snapshot.lastTurn = session.activity.lastTurn;
	if (session.activity.lastTurnEndedAt !== undefined)
		snapshot.lastTurnEndedAt = session.activity.lastTurnEndedAt;
	const error = boundedAgentText(
		session.activity.error,
		EXTENSION_LIMITS.agentErrorLength,
	);
	if (error) snapshot.error = error;
	if (subagents.size > 0) snapshot.subagents = boundedSubagents(subagents);
	return snapshot;
}

/** Keep running subagents first, then the most recently seen finished ones. */
function boundedSubagents(
	subagents: Map<string, AgentSubagentSnapshot>,
): AgentSubagentSnapshot[] {
	const all = [...subagents.values()];
	const running = all.filter((subagent) => subagent.status === 'running');
	const finished = all
		.filter((subagent) => subagent.status !== 'running')
		.reverse();
	const kept = [...running, ...finished].slice(
		0,
		EXTENSION_LIMITS.agentSubagents,
	);
	const ids = new Set(kept.map((subagent) => subagent.id));
	// A parent that did not fit is dropped from the child rather than dangling.
	return kept.map((subagent) =>
		subagent.parentId === undefined || ids.has(subagent.parentId)
			? subagent
			: {
					id: subagent.id,
					type: subagent.type,
					status: subagent.status,
					...(subagent.title ? { title: subagent.title } : {}),
				},
	);
}

function toSubagent(subagent: Subagent): AgentSubagentSnapshot {
	const snapshot: AgentSubagentSnapshot = {
		id:
			boundedAgentText(subagent.id, EXTENSION_LIMITS.agentSessionIdLength) ??
			'subagent',
		type:
			boundedAgentText(
				subagent.type,
				EXTENSION_LIMITS.agentSubagentTypeLength,
			) ?? 'agent',
		status: subagent.status,
	};
	const parentId = boundedAgentText(
		subagent.parentId,
		EXTENSION_LIMITS.agentSessionIdLength,
	);
	if (parentId) snapshot.parentId = parentId;
	const title = boundedAgentText(
		subagent.title?.trim(),
		EXTENSION_LIMITS.agentTitleLength,
	);
	if (title) snapshot.title = title;
	return snapshot;
}

/** The library loads its optional `koffi` dependency for process-exit watches. */
function libraryProcessWatchAvailable(): boolean {
	try {
		createRequire(import.meta.resolve('@markwylde/all-your-agents')).resolve(
			'koffi',
		);
		return true;
	} catch {
		return false;
	}
}
