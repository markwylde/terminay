import type {
  ActivityEvent,
  ActivityListener,
  ActivityReplay,
  ActivitySnapshot,
  ActivityAuthority,
  ProviderActivityState,
  ProviderActivityUpdate,
  TerminalActivityReducerOptions,
  TerminalActivitySessionSnapshot,
  TerminalActivitySignal,
  TerminalActivityStatus,
} from "./types.js";

const DEFAULT_MAX_EVENTS = 1024;
const DEFAULT_RAW_ACTIVITY_MS = 1000;
const DEFAULT_PROGRESS_STALE_MS = 15_000;
const INPUT_QUIET_COMPLETION_MS = 2_000;

interface MutableSession {
  readonly sessionId: string;
  projectId?: string;
  status: TerminalActivityStatus;
  attention: boolean;
  acknowledged: boolean;
  claimed: boolean;
  authority: ActivityAuthority;
  source: string;
  exitCode?: number;
  provider?: string;
  providerState?: ProviderActivityState;
  agentId?: string;
  updatedAt: number;
  progressBusy: boolean;
  progressDeadline?: number;
  commandExecuting: boolean;
  foregroundBusy: boolean;
  foregroundProcess?: string;
  explicitSeen: boolean;
  rawActivityAt?: number;
  lastUserInputAt?: number;
  inputQuietDeadline?: number;
  providerSequence?: number;
}

export interface ApplyActivityOptions {
  readonly now?: number;
  readonly projectId?: string;
}

/** A deterministic, transport-independent reduction authority for terminal
 * activity. It is intentionally not a renderer store: every accepted
 * transition receives one global revision and can be replayed by any client. */
export class TerminalActivityReducer {
  private readonly maxEvents: number;
  private readonly rawActivityMs: number;
  private readonly progressStaleMs: number;
  private readonly now: () => number;
  private readonly sessionsById = new Map<string, MutableSession>();
  private readonly exited = new Set<string>();
  private readonly events: ActivityEvent[] = [];
  private readonly listeners = new Set<ActivityListener>();
  private currentRevision: number;

  constructor(options: TerminalActivityReducerOptions = {}) {
    this.maxEvents = normalizePositive(options.maxEvents, DEFAULT_MAX_EVENTS, "maxEvents");
    this.rawActivityMs = normalizeMs(options.rawActivityMs, DEFAULT_RAW_ACTIVITY_MS, "rawActivityMs");
    this.progressStaleMs = normalizeMs(options.progressStaleMs, DEFAULT_PROGRESS_STALE_MS, "progressStaleMs");
    this.now = options.now ?? (() => Date.now());
    this.currentRevision = normalizeRevision(options.initialRevision ?? 0, "initialRevision");
    for (const seed of options.initialSessions ?? []) this.register(seed.sessionId, seed.projectId, seed.now);
  }

  get revision(): number {
    return this.currentRevision;
  }

  get cursor(): string {
    return String(this.currentRevision);
  }

  get sessionCount(): number {
    return this.sessionsById.size;
  }

  /** Register a PTY session before its first signal. Registration itself is
   * not a public activity transition and therefore does not consume a
   * revision. Exited IDs are never reusable. */
  register(sessionId: string, projectId?: string, at = this.now()): TerminalActivitySessionSnapshot | undefined {
    assertSessionId(sessionId);
    if (this.exited.has(sessionId)) return undefined;
    const existing = this.sessionsById.get(sessionId);
    if (existing) {
      if (!matchesProject(existing, projectId)) return undefined;
      if (projectId !== undefined && existing.projectId === undefined) existing.projectId = projectId;
      return snapshotOf(existing);
    }
    const session = createSession(sessionId, projectId, at);
    this.sessionsById.set(sessionId, session);
    return snapshotOf(session);
  }

  get(sessionId: string): TerminalActivitySessionSnapshot | undefined {
    assertSessionId(sessionId);
    const value = this.sessionsById.get(sessionId);
    return value ? snapshotOf(value) : undefined;
  }

