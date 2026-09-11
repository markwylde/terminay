import { type ChildProcess, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
	type AgentProviderContribution,
	EXTENSION_API_VERSION,
	isNamespacedId,
	type LanguageServerContribution,
	validateAgentLifecycleEvent,
} from '@terminay/extension-api';
import { validateExtensionLaunchDescriptor } from './descriptor.js';
import {
	type ExtensionErrorDetail,
	extensionErrorDetail,
	type ExtensionHostDiagnostic,
	type ExtensionHostDiagnosticListener,
	type ExtensionHostTransition,
} from './diagnostics.js';
import {
	type ExtensionLanguageDiagnosticsNotification,
	type ExtensionLanguageMethod,
	type ExtensionLanguageSessionExit,
	parseExtensionLanguageDiagnostics,
	parseExtensionLanguageSessionExit,
} from './languageProtocol.js';
import {
	type ChildFrame,
	EXTENSION_HOST_PROTOCOL_VERSION,
	type ExtensionFatalErrorReport,
	frameByteLength,
	type HostFrame,
	isChildFrame,
	isExtensionFatalErrorReport,
} from './protocol.js';
import type {
	ExtensionAgentBroker,
	ExtensionAgentLifecyclePublication,
	ExtensionAgentObservationRequest,
	ExtensionAgentTerminalAdmission,
	ExtensionAgentTerminalCancellation,
	ExtensionAgentTerminalContext,
	ExtensionBroker,
	ExtensionHostLimits,
	ExtensionHostStatus,
	ExtensionInvocation,
	ExtensionLaunchDescriptor,
	ExtensionSecretAccessBroker,
} from './types.js';

interface PendingCall {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timer: ReturnType<typeof setTimeout>;
	readonly abort?: () => void;
}

export interface ExtensionHostOptions {
	readonly broker: ExtensionBroker;
	readonly limits?: ExtensionHostLimits;
	readonly nodeExecutable?: string;
	readonly childEntrypoint?: string;
	readonly now?: () => number;
	readonly secrets?: ExtensionSecretAccessBroker;
	readonly agents?: ExtensionAgentBroker;
	/** Where lifecycle records go. Absent means they are not recorded. */
	readonly onDiagnostic?: ExtensionHostDiagnosticListener;
	/** Observed after every state transition, so a supervisor can act on a
	 * failure without polling. Observers cannot change the transition. */
	readonly onStateChange?: (status: ExtensionHostStatus) => void;
	/** Translated `publishDiagnostics` from one of this extension's language
	 * sessions. Core fans them out onto the workspace journal. */
	readonly onLanguageDiagnostics?: (
		notification: ExtensionLanguageDiagnosticsNotification & {
			readonly extensionId: string;
		},
	) => void;
	/** One language session ending, reported exactly once by the child. */
	readonly onLanguageSessionExit?: (
		exit: ExtensionLanguageSessionExit & { readonly extensionId: string },
	) => void;
}

/** One private language invocation on this extension's child. */
export interface ExtensionLanguageInvocation {
	readonly method: ExtensionLanguageMethod;
	readonly input: Readonly<Record<string, unknown>>;
	readonly deadlineMs?: number;
	readonly signal?: AbortSignal;
}

const DEFAULTS = Object.freeze({
	maxMessageBytes: 256 * 1024,
	maxConcurrentInvocations: 16,
	startupTimeoutMs: 15_000,
	invocationTimeoutMs: 30_000,
	shutdownTimeoutMs: 5_000,
	crashWindowMs: 60_000,
	maxCrashesInWindow: 5,
	initialBackoffMs: 250,
	maxBackoffMs: 30_000,
});

const INHERITED_CHILD_ENV = Object.freeze([
	'PATH',
	'HOME',
	'USER',
	'LOGNAME',
	'TMPDIR',
	'TMP',
	'TEMP',
	'LANG',
	'LC_ALL',
	'LC_CTYPE',
	'TZ',
]);
const UNIX_PATH = '/usr/sbin:/usr/bin:/bin:/sbin';

/** Bounded host environment for an extension child. npm's sterile env stays
 * on the installer; agent observation needs PATH/HOME so `ps` and `lsof`
 * resolve the same way they did in the Electron process on main. */
export function extensionChildEnvironment(
	source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	// Electron augments ProcessEnv with application variables that are required
	// in its own process but deliberately absent from an extension child.
	const env = {} as NodeJS.ProcessEnv;
	for (const key of INHERITED_CHILD_ENV) {
		const value = source[key];
		if (typeof value === 'string' && value.length > 0) env[key] = value;
	}
	env.PATH = completeChildPath(env.PATH);
	env.ELECTRON_RUN_AS_NODE = '1';
	env.NODE_ENV = 'production';
	env.TERMINAY_EXTENSION_HOST = '1';
	return env;
}

function completeChildPath(path: string | undefined): string {
	return [
		...new Set(
			[...(path?.split(':') ?? []), ...UNIX_PATH.split(':')].filter(
				(part) => part.length > 0,
			),
		),
	].join(':');
}

/** Supervises exactly one extension process. The process boundary is crash
 * isolation, not an OS security sandbox: installed extensions remain trusted
 * code running as the Terminay Server account. */
export class ExtensionHost {
	private child: ChildProcess | undefined;
	private descriptor: ExtensionLaunchDescriptor | undefined;
	private state: ExtensionHostStatus;
	private readonly pending = new Map<string, PendingCall>();
	private readonly activeBrokerCalls = new Map<string, AbortController>();
	private readonly crashTimes: number[] = [];
	private sequence = 0;
	private stopping = false;
	private agentProviders: readonly AgentProviderContribution[] = Object.freeze(
		[],
	);
	private readonly agentContexts = new Map<
		string,
		ExtensionAgentTerminalContext
	>();
	private languageServers: readonly LanguageServerContribution[] = Object.freeze(
		[],
	);
	private agentPublicationsInFlight = 0;
	/** The child's account of the error that is ending it, if it sent one. */
	private fatalReport: ExtensionFatalErrorReport | undefined;
	/** Whether this incarnation's death has already been counted as a crash. */
	private deathCounted = false;
	/** Whether an exit status has already been observed for this incarnation. */
	private exitRecorded = false;
	private readonly limits: Required<ExtensionHostLimits>;
	private readonly now: () => number;

