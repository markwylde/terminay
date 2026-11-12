import type {
	BotFailureCause,
	BotObservationSource,
	BotRecoveryPolicy,
	BotSourceHealth,
} from './botSources.js';
import type { JsonValue } from './errors.js';
import type { BotMessageAttachment } from './botMessages.js';

export const BOTS_CAPABILITY = 'bots.v1';
export const BOT_EVENTS = { changed: 'bots.changed' } as const;
export const BOT_OPERATIONS = Object.freeze({
	triggers: 'bots.triggers.list',
	testSource: 'bots.triggers.test',
	sourceMemory: 'bots.triggers.memory',
	resetSource: 'bots.triggers.reset',
	retrySource: 'bots.triggers.retry',
	resumeTrigger: 'bots.triggers.resume',
	enableBot: 'bots.enable',
	createTrigger: 'bots.triggers.create',
	updateTrigger: 'bots.triggers.update',
	deleteTrigger: 'bots.triggers.delete',
	enableTrigger: 'bots.triggers.enable',
	runTrigger: 'bots.triggers.run',
	previewTrigger: 'bots.triggers.preview',
	upcomingTriggers: 'bots.triggers.upcoming',
	triggerFirings: 'bots.triggers.firings',
	dismissMissedTriggers: 'bots.triggers.dismiss-missed',
	list: 'bots.list',
	queue: 'bots.queue',
	get: 'bots.get',
	save: 'bots.save',
	remove: 'bots.remove',
	sessions: 'bots.sessions',
	session: 'bots.session',
	send: 'bots.send',
	stop: 'bots.stop',
	end: 'bots.end',
	newChat: 'bots.new-chat',
	reviseMessage: 'bots.chat.revise-message',
	clearChat: 'bots.chat.clear',
	continue: 'bots.continue',
	cancelQueued: 'bots.cancel-queued',
	decide: 'bots.decide',
	agents: 'bots.agents',
	memories: 'bots.memories',
	memory: 'bots.memory',
	writeMemory: 'bots.memory.write',
	pinMemory: 'bots.memory.pin',
	deleteMemory: 'bots.memory.delete',
	watchMemories: 'bots.memory.watch',
	unwatchMemories: 'bots.memory.unwatch',
});
/**
 * How a bot signs in. `token` passes a vault-held token or API key; `device`
 * uses the login the agent's own CLI saved in the bot's home after a device
 * sign-in run inside the container. A bot never shares the host's login.
 */
export type BotSignIn =
	| { readonly kind: 'device' }
	| {
			readonly kind: 'token';
			readonly environmentVariable: string;
	  }
	| { readonly kind: 'none' };
export type BotApprovalMode = 'autonomous' | 'ask';
export interface BotProfile {
	readonly enabled?: boolean;
	readonly id: string;
	readonly name: string;
	readonly avatar: string;
	readonly colour: string;
	readonly description: string;
	readonly instructions: string;
	readonly agentId: string;
	readonly modelId: string | null;
	readonly signIn: BotSignIn;
	readonly approvalMode: BotApprovalMode;
	readonly maxTurnMs: number;
	/** Wake the bot to investigate its own failures. Missing reads as true. */
	readonly investigateFailures?: boolean;
	/**
	 * Give each execution workspace-reach Terminay MCP, with no approval
	 * prompts (ADR-0100). Missing reads as false.
	 */
	readonly terminayMcpAccess?: boolean;
	readonly pinnedMemories: readonly string[];
	readonly createdAt: number;
	readonly updatedAt: number;
}
export type BotDraft = Pick<BotProfile, 'name' | 'agentId'> &
	Partial<Omit<BotProfile, 'createdAt' | 'updatedAt'>>;
export type BotSessionState =
	| 'queued'
	| 'running'
	| 'suspended'
	| 'needs-you'
	| 'completed'
	| 'stopped'
	| 'timed-out'
	| 'failed'
	| 'interrupted';
export interface BotFailureRef {
	readonly kind: 'execution' | 'firing' | 'condition';
	readonly sessionId: string | null;
	readonly firingId: string | null;
	readonly triggerId: string | null;
	readonly triggerName: string | null;
	readonly at: number;
	/** Redacted against the bot's credential when accepted; at most 1 KiB. */
	readonly reason: string;
}
export type BotSessionOrigin =
	| { readonly kind: 'chat'; readonly messageId?: string }
	| {
			readonly kind: 'trigger' | 'run-now';
			readonly triggerId: string;
			readonly triggerName: string;
			readonly fireTime: number;
	  }
	| {
			readonly kind: 'failure';
			readonly failures: readonly BotFailureRef[];
			readonly overflow: number;
	  };
