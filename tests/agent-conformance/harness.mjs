import './diagnostics.mjs';
import { randomUUID } from 'node:crypto';
import { openConformancePty } from './pty.mjs';

/** Loaded lazily so a skipped CI run does not need a built server-core. */
async function loadAgentChild() {
	return import('@terminay/server-core/agent-child');
}

/**
 * @typedef {'idle' | 'working' | 'waiting' | 'blocked' | 'done'} ConformanceState
 *
 * @typedef {object} ConformanceChild
 * @property {string} id
 * @property {string} [title]
 * @property {'working' | 'done'} state
 * @property {string} [outcome]
 *
 * @typedef {object} ConformanceProjection The projection a test asserts against.
 * @property {boolean} bound
 * @property {string} [providerSessionId]
 * @property {string} [title]
 * @property {ConformanceState} state
 * @property {boolean} inferred
 * @property {string} [outcome] The completion outcome of the last finished turn.
 * @property {boolean} active
 * @property {Map<string, ConformanceChild>} children
 * @property {Array<Record<string, unknown>>} events
 */

function emptyProjection() {
	return {
		bound: false,
		state: 'idle',
		inferred: false,
		active: false,
		rootDonePending: false,
		children: new Map(),
		events: [],
	};
}

/**
 * Reduces canonical events the way the server's agent store does, so a test
 * asserts the state a user would see rather than a private interpretation.
 */
export function applyConformanceEvent(projection, event) {
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
		case 'agent.done': {
			// A root stays working while any child works; its own completion is
			// held until the last child completes.
			const childWorking = [...projection.children.values()].some(
				(child) => child.state === 'working',
			);
			projection.inferred = false;
			// The completion outcome is what distinguishes a failed or cancelled
			// run from a successful one, so it is kept rather than collapsed.
			if (event.outcome) projection.outcome = event.outcome;
			if (childWorking) {
				projection.rootDonePending = true;
				projection.state = 'working';
			} else {
				projection.rootDonePending = false;
				projection.state = 'done';
			}
			return;
		}
		case 'session.stopped':
		case 'agent.exited':
			projection.active = false;
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
			const stillWorking = [...projection.children.values()].some(
				(child) => child.state === 'working',
			);
			if (!stillWorking && projection.rootDonePending) {
				projection.rootDonePending = false;
				projection.state = 'done';
			}
			return;
		}
		default:
			return;
	}
}

/** The publisher an extension child hands to a provider, minus the host IPC. */
function createProjectionPublisher(projection) {
	let rootSessionStarted = false;
	const emit = (kind) => async (event) => {
		applyConformanceEvent(projection, { kind, ...(event ?? {}) });
	};
	return Object.freeze({
		async sessionStarted(event) {
			if (rootSessionStarted) return emit('agent.metadata')(event);
			rootSessionStarted = true;
			return emit('session.started')(event);
		},
		metadataChanged: emit('agent.metadata'),
		turnStarted: emit('turn.started'),
		toolStarted: emit('tool.started'),
		toolFinished: emit('tool.finished'),
		waitStarted: emit('wait.started'),
		waitFinished: emit('wait.finished'),
		done: emit('agent.done'),
		exited: emit('agent.exited'),
		sessionStopped: emit('session.stopped'),
		subagentStarted: emit('subagent.started'),
		subagentDone: emit('subagent.done'),
	});
}

const sleep = (ms) =>
	new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		timer.unref?.();
	});

/**
 * Drives one provider extension against a real CLI in a real PTY, over the
 * live process tree and filesystem, through the same terminal context and
 * session pump the extension child uses in production. No Terminay server,
 * workspace or UI is involved.
 *
 * @param {{
 *   extension: { activate(context: unknown): Promise<void> | void };
 *   providerId: string;
 *   executable: string;
 *   environment?: Record<string, string>;
 *   shell?: string;
 *   cwd?: string;
 *   pollMs?: number;
 * }} options
 */
