/**
 * Transport-neutral terminal activity protocol.
 *
 * The PTY service feeds bytes to the signal parser and feeds the resulting
 * signals to the reducer.  Neither type contains a renderer, Electron, xterm,
 * or transport concern.  Provider updates are deliberately represented as a
 * separate source so fallback evidence can never replace authoritative state.
 */

export type ProgressState = 0 | 1 | 2 | 3 | 4;

export type CommandPhase =
  | "prompt"
  | "input"
  | "executing"
  | "finished"
  | "aborted";

export type TerminalActivitySignal =
  | { readonly kind: "progress"; readonly state: ProgressState; readonly progress?: number }
  | { readonly kind: "command"; readonly phase: CommandPhase; readonly exitCode?: number }
  | { readonly kind: "notification"; readonly title?: string; readonly body?: string }
  | { readonly kind: "bell" }
  | { readonly kind: "foreground"; readonly busy: boolean; readonly processName: string }
  | { readonly kind: "userInput" };

export type TerminalActivityStatus = "working" | "idle";

/** Provider lifecycle states are retained even though tab activity has a
 * smaller working/idle vocabulary.  This lets clients render provider status
 * without using terminal fallback to infer it. */
export type ProviderActivityState =
  | "working"
  | "waiting"
  | "blocked"
  | "done"
  | "idle";

export interface ProviderActivityUpdate {
  /** Stable provider id, for example `codex` or `claude-code`. */
  readonly provider: string;
  /** Canonical provider state. `status` is accepted as a compatibility alias. */
  readonly state?: ProviderActivityState;
  readonly status?: ProviderActivityState;
  readonly attention?: boolean;
  readonly acknowledged?: boolean;
  readonly exitCode?: number;
  readonly source?: string;
  /** Optional provider sequence. Reordered or repeated values are ignored. */
  readonly sequence?: number;
  /** Optional stable provider run identity. A different run cannot overwrite a live one. */
  readonly agentId?: string;
}

export type ActivityAuthority = "none" | "raw" | "structured" | "provider";

export interface TerminalActivitySessionSnapshot {
  readonly sessionId: string;
  readonly projectId?: string;
  /** True only while a process other than the spawned shell owns the PTY foreground group. */
  readonly foregroundBusy: boolean;
  readonly status: TerminalActivityStatus;
  readonly attention: boolean;
  readonly acknowledged: boolean;
  readonly claimed: boolean;
  readonly authority: ActivityAuthority;
  readonly source: string;
  readonly exitCode?: number;
  readonly provider?: string;
  readonly providerState?: ProviderActivityState;
  readonly agentId?: string;
  readonly updatedAt: number;
}

export interface ActivitySnapshot {
  readonly revision: number;
  readonly cursor: string;
  readonly sessions: Readonly<Record<string, TerminalActivitySessionSnapshot>>;
}

export type ActivityEventType = "activity.changed" | "activity.removed";

export interface ActivityEvent {
  readonly revision: number;
  readonly cursor: string;
  readonly type: ActivityEventType;
  readonly sessionId: string;
  readonly snapshot?: TerminalActivitySessionSnapshot;
}

export interface ActivityReplay {
  readonly kind: "events" | "resync";
  readonly events: readonly ActivityEvent[];
  readonly snapshot?: ActivitySnapshot;
}

export interface TerminalActivityReducerOptions {
  readonly maxEvents?: number;
  readonly initialRevision?: number;
  readonly initialSessions?: readonly ActivitySessionSeed[];
  readonly rawActivityMs?: number;
  readonly progressStaleMs?: number;
  readonly now?: () => number;
}

export interface ActivitySessionSeed {
  readonly sessionId: string;
  readonly projectId?: string;
  readonly now?: number;
}

export type ActivityListener = (event: ActivityEvent, snapshot: ActivitySnapshot) => void;
