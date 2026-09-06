import { randomUUID } from 'node:crypto';
import type {
	AgentLifecycleEvent,
	AgentObservationResult,
	AgentProviderRuntime,
	AgentTerminalContext,
	TerminayExtension,
} from '@terminay/extension-api';
import { createAgentTerminalContext } from '@terminay/server-core/agent-child';
import type { ConformancePtyOptions } from './pty.js';
import { type ConformancePty, openConformancePty } from './pty.js';

/** The nine lifecycle capabilities the matrix asserts, plus detection. */
export type ConformanceState =
	| 'idle'
	| 'working'
	| 'waiting'
	| 'blocked'
	| 'done';

export interface ConformanceChild {
	readonly id: string;
	title?: string;
	state: 'working' | 'done';
	outcome?: string;
}

/** The projection a conformance test asserts against. */
export interface ConformanceProjection {
	bound: boolean;
	providerSessionId?: string;
	title?: string;
	state: ConformanceState;
	inferred: boolean;
	active: boolean;
	readonly children: Map<string, ConformanceChild>;
	readonly events: AgentLifecycleEvent[];
}

function emptyProjection(): ConformanceProjection {
	return {
		bound: false,
		state: 'idle',
		inferred: false,
		active: false,
		children: new Map(),
		events: [],
	};
}

/**
 * Reduces canonical events exactly as the server does, so a test asserts the
 * same state a user would see rather than a private interpretation of it.
 */
function apply(
	projection: ConformanceProjection,
	event: AgentLifecycleEvent,
): void {
	projection.events.push(event);
	switch (event.kind) {
		case 'session.started':
			projection.bound = true;
			projection.active = true;
			projection.state = 'idle';
			projection.inferred = false;
			if (event.title) projection.title = event.title;
			return;
		case 'agent.metadata':
			if (event.title) projection.title = event.title;
			return;
		case 'turn.started':
		case 'tool.started':
		case 'tool.finished':
		case 'wait.finished':
			projection.state = 'working';
			projection.active = true;
			projection.inferred = false;
			return;
		case 'wait.started':
			projection.state = event.state;
			projection.active = true;
			projection.inferred = event.inferred === true;
			return;
		case 'agent.done':
			projection.state = 'done';
			projection.inferred = false;
			return;
		case 'session.stopped':
		case 'agent.exited':
			projection.active = false;
			projection.state = event.kind === 'agent.exited' ? 'done' : 'idle';
			return;
		case 'subagent.started': {
			const existing = projection.children.get(event.subagentId);
			projection.children.set(event.subagentId, {
				...(existing ?? {}),
				id: event.subagentId,
				...(event.title ? { title: event.title } : {}),
				state: 'working',
			});
			projection.state = 'working';
			return;
		}
		case 'subagent.done': {
			const existing = projection.children.get(event.subagentId);
			projection.children.set(event.subagentId, {
				...(existing ?? {}),
				id: event.subagentId,
				state: 'done',
				...(event.outcome ? { outcome: event.outcome } : {}),
			});
			return;
		}
		default:
			return;
	}
}

export interface ConformanceHarness {
	readonly pty: ConformancePty;
	readonly projection: ConformanceProjection;
	/** Runs one bounded observation, admitting the provider if it can bind. */
	observe(): Promise<AgentObservationResult | undefined>;
	/** Polls observation until `predicate` holds, or rejects with the events seen. */
	await(
		description: string,
		predicate: (projection: ConformanceProjection) => boolean,
		timeoutMs?: number,
	): Promise<void>;
	awaitState(state: ConformanceState, timeoutMs?: number): Promise<void>;
	close(): Promise<void>;
}

export interface ConformanceHarnessOptions extends ConformancePtyOptions {
	readonly extension: TerminayExtension;
	readonly providerId: string;
	readonly pollMs?: number;
}

/**
 * Drives one provider extension against a real CLI in a real PTY, over the
 * live process tree and filesystem, and collects the canonical lifecycle
 * events that provider emits. No Terminay server, workspace or UI is involved.
 */
