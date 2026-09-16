import { createHash, randomBytes } from 'node:crypto';
import { watch as watchPath } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { AgentProviderContribution } from '@terminay/extension-api';
import type { LocalAgentTerminal } from '../extensions/localAgentObservation.js';
import type { ExtensionHostManager } from '../extensions/manager.js';
import type {
	ExtensionAgentTerminalCancellationReason,
	ExtensionAgentTerminalContext,
} from '../extensions/types.js';
import type {
	AgentObservationDiagnosticListener,
	AgentObservationTransition,
	ExtensionErrorDetail,
} from '../extensions/diagnostics.js';
import { extensionErrorDetail } from '../extensions/diagnostics.js';
import { AgentStatusService } from './agentService.js';
import { createRampSchedule, type RampSchedule } from './rampSchedule.js';
import type { ActivitySessionIdentity } from './service.js';

/**
 * Evidence that a matched provider could not begin observing a terminal.
 *
 * The provider id, opaque terminal identity, and failure class say which
 * terminal lost observation; the error says why, so the first failure is
 * enough to find the fault. It carries no journal record, prompt, tool input
 * or result, and no path belonging to the observed project.
 */
export interface ExtensionAgentAdmissionFailure {
	readonly kind: 'agent-admission-failed';
	readonly providerId: string;
	readonly terminal: Readonly<ActivitySessionIdentity>;
	readonly failureClass:
		| 'cancelled'
		| 'invalid'
		| 'timed-out'
		| 'unavailable'
		| 'host-failed'
		| 'failed';
	/** One-line summary of the error. */
	readonly reason?: string;
	/** The reported error itself, recorded as the provider raised it. */
	readonly error?: ExtensionErrorDetail;
}

export interface ExtensionAgentRuntimeRegistryOptions {
	/** The selected server's live extension hosts. Contributions are read only
	 * while the host is running; admission still validates ownership in the
	 * manager to close an activation/disable race. */
	readonly hosts: Pick<
		ExtensionHostManager,
		| 'agentProviderContributions'
		| 'admitAgentTerminal'
		| 'cancelAgentTerminal'
		| 'drainAgentObservers'
	>;
	readonly agents: AgentStatusService;
	readonly localObservationCapabilities?: readonly string[];
	readonly platform?: 'darwin' | 'linux' | 'win32';
	readonly contextId?: (
		identity: ActivitySessionIdentity,
		incarnation: number,
	) => string;
	/** A best-effort, metadata-only telemetry hook. A diagnostic sink is never
	 * allowed to change terminal ownership or fallback behaviour. */
	readonly onAdmissionFailure?: (
		failure: ExtensionAgentAdmissionFailure,
	) => void;
	/** Every observation outcome for a terminal, not only the failures. A
	 * terminal that never shows an agent is otherwise indistinguishable from
	 * one that was never matched at all. */
	readonly onObservation?: AgentObservationDiagnosticListener;
	/** Host-private directory watch used while a terminal is unbound. The
	 * default is a non-persistent `fs.watch`, recursive only when the provider
	 * asked for the tree. A test supplies its own to drive change events
	 * without a filesystem. */
	readonly watchDirectory?: (
		path: string,
		onChange: () => void,
		recursive: boolean,
	) => DiscoveryWatcher | undefined;
	/** Minimum spacing between re-observations while watched directories keep
	 * changing; ADR-0022's ramp by default. */
	readonly rampIntervalsMs?: readonly number[];
	/** Clock for the ramp; tests drive it. */
	readonly now?: () => number;
	readonly schedule?: (
		callback: () => void,
		milliseconds: number,
	) => ReturnType<typeof setTimeout>;
	readonly cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface DiscoveryWatcher {
	close(): void;
}

/**
 * What an unbound foreground incarnation is waiting on.
 *
 * It exists from the first `not-bound` result until the incarnation binds,
 * returns to the shell, is replaced, or exits. It holds only the directories
 * providers named and the damping in front of re-observation: no counter, no
 * timer of its own, and nothing that samples.
 */
interface AwaitedDirectory {
	readonly path: string;
	readonly recursive: boolean;
}

interface Discovery {
	readonly processName: string;
	readonly watchers: Map<
		string,
		{ readonly watcher: DiscoveryWatcher; readonly recursive: boolean }
	>;
	readonly ramp: RampSchedule;
	/** Providers already attempted since the last change. A generic wrapper
	 * walks every capable provider once per change, not once per tick. */
	readonly tried: Set<string>;
}

interface TrackedTerminal {
	readonly identity: ActivitySessionIdentity;
	shellPid?: number;
	incarnation: number;
	context?: ExtensionAgentTerminalContext;
	lastProcessName?: string;
	discovery?: Discovery;
	/** A re-observation in flight, and the one to run after it when edges
	 * arrive faster than a context can be replaced. */
	reobserving?: Promise<void>;
	pendingReobserve?: {
		readonly contribution: AgentProviderContribution;
		readonly processName: string;
		readonly keepDiscovery: boolean;
	};
}

const LOCAL_CAPABILITIES = Object.freeze([
	'process-observation',
	'filesystem-observation',
	'agent-journal',
]);
/** Directories one unbound terminal may hold open across every provider it
 * tries. Wider than any single provider's wait set, narrower than a leak. */
const MAX_DISCOVERY_WATCHERS = 32;
const MAX_AWAITED_PATH_LENGTH = 4_096;

/**
 * Server-side admission authority for manifest-declared agent providers.
 *
 * Process matching is merely a prompt to attempt provider observation. The
 * provider is made authoritative only after `AgentStatusService` records an
 * exact terminal claim, then receives a host-issued incarnation context. A
 * failed admission releases that claim so generic terminal activity remains
 * the fallback.
 */
export class ExtensionAgentRuntimeRegistry {
	private readonly terminals = new Map<string, TrackedTerminal>();
	/** Mirrors the agent-integration setting. While false, nothing here may
	 *  observe or watch: an attempt spawns a process. */
	private observationEnabled = true;
	private readonly localObservationCapabilities: readonly string[];
	private readonly platform: 'darwin' | 'linux' | 'win32';
	private readonly makeContextId: NonNullable<
		ExtensionAgentRuntimeRegistryOptions['contextId']
	>;
	private readonly watchDirectory: NonNullable<
		ExtensionAgentRuntimeRegistryOptions['watchDirectory']
	>;
	private readonly rampIntervalsMs: readonly number[] | undefined;
	private readonly schedule: NonNullable<
		ExtensionAgentRuntimeRegistryOptions['schedule']
	>;
	private readonly cancelSchedule: NonNullable<
		ExtensionAgentRuntimeRegistryOptions['cancelSchedule']
	>;

