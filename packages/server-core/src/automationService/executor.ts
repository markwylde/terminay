import { randomUUID } from 'node:crypto';
import type { CommandRequest } from '../types.js';
import type { MacroRepository } from '../macroService/repository.js';
import type { MacroRunner } from '../macroService/runner.js';
import { renderMacroTemplate } from '../macroService/normalize.js';
import type {
	MacroExecutionEnvironment,
	MacroFieldValue,
	MacroTarget,
} from '../macroService/types.js';
import { shellStartupModeFamily } from '../shellProfiles/startupMode.js';
import type {
	TerminalLaunchIntent,
	TerminalResolvedLaunch,
} from '../terminalService/launchResolver.js';
import { nodeTerminalLaunchPathAuthority } from '../terminalService/launchResolver.js';
import { TerminalPresentationCheckpointAuthority } from '../terminalService/presentationCheckpoint.js';
import type { TerminalService } from '../terminalService/service.js';
import type {
	TerminalAuthorization,
	TerminalDimensions,
	TerminalEvent,
	TerminalIdentity,
} from '../terminalService/types.js';
import {
	AUTOMATION_SPACE_TERMINAL_LIMIT,
	isAutomationSpace,
	liveAutomationTerminalCount,
	type WorkspaceCommand,
	type WorkspaceState,
	type WorkspaceStore,
} from '../workspace.js';
import { AUTOMATION_PRINCIPAL, type AutomationAuditLog } from './audit.js';
import { boundTail, type AutomationRunLog } from './runLog.js';
import {
	AUTOMATION_OUTPUT_TAIL_BYTES,
	type AutomationDefinition,
	type AutomationRunController,
	type AutomationRunEntry,
	type AutomationRunOutcome,
	type AutomationRunStartRequest,
	type AutomationSkipReason,
	MIN_SUBJECT_ACTION_COOLDOWN_SECONDS,
} from './types.js';

/** Server-wide bound on runs of all automations in progress at once (D8). */
export const AUTOMATION_MAX_CONCURRENT_RUNS = 8;
/** Rows of the run terminal's final presentation kept as its output tail. */
export const AUTOMATION_OUTPUT_TAIL_ROWS = 200;
/** Bound on each `TERMINAY_*` context value, in UTF-8 bytes. */
export const AUTOMATION_CONTEXT_VALUE_BYTES = 1_024;
/** Bound on the loop-guard map; the oldest entries are dropped past it. */
const MAX_LOOP_GUARD_ENTRIES = 10_000;
/** Raw retained output replayed into the tail emulator. */
const TAIL_SOURCE_BYTES = 512 * 1024;
const TAIL_CHUNK_BYTES = 32 * 1024;
const RUN_TERMINAL_DIMENSIONS: TerminalDimensions = Object.freeze({
	cols: 120,
	rows: 32,
});
const MAX_TITLE_LENGTH = 200;

/** Every `TERMINAY_*` name a run's context can set. Inherited values of these
 * names are always removed first, so a run never sees a stale context. */
export const AUTOMATION_CONTEXT_VARIABLES = Object.freeze([
	'TERMINAY_EVENT',
	'TERMINAY_FIRED_AT',
	'TERMINAY_AUTOMATION_ID',
	'TERMINAY_AUTOMATION_NAME',
	'TERMINAY_TERMINAL_HANDLE',
	'TERMINAY_TERMINAL_TITLE',
	'TERMINAY_PROJECT_TITLE',
	'TERMINAY_AGENT_PROVIDER',
	'TERMINAY_AGENT_STATE',
	'TERMINAY_AGENT_OUTCOME',
	'TERMINAY_EXIT_CODE',
	'TERMINAY_DEVICE_NAME',
] as const);

export type AutomationContextVariable =
	(typeof AUTOMATION_CONTEXT_VARIABLES)[number];

/** Told which terminal sessions are run terminals, whose events the trigger
 * module drops so an automation never fires on its own runs. */
export interface AutomationRunTerminalRegistry {
	mark(sessionId: string): void;
	unmark(sessionId: string): void;
}

export interface AutomationExecutorOptions {
	readonly serverId: string;
	readonly runLog: AutomationRunLog;
	readonly terminal: TerminalService;
	readonly workspace: WorkspaceStore;
	/** Host commands against the canonical workspace, published like any other
	 * workspace change. */
	readonly workspaceOperations: {
		readonly applyHostCommand: (
			commandId: string,
			command: WorkspaceCommand,
		) => ReturnType<WorkspaceStore['apply']>;
		readonly ensureAutomationSpace: (root: string) => string;
	};
	/** The canonical launch resolver (profile, cwd, environment, MCP hook). */
	readonly resolveLaunch: (
		intent: TerminalLaunchIntent,
	) => Promise<TerminalResolvedLaunch>;
	/** The server user's home directory: the default working directory. */
	readonly homeDirectory?: () => Promise<string | null>;
	readonly macros?: {
		readonly repository: MacroRepository;
		readonly runner: MacroRunner;
		/** The host's exact PTY/vault environment, given a server-built request
		 * whose context is the automation principal. */
		readonly environmentFor: (
			request: CommandRequest,
			target: MacroTarget,
		) => MacroExecutionEnvironment;
	};
	readonly recordings?: {
		start(
			sessionId: string,
			options: Readonly<Record<string, unknown>>,
		): { readonly recordingId: string | null; readonly status: string };
		finalize?(
			sessionId: string,
			exitCode: number | null,
			signal: number | null,
			lifecycle?: 'completed' | 'failed' | 'interrupted',
		): unknown;
	};
	readonly runTerminalRegistry?: AutomationRunTerminalRegistry;
	readonly audit?: AutomationAuditLog;
	readonly now?: () => number;
	readonly generateRunId?: () => string;
	readonly maxConcurrentRuns?: number;
	readonly setTimer?: (callback: () => void, ms: number) => unknown;
	readonly clearTimer?: (handle: unknown) => void;
}