export async function createConformanceHarness(
	options: ConformanceHarnessOptions,
): Promise<ConformanceHarness> {
	const pty = await openConformancePty(options);
	const projection = emptyProjection();
	const controller = new AbortController();
	const registrations = new Map<string, AgentProviderRuntime>();

	await options.extension.activate({
		extensionId: options.providerId,
		apiVersion: '1.2.0',
		paths: { configuration: pty.cwd, data: pty.cwd, cache: pty.cwd },
		registerProjectEnvironmentProvider() {},
		agents: {
			registerProvider(providerId: string, runtime: AgentProviderRuntime) {
				registrations.set(providerId, runtime as AgentProviderRuntime);
				return { providerId, dispose() {} };
			},
		},
		subscriptions: { add: (subscription: unknown) => subscription },
	} as never);

	const identity = {
		contextId: randomUUID(),
		serverId: 'conformance',
		projectId: 'conformance',
		projectEnvironmentId: 'this-server',
		terminalSessionId: randomUUID(),
		terminalIncarnationId: randomUUID(),
		providerId: options.providerId,
		shellPid: pty.shellPid,
	};

	let live: AgentObservationResult | undefined;
	let pump: Promise<void> | undefined;

	async function observe(): Promise<AgentObservationResult | undefined> {
		if (live) return live;
		const runtime = registrations.get(options.providerId);
		if (!runtime)
			throw new Error(`provider ${options.providerId} did not register`);
		const built = createAgentTerminalContext(
			identity,
			['process-observation', 'filesystem-observation', 'agent-journal'],
			controller.signal,
		);
		const terminal = built.terminal as unknown as AgentTerminalContext;
		if (!runtime.matchesForeground(terminal.foreground)) return undefined;
		const result = await runtime.observe(terminal).catch(() => undefined);
		if (!result || result.state !== 'bound' || !('source' in result))
			return undefined;
		live = result;
		projection.providerSessionId = result.binding.providerSessionId;
		projection.bound = true;
		pump = drain(result, built.publisher);
		return result;
	}

	/** Feeds the provider's own sources through its own mapper, forever. */
	async function drain(
		result: AgentObservationResult & { state: 'bound' },
		publisher: Record<string, (event: unknown) => Promise<unknown>>,
	): Promise<void> {
		void publisher;
		const publish = new Proxy(
			{},
			{
				get:
					(_target, kind: string) =>
					(event: Record<string, unknown>): void => {
						apply(projection, {
							kind: kindOf(kind),
							...event,
						} as unknown as AgentLifecycleEvent);
					},
			},
		);
		const feed = async (
			source: unknown,
			journal: { role: 'root' } | { role: 'child'; childId: string },
		): Promise<void> => {
			const watcher = (await source) as AsyncIterable<{ bytes: Uint8Array }>;
			let carry = '';
			for await (const chunk of watcher) {
				if (controller.signal.aborted) return;
				carry += new TextDecoder().decode(chunk.bytes);
				const lines = carry.split('\n');
				carry = lines.pop() ?? '';
				for (const line of lines) {
					if (!line.trim()) continue;
					let record: unknown;
					try {
						record = JSON.parse(line);
					} catch {
						continue;
					}
					await result.mapRecord(record, {
						binding: result.binding,
						journal,
						publish: publish as never,
						signal: { aborted: false, throwIfAborted() {} },
					});
				}
			}
		};
		const running = [feed(result.source, { role: 'root' })];
		for (const child of result.childSources ?? [])
			running.push(
				feed(child.source, { role: 'child', childId: child.childId }),
			);
		if (result.childSourceDiscovery) {
			running.push(
				(async () => {
					const discovery = await result.childSourceDiscovery;
					for await (const child of discovery as AsyncIterable<{
						childId: string;
						source: unknown;
					}>) {
						if (controller.signal.aborted) return;
						void feed(child.source, { role: 'child', childId: child.childId });
					}
				})(),
			);
		}
		await Promise.allSettled(running);
	}

	const pollMs = options.pollMs ?? 500;
	async function awaitCondition(
		description: string,
		predicate: (projection: ConformanceProjection) => boolean,
		timeoutMs = 120_000,
	): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			await observe();
			if (predicate(projection)) return;
			await new Promise((resolve) => {
				const timer = setTimeout(resolve, pollMs);
				(timer as { unref?: () => void }).unref?.();
			});
		}
		throw new Error(
			`timed out waiting for ${description}. State=${projection.state} bound=${projection.bound} children=${projection.children.size}\nEvents seen: ${projection.events
				.map((event) => event.kind)
				.join(', ')}\nPTY tail:\n${pty.output().slice(-1_500)}`,
		);
	}
	return {
		pty,
		projection,
		observe,
		await: awaitCondition,
		awaitState: (state: ConformanceState, timeoutMs?: number) =>
			awaitCondition(
				`state ${state}`,
				(current) => current.state === state,
				timeoutMs,
			),
		async close() {
			controller.abort();
			try {
				if (live && 'source' in live) {
					const source = (await live.source) as { dispose?: () => unknown };
					await source.dispose?.();
				}
			} catch {
				// Disposal is best effort; the PTY teardown below is what matters.
			}
			await pty.close();
			await Promise.race([
				pump ?? Promise.resolve(),
				new Promise((resolve) => {
					const timer = setTimeout(resolve, 1_000);
					(timer as { unref?: () => void }).unref?.();
				}),
			]);
		},
	};
}

/** Publisher method names map onto canonical event kinds. */
function kindOf(method: string): string {
	return (
		(
			{
				sessionStarted: 'session.started',
				sessionStopped: 'session.stopped',
				metadataChanged: 'agent.metadata',
				turnStarted: 'turn.started',
				toolStarted: 'tool.started',
				toolFinished: 'tool.finished',
				waitStarted: 'wait.started',
				waitFinished: 'wait.finished',
				done: 'agent.done',
				exited: 'agent.exited',
				subagentStarted: 'subagent.started',
				subagentDone: 'subagent.done',
			} as Record<string, string>
		)[method] ?? method
	);
}
