import { TerminalServiceError } from "./errors.js";
import type { TerminalResolvedLaunch } from "./launchResolver.js";
import type {
  PtyDataListener,
  PtyExit,
  PtyFactory,
  PtyProcess,
  PtySpawnOptions,
  TerminalAuthorization,
  TerminalCloseReason,
  TerminalCreateOptions,
  TerminalDimensions,
  TerminalEvent,
  TerminalEventListener,
  TerminalExitEvent,
  TerminalExitMetadata,
  TerminalExitReason,
  TerminalInactivityOptions,
  TerminalInactivityTimer,
  PtyForegroundProcess,
  TerminalIdentity,
  TerminalOutputEvent,
  TerminalServiceLimits,
  TerminalSessionLifecycle,
  TerminalServiceOptions,
  TerminalSessionSnapshot,
  TerminalSessionStatus,
  TerminalShutdownOptions,
  TerminalSubscriptionOptions,
  Unsubscribe,
} from "./types.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEFAULT_MAX_SESSIONS = 256;
const DEFAULT_MAX_INPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_OUTPUT_CHUNK_BYTES = 64 * 1024;
const DEFAULT_MAX_REPLAY_BYTES = 1024 * 1024;
const DEFAULT_MAX_QUEUED_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_MAX_SUBSCRIBERS = 32;
const DEFAULT_MAX_COLS = 1_000;
const DEFAULT_MAX_ROWS = 1_000;

interface NormalizedLimits {
  readonly maxSessions: number;
  readonly maxInputBytes: number;
  readonly maxOutputChunkBytes: number;
  readonly maxReplayBytes: number;
  readonly maxQueuedOutputBytes: number;
  readonly maxSubscribersPerSession: number;
  readonly maxCols: number;
  readonly maxRows: number;
}

interface ReplayChunk {
  readonly position: number;
  readonly nextPosition: number;
  readonly bytes: Uint8Array;
}

interface MutableSession {
  readonly identity: TerminalIdentity;
  readonly cwd: string;
  readonly createdAt: number;
  readonly dimensions: { cols: number; rows: number };
  readonly launch?: TerminalSessionSnapshot["launch"];
  readonly replay: ReplayChunk[];
  readonly subscribers: Set<TerminalSubscription>;
  readonly inactivityWaiters: Set<InactivityWaiter>;
  status: TerminalSessionStatus;
  outputPosition: number;
  replayFrom: number;
  process?: PtyProcess;
  pid?: number;
  exit?: TerminalExitMetadata;
  pendingExitReason?: TerminalExitReason;
  dataUnsubscribe?: Unsubscribe;
  exitUnsubscribe?: Unsubscribe;
  foregroundProcessUnsubscribe?: Unsubscribe;
}

interface InactivityWaiter {
  readonly durationMs: number;
  readonly signal: AbortSignal | undefined;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  timer: unknown;
  abortListener?: () => void;
  settled: boolean;
}

/**
 * A detachable, resumable terminal stream.
 *
 * A subscription with `onEvent` is push based.  A subscription without a
 * listener is pull based and retains bounded output until `drain`/`ack` is
 * called.  In both cases the session (and PTY) outlives this object.
 */
export class TerminalSubscription {
  readonly subscriptionId: string;
  readonly sessionId: string;
  readonly serverId: string;
  readonly projectId: string;
  readonly initialEvents: readonly TerminalEvent[];
  /** Alias for consumers that call the initial replay `replay`. */
  readonly replay: readonly TerminalEvent[];

  private readonly service: TerminalService;
  private readonly session: MutableSession;
  private readonly listener: TerminalEventListener | undefined;
  private readonly maxQueuedBytes: number;
  private queue: TerminalEvent[] = [];
  private queuedBytesValue = 0;
  private cursorValue: number;
  private closedValue = false;
  private closeReasonValue: TerminalCloseReason | undefined;

  constructor(
    service: TerminalService,
    session: MutableSession,
    subscriptionId: string,
    options: TerminalSubscriptionOptions,
    initialEvents: readonly TerminalEvent[],
    initialCursor: number,
    maxQueuedBytes: number,
  ) {
    this.service = service;
    this.session = session;
    this.subscriptionId = subscriptionId;
    this.sessionId = session.identity.sessionId;
    this.serverId = session.identity.serverId;
    this.projectId = session.identity.projectId;
    this.initialEvents = initialEvents.map(copyEvent);
    this.replay = this.initialEvents;
    this.listener = options.onEvent;
    this.maxQueuedBytes = maxQueuedBytes;
    this.cursorValue = initialCursor;
    if (this.listener === undefined) {
      for (const event of this.initialEvents) this.enqueue(event);
    } else {
      for (const event of this.initialEvents) this.deliver(event);
    }
  }

  get closed(): boolean { return this.closedValue; }
  get closeReason(): TerminalCloseReason | undefined { return this.closeReasonValue; }
  get queuedBytes(): number { return this.queuedBytesValue; }
  get position(): number { return this.cursorValue; }
  get cursor(): number { return this.cursorValue; }

  /** Return and acknowledge all currently queued events. */
  drain(): readonly TerminalEvent[] {
    const events = this.queue.map(copyEvent);
    this.queue = [];
    this.queuedBytesValue = 0;
    const last = [...events].reverse().find((event): event is TerminalOutputEvent => event.type === "output");
    if (last !== undefined) this.cursorValue = Math.max(this.cursorValue, last.nextPosition);
    return events;
  }

  poll(): readonly TerminalEvent[] { return this.drain(); }

