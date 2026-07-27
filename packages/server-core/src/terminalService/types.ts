/**
 * Transport and host neutral terminal service contracts.
 *
 * The service deliberately talks to a very small PTY adapter.  A Node
 * `node-pty` adapter, an embedded child-process host, and a test double can
 * all implement this interface without making server-core aware of Electron
 * or of a particular client transport.
 */

type TerminalMaybePromise<T> = T | PromiseLike<T>;

export type TerminalBytes = Uint8Array;

export interface TerminalDimensions {
  readonly cols: number;
  readonly rows: number;
}

export interface PtySpawnOptions extends TerminalDimensions {
  /** Canonical shell executable. */
  readonly shellPath: string;
  /** Alias retained for adapters which call this field `shell`. */
  readonly shell: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly name?: string;
}

export interface PtyExit {
  readonly exitCode?: number | null;
  readonly signal?: number | null;
}

export type PtyDataListener = (bytes: Uint8Array) => void;
export type PtyExitListener = (exit: PtyExit) => void;
export type Unsubscribe = () => void;

/** The only process API required by TerminalService. */
export interface PtyProcess {
  readonly pid?: number;
  readonly write: (bytes: Uint8Array) => TerminalMaybePromise<void>;
  readonly resize: (dimensions: TerminalDimensions) => TerminalMaybePromise<void>;
  readonly kill: (signal?: number | string) => TerminalMaybePromise<void>;
  readonly onData: (listener: PtyDataListener) => Unsubscribe | void;
  readonly onExit: (listener: PtyExitListener) => Unsubscribe | void;
  readonly dispose?: () => TerminalMaybePromise<void>;
}

export type PtyFactory =
  | { readonly spawn: (options: PtySpawnOptions) => TerminalMaybePromise<PtyProcess> }
  | ((options: PtySpawnOptions) => TerminalMaybePromise<PtyProcess>);

export interface TerminalIdentity {
  readonly serverId: string;
  readonly projectId: string;
  readonly sessionId: string;
}

/**
 * An authorization assertion is scoped to one exact server/project/session.
 * `clientId` identifies the caller for auditing only; it is never PTY
 * ownership and is not used to keep a process alive.
 */
export interface TerminalAuthorization {
  readonly serverId: string;
  readonly projectId: string;
  readonly sessionId?: string;
  readonly clientId?: string;
  readonly scope?: "none" | "read" | "write" | "admin";
}

export type TerminalSessionStatus = "running" | "exited" | "interrupted";
export type TerminalExitReason =
  | "exit"
  | "killed"
  | "interrupted"
  | "shutdown"
  | "spawn_error";

export interface TerminalExitMetadata {
  readonly exitCode: number;
  readonly signal: number | null;
  readonly reason: TerminalExitReason;
  readonly at: number;
}

export interface TerminalSessionSnapshot extends TerminalIdentity {
  readonly status: TerminalSessionStatus;
  readonly createdAt: number;
  readonly outputPosition: number;
  /** First output position still retained in the replay buffer. */
  readonly replayFrom: number;
  readonly pid?: number;
  readonly dimensions: TerminalDimensions;
  readonly exit?: TerminalExitMetadata;
}

export interface TerminalOutputEvent {
  readonly type: "output";
  readonly serverId: string;
  readonly projectId: string;
  readonly sessionId: string;
  /** Byte offset of `bytes` in the session's output stream. */
  readonly position: number;
  readonly nextPosition: number;
  readonly bytes: Uint8Array;
  /** Alias useful to stream adapters which call the payload `data`. */
  readonly data: Uint8Array;
  readonly replay: boolean;
}

export interface TerminalExitEvent extends TerminalIdentity {
  readonly type: "exit";
  readonly metadata: TerminalExitMetadata;
  readonly exitCode: number;
  readonly signal: number | null;
}

export interface TerminalResyncEvent extends TerminalIdentity {
  readonly type: "resync_required";
  readonly fromPosition: number;
  readonly replayFrom: number;
  readonly outputPosition: number;
}

export type TerminalEvent = TerminalOutputEvent | TerminalExitEvent | TerminalResyncEvent;
export type TerminalEventListener = (event: TerminalEvent) => void;
export type TerminalCloseReason = "client" | "slow_consumer" | "service_shutdown" | "resync_required";

export interface TerminalSubscriptionOptions {
  readonly authorization?: TerminalAuthorization;
  readonly fromPosition?: number;
  readonly onEvent?: TerminalEventListener;
  /** Maximum queued output when no onEvent consumer is supplied. */
  readonly maxQueuedBytes?: number;
}

export interface TerminalWriteResult {
  readonly sessionId: string;
  readonly bytes: number;
  readonly outputPosition: number;
}

export interface TerminalServiceLimits {
  readonly maxSessions?: number;
  readonly maxInputBytes?: number;
  readonly maxOutputChunkBytes?: number;
  readonly maxReplayBytes?: number;
  readonly maxQueuedOutputBytes?: number;
  readonly maxSubscribersPerSession?: number;
  readonly maxCols?: number;
  readonly maxRows?: number;
}

export interface TerminalServiceOptions extends TerminalServiceLimits {
  readonly serverId: string;
  readonly ptyFactory: PtyFactory;
  readonly now?: () => number;
  readonly generateSessionId?: (projectId: string) => string;
  readonly onEvent?: TerminalEventListener;
}

export interface TerminalCreateOptions extends TerminalDimensions {
  readonly serverId?: string;
  readonly projectId: string;
  readonly sessionId?: string;
  readonly shellPath?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly name?: string;
  readonly createdAt?: number;
}

export interface TerminalShutdownOptions {
  readonly reason?: "shutdown" | "interrupted";
  readonly at?: number;
  readonly signal?: number | string;
}