	constructor(private readonly options: ExtensionAgentRuntimeRegistryOptions) {
		this.localObservationCapabilities = Object.freeze([
			...(options.localObservationCapabilities ?? LOCAL_CAPABILITIES),
		]);
		this.platform = options.platform ?? platformName();
		// Context ids are opaque, live authority capabilities—not a derivation of
		// user-restorable project/session labels. A fresh registry nonce prevents
		// two simultaneous server processes with identical persisted labels from
		// ever minting the same extension-host handle.
		const authorityNonce = randomBytes(18).toString('base64url');
		// The incarnation counter is per terminal and starts at one, so it names
		// which incarnation and not which terminal. The issued id must also carry
		// the identity the context was issued for, or two terminals both on their
		// first incarnation mint the same handle and the host — which admits one
		// context per id — refuses every terminal after the first.
		// The identity is folded in under the nonce rather than concatenated, so
		// the id stays opaque and is still not a derivation of user-restorable
		// project or session labels. NUL separators cannot occur in the segments,
		// so no two identities can collide by construction.
		const identityDigest = (identity: ActivitySessionIdentity): string =>
			createHash('sha256')
				.update(authorityNonce)
				.update('\0')
				.update(identity.serverId)
				.update('\0')
				.update(identity.projectId)
				.update('\0')
				.update(identity.sessionId)
				.digest('base64url')
				.slice(0, 24);
		this.makeContextId =
			options.contextId ??
			((identity, incarnation) =>
				`extension-agent:${authorityNonce}:${identityDigest(identity)}:${incarnation}`);
		this.watchDirectory = options.watchDirectory ?? nodeWatchDirectory;
		this.rampIntervalsMs = options.rampIntervalsMs;
		this.schedule =
			options.schedule ??
			((callback, milliseconds) => setTimeout(callback, milliseconds));
		this.cancelSchedule =
			options.cancelSchedule ?? ((timer) => clearTimeout(timer));
		// Start from the setting rather than assuming on, or a runtime built while
		// integration is already off samples until the next time it is toggled.
		this.observationEnabled = options.agents.integrationEnabled;
		options.agents.observeIntegrationEnabled((enabled) => {
			this.setObservationEnabled(enabled);
		});
	}

