import { assertJsonValue, type JsonValue, type ProtocolId } from "@terminay/protocol";
import type { CommandOptions, QueryOptions } from "./types.js";
import type { QueryCommandTransport } from "./queryCommand.js";
import type { MacroFieldValue } from "./macros.js";

/** Feature capability a server advertises when it serves automations. A
 * client hides the Automations section for a connection without it. */
export const AUTOMATIONS_CAPABILITY = "automations.v1" as const;

export const AUTOMATION_OPERATIONS = Object.freeze({
  get: "automations.get",
  upsert: "automations.upsert",
  remove: "automations.remove",
  setEnabled: "automations.set-enabled",
  run: "automations.run",
  stop: "automations.stop",
  runs: "automations.runs",
  dismissMissed: "automations.missed.dismiss",
} as const);

export const AUTOMATION_EVENTS = Object.freeze({
  changed: "automations.changed",
  runChanged: "automations.run.changed",
  missedChanged: "automations.missed.changed",
} as const);

export const AUTOMATION_EVENT_KINDS = Object.freeze([
  "agent.finished",
  "agent.needsInput",
  "agent.blocked",
  "terminal.needsAttention",
  "terminal.commandFinished",
  "terminal.idle",
  "project.opened",
  "project.closed",
  "device.connected",
] as const);

export type AutomationEventKind = (typeof AUTOMATION_EVENT_KINDS)[number];

/** Events whose subject is a terminal; only these can serve a subject action. */
export const AUTOMATION_TERMINAL_SUBJECT_EVENTS: ReadonlySet<AutomationEventKind> = new Set<AutomationEventKind>([
  "agent.finished",
  "agent.needsInput",
  "agent.blocked",
  "terminal.needsAttention",
  "terminal.commandFinished",
  "terminal.idle",
]);

export type AutomationTrigger =
  | { readonly kind: "schedule"; readonly cron: string }
  | { readonly kind: "event"; readonly event: AutomationEventKind };

export type AutomationAction =
  | { readonly kind: "runCommand"; readonly command: string; readonly shellProfileId?: string; readonly cwd?: string; readonly maxDurationSeconds: number }
  | { readonly kind: "runMacro"; readonly macroId: string; readonly fieldValues: Readonly<Record<string, MacroFieldValue>> }
  | { readonly kind: "writeText"; readonly text: string; readonly submit: boolean };

export interface AutomationSettings {
  readonly keepTerminalAfterRun: boolean;
  readonly recordSession: boolean;
  readonly cooldownSeconds: number;
}

export interface AutomationDefinition {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly trigger: AutomationTrigger;
  readonly action: AutomationAction;
  readonly settings: AutomationSettings;
  /** Server-maintained; ignored when sent. */
  readonly evaluatedThrough: number;
}

/** What a client sends to save an automation. Omitted fields take the
 * server's defaults; an omitted id creates a new automation. */
export type AutomationDraft = Omit<AutomationDefinition, "id" | "evaluatedThrough" | "settings" | "action" | "enabled"> & {
  readonly id?: string;
  readonly enabled?: boolean;
  readonly action: AutomationAction | (Omit<Extract<AutomationAction, { kind: "runCommand" }>, "maxDurationSeconds"> & { readonly maxDurationSeconds?: number });
  readonly settings?: Partial<AutomationSettings>;
};

export interface AutomationState {
  readonly schemaVersion: number;
  readonly revision: number;
  readonly cursor: string;
  readonly automations: readonly AutomationDefinition[];
  /** The IANA zone the server evaluates schedules in. Next-run previews use
   * it, never the client's zone. Sent by `automations.get`. */
  readonly timeZone?: string;
}

export type AutomationSubject =
  | { readonly kind: "terminal"; readonly serverId: ProtocolId; readonly projectId: ProtocolId; readonly sessionId: ProtocolId; readonly title?: string; readonly projectTitle?: string }
  | { readonly kind: "project"; readonly projectId: ProtocolId; readonly title?: string }
  | { readonly kind: "device"; readonly deviceId: string; readonly name?: string };

