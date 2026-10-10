import { assertJsonValue, type JsonValue, type ProtocolId } from "@terminay/protocol";
import type { CommandOptions, QueryOptions } from "./types.js";
import type { QueryCommandTransport } from "./queryCommand.js";

export const MACRO_OPERATIONS = Object.freeze({
  get: "macros.get",
  replace: "macros.replace",
  upsert: "macros.upsert",
  remove: "macros.remove",
  reset: "macros.reset",
  run: "macros.run",
  cancel: "macros.cancel",
  runs: "macros.runs",
} as const);

export const MACRO_EVENTS = Object.freeze({
  changed: "macros.changed",
  runChanged: "macros.run.changed",
} as const);

export type MacroFieldType = "text" | "textarea" | "select" | "number" | "checkbox" | "emoji" | "file";
export type MacroFieldValue = string | number | boolean;

export interface MacroFieldOption {
  readonly label: string;
  readonly value: string;
}

export interface MacroFieldDefinition {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly type: MacroFieldType;
  readonly required: boolean;
  readonly description: string;
  readonly placeholder: string;
  readonly defaultValue: MacroFieldValue;
  readonly options: readonly MacroFieldOption[];
}

export type MacroStep =
  | { readonly id: string; readonly type: "type"; readonly content: string }
  | { readonly id: string; readonly type: "key"; readonly key: string }
  | { readonly id: string; readonly type: "wait_time"; readonly durationSeconds: string }
  | { readonly id: string; readonly type: "wait_inactivity"; readonly durationSeconds: string }
  | { readonly id: string; readonly type: "select_line" }
  | { readonly id: string; readonly type: "paste" }
  /** A stored step the server does not execute. A macro holding one never runs. */
  | { readonly id: string; readonly type: "unsupported"; readonly sourceType: string };

export interface MacroDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** Name of the category the macro belongs to, or empty for none. */
  readonly category: string;
  readonly fields: readonly MacroFieldDefinition[];
  readonly steps: readonly MacroStep[];
}

export interface MacroState {
  readonly schemaVersion: number;
  readonly revision: number;
  readonly cursor: string;
  /** Ordered, unique category names. Empty when the server has none or predates them. */
  readonly categories: readonly string[];
  readonly macros: readonly MacroDefinition[];
}

/** The macro state schema from which a server stores categories. */
export const MACRO_CATEGORIES_SCHEMA_VERSION = 2;

export interface MacroTarget {
  readonly serverId: ProtocolId;
  readonly projectId: ProtocolId;
  readonly sessionId: ProtocolId;
}

export type MacroDisconnectPolicy = "cancel" | "continue";

export interface MacroRunSnapshot {
  readonly runId: string;
  readonly macroId: string;
  readonly target: MacroTarget;
  readonly status: "running" | "completed" | "canceled" | "failed";
  readonly stepIndex: number;
  readonly bytesWritten: number;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly errorCode?: string;
}

export interface MacroEventTransport extends QueryCommandTransport {
  /**
   * Macro definitions and run progress are server-owned state. A transport
   * that cannot subscribe to the canonical event streams must fail closed;
   * otherwise an old compatibility bridge can leave a stale macro projection
   * looking authoritative in a renderer.
   */
  readonly subscribe: (event: string, listener: (payload: JsonValue) => void) => () => void;
}

/** Shared macro facade. Definitions and run commands carry no secrets: a
 * macro never reads the server vault. */
export class MacroClient {
  /** Schema of the last state this server returned; unknown until one arrives. */
  private serverSchemaVersion: number | undefined;

  constructor(private readonly transport: MacroEventTransport) {}

  async get(options: QueryOptions = {}): Promise<MacroState> {
    return this.observe(validateState(await this.transport.query(MACRO_OPERATIONS.get, {}, options)));
  }

  /**
   * Replace every definition and, when `categories` is given, the category
   * list. Categories are sent only to a server known to store them, so an
   * older server is never handed a field it does not understand.
   */
  async replace(macros: readonly unknown[], options: CommandOptions & { readonly categories?: readonly string[] } = {}): Promise<MacroState> {
    const { categories, ...commandOptions } = options;
    const sendCategories = categories !== undefined && (this.serverSchemaVersion ?? 0) >= MACRO_CATEGORIES_SCHEMA_VERSION;
    return this.apply(MACRO_OPERATIONS.replace, { macros: json(macros), ...(sendCategories ? { categories: json(categories) } : {}) }, commandOptions);
  }

  async upsert(macro: unknown, options: CommandOptions = {}): Promise<MacroState> {
    return this.apply(MACRO_OPERATIONS.upsert, { macro: json(macro) }, options);
  }

