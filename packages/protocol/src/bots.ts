import type { JsonValue } from './errors.js';

export const BOTS_CAPABILITY = 'bots.v1';
export const BOT_EVENTS = { changed: 'bots.changed' } as const;
export const BOT_OPERATIONS = Object.freeze({
	triggers: 'bots.triggers.list',
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
export type BotSessionOrigin =
	| { readonly kind: 'chat'; readonly messageId?: string }
	| {
			readonly kind: 'trigger' | 'run-now';
			readonly triggerId: string;
			readonly triggerName: string;
			readonly fireTime: number;
	  };
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
	readonly recoveryMayHaveLostUpdates: boolean;
}
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
	| { readonly kind: 'event'; readonly event: BotTriggerEventKind };
/** Anchors are server-owned and reset on save or enable. */
export interface BotTriggerDraft {
	readonly name: string;
	readonly enabled: boolean;
	readonly prompt: string;
	readonly condition:
		| Exclude<BotTriggerCondition, { kind: 'every' }>
		| { readonly kind: 'every'; readonly intervalMs: number };
}
export interface BotTrigger extends Omit<BotTriggerDraft, 'condition'> {
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
		readonly kind: 'chat' | 'trigger';
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