export type BotTriggerOrigin = Extract<
	BotSessionOrigin,
	{ readonly kind: 'trigger' | 'run-now' }
>;
export function botTriggerOrigin(
	origin: BotSessionOrigin,
): BotTriggerOrigin | null {
	return origin.kind === 'trigger' || origin.kind === 'run-now' ? origin : null;
}
export interface BotSessionSnapshot {
	readonly agentId: string;
	readonly modelId: string | null;
	readonly signIn: BotSignIn;
	readonly approvalMode: BotApprovalMode;
	readonly instructions: string;
	readonly context: string;
	readonly maxTurnMs: number;
}
export interface BotPermission {
	readonly id: string;
	readonly options: readonly {
		readonly optionId: string;
		readonly name: string;
		readonly kind: string;
	}[];
	readonly toolCall: JsonValue;
}
export interface BotExecutionInboxMessage {
	readonly id: string;
	readonly from: string;
	readonly text: string;
	readonly status: 'accepted' | 'consumed';
	readonly createdAt: number;
}
export interface BotExecutionRuntimeState {
	readonly revision: number;
	readonly epoch: string;
	readonly order: number;
	readonly triggerMessageId: string | null;
	/** The trigger message's attachments, snapshotted at dispatch. */
	readonly triggerAttachments?: readonly BotMessageAttachment[];
	readonly revoked: boolean;
	readonly supersededBy: string | null;
	readonly inbox: readonly BotExecutionInboxMessage[];
	readonly keys: Readonly<Record<string, JsonValue>>;
}
export interface BotSessionRecord {
	readonly runtimeDriver?: 'codex-cli' | 'claude-code-cli';
	readonly runtimeVersion?: string;
	readonly runtime?: BotExecutionRuntimeState;
	readonly id: string;
	readonly botId: string;
	readonly origin: BotSessionOrigin;
	readonly snapshot: BotSessionSnapshot;
	readonly state: BotSessionState;
	readonly startedAt: number;
	readonly endedAt: number | null;
	readonly durationMs: number;
	readonly open: boolean;
	readonly acpSessionId: string | null;
	readonly canLoad: boolean;
	readonly segments: number;
	readonly transcriptBytes: number;
	readonly truncated: boolean;
	readonly runnerOutput: string;
	readonly permission: BotPermission | null;
	readonly permissions: readonly BotPermission[];
	readonly queuedMessage: {
		readonly id: string;
		readonly text: string;
		readonly status: 'queued' | 'not-sent';
	} | null;
	readonly firing: 'pending' | 'sent' | 'skipped' | null;
	readonly reason: string | null;
	readonly cause?: BotFailureCause | null;
	readonly recoveryMayHaveLostUpdates: boolean;
	/** When the server handed the agent its task; null before hand-over. */
	readonly dispatchedAt?: number | null;
	/** Failed startup attempts, oldest first. History only. */
	readonly attempts?: readonly BotStartupAttempt[];
	/** Retries this execution may make, fixed when it was created. */
	readonly retryLimit?: number;
	/** When the next startup attempt is due, while waiting for it. */
	readonly retryAt?: number | null;
	/** The final failure, when the execution ended before hand-over. */
	readonly startupFailure?: BotStartupFailure | null;
	/** The outcome the execution reported with `outcome_report`. */
	readonly outcome?: BotExecutionOutcome | null;
}
export type BotStartupStage =
	| 'prepare'
	| 'agent-check'
	| 'relay'
	| 'adapter-check'
	| 'agent-launch';
export type BotStartupCode =
	| 'engine-deadline'
	| 'engine-connection'
	| 'relay-not-ready'
	| 'adapter-timeout'
	| 'adapter-temporary'
	| 'adapter-lasting'
	| 'adapter-missing'
	| 'other';