  /** Acknowledge an output position without requiring a transport shape. */
  ack(position: number): void {
    validatePosition(position);
    if (position < this.cursorValue) return;
    if (position > this.session.outputPosition) throw new TerminalServiceError("invalid_position", "acknowledged position is ahead of terminal output", { expected: this.session.outputPosition, actual: position });
    this.cursorValue = position;
    this.queue = this.queue.filter((event) => event.type !== "output" || event.nextPosition > position);
    this.queuedBytesValue = this.queue.reduce((sum, event) => sum + eventBytes(event), 0);
  }

  close(reason: TerminalCloseReason = "client"): void {
    if (this.closedValue) return;
    this.closedValue = true;
    this.closeReasonValue = reason;
    this.session.subscribers.delete(this);
    this.queue = [];
    this.queuedBytesValue = 0;
    this.service.emitSubscriptionClosed(this, reason);
  }

  /** @internal */
  deliverEvent(event: TerminalEvent): void {
    if (this.closedValue) return;
    if (this.listener !== undefined) this.deliver(event);
    else this.enqueue(event);
  }

  /** @internal */
  closeForOverflow(): void {
    if (this.closedValue) return;
    const event = resyncEvent(this.session);
    this.closedValue = true;
    this.closeReasonValue = "resync_required";
    this.session.subscribers.delete(this);
    this.queue = this.listener === undefined ? [event] : [];
    this.queuedBytesValue = 0;
    if (this.listener !== undefined) {
      try { this.listener(copyEvent(event)); } catch { /* observer cannot affect PTY supervision */ }
    }
    this.service.emitSubscriptionClosed(this, "resync_required");
  }

  private deliver(event: TerminalEvent): void {
    try { this.listener?.(copyEvent(event)); }
    catch { /* client listeners cannot break PTY supervision */ }
    if (event.type === "output") this.cursorValue = Math.max(this.cursorValue, event.nextPosition);
  }

  private enqueue(event: TerminalEvent): void {
    const bytes = eventBytes(event);
    if (bytes > 0 && this.queuedBytesValue + bytes > this.maxQueuedBytes) {
      this.closeForOverflow();
      return;
    }
    this.queue.push(copyEvent(event));
    this.queuedBytesValue += bytes;
  }
}

/**
 * Server-owned PTY/session authority.  No method uses a renderer, window, or
 * transport id as process ownership.  All public requests can carry an exact
 * server/project/session authorization assertion; omitted authorization is
 * reserved for trusted in-process service composition (for example a host
 * shutdown hook).
 */
export class TerminalService {
  readonly serverId: string;
  readonly limits: Readonly<NormalizedLimits>;

  private readonly ptyFactory: PtyFactory;
  private readonly defaultEnvironment: Readonly<Record<string, string | undefined>> | undefined;
  private readonly resolveDefaultShell: TerminalServiceOptions["resolveDefaultShell"];
  private readonly now: () => number;
  private readonly generateSessionIdHook: ((projectId: string) => string) | undefined;
  private readonly eventListener: TerminalEventListener | undefined;
  private readonly sessionLifecycle: TerminalSessionLifecycle | undefined;
  private readonly inactivityTimer: TerminalInactivityTimer;
  private readonly sessionsById = new Map<string, MutableSession>();
  private readonly listeners = new Set<TerminalEventListener>();
  private readonly inputListeners = new Set<
    (identity: TerminalIdentity, bytes: Uint8Array) => void
  >();
  private sessionCounter = 0;
  private subscriptionCounter = 0;
  private stopping = false;

  constructor(options: TerminalServiceOptions);
  constructor(serverId: string, ptyFactory: PtyFactory, limits?: TerminalServiceLimits);
  constructor(optionsOrServerId: TerminalServiceOptions | string, factory?: PtyFactory, limits: TerminalServiceLimits = {}) {
    const options: TerminalServiceOptions = typeof optionsOrServerId === "string"
      ? { serverId: optionsOrServerId, ptyFactory: factory as PtyFactory, ...limits }
      : optionsOrServerId;
    assertId(options.serverId, "serverId");
    if (!options.ptyFactory || (typeof options.ptyFactory !== "function" && typeof options.ptyFactory.spawn !== "function")) throw new TypeError("ptyFactory must provide spawn");
    this.serverId = options.serverId;
    this.ptyFactory = options.ptyFactory;
    this.defaultEnvironment = options.defaultEnvironment;
    this.resolveDefaultShell = options.resolveDefaultShell;
    this.now = options.now ?? (() => Date.now());
    this.generateSessionIdHook = options.generateSessionId;
    this.eventListener = options.onEvent;
    this.sessionLifecycle = options.sessionLifecycle;
    this.inactivityTimer = options.inactivityTimer ?? defaultInactivityTimer;
    this.limits = Object.freeze(normalizeLimits(options));
    if (this.eventListener !== undefined) this.listeners.add(this.eventListener);
  }

  get size(): number { return this.sessionsById.size; }
  get stopped(): boolean { return this.stopping; }