	constructor(
		readonly extensionId: string,
		private readonly options: ExtensionHostOptions,
	) {
		this.limits = { ...DEFAULTS, ...options.limits };
		this.now = options.now ?? Date.now;
		this.state = { extensionId, state: 'stopped', consecutiveCrashes: 0 };
	}

	status(): ExtensionHostStatus {
		return Object.freeze({
			...this.state,
			agentProviders: this.agentProviders,
			languageServers: this.languageServers,
		});
	}
	launchDescriptor(): ExtensionLaunchDescriptor | undefined {
		return this.descriptor;
	}

	async start(descriptor: ExtensionLaunchDescriptor): Promise<void> {
		if (descriptor.extensionId !== this.extensionId)
			throw new TypeError('extension descriptor identity mismatch');
		if (this.state.state === 'quarantined')
			throw new Error('extension is quarantined');
		if (this.child !== undefined) return;
		const restartAt = this.state.restartAt;
		if (restartAt !== undefined && restartAt > this.now())
			throw new Error('extension restart backoff is active');
		this.descriptor = await validateExtensionLaunchDescriptor(descriptor);
		this.stopping = false;
		this.fatalReport = undefined;
		this.deathCounted = false;
		this.exitRecorded = false;
		this.setState({
			extensionId: this.extensionId,
			state: 'starting',
			consecutiveCrashes: this.state.consecutiveCrashes,
		});
		const childEntrypoint =
			this.options.childEntrypoint ??
			fileURLToPath(new URL('./child.js', import.meta.url));
		const child = fork(childEntrypoint, [], {
			cwd: this.descriptor.packageRoot,
			execPath: this.options.nodeExecutable,
			execArgv: [],
			env: extensionChildEnvironment(),
			stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
			serialization: 'json',
		});
		this.child = child;
		this.recordDiagnostic('spawned', {
			consecutiveFailures: this.state.consecutiveCrashes,
		});
		child.on('message', (message) => this.receive(message));
		child.once('error', (error) => {
			if (this.child === child) this.childFailed(error);
		});
		child.once('exit', (code, signal) => {
			if (this.child === child) this.childExited(code, signal);
		});
		try {
			const activated = await this.call(
				'activate',
				{
					extensionId: this.extensionId,
					apiVersion: EXTENSION_API_VERSION,
					entrypoint: this.descriptor.entrypoint,
					configDirectory: this.descriptor.configDirectory,
					dataDirectory: this.descriptor.dataDirectory,
					cacheDirectory: this.descriptor.cacheDirectory,
					permissions: [...this.descriptor.permissions],
					agentProviders:
						this.descriptor.agentProviders === undefined
							? []
							: structuredClone(this.descriptor.agentProviders),
					languageServers:
						this.descriptor.languageServers === undefined
							? []
							: structuredClone(this.descriptor.languageServers),
				},
				this.limits.startupTimeoutMs,
				undefined,
				true,
			);
			this.agentProviders = validateAgentProviders(
				record(activated)?.agentProviders,
				this.descriptor,
			);
			this.languageServers = validateLanguageServers(
				record(activated)?.languageServers,
				this.descriptor,
			);
			this.setState({
				extensionId: this.extensionId,
				state: 'running',
				consecutiveCrashes: 0,
			});
			this.recordDiagnostic('ready', { consecutiveFailures: 0 });
		} catch (error) {
			this.terminateChild();
			this.recordFailure(
				error instanceof Error
					? error
					: new Error('extension activation failed'),
			);
			throw error;
		}
	}

	async invoke(invocation: ExtensionInvocation): Promise<unknown> {
		if (this.state.state !== 'running' || this.child === undefined)
			throw new Error('extension is not running');
		if (this.pending.size >= this.limits.maxConcurrentInvocations)
			throw new Error('extension invocation admission limit reached');
		if (
			typeof invocation.method !== 'string' ||
			invocation.method.length === 0 ||
			invocation.method.length > 200
		)
			throw new TypeError('invalid extension method');
		return this.call(
			'invoke',
			{ method: invocation.method, input: invocation.input },
			invocation.deadlineMs ?? this.limits.invocationTimeoutMs,
			invocation.signal,
		);
	}

	/**
	 * Invoke one language operation on this extension's child.
	 *
	 * It is deliberately a distinct frame kind rather than an ordinary method
	 * invocation: core owns these operations, and an extension can neither
	 * declare nor shadow them.
	 */
	async invokeLanguage(
		invocation: ExtensionLanguageInvocation,
	): Promise<unknown> {
		if (this.state.state !== 'running' || this.child === undefined)
			throw unavailable('extension is not running');
		if (this.pending.size >= this.limits.maxConcurrentInvocations)
			throw unavailable('extension invocation admission limit reached');
		if (this.languageServers.length === 0)
			throw unavailable('extension contributes no language server');
		return this.call(
			'language.request',
			{ method: invocation.method, input: invocation.input },
			invocation.deadlineMs ?? this.limits.invocationTimeoutMs,
			invocation.signal,
		);
	}

	languageServerContributions(): readonly LanguageServerContribution[] {
		return this.languageServers;
	}