  /** Feed a parsed signal. Unknown/exited sessions are created lazily, which
   * allows PTY integrations to pass the first parser result directly. */
  applySignal(
    sessionId: string,
    signal: TerminalActivitySignal,
    options: ApplyActivityOptions = {},
  ): ActivityEvent | undefined {
    assertSessionId(sessionId);
    if (this.exited.has(sessionId)) return undefined;
    const at = normalizeTime(options.now ?? this.now());
    const existing = this.sessionsById.get(sessionId);
    if (!matchesProject(existing, options.projectId) || isStale(existing, at)) return undefined;
    const session = this.ensure(sessionId, options.projectId, at);
    this.expire(session, at);

    // Provider state is authoritative for this exact terminal. Structured and
    // raw evidence is still accepted by the parser but cannot mutate the
    // provider-backed canonical snapshot.
    if (session.provider !== undefined && signal.kind !== "foreground") {
      this.updateFallbackEvidence(session, signal, at);
      return undefined;
    }

    const before = snapshotOf(session);
    switch (signal.kind) {
      case "progress":
        session.authority = "structured";
        session.source = "structured:progress";
        // State 0 is itself an explicit protocol completion marker. Latch the
        // session even when it is the first observed marker so raw bytes from
        // the same PTY chunk cannot immediately replace canonical idle state.
        session.explicitSeen = true;
        if (signal.state === 0) {
          const hadProgress = session.progressBusy;
          session.progressBusy = false;
          session.progressDeadline = undefined;
          if (
            !recentInput(session, at) &&
            (hadProgress || session.lastUserInputAt !== undefined)
          ) {
            session.acknowledged = false;
          }
        } else {
          session.progressBusy = true;
          session.progressDeadline = at + this.progressStaleMs;
          if (!recentInput(session, at)) session.acknowledged = false;
        }
        break;
      case "command":
        session.authority = "structured";
        session.source = "structured:command";
        session.explicitSeen = true;
        if (signal.phase === "executing") {
          session.commandExecuting = true;
          if (!recentInput(session, at)) session.acknowledged = false;
        } else if (signal.phase === "finished") {
          // D directly after B is an aborted command and its exit code does
          // not describe a command that actually ran.
          if (session.commandExecuting) {
            session.exitCode = signal.exitCode;
          }
          // Some shell integrations omit C but still emit D when the prompt
          // returns. Preserve the direct B -> D suppression above while
          // treating a delayed marker as genuine finished activity.
          if (session.commandExecuting || !recentInput(session, at)) {
            session.acknowledged = false;
          }
          session.commandExecuting = false;
        } else {
          session.commandExecuting = false;
        }
        break;
      case "foreground":
        if (session.provider === undefined) {
          session.authority = "structured";
          session.source = "structured:foreground";
        }
        if (
          session.foregroundBusy &&
          !signal.busy &&
          !recentInput(session, at)
        ) {
          session.acknowledged = false;
        }
        session.foregroundBusy = signal.busy;
        session.foregroundProcess = signal.processName;
        break;
      case "notification":
      case "bell":
        session.authority = "structured";
        session.source = `structured:${signal.kind}`;
        session.attention = true;
        session.acknowledged = false;
        break;
      case "userInput":
        session.source = "structured:user-input";
        session.lastUserInputAt = at;
        session.inputQuietDeadline = at + INPUT_QUIET_COMPLETION_MS;
        session.attention = false;
        session.acknowledged = true;
        break;
    }
    if (session.provider === undefined) derive(session, at, this.rawActivityMs);
    return this.commitIfChanged(session, before);
  }