interface ActiveRun {
	readonly automation: AutomationDefinition;
	readonly requestedBy?: AutomationRunStartRequest['actor'];
	entry: AutomationRunEntry;
	sessionId?: string;
	macroRunId?: string;
	stopRequested: boolean;
	timedOut: boolean;
	timer?: unknown;
}

/**
 * Executes automation runs (D7–D9): a command in a new terminal in the
 * automation space, or a Macro / text on the exact subject terminal. Every run
 * executes under the server-internal automation principal.
 */
export class AutomationExecutor implements AutomationRunController {
	private readonly running = new Map<string, ActiveRun>();
	private readonly loopGuard = new Map<string, number>();
	private readonly runTerminals = new Set<string>();
	private readonly exitWaiters = new Map<
		string,
		(event: Extract<TerminalEvent, { type: 'exit' }>) => void
	>();
	private readonly unsubscribeTerminal: () => void;
	private registry: AutomationRunTerminalRegistry | undefined;
	private readonly now: () => number;
	private readonly maxConcurrentRuns: number;
	private disposed = false;

	constructor(private readonly options: AutomationExecutorOptions) {
		this.now = options.now ?? (() => Date.now());
		this.maxConcurrentRuns =
			options.maxConcurrentRuns ?? AUTOMATION_MAX_CONCURRENT_RUNS;
		this.registry = options.runTerminalRegistry;
		this.unsubscribeTerminal = options.terminal.onEvent((event) => {
			if (event.type !== 'exit') return;
			const waiter = this.exitWaiters.get(event.sessionId);
			if (waiter === undefined) return;
			this.exitWaiters.delete(event.sessionId);
			waiter(event);
		});
	}

	/** Late-bind the trigger module's registry. Sessions already marked are
	 * replayed into it. */
	setRunTerminalRegistry(
		registry: AutomationRunTerminalRegistry | undefined,
	): void {
		this.registry = registry;
		if (registry !== undefined)
			for (const sessionId of this.runTerminals) safely(() => registry.mark(sessionId));
	}

	/** Whether a session is a run terminal (launched to run a command). */
	isRunTerminal(sessionId: string): boolean {
		return this.runTerminals.has(sessionId);
	}

	/**
	 * Record that the terminal `callerSessionId` opened `openedSessionId`
	 * through MCP. The caller resolves to the run that owns it — its run
	 * terminal, or a terminal that run already opened — so terminals opened
	 * by opened terminals join the same run. Resolves to that run's id, or
	 * undefined when the caller belongs to no run (nothing is recorded).
	 */
	async recordOpenedTerminal(
		callerSessionId: string,
		openedSessionId: string,
	): Promise<string | undefined> {
		if (callerSessionId === openedSessionId) return undefined;
		await this.options.runLog.load();
		let runId: string | undefined;
		// The run terminal is known here before its log entry names it.
		for (const run of this.running.values())
			if (run.sessionId === callerSessionId) runId = run.entry.runId;
		runId ??= this.options.runLog.runOwningSession(callerSessionId)?.runId;
		if (runId === undefined) return undefined;
		const entry = await this.options.runLog.addOpenedSession(
			runId,
			openedSessionId,
		);
		const active = this.running.get(runId);
		if (active !== undefined && entry !== undefined)
			active.entry = { ...active.entry, openedSessions: entry.openedSessions ?? [] };
		return entry === undefined ? undefined : runId;
	}

	/** Whether any run of the automation is in progress. The scheduler uses
	 * this for the per-automation no-overlap rule. */
	isRunning(automationId: string): boolean {
		for (const run of this.running.values())
			if (run.automation.id === automationId) return true;
		return false;
	}

	get runningCount(): number {
		return this.running.size;
	}

	/** Whether the loop guard currently suppresses this automation for this
	 * subject terminal. */
	isSuppressed(automationId: string, sessionId: string): boolean {
		const until = this.loopGuard.get(guardKey(automationId, sessionId));
		return until !== undefined && until > this.now();
	}

	async start(request: AutomationRunStartRequest): Promise<AutomationRunEntry> {
		const entry = await this.fire(request);
		if (entry !== undefined) return entry;
		// Suppressed: the latest run of the automation carries the count.
		const latest = this.options.runLog.latest(request.automation.id);
		if (latest !== undefined) return latest;
		const now = this.now();
		return {
			...baseEntry(request, this.runId(), now),
			status: 'finished',
			outcome: 'skipped',
			reason: 'suppressed by the loop guard',
			finishedAt: now,
			durationMs: 0,
		};
	}