	async stop(): Promise<void> {
		this.stopping = true;
		const child = this.child;
		if (child === undefined) {
			// Stopping something that is already quarantined must not hide that:
			// the state is what tells a person why it is not running, and only an
			// explicit restart clears it.
			if (this.state.state !== 'quarantined')
				this.setState({
					extensionId: this.extensionId,
					state: 'stopped',
					consecutiveCrashes: this.state.consecutiveCrashes,
				});
			return;
		}
		await this.drainAgentObservers('extension-stopped').catch(() => undefined);
		try {
			await this.call('deactivate', undefined, this.limits.shutdownTimeoutMs);
		} catch {
			/* bounded forced termination below */
		}
		this.terminateChild();
		this.rejectPending(new Error('extension host stopped'));
		this.setState({
			extensionId: this.extensionId,
			state: 'stopped',
			consecutiveCrashes: this.state.consecutiveCrashes,
		});
		this.recordDiagnostic('stopped', {
			deliberate: true,
			consecutiveFailures: this.state.consecutiveCrashes,
		});
		this.agentProviders = Object.freeze([]);
		this.languageServers = Object.freeze([]);
	}

	/**
	 * Return a quarantined host to a startable state.
	 *
	 * Quarantine exists to stop a crash loop, so nothing clears it on its own.
	 * An explicit restart does, and it resets the crash window with it: the
	 * person asking is the evidence that the situation has changed.
	 */
	clearQuarantine(): void {
		if (this.child !== undefined)
			throw new Error('cannot clear quarantine while extension is running');
		const wasQuarantined = this.state.state === 'quarantined';
		this.crashTimes.length = 0;
		this.setState({
			extensionId: this.extensionId,
			state: 'stopped',
			consecutiveCrashes: 0,
		});
		if (wasQuarantined)
			this.recordDiagnostic('quarantine-cleared', { consecutiveFailures: 0 });
	}

	/** Admit exactly one server-issued terminal incarnation to one registered
	 * agent provider. The child cannot manufacture this context. */
	async admitAgentTerminal(
		admission: ExtensionAgentTerminalAdmission,
		signal?: AbortSignal,
	): Promise<unknown> {
		const context = validateAgentTerminalAdmission(
			admission,
			this.extensionId,
			this.agentProviders,
		);
		if (this.agentContexts.has(context.contextId))
			throw new Error('agent terminal context is already admitted');
		this.agentContexts.set(context.contextId, context);
		try {
			return await this.call(
				'agent.terminal.admit',
				admission,
				this.limits.invocationTimeoutMs,
				signal,
			);
		} catch (error) {
			await this.retireAgentContext(context.contextId, 'terminal-replaced');
			throw error;
		}
	}

	async cancelAgentTerminal(
		cancellation: ExtensionAgentTerminalCancellation,
	): Promise<boolean> {
		const context = this.agentContexts.get(cancellation.contextId);
		if (context === undefined) return false;
		await this.call(
			'agent.terminal.cancel',
			cancellation,
			this.limits.shutdownTimeoutMs,
		).catch(() => undefined);
		await this.retireAgentContext(cancellation.contextId, cancellation.reason);
		return true;
	}

	async drainAgentObservers(
		reason: 'provider-disabled' | 'extension-stopped' | 'server-stopping',
	): Promise<void> {
		if (this.agentContexts.size === 0) return;
		await this.call(
			'agent.drain',
			{ reason },
			this.limits.shutdownTimeoutMs,
		).catch(() => undefined);
		for (const contextId of [...this.agentContexts.keys()])
			await this.retireAgentContext(contextId, reason);
	}