  /** Record unstructured PTY output used by the final fallback tier. */
  applyRawOutput(
    sessionId: string,
    options: ApplyActivityOptions = {},
  ): ActivityEvent | undefined {
    assertSessionId(sessionId);
    if (this.exited.has(sessionId)) return undefined;
    const at = normalizeTime(options.now ?? this.now());
    const existing = this.sessionsById.get(sessionId);
    if (!matchesProject(existing, options.projectId) || isStale(existing, at)) return undefined;
    const session = this.ensure(sessionId, options.projectId, at);
    this.expire(session, at);
    if (session.provider !== undefined || session.claimed) return undefined;
    const before = snapshotOf(session);
    session.authority = "raw";
    session.source = "raw:output";
    session.rawActivityAt = at;
    if (!recentInput(session, at)) session.acknowledged = false;
    derive(session, at, this.rawActivityMs);
    return this.commitIfChanged(session, before);
  }

  /** Apply authoritative provider lifecycle state. Provider identity and
   * optional sequence/run ids protect against stale or cross-run updates. */
  applyProviderActivity(
    sessionId: string,
    update: ProviderActivityUpdate,
    options: ApplyActivityOptions = {},
  ): ActivityEvent | undefined {
    assertSessionId(sessionId);
    assertProviderUpdate(update);
    if (this.exited.has(sessionId)) return undefined;
    const at = normalizeTime(options.now ?? this.now());
    const existing = this.sessionsById.get(sessionId);
    if (!matchesProject(existing, options.projectId) || isStale(existing, at)) return undefined;
    const session = this.ensure(sessionId, options.projectId, at);
    this.expire(session, at);

    if (session.provider !== undefined && session.provider !== update.provider) return undefined;
    if (session.agentId !== undefined && update.agentId !== undefined && session.agentId !== update.agentId) return undefined;
    if (session.providerSequence !== undefined && update.sequence !== undefined && update.sequence <= session.providerSequence) return undefined;
    if (session.providerSequence !== undefined && update.sequence === undefined) return undefined;

    const before = snapshotOf(session);
    const state = update.state !== undefined || update.status !== undefined
      ? normalizeProviderState(update.state ?? update.status)
      : session.providerState ?? "idle";
    session.provider = update.provider;
    session.providerState = state;
    session.agentId = update.agentId ?? session.agentId;
    session.providerSequence = update.sequence ?? session.providerSequence;
    session.claimed = true;
    session.authority = "provider";
    session.source = update.source ? boundSource(update.source) : `provider:${update.provider}`;
    session.status = state === "working" ? "working" : "idle";
    session.attention = update.attention ?? (state === "waiting" || state === "blocked");
    // Provider transitions are meaningful by default. An explicit
    // acknowledgement only applies to acknowledgement metadata, never state.
    session.acknowledged = update.acknowledged ?? false;
    if (update.exitCode !== undefined) session.exitCode = update.exitCode;
    session.updatedAt = at;
    return this.commitIfChanged(session, before);
  }

  /** Viewing or typing acknowledges fallback attention. It never changes an
   * authoritative provider's operational state. */
  markViewed(sessionId: string, options: ApplyActivityOptions = {}): ActivityEvent | undefined {
    return this.acknowledge(sessionId, options);
  }

  acknowledge(sessionId: string, options: ApplyActivityOptions = {}): ActivityEvent | undefined {
    assertSessionId(sessionId);
    const session = this.sessionsById.get(sessionId);
    if (!session || this.exited.has(sessionId)) return undefined;
    const at = normalizeTime(options.now ?? this.now());
    if (!matchesProject(session, options.projectId) || isStale(session, at)) return undefined;
    this.expire(session, at);
    // An acknowledgement is a state transition, not a heartbeat. Multiple
    // authenticated clients may acknowledge the same attention state at nearly
    // the same time; after the first one wins, later acknowledgements must not
    // advance lastUserInputAt or publish a second canonical revision.
    if (
      session.acknowledged &&
      !session.attention &&
      session.rawActivityAt === undefined
    ) return undefined;
    const before = snapshotOf(session);
    // Viewing a terminal consumes any raw fallback output already on screen.
    // Without clearing its pending deadline, an initial shell prompt can turn
    // into a new "finished" item after the user has focused the terminal.
    if (session.provider === undefined) {
      session.rawActivityAt = undefined;
    }
    session.attention = false;
    session.acknowledged = true;
    session.lastUserInputAt = at;
    session.source = session.provider === undefined ? "structured:acknowledge" : session.source;
    if (session.provider === undefined) {
      derive(session, at, this.rawActivityMs);
    }
    return this.commitIfChanged(session, before);
  }

