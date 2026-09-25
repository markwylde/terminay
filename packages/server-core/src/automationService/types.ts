import type { ProtocolId } from '@terminay/protocol';
import type { MacroFieldValue } from '../macroService/types.js';

export const AUTOMATION_SCHEMA_VERSION = 1;
export const AUTOMATION_RUN_LOG_SCHEMA_VERSION = 1;

/** Terminay events an automation can be triggered by. */
export const AUTOMATION_EVENT_KINDS = Object.freeze([
	'agent.finished',
	'agent.needsInput',
	'agent.blocked',
	'terminal.needsAttention',
	'terminal.commandFinished',
	'terminal.idle',
	'project.opened',
	'project.closed',
	'device.connected',
] as const);

export type AutomationEventKind = (typeof AUTOMATION_EVENT_KINDS)[number];

/** Events whose subject is a terminal, and so can serve a subject action. */
export const AUTOMATION_TERMINAL_SUBJECT_EVENTS: ReadonlySet<AutomationEventKind> =
	new Set<AutomationEventKind>([
		'agent.finished',
		'agent.needsInput',
		'agent.blocked',
		'terminal.needsAttention',
		'terminal.commandFinished',
		'terminal.idle',
	]);

export type AutomationTrigger =
	| { readonly kind: 'schedule'; readonly cron: string }
	| { readonly kind: 'event'; readonly event: AutomationEventKind };

export const DEFAULT_AUTOMATION_MAX_DURATION_SECONDS = 3600;
export const DEFAULT_AUTOMATION_COOLDOWN_SECONDS = 60;
/** A subject-terminal action's cooldown can never be shorter than this. */
export const MIN_SUBJECT_ACTION_COOLDOWN_SECONDS = 5;

export type AutomationAction =
	| {
			readonly kind: 'runCommand';
			readonly command: string;
			readonly shellProfileId?: string;
			/** Absent means the user's home directory, never a project root. */
			readonly cwd?: string;
			readonly maxDurationSeconds: number;
	  }
	| {
			readonly kind: 'runMacro';
			readonly macroId: string;
			readonly fieldValues: Readonly<Record<string, MacroFieldValue>>;
	  }
	| { readonly kind: 'writeText'; readonly text: string; readonly submit: boolean };

export type AutomationSubjectActionKind = 'runMacro' | 'writeText';

export interface AutomationSettings {
	readonly keepTerminalAfterRun: boolean;
	readonly recordSession: boolean;
	readonly cooldownSeconds: number;
}

export interface AutomationDefinition {
	readonly id: string;
	readonly name: string;
	readonly enabled: boolean;
	readonly trigger: AutomationTrigger;
	readonly action: AutomationAction;
	readonly settings: AutomationSettings;
	/** Server-maintained: schedule occurrences at or before this epoch-ms time
	 * have been evaluated (run, skipped, or counted as missed). Clients never
	 * set it; it does not advance the definition revision. */
	readonly evaluatedThrough: number;
}

export interface AutomationState {
	readonly schemaVersion: number;
	readonly revision: number;
	readonly cursor: string;
	readonly automations: readonly AutomationDefinition[];
}

export interface AutomationBackend {
	load(): Promise<unknown | undefined>;
	commit(state: AutomationState): Promise<void>;
	backup?(state: AutomationState): Promise<void>;
}

export type AutomationCommand =
	| { readonly type: 'upsert'; readonly automation: unknown }
	| { readonly type: 'remove'; readonly automationId: string }
	| {
			readonly type: 'setEnabled';
			readonly automationId: string;
			readonly enabled: boolean;
	  };

export interface AutomationCommandEnvelope {
	readonly commandId?: ProtocolId;
	readonly expectedRevision?: number;
	readonly command: AutomationCommand;
}

export interface AutomationConflict {
	readonly code: 'conflict';
	readonly currentRevision: number;
	readonly currentCursor: string;
	readonly message: string;
}

export type AutomationApplyResult =
	| {
			readonly ok: true;
			readonly revision: number;
			readonly cursor: string;
			readonly state: AutomationState;
	  }
	| { readonly ok: false; readonly conflict: AutomationConflict };

/** Returns why the expression is refused (and the field at fault), or
 * undefined when it is a valid schedule. */
export type AutomationCronValidator = (
	expression: string,
) => { readonly reason: string; readonly field?: string } | undefined;

/** Resolves the Macro a runMacro action names, to check its field values. */
export type AutomationMacroResolver = (macroId: string) => Promise<
	| {
			readonly fields: readonly {
				readonly name: string;
				readonly required: boolean;
				readonly defaultValue: MacroFieldValue;
			}[];
	  }
	| undefined
>;

export interface AutomationRepositoryOptions {
	readonly now?: () => number;
	readonly validateCron?: AutomationCronValidator;
	readonly resolveMacro?: AutomationMacroResolver;
	readonly generateId?: () => string;
	readonly maxAutomations?: number;
}

// ---------------------------------------------------------------------------
// Run log