	private call(
		kind: HostFrame['kind'],
		payload: unknown,
		timeoutMs: number,
		signal?: AbortSignal,
		allowStarting = false,
	): Promise<unknown> {
		if (
			this.child === undefined ||
			(!allowStarting &&
				this.state.state !== 'running' &&
				kind !== 'deactivate')
		)
			return Promise.reject(new Error('extension child is unavailable'));
		if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000)
			return Promise.reject(new TypeError('invalid extension deadline'));
		const id = `${this.extensionId}:${++this.sequence}`;
		const frame: HostFrame = {
			protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION,
			kind,
			id,
			...(payload === undefined ? {} : { payload }),
		};
		if (frameByteLength(frame) > this.limits.maxMessageBytes)
			return Promise.reject(new Error('extension IPC message exceeds limit'));
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				this.send({
					protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION,
					kind: 'cancel',
					id,
				});
				reject(new Error(`extension ${kind} timed out`));
			}, timeoutMs);
			const abort =
				signal === undefined
					? undefined
					: () => {
							clearTimeout(timer);
							this.pending.delete(id);
							this.send({
								protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION,
								kind: 'cancel',
								id,
							});
							reject(new Error('extension invocation cancelled'));
						};
			if (signal?.aborted) {
				clearTimeout(timer);
				reject(new Error('extension invocation cancelled'));
				return;
			}
			signal?.addEventListener('abort', abort!, { once: true });
			this.pending.set(id, {
				resolve,
				reject,
				timer,
				...(abort === undefined ? {} : { abort }),
			});
			if (this.send(frame) !== 'sent') {
				this.finishPending(
					id,
					undefined,
					new Error('extension IPC send failed'),
				);
			}
		});
	}

	/**
	 * Why a write did not happen, because the reasons are not alike.
	 *
	 * A frame over the message limit is the child and host disagreeing about
	 * the protocol. A closed channel is just what a child that has ended looks
	 * like from the writing side. Collapsing them into one boolean made every
	 * caller report whichever it happened to name, and a dying child was
	 * accused of misbehaving.
	 */
	private send(frame: HostFrame): 'sent' | 'channel-closed' | 'too-large' {
		if (frameByteLength(frame) > this.limits.maxMessageBytes)
			return 'too-large';
		if (this.child === undefined || !this.child.connected)
			return 'channel-closed';
		try {
			return this.child.send(frame) ? 'sent' : 'channel-closed';
		} catch {
			// `send` throws once the channel is closing, which is the same fact.
			return 'channel-closed';
		}
	}

	/**
	 * Write a frame the child is owed, and react only to a real violation.
	 *
	 * A frame too large for the channel is a protocol disagreement and is
	 * contained as one. A closed channel is recorded and dropped: the child has
	 * already ended, its exit is being handled by the path that owns it, and
	 * accusing it here would count that one death again for every operation
	 * that happened to be in flight.
	 */
	private sendOrViolate(frame: HostFrame, oversizeMessage: string): boolean {
		const result = this.send(frame);
		if (result === 'sent') return true;
		if (result === 'too-large') {
			this.protocolViolation(oversizeMessage);
			return false;
		}
		this.recordDiagnostic('channel-closed', {
			consecutiveFailures: this.state.consecutiveCrashes,
		});
		return false;
	}

	private receive(message: unknown): void {
		if (frameByteLength(message) > this.limits.maxMessageBytes) {
			this.protocolViolation('oversized child message');
			return;
		}
		if (!isChildFrame(message)) {
			this.protocolViolation('malformed child message');
			return;
		}
		if (message.kind === 'broker.cancel') {
			this.activeBrokerCalls.get(message.id)?.abort();
			return;
		}
		if (message.kind === 'broker.request') {
			void this.handleBrokerRequest(message);
			return;
		}
		if (message.kind === 'agent.observation.request') {
			void this.handleAgentObservationRequest(message);
			return;
		}
		if (message.kind === 'agent.lifecycle.publish') {
			void this.handleAgentLifecyclePublication(message);
			return;
		}
		if (message.kind === 'language.diagnostics') {
			const notification = parseExtensionLanguageDiagnostics(message.payload);
			if (notification === undefined) {
				this.protocolViolation('language diagnostics notification is invalid');
				return;
			}
			try {
				this.options.onLanguageDiagnostics?.({
					...notification,
					extensionId: this.extensionId,
				});
			} catch {
				/* a diagnostics observer cannot affect the extension it observes */
			}
			return;
		}
		if (message.kind === 'language.session.exited') {
			const exit = parseExtensionLanguageSessionExit(message.payload);
			if (exit === undefined) {
				this.protocolViolation('language session exit is invalid');
				return;
			}
			try {
				this.options.onLanguageSessionExit?.({
					...exit,
					extensionId: this.extensionId,
				});
			} catch {
				/* an observer cannot affect the extension it observes */
			}
			if (exit.reason === 'exited') this.recordLanguageServerCrash(exit);
			return;
		}
		if (message.kind === 'agent.provider.disposed') {
			void this.handleAgentProviderDisposed(message);
			return;
		}
		if (message.kind === 'fatal') {
			// The child is already exiting. Hold its account until the exit that
			// follows records it; there is no pending call to settle.
			if (isExtensionFatalErrorReport(message.payload))
				this.fatalReport = message.payload;
			return;
		}
		if (
			message.kind === 'ready' ||
			message.kind === 'result' ||
			message.kind === 'deactivated' ||
			message.kind === 'agent.terminal.admitted' ||
			message.kind === 'agent.terminal.cancelled' ||
			message.kind === 'agent.drain.completed'
		)
			this.finishPending(message.id, message.payload);
		else
			this.finishPending(
				message.id,
				undefined,
				new Error(failureMessage(message.payload)),
			);
	}

	private async handleBrokerRequest(frame: ChildFrame): Promise<void> {
		if (this.activeBrokerCalls.size >= this.limits.maxConcurrentInvocations) {
			this.sendBrokerResult(
				frame.id,
				undefined,
				'broker admission limit reached',
			);
			return;
		}
		const payload = record(frame.payload);
		const operation = payload?.operation;
		if (operation !== 'log' && operation !== 'secret.resolve') {
			this.sendBrokerResult(
				frame.id,
				undefined,
				'unsupported broker operation',
			);
			return;
		}
		const controller = new AbortController();
		this.activeBrokerCalls.set(frame.id, controller);
		try {
			const result =
				operation === 'secret.resolve'
					? await this.resolveSecret(payload?.payload, controller.signal)
					: await this.options.broker.request(
							{
								extensionId: this.extensionId,
								operation,
								payload: payload?.payload,
							},
							controller.signal,
						);
			this.sendBrokerResult(frame.id, result);
		} catch (error) {
			this.sendBrokerResult(
				frame.id,
				undefined,
				error instanceof Error ? error.message : 'broker request failed',
			);
		} finally {
			this.activeBrokerCalls.delete(frame.id);
		}
	}

	private async handleAgentObservationRequest(
		frame: ChildFrame,
	): Promise<void> {
		const request = parseAgentObservationRequest(frame.payload);
		if (request === undefined) {
			this.sendAgentObservationResult(frame.id, {
				contextId: '',
				ok: false,
				failure: 'invalid agent observation request',
			});
			return;
		}
		const context = this.agentContexts.get(request.contextId);
		if (
			context === undefined ||
			context.providerId !== request.providerId ||
			this.options.agents === undefined
		) {
			this.sendAgentObservationResult(frame.id, {
				contextId: request.contextId,
				ok: false,
				failure: 'agent observation scope is unavailable',
			});
			return;
		}
		const controller = new AbortController();
		this.activeBrokerCalls.set(frame.id, controller);
		try {
			const value = await this.options.agents.observe(
				{
					extensionId: this.extensionId,
					providerId: request.providerId,
					terminal: context,
					operation: request.operation,
					payload: request.payload,
				},
				controller.signal,
			);
			this.sendAgentObservationResult(frame.id, {
				contextId: request.contextId,
				ok: true,
				value,
			});
		} catch (error) {
			this.sendAgentObservationResult(frame.id, {
				contextId: request.contextId,
				ok: false,
				failure: safeFailure(
					error instanceof Error
						? error
						: new Error('agent observation failed'),
				),
			});
		} finally {
			this.activeBrokerCalls.delete(frame.id);
		}
	}

	private async handleAgentLifecyclePublication(
		frame: ChildFrame,
	): Promise<void> {
		const publication = parseAgentLifecyclePublication(frame.payload);
		if (publication === undefined) {
			this.sendAgentLifecycleAck(frame.id, {
				contextId: '',
				publicationId: '',
				acceptedEventCount: 0,
				rejectedEventCount: 0,
				failure: 'invalid agent lifecycle publication',
			});
			return;
		}
		const context = this.agentContexts.get(publication.contextId);
		if (
			context === undefined ||
			context.providerId !== publication.providerId ||
			this.options.agents === undefined
		) {
			this.sendAgentLifecycleAck(frame.id, {
				contextId: publication.contextId,
				publicationId: publication.publicationId,
				acceptedEventCount: 0,
				rejectedEventCount: publication.events.length,
				failure: 'agent lifecycle scope is unavailable',
			});
			return;
		}
		if (
			this.agentPublicationsInFlight >= this.limits.maxConcurrentInvocations
		) {
			this.send({
				protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION,
				kind: 'agent.lifecycle.backpressure',
				id: frame.id,
				payload: {
					contextId: publication.contextId,
					state: 'pause',
					maxInFlightPublications: this.limits.maxConcurrentInvocations,
					retryAfterMs: 50,
				},
			});
			this.sendAgentLifecycleAck(frame.id, {
				contextId: publication.contextId,
				publicationId: publication.publicationId,
				acceptedEventCount: 0,
				rejectedEventCount: publication.events.length,
				failure: 'agent lifecycle publication is backpressured',
			});
			return;
		}
		this.agentPublicationsInFlight += 1;
		const controller = new AbortController();
		this.activeBrokerCalls.set(frame.id, controller);
		try {
			const result = await this.options.agents.publish(
				{
					extensionId: this.extensionId,
					providerId: publication.providerId,
					terminal: context,
					publicationId: publication.publicationId,
					mappingVersion: publication.mappingVersion,
					...(publication.binding === undefined
						? {}
						: { binding: publication.binding }),
					events: publication.events,
				},
				controller.signal,
			);
			this.sendAgentLifecycleAck(frame.id, {
				contextId: publication.contextId,
				publicationId: publication.publicationId,
				acceptedEventCount: result.acceptedEventCount,
				rejectedEventCount: result.rejectedEventCount ?? 0,
				...(result.failure === undefined
					? {}
					: { failure: safeFailure(new Error(result.failure)) }),
			});
		} catch (error) {
			this.sendAgentLifecycleAck(frame.id, {
				contextId: publication.contextId,
				publicationId: publication.publicationId,
				acceptedEventCount: 0,
				rejectedEventCount: publication.events.length,
				failure: safeFailure(
					error instanceof Error
						? error
						: new Error('agent lifecycle publication failed'),
				),
			});
		} finally {
			this.activeBrokerCalls.delete(frame.id);
			this.agentPublicationsInFlight -= 1;
			this.send({
				protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION,
				kind: 'agent.lifecycle.backpressure',
				id: frame.id,
				payload: {
					contextId: publication.contextId,
					state: 'normal',
					maxInFlightPublications: this.limits.maxConcurrentInvocations,
				},
			});
		}
	}

	private async handleAgentProviderDisposed(frame: ChildFrame): Promise<void> {
		const providerId = boundedId(record(frame.payload)?.providerId);
		if (
			providerId === undefined ||
			!this.agentProviders.some((provider) => provider.id === providerId)
		) {
			this.protocolViolation('agent provider disposal is invalid');
			return;
		}
		this.agentProviders = Object.freeze(
			this.agentProviders.filter((provider) => provider.id !== providerId),
		);
		for (const [contextId, context] of this.agentContexts)
			if (context.providerId === providerId)
				await this.retireAgentContext(contextId, 'provider-disabled');
	}

	private sendAgentObservationResult(
		id: string,
		result: {
			readonly contextId: string;
			readonly ok: boolean;
			readonly value?: unknown;
			readonly failure?: string;
		},
	): void {
		const delivery = this.send({
			protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION,
			kind: 'agent.observation.result',
			id,
			payload: result,
		});
		if (delivery === 'sent') return;
		// Nobody is left to receive it, and the exit path owns that fact.
		if (delivery === 'channel-closed') {
			this.recordDiagnostic('channel-closed', {
				consecutiveFailures: this.state.consecutiveCrashes,
			});
			return;
		}
		// A huge success payload is ordinary discovery evidence (lsof of a Node
		// tree), not a protocol violation. Fail the pending observe() so the
		// provider can retry; do not terminate the extension child.
		if (result.ok === false) {
			this.protocolViolation('agent observation result exceeds IPC limit');
			return;
		}
		const failure = {
			contextId: result.contextId,
			ok: false as const,
			failure: 'agent observation result exceeds IPC limit',
		};
		this.sendOrViolate(
			{
				protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION,
				kind: 'agent.observation.result',
				id,
				payload: failure,
			},
			'agent observation result exceeds IPC limit',
		);
	}

	private sendAgentLifecycleAck(
		id: string,
		acknowledgement: {
			readonly contextId: string;
			readonly publicationId: string;
			readonly acceptedEventCount: number;
			readonly rejectedEventCount: number;
			readonly failure?: string;
		},
	): void {
		this.sendOrViolate(
			{
				protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION,
				kind: 'agent.lifecycle.ack',
				id,
				payload: acknowledgement,
			},
			'agent lifecycle acknowledgement exceeds IPC limit',
		);
	}

	private async retireAgentContext(
		contextId: string,
		reason: ExtensionAgentTerminalCancellation['reason'],
	): Promise<void> {
		const context = this.agentContexts.get(contextId);
		if (context === undefined) return;
		this.agentContexts.delete(contextId);
		await this.options.agents?.terminalCancelled?.({
			extensionId: this.extensionId,
			providerId: context.providerId,
			terminal: context,
			reason,
		});
	}

	private async resolveSecret(
		input: unknown,
		signal: AbortSignal,
	): Promise<unknown> {
		if (this.options.secrets === undefined || this.descriptor === undefined)
			throw new Error('extension secret broker is unavailable');
		if (signal.aborted) throw new Error('extension secret access cancelled');
		const request = record(input);
		const profileId = boundedId(request?.profileId);
		const fieldId = boundedId(request?.fieldId);
		if (profileId === undefined || fieldId === undefined)
			throw new Error('extension secret access is denied');
		return this.options.secrets.withSecret(
			{
				extensionId: this.extensionId,
				permissions: new Set(
					this.descriptor.permissions.map((permission) =>
						permission === 'secrets:resolve'
							? 'extension-secrets:resolve'
							: permission,
					),
				),
			},
			{ profileId, fieldId },
			(secret) => {
				if (signal.aborted)
					throw new Error('extension secret access cancelled');
				// The numeric array is the one bounded structured-clone copy crossing
				// private IPC. The vault/broker-owned Uint8Array is cleared by its
				// callback lifetime before this method returns.
				return [...secret];
			},
		);
	}

	private sendBrokerResult(
		id: string,
		value?: unknown,
		failure?: string,
	): void {
		const payload =
			failure === undefined ? { ok: true, value } : { ok: false, failure };
		this.sendOrViolate(
			{
				protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION,
				kind: 'broker.result',
				id,
				payload,
			},
			'broker response exceeds IPC limit',
		);
	}

	private finishPending(id: string, result?: unknown, error?: Error): void {
		const pending = this.pending.get(id);
		if (pending === undefined) return;
		this.pending.delete(id);
		clearTimeout(pending.timer);
		if (pending.abort !== undefined) {
			/* listener is once and harmless after settlement */
		}
		error === undefined ? pending.resolve(result) : pending.reject(error);
	}

	/**
	 * Count one language server death against this extension.
	 *
	 * A language server is a child of the extension child, so its death does not
	 * end the extension. It is still this extension's failure: the crash window
	 * is the same one that decides quarantine, and the child reports each death
	 * exactly once, so nothing here can count one death twice.
	 */
	private recordLanguageServerCrash(exit: ExtensionLanguageSessionExit): void {
		const error = new Error(
			`language server ${exit.languageServerId} exited (${exit.exitCode ?? exit.signal ?? 'unknown'})`,
		);
		const now = this.now();
		this.crashTimes.push(now);
		while ((this.crashTimes[0] ?? now) < now - this.limits.crashWindowMs)
			this.crashTimes.shift();
		const crashes = this.crashTimes.length;
		this.recordDiagnostic('failed', {
			consecutiveFailures: crashes,
			error: extensionErrorDetail(error),
		});
		if (crashes < this.limits.maxCrashesInWindow) return;
		// Repeated language server deaths are a crash loop like any other, and
		// quarantine is what stops one. Ending the child ends its sessions, and
		// nothing it still owed can arrive afterwards, so settle it all here.
		this.terminateChild();
		this.rejectPending(error);
		this.setState({
			extensionId: this.extensionId,
			state: 'quarantined',
			consecutiveCrashes: crashes,
			failure: safeFailure(error),
		});
		this.recordDiagnostic('quarantined', {
			consecutiveFailures: crashes,
			error: extensionErrorDetail(error),
		});
	}

	private protocolViolation(message: string): void {
		this.terminateChild();
		this.recordFailure(new Error(message));
	}
	private childFailed(error: Error): void {
		if (!this.stopping) this.recordFailure(error);
	}
	private childExited(code: number | null, signal: string | null): void {
		this.child = undefined;
		// Recorded whatever the reason, and before the failure branch below, so a
		// child that died without reporting still leaves its exit status behind.
		this.exitRecorded = true;
		this.recordDiagnostic('child-exited', {
			exitCode: code,
			signal,
			deliberate: this.stopping,
			...(this.fatalReport === undefined
				? {}
				: {
						error: {
							name: this.fatalReport.name,
							message: this.fatalReport.message,
							...(this.fatalReport.stack === undefined
								? {}
								: { stack: this.fatalReport.stack }),
						},
					}),
		});
		this.rejectPending(new Error('extension child exited'));
		for (const controller of this.activeBrokerCalls.values())
			controller.abort();
		this.activeBrokerCalls.clear();
		void this.drainAgentObservers('extension-stopped');
		if (
			!this.stopping &&
			this.state.state !== 'failed' &&
			this.state.state !== 'quarantined'
		)
			this.recordFailure(
				new Error(`extension child exited (${code ?? signal ?? 'unknown'})`),
			);
	}

	/**
	 * Count one death, however many operations discover it.
	 *
	 * A child ending fails everything that was in flight at the time, and the
	 * bridge admits dozens of publications per context. Counting each discovery
	 * turned one death into ten crashes in two milliseconds, which cleared a
	 * threshold meant to describe repeated deaths over a minute. The failure is
	 * recorded either way; only the crash window is left alone once the child
	 * for this incarnation has already gone.
	 */
	private recordFailure(error: Error): void {
		if (this.child === undefined && this.deathCounted) {
			this.recordDiagnostic('failed', {
				consecutiveFailures: this.state.consecutiveCrashes,
				error: extensionErrorDetail(error),
				afterChildGone: true,
			});
			this.rejectPending(error);
			return;
		}
		this.deathCounted = true;
		const now = this.now();
		this.crashTimes.push(now);
		while ((this.crashTimes[0] ?? now) < now - this.limits.crashWindowMs)
			this.crashTimes.shift();
		const crashes = this.crashTimes.length;
		this.rejectPending(error);
		this.agentProviders = Object.freeze([]);
		// The child's own report is the only account of what actually threw; the
		// host-side error is usually just the exit that followed it.
		const detail = this.reportedFatalDetail() ?? extensionErrorDetail(error);
		this.recordDiagnostic('failed', {
			consecutiveFailures: crashes,
			error: detail,
		});
		if (crashes >= this.limits.maxCrashesInWindow) {
			this.setState({
				extensionId: this.extensionId,
				state: 'quarantined',
				consecutiveCrashes: crashes,
				failure: safeFailure(error),
			});
			this.recordDiagnostic('quarantined', {
				consecutiveFailures: crashes,
				error: detail,
			});
			return;
		}
		const backoff = Math.min(
			this.limits.initialBackoffMs * 2 ** Math.max(0, crashes - 1),
			this.limits.maxBackoffMs,
		);
		const restartAt = now + backoff;
		this.setState({
			extensionId: this.extensionId,
			state: 'failed',
			consecutiveCrashes: crashes,
			restartAt,
			failure: safeFailure(error),
		});
		this.recordDiagnostic('restart-scheduled', {
			consecutiveFailures: crashes,
			restartAt,
		});
	}

	/** Publish state once, so no transition can reach a supervisor unobserved. */
	private setState(next: ExtensionHostStatus): void {
		this.state = next;
		try {
			this.options.onStateChange?.(this.status());
		} catch {
			/* an observer must never change a lifecycle transition */
		}
	}

	private recordDiagnostic(
		transition: ExtensionHostTransition,
		detail: Omit<ExtensionHostDiagnostic, 'extensionId' | 'transition' | 'at'>,
	): void {
		const listener = this.options.onDiagnostic;
		if (listener === undefined) return;
		try {
			listener({
				extensionId: this.extensionId,
				transition,
				at: this.now(),
				...detail,
			});
		} catch {
			/* a diagnostic sink must never break the host it observes */
		}
	}

	/** The child's fatal report, consumed once by the failure it explains. */
	private reportedFatalDetail(): ExtensionErrorDetail | undefined {
		const report = this.fatalReport;
		if (report === undefined) return undefined;
		this.fatalReport = undefined;
		return {
			name: report.name,
			message: report.message,
			...(report.stack === undefined ? {} : { stack: report.stack }),
		};
	}

	/**
	 * Kill a child the host has given up on, without claiming to know how it
	 * died.
	 *
	 * Detaching the listeners drops the `exit` event that carries the real code
	 * or signal, so a child that had already ended used to be recorded as this
	 * SIGKILL instead — the host's own kill overwriting the evidence of the
	 * death it was reacting to. An exit already observed for this child is left
	 * to stand, and this records only what it is: the host terminating it.
	 */
	private terminateChild(): void {
		const child = this.child;
		this.child = undefined;
		if (child === undefined) return;
		if (!this.exitRecorded)
			this.recordDiagnostic('child-terminated', {
				deliberate: this.stopping,
				...(this.fatalReport === undefined
					? {}
					: { error: this.reportedFatalDetail() }),
			});
		child.removeAllListeners();
		child.kill('SIGKILL');
	}
	private rejectPending(error: Error): void {
		for (const id of [...this.pending.keys()])
			this.finishPending(id, undefined, error);
	}
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
function failureMessage(value: unknown): string {
	const message = record(value)?.message;
	return typeof message === 'string'
		? message.slice(0, 1_000)
		: 'extension operation failed';
}
function safeFailure(error: Error): string {
	return error.message.replace(/[\r\n]/gu, ' ').slice(0, 1_000);
}
function boundedId(value: unknown): string | undefined {
	return typeof value === 'string' &&
		/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value)
		? value
		: undefined;
}
function validateAgentProviders(
	value: unknown,
	descriptor: ExtensionLaunchDescriptor,
): readonly AgentProviderContribution[] {
	if (
		!Array.isArray(value) ||
		value.length > 32 ||
		(value.length > 0 && !descriptor.permissions.includes('agent-observation'))
	) {
		throw new Error('extension returned invalid agent provider registrations');
	}
	const declared = new Map(
		(descriptor.agentProviders ?? []).map((provider) => [
			provider.id,
			provider,
		]),
	);
	const seen = new Set<string>();
	const result: AgentProviderContribution[] = [];
	for (const valueId of value) {
		if (
			typeof valueId !== 'string' ||
			seen.has(valueId) ||
			!isNamespacedId(valueId, descriptor.extensionId)
		)
			throw new Error(
				'extension returned invalid agent provider registrations',
			);
		const contribution = declared.get(valueId);
		if (contribution === undefined)
			throw new Error('extension registered an undeclared agent provider');
		seen.add(valueId);
		result.push(structuredClone(contribution));
	}
	return Object.freeze(result);
}