export interface BotStartupFailure {
	readonly stage: BotStartupStage;
	readonly temporary: boolean;
	readonly code: BotStartupCode;
}
export interface BotStartupAttempt extends BotStartupFailure {
	readonly at: number;
	/** Redacted and cut to 256 bytes. */
	readonly cause: string;
}
export type BotOutcomeDisposition = 'outside-control' | 'needs-human' | 'fixed';
export interface BotExecutionOutcome {
	readonly disposition: BotOutcomeDisposition;
	readonly reason: string;
	readonly action: string | null;
	readonly triggerId: string | null;
	readonly at: number;
}
/** Set by a `needs-human` outcome; cleared by Resume or a `fixed` outcome. */
export interface BotTriggerBlocker {
	readonly id: string;
	readonly reason: string;
	readonly action: string;
	readonly sessionId: string;
	readonly at: number;
	/** Whether the one chat message for this blocker has been posted. */
	readonly notice: 'pending' | 'posted';
}
export type BotNeedsHumanPolicy = 'pause' | 'keep-running';
export const BOT_STARTUP_RETRIES_DEFAULT = 3;
export const BOT_STARTUP_RETRIES_MAX = 3;
export interface BotSession extends BotSessionRecord {
	readonly updates: readonly JsonValue[];
}
export interface BotMemory {
	readonly path: string;
	readonly title: string;
	readonly modifiedAt: number;
	readonly pinned: boolean;
}
export interface BotInvalidation {
	readonly botId: string;
	readonly revision: number;
}

export type BotTriggerSchedule =
	| { readonly kind: 'cron'; readonly cron: string }
	| {
			readonly kind: 'every';
			readonly intervalMs: number;
			readonly anchor: number;
	  }
	| { readonly kind: 'once'; readonly at: number };
export type BotTriggerEventKind =
	| 'agent.finished'
	| 'agent.needsInput'
	| 'agent.blocked'
	| 'terminal.needsAttention'
	| 'terminal.commandFinished'
	| 'terminal.idle'
	| 'project.opened'
	| 'project.closed'
	| 'device.connected';
export type BotTriggerCondition =
	| BotTriggerSchedule
	| { readonly kind: 'event'; readonly event: BotTriggerEventKind }
	| BotObservationSource;
/** Anchors are server-owned and reset on save or enable. */
export interface BotTriggerDraft {
	readonly recovery?: BotRecoveryPolicy;
	readonly name: string;
	readonly enabled: boolean;
	readonly prompt: string;
	readonly condition:
		| Exclude<BotTriggerCondition, { kind: 'every' }>
		| { readonly kind: 'every'; readonly intervalMs: number };
	/** 0–3; absent means 3. */
	readonly startupRetries?: number;
	/** Absent means `pause`. */
	readonly onNeedsHuman?: BotNeedsHumanPolicy;
}
export interface BotTrigger extends Omit<BotTriggerDraft, 'condition'> {
	/** Present while the trigger waits for the user. */
	readonly blocker?: BotTriggerBlocker | null;
	readonly generation?: string;
	readonly health?: BotSourceHealth;
	readonly unsupported?: string;
	readonly id: string;
	readonly botId: string;
	readonly condition: BotTriggerCondition;
	readonly evaluatedThrough: number;
	readonly missedCount: number;
	readonly missedLatest: number | null;
}
export interface BotTriggerFiring {
	readonly id: string;
	readonly botId: string;
	readonly triggerId: string;
	readonly triggerName: string;
	readonly firedAt: number;
	readonly origin: 'trigger' | 'run-now';
	readonly sessionId: string | null;
	readonly outcome: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
	readonly reason: string | null;
	readonly cause?: BotFailureCause | null;
}
export interface BotUpcomingFiring {
	readonly triggerId: string;
	readonly triggerName: string;
	readonly at: number;
}
export interface BotUpcomingCursor {
	readonly at: number;
	readonly triggerId: string;
}
export interface BotUpcomingPage {
	readonly firings: readonly BotUpcomingFiring[];
	readonly next: BotUpcomingCursor | null;
}
export interface BotQueue {
	readonly botId: string;
	readonly items: readonly {
		readonly id: string;
		readonly kind: 'chat' | 'trigger' | 'failure';
		readonly sessionId: string | null;
		readonly triggerId: string | null;
		readonly triggerName: string | null;
		readonly fireTime: number | null;
		readonly enqueuedAt: number;
	}[];
}
export interface BotAgent {
	readonly extensionId: string;
	readonly extensionName: string;
	readonly id: string;
	readonly displayName: string;
	readonly autonomousOnly: boolean;
	readonly canLoad: boolean;
	readonly signInMethods: readonly ('device' | 'token')[];
	/** The agent's device sign-in, when it declares one. */
	readonly deviceSignIn: {
		readonly label: string;
		readonly help: string;
	} | null;
	readonly status: {
		readonly state: 'ready' | 'not-signed-in' | 'not-installed' | 'unavailable';
		readonly detail?: string;
		readonly action?: {
			readonly label: string;
			readonly kind:
				| 'sign-in'
				| 'build-image'
				| 'enable-extension'
				| 'install-extension';
		};
	};
	readonly models: {
		readonly available: boolean;
		readonly value: readonly {
			readonly id: string;
			readonly displayName: string;
		}[];
	};
}