	/**
	 * Start a run, or return undefined when the loop guard suppressed a
	 * trigger for the same subject terminal (the suppression is counted on the
	 * automation's latest run instead of being logged individually).
	 */
	async fire(
		request: AutomationRunStartRequest,
	): Promise<AutomationRunEntry | undefined> {
		await this.options.runLog.load();
		const { automation } = request;
		const subjectSessionId =
			request.subject?.kind === 'terminal' ? request.subject.sessionId : undefined;
		if (request.startedBy === 'trigger' && subjectSessionId !== undefined) {
			this.pruneLoopGuard();
			if (this.isSuppressed(automation.id, subjectSessionId)) {
				await this.options.runLog.addSuppressed(automation.id);
				return undefined;
			}
		}
		if (this.disposed)
			return this.skip(request, 'executorUnavailable', 'the server is stopping');
		if (
			request.startedBy === 'trigger' &&
			automation.trigger.kind === 'schedule' &&
			this.isRunning(automation.id)
		)
			return this.skip(
				request,
				'previousRunStillRunning',
				'the previous run was still running',
			);
		if (this.running.size >= this.maxConcurrentRuns)
			return this.skip(
				request,
				'concurrencyLimit',
				`${this.maxConcurrentRuns} automation runs were already in progress`,
			);
		switch (automation.action.kind) {
			case 'runCommand':
				return this.startCommand(request);
			case 'runMacro':
			case 'writeText':
				return this.startSubjectAction(request);
		}
	}

	async stop(runId: string): Promise<boolean> {
		const run = this.running.get(runId);
		if (run === undefined) return false;
		run.stopRequested = true;
		if (run.macroRunId !== undefined)
			this.options.macros?.runner.cancel(run.macroRunId);
		if (run.sessionId !== undefined)
			await this.options.terminal.kill(run.sessionId).catch(() => undefined);
		return true;
	}

	/** Stop timers and observers. Runs in progress are stopped. */
	async dispose(): Promise<void> {
		this.disposed = true;
		await Promise.allSettled(
			[...this.running.keys()].map((runId) => this.stop(runId)),
		);
		for (const run of this.running.values()) this.clearRunTimer(run);
		this.unsubscribeTerminal();
	}

	// -------------------------------------------------------------------------
	// Run command

	private async startCommand(
		request: AutomationRunStartRequest,
	): Promise<AutomationRunEntry> {
		const { automation } = request;
		if (automation.action.kind !== 'runCommand')
			throw new TypeError('not a run-command automation');
		const action = automation.action;
		const workspace = this.options.workspace;
		const home = await (
			this.options.homeDirectory ?? nodeTerminalLaunchPathAuthority.homeDirectory
		)();
		if (home === null)
			return this.finishImmediately(
				request,
				'failed',
				'a safe home folder could not be resolved on this server',
			);
		let spaceId: string;
		try {
			spaceId = this.options.workspaceOperations.ensureAutomationSpace(home);
		} catch {
			return this.skip(
				request,
				'executorUnavailable',
				'the automation terminal space is unavailable',
			);
		}
		if (
			liveAutomationTerminalCount(workspace.state) >=
			AUTOMATION_SPACE_TERMINAL_LIMIT
		)
			return this.skip(
				request,
				'automationSpaceFull',
				`the automation space already holds ${AUTOMATION_SPACE_TERMINAL_LIMIT} live terminals`,
			);

		const run = await this.begin(request);
		const identity = this.options.terminal.allocateIdentity(spaceId);
		const sessionId = identity.sessionId;
		let exited: Promise<Extract<TerminalEvent, { type: 'exit' }>>;
		try {
			const resolved = await this.options.resolveLaunch({
				identity,
				...(action.shellProfileId === undefined
					? {}
					: { explicitProfileId: action.shellProfileId }),
				explicitCwd: action.cwd ?? home,
				...RUN_TERMINAL_DIMENSIONS,
			});
			const launch = nonInteractiveLaunch(
				resolved,
				action.command,
				this.contextEnvironment(request),
			);
			// Tag before spawn so the terminal's very first events are dropped.
			this.markRunTerminal(sessionId);
			const recordingId = this.startRecording(run, sessionId, launch);
			exited = new Promise((resolve) => this.exitWaiters.set(sessionId, resolve));
			try {
				await this.options.terminal.createResolvedSession(launch);
			} catch (error) {
				this.exitWaiters.delete(sessionId);
				if (recordingId !== undefined)
					safely(() =>
						this.options.recordings?.finalize?.(sessionId, null, null, 'failed'),
					);
				throw error;
			}
			run.sessionId = sessionId;
			const created = this.options.workspaceOperations.applyHostCommand(
				`auto-run:${sessionId}`.slice(0, 128),
				{
					type: 'terminal.createPanel',
					sessionId,
					projectId: spaceId,
					panelId: panelIdFor(sessionId),
					title: boundedLine(automation.name, MAX_TITLE_LENGTH),
					cwd: launch.cwd,
					createdAt: launch.createdAt,
					launch: {
						profileId: launch.profile.id,
						profileRevision: launch.profile.revision,
						profileName: launch.profile.name,
						targetSummary: launch.profile.targetSummary,
						workspaceRevision: launch.workspaceRevision,
						settingsRevision: launch.settingsRevision,
					},
				},
			);
			if (!created.ok) {
				this.exitWaiters.delete(sessionId);
				await this.options.terminal.kill(sessionId).catch(() => undefined);
				throw new Error('the run terminal could not join the automation space');
			}
			// A command can exit before its panel exists; the workspace's own exit
			// marker then found no session, so record the exit here.
			const live = this.options.terminal.getSession(sessionId);
			if (live !== undefined && live.status !== 'running')
				safely(() =>
					this.options.workspaceOperations.applyHostCommand(
						`auto-exit:${sessionId}`.slice(0, 128),
						{
							type: 'terminal.markExited',
							sessionId,
							...(live.exit === undefined
								? {}
								: { exitCode: live.exit.exitCode, at: live.exit.at }),
						},
					),
				);
			await this.update(run, {
				sessionId,
				...(recordingId === undefined ? {} : { recordingId }),
			});
			if (run.stopRequested)
				await this.options.terminal.kill(sessionId).catch(() => undefined);
			run.timer = (this.options.setTimer ?? defaultSetTimer)(() => {
				run.timedOut = true;
				// The normal terminal close path; its exit ends the run.
				void this.options.terminal.kill(sessionId).catch(() => undefined);
			}, action.maxDurationSeconds * 1000);
		} catch (error) {
			this.exitWaiters.delete(sessionId);
			this.unmarkRunTerminal(sessionId);
			return this.complete(run, {
				outcome: run.stopRequested ? 'stopped' : 'failed',
				reason: failureReason(error, 'the run terminal could not be started'),
			});
		}
		void exited
			.then((event) => this.commandExited(run, sessionId, event))
			.catch(() => undefined);
		return run.entry;
	}