  recordUserInput(sessionId: string, options: ApplyActivityOptions = {}): ActivityEvent | undefined {
    return this.applySignal(sessionId, { kind: "userInput" }, options);
  }

  /** End exactly one terminal. Its snapshot is removed and the id is fenced
   * so late PTY/provider events cannot resurrect stale state. */
  markTerminalExit(sessionId: string, options: { readonly now?: number; readonly projectId?: string } = {}): ActivityEvent | undefined {
    assertSessionId(sessionId);
    if (this.exited.has(sessionId)) return undefined;
    const session = this.sessionsById.get(sessionId);
    if (options.projectId !== undefined && (session === undefined || !matchesProject(session, options.projectId))) return undefined;
    if (!session) {
      this.exited.add(sessionId);
      return undefined;
    }
    this.sessionsById.delete(sessionId);
    this.exited.add(sessionId);
    const revision = this.nextRevision();
    const event: ActivityEvent = Object.freeze({
      revision,
      cursor: String(revision),
      type: "activity.removed",
      sessionId,
    });
    this.record(event);
    return event;
  }

  terminalExited(sessionId: string, options: { readonly now?: number; readonly projectId?: string } = {}): ActivityEvent | undefined {
    return this.markTerminalExit(sessionId, options);
  }

  /** Advance timeout-driven state without requiring timers in a server host. */
  tick(at = this.now()): readonly ActivityEvent[] {
    const time = normalizeTime(at);
    const changed: ActivityEvent[] = [];
    for (const session of this.sessionsById.values()) {
      if (time < session.updatedAt) continue;
      const before = snapshotOf(session);
      this.expire(session, time);
      // Provider state is canonical; fallback timeout bookkeeping is allowed
      // to drain, but must never derive a replacement status or source.
      if (session.provider === undefined) derive(session, time, this.rawActivityMs);
      const event = this.commitIfChanged(session, before);
      if (event) changed.push(event);
    }
    return changed;
  }

  nextDeadline(): number | null {
    let deadline: number | undefined;
    for (const session of this.sessionsById.values()) {
      if (session.progressDeadline !== undefined) deadline = minDefined(deadline, session.progressDeadline);
      if (session.rawActivityAt !== undefined) deadline = minDefined(deadline, session.rawActivityAt + this.rawActivityMs);
      if (session.inputQuietDeadline !== undefined) deadline = minDefined(deadline, session.inputQuietDeadline);
    }
    return deadline ?? null;
  }

  snapshot(): ActivitySnapshot {
    const sessions: Record<string, TerminalActivitySessionSnapshot> = {};
    for (const [id, value] of this.sessionsById) sessions[id] = snapshotOf(value);
    return Object.freeze({ revision: this.currentRevision, cursor: String(this.currentRevision), sessions: Object.freeze(sessions) });
  }

  get state(): ActivitySnapshot {
    return this.snapshot();
  }

  replay(afterRevision = 0): ActivityReplay {
    normalizeRevision(afterRevision, "afterRevision");
    if (afterRevision > this.currentRevision) throw new RangeError("afterRevision is ahead of current revision");
    const oldest = this.events[0]?.revision;
    if (oldest !== undefined && afterRevision < oldest - 1) {
      return { kind: "resync", events: [], snapshot: this.snapshot() };
    }
    return { kind: "events", events: this.events.filter((event) => event.revision > afterRevision) };
  }

  replaySince(afterRevision = 0): ActivityReplay {
    return this.replay(afterRevision);
  }