  onEvent(listener: TerminalEventListener): Unsubscribe {
    if (typeof listener !== "function") throw new TypeError("terminal event listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onInput(listener: (identity: TerminalIdentity, bytes: Uint8Array) => void): Unsubscribe {
    if (typeof listener !== "function") throw new TypeError("terminal input listener must be a function");
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  getSession(session: string | TerminalIdentity): TerminalSessionSnapshot | undefined {
    const sessionId = typeof session === "string" ? session : session.sessionId;
    const value = this.sessionsById.get(sessionId);
    return value === undefined ? undefined : snapshotOf(value);
  }

  session(session: string | TerminalIdentity): TerminalSessionSnapshot | undefined { return this.getSession(session); }

  listSessions(): readonly TerminalSessionSnapshot[] { return [...this.sessionsById.values()].map(snapshotOf); }
  sessions(): readonly TerminalSessionSnapshot[] { return this.listSessions(); }

  /** Allocate a bounded identity before canonical launch resolution. The
   * eventual createResolvedSession call still performs the authoritative
   * duplicate/session-limit checks immediately before spawn. */
  allocateIdentity(projectId: string, requestedSessionId?: string): TerminalIdentity {
    assertId(projectId, "projectId");
    const sessionId = requestedSessionId ?? this.nextSessionId(projectId);
    assertId(sessionId, "sessionId");
    return Object.freeze({ serverId: this.serverId, projectId, sessionId });
  }

  async currentCwd(
    session: string | TerminalIdentity,
    authorization?: TerminalAuthorization,
    timeoutMs = 1_000,
  ): Promise<import("./types.js").TerminalCurrentCwd> {
    const mutable = this.requireSession(session);
    this.authorize(mutable, authorization, "read");
    if (mutable.process?.getCwd === undefined) {
      return { cwd: mutable.cwd, source: "spawn", observationError: "unavailable" };
    }
    try {
      const controller = new AbortController();
      let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
      const observed = await Promise.race([
        Promise.resolve(mutable.process.getCwd(controller.signal)).finally(() => {
          if (timer !== undefined) globalThis.clearTimeout(timer);
        }),
        new Promise<never>((_resolve, reject) => {
          timer = globalThis.setTimeout(() => {
            reject(new Error("cwd observation timeout"));
            controller.abort(new Error("cwd observation timeout"));
          }, timeoutMs);
        }),
      ]);
      return typeof observed === "string" && observed.length > 0 && observed.length <= 4_096
        ? { cwd: observed, source: "observed" }
        : { cwd: mutable.cwd, source: "spawn", observationError: "failed" };
    } catch (error) {
      return {
        cwd: mutable.cwd,
        source: "spawn",
        observationError:
          error instanceof Error && error.message === "cwd observation timeout"
            ? "timeout"
            : "failed",
      };
    }
  }

  /**
   * @internal Low-level unresolved spawn retained for TerminalService unit tests
   * and explicitly opted-in legacy test compositions. Production hosts and
   * protocol routes must resolve a TerminalResolvedLaunch and call
   * createResolvedSession instead.
   */
  async createSession(options: TerminalCreateOptions): Promise<TerminalSessionHandle> {
    if (this.stopping) throw new TerminalServiceError("service_shutdown", "terminal service is shutting down");
    if (options.serverId !== undefined && options.serverId !== this.serverId) throw new TerminalServiceError("forbidden", "terminal belongs to another server", { serverId: this.serverId, actual: options.serverId });
    assertId(options.projectId, "projectId");
    const sessionId = options.sessionId ?? this.nextSessionId(options.projectId);
    assertId(sessionId, "sessionId");
    if (this.sessionsById.has(sessionId)) throw new TerminalServiceError("session_exists", "terminal session already exists", { sessionId });
    if (this.sessionsById.size >= this.limits.maxSessions) throw new TerminalServiceError("session_limit", "terminal session limit reached", { max: this.limits.maxSessions });
    const dimensions = validateDimensions({ cols: options.cols, rows: options.rows }, this.limits);
    const createdAt = options.createdAt ?? this.now();
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new TypeError("createdAt must be a non-negative safe integer");
    const identity: TerminalIdentity = Object.freeze({ serverId: this.serverId, projectId: options.projectId, sessionId });
    const defaultShellOptions = options.shellPath === undefined
      ? this.resolveDefaultShell?.() ?? { shellPath: defaultShell() }
      : undefined;
    const shellPath = options.shellPath ?? defaultShellOptions?.shellPath;
    if (typeof shellPath !== "string" || shellPath.trim().length === 0) throw new TypeError("default shell path is invalid");
    const lifecycleEnvironment = this.sessionLifecycle?.prepareTerminalSession(identity);
    const cwd = options.cwd ?? ".";
    const mutable: MutableSession = {
      identity,
      cwd,
      createdAt,
      dimensions: { ...dimensions },
      replay: [],
      subscribers: new Set(),
      inactivityWaiters: new Set(),
      status: "running",
      outputPosition: 0,
      replayFrom: 0,
    };
    this.sessionsById.set(sessionId, mutable);
    const spawnOptions: PtySpawnOptions = {
      shellPath,
      shell: shellPath,
      args: [...(options.args ?? defaultShellOptions?.args ?? [])],
      cwd,
      ...(this.defaultEnvironment === undefined && options.env === undefined && lifecycleEnvironment === undefined
        ? {}
        : { env: { ...(this.defaultEnvironment ?? {}), ...(options.env ?? {}), ...(lifecycleEnvironment ??{}) } }),
      ...(options.name === undefined ? {} : { name: options.name }),
      ...dimensions,
    };
    try {
      const process = await spawn(this.ptyFactory, spawnOptions);
      mutable.process = process;
      if (typeof process.pid === "number" && Number.isSafeInteger(process.pid) && process.pid > 0) {
        mutable.pid = process.pid;
        try { this.sessionLifecycle?.terminalStarted?.(identity, process.pid); } catch { /* observers cannot fail PTY creation */ }
      }
      this.attachProcess(mutable, process);
    } catch (error) {
      const message = error instanceof Error ? error.message : "PTY spawn failed";
      this.finish(mutable, { exitCode: 1, signal: null }, "spawn_error", this.now(), message);
    }
    return new TerminalSessionHandle(this, mutable);
  }

  /** Spawn an already-resolved immutable launch snapshot. This is the only
   * creation entry point used by production protocol and host composition;
   * shell/profile/cwd policy deliberately lives in TerminalLaunchResolver. */
  async createResolvedSession(launch: TerminalResolvedLaunch): Promise<TerminalSessionHandle> {
    if (this.stopping) throw new TerminalServiceError("service_shutdown", "terminal service is shutting down");
    if (launch.identity.serverId !== this.serverId) throw new TerminalServiceError("forbidden", "terminal belongs to another server");
    assertId(launch.identity.projectId, "projectId");
    assertId(launch.identity.sessionId, "sessionId");
    if (this.sessionsById.has(launch.identity.sessionId)) throw new TerminalServiceError("session_exists", "terminal session already exists", { sessionId: launch.identity.sessionId });
    if (this.sessionsById.size >= this.limits.maxSessions) throw new TerminalServiceError("session_limit", "terminal session limit reached", { max: this.limits.maxSessions });
    const dimensions = validateDimensions(launch, this.limits);
    if (!Number.isSafeInteger(launch.createdAt) || launch.createdAt < 0) throw new TypeError("createdAt must be a non-negative safe integer");
    if (typeof launch.shellPath !== "string" || launch.shellPath.trim().length === 0) throw new TypeError("resolved shell path is invalid");
    if (typeof launch.cwd !== "string" || launch.cwd.length === 0) throw new TypeError("resolved terminal cwd is invalid");
    const identity = Object.freeze({ ...launch.identity });
    const lifecycleEnvironment = this.sessionLifecycle?.prepareTerminalSession(identity);
    const mutable: MutableSession = {
      identity,
      cwd: launch.cwd,
      createdAt: launch.createdAt,
      dimensions: { ...dimensions },
      launch: Object.freeze({
        profileId: launch.profile.id,
        profileRevision: launch.profile.revision,
        profileName: launch.profile.name,
        targetSummary: launch.profile.targetSummary,
        ...(launch.profile.icon === undefined ? {} : { icon: launch.profile.icon }),
        ...(launch.profile.color === undefined ? {} : { color: launch.profile.color }),
        workspaceRevision: launch.workspaceRevision,
        settingsRevision: launch.settingsRevision,
      }),
      replay: [],
      subscribers: new Set(),
      inactivityWaiters: new Set(),
      status: "running",
      outputPosition: 0,
      replayFrom: 0,
    };
    const spawnOptions: PtySpawnOptions = {
      shellPath: launch.shellPath,
      shell: launch.shellPath,
      args: [...launch.args],
      cwd: launch.cwd,
      env: { ...launch.env, ...(lifecycleEnvironment ?? {}) },
      ...dimensions,
    };
    try {
      const process = await spawn(this.ptyFactory, spawnOptions);
      mutable.process = process;
      if (typeof process.pid === "number" && Number.isSafeInteger(process.pid) && process.pid > 0) {
        mutable.pid = process.pid;
        try { this.sessionLifecycle?.terminalStarted?.(identity, process.pid); } catch { /* observers cannot fail PTY creation */ }
      }
      this.sessionsById.set(identity.sessionId, mutable);
      this.attachProcess(mutable, process);
      return new TerminalSessionHandle(this, mutable);
    } catch (error) {
			this.sessionsById.delete(identity.sessionId);
			const process = mutable.process;
			if (process !== undefined) {
				try { await process.kill(); } catch { /* best-effort rollback */ }
				try { await process.dispose?.(); } catch { /* best-effort rollback */ }
			}
      try {
        this.sessionLifecycle?.terminalExited(identity, { exitCode: 1 });
      } catch { /* lifecycle cleanup cannot replace the bounded spawn error */ }
      throw new TerminalServiceError("spawn_failed", "The terminal process could not be started.", {
        serverId: identity.serverId,
        projectId: identity.projectId,
        sessionId: identity.sessionId,
        reason: error instanceof Error ? error.name : "spawn",
      });
    }
  }

  /** @internal Alias for the unresolved test-only creation seam. */
  create(options: TerminalCreateOptions): Promise<TerminalSessionHandle> { return this.createSession(options); }

  subscribe(session: string | TerminalIdentity, options: TerminalSubscriptionOptions = {}): TerminalSubscription {
    const mutable = this.requireSession(session);
    this.authorize(mutable, options.authorization, "read");
    if (mutable.subscribers.size >= this.limits.maxSubscribersPerSession) throw new TerminalServiceError("subscriber_limit", "terminal subscriber limit reached", { max: this.limits.maxSubscribersPerSession });
    const from = options.fromPosition ?? 0;
    validatePosition(from);
    if (from > mutable.outputPosition) throw new TerminalServiceError("invalid_position", "subscription position is ahead of terminal output", { expected: mutable.outputPosition, actual: from });
    if (from < mutable.replayFrom) throw new TerminalServiceError("replay_gap", "requested terminal output is no longer retained", { fromPosition: from, replayFrom: mutable.replayFrom, outputPosition: mutable.outputPosition });
    const initial: TerminalEvent[] = [];
    for (const chunk of mutable.replay) {
      if (chunk.nextPosition <= from) continue;
      initial.push(outputEvent(mutable, chunk, Math.max(from, chunk.position), true));
    }
    if (mutable.exit !== undefined) initial.push(exitEvent(mutable));
    const subscription = new TerminalSubscription(
      this,
      mutable,
      this.nextSubscriptionId(mutable.identity.sessionId),
      options,
      initial,
      from,
      options.maxQueuedBytes ?? this.limits.maxQueuedOutputBytes,
    );
    // An oversized initial replay can close a pull subscription before it is
    // registered. Do not retain that closed object against the subscriber
    // limit or deliver future PTY events to it.
    if (!subscription.closed) mutable.subscribers.add(subscription);
    return subscription;
  }

  attach(session: string | TerminalIdentity, options: TerminalSubscriptionOptions = {}): TerminalSubscription { return this.subscribe(session, options); }

  async input(session: string | TerminalIdentity, data: Uint8Array | string, authorization?: TerminalAuthorization): Promise<void> {
    const mutable = this.requireLiveSession(session);
    this.authorize(mutable, authorization, "write");
    const bytes = toBytes(data);
    if (bytes.byteLength > this.limits.maxInputBytes) throw new TerminalServiceError("input_too_large", "terminal input exceeds the configured limit", { max: this.limits.maxInputBytes, actual: bytes.byteLength });
    if (mutable.process === undefined) throw new TerminalServiceError("session_exited", "terminal process is unavailable");
    await mutable.process.write(copyBytes(bytes));
    if (bytes.byteLength > 0) {
      for (const listener of this.inputListeners) {
        try {
          listener({ ...mutable.identity }, copyBytes(bytes));
        } catch {
          // Observers cannot retroactively reject accepted PTY input.
        }
      }
      try {
        this.sessionLifecycle?.terminalInput?.(mutable.identity);
      } catch {
        // Observers cannot retroactively reject input already accepted by the PTY.
      }
    }
  }

  write(session: string | TerminalIdentity, data: Uint8Array | string, authorization?: TerminalAuthorization): Promise<void> { return this.input(session, data, authorization); }

  /**
   * Resolve after a session has produced no non-empty PTY output for the
   * requested period. Input, resize, focus, and client attachment do not
   * count as activity. Terminal exit resolves outstanding waits immediately.
   */
  waitForInactivity(
    session: string | TerminalIdentity,
    durationMs: number,
    options: TerminalInactivityOptions = {},
  ): Promise<void> {
    const mutable = this.requireLiveSession(session);
    this.authorize(mutable, options.authorization, "read");
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return Promise.reject(new RangeError("durationMs must be a finite non-negative number"));
    }
    if (options.signal?.aborted === true) return Promise.reject(abortReason(options.signal));
    if (durationMs === 0) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const signal = options.signal;
      const waiter: InactivityWaiter = {
        durationMs,
        signal,
        resolve,
        reject,
        timer: undefined,
        settled: false,
      };
      if (signal !== undefined) {
        waiter.abortListener = () => this.rejectInactivityWaiter(mutable, waiter, abortReason(signal));
        signal.addEventListener("abort", waiter.abortListener, { once: true });
      }
      mutable.inactivityWaiters.add(waiter);
      try {
        this.armInactivityWaiter(mutable, waiter);
      } catch (error) {
        this.rejectInactivityWaiter(mutable, waiter, error);
      }
    });
  }

  async resize(session: string | TerminalIdentity, dimensions: TerminalDimensions, authorization?: TerminalAuthorization): Promise<void> {
    const mutable = this.requireLiveSession(session);
    this.authorize(mutable, authorization, "write");
    const next = validateDimensions(dimensions, this.limits);
    if (mutable.process === undefined) throw new TerminalServiceError("session_exited", "terminal process is unavailable");
    await mutable.process.resize(next);
    mutable.dimensions.cols = next.cols;
    mutable.dimensions.rows = next.rows;
  }

  async kill(session: string | TerminalIdentity, authorization?: TerminalAuthorization, signal?: number | string): Promise<void> {
    const mutable = this.requireLiveSession(session);
    this.authorize(mutable, authorization, "write");
    mutable.pendingExitReason = "killed";
    if (mutable.process === undefined) {
      this.finish(mutable, { exitCode: 0, signal: null }, "killed", this.now());
      return;
    }
    try { await mutable.process.kill(signal); }
    catch (error) {
      mutable.pendingExitReason = undefined;
      throw error;
    }
  }

  terminate(session: string | TerminalIdentity, authorization?: TerminalAuthorization, signal?: number | string): Promise<void> { return this.kill(session, authorization, signal); }

  async interrupt(session: string | TerminalIdentity, authorization?: TerminalAuthorization, at = this.now()): Promise<void> {
    const mutable = this.requireLiveSession(session);
    this.authorize(mutable, authorization, "write");
    mutable.pendingExitReason = "interrupted";
    try { await mutable.process?.kill("SIGTERM"); }
    finally { this.finish(mutable, { exitCode: 130, signal: 15 }, "interrupted", at); }
  }

  /**
   * End all live sessions once.  Client disconnects never call this method;
   * only explicit lifecycle/shutdown code should do so.
   */
  async shutdown(options: TerminalShutdownOptions = {}): Promise<readonly TerminalExitEvent[]> {
    if (this.stopping && this.sessionsById.size === 0) return [];
    this.stopping = true;
    const reason = options.reason ?? "shutdown";
    const at = options.at ?? this.now();
    const before = new Set([...this.sessionsById.values()].filter((session) => session.status === "running"));
    await Promise.all([...before].map(async (mutable) => {
      mutable.pendingExitReason = reason;
      try { await mutable.process?.kill(options.signal ?? "SIGTERM"); }
      catch { /* still publish one interruption for a process that cannot be reattached */ }
      this.finish(mutable, { exitCode: reason === "shutdown" ? 143 : 130, signal: 15 }, reason, at);
    }));
    return [...before].flatMap((session) => session.exit === undefined ? [] : [exitEvent(session)]);
  }

  /** Mark live sessions interrupted when a server process is being replaced. */
  markInterrupted(at = this.now()): readonly TerminalExitEvent[] {
    const result: TerminalExitEvent[] = [];
    for (const mutable of this.sessionsById.values()) {
      if (mutable.status !== "running") continue;
      mutable.pendingExitReason = "interrupted";
      try { void mutable.process?.kill("SIGTERM"); } catch { /* best effort */ }
      this.finish(mutable, { exitCode: 130, signal: 15 }, "interrupted", at);
      if (mutable.exit !== undefined) result.push(exitEvent(mutable));
    }
    return result;
  }

  interruptAll(at = this.now()): readonly TerminalExitEvent[] { return this.markInterrupted(at); }

  /** @internal */
  emitSubscriptionClosed(_subscription: TerminalSubscription, _reason: TerminalCloseReason): void {
    // Kept as a hook point for a transport adapter; closure itself is local to
    // the subscription and intentionally does not affect PTY lifetime.
  }

  private attachProcess(mutable: MutableSession, process: PtyProcess): void {
    const onData: PtyDataListener = (value) => {
      try { this.appendOutput(mutable, toBytes(value)); }
      catch {
        // Output cannot be rejected by a PTY.  If an adapter violates the
        // byte contract, terminate that session and expose a bounded error.
        this.finish(mutable, { exitCode: 1, signal: null }, "spawn_error", this.now());
      }
    };
    const onExit = (exit: PtyExit) => {
      const reason = mutable.pendingExitReason ?? "exit";
      mutable.pendingExitReason = undefined;
      this.finish(mutable, normalizeExit(exit), reason, this.now());
    };
    const onForegroundProcess = (event: PtyForegroundProcess) => {
      if (mutable.status !== "running") return;
      try {
        this.sessionLifecycle?.foregroundProcessChanged?.(mutable.identity, event);
      } catch {
        // Lifecycle observers cannot change PTY supervision or output.
      }
    };
    mutable.dataUnsubscribe = normalizeUnsubscribe(process.onData(onData));
    mutable.exitUnsubscribe = normalizeUnsubscribe(process.onExit(onExit));
    if (process.onForegroundProcess !== undefined) {
      mutable.foregroundProcessUnsubscribe = normalizeUnsubscribe(process.onForegroundProcess(onForegroundProcess));
    }
  }

  private appendOutput(mutable: MutableSession, bytes: Uint8Array): void {
    if (bytes.byteLength === 0 || mutable.status !== "running") return;
    this.resetInactivityWaiters(mutable);
    // Split, rather than truncate, so every PTY byte is retained and every
    // stream frame remains bounded for WebRTC/local transports.
    for (let offset = 0; offset < bytes.byteLength; offset += this.limits.maxOutputChunkBytes) {
      const chunkBytes = copyBytes(bytes.slice(offset, Math.min(bytes.byteLength, offset + this.limits.maxOutputChunkBytes)));
      const position = mutable.outputPosition;
      const nextPosition = checkedPositionAdd(position, chunkBytes.byteLength);
      const chunk: ReplayChunk = { position, nextPosition, bytes: chunkBytes };
      mutable.outputPosition = nextPosition;
      mutable.replay.push(chunk);
      while (replayBytes(mutable.replay) > this.limits.maxReplayBytes) mutable.replay.shift();
      mutable.replayFrom = mutable.replay[0]?.position ?? mutable.outputPosition;
      const event = outputEvent(mutable, chunk, position, false);
      this.emit(event);
      for (const subscription of [...mutable.subscribers]) subscription.deliverEvent(event);
    }
  }

  private finish(mutable: MutableSession, rawExit: PtyExit, reason: TerminalExitReason, at: number, _spawnMessage?: string): void {
    if (mutable.exit !== undefined) return;
    const metadata: TerminalExitMetadata = Object.freeze({ ...normalizeExit(rawExit), reason, at });
    mutable.exit = metadata;
    mutable.status = reason === "interrupted" || reason === "shutdown" ? "interrupted" : "exited";
    mutable.pendingExitReason = undefined;
    for (const waiter of [...mutable.inactivityWaiters]) this.resolveInactivityWaiter(mutable, waiter);
    mutable.dataUnsubscribe?.();
    mutable.exitUnsubscribe?.();
    mutable.foregroundProcessUnsubscribe?.();
    try {
      const disposeResult = mutable.process?.dispose?.();
      if (disposeResult !== undefined) void Promise.resolve(disposeResult).catch(() => undefined);
    } catch {
      // Disposal is best effort after the authoritative exit event.
    }
    const event = exitEvent(mutable);
    try {
      this.sessionLifecycle?.terminalExited(mutable.identity, {
        exitCode: metadata.exitCode,
        ...(metadata.signal === null ? {} : { signal: String(metadata.signal) }),
      });
    } catch {
      // Lifecycle observers cannot change the authoritative terminal exit.
    }
    this.emit(event);
    for (const subscription of [...mutable.subscribers]) subscription.deliverEvent(event);
  }

  private requireSession(session: string | TerminalIdentity): MutableSession {
    const sessionId = typeof session === "string" ? session : session.sessionId;
    if (typeof sessionId !== "string") throw new TerminalServiceError("invalid_identity", "session id is invalid");
    const value = this.sessionsById.get(sessionId);
    if (value === undefined) throw new TerminalServiceError("session_not_found", "terminal session not found", { sessionId });
    if (typeof session !== "string") this.assertIdentity(value, session);
    return value;
  }

  private requireLiveSession(session: string | TerminalIdentity): MutableSession {
    const mutable = this.requireSession(session);
    if (mutable.status === "exited") throw new TerminalServiceError("session_exited", "terminal session has exited", { sessionId: mutable.identity.sessionId });
    if (mutable.status === "interrupted") throw new TerminalServiceError("session_interrupted", "terminal session was interrupted", { sessionId: mutable.identity.sessionId });
    return mutable;
  }

  private assertIdentity(mutable: MutableSession, identity: TerminalIdentity): void {
    if (identity.serverId !== mutable.identity.serverId || identity.projectId !== mutable.identity.projectId || identity.sessionId !== mutable.identity.sessionId) throw new TerminalServiceError("forbidden", "terminal identity is outside its server/project/session boundary", { serverId: mutable.identity.serverId, projectId: mutable.identity.projectId, sessionId: mutable.identity.sessionId });
  }

  private authorize(mutable: MutableSession, authorization: TerminalAuthorization | undefined, required: "read" | "write"): void {
    if (authorization === undefined) return;
    if (authorization.serverId !== mutable.identity.serverId || authorization.projectId !== mutable.identity.projectId || (authorization.sessionId !== undefined && authorization.sessionId !== mutable.identity.sessionId)) throw new TerminalServiceError("forbidden", "terminal authorization is outside its server/project/session boundary", { serverId: mutable.identity.serverId, projectId: mutable.identity.projectId, sessionId: mutable.identity.sessionId });
    const scope = authorization.scope ?? "read";
    if (required === "read" ? scope === "none" : scope !== "write" && scope !== "admin") throw new TerminalServiceError("forbidden", "terminal operation is not authorized for this client", { reason: required });
  }

  private emit(event: TerminalEvent): void {
    for (const listener of this.listeners) {
      try { listener(copyEvent(event)); } catch { /* observers cannot affect the PTY */ }
    }
  }

  private resetInactivityWaiters(mutable: MutableSession): void {
    for (const waiter of [...mutable.inactivityWaiters]) {
      if (waiter.settled) continue;
      this.clearInactivityTimer(waiter);
      try {
        this.armInactivityWaiter(mutable, waiter);
      } catch (error) {
        this.rejectInactivityWaiter(mutable, waiter, error);
      }
    }
  }

  private armInactivityWaiter(mutable: MutableSession, waiter: InactivityWaiter): void {
    if (waiter.settled || mutable.status !== "running" || !mutable.inactivityWaiters.has(waiter)) return;
    waiter.timer = this.inactivityTimer.setTimeout(() => this.resolveInactivityWaiter(mutable, waiter), waiter.durationMs);
  }

  private resolveInactivityWaiter(mutable: MutableSession, waiter: InactivityWaiter): void {
    if (!this.disposeInactivityWaiter(mutable, waiter)) return;
    waiter.resolve();
  }

  private rejectInactivityWaiter(mutable: MutableSession, waiter: InactivityWaiter, reason: unknown): void {
    if (!this.disposeInactivityWaiter(mutable, waiter)) return;
    waiter.reject(reason);
  }

  private disposeInactivityWaiter(mutable: MutableSession, waiter: InactivityWaiter): boolean {
    if (waiter.settled) return false;
    waiter.settled = true;
    this.clearInactivityTimer(waiter);
    if (waiter.signal !== undefined && waiter.abortListener !== undefined) {
      waiter.signal.removeEventListener("abort", waiter.abortListener);
      waiter.abortListener = undefined;
    }
    mutable.inactivityWaiters.delete(waiter);
    return true;
  }

  private clearInactivityTimer(waiter: InactivityWaiter): void {
    if (waiter.timer === undefined) return;
    this.inactivityTimer.clearTimeout(waiter.timer);
    waiter.timer = undefined;
  }

  private nextSessionId(projectId: string): string {
    if (this.generateSessionIdHook !== undefined) {
      const value = this.generateSessionIdHook(projectId);
      assertId(value, "sessionId");
      return value;
    }
    do { this.sessionCounter += 1; } while (this.sessionsById.has(`${this.serverId}:session:${this.sessionCounter}`));
    return `${this.serverId}:session:${this.sessionCounter}`;
  }

  private nextSubscriptionId(sessionId: string): string {
    this.subscriptionCounter += 1;
    const prefix = `${this.serverId}:subscription:`;
    return `${prefix}${this.subscriptionCounter}:${sessionId}`.slice(0, 128);
  }
}