	private async commandExited(
		run: ActiveRun,
		sessionId: string,
		event: Extract<TerminalEvent, { type: 'exit' }>,
	): Promise<void> {
		this.clearRunTimer(run);
		const outputTail = await this.captureOutputTail(sessionId).catch(
			() => undefined,
		);
		const keep = run.automation.settings.keepTerminalAfterRun;
		const outcome: AutomationRunOutcome = run.timedOut
			? 'timedOut'
			: run.stopRequested
				? 'stopped'
				: event.exitCode === 0
					? 'succeeded'
					: 'failed';
		if (!keep) {
			const panelId = panelIdFor(sessionId);
			if (this.options.workspace.state.panels[panelId] !== undefined)
				safely(() =>
					this.options.workspaceOperations.applyHostCommand(
						`auto-close:${sessionId}`.slice(0, 128),
						{ type: 'panel.close', panelId },
					),
				);
			this.unmarkRunTerminal(sessionId);
		}
		this.sweepRunTerminals();
		const { sessionId: _session, ...rest } = run.entry;
		run.entry = keep ? run.entry : (rest as AutomationRunEntry);
		await this.complete(run, {
			outcome,
			exitCode: event.exitCode,
			...(outputTail === undefined ? {} : { outputTail }),
			...(outcome === 'timedOut'
				? {
						reason: `stopped after its maximum duration of ${run.automation.action.kind === 'runCommand' ? run.automation.action.maxDurationSeconds : 0} s`,
					}
				: outcome === 'stopped'
					? { reason: 'stopped by a user' }
					: outcome === 'failed'
						? { reason: `exited with code ${event.exitCode}` }
						: {}),
		});
	}

	/** The run terminal's final presentation: the newest 200 rows rendered by
	 * the same headless emulator `read_terminal` reads, control sequences
	 * stripped, bounded to 16 KiB. The live emulator is released at exit, so
	 * the retained PTY bytes are replayed into a private, bounded one. */
	private async captureOutputTail(
		sessionId: string,
	): Promise<string | undefined> {
		const terminal = this.options.terminal;
		const snapshot = terminal.getSession(sessionId);
		if (snapshot === undefined) return undefined;
		const read = terminal.readRetainedOutput(sessionId, {
			fromPosition: Math.max(
				snapshot.replayFrom,
				snapshot.outputPosition - TAIL_SOURCE_BYTES,
			),
			maxBytes: TAIL_SOURCE_BYTES,
		});
		const bytes = read.bytes;
		let text: string;
		const emulator = new TerminalPresentationCheckpointAuthority({
			maxSessions: 1,
			maxScrollback: AUTOMATION_OUTPUT_TAIL_ROWS * 4,
			maxQueuedBytes: TAIL_SOURCE_BYTES * 2,
			maxTailBytes: TAIL_SOURCE_BYTES * 2,
		});
		const identity: TerminalIdentity = {
			serverId: snapshot.serverId,
			projectId: snapshot.projectId,
			sessionId,
		};
		try {
			emulator.createSession(identity, snapshot.dimensions);
			for (let offset = 0; offset < bytes.byteLength; offset += TAIL_CHUNK_BYTES)
				await emulator.ingestOutput(
					identity,
					offset,
					bytes.subarray(offset, offset + TAIL_CHUNK_BYTES),
				);
			const presentation = await emulator.readPresentation(identity, {
				format: 'text',
				maxRows: AUTOMATION_OUTPUT_TAIL_ROWS,
				maxBytes: AUTOMATION_OUTPUT_TAIL_BYTES * 4,
			});
			text = (presentation.rows ?? []).join('\n');
		} catch {
			text = new TextDecoder().decode(bytes);
		} finally {
			emulator.close();
		}
		const cleaned = stripControlSequences(text)
			.split('\n')
			.map((row) => row.replace(/\s+$/u, ''))
			.join('\n')
			.replace(/\n+$/u, '');
		const rows = cleaned.split('\n');
		return boundTail(
			rows.slice(-AUTOMATION_OUTPUT_TAIL_ROWS).join('\n'),
			AUTOMATION_OUTPUT_TAIL_BYTES,
		);
	}

