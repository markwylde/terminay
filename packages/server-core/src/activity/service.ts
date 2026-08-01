import { createTerminalSignalParser, type TerminalSignalParser } from "./parser.js";
import { TerminalActivityReducer } from "./reducer.js";
import type {
  ActivityEvent,
  ActivityListener,
  ActivityReplay,
  ActivitySnapshot,
  ProviderActivityUpdate,
  TerminalActivitySessionSnapshot,
  TerminalActivitySignal,
} from "./types.js";

export interface ActivitySessionIdentity {
  readonly serverId: string;
  readonly projectId: string;
  readonly sessionId: string;
}

export interface TerminalActivityServiceOptions {
  readonly serverId: string;
  readonly now?: () => number;
  readonly maxSessions?: number;
  readonly parser?: { readonly maxPayloadBytes?: number };
  readonly reducer?: ConstructorParameters<typeof TerminalActivityReducer>[0];
  readonly setTimeout?: (handler: () => void, milliseconds: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

export class TerminalActivityServiceError extends Error {
  readonly code:
    | "invalid_identity"
    | "session_not_found"
    | "session_exited"
    | "project_mismatch"
    | "server_mismatch"
    | "session_limit";

  constructor(code: TerminalActivityServiceError["code"], message: string) {
    super(message);
    this.name = "TerminalActivityServiceError";
    this.code = code;
  }
}

interface SessionState {
  readonly projectId: string;
  readonly parser: TerminalSignalParser;
  exited: boolean;
}

/**
 * Server-owned activity boundary. PTY bytes enter here before any client is
 * involved; the original bytes are never rewritten, while parsed signals and
 * fallback evidence feed one ordered reducer. Every operation is checked
 * against the immutable server/project/session identity.
 */
export class TerminalActivityService {
  private readonly now: () => number;
  private readonly maxSessions: number;
  private readonly sessions = new Map<string, SessionState>();
  private readonly reducer: TerminalActivityReducer;
  private readonly scheduleTimeout: (handler: () => void, milliseconds: number) => unknown;
  private readonly cancelTimeout: (handle: unknown) => void;
  private deadlineTimer: unknown;
  private deadlineAt: number | null = null;
  private stopped = false;

  constructor(private readonly options: TerminalActivityServiceOptions) {
    assertId(options.serverId, "server id");
    this.now = options.now ?? (() => Date.now());
    this.maxSessions = positive(options.maxSessions ?? 4096, "maxSessions");
    this.scheduleTimeout = options.setTimeout ?? ((handler, milliseconds) => {
      const timer = setTimeout(handler, milliseconds);
      timer.unref?.();
      return timer;
    });
    this.cancelTimeout = options.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.reducer = new TerminalActivityReducer({
      ...options.reducer,
      now: this.now,
    });
  }

  get serverId(): string { return this.options.serverId; }
  get revision(): number { return this.reducer.revision; }

  register(identity: ActivitySessionIdentity): TerminalActivitySessionSnapshot {
    const state = this.assertIdentity(identity, false);
    if (state !== undefined) return this.requireSnapshot(identity.sessionId);
    if (this.sessions.size >= this.maxSessions) {
      throw new TerminalActivityServiceError("session_limit", "activity session limit reached");
    }
    this.sessions.set(identity.sessionId, {
      projectId: identity.projectId,
      parser: createTerminalSignalParser(this.options.parser),
      exited: false,
    });
    return this.reducer.register(identity.sessionId, identity.projectId, this.now()) ?? this.requireSnapshot(identity.sessionId);
  }

  ingestPtyOutput(identity: ActivitySessionIdentity, bytes: string | Uint8Array): readonly ActivityEvent[] {
    const state = this.requireActive(identity);
    const signals = state.parser.push(bytes);
    const events: ActivityEvent[] = [];
    for (const signal of signals) {
      const event = this.reducer.applySignal(identity.sessionId, signal, { projectId: identity.projectId, now: this.now() });
      if (event) events.push(event);
    }
    const fallback = this.reducer.applyRawOutput(identity.sessionId, { projectId: identity.projectId, now: this.now() });
    if (fallback) events.push(fallback);
    this.reconcileDeadline();
    return Object.freeze(events);
  }

  ingestSignal(identity: ActivitySessionIdentity, signal: TerminalActivitySignal): ActivityEvent | undefined {
    this.requireActive(identity);
    const event = this.reducer.applySignal(identity.sessionId, signal, { projectId: identity.projectId, now: this.now() });
    this.reconcileDeadline();
    return event;
  }

  ingestProvider(identity: ActivitySessionIdentity, update: ProviderActivityUpdate): ActivityEvent | undefined {
    this.requireActive(identity);
    const event = this.reducer.applyProviderActivity(identity.sessionId, update, { projectId: identity.projectId, now: this.now() });
    this.reconcileDeadline();
    return event;
  }

  acknowledge(identity: ActivitySessionIdentity, expectedUpdatedAt?: number): ActivityEvent | undefined {
    this.requireActive(identity);
    if (expectedUpdatedAt !== undefined && this.reducer.get(identity.sessionId)?.updatedAt !== expectedUpdatedAt) return undefined;
    return this.reducer.acknowledge(identity.sessionId, { projectId: identity.projectId, now: this.now() });
  }

  markExited(identity: ActivitySessionIdentity): ActivityEvent | undefined {
    const state = this.requireIdentity(identity);
    if (state.exited) return undefined;
    state.exited = true;
    state.parser.reset();
    const event = this.reducer.markTerminalExit(identity.sessionId, { now: this.now() });
    this.reconcileDeadline();
    return event;
  }

  get(identity: ActivitySessionIdentity): TerminalActivitySessionSnapshot | undefined {
    this.requireIdentity(identity);
    return this.reducer.get(identity.sessionId);
  }

  snapshot(): ActivitySnapshot { return this.reducer.snapshot(); }
  replay(afterRevision = 0): ActivityReplay { return this.reducer.replay(afterRevision); }
  snapshotForProject(projectId: string | undefined): ActivitySnapshot {
    return filterActivitySnapshot(this.snapshot(), projectId);
  }
  replayForProject(afterRevision = 0, projectId: string | undefined): ActivityReplay {
    const replay = this.replay(afterRevision);
    if (projectId === undefined) return replay;
    if (replay.kind === "resync") {
      return { kind: "resync", events: [], snapshot: filterActivitySnapshot(replay.snapshot ?? this.snapshot(), projectId) };
    }
    return {
      kind: "events",
      events: replay.events.filter((event) => event.snapshot?.projectId === projectId || this.projectIdForSession(event.sessionId) === projectId),
    };
  }
  projectIdForSession(sessionId: string): string | undefined { return this.sessions.get(sessionId)?.projectId; }
  tick(at = this.now()): readonly ActivityEvent[] {
    const events = this.reducer.tick(at);
    this.reconcileDeadline();
    return events;
  }
  subscribe(listener: ActivityListener): () => void { return this.reducer.subscribe(listener); }

  shutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.deadlineTimer !== undefined) this.cancelTimeout(this.deadlineTimer);
    this.deadlineTimer = undefined;
    this.deadlineAt = null;
  }