/** Session-scoped façade useful to application services and tests. */
export class TerminalSessionHandle {
  private readonly service: TerminalService;
  private readonly session: MutableSession;

  constructor(service: TerminalService, session: MutableSession) {
    this.service = service;
    this.session = session;
  }

  get identity(): TerminalIdentity { return this.session.identity; }
  get serverId(): string { return this.session.identity.serverId; }
  get projectId(): string { return this.session.identity.projectId; }
  get sessionId(): string { return this.session.identity.sessionId; }
  get status(): TerminalSessionStatus { return this.session.status; }
  get outputPosition(): number { return this.session.outputPosition; }
  get exit(): TerminalExitMetadata | undefined { return this.session.exit; }
  snapshot(): TerminalSessionSnapshot { return snapshotOf(this.session); }
  state(): TerminalSessionSnapshot { return this.snapshot(); }
  subscribe(options: TerminalSubscriptionOptions = {}): TerminalSubscription { return this.service.subscribe(this.identity, options); }
  attach(options: TerminalSubscriptionOptions = {}): TerminalSubscription { return this.subscribe(options); }
  input(data: Uint8Array | string, authorization?: TerminalAuthorization): Promise<void> { return this.service.input(this.identity, data, authorization); }
  write(data: Uint8Array | string, authorization?: TerminalAuthorization): Promise<void> { return this.input(data, authorization); }
  resize(dimensions: TerminalDimensions, authorization?: TerminalAuthorization): Promise<void> { return this.service.resize(this.identity, dimensions, authorization); }
  kill(authorization?: TerminalAuthorization, signal?: number | string): Promise<void> { return this.service.kill(this.identity, authorization, signal); }
  interrupt(authorization?: TerminalAuthorization, at?: number): Promise<void> { return this.service.interrupt(this.identity, authorization, at); }
  waitForInactivity(durationMs: number, options: TerminalInactivityOptions = {}): Promise<void> { return this.service.waitForInactivity(this.identity, durationMs, options); }
}