	private startRecording(
		run: ActiveRun,
		sessionId: string,
		launch: TerminalResolvedLaunch,
	): string | undefined {
		if (!run.automation.settings.recordSession) return undefined;
		const recordings = this.options.recordings;
		if (recordings === undefined) return undefined;
		try {
			const state = recordings.start(sessionId, {
				serverId: this.options.serverId,
				projectId: launch.identity.projectId,
				projectName: 'Automations',
				title: boundedLine(run.automation.name, MAX_TITLE_LENGTH),
				cwd: launch.cwd,
				shell: launch.shellPath,
				cols: launch.cols,
				rows: launch.rows,
			});
			// A recording failure never fails the run.
			return state.status === 'recording' && state.recordingId !== null
				? state.recordingId
				: undefined;
		} catch {
			return undefined;
		}
	}

	// -------------------------------------------------------------------------
	// Subject actions

	private async startSubjectAction(
		request: AutomationRunStartRequest,
	): Promise<AutomationRunEntry> {
		const { automation } = request;
		const subject = request.subject;
		if (subject?.kind !== 'terminal')
			return this.skip(request, 'subjectGone', 'the event had no subject terminal');
		const target: MacroTarget = {
			serverId: subject.serverId,
			projectId: subject.projectId,
			sessionId: subject.sessionId,
		};
		if (!this.subjectIsCurrent(request))
			return this.skip(request, 'subjectGone', 'the subject terminal was gone');
		const run = await this.begin(request);
		this.guard(automation, subject.sessionId);
		try {
			if (automation.action.kind === 'writeText') {
				const text = renderMacroTemplate(
					automation.action.text,
					templateValues(this.contextEnvironment(request)),
				);
				const authorization: TerminalAuthorization = {
					...target,
					clientId: AUTOMATION_PRINCIPAL.clientId,
					scope: 'write',
				};
				// Revalidate immediately before acting: never the closest match.
				if (!this.subjectIsCurrent(request))
					return this.complete(run, {
						outcome: 'skipped',
						skipReason: 'subjectGone',
						reason: 'the subject terminal was gone',
					});
				if (text.length > 0)
					await this.options.terminal.input(target, text, authorization);
				if (automation.action.submit) {
					if (!this.subjectIsCurrent(request))
						return this.complete(run, {
							outcome: 'failed',
							reason: 'the subject terminal went away before submit',
						});
					await this.options.terminal.input(target, '\r', authorization);
				}
				return this.complete(run, { outcome: 'succeeded' });
			}
			if (automation.action.kind !== 'runMacro')
				throw new TypeError('not a subject action');
			const macros = this.options.macros;
			if (macros === undefined)
				return this.complete(run, {
					outcome: 'failed',
					reason: 'macros are unavailable on this server',
				});
			const macroId = automation.action.macroId;
			const macro = (await macros.repository.load()).macros.find(
				(candidate) => candidate.id === macroId,
			);
			if (macro === undefined)
				return this.complete(run, {
					outcome: 'failed',
					reason: 'the macro is no longer available',
				});
			const environment = macros.environmentFor(
				automationPrincipalRequest(this.now()),
				target,
			);
			if (!this.subjectIsCurrent(request))
				return this.complete(run, {
					outcome: 'skipped',
					skipReason: 'subjectGone',
					reason: 'the subject terminal was gone',
				});
			const handle = macros.runner.start(macro, { ...environment, target }, {
				authorization: { target, scope: 'write' },
				values: automation.action.fieldValues,
				// There is no launching client whose disconnect could cancel it.
				disconnectPolicy: 'continue',
			});
			run.macroRunId = handle.runId;
			void handle.promise
				.then((snapshot) =>
				this.complete(run, {
					outcome:
						snapshot.status === 'completed'
							? 'succeeded'
							: snapshot.status === 'canceled'
								? 'stopped'
								: 'failed',
					...(snapshot.status === 'failed'
						? { reason: `the macro failed (${snapshot.errorCode ?? 'error'})` }
						: snapshot.status === 'canceled'
							? { reason: 'stopped by a user' }
							: {}),
				}),
				)
				.catch(() => undefined);
			return run.entry;
		} catch (error) {
			return this.complete(run, {
				outcome: 'failed',
				reason: failureReason(error, 'the action failed'),
			});
		}
	}