  subscribe(listener: ActivityListener): () => void {
    if (typeof listener !== "function") throw new TypeError("activity listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.sessionsById.clear();
    this.exited.clear();
    this.events.length = 0;
  }

  private ensure(sessionId: string, projectId: string | undefined, at: number): MutableSession {
    let session = this.sessionsById.get(sessionId);
    if (!session) {
      session = createSession(sessionId, projectId, at);
      this.sessionsById.set(sessionId, session);
    } else if (projectId !== undefined && session.projectId === undefined) {
      session.projectId = projectId;
    }
    return session;
  }

  private expire(session: MutableSession, at: number): void {
    if (session.progressDeadline !== undefined && at >= session.progressDeadline) {
      session.progressBusy = false;
      session.progressDeadline = undefined;
      if (session.provider === undefined) {
        session.source = "structured:stale";
        if (!recentInput(session, at)) session.acknowledged = false;
      }
    }
    if (session.rawActivityAt !== undefined && at >= session.rawActivityAt + this.rawActivityMs) {
      session.rawActivityAt = undefined;
    }
    if (session.inputQuietDeadline !== undefined && at >= session.inputQuietDeadline) {
      session.inputQuietDeadline = undefined;
      if (
        session.provider === undefined &&
        !session.progressBusy &&
        !session.commandExecuting &&
        !session.foregroundBusy
      ) {
        session.source = "structured:input-quiet";
        session.acknowledged = false;
      }
    }
  }

  private updateFallbackEvidence(session: MutableSession, signal: TerminalActivitySignal, at: number): void {
    // Keep timeout state from pinning internal resources after provider claim;
    // no canonical event is emitted because provider authority remains intact.
    if (signal.kind === "progress") {
      session.progressBusy = signal.state !== 0;
      session.progressDeadline = signal.state === 0 ? undefined : at + this.progressStaleMs;
    }
    if (signal.kind === "foreground") {
      session.foregroundBusy = signal.busy;
      session.foregroundProcess = signal.processName;
    }
  }

  private commitIfChanged(session: MutableSession, before: TerminalActivitySessionSnapshot): ActivityEvent | undefined {
    const after = snapshotOf(session);
    // `updatedAt` describes the last externally visible state transition. A
    // reducer pass may refresh private deadlines without changing that state;
    // such maintenance must not consume a revision or publish an event.
    if (sameSnapshotExceptUpdatedAt(before, after)) {
      session.updatedAt = before.updatedAt;
      return undefined;
    }
    if (sameSnapshot(before, after)) return undefined;
    session.updatedAt = after.updatedAt;
    const revision = this.nextRevision();
    const event: ActivityEvent = Object.freeze({
      revision,
      cursor: String(revision),
      type: "activity.changed",
      sessionId: session.sessionId,
      snapshot: after,
    });
    this.record(event);
    return event;
  }

  private nextRevision(): number {
    if (this.currentRevision === Number.MAX_SAFE_INTEGER) throw new RangeError("activity revision exhausted");
    this.currentRevision += 1;
    return this.currentRevision;
  }

  private record(event: ActivityEvent): void {
    this.events.push(event);
    while (this.events.length > this.maxEvents) this.events.shift();
    const state = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(event, state);
      } catch {
        // Observers cannot roll back a committed revision.
      }
    }
  }
}

export function createTerminalActivityReducer(options: TerminalActivityReducerOptions = {}): TerminalActivityReducer {
  return new TerminalActivityReducer(options);
}

// Friendly aliases for hosts that call this component a store or activity
// service. They intentionally point at the same deterministic implementation.
export const TerminalActivityStore = TerminalActivityReducer;
export const createTerminalActivityStore = createTerminalActivityReducer;

function createSession(sessionId: string, projectId: string | undefined, at: number): MutableSession {
  return {
    sessionId,
    ...(projectId === undefined ? {} : { projectId }),
    status: "idle",
    attention: false,
    acknowledged: true,
    claimed: false,
    authority: "none",
    source: "init",
    updatedAt: at,
    progressBusy: false,
    commandExecuting: false,
    foregroundBusy: false,
    explicitSeen: false,
  };
}