	providerDisplayName(providerId: string): string | undefined {
		return this.options.hosts
			.agentProviderContributions()
			.find((provider) => provider.id === providerId)?.displayName;
	}

	register(identity: ActivitySessionIdentity): void {
		const current = this.terminals.get(identity.sessionId);
		if (current !== undefined && sameIdentity(current.identity, identity))
			return;
		if (current !== undefined) this.endDiscovery(current);
		this.terminals.set(identity.sessionId, {
			identity: Object.freeze({ ...identity }),
			incarnation: (current?.incarnation ?? 0) + 1,
		});
	}

	terminalStarted(identity: ActivitySessionIdentity, shellPid: number): void {
		const terminal = this.requireTerminal(identity);
		terminal.shellPid = shellPid;
	}

	/** Claims a matching local terminal synchronously, then performs the child
	 * IPC admission in the background. Returning true means generic foreground
	 * activity is now suppressed by AgentStatusService for this provider. */
	foregroundProcessChanged(
		identity: ActivitySessionIdentity,
		processName: string,
		shellForeground = false,
	): boolean {
		const terminal = this.requireTerminal(identity);
		terminal.lastProcessName = processName;
		// A provider journal may be shared by a later `resume` in another
		// Terminay authority.  Once this exact PTY returns to its shell, its
		// descendant proof has ended and its observer must be revoked immediately;
		// otherwise the old child can keep following the global provider journal
		// and project a subsequent writer's events into this terminal.
		if (shellForeground) {
			const previous = terminal.context;
			if (previous === undefined) return false;
			this.endDiscovery(terminal);
			terminal.context = undefined;
			terminal.incarnation += 1;
			this.recordObservation(
				terminal.identity,
				previous.providerId,
				'released',
				{ reason: 'shell-foreground' },
			);
			try {
				this.options.agents.releaseExtensionProvider(
					terminal.identity,
					previous.providerId,
				);
			} catch {
				/* terminal exit/replacement can race foreground observation */
			}
			void this.options.hosts
				.cancelAgentTerminal({
					contextId: previous.contextId,
					reason: 'terminal-replaced',
				})
				.catch(() => undefined);
			return false;
		}
		const queue = this.discoveryQueue(processName);
		if (terminal.context !== undefined) {
			// A TUI can alternate between its launcher, runtime, and helper process
			// names while the same PTY-owned journal writer remains live. A proven
			// binding must outlive those generic samples; otherwise each sample
			// cancels the watcher before it can publish its initial session record.
			// A different explicitly matched provider is a genuine replacement.
			// Process-topology changes from collaboration workers keep the proven
			// root observer alive; their native journals are discovered beneath it.
			const matched = this.match(processName);
			if (matched === undefined) return true;
			if (matched.id === terminal.context.providerId) {
				// The shell edge between a short-lived CLI session and a later resume
				// can be missed by process sampling. Preserve a live root (including)
				// collaboration topology), but re-admit the same provider once its
				// canonical root has exited so the resumed writer can bind again.
				const activeRoot = Object.values(
					this.options.agents.getSnapshot().entries,
				).some(
					(entry) =>
						entry.kind === 'root' &&
						entry.provider === matched.id &&
						entry.activationTerminalSessionId === terminal.identity.sessionId &&
						entry.active,
				);
				if (!activeRoot) this.scheduleReobserve(terminal, matched, processName);
				return true;
			}
			this.scheduleReobserve(terminal, matched, processName);
			return true;
		}
		if (queue[0] === undefined) return false;
		return this.claimAndAdmit(terminal, queue[0], processName);
	}

	/** Re-evaluate the last host-observed foreground process for every live
	 * terminal. The extension manager calls this after atomically publishing a
	 * new provider inventory, so a late-installed agent can bind an already
	 * running CLI without requiring a new terminal event or restart. */
	reobserveExistingTerminals(): number {
		let admitted = 0;
		for (const terminal of this.terminals.values()) {
			if (
				terminal.context !== undefined ||
				terminal.lastProcessName === undefined
			)
				continue;
			const contribution = this.discoveryQueue(terminal.lastProcessName)[0];
			if (
				contribution !== undefined &&
				this.claimAndAdmit(terminal, contribution, terminal.lastProcessName)
			)
				admitted += 1;
		}
		return admitted;
	}

