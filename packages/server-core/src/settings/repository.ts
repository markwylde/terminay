import type { JsonValue } from "@terminay/protocol";
import { cloneDefaultServerSettings } from "./defaults.js";
import { classifySetting, isServerSettingPath } from "./classification.js";
import { migrateServerSettings, normalizeServerSettings } from "./normalize.js";
import {
  cloneSettings,
  SETTINGS_SCHEMA_VERSION,
  type ServerSettingsState,
  type SettingsApplyResult,
  type SettingsBackend,
  type SettingsCommandEnvelope,
  type SettingsObject,
  type SettingsResetOptions,
} from "./types.js";

/** Durable, revisioned server settings repository. */
export class ServerSettingsRepository {
  private current: ServerSettingsState | undefined;
  private loaded = false;
  private readonly outcomes = new Map<string, SettingsApplyResult>();
  private readonly listeners = new Set<(state: ServerSettingsState) => void>();

  constructor(private readonly backend: SettingsBackend) {}

  async load(): Promise<ServerSettingsState> {
    if (this.loaded && this.current !== undefined) return cloneSettings(this.current);
    const raw = await this.backend.load();
    const state = migrateServerSettings(raw);
    this.current = state;
    this.loaded = true;
    if (raw !== undefined && !sameJson(raw, state)) {
      if (this.backend.backup !== undefined) await this.backend.backup(state);
      await this.backend.commit(state);
    }
    return cloneSettings(state);
  }

  get state(): ServerSettingsState {
    if (!this.loaded || this.current === undefined) throw new Error("settings repository is not loaded");
    return cloneSettings(this.current);
  }

  get revision(): number { return this.state.revision; }
  get settings(): SettingsObject { return this.state.settings; }

  snapshot(): ServerSettingsState { return this.state; }

  /** Subscribe to committed server-setting snapshots. Observer failures are
   * isolated so a policy consumer cannot roll back a persisted update. */
  onChange(listener: (state: ServerSettingsState) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("settings listener is required");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async apply(envelope: SettingsCommandEnvelope): Promise<SettingsApplyResult> {
    const current = this.current ?? (await this.load());
    if (envelope.commandId !== undefined) {
      const prior = this.outcomes.get(envelope.commandId);
      if (prior !== undefined) return cloneSettings(prior);
    }
    if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== current.revision) {
      const result: SettingsApplyResult = { ok: false, conflict: { code: "conflict", currentRevision: current.revision, currentCursor: current.cursor, message: "settings revision is stale" } };
      if (envelope.commandId !== undefined) this.outcomes.set(envelope.commandId, result);
      return cloneSettings(result);
    }
    let nextSettings: SettingsObject;
    const nextReferences = current.secretReferences;
    try {
      if (envelope.command.type === "set") {
        assertServerPath(envelope.command.path);
        nextSettings = setPath(current.settings, envelope.command.path, envelope.command.value);
      } else if (envelope.command.type === "merge" || envelope.command.type === "replace") {
        nextSettings = envelope.command.type === "replace" ? normalizeServerSettings(envelope.command.settings) : mergePatch(current.settings, envelope.command.settings);
      } else {
        nextSettings = resetPath(current.settings, envelope.command.path);
      }
      nextSettings = normalizeServerSettings(nextSettings);
    } catch (error) {
      throw error instanceof Error ? error : new Error("settings command rejected");
    }
    const next: ServerSettingsState = { schemaVersion: SETTINGS_SCHEMA_VERSION, revision: current.revision + 1, cursor: String(current.revision + 1), settings: nextSettings, secretReferences: nextReferences };
    await this.backend.commit(next);
    this.current = next;
    for (const listener of [...this.listeners]) {
      try { listener(cloneSettings(next)); } catch { /* observers cannot affect persistence */ }
    }
    const result: SettingsApplyResult = { ok: true, revision: next.revision, cursor: next.cursor, state: cloneSettings(next) };
    if (envelope.commandId !== undefined) this.outcomes.set(envelope.commandId, result);
    return cloneSettings(result);
  }

  async update(settings: SettingsObject, expectedRevision?: number, commandId?: string): Promise<SettingsApplyResult> {
    return this.apply({ commandId, expectedRevision, command: { type: "merge", settings } });
  }

  async set(path: string, value: JsonValue, expectedRevision?: number, commandId?: string): Promise<SettingsApplyResult> {
    return this.apply({ commandId, expectedRevision, command: { type: "set", path, value } });
  }

  async reset(options: SettingsResetOptions | number = {}): Promise<SettingsApplyResult> {
    const normalized = typeof options === "number" ? { expectedRevision: options } : options;
    return this.apply({ commandId: normalized.commandId, expectedRevision: normalized.expectedRevision, command: { type: "reset", ...(normalized.path === undefined ? {} : { path: normalized.path }) } });
  }
}

export const SettingsRepository = ServerSettingsRepository;

function mergePatch(current: SettingsObject, patch: SettingsObject): SettingsObject {
  const result = cloneSettings(current) as Record<string, JsonValue>;
  for (const [key, value] of Object.entries(patch)) {
    assertServerPath(key);
    result[key] = mergeValue(result[key], value, key);
  }
  return result;
}

function mergeValue(current: JsonValue | undefined, value: JsonValue, path: string): JsonValue {
  if (typeof current === "object" && current !== null && !Array.isArray(current) && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const result = cloneSettings(current) as Record<string, JsonValue>;
    for (const [key, child] of Object.entries(value)) {
      assertServerPath(`${path}.${key}`);
      result[key] = mergeValue(result[key], child, `${path}.${key}`);
    }
    return result;
  }
  return value;
}

function setPath(current: SettingsObject, path: string, value: JsonValue): SettingsObject {
  const parts = path.replace(/^settings\./, "").split(".").filter(Boolean);
  if (parts.length === 0) throw new Error("setting path is empty");
  const root = cloneSettings(current) as Record<string, JsonValue>;
  let target = root;
  for (const part of parts.slice(0, -1)) {
    const child = target[part];
    if (typeof child !== "object" || child === null || Array.isArray(child)) throw new Error("setting path does not address an object");
    target[part] = cloneSettings(child);
    target = target[part] as Record<string, JsonValue>;
  }
  target[parts[parts.length - 1] as string] = cloneSettings(value);
  return root;
}

function resetPath(current: SettingsObject, path: string | undefined): SettingsObject {
  if (path === undefined || path.trim() === "") return cloneDefaultServerSettings();
  assertServerPath(path);
  const defaults = cloneDefaultServerSettings();
  const value = readPath(defaults, path);
  if (value === undefined) throw new Error("setting path has no default");
  return setPath(current, path, value);
}

function readPath(input: SettingsObject, path: string): JsonValue | undefined {
  let value: JsonValue | undefined = input;
  for (const part of path.replace(/^settings\./, "").split(".").filter(Boolean)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    value = (value as Record<string, JsonValue>)[part];
  }
  return value;
}

function assertServerPath(path: string): void {
  if (!isServerSettingPath(path)) throw new Error(`setting path is ${classifySetting(path)}, not server-owned`);
}

function sameJson(left: unknown, right: unknown): boolean {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}
