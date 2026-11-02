/** Terminay events a consumer can be triggered by. */
export const TRIGGER_EVENT_KINDS = Object.freeze([
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

export type TriggerEventKind = (typeof TRIGGER_EVENT_KINDS)[number];

export type TriggerSubject =
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

/** Allowlisted event facts; never terminal output, tokens, or journal content. */
export interface TriggerEventContext {
	readonly agentProvider?: string;
	readonly agentState?: string;
	/** Agent completion outcome: success | error | cancelled. */
	readonly agentOutcome?: string;
	/** Structured command completion exit code. */
	readonly exitCode?: number;
}