	/** Remove terminal claims owned by providers which are no longer published.
	 * A disabled extension host drains its child observer, but the registry
	 * retains the terminal's last foreground sample so that enabling the same
	 * provider can immediately admit it again. Without this reconciliation the
	 * stale claim makes `reobserveExistingTerminals` skip that terminal until a
	 * full server restart reconstructs the registry. */
	async reconcileProviderInventory(): Promise<number> {
		const available = new Set(
			this.options.hosts
				.agentProviderContributions()
				.map((provider) => provider.id),
		);
		let retired = 0;
		for (const terminal of this.terminals.values()) {
			const context = terminal.context;
			if (context === undefined || available.has(context.providerId)) continue;
			this.endDiscovery(terminal);
			await this.options.hosts
				.cancelAgentTerminal({
					contextId: context.contextId,
					reason: 'provider-disabled',
				})
				.catch(() => undefined);
			if (terminal.context !== context) continue;
			terminal.context = undefined;
			terminal.incarnation += 1;
			this.recordObservation(
				terminal.identity,
				context.providerId,
				'released',
				{ reason: 'provider-disabled' },
			);
			try {
				this.options.agents.releaseExtensionProvider(
					terminal.identity,
					context.providerId,
				);
			} catch {
				/* terminal lifecycle can race provider publication */
			}
			retired += 1;
		}
		return retired;
	}

	private claimAndAdmit(
		terminal: TrackedTerminal,
		contribution: AgentProviderContribution,
		processName: string,
	): boolean {
		const identity = terminal.identity;
		if (contribution === undefined || !this.observationEnabled) return false;
		let claimed = false;
		try {
			claimed = this.options.agents.claimExtensionProvider(
				identity,
				contribution.id,
			);
		} catch {
			return false;
		}
		if (!claimed && terminal.context !== undefined) return false;
		const context: ExtensionAgentTerminalContext = Object.freeze({
			contextId: this.makeContextId(identity, terminal.incarnation),
			serverId: identity.serverId,
			projectId: identity.projectId,
			terminalSessionId: identity.sessionId,
			terminalIncarnationId: String(terminal.incarnation),
			providerId: contribution.id,
			...(terminal.shellPid === undefined
				? {}
				: { shellPid: terminal.shellPid }),
		});
		terminal.context = context;
		terminal.lastProcessName = processName;
		this.recordObservation(identity, contribution.id, 'matched');
		// The server always executes its own projects, so every observation
		// capability the local adapter implements is present for every terminal.
		const observationCapabilities = this.localObservationCapabilities;
		void this.options.hosts
			.admitAgentTerminal({ context, observationCapabilities })
			.then((result) => {
				if (terminal.context !== context) return;
				const state = admissionState(result);
				this.recordObservation(identity, contribution.id, 'admitted', {
					...(state === undefined ? {} : { reason: state }),
				});
				if (state === 'bound') {
					this.recordObservation(identity, contribution.id, 'bound');
					// The incarnation is bound: whatever it was waiting on no longer
					// matters, and nothing may re-run discovery beneath a proven root.
					this.endDiscovery(terminal);
					return;
				}
				if (state === 'not-bound') {
					this.notBound(
						terminal,
						contribution,
						processName,
						admissionAwaiting(result),
					);
					return;
				}
				this.endDiscovery(terminal);
			})
			.catch((error: unknown) => {
				// Observation can throw before the journal is visible (IPC that cannot
				// clone AbortSignal, missing shell pid, lsof races). Keep the claim on
				// this PTY and treat it as `not-bound` with whatever the incarnation
				// was already waiting on; releasing here left a running agent with an
				// empty Agents pane. An unmatched wrapper must still walk the queue:
				// one failed observation cannot pin discovery away from a later
				// provider that can bind.
				if (terminal.context !== context) return;
				this.reportAdmissionFailure(identity, contribution.id, error);
				this.notBound(terminal, contribution, processName, []);
			});
		return true;
	}