function normalizeLimits(options: TerminalServiceOptions): NormalizedLimits {
  return {
    maxSessions: positiveLimit(options.maxSessions ?? DEFAULT_MAX_SESSIONS, "maxSessions"),
    maxInputBytes: positiveLimit(options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES, "maxInputBytes"),
    maxOutputChunkBytes: positiveLimit(options.maxOutputChunkBytes ?? DEFAULT_MAX_OUTPUT_CHUNK_BYTES, "maxOutputChunkBytes"),
    maxReplayBytes: positiveLimit(options.maxReplayBytes ?? DEFAULT_MAX_REPLAY_BYTES, "maxReplayBytes"),
    maxQueuedOutputBytes: positiveLimit(options.maxQueuedOutputBytes ?? DEFAULT_MAX_QUEUED_OUTPUT_BYTES, "maxQueuedOutputBytes"),
    maxSubscribersPerSession: positiveLimit(options.maxSubscribersPerSession ?? DEFAULT_MAX_SUBSCRIBERS, "maxSubscribersPerSession"),
    maxCols: positiveLimit(options.maxCols ?? DEFAULT_MAX_COLS, "maxCols"),
    maxRows: positiveLimit(options.maxRows ?? DEFAULT_MAX_ROWS, "maxRows"),
  };
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function assertId(value: string, name: string): void {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TerminalServiceError("invalid_identity", `${name} is invalid`);
}

function validatePosition(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TerminalServiceError("invalid_position", "terminal position must be a non-negative safe integer", { actual: value });
}

function validateDimensions(value: TerminalDimensions, limits: Pick<NormalizedLimits, "maxCols" | "maxRows">): TerminalDimensions {
  if (!Number.isSafeInteger(value.cols) || value.cols <= 0 || value.cols > limits.maxCols || !Number.isSafeInteger(value.rows) || value.rows <= 0 || value.rows > limits.maxRows) throw new TerminalServiceError("invalid_dimensions", "terminal dimensions exceed the configured bounds", { max: Math.max(limits.maxCols, limits.maxRows) });
  return { cols: value.cols, rows: value.rows };
}

function toBytes(value: Uint8Array | string): Uint8Array {
  if (value instanceof Uint8Array) return copyBytes(value);
  if (typeof value === "string") return new TextEncoder().encode(value);
  throw new TerminalServiceError("invalid_bytes", "terminal bytes must be a Uint8Array or string");
}

function copyBytes(value: Uint8Array): Uint8Array { return new Uint8Array(value); }

function normalizeExit(exit: PtyExit): { exitCode: number; signal: number | null } {
  const exitCode = typeof exit.exitCode === "number" && Number.isSafeInteger(exit.exitCode) ? exit.exitCode : 0;
  const signal = typeof exit.signal === "number" && Number.isSafeInteger(exit.signal) && exit.signal > 0 ? exit.signal : null;
  return { exitCode, signal };
}

function outputEvent(session: MutableSession, chunk: ReplayChunk, position: number, replay: boolean): TerminalOutputEvent {
  const start = Math.max(chunk.position, position);
  const offset = start - chunk.position;
  const bytes = copyBytes(chunk.bytes.slice(offset));
  return Object.freeze({ type: "output", ...session.identity, position: start, nextPosition: chunk.nextPosition, bytes, data: bytes, replay });
}

function exitEvent(session: MutableSession): TerminalExitEvent {
  if (session.exit === undefined) throw new Error("terminal exit metadata is missing");
  return Object.freeze({ type: "exit", ...session.identity, metadata: session.exit, exitCode: session.exit.exitCode, signal: session.exit.signal });
}

function resyncEvent(session: MutableSession): TerminalEvent {
  return Object.freeze({
    type: "resync_required",
    ...session.identity,
    fromPosition: session.replayFrom,
    replayFrom: session.replayFrom,
    outputPosition: session.outputPosition,
  });
}

function snapshotOf(session: MutableSession): TerminalSessionSnapshot {
  return Object.freeze({
    ...session.identity,
    cwd: session.cwd,
    ...(session.launch === undefined ? {} : { launch: session.launch }),
    status: session.status,
    createdAt: session.createdAt,
    outputPosition: session.outputPosition,
    replayFrom: session.replayFrom,
    ...(session.pid === undefined ? {} : { pid: session.pid }),
    dimensions: Object.freeze({ ...session.dimensions }),
    ...(session.exit === undefined ? {} : { exit: session.exit }),
  });
}

function eventBytes(event: TerminalEvent): number { return event.type === "output" ? event.bytes.byteLength : 0; }
function replayBytes(replay: readonly ReplayChunk[]): number { return replay.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0); }
function checkedPositionAdd(position: number, amount: number): number {
  const next = position + amount;
  if (!Number.isSafeInteger(next)) throw new TerminalServiceError("output_too_large", "terminal output position exhausted");
  return next;
}

function copyEvent(event: TerminalEvent): TerminalEvent {
  if (event.type === "output") {
    const bytes = copyBytes(event.bytes);
    return { ...event, bytes, data: bytes };
  }
  return { ...event };
}

function normalizeUnsubscribe(value: Unsubscribe | undefined): Unsubscribe | undefined { return typeof value === "function" ? value : undefined; }
const defaultInactivityTimer: TerminalInactivityTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}
function defaultShell(): string {
  // Keep the service deterministic in non-shell hosts; adapters may ignore it
  // and server launchers can always supply an explicit shellPath.
  return "sh";
}
async function spawn(factory: PtyFactory, options: PtySpawnOptions): Promise<PtyProcess> {
  const process = typeof factory === "function" ? await factory(options) : await factory.spawn(options);
  if (process === undefined || typeof process.write !== "function" || typeof process.resize !== "function" || typeof process.kill !== "function" || typeof process.onData !== "function" || typeof process.onExit !== "function") throw new Error("PTY adapter returned an invalid process");
  return process;
}