	/** Re-resolve the subject session and its incarnation. */
	private subjectIsCurrent(request: AutomationRunStartRequest): boolean {
		const subject = request.subject;
		if (subject?.kind !== 'terminal') return false;
		if (subject.serverId !== this.options.serverId) return false;
		const session = this.options.terminal.getSession(subject.sessionId);
		if (
			session === undefined ||
			session.status !== 'running' ||
			session.serverId !== subject.serverId ||
			session.projectId !== subject.projectId
		)
			return false;
		if (
			subject.sessionCreatedAt !== undefined &&
			session.createdAt !== subject.sessionCreatedAt
		)
			return false;
		const canonical =
			this.options.workspace.state.terminalSessions[subject.sessionId];
		return (
			canonical !== undefined &&
			canonical.projectId === subject.projectId &&
			canonical.status === 'running'
		);
	}

	// -------------------------------------------------------------------------
	// Loop guard

	private guard(automation: AutomationDefinition, sessionId: string): void {
		const subjectAction = automation.action.kind !== 'runCommand';
		const configured = automation.settings.cooldownSeconds;
		const seconds = subjectAction
			? Math.max(MIN_SUBJECT_ACTION_COOLDOWN_SECONDS, configured)
			: configured;
		if (seconds <= 0) return;
		const key = guardKey(automation.id, sessionId);
		this.loopGuard.delete(key);
		this.loopGuard.set(key, this.now() + seconds * 1000);
		while (this.loopGuard.size > MAX_LOOP_GUARD_ENTRIES) {
			const oldest = this.loopGuard.keys().next().value;
			if (oldest === undefined) break;
			this.loopGuard.delete(oldest);
		}
	}

	private pruneLoopGuard(): void {
		const now = this.now();
		for (const [key, until] of this.loopGuard)
			if (until <= now) this.loopGuard.delete(key);
	}

	// -------------------------------------------------------------------------
	// Context

	/** Validated, bounded, newline-free `TERMINAY_*` context. Built only from
	 * the trigger, the definition, and canonical workspace titles: never a
	 * token, secret, terminal output, or provider journal content. */
	contextEnvironment(
		request: AutomationRunStartRequest,
	): Readonly<Partial<Record<AutomationContextVariable, string>>> {
		const { automation, subject, context } = request;
		const state: WorkspaceState = this.options.workspace.state;
		const values: Partial<Record<AutomationContextVariable, string>> = {
			TERMINAY_EVENT:
				request.event ??
				(automation.trigger.kind === 'schedule' ? 'schedule' : 'manual'),
			TERMINAY_FIRED_AT: new Date(request.firedAt).toISOString(),
			TERMINAY_AUTOMATION_ID: automation.id,
			TERMINAY_AUTOMATION_NAME: automation.name,
		};
		if (subject?.kind === 'terminal') {
			values.TERMINAY_TERMINAL_HANDLE = subject.sessionId;
			const panel = Object.values(state.panels).find(
				(candidate) =>
					candidate.type === 'terminal' &&
					candidate.sessionId === subject.sessionId,
			);
			const title = panel?.title ?? subject.title;
			if (title !== undefined) values.TERMINAY_TERMINAL_TITLE = title;
			const project = state.projects[subject.projectId];
			const projectTitle =
				project === undefined
					? subject.projectTitle
					: isAutomationSpace(project)
						? 'Automations'
						: project.name;
			if (projectTitle !== undefined)
				values.TERMINAY_PROJECT_TITLE = projectTitle;
		} else if (subject?.kind === 'project') {
			const title = state.projects[subject.projectId]?.name ?? subject.title;
			if (title !== undefined) values.TERMINAY_PROJECT_TITLE = title;
		} else if (subject?.kind === 'device' && subject.name !== undefined) {
			values.TERMINAY_DEVICE_NAME = subject.name;
		}
		if (context?.agentProvider !== undefined)
			values.TERMINAY_AGENT_PROVIDER = context.agentProvider;
		if (context?.agentState !== undefined)
			values.TERMINAY_AGENT_STATE = context.agentState;
		if (context?.agentOutcome !== undefined)
			values.TERMINAY_AGENT_OUTCOME = context.agentOutcome;
		if (
			context?.exitCode !== undefined &&
			Number.isSafeInteger(context.exitCode)
		)
			values.TERMINAY_EXIT_CODE = String(context.exitCode);
		const bounded: Partial<Record<AutomationContextVariable, string>> = {};
		for (const [name, value] of Object.entries(values) as [
			AutomationContextVariable,
			string,
		][]) {
			const safe = boundedLine(value, AUTOMATION_CONTEXT_VALUE_BYTES);
			if (safe.length > 0) bounded[name] = safe;
		}
		return Object.freeze(bounded);
	}

	// -------------------------------------------------------------------------
	// Run log

	private async begin(request: AutomationRunStartRequest): Promise<ActiveRun> {
		const now = this.now();
		const entry = await this.options.runLog.record({
			...baseEntry(request, this.runId(), now),
			status: 'running',
		});
		const run: ActiveRun = {
			automation: request.automation,
			...(request.actor === undefined ? {} : { requestedBy: request.actor }),
			entry,
			stopRequested: false,
			timedOut: false,
		};
		this.running.set(entry.runId, run);
		this.audit(request, entry, 'automation.run.started');
		return run;
	}

	private async update(
		run: ActiveRun,
		patch: Partial<AutomationRunEntry>,
	): Promise<void> {
		run.entry = await this.options.runLog.record({ ...run.entry, ...patch });
	}