	/**
	 * A provider could not bind this incarnation.
	 *
	 * The directories it named join the incarnation's wait set. A generic
	 * wrapper then moves to the next capable provider it has not yet tried
	 * since the last change; a matched provider, or the last one in the queue,
	 * leaves the incarnation waiting. With nothing to wait on, discovery ends
	 * here: only the next foreground edge can start it again.
	 */
	private notBound(
		terminal: TrackedTerminal,
		contribution: AgentProviderContribution,
		processName: string,
		awaiting: readonly AwaitedDirectory[],
	): void {
		if (!this.observationEnabled) return;
		const discovery = this.discoveryFor(terminal, processName);
		discovery.tried.add(contribution.id);
		for (const directory of awaiting) this.watch(terminal, discovery, directory);
		const next = this.discoveryQueue(processName).find(
			(provider) => !discovery.tried.has(provider.id),
		);
		if (next !== undefined) {
			void this.reobserve(terminal, next, processName, true);
			return;
		}
		if (discovery.watchers.size === 0) this.endDiscovery(terminal);
	}

	private discoveryFor(
		terminal: TrackedTerminal,
		processName: string,
	): Discovery {
		if (terminal.discovery !== undefined) return terminal.discovery;
		const discovery: Discovery = {
			processName,
			watchers: new Map(),
			tried: new Set(),
			ramp: createRampSchedule(
				() => this.discoveryChanged(terminal, discovery),
				{
					schedule: this.schedule,
					cancelSchedule: this.cancelSchedule,
					...(this.options.now === undefined ? {} : { now: this.options.now }),
					...(this.rampIntervalsMs === undefined
						? {}
						: { intervalsMs: this.rampIntervalsMs }),
				},
			),
		};
		terminal.discovery = discovery;
		return discovery;
	}

	private watch(
		terminal: TrackedTerminal,
		discovery: Discovery,
		directory: AwaitedDirectory,
	): void {
		const { path, recursive } = directory;
		// A directory already watched as a tree covers a later shallow request;
		// the reverse widens the watch.
		const current = discovery.watchers.get(path);
		if (current !== undefined && (current.recursive || !recursive)) return;
		if (current === undefined && discovery.watchers.size >= MAX_DISCOVERY_WATCHERS)
			return;
		let watcher: DiscoveryWatcher | undefined;
		try {
			watcher = this.watchDirectory(
				path,
				() => {
					if (terminal.discovery !== discovery) return;
					discovery.ramp.request();
				},
				recursive,
			);
		} catch {
			watcher = undefined;
		}
		if (watcher === undefined) return;
		if (current !== undefined) {
			try {
				current.watcher.close();
			} catch {
				/* closing is best effort */
			}
		}
		discovery.watchers.set(path, { watcher, recursive });
	}

	/** A watched directory changed: every capable provider gets one more look,
	 * starting from the head of the queue. */
	private discoveryChanged(
		terminal: TrackedTerminal,
		discovery: Discovery,
	): void {
		if (terminal.discovery !== discovery || !this.observationEnabled) return;
		discovery.tried.clear();
		const contribution = this.discoveryQueue(discovery.processName)[0];
		if (contribution === undefined) {
			this.endDiscovery(terminal);
			return;
		}
		void this.reobserve(terminal, contribution, discovery.processName, true);
	}

	private endDiscovery(terminal: TrackedTerminal): void {
		const discovery = terminal.discovery;
		terminal.discovery = undefined;
		if (discovery === undefined) return;
		discovery.ramp.dispose();
		for (const { watcher } of discovery.watchers.values()) {
			try {
				watcher.close();
			} catch {
				/* closing is best effort */
			}
		}
		discovery.watchers.clear();
	}

	/** A foreground edge replaces the current context with a fresh admission
	 * of `contribution`. It ends whatever the old incarnation was waiting on:
	 * the wait set belongs to the foreground edge, and this is a new one. */
	private scheduleReobserve(
		terminal: TrackedTerminal,
		contribution: AgentProviderContribution,
		processName: string,
	): void {
		void this.reobserve(terminal, contribution, processName, false);
	}

	/** Cancel the current context and admit `contribution` in its place. With
	 * `keepDiscovery` the incarnation's wait set survives, because the
	 * replacement is one more provider's look at the same foreground edge. */
	private reobserve(
		terminal: TrackedTerminal,
		contribution: AgentProviderContribution,
		processName: string,
		keepDiscovery: boolean,
	): Promise<void> {
		if (terminal.reobserving !== undefined) {
			// Edges can arrive faster than a context is replaced. The latest one
			// wins, once, after the replacement in flight has settled.
			terminal.pendingReobserve = { contribution, processName, keepDiscovery };
			return terminal.reobserving;
		}
		if (!keepDiscovery) this.endDiscovery(terminal);
		const run = this.replaceContext(terminal, contribution, processName)
			.catch(() => undefined)
			.then(() => {
				terminal.reobserving = undefined;
				const pending = terminal.pendingReobserve;
				terminal.pendingReobserve = undefined;
				if (pending === undefined) return undefined;
				return this.reobserve(
					terminal,
					pending.contribution,
					pending.processName,
					pending.keepDiscovery,
				);
			});
		terminal.reobserving = run;
		return run;
	}