  async remove(macroId: string, options: CommandOptions = {}): Promise<MacroState> {
    return this.apply(MACRO_OPERATIONS.remove, { macroId: boundedId(macroId, "macro id") }, options);
  }

  async reset(options: CommandOptions = {}): Promise<MacroState> {
    return this.apply(MACRO_OPERATIONS.reset, {}, options);
  }

  async run(
    macroId: string,
    target: MacroTarget,
    values: Readonly<Record<string, MacroFieldValue>> = {},
    options: CommandOptions & { readonly disconnectPolicy?: MacroDisconnectPolicy } = {},
  ): Promise<MacroRunSnapshot> {
    const { disconnectPolicy, ...commandOptions } = options;
    const result = await this.transport.command<JsonValue>(MACRO_OPERATIONS.run, {
      macroId: boundedId(macroId, "macro id"),
      target: targetPayload(target),
      values: valuesPayload(values),
      ...(disconnectPolicy === undefined ? {} : { disconnectPolicy: boundedDisconnectPolicy(disconnectPolicy) }),
    }, commandOptions);
    return validateRun(result);
  }

  async cancel(runId: string, target: MacroTarget, options: CommandOptions = {}): Promise<{ readonly runId: string; readonly canceled: boolean }> {
    const result = await this.transport.command<JsonValue>(MACRO_OPERATIONS.cancel, {
      runId: boundedId(runId, "run id"),
      target: targetPayload(target),
    }, options);
    if (!isRecord(result) || result.runId !== runId || typeof result.canceled !== "boolean") throw new TypeError("macro cancellation response is invalid");
    return Object.freeze({ runId, canceled: result.canceled });
  }

  async runs(options: QueryOptions = {}): Promise<readonly MacroRunSnapshot[]> {
    const result = await this.transport.query<JsonValue>(MACRO_OPERATIONS.runs, {}, options);
    if (!Array.isArray(result)) throw new TypeError("macro runs response is invalid");
    return Object.freeze(result.map(validateRun));
  }

  onChanged(listener: (state: MacroState) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("macro change listener is required");
    if (typeof this.transport.subscribe !== "function") throw new Error("macro change subscription is unavailable");
    return this.transport.subscribe(MACRO_EVENTS.changed, (payload) => listener(this.observe(validateState(payload))));
  }

  onRunChanged(listener: (run: MacroRunSnapshot) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("macro run listener is required");
    if (typeof this.transport.subscribe !== "function") throw new Error("macro run subscription is unavailable");
    return this.transport.subscribe(MACRO_EVENTS.runChanged, (payload) => listener(validateRun(payload)));
  }

  private async apply(operation: string, payload: JsonValue, options: CommandOptions): Promise<MacroState> {
    return this.observe(validateState(await this.transport.command(operation, payload, options)));
  }

  private observe(state: MacroState): MacroState {
    this.serverSchemaVersion = state.schemaVersion;
    return state;
  }
}

function json(value: unknown): JsonValue {
  assertJsonValue(value);
  return value;
}

function validateState(value: JsonValue): MacroState {
  if (!isRecord(value) || !safeUInt(value.schemaVersion) || !safeUInt(value.revision) || typeof value.cursor !== "string" || !Array.isArray(value.macros)) throw new TypeError("macro state is invalid");
  if (value.categories !== undefined && (!Array.isArray(value.categories) || value.categories.some((name) => typeof name !== "string"))) throw new TypeError("macro categories are invalid");
  const categories = Object.freeze([...((value.categories ?? []) as readonly string[])]);
  return Object.freeze({ schemaVersion: value.schemaVersion, revision: value.revision, cursor: value.cursor, categories, macros: Object.freeze(value.macros.map(validateMacro)) });
}

function validateMacro(value: JsonValue): MacroDefinition {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string" || typeof value.description !== "string" || !Array.isArray(value.fields) || !Array.isArray(value.steps)) throw new TypeError("macro definition is invalid");
  const fields = value.fields.map(validateField);
  const steps = value.steps.map(validateStep);
  if (value.category !== undefined && typeof value.category !== "string") throw new TypeError("macro category is invalid");
  return Object.freeze({ id: boundedId(value.id, "macro id"), title: value.title, description: value.description, category: value.category ?? "", fields: Object.freeze(fields), steps: Object.freeze(steps) });
}

