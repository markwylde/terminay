/**
 * Transport and host neutral terminal service contracts.
 *
 * The service deliberately talks to a very small PTY adapter.  A Node
 * `node-pty` adapter, an embedded child-process host, and a test double can
 * all implement this interface without making server-core aware of Electron
 * or of a particular client transport.
 */

type TerminalMaybePromise<T> = T | PromiseLike<T>;

import type { TerminalPresentationCheckpointAuthority } from "./presentationCheckpoint.js";

export type TerminalBytes = Uint8Array;

export interface TerminalDimensions {
  readonly cols: number;
  readonly rows: number;
}

export interface PtySpawnOptions extends TerminalDimensions {
	readonly projectId?: string;
	readonly projectEnvironmentId?: string;
	readonly environmentRevision?: number;
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
/**
 * Host-observed foreground process state. This is intentionally a
 * server-internal PTY signal: it is not terminal output and is not exposed to
 * terminal stream subscribers.
 */
export interface PtyForegroundProcess {
  readonly processName: string;
  readonly shellForeground: boolean;
}

export type PtyForegroundProcessListener = (event: PtyForegroundProcess) => void;
export type Unsubscribe = () => void;

/** The only process API required by TerminalService. */
export interface PtyProcess {
  readonly pid?: number;
  readonly write: (bytes: Uint8Array) => TerminalMaybePromise<void>;
  readonly resize: (dimensions: TerminalDimensions) => TerminalMaybePromise<void>;
  readonly kill: (signal?: number | string) => TerminalMaybePromise<void>;
	/** Optional host backpressure used to keep canonical parser work bounded. */
	readonly pause?: () => void;
	readonly resume?: () => void;
  readonly onData: (listener: PtyDataListener) => Unsubscribe | undefined;
  readonly onExit: (listener: PtyExitListener) => Unsubscribe | undefined;
  /** Optional trusted host observation of the process' current directory. */
  readonly getCwd?: (signal?: AbortSignal) => TerminalMaybePromise<string | null>;
  /** Optional host capability for trusted foreground-process observation. */
  readonly onForegroundProcess?: (listener: PtyForegroundProcessListener) => Unsubscribe | undefined;
  readonly dispose?: () => TerminalMaybePromise<void>;
}

export interface TerminalCurrentCwd {
  readonly cwd: string;
  readonly source: "observed" | "spawn";
  readonly observationError?: "unavailable" | "failed" | "timeout";
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
 * Optional server-owned lifecycle boundary for services attached to a PTY.
 *
 * The returned environment is merged after caller-provided values so a client
 * cannot spoof identity or replace credentials reserved by the authority.
 */
export interface TerminalSessionLifecycle {
  readonly prepareTerminalSession: (
    identity: TerminalIdentity,
  ) => Readonly<Record<string, string | undefined>>;
  /** Called only after the host has obtained the real PTY shell PID. */
  readonly terminalStarted?: (identity: TerminalIdentity, shellPid: number) => void;
  readonly terminalExited: (
    identity: TerminalIdentity,
    options?: { readonly exitCode?: number; readonly signal?: string },
  ) => void;
  /** Optional server-owned observer for input accepted by the PTY. */
  readonly terminalInput?: (identity: TerminalIdentity) => void;
  /** Optional server-owned observer for trusted PTY foreground changes. */
  readonly foregroundProcessChanged?: (
    identity: TerminalIdentity,
    event: PtyForegroundProcess,
  ) => void;
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

/** Options for a server-owned terminal quiet-period wait. */
export interface TerminalInactivityOptions {
  /** Read access is sufficient: this operation never writes to the PTY. */
  readonly authorization?: TerminalAuthorization;
  /** Cancels only this wait; it never affects the terminal or other waiters. */
  readonly signal?: AbortSignal;
}

/**
 * Narrow timer boundary for deterministic service tests.  It is deliberately
 * private to terminal supervision: no timer state is exposed to clients or
 * terminal event streams.
 */
export interface TerminalInactivityTimer {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (timer: unknown) => void;
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
	/** Canonical server-owned working directory selected at process creation. */
	readonly cwd: string;
	/** Safe immutable launch metadata. Environment values are intentionally not
	 * retained in this snapshot. */
	readonly launch?: Readonly<{
		profileId: string;
		profileRevision: number;
		profileName: string;
		targetSummary: string;
		icon?: string;
		color?: string;
		workspaceRevision: number;
		settingsRevision: number;
	}>;
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
export type TerminalInputListener = (
  identity: TerminalIdentity,
  bytes: Uint8Array,
) => void;
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
  /** Host-owned base environment for every terminal. It is never client input;
   * per-session values and lifecycle credentials are merged over it. */
  readonly defaultEnvironment?: Readonly<Record<string, string | undefined>>;
  /** @internal Compatibility hook for low-level TerminalService tests only.
   * Production launch policy belongs to TerminalLaunchResolver. */
  readonly resolveDefaultShell?: () => Readonly<{
    shellPath: string;
    args?: readonly string[];
  }>;
  readonly now?: () => number;
  readonly generateSessionId?: (projectId: string) => string;
  /** Optional host-neutral timer implementation for inactivity supervision. */
  readonly inactivityTimer?: TerminalInactivityTimer;
  readonly onEvent?: TerminalEventListener;
  /** Server-owned lifecycle observers such as agent journal tracking. */
  readonly sessionLifecycle?: TerminalSessionLifecycle;
  /** Optional bounded canonical emulator used only for fresh presentation recovery. */
  readonly presentationCheckpoints?: TerminalPresentationCheckpointAuthority;
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