	private async replaceContext(
		terminal: TrackedTerminal,
		contribution: AgentProviderContribution,
		processName: string,
	): Promise<void> {
		const previous = terminal.context;
		if (previous === undefined) {
			this.claimAndAdmit(terminal, contribution, processName);
			return;
		}
		await this.options.hosts
			.cancelAgentTerminal({
				contextId: previous.contextId,
				reason: 'terminal-replaced',
			})
			.catch(() => undefined);
		if (terminal.context !== previous && terminal.context !== undefined) return;
		if (terminal.context === previous) {
			terminal.context = undefined;
			this.recordObservation(
				terminal.identity,
				previous.providerId,
				'released',
				{ reason: 'terminal-replaced' },
			);
			try {
				this.options.agents.releaseExtensionProvider(
					terminal.identity,
					previous.providerId,
				);
			} catch {
				return;
			}
		}
		terminal.incarnation += 1;
		this.claimAndAdmit(terminal, contribution, processName);
	}

	terminalExited(
		identity: ActivitySessionIdentity,
		reason: ExtensionAgentTerminalCancellationReason = 'terminal-closed',
	): void {
		const terminal = this.terminals.get(identity.sessionId);
		if (terminal === undefined || !sameIdentity(terminal.identity, identity))
			return;
		this.terminals.delete(identity.sessionId);
		this.endDiscovery(terminal);
		if (terminal.context !== undefined) {
			void this.options.hosts
				.cancelAgentTerminal({ contextId: terminal.context.contextId, reason })
				.catch(() => undefined);
		}
	}

	async drain(
		reason:
			| 'provider-disabled'
			| 'extension-stopped'
			| 'server-stopping' = 'server-stopping',
	): Promise<void> {
		if (this.terminals.size === 0) return;
		for (const terminal of this.terminals.values()) this.endDiscovery(terminal);
		this.terminals.clear();
		await this.options.hosts.drainAgentObservers(reason);
	}

	/** Retire only contexts owned by a disabled/crashed provider. Other agent
	 * extensions continue observing their terminals. */
	async retireProvider(
		providerId: string,
		reason: 'provider-disabled' | 'extension-stopped' = 'provider-disabled',
	): Promise<number> {
		const retiring = [...this.terminals.values()].filter(
			(terminal) => terminal.context?.providerId === providerId,
		);
		for (const terminal of retiring) {
			this.endDiscovery(terminal);
			const context = terminal.context!;
			await this.options.hosts
				.cancelAgentTerminal({ contextId: context.contextId, reason })
				.catch(() => undefined);
			if (terminal.context === context) {
				terminal.context = undefined;
				this.recordObservation(terminal.identity, providerId, 'released', {
					reason,
				});
				try {
					this.options.agents.releaseExtensionProvider(
						terminal.identity,
						providerId,
					);
				} catch {
					/* already torn down */
				}
			}
		}
		return retiring.length;
	}

	/** Mirror a host-originated retirement (provider disposal or child crash)
	 * without sending cancellation back into the already-retired host. */
	contextRetired(contextId: string, providerId: string): boolean {
		const terminal = [...this.terminals.values()].find(
			(candidate) =>
				candidate.context?.contextId === contextId &&
				candidate.context.providerId === providerId,
		);
		if (terminal?.context === undefined) return false;
		this.endDiscovery(terminal);
		terminal.context = undefined;
		this.recordObservation(terminal.identity, providerId, 'released', {
			reason: 'context-retired',
		});
		try {
			this.options.agents.releaseExtensionProvider(
				terminal.identity,
				providerId,
			);
		} catch {
			/* teardown is idempotent */
		}
		return true;
	}

	projectRemoved(projectId: string): void {
		for (const terminal of [...this.terminals.values()])
			if (terminal.identity.projectId === projectId)
				this.terminalExited(terminal.identity, 'terminal-closed');
	}