/** Every language server the child registered must be one the manifest
 * contributed, exactly as agent providers are. An undeclared registration is
 * an activation failure, not a silently ignored contribution. */
function validateLanguageServers(
	value: unknown,
	descriptor: ExtensionLaunchDescriptor,
): readonly LanguageServerContribution[] {
	if (value === undefined) return Object.freeze([]);
	if (!Array.isArray(value) || value.length > 32)
		throw new Error('extension returned invalid language server registrations');
	const declared = new Map(
		(descriptor.languageServers ?? []).map((contribution) => [
			contribution.id,
			contribution,
		]),
	);
	const seen = new Set<string>();
	const result: LanguageServerContribution[] = [];
	for (const id of value) {
		if (typeof id !== 'string' || seen.has(id))
			throw new Error(
				'extension returned invalid language server registrations',
			);
		const contribution = declared.get(id);
		if (contribution === undefined)
			throw new Error('extension registered an undeclared language server');
		seen.add(id);
		result.push(structuredClone(contribution));
	}
	return Object.freeze(result);
}

function unavailable(message: string): Error {
	return Object.assign(new Error(message), {
		code: 'unavailable',
		retryable: true,
	});
}

function validateAgentTerminalAdmission(
	value: ExtensionAgentTerminalAdmission,
	extensionId: string,
	providers: readonly AgentProviderContribution[],
): ExtensionAgentTerminalContext {
	const context = value?.context;
	if (
		!context ||
		!boundedId(context.contextId) ||
		!boundedId(context.serverId) ||
		!boundedId(context.projectId) ||
		!boundedId(context.terminalSessionId) ||
		!boundedId(context.terminalIncarnationId) ||
		!boundedId(context.providerId) ||
		!providers.some((provider) => provider.id === context.providerId)
	) {
		throw new Error(
			'agent terminal admission is outside the registered provider scope',
		);
	}
	if (
		context.shellPid !== undefined &&
		(!Number.isInteger(context.shellPid) ||
			context.shellPid <= 0 ||
			context.shellPid > 4_194_304)
	) {
		throw new Error('agent terminal admission has an invalid shell pid');
	}
	if (
		context.ttyPath !== undefined &&
		(typeof context.ttyPath !== 'string' ||
			context.ttyPath.length === 0 ||
			context.ttyPath.length > 4_096)
	) {
		throw new Error('agent terminal admission has an invalid tty path');
	}
	if (
		!Array.isArray(value.observationCapabilities) ||
		value.observationCapabilities.length > 16 ||
		value.observationCapabilities.some(
			(capability) =>
				typeof capability !== 'string' ||
				capability.length === 0 ||
				capability.length > 100,
		)
	) {
		throw new Error(
			'agent terminal admission has invalid observation capabilities',
		);
	}
	// The manager is the only API that calls this method; this check documents
	// and enforces the same extension/provider namespace ownership at runtime.
	if (!isNamespacedId(context.providerId, extensionId))
		throw new Error('agent terminal admission provider is invalid');
	return Object.freeze(structuredClone(context));
}