export type AutomationRunOutcome = "succeeded" | "failed" | "timedOut" | "stopped" | "skipped";
export type AutomationSkipReason = "previousRunStillRunning" | "subjectGone" | "concurrencyLimit" | "automationSpaceFull" | "executorUnavailable";

export interface AutomationRunEntry {
  readonly runId: string;
  readonly automationId: string;
  readonly triggerKind: "schedule" | "event";
  readonly event?: AutomationEventKind;
  readonly firedAt: number;
  readonly startedBy: "trigger" | "user";
  readonly subject?: AutomationSubject;
  readonly status: "running" | "finished";
  readonly outcome?: AutomationRunOutcome;
  readonly skipReason?: AutomationSkipReason;
  readonly reason?: string;
  readonly exitCode?: number;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly durationMs?: number;
  readonly sessionId?: string;
  /** Terminals the run opened through MCP, directly or through a terminal it
   * opened. The Automations section groups them under this run. */
  readonly openedSessions?: readonly string[];
  readonly outputTail?: string;
  readonly suppressedEvents: number;
  readonly recordingId?: string;
}

export interface AutomationMissedRecord {
  readonly automationId: string;
  readonly missedCount: number;
  readonly latestDueAt: number;
}

export interface AutomationRunsSnapshot {
  readonly runs: readonly AutomationRunEntry[];
  readonly missed: readonly AutomationMissedRecord[];
}

/** Journal events reach every subscriber whatever its authority, so they
 * carry only non-sensitive metadata. */
export interface AutomationsChangedEvent {
  readonly revision: number;
  readonly cursor: string;
  readonly automations: readonly { readonly id: string; readonly enabled: boolean }[];
}

export type AutomationRunChangedEvent = Pick<
  AutomationRunEntry,
  "runId" | "automationId" | "triggerKind" | "event" | "startedBy" | "status" | "outcome" | "skipReason" | "exitCode" | "firedAt" | "startedAt" | "finishedAt" | "durationMs" | "suppressedEvents"
>;

export interface AutomationEventTransport extends QueryCommandTransport {
  /** Automations are server-owned state; a transport that cannot subscribe
   * must fail closed rather than leave a stale projection. */
  readonly subscribe: (event: string, listener: (payload: JsonValue) => void) => () => void;
}

/** Shared automations facade over the canonical query/command transport. */
export class AutomationClient {
  constructor(private readonly transport: AutomationEventTransport) {}

  async get(options: QueryOptions = {}): Promise<AutomationState> {
    return validateState(await this.transport.query(AUTOMATION_OPERATIONS.get, {}, options));
  }

  async upsert(automation: AutomationDraft | AutomationDefinition, options: CommandOptions = {}): Promise<AutomationState> {
    return validateState(await this.transport.command(AUTOMATION_OPERATIONS.upsert, { automation: json(automation) }, options));
  }

  async remove(automationId: string, options: CommandOptions = {}): Promise<AutomationState> {
    return validateState(await this.transport.command(AUTOMATION_OPERATIONS.remove, { automationId: boundedId(automationId, "automation id") }, options));
  }

  async setEnabled(automationId: string, enabled: boolean, options: CommandOptions = {}): Promise<AutomationState> {
    if (typeof enabled !== "boolean") throw new TypeError("automation enabled must be a boolean");
    return validateState(await this.transport.command(AUTOMATION_OPERATIONS.setEnabled, { automationId: boundedId(automationId, "automation id"), enabled }, options));
  }

  /** Run now. A subject-terminal action needs the terminal the user chose. */
  async run(
    automationId: string,
    subject?: { readonly serverId: ProtocolId; readonly projectId: ProtocolId; readonly sessionId: ProtocolId },
    options: CommandOptions = {},
  ): Promise<AutomationRunEntry> {
    const payload: Record<string, JsonValue> = { automationId: boundedId(automationId, "automation id") };
    if (subject !== undefined) payload.subject = { kind: "terminal", serverId: boundedId(subject.serverId, "subject server id"), projectId: boundedId(subject.projectId, "subject project id"), sessionId: boundedId(subject.sessionId, "subject session id") };
    return validateRun(await this.transport.command(AUTOMATION_OPERATIONS.run, payload, options));
  }

