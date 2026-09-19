import type { AgentStatusService } from '../activity/agentService.js';
import type { SessionSourceBridge } from '../activity/sessionSourceBridge.js';
import type { ExtensionHostManager } from './manager.js';
import type { ExtensionAgentBroker } from './types.js';

/**
 * Per-harness switches, keyed `<sourceId>/<harnessId>`. A missing key means
 * on. This is the `agentIntegration.harnesses` server setting.
 */
export type AgentHarnessSwitches = Readonly<Record<string, boolean>>;

export interface SessionSourceSupervisorOptions {
	readonly bridge: SessionSourceBridge;
	readonly agents: AgentStatusService;
	readonly harnessSwitches?: AgentHarnessSwitches;
	/** A source that could not start; agent status for it stays empty. */
	readonly onStartFailure?: (sourceId: string, error: unknown) => void;
}

/**
 * Starts every registered session source while agent status is on, and stops
 * them all when it is switched off, so no source keeps a watch for a disabled
 * feature. It also delivers the per-harness switches: a harness switched off
 * is dropped from the host at once and its source asked to stop reporting it.
 *
 * The same object is the host's private publication broker, so a source that
 * stops for any reason — disposed, its extension stopped, its child dead — is
 * forgotten here and in the bridge together.
 */
export class SessionSourceSupervisor implements ExtensionAgentBroker {
	private readonly bridge: SessionSourceBridge;
	private readonly agents: AgentStatusService;
	private readonly onStartFailure?: (sourceId: string, error: unknown) => void;
	private hosts: ExtensionHostManager | undefined;
	private switches: AgentHarnessSwitches;
	/** Running sources and the harness set each was last given. */
	private readonly running = new Map<string, readonly string[]>();
	private reconciling: Promise<void> = Promise.resolve();
	private readonly unsubscribe: Array<() => void> = [];
	private disposed = false;

	constructor(options: SessionSourceSupervisorOptions) {
		this.bridge = options.bridge;
		this.agents = options.agents;
		this.switches = { ...(options.harnessSwitches ?? {}) };
		this.onStartFailure = options.onStartFailure;
		this.unsubscribe.push(
			this.agents.observeIntegrationEnabled(() => {
				void this.reconcile();
			}),
		);
	}

	/** Bind the host manager once the extension composition exists. */
	attach(hosts: ExtensionHostManager): void {
		this.hosts = hosts;
		this.unsubscribe.push(hosts.onContributionsChanged(() => this.reconcile()));
		void this.reconcile();
	}

	setHarnessSwitches(switches: AgentHarnessSwitches): void {
		this.switches = { ...switches };
		void this.reconcile();
	}

	/** Start what should run, stop what should not, re-scope the rest. */
	reconcile(): Promise<void> {
		this.reconciling = this.reconciling
			.catch(() => undefined)
			.then(() => this.reconcileNow());
		return this.reconciling;
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		for (const stop of this.unsubscribe.splice(0)) stop();
		await this.reconcile();
	}

	publish: ExtensionAgentBroker['publish'] = (request, signal) =>
		this.bridge.publish(request, signal);

	diagnostic(
		request: Readonly<{
			extensionId: string;
			sourceId: string;
			diagnostic: unknown;
		}>,
	): void {
		this.bridge.diagnostic(request);
	}

	sourceStopped(
		request: Readonly<{ extensionId: string; sourceId: string }>,
	): void {
		this.running.delete(request.sourceId);
		this.bridge.retireSource(request.sourceId);
	}

	private enabledHarnesses(
		sourceId: string,
		harnesses: readonly { readonly id: string }[],
	): readonly string[] {
		return harnesses
			.map((harness) => harness.id)
			.filter((id) => this.switches[`${sourceId}/${id}`] !== false);
	}