export async function createConformanceHarness(options) {
	const pty = await openConformancePty(options);
	const projection = emptyProjection();
	const log =
		options.log ??
		(process.env.TERMINAY_CONFORMANCE_LOG === '1'
			? (line) => process.stderr.write(`  ${line}\n`)
			: () => {});
	const registrations = new Map();
	const publisher = createProjectionPublisher(projection);

	await options.extension.activate({
		extensionId: options.providerId,
		apiVersion: '1.2.0',
		paths: { configuration: pty.cwd, data: pty.cwd, cache: pty.cwd },
		registerProjectEnvironmentProvider() {},
		agents: {
			registerProvider(providerId, runtime) {
				registrations.set(providerId, runtime);
				return { providerId, dispose() {} };
			},
		},
		subscriptions: { add: (subscription) => subscription },
	});

	/** @type {{ result: unknown; controller: AbortController; pump: Promise<void> } | undefined} */
	let live;
	let loggedAbsence = false;
	const pumps = [];

	function cliRunning() {
		return pty.descendants().some((entry) => entry.name === options.executable);
	}

	/** Retires the live binding the way the host does when its CLI exits. */
	function retire() {
		if (!live) return;
		live.controller.abort();
		live = undefined;
		applyConformanceEvent(projection, { kind: 'session.stopped' });
	}

	async function observe() {
		if (live) {
			if (!cliRunning()) retire();
			return live?.result;
		}
		if (!cliRunning()) {
			if (!loggedAbsence) {
				log(`observe: no ${options.executable} process below the shell yet`);
				loggedAbsence = true;
			}
			return undefined;
		}
		loggedAbsence = false;
		const runtime = registrations.get(options.providerId);
		if (!runtime)
			throw new Error(`provider ${options.providerId} did not register`);
		const controller = new AbortController();
		const { consumeAgentSession, createAgentTerminalContext } =
			await loadAgentChild();
		const built = await createAgentTerminalContext(
			{
				contextId: randomUUID(),
				serverId: 'conformance',
				projectId: 'conformance',
				projectEnvironmentId: 'this-server',
				terminalSessionId: randomUUID(),
				terminalIncarnationId: randomUUID(),
				providerId: options.providerId,
				shellPid: pty.shellPid,
			},
			['process-observation', 'filesystem-observation', 'agent-journal'],
			controller.signal,
		);
		// The host supplies the foreground process and receives the binding over
		// IPC; here the binding materializes the root exactly as the child does.
		const terminal = Object.freeze({
			...built.terminal,
			foreground: Object.freeze({ executableName: options.executable }),
			async bindSession(binding) {
				projection.providerSessionId = binding.providerSessionId;
				await publisher.sessionStarted({});
				// A rebind after the CLI exited is a metadata event to the publisher,
				// but the root is live again either way.
				projection.bound = true;
				projection.active = true;
				return Object.freeze(structuredClone(binding));
			},
		});
		if (!runtime.matchesForeground(terminal.foreground)) return undefined;
		let result;
		try {
			result = await runtime.observe(terminal);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log(`observe threw: ${message}`);
			projection.events.push({ kind: 'harness.observe-failed', message });
			return undefined;
		}
		if (result?.state !== 'bound' || !('source' in result)) {
			log(`observe: ${result?.state ?? 'nothing'}${result?.reason ? ` (${result.reason})` : ''}`);
			controller.abort();
			return undefined;
		}
		log(`observe: bound ${result.binding.providerSessionId}`);
		const pump = consumeAgentSession(result, publisher, controller.signal);
		pumps.push(pump);
		live = { result, controller, pump };
		return result;
	}

	const pollMs = options.pollMs ?? 500;
	async function awaitCondition(description, predicate, timeoutMs = 120_000) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			await observe();
			if (predicate(projection)) return;
			await sleep(pollMs);
		}
		throw new Error(
			`timed out waiting for ${description}. state=${projection.state} bound=${projection.bound} active=${projection.active} children=${projection.children.size}\nEvents seen: ${projection.events
				.map((event) => event.kind)
				.join(', ')}\nPTY tail:\n${pty.plainOutput().slice(-1_500)}`,
		);
	}

	return {
		pty,
		projection,
		observe,
		await: awaitCondition,
		awaitState: (state, timeoutMs) =>
			awaitCondition(
				`state ${state}`,
				(current) => current.state === state,
				timeoutMs,
			),
		async close() {
			retire();
			await pty.close();
			await Promise.race([Promise.allSettled(pumps), sleep(2_000)]);
		},
	};
}