	/**
	 * Stop or resume observation for the agent-integration setting.
	 *
	 * Turning the feature off has to cancel the work, not discard its results:
	 * an unbound terminal holds directory watches whose first change re-runs
	 * observation, and an observation spawns a process. Each terminal is
	 * released through the same identity-checked path admission uses, so its
	 * watches are closed and a result already in flight cannot re-arm behind
	 * the flag.
	 *
	 * Re-enabling arms nothing by itself. Live terminals are re-registered by
	 * the caller that owns them, which is what admits them again.
	 */
	setObservationEnabled(enabled: boolean): void {
		if (typeof enabled !== 'boolean')
			throw new TypeError('observation enabled must be boolean');
		if (this.observationEnabled === enabled) return;
		this.observationEnabled = enabled;
		if (enabled) return;
		for (const terminal of [...this.terminals.values()])
			this.terminalExited(terminal.identity, 'terminal-closed');
	}

	/** Whether observation is currently permitted to schedule work. */
	get observationIsEnabled(): boolean {
		return this.observationEnabled;
	}

	/** Resolve only a currently admitted, exact terminal context for the local
	 * observation adapter. The extension never calls this directly. */
	observationTerminal(
		context: ExtensionAgentTerminalContext,
	): LocalAgentTerminal | undefined {
		const terminal = this.terminals.get(context.terminalSessionId);
		if (
			terminal?.context === undefined ||
			terminal.context.contextId !== context.contextId ||
			terminal.context.terminalIncarnationId !==
				context.terminalIncarnationId ||
			terminal.identity.serverId !== context.serverId ||
			terminal.identity.projectId !== context.projectId
		)
			return undefined;
		return Object.freeze({
			...(terminal.shellPid === undefined
				? {}
				: { shellPid: terminal.shellPid }),
		});
	}

	private requireTerminal(identity: ActivitySessionIdentity): TrackedTerminal {
		const terminal = this.terminals.get(identity.sessionId);
		if (terminal !== undefined && sameIdentity(terminal.identity, identity))
			return terminal;
		const created: TrackedTerminal = {
			identity: Object.freeze({ ...identity }),
			incarnation: 1,
		};
		this.terminals.set(identity.sessionId, created);
		return created;
	}

	private match(processName: string): AgentProviderContribution | undefined {
		const executable = executableName(processName);
		if (executable.length === 0) return undefined;
		return this.capableProviders().find(
			(provider) =>
				provider.processMatchers?.some(
					(matcher) =>
						matcher.arguments === undefined &&
						matchesExecutable(matcher.executableName, executable),
				) === true,
		);
	}

	/** Exact/prefix matcher first. An unmatched wrapper must try every capable
	 * provider, rather than selecting only the first contribution and missing a
	 * later provider that can prove its journal binding. An empty name is not a
	 * leave-shell edge. */
	private discoveryQueue(processName: string): AgentProviderContribution[] {
		if (executableName(processName).length === 0) return [];
		const matched = this.match(processName);
		return matched === undefined ? this.capableProviders() : [matched];
	}

	private capableProviders(): AgentProviderContribution[] {
		return this.options.hosts
			.agentProviderContributions()
			.filter(
				(provider) =>
					provider.platforms === undefined ||
					provider.platforms.includes(this.platform),
			);
	}

	private reportAdmissionFailure(
		identity: ActivitySessionIdentity,
		providerId: string,
		error: unknown,
	): void {
		const failureClass = classifyAdmissionFailure(error);
		const detail = extensionErrorDetail(error);
		const failure: ExtensionAgentAdmissionFailure = Object.freeze({
			kind: 'agent-admission-failed',
			providerId: providerId.slice(0, 256),
			terminal: Object.freeze({
				serverId: identity.serverId.slice(0, 256),
				projectId: identity.projectId.slice(0, 256),
				sessionId: identity.sessionId.slice(0, 256),
			}),
			failureClass,
			...(admissionReason(error) === undefined
				? {}
				: { reason: admissionReason(error) }),
			error: detail,
		});
		try {
			this.options.onAdmissionFailure?.(failure);
		} catch {
			/* diagnostics are best effort */
		}
		this.recordObservation(identity, providerId, 'admission-failed', {
			failureClass,
			...(admissionReason(error) === undefined
				? {}
				: { reason: admissionReason(error) }),
			error: detail,
		});
	}