function parseAgentObservationRequest(
	value: unknown,
): ExtensionAgentObservationRequest | undefined {
	const payload = record(value);
	const contextId = boundedId(payload?.contextId);
	const providerId = boundedId(payload?.providerId);
	const operation = payload?.operation;
	if (
		!contextId ||
		!providerId ||
		typeof operation !== 'string' ||
		![
			'process.foreground',
			'process.descendants',
			'process.open-files',
			'process.environment',
			'terminal.tty',
			'filesystem.resolve-home-relative',
			'filesystem.resolve-home-directory',
			'filesystem.resolve-path-under-home',
			'filesystem.home-relative-path',
			'filesystem.resolve-relative-to-environment',
			'filesystem.resolve-directory-relative-to-environment',
			'filesystem.resolve-path-under-environment',
			'filesystem.environment-relative-path',
			'filesystem.list-directory',
			'filesystem.watch-directory',
			'filesystem.unwatch-directory',
			'filesystem.realpath',
			'filesystem.stat',
			'filesystem.read',
			'filesystem.follow',
			'filesystem.unfollow',
		].includes(operation) ||
		!jsonValue(payload?.payload)
	)
		return undefined;
	return Object.freeze({
		contextId,
		providerId,
		operation:
			operation as import('./types.js').ExtensionAgentObservationOperation,
		payload: structuredClone(
			payload!.payload,
		) as import('@terminay/extension-api').JsonValue,
	});
}