function derive(session: MutableSession, at: number, rawActivityMs: number): void {
  // Once an explicit progress/command protocol claims the session, prior raw
  // shell echo must stop contributing immediately. Otherwise a completion
  // marker can remain permanently "working" until some unrelated later call
  // happens to expire the raw timer.
  const rawWorking = !session.explicitSeen
    && session.rawActivityAt !== undefined
    && at < session.rawActivityAt + rawActivityMs;
  const working = session.progressBusy || session.commandExecuting || (session.foregroundBusy && !session.explicitSeen) || rawWorking;
  session.status = working ? "working" : "idle";
  session.claimed = session.provider !== undefined || session.explicitSeen;
  if (session.provider !== undefined) session.authority = "provider";
  session.updatedAt = at;
}

function snapshotOf(session: MutableSession): TerminalActivitySessionSnapshot {
  return Object.freeze({
    sessionId: session.sessionId,
    ...(session.projectId === undefined ? {} : { projectId: session.projectId }),
    foregroundBusy: session.foregroundBusy,
    status: session.status,
    attention: session.attention,
    acknowledged: session.acknowledged,
    claimed: session.claimed,
    authority: session.authority,
    source: session.source,
    ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
    ...(session.provider === undefined ? {} : { provider: session.provider }),
    ...(session.providerState === undefined ? {} : { providerState: session.providerState }),
    ...(session.agentId === undefined ? {} : { agentId: session.agentId }),
    updatedAt: session.updatedAt,
  });
}

function sameSnapshot(a: TerminalActivitySessionSnapshot, b: TerminalActivitySessionSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameSnapshotExceptUpdatedAt(
  a: TerminalActivitySessionSnapshot,
  b: TerminalActivitySessionSnapshot,
): boolean {
  const { updatedAt: _aUpdatedAt, ...aState } = a;
  const { updatedAt: _bUpdatedAt, ...bState } = b;
  return JSON.stringify(aState) === JSON.stringify(bState);
}

function normalizeProviderState(value: ProviderActivityUpdate["state"] | ProviderActivityUpdate["status"]): ProviderActivityState {
  if (value === "working") return "working";
  if (value === "waiting") return "waiting";
  if (value === "blocked") return "blocked";
  if (value === "done") return "done";
  return "idle";
}

function assertProviderUpdate(update: ProviderActivityUpdate): void {
  if (typeof update !== "object" || update === null || typeof update.provider !== "string" || update.provider.length === 0 || update.provider.length > 64 || update.provider.includes("\0")) throw new TypeError("provider update is invalid");
  if (update.sequence !== undefined && (!Number.isSafeInteger(update.sequence) || update.sequence < 0)) throw new TypeError("provider sequence is invalid");
  if (update.agentId !== undefined && (typeof update.agentId !== "string" || update.agentId.length === 0 || update.agentId.length > 256)) throw new TypeError("provider agent id is invalid");
}

function assertSessionId(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || value.includes("\0")) throw new TypeError("sessionId is invalid");
}

function normalizeRevision(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
  return value;
}

function normalizePositive(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) throw new RangeError(`${name} must be positive`);
  return result;
}

function normalizeMs(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < 0) throw new RangeError(`${name} must be non-negative`);
  return result;
}

function normalizeTime(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("activity time must be finite");
  return value;
}

function recentInput(session: MutableSession, at: number): boolean {
  return session.lastUserInputAt !== undefined && at - session.lastUserInputAt < DEFAULT_RAW_ACTIVITY_MS;
}

function boundSource(value: string): string {
  return value.length > 128 ? value.slice(0, 128) : value;
}

function minDefined(a: number | undefined, b: number): number {
  return a === undefined ? b : Math.min(a, b);
}

function matchesProject(session: MutableSession | undefined, projectId: string | undefined): boolean {
  return projectId === undefined || session?.projectId === undefined || session.projectId === projectId;
}

function isStale(session: MutableSession | undefined, at: number): boolean {
  return session !== undefined && at < session.updatedAt;
}