  async stop(runId: string, options: CommandOptions = {}): Promise<{ readonly runId: string; readonly stopped: boolean }> {
    const result = await this.transport.command<JsonValue>(AUTOMATION_OPERATIONS.stop, { runId: boundedId(runId, "run id") }, options);
    if (!isRecord(result) || result.runId !== runId || typeof result.stopped !== "boolean") throw new TypeError("automation stop response is invalid");
    return Object.freeze({ runId, stopped: result.stopped });
  }

  /** Run history, newest first, plus the missed-schedule records. */
  async runs(automationId?: string, options: QueryOptions = {}): Promise<AutomationRunsSnapshot> {
    const result = await this.transport.query<JsonValue>(AUTOMATION_OPERATIONS.runs, automationId === undefined ? {} : { automationId: boundedId(automationId, "automation id") }, options);
    if (!isRecord(result) || !Array.isArray(result.runs)) throw new TypeError("automation runs response is invalid");
    return Object.freeze({ runs: Object.freeze(result.runs.map(validateRun)), missed: validateMissed(result.missed) });
  }

  /** Dismiss one automation's missed notice, or all of them, for every client. */
  async dismissMissed(automationId?: string, options: CommandOptions = {}): Promise<readonly AutomationMissedRecord[]> {
    const result = await this.transport.command<JsonValue>(AUTOMATION_OPERATIONS.dismissMissed, automationId === undefined ? {} : { automationId: boundedId(automationId, "automation id") }, options);
    if (!isRecord(result)) throw new TypeError("automation missed response is invalid");
    return validateMissed(result.missed);
  }

  /** Metadata only (ids, enabled, revision); refetch with `get()`. */
  onChanged(listener: (event: AutomationsChangedEvent) => void): () => void {
    return this.subscribe(AUTOMATION_EVENTS.changed, listener, validateChangedEvent);
  }

  /** Metadata only (ids, enums, timestamps); refetch detail with `runs()`. */
  onRunChanged(listener: (run: AutomationRunChangedEvent) => void): () => void {
    return this.subscribe(AUTOMATION_EVENTS.runChanged, listener, validateRunChangedEvent);
  }

  onMissedChanged(listener: (missed: readonly AutomationMissedRecord[]) => void): () => void {
    return this.subscribe(AUTOMATION_EVENTS.missedChanged, listener, (payload) => {
      if (!isRecord(payload)) throw new TypeError("automation missed event is invalid");
      return validateMissed(payload.missed);
    });
  }

  private subscribe<T>(event: string, listener: (value: T) => void, validate: (payload: JsonValue) => T): () => void {
    if (typeof listener !== "function") throw new TypeError("automation listener is required");
    if (typeof this.transport.subscribe !== "function") throw new Error("automation subscription is unavailable");
    return this.transport.subscribe(event, (payload) => listener(validate(payload)));
  }
}

function json(value: unknown): JsonValue {
  assertJsonValue(value);
  return value;
}

/** An IANA zone name such as `Europe/London` or `UTC`; anything else is ignored. */
const TIME_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,3}$/u;

function validateState(value: JsonValue): AutomationState {
  if (!isRecord(value) || !safeUInt(value.schemaVersion) || !safeUInt(value.revision) || typeof value.cursor !== "string" || !Array.isArray(value.automations)) throw new TypeError("automation state is invalid");
  const timeZone = typeof value.timeZone === "string" && value.timeZone.length <= 64 && TIME_ZONE_PATTERN.test(value.timeZone) ? { timeZone: value.timeZone } : {};
  return Object.freeze({ schemaVersion: value.schemaVersion, revision: value.revision, cursor: value.cursor, automations: Object.freeze(value.automations.map(validateAutomation)), ...timeZone });
}

function validateChangedEvent(value: JsonValue): AutomationsChangedEvent {
  if (!isRecord(value) || !safeUInt(value.revision) || typeof value.cursor !== "string" || !Array.isArray(value.automations)) throw new TypeError("automation change event is invalid");
  return Object.freeze({
    revision: value.revision,
    cursor: value.cursor,
    automations: Object.freeze(value.automations.map((entry) => {
      if (!isRecord(entry) || typeof entry.enabled !== "boolean") throw new TypeError("automation change event is invalid");
      return Object.freeze({ id: boundedId(entry.id, "automation id"), enabled: entry.enabled });
    })),
  });
}

