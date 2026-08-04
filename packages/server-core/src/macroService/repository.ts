import { MacroServiceError } from "./errors.js";
import { normalizeMacro, normalizeMacroState, normalizeLimits } from "./normalize.js";
import {
  MACRO_SCHEMA_VERSION,
  type MacroApplyResult,
  type MacroBackend,
  type MacroCommandEnvelope,
  type MacroDefinition,
  type MacroLimits,
  type MacroResetOptions,
  type MacroState,
} from "./types.js";

/** Durable, revisioned server-owned macro definitions. */
export class MacroRepository {
  private current: MacroState | undefined;
  private loaded = false;
  private readonly outcomes = new Map<string, MacroApplyResult>();
  readonly limits: Required<MacroLimits>;

  constructor(private readonly backend: MacroBackend, limits: MacroLimits = {}) {
    this.limits = Object.freeze(normalizeLimits(limits));
  }

  async load(): Promise<MacroState> {
    if (this.loaded && this.current !== undefined) return cloneState(this.current);
    const raw = await this.backend.load();
    const state = normalizeMacroState(raw, this.limits);
    this.current = state;
    this.loaded = true;
    if (raw !== undefined && !sameJson(raw, state)) {
      if (this.backend.backup !== undefined) await this.backend.backup(cloneState(state));
      await this.backend.commit(cloneState(state));
    }
    return cloneState(state);
  }

  get state(): MacroState {
    if (!this.loaded || this.current === undefined) throw new Error("macro repository is not loaded");
    return cloneState(this.current);
  }

  get revision(): number { return this.state.revision; }

  snapshot(): MacroState { return this.state; }

  async apply(envelope: MacroCommandEnvelope): Promise<MacroApplyResult> {
    const current = this.current ?? await this.load();
    if (envelope.commandId !== undefined) {
      const previous = this.outcomes.get(envelope.commandId);
      if (previous !== undefined) return cloneResult(previous);
    }
    if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== current.revision) {
      const conflict: MacroApplyResult = {
        ok: false,
        conflict: {
          code: "conflict",
          currentRevision: current.revision,
          currentCursor: current.cursor,
          message: "macro revision is stale",
        },
      };
      if (envelope.commandId !== undefined) this.outcomes.set(envelope.commandId, conflict);
      return cloneResult(conflict);
    }

    let macros: readonly MacroDefinition[];
    const command = envelope.command;
    switch (command.type) {
      case "replace":
        macros = normalizeMacroState({ macros: command.macros }, this.limits).macros;
        break;
      case "upsert": {
        const macro = normalizeMacro(command.macro, 0, this.limits);
        macros = [...current.macros.filter((item) => item.id !== macro.id), macro];
        break;
      }
      case "remove":
        macros = current.macros.filter((item) => item.id !== command.macroId);
        break;
      case "reset":
        macros = [];
        break;
      default:
        throw new MacroServiceError("invalid_macro", "unknown macro command");
    }
    if (macros.length > 4096) throw new MacroServiceError("limit", "macro definition count exceeds the limit");
    const next: MacroState = {
      schemaVersion: MACRO_SCHEMA_VERSION,
      revision: current.revision + 1,
      cursor: String(current.revision + 1),
      macros: cloneMacros(macros),
    };
    await this.backend.commit(cloneState(next));
    this.current = next;
    const result: MacroApplyResult = { ok: true, revision: next.revision, cursor: next.cursor, state: cloneState(next) };
    if (envelope.commandId !== undefined) this.outcomes.set(envelope.commandId, result);
    return cloneResult(result);
  }

  async replace(macros: readonly unknown[], expectedRevision?: number, commandId?: string): Promise<MacroApplyResult> {
    return this.apply({ commandId, expectedRevision, command: { type: "replace", macros } });
  }

  async upsert(macro: unknown, expectedRevision?: number, commandId?: string): Promise<MacroApplyResult> {
    return this.apply({ commandId, expectedRevision, command: { type: "upsert", macro } });
  }

  async remove(macroId: string, expectedRevision?: number, commandId?: string): Promise<MacroApplyResult> {
    return this.apply({ commandId, expectedRevision, command: { type: "remove", macroId } });
  }

  async reset(options: MacroResetOptions | number = {}): Promise<MacroApplyResult> {
    const normalized = typeof options === "number" ? { expectedRevision: options } : options;
    return this.apply({ commandId: normalized.commandId, expectedRevision: normalized.expectedRevision, command: { type: "reset" } });
  }
}

export const MacroDefinitionRepository = MacroRepository;

function cloneState(state: MacroState): MacroState {
  return structuredClone(state);
}

function cloneMacros(macros: readonly MacroDefinition[]): readonly MacroDefinition[] {
  return structuredClone(macros);
}

function cloneResult(result: MacroApplyResult): MacroApplyResult {
  return structuredClone(result);
}

function sameJson(left: unknown, right: unknown): boolean {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}