	private async complete(
		run: ActiveRun,
		result: {
			readonly outcome: AutomationRunOutcome;
			readonly skipReason?: AutomationSkipReason;
			readonly reason?: string;
			readonly exitCode?: number;
			readonly outputTail?: string;
		},
	): Promise<AutomationRunEntry> {
		if (!this.running.has(run.entry.runId)) return run.entry;
		this.running.delete(run.entry.runId);
		this.clearRunTimer(run);
		const finishedAt = Math.max(this.now(), run.entry.startedAt);
		// The run log keeps the suppression count it may have gained meanwhile.
		const current = this.options.runLog.get(run.entry.runId) ?? run.entry;
		run.entry = await this.options.runLog.record({
			...run.entry,
			suppressedEvents: current.suppressedEvents,
			status: 'finished',
			...result,
			...(result.reason === undefined
				? {}
				: { reason: boundedLine(result.reason, 512) }),
			finishedAt,
			durationMs: finishedAt - run.entry.startedAt,
		});
		this.options.audit?.record({
			type: 'run',
			operation: 'automation.run.finished',
			principal: 'automation',
			actor: AUTOMATION_PRINCIPAL,
			...(run.requestedBy === undefined ? {} : { requestedBy: run.requestedBy }),
			automationId: run.entry.automationId,
			runId: run.entry.runId,
			outcome: result.outcome,
			...(result.skipReason === undefined
				? {}
				: { skipReason: result.skipReason }),
		});
		return run.entry;
	}

	private async skip(
		request: AutomationRunStartRequest,
		skipReason: AutomationSkipReason,
		reason: string,
	): Promise<AutomationRunEntry> {
		return this.finishImmediately(request, 'skipped', reason, skipReason);
	}

	private async finishImmediately(
		request: AutomationRunStartRequest,
		outcome: AutomationRunOutcome,
		reason: string,
		skipReason?: AutomationSkipReason,
	): Promise<AutomationRunEntry> {
		const now = this.now();
		const entry = await this.options.runLog.record({
			...baseEntry(request, this.runId(), now),
			status: 'finished',
			outcome,
			...(skipReason === undefined ? {} : { skipReason }),
			reason,
			finishedAt: now,
			durationMs: 0,
		});
		this.audit(request, entry, 'automation.run.finished');
		return entry;
	}

	private audit(
		request: AutomationRunStartRequest,
		entry: AutomationRunEntry,
		operation: string,
	): void {
		this.options.audit?.record({
			type: 'run',
			operation,
			principal: 'automation',
			actor: AUTOMATION_PRINCIPAL,
			...(request.actor === undefined ? {} : { requestedBy: request.actor }),
			automationId: entry.automationId,
			runId: entry.runId,
			...(entry.outcome === undefined ? {} : { outcome: entry.outcome }),
			...(entry.skipReason === undefined
				? {}
				: { skipReason: entry.skipReason }),
		});
	}

	private runId(): string {
		return this.options.generateRunId?.() ?? `run-${randomUUID()}`;
	}

	private clearRunTimer(run: ActiveRun): void {
		if (run.timer === undefined) return;
		(this.options.clearTimer ?? defaultClearTimer)(run.timer);
		run.timer = undefined;
	}

	// -------------------------------------------------------------------------
	// Run terminal registry

	private markRunTerminal(sessionId: string): void {
		this.runTerminals.add(sessionId);
		const registry = this.registry;
		if (registry !== undefined) safely(() => registry.mark(sessionId));
	}

	private unmarkRunTerminal(sessionId: string): void {
		if (!this.runTerminals.delete(sessionId)) return;
		const registry = this.registry;
		if (registry !== undefined) safely(() => registry.unmark(sessionId));
	}

	/** Kept run terminals stay tagged while they exist; forget the ones a
	 * user has since closed. */
	private sweepRunTerminals(): void {
		const sessions = this.options.workspace.state.terminalSessions;
		for (const sessionId of [...this.runTerminals])
			if (
				sessions[sessionId] === undefined &&
				!this.isActiveSession(sessionId)
			)
				this.unmarkRunTerminal(sessionId);
	}

	private isActiveSession(sessionId: string): boolean {
		for (const run of this.running.values())
			if (run.sessionId === sessionId) return true;
		return false;
	}
}

// ---------------------------------------------------------------------------
// Launch

/**
 * Turn a resolved interactive launch into a non-interactive one that runs
 * `command` and exits: `-l -c` for POSIX shells, `-Command` for PowerShell,
 * `/d /s /c` for cmd, and `sh -lc` inside WSL when the profile names no shell.
 * The profile's own interactive arguments are not used: a run is never an
 * interactive shell.
 */