function validateRunChangedEvent(value: JsonValue): AutomationRunChangedEvent {
  const run = validateRun(value);
  return Object.freeze({
    runId: run.runId,
    automationId: run.automationId,
    triggerKind: run.triggerKind,
    ...(run.event === undefined ? {} : { event: run.event }),
    startedBy: run.startedBy,
    status: run.status,
    ...(run.outcome === undefined ? {} : { outcome: run.outcome }),
    ...(run.skipReason === undefined ? {} : { skipReason: run.skipReason }),
    ...(run.exitCode === undefined ? {} : { exitCode: run.exitCode }),
    firedAt: run.firedAt,
    startedAt: run.startedAt,
    ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
    ...(run.durationMs === undefined ? {} : { durationMs: run.durationMs }),
    suppressedEvents: run.suppressedEvents,
  });
}

function validateAutomation(value: JsonValue): AutomationDefinition {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.enabled !== "boolean" || !safeUInt(value.evaluatedThrough)) throw new TypeError("automation definition is invalid");
  return Object.freeze({
    id: boundedId(value.id, "automation id"),
    name: value.name,
    enabled: value.enabled,
    trigger: validateTrigger(value.trigger),
    action: validateAction(value.action),
    settings: validateSettings(value.settings),
    evaluatedThrough: value.evaluatedThrough,
  });
}

function validateTrigger(value: JsonValue | undefined): AutomationTrigger {
  if (isRecord(value) && value.kind === "schedule" && typeof value.cron === "string") return Object.freeze({ kind: "schedule", cron: value.cron });
  if (isRecord(value) && value.kind === "event" && isEventKind(value.event)) return Object.freeze({ kind: "event", event: value.event });
  throw new TypeError("automation trigger is invalid");
}

function validateAction(value: JsonValue | undefined): AutomationAction {
  if (!isRecord(value)) throw new TypeError("automation action is invalid");
  switch (value.kind) {
    case "runCommand":
      if (typeof value.command !== "string" || !safeUInt(value.maxDurationSeconds) || (value.shellProfileId !== undefined && typeof value.shellProfileId !== "string") || (value.cwd !== undefined && typeof value.cwd !== "string")) break;
      return Object.freeze({ kind: "runCommand", command: value.command, maxDurationSeconds: value.maxDurationSeconds, ...(value.shellProfileId === undefined ? {} : { shellProfileId: value.shellProfileId as string }), ...(value.cwd === undefined ? {} : { cwd: value.cwd as string }) });
    case "runMacro": {
      if (!isRecord(value.fieldValues)) break;
      const fieldValues: Record<string, MacroFieldValue> = {};
      for (const [name, field] of Object.entries(value.fieldValues)) {
        if (typeof field !== "string" && typeof field !== "boolean" && !(typeof field === "number" && Number.isFinite(field))) throw new TypeError("automation macro field value is invalid");
        fieldValues[name] = field;
      }
      return Object.freeze({ kind: "runMacro", macroId: boundedId(value.macroId, "macro id"), fieldValues: Object.freeze(fieldValues) });
    }
    case "writeText":
      if (typeof value.text !== "string" || typeof value.submit !== "boolean") break;
      return Object.freeze({ kind: "writeText", text: value.text, submit: value.submit });
    default:
      break;
  }
  throw new TypeError("automation action is invalid");
}

function validateSettings(value: JsonValue | undefined): AutomationSettings {
  if (!isRecord(value) || typeof value.keepTerminalAfterRun !== "boolean" || typeof value.recordSession !== "boolean" || !safeUInt(value.cooldownSeconds)) throw new TypeError("automation settings are invalid");
  return Object.freeze({ keepTerminalAfterRun: value.keepTerminalAfterRun, recordSession: value.recordSession, cooldownSeconds: value.cooldownSeconds });
}

const OUTCOMES = new Set(["succeeded", "failed", "timedOut", "stopped", "skipped"]);
const SKIP_REASONS = new Set(["previousRunStillRunning", "subjectGone", "concurrencyLimit", "automationSpaceFull", "executorUnavailable"]);