export const AUTOMATION_RUN_LOG_LIMIT = 100;
export const AUTOMATION_OUTPUT_TAIL_BYTES = 16 * 1024;
/** Terminals remembered per run as opened by it (the automation space's
 * live-terminal cap). The newest are kept. */
export const AUTOMATION_RUN_OPENED_SESSIONS_LIMIT = 50;

export type AutomationSubject =
	| {
			readonly kind: 'terminal';
			readonly serverId: string;
			readonly projectId: string;
			readonly sessionId: string;
			/** The subject session's incarnation (its `createdAt`) when the event
			 * was observed. The executor refuses to act when the live session's
			 * incarnation differs, so a replaced terminal is never "closest match". */
			readonly sessionCreatedAt?: number;
			readonly title?: string;
			readonly projectTitle?: string;
	  }
	| {
			readonly kind: 'project';
			readonly projectId: string;
			readonly title?: string;
	  }
	| {
			readonly kind: 'device';
			readonly deviceId: string;
			readonly name?: string;
	  };

export type AutomationRunStatus = 'running' | 'finished';

export type AutomationRunOutcome =
	| 'succeeded'
	| 'failed'
	| 'timedOut'
	| 'stopped'
	| 'skipped';

export type AutomationSkipReason =
	| 'previousRunStillRunning'
	| 'subjectGone'
	| 'concurrencyLimit'
	| 'automationSpaceFull'
	| 'executorUnavailable';

export interface AutomationRunEntry {
	readonly runId: string;
	readonly automationId: string;
	readonly triggerKind: 'schedule' | 'event';
	readonly event?: AutomationEventKind;
	/** Epoch ms at which the trigger fired (or the user asked). */
	readonly firedAt: number;
	readonly startedBy: 'trigger' | 'user';
	readonly subject?: AutomationSubject;
	readonly status: AutomationRunStatus;
	readonly outcome?: AutomationRunOutcome;
	readonly skipReason?: AutomationSkipReason;
	/** Bounded, human-readable detail for failed or skipped runs. */
	readonly reason?: string;
	readonly exitCode?: number;
	readonly startedAt: number;
	readonly finishedAt?: number;
	readonly durationMs?: number;
	/** The run terminal's session, while it exists. */
	readonly sessionId?: string;
	/** Terminals the run opened through MCP — directly from its run terminal,
	 * or from a terminal it opened — oldest first, bounded. The Automations
	 * section groups them under this run. */
	readonly openedSessions?: readonly string[];
	/** Final output, control sequences stripped, at most 16 KiB of UTF-8. */
	readonly outputTail?: string;
	/** Events the loop guard suppressed after this run. */
	readonly suppressedEvents: number;
	readonly recordingId?: string;
}

export interface AutomationMissedRecord {
	readonly automationId: string;
	readonly missedCount: number;
	readonly latestDueAt: number;
}

export interface AutomationRunLogState {
	readonly schemaVersion: number;
	/** Oldest first, per automation. */
	readonly runs: Readonly<Record<string, readonly AutomationRunEntry[]>>;
	readonly missed: readonly AutomationMissedRecord[];
}

export interface AutomationRunLogBackend {
	load(): Promise<unknown | undefined>;
	commit(state: AutomationRunLogState): Promise<void>;
}

export type AutomationRunLogChange =
	| { readonly type: 'run'; readonly run: AutomationRunEntry }
	| {
			readonly type: 'missed';
			readonly missed: readonly AutomationMissedRecord[];
	  };

// ---------------------------------------------------------------------------
// Execution seam. The scheduler/executor implements this; the protocol layer
// only delegates "run now" and "stop" to it.

/** Event facts passed to a run as bounded `TERMINAY_*` context. Never a
 * token, secret, terminal output, or provider journal content. */
export interface AutomationEventContext {
	readonly agentProvider?: string;
	readonly agentState?: string;
	/** Agent completion outcome: success | error | cancelled. */
	readonly agentOutcome?: string;
	/** Structured command completion exit code. */
	readonly exitCode?: number;
}

export interface AutomationRunStartRequest {
	/** The definition snapshot the run executes under. Later edits never
	 * change a run in progress. */
	readonly automation: AutomationDefinition;
	readonly startedBy: 'trigger' | 'user';
	readonly firedAt: number;
	readonly event?: AutomationEventKind;
	readonly subject?: AutomationSubject;
	readonly context?: AutomationEventContext;
	/** Present for user-started runs, for audit. The run itself executes under
	 * the server-internal automation principal, never as this client. */
	readonly actor?: {
		readonly clientId: string;
		readonly connectionId: string;
	};
}

export interface AutomationRunController {
	/** Starts a run and returns its first log entry (which may already be a
	 * finished `skipped` entry). */
	start(request: AutomationRunStartRequest): Promise<AutomationRunEntry>;
	/** Stops a run in progress. Resolves false when no such run is running. */
	stop(runId: string): Promise<boolean>;
}