	/**
	 * One record per observation outcome for one terminal.
	 *
	 * Terminal identity is the opaque server/project/session triple; nothing
	 * the provider read is ever included.
	 */
	private recordObservation(
		identity: ActivitySessionIdentity,
		providerId: string,
		transition: AgentObservationTransition,
		detail: {
			failureClass?: string;
			reason?: string;
			error?: ExtensionErrorDetail;
		} = {},
	): void {
		const listener = this.options.onObservation;
		if (listener === undefined) return;
		try {
			listener({
				providerId: providerId.slice(0, 256),
				terminal: {
					serverId: identity.serverId.slice(0, 256),
					projectId: identity.projectId.slice(0, 256),
					sessionId: identity.sessionId.slice(0, 256),
				},
				transition,
				at: Date.now(),
				...detail,
			});
		} catch {
			/* diagnostics are best effort */
		}
	}
}

function executableName(value: string): string {
	return value.trim().split(/[\\/]/u).pop()?.toLowerCase() ?? '';
}
function matchesExecutable(matcher: string, executable: string): boolean {
	const expected = matcher.trim().toLowerCase();
	if (expected.length === 0 || executable.length === 0) return false;
	return (
		executable === expected ||
		executable.startsWith(`${expected}-`) ||
		executable.startsWith(`${expected}_`) ||
		executable.startsWith(`${expected}.`)
	);
}
function sameIdentity(
	left: ActivitySessionIdentity,
	right: ActivitySessionIdentity,
): boolean {
	return (
		left.serverId === right.serverId &&
		left.projectId === right.projectId &&
		left.sessionId === right.sessionId
	);
}
function platformName(): 'darwin' | 'linux' | 'win32' {
	return process.platform === 'darwin' || process.platform === 'win32'
		? process.platform
		: 'linux';
}
function admissionReason(error: unknown): string | undefined {
	const message =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: '';
	const reason = message
		.replace(/[\r\n]/gu, ' ')
		.trim()
		.slice(0, 300);
	return reason.length > 0 ? reason : undefined;
}
function classifyAdmissionFailure(
	error: unknown,
): ExtensionAgentAdmissionFailure['failureClass'] {
	const message = error instanceof Error ? error.message.toLowerCase() : '';
	if (message.includes('cancel') || message.includes('abort'))
		return 'cancelled';
	if (message.includes('timeout') || message.includes('deadline'))
		return 'timed-out';
	if (
		message.includes('invalid') ||
		message.includes('validation') ||
		message.includes('scope')
	)
		return 'invalid';
	if (message.includes('host') || message.includes('extension'))
		return 'host-failed';
	if (
		message.includes('unavailable') ||
		message.includes('does not exist') ||
		message.includes('not found')
	)
		return 'unavailable';
	return 'failed';
}
function nodeWatchDirectory(
	path: string,
	onChange: () => void,
	recursive: boolean,
): DiscoveryWatcher | undefined {
	const watcher = watchPath(path, { persistent: false, recursive });
	watcher.on('change', onChange);
	// A directory that disappears, or a watch the platform drops, is not an
	// error to anyone: the next foreground edge re-runs discovery regardless.
	watcher.on('error', () => watcher.close());
	return watcher;
}
/** The directories a `not-bound` admission says it is waiting on. They were
 * resolved by the terminal-scoped broker, so each is a bounded absolute path
 * or it is dropped. A bare string is a shallow watch. */
function admissionAwaiting(value: unknown): readonly AwaitedDirectory[] {
	const awaiting =
		typeof value === 'object' && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>).awaiting
			: undefined;
	if (!Array.isArray(awaiting)) return [];
	const directories = new Map<string, boolean>();
	for (const entry of awaiting) {
		const path =
			typeof entry === 'string'
				? entry
				: typeof entry === 'object' && entry !== null
					? (entry as Record<string, unknown>).path
					: undefined;
		if (
			typeof path !== 'string' ||
			path.length === 0 ||
			path.length > MAX_AWAITED_PATH_LENGTH ||
			!isAbsolute(path) ||
			path.includes('\0')
		)
			continue;
		const recursive =
			typeof entry === 'object' &&
			(entry as Record<string, unknown>).recursive === true;
		directories.set(path, (directories.get(path) ?? false) || recursive);
		if (directories.size >= MAX_DISCOVERY_WATCHERS) break;
	}
	return [...directories].map(([path, recursive]) => ({ path, recursive }));
}
function admissionState(value: unknown): string | undefined {
	return typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as Record<string, unknown>).state === 'string'
		? ((value as Record<string, unknown>).state as string)
		: undefined;
}