function validateField(value: JsonValue): MacroFieldDefinition {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.label !== "string" || !isFieldType(value.type) || typeof value.required !== "boolean" || typeof value.description !== "string" || typeof value.placeholder !== "string" || !isFieldValue(value.defaultValue) || !Array.isArray(value.options)) throw new TypeError("macro field is invalid");
  const options = value.options.map((option) => {
    if (!isRecord(option) || typeof option.label !== "string" || typeof option.value !== "string") throw new TypeError("macro field option is invalid");
    return Object.freeze({ label: option.label, value: option.value });
  });
  return Object.freeze({ id: boundedId(value.id, "macro field id"), name: value.name, label: value.label, type: value.type, required: value.required, description: value.description, placeholder: value.placeholder, defaultValue: value.defaultValue, options: Object.freeze(options) });
}

function validateStep(value: JsonValue): MacroStep {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string") throw new TypeError("macro step is invalid");
  const id = boundedId(value.id, "macro step id");
  switch (value.type) {
    case "type": if (typeof value.content !== "string") throw new TypeError("macro type step is invalid"); return Object.freeze({ id, type: value.type, content: value.content });
    case "key": if (typeof value.key !== "string") throw new TypeError("macro key step is invalid"); return Object.freeze({ id, type: value.type, key: value.key });
    case "wait_time":
    case "wait_inactivity": if (typeof value.durationSeconds !== "string") throw new TypeError("macro wait step is invalid"); return Object.freeze({ id, type: value.type, durationSeconds: value.durationSeconds });
    case "select_line": return Object.freeze({ id, type: value.type });
    case "paste": return Object.freeze({ id, type: value.type });
    // A step this client does not know is shown as unsupported, never dropped
    // and never a reason to reject the whole library. Only its type name is kept.
    default: return Object.freeze({ id, type: "unsupported" as const, sourceType: (value.type === "unsupported" && typeof value.sourceType === "string" ? value.sourceType : value.type).slice(0, 32) });
  }
}

function validateRun(value: JsonValue): MacroRunSnapshot {
  if (!isRecord(value) || typeof value.runId !== "string" || typeof value.macroId !== "string" || !isRecord(value.target) || typeof value.status !== "string" || !["running", "completed", "canceled", "failed"].includes(value.status) || !safeUInt(value.stepIndex) || !safeUInt(value.bytesWritten) || !safeUInt(value.startedAt)) throw new TypeError("macro run snapshot is invalid");
  const target = targetValue(value.target);
  return Object.freeze({ runId: boundedId(value.runId, "run id"), macroId: boundedId(value.macroId, "macro id"), target, status: value.status as MacroRunSnapshot["status"], stepIndex: value.stepIndex, bytesWritten: value.bytesWritten, startedAt: value.startedAt, ...(value.finishedAt === undefined ? {} : { finishedAt: safeUIntValue(value.finishedAt, "finished time") }), ...(value.errorCode === undefined ? {} : { errorCode: boundedText(value.errorCode, "macro error code") }) });
}

function targetPayload(target: MacroTarget): JsonValue {
  return { serverId: boundedId(target.serverId, "target server id"), projectId: boundedId(target.projectId, "target project id"), sessionId: boundedId(target.sessionId, "target session id") };
}

function targetValue(value: Readonly<Record<string, JsonValue>>): MacroTarget {
  return { serverId: boundedId(value.serverId, "target server id"), projectId: boundedId(value.projectId, "target project id"), sessionId: boundedId(value.sessionId, "target session id") };
}

function valuesPayload(values: Readonly<Record<string, MacroFieldValue>>): JsonValue {
  if (!isRecord(values)) throw new TypeError("macro values are invalid");
  for (const value of Object.values(values)) if (!isFieldValue(value)) throw new TypeError("macro value is invalid");
  return values as unknown as JsonValue;
}

function boundedId(value: unknown, name: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError(`${name} is invalid`); return value; }
function boundedText(value: unknown, name: string): string { if (typeof value !== "string" || value.length > 256 || value.includes("\0")) throw new TypeError(`${name} is invalid`); return value; }
function boundedDisconnectPolicy(value: MacroDisconnectPolicy): MacroDisconnectPolicy { if (value !== "cancel" && value !== "continue") throw new TypeError("macro disconnect policy is invalid"); return value; }
function safeUInt(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function safeUIntValue(value: unknown, name: string): number { if (!safeUInt(value)) throw new TypeError(`${name} is invalid`); return value; }
function isFieldType(value: JsonValue | undefined): value is MacroFieldType { return value === "text" || value === "textarea" || value === "select" || value === "number" || value === "checkbox" || value === "emoji" || value === "file"; }
function isFieldValue(value: JsonValue | undefined): value is MacroFieldValue { return typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value); }
function isRecord(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
