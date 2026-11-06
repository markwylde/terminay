/** Generic bot-owned observations. No provider or workspace identities. */
export const BOT_SOURCES_CAPABILITY = 'bots.sources.v1';
export type BotRecoveryPolicy =
	| 'skip'
	| 'once'
	| 'replay'
	| 'ignore-gap'
	| 'recover-available';
export type BotSourceMatch =
	| { readonly kind: 'changed' }
	| {
			readonly kind: 'contains' | 'regex';
			readonly text: string;
			readonly repeat?: boolean;
	  }
	| { readonly kind: 'exit'; readonly code: number; readonly repeat?: boolean }
	| {
			readonly kind: 'items';
			readonly items: string;
			readonly identity: string;
			readonly initial?: 'process' | 'baseline';
	  };
export type BotObservationSource =
	| {
			readonly kind: 'command';
			readonly command: string;
			readonly cwd?: string;
			readonly intervalMs: number;
			readonly anchor?: number;
			readonly timeoutMs?: number;
			readonly match: BotSourceMatch;
	  }
	| {
			readonly kind: 'http';
			readonly url: string;
			readonly headers?: Readonly<Record<string, string>>;
			readonly intervalMs: number;
			readonly anchor?: number;
			readonly timeoutMs?: number;
			readonly select?: string;
			readonly match?: BotSourceMatch;
	  }
	| {
			readonly kind: 'sse';
			readonly url: string;
			readonly headers?: Readonly<Record<string, string>>;
			readonly eventName?: string;
	  }
	| {
			readonly kind: 'files';
			readonly path: string;
			readonly recursive?: boolean;
			readonly include?: string;
			readonly exclude?: string;
			readonly debounceMs?: number;
	  };
/** A failure cause that also stops any new execution of the bot. */
export type BotFailureCause =
	| 'engine'
	| 'agent'
	| 'image'
	| 'disabled'
	| 'processes';
export interface BotSourceHealth {
	readonly state:
		| 'disabled'
		| 'watching'
		| 'connected'
		| 'waiting'
		| 'checking'
		| 'healthy'
		| 'retrying'
		| 'blocked'
		| 'failed';
	readonly lastAttempt: number | null;
	readonly lastSuccess: number | null;
	readonly lastFired: number | null;
	readonly nextRetry: number | null;
	readonly nextCheck?: number | null;
	readonly error: string | null;
	readonly cause?: BotFailureCause | null;
	readonly gap: string | null;
	readonly remembered: number;
}
export interface BotSourceTest {
	readonly diagnostics: string;
	readonly events: readonly unknown[];
	readonly wouldFire: number;
}