export function nonInteractiveLaunch(
	resolved: TerminalResolvedLaunch,
	command: string,
	context: Readonly<Partial<Record<AutomationContextVariable, string>>>,
): TerminalResolvedLaunch {
	const isWsl = resolved.args[0] === '--distribution';
	let prefix: string[] = [];
	let shell = resolved.shellPath;
	if (isWsl) {
		prefix = resolved.args.slice(0, 2) as string[];
		if (resolved.args[2] === '--exec' && resolved.args[3] !== undefined) {
			prefix.push('--exec', resolved.args[3]);
			shell = resolved.args[3];
		} else {
			prefix.push('--exec', 'sh');
			shell = 'sh';
		}
	}
	const env: Record<string, string | undefined> = {};
	for (const [name, value] of Object.entries(resolved.env)) {
		// Inherited automation context never leaks into a run.
		if ((AUTOMATION_CONTEXT_VARIABLES as readonly string[]).includes(name.toUpperCase()))
			continue;
		env[name] = value;
	}
	for (const [name, value] of Object.entries(context)) env[name] = value;
	if (isWsl) {
		const names = Object.keys(context);
		const current = (env.WSLENV ?? '').split(':').filter((entry) => entry.length > 0);
		const known = new Set(current.map((entry) => entry.split('/')[0]?.toUpperCase()));
		for (const name of names) if (!known.has(name)) current.push(name);
		env.WSLENV = current.join(':');
	}
	return Object.freeze({
		...resolved,
		args: Object.freeze([...prefix, ...commandArgs(shell, command)]),
		env: Object.freeze(env),
	});
}

function commandArgs(shell: string, command: string): readonly string[] {
	const family = shellStartupModeFamily(shell);
	if (family === 'posix') return ['-l', '-c', command];
	if (family === 'powershell')
		return ['-NoLogo', '-NonInteractive', '-Command', command];
	const name = shell
		.replace(/\\/gu, '/')
		.split('/')
		.at(-1)
		?.replace(/\.exe$/iu, '')
		.toLocaleLowerCase('en-US');
	if (name === 'cmd') return ['/d', '/s', '/c', command];
	// Other shells (nu, xonsh, elvish, ...) take `-c` for a command string.
	return ['-c', command];
}

// ---------------------------------------------------------------------------
// Helpers

function baseEntry(
	request: AutomationRunStartRequest,
	runId: string,
	now: number,
): AutomationRunEntry {
	return {
		runId,
		automationId: request.automation.id,
		triggerKind: request.automation.trigger.kind,
		...(request.event === undefined ? {} : { event: request.event }),
		firedAt: Math.max(0, Math.trunc(request.firedAt)),
		startedBy: request.startedBy,
		...(request.subject === undefined ? {} : { subject: request.subject }),
		status: 'running',
		startedAt: now,
		suppressedEvents: 0,
	};
}

/** The server-built request a host's macro environment sees for a run: the
 * automation principal with write scope, bound to no client connection. */
function automationPrincipalRequest(now: number): CommandRequest {
	const controller = new AbortController();
	return {
		envelope: {
			type: 'command',
			commandId: `automation:${now}`,
			correlationId: `automation:${now}`,
			operation: 'automations.run',
			payload: null,
		},
		body: new Uint8Array(),
		context: {
			connectionId: AUTOMATION_PRINCIPAL.connectionId,
			clientId: AUTOMATION_PRINCIPAL.clientId,
			authScope: 'write',
			signal: controller.signal,
		},
	};
}

/** Event context as template values for the macro Eta subset, by short name:
 * `event`, `firedAt`, `automationId`, `automationName`, `terminalHandle`,
 * `terminalTitle`, `projectTitle`, `agentProvider`, `agentState`,
 * `agentOutcome`, `exitCode`, `deviceName`. */
export function templateValues(
	context: Readonly<Partial<Record<AutomationContextVariable, string>>>,
): Readonly<Record<string, MacroFieldValue>> {
	const values: Record<string, MacroFieldValue> = {};
	for (const [name, value] of Object.entries(context)) {
		const key = name
			.slice('TERMINAY_'.length)
			.toLowerCase()
			.replace(/_([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
		values[key] = value;
	}
	return values;
}

function guardKey(automationId: string, sessionId: string): string {
	return `${automationId}\u0000${sessionId}`;
}

function panelIdFor(sessionId: string): string {
	return `p:${sessionId}`.slice(0, 128);
}

// CSI, OSC (BEL or ST terminated), other two-byte escapes, then any remaining
// C0/C1 control except tab and newline.
const CONTROL_SEQUENCES =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal control sequences
	/\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][\s\S]*?(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]|[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu;

export function stripControlSequences(text: string): string {
	return text.replace(/\r\n/gu, '\n').replace(CONTROL_SEQUENCES, '');
}

/** One line: control characters and line separators become spaces, then the
 * value is cut to `maxBytes` of UTF-8 on a code point boundary. */
function boundedLine(value: string, maxBytes: number): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: newline-free context values
	const line = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, ' ');
	const encoder = new TextEncoder();
	if (encoder.encode(line).byteLength <= maxBytes) return line;
	let result = '';
	let bytes = 0;
	for (const character of line) {
		const size = encoder.encode(character).byteLength;
		if (bytes + size > maxBytes) break;
		result += character;
		bytes += size;
	}
	return result;
}

function failureReason(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message.length > 0)
		return boundedLine(error.message, 512);
	return fallback;
}

function safely(action: () => unknown): void {
	try {
		action();
	} catch {
		/* Observers never change a run's outcome. */
	}
}

function defaultSetTimer(callback: () => void, ms: number): unknown {
	const timer = setTimeout(callback, ms);
	(timer as { unref?: () => void }).unref?.();
	return timer;
}

function defaultClearTimer(handle: unknown): void {
	clearTimeout(handle as ReturnType<typeof setTimeout>);
}