	private async reconcileNow(): Promise<void> {
		const hosts = this.hosts;
		const wanted =
			this.disposed || hosts === undefined || !this.agents.integrationEnabled
				? []
				: hosts.sessionSourceContributions();
		const wantedIds = new Set(
			wanted.map((provider) => provider.contribution.id),
		);
		for (const sourceId of [...this.running.keys()]) {
			if (wantedIds.has(sourceId)) continue;
			this.running.delete(sourceId);
			this.bridge.retireSource(sourceId);
			await hosts?.stopSessionSource(sourceId).catch(() => undefined);
		}
		if (hosts === undefined) return;
		for (const { extensionId, contribution } of wanted) {
			const enabled = this.enabledHarnesses(
				contribution.id,
				contribution.harnesses,
			);
			const current = this.running.get(contribution.id);
			if (current !== undefined) {
				if (sameList(current, enabled)) continue;
				this.running.set(contribution.id, enabled);
				this.bridge.setEnabledHarnesses(contribution.id, enabled);
				await hosts
					.setSessionSourceHarnesses(contribution.id, enabled)
					.catch(() => undefined);
				continue;
			}
			this.running.set(contribution.id, enabled);
			this.bridge.registerSource(
				{
					id: contribution.id,
					extensionId,
					harnesses: contribution.harnesses,
				},
				enabled,
			);
			try {
				await hosts.startSessionSource(contribution.id, enabled);
			} catch (error) {
				this.running.delete(contribution.id);
				this.bridge.retireSource(contribution.id);
				try {
					this.onStartFailure?.(contribution.id, error);
				} catch {
					/* a diagnostic sink cannot affect supervision */
				}
			}
		}
	}
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

/** `agentIntegration.harnesses` from a settings object; anything malformed is
 * ignored, so a missing or broken value leaves every harness on. */
export function agentHarnessSwitchesFromSettings(
	settings: unknown,
): AgentHarnessSwitches {
	const integration = settingsRecord(
		settingsRecord(settings)?.agentIntegration,
	);
	const harnesses = settingsRecord(integration?.harnesses);
	if (harnesses === undefined) return Object.freeze({});
	return Object.freeze(
		Object.fromEntries(
			Object.entries(harnesses)
				.filter(
					([key, value]) =>
						typeof value === 'boolean' && key.length > 0 && key.length <= 256,
				)
				.slice(0, 256),
		) as Record<string, boolean>,
	);
}

/** `agentIntegration.enabled` from a settings object, on unless set false. */
export function agentIntegrationEnabledFromSettings(
	settings: unknown,
): boolean {
	return (
		settingsRecord(settingsRecord(settings)?.agentIntegration)?.enabled !==
		false
	);
}

function settingsRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** The bundled session source that replaced the per-agent built-ins. */
export const BUILT_IN_AGENT_SOURCE_ID = 'com.terminay.builtin-agents/agents';

/** Which harness switch each withdrawn per-agent built-in maps to. OpenCode
 * has no successor harness, so its choice has nothing to carry to. */
const WITHDRAWN_AGENT_EXTENSIONS: Readonly<Record<string, string>> =
	Object.freeze({
		'com.terminay.agent.claude-code': 'claude-code',
		'com.terminay.agent.codex': 'codex',
		'com.terminay.agent.grok': 'grok',
		'com.terminay.agent.omp': 'oh-my-pi',
	});

/**
 * The harness switch a withdrawn per-agent built-in's disabled state becomes,
 * or `undefined` when there is nothing to carry: it was enabled, or it has no
 * successor. Carried once, when reconciliation retires the old record.
 */
export function withdrawnAgentExtensionSwitches(
	record: Readonly<{ extensionId: string; enabled: boolean }>,
): AgentHarnessSwitches | undefined {
	const harness = WITHDRAWN_AGENT_EXTENSIONS[record.extensionId];
	if (harness === undefined || record.enabled) return undefined;
	return Object.freeze({ [`${BUILT_IN_AGENT_SOURCE_ID}/${harness}`]: false });
}