  private reconcileDeadline(): void {
    if (this.stopped) return;
    const next = this.reducer.nextDeadline();
    if (next === this.deadlineAt) return;
    if (this.deadlineTimer !== undefined) this.cancelTimeout(this.deadlineTimer);
    this.deadlineTimer = undefined;
    this.deadlineAt = next;
    if (next === null) return;
    this.deadlineTimer = this.scheduleTimeout(() => {
      this.deadlineTimer = undefined;
      this.deadlineAt = null;
      if (this.stopped) return;
      this.reducer.tick(this.now());
      this.reconcileDeadline();
    }, Math.max(0, next - this.now()));
  }

  private requireActive(identity: ActivitySessionIdentity): SessionState {
    const state = this.requireIdentity(identity);
    if (state.exited) throw new TerminalActivityServiceError("session_exited", "terminal activity session has exited");
    return state;
  }

  private requireIdentity(identity: ActivitySessionIdentity): SessionState {
    const state = this.assertIdentity(identity, true);
    if (state === undefined) throw new TerminalActivityServiceError("session_not_found", "terminal activity session was not registered");
    return state;
  }

  private assertIdentity(identity: ActivitySessionIdentity, requireExisting: boolean): SessionState | undefined {
    if (!identity || typeof identity !== "object") throw new TerminalActivityServiceError("invalid_identity", "activity identity is required");
    if (identity.serverId !== this.options.serverId) throw new TerminalActivityServiceError("server_mismatch", "activity identity belongs to another server");
    assertId(identity.projectId, "project id");
    assertId(identity.sessionId, "session id");
    const state = this.sessions.get(identity.sessionId);
    if (state !== undefined && state.projectId !== identity.projectId) throw new TerminalActivityServiceError("project_mismatch", "activity identity belongs to another project");
    if (requireExisting && state === undefined) throw new TerminalActivityServiceError("session_not_found", "terminal activity session was not registered");
    return state;
  }

  private requireSnapshot(sessionId: string): TerminalActivitySessionSnapshot {
    const snapshot = this.reducer.get(sessionId);
    if (snapshot === undefined) throw new TerminalActivityServiceError("session_not_found", "terminal activity snapshot is unavailable");
    return snapshot;
  }
}

function filterActivitySnapshot(snapshot: ActivitySnapshot, projectId: string | undefined): ActivitySnapshot {
  if (projectId === undefined) return snapshot;
  const sessions = Object.fromEntries(Object.entries(snapshot.sessions).filter(([, session]) => session.projectId === projectId));
  return Object.freeze({ ...snapshot, sessions: Object.freeze(sessions) });
}


function assertId(value: string, name: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new TerminalActivityServiceError("invalid_identity", `${name} is invalid`);
  }
}

function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  return value;
}