function parseAgentLifecyclePublication(
	value: unknown,
): ExtensionAgentLifecyclePublication | undefined {
	const payload = record(value);
	const contextId = boundedId(payload?.contextId);
	const providerId = boundedId(payload?.providerId);
	const publicationId = boundedId(payload?.publicationId);
	if (
		!contextId ||
		!providerId ||
		!publicationId ||
		typeof payload?.mappingVersion !== 'string' ||
		payload.mappingVersion.length === 0 ||
		payload.mappingVersion.length > 64 ||
		!Array.isArray(payload.events) ||
		payload.events.length > 64 ||
		(payload.binding !== undefined && !jsonValue(payload.binding))
	)
		return undefined;
	const events = [] as import('@terminay/extension-api').AgentLifecycleEvent[];
	for (const event of payload.events) {
		const validation = validateAgentLifecycleEvent(event);
		if (!validation.ok) return undefined;
		events.push(structuredClone(validation.value));
	}
	return Object.freeze({
		contextId,
		providerId,
		publicationId,
		mappingVersion: payload.mappingVersion,
		...(payload.binding === undefined
			? {}
			: {
					binding: structuredClone(
						payload.binding,
					) as import('@terminay/extension-api').JsonValue,
				}),
		events: Object.freeze(events),
	});
}

function jsonValue(
	value: unknown,
	depth = 0,
): value is import('@terminay/extension-api').JsonValue {
	if (
		depth > 8 ||
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean'
	)
		return (
			depth <= 8 && (typeof value !== 'string' || value.length <= 64 * 1024)
		);
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value))
		return (
			value.length <= 256 && value.every((item) => jsonValue(item, depth + 1))
		);
	const objectValue = record(value);
	if (objectValue === undefined || Object.keys(objectValue).length > 128)
		return false;
	return Object.entries(objectValue).every(
		([key, item]) => key.length <= 256 && jsonValue(item, depth + 1),
	);
}