function validateRun(value: JsonValue): AutomationRunEntry {
  if (
    !isRecord(value) ||
    (value.triggerKind !== "schedule" && value.triggerKind !== "event") ||
    (value.startedBy !== "trigger" && value.startedBy !== "user") ||
    (value.status !== "running" && value.status !== "finished") ||
    !safeUInt(value.firedAt) ||
    !safeUInt(value.startedAt) ||
    !safeUInt(value.suppressedEvents) ||
    (value.event !== undefined && !isEventKind(value.event)) ||
    (value.outcome !== undefined && !OUTCOMES.has(value.outcome as string)) ||
    (value.skipReason !== undefined && !SKIP_REASONS.has(value.skipReason as string))
  )
    throw new TypeError("automation run is invalid");
  return Object.freeze({
    runId: boundedId(value.runId, "run id"),
    automationId: boundedId(value.automationId, "automation id"),
    triggerKind: value.triggerKind,
    ...(value.event === undefined ? {} : { event: value.event as AutomationEventKind }),
    firedAt: value.firedAt,
    startedBy: value.startedBy,
    ...(value.subject === undefined ? {} : { subject: validateSubject(value.subject) }),
    status: value.status,
    ...(value.outcome === undefined ? {} : { outcome: value.outcome as AutomationRunOutcome }),
    ...(value.skipReason === undefined ? {} : { skipReason: value.skipReason as AutomationSkipReason }),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    ...(typeof value.exitCode === "number" && Number.isSafeInteger(value.exitCode) ? { exitCode: value.exitCode } : {}),
    startedAt: value.startedAt,
    ...(safeUInt(value.finishedAt) ? { finishedAt: value.finishedAt } : {}),
    ...(safeUInt(value.durationMs) ? { durationMs: value.durationMs } : {}),
    ...(typeof value.sessionId === "string" ? { sessionId: boundedId(value.sessionId, "session id") } : {}),
    ...(Array.isArray(value.openedSessions) && value.openedSessions.length > 0 ? { openedSessions: Object.freeze(value.openedSessions.slice(0, 50).map((id) => boundedId(id, "opened session id"))) } : {}),
    ...(typeof value.outputTail === "string" ? { outputTail: value.outputTail } : {}),
    suppressedEvents: value.suppressedEvents,
    ...(typeof value.recordingId === "string" ? { recordingId: boundedId(value.recordingId, "recording id") } : {}),
  });
}

function validateSubject(value: JsonValue): AutomationSubject {
  if (!isRecord(value)) throw new TypeError("automation subject is invalid");
  const title = typeof value.title === "string" ? { title: value.title } : {};
  switch (value.kind) {
    case "terminal":
      return Object.freeze({ kind: "terminal", serverId: boundedId(value.serverId, "subject server id"), projectId: boundedId(value.projectId, "subject project id"), sessionId: boundedId(value.sessionId, "subject session id"), ...title, ...(typeof value.projectTitle === "string" ? { projectTitle: value.projectTitle } : {}) });
    case "project":
      return Object.freeze({ kind: "project", projectId: boundedId(value.projectId, "subject project id"), ...title });
    case "device":
      return Object.freeze({ kind: "device", deviceId: boundedId(value.deviceId, "subject device id"), ...(typeof value.name === "string" ? { name: value.name } : {}) });
    default:
      throw new TypeError("automation subject is invalid");
  }
}

function validateMissed(value: JsonValue | undefined): readonly AutomationMissedRecord[] {
  if (!Array.isArray(value)) throw new TypeError("automation missed records are invalid");
  return Object.freeze(value.map((record) => {
    if (!isRecord(record) || !safeUInt(record.missedCount) || !safeUInt(record.latestDueAt)) throw new TypeError("automation missed record is invalid");
    return Object.freeze({ automationId: boundedId(record.automationId, "automation id"), missedCount: record.missedCount, latestDueAt: record.latestDueAt });
  }));
}

function isEventKind(value: unknown): value is AutomationEventKind {
  return typeof value === "string" && (AUTOMATION_EVENT_KINDS as readonly string[]).includes(value);
}
function boundedId(value: unknown, name: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError(`${name} is invalid`); return value; }
function safeUInt(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function isRecord(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
