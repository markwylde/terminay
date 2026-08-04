import { MacroServiceError } from "./errors.js";
import {
  MACRO_SCHEMA_VERSION,
  type MacroDefinition,
  type MacroFieldDefinition,
  type MacroFieldOption,
  type MacroFieldType,
  type MacroFieldValue,
  type MacroLimits,
  type MacroState,
  type MacroStep,
} from "./types.js";

export const DEFAULT_MACRO_LIMITS: Required<MacroLimits> = Object.freeze({
  maxSteps: 256,
  maxFields: 64,
  maxStringBytes: 16_384,
  maxOutputBytes: 131_072,
  maxDelayMs: 300_000,
  maxConcurrentRuns: 4,
});

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PLACEHOLDER_PATTERN = /{{\s*([^{}]+?)\s*}}|{\s*([^{}]+?)\s*}/g;

export function normalizeLimits(input: MacroLimits = {}): Required<MacroLimits> {
  return {
    maxSteps: boundedLimit(input.maxSteps, DEFAULT_MACRO_LIMITS.maxSteps, 1, 4096),
    maxFields: boundedLimit(input.maxFields, DEFAULT_MACRO_LIMITS.maxFields, 1, 256),
    maxStringBytes: boundedLimit(input.maxStringBytes, DEFAULT_MACRO_LIMITS.maxStringBytes, 256, 1_048_576),
    maxOutputBytes: boundedLimit(input.maxOutputBytes, DEFAULT_MACRO_LIMITS.maxOutputBytes, 1024, 16_777_216),
    maxDelayMs: boundedLimit(input.maxDelayMs, DEFAULT_MACRO_LIMITS.maxDelayMs, 0, 86_400_000),
    maxConcurrentRuns: boundedLimit(input.maxConcurrentRuns, DEFAULT_MACRO_LIMITS.maxConcurrentRuns, 1, 64),
  };
}

export function normalizeMacroState(input: unknown, limits: MacroLimits = {}): MacroState {
  const normalizedLimits = normalizeLimits(limits);
  const record = asRecord(input);
  const revision = safeRevision(record?.revision);
  const rawMacros = Array.isArray(record?.macros) ? record.macros : Array.isArray(input) ? input : [];
  if (rawMacros.length > 4096) throw new MacroServiceError("limit", "macro definition count exceeds the limit");
  const macros = rawMacros.map((value, index) => normalizeMacro(value, index, normalizedLimits));
  const ids = new Set<string>();
  for (const macro of macros) {
    if (ids.has(macro.id)) throw new MacroServiceError("invalid_macro", "macro ids must be unique", { id: macro.id });
    ids.add(macro.id);
  }
  return { schemaVersion: MACRO_SCHEMA_VERSION, revision, cursor: String(revision), macros };
}

export function normalizeMacro(input: unknown, index = 0, limits: MacroLimits = {}): MacroDefinition {
  const normalizedLimits = normalizeLimits(limits);
  const record = asRecord(input) ?? {};
  const id = normalizeId(record.id, `macro-${index + 1}`);
  const title = boundedString(record.title, `Macro ${index + 1}`, normalizedLimits.maxStringBytes);
  const description = boundedString(record.description, "", normalizedLimits.maxStringBytes);
  const rawSteps = Array.isArray(record.steps)
    ? record.steps
    : typeof record.template === "string"
      ? [{ type: "type", content: record.template }]
      : [];
  if (rawSteps.length > normalizedLimits.maxSteps) throw new MacroServiceError("limit", "macro step count exceeds the limit", { id });
  const steps = rawSteps.map((step, stepIndex) => normalizeStep(step, stepIndex, normalizedLimits));
  const explicitFields = Array.isArray(record.fields)
    ? record.fields.map((field, fieldIndex) => normalizeField(field, fieldIndex, normalizedLimits))
    : [];
  if (explicitFields.length > normalizedLimits.maxFields) throw new MacroServiceError("limit", "macro field count exceeds the limit", { id });
  const fields = mergeFieldsWithSteps(steps, explicitFields, normalizedLimits.maxFields);
  return { id, title, description, fields, steps };
}

export function normalizeFieldValue(value: unknown, type: MacroFieldType): MacroFieldValue {
  switch (type) {
    case "number": return typeof value === "number" && Number.isFinite(value) ? value : 0;
    case "checkbox": return typeof value === "boolean" ? value : false;
    default: return typeof value === "string" ? value : "";
  }
}

export function renderMacroTemplate(template: string, values: Readonly<Record<string, MacroFieldValue>>, maxBytes = DEFAULT_MACRO_LIMITS.maxStringBytes): string {
  const etaRendered = renderSafeEtaTemplate(template, values);
  const rendered = etaRendered.replace(PLACEHOLDER_PATTERN, (_match, doubleName: string | undefined, singleName: string | undefined) => {
    const key = (doubleName ?? singleName ?? "").trim();
    const value = values[key];
    if (value === undefined) return "";
    return typeof value === "string" ? value : String(value);
  });
  if (new TextEncoder().encode(rendered).byteLength > maxBytes) throw new MacroServiceError("limit", "rendered macro step exceeds the string limit");
  return rendered;
}

/**
 * Interpret the small, data-only Eta subset used by macro previews.  General
 * JavaScript in a server-side template would be an arbitrary-code execution
 * boundary, so expressions are limited to field reads and literal equality
 * conditions.  Unsupported tags fail closed instead of being evaluated.
 */
function renderSafeEtaTemplate(template: string, values: Readonly<Record<string, MacroFieldValue>>): string {
  const tagPattern = /<%[-_]?\s*([~=]?)([\s\S]*?)\s*[-_]?%>/g;
  const stack: Array<{ readonly parentActive: boolean; readonly condition: boolean }> = [];
  let active = true;
  let cursor = 0;
  let output = "";
  for (const match of template.matchAll(tagPattern)) {
    const index = match.index ?? 0;
    if (active) output += template.slice(cursor, index);
    const marker = match[1] ?? "";
    const code = (match[2] ?? "").trim();
    if (marker === "=" || marker === "~") {
      if (active) output += renderSafeEtaExpression(code, values);
    } else if (/^if\s*\(/u.test(code)) {
      const condition = evaluateSafeEtaCondition(code, values);
      stack.push({ parentActive: active, condition });
      active = active && condition;
    } else if (/^(?:\}\s*)?else\s*\{/u.test(code)) {
      const branch = stack.at(-1);
      if (branch === undefined) throw new MacroServiceError("invalid_macro", "template has an unmatched else branch");
      active = branch.parentActive && !branch.condition;
    } else if (/^\}\s*$/u.test(code)) {
      const branch = stack.pop();
      if (branch === undefined) throw new MacroServiceError("invalid_macro", "template has an unmatched closing branch");
      active = branch.parentActive;
    } else if (code.length > 0) {
      throw new MacroServiceError("invalid_macro", "template expression is not allowed on the server");
    }
    cursor = index + match[0].length;
  }
  if (active) output += template.slice(cursor);
  if (stack.length > 0) throw new MacroServiceError("invalid_macro", "template has an unterminated branch");
  return output;
}

function renderSafeEtaExpression(expression: string, values: Readonly<Record<string, MacroFieldValue>>): string {
  const name = safeEtaName(expression);
  if (name === undefined) throw new MacroServiceError("invalid_macro", "template interpolation is not allowed on the server");
  const value = values[name];
  return value === undefined ? "" : typeof value === "string" ? value : String(value);
}

function evaluateSafeEtaCondition(code: string, values: Readonly<Record<string, MacroFieldValue>>): boolean {
  const match = /^if\s*\(\s*([A-Za-z_$][\w$]*|it\.[A-Za-z_$][\w$]*)\s*(===|!==|==|!=)\s*(true|false|null|-?\d+(?:\.\d+)?|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")\s*\)\s*\{?$/u.exec(code);
  if (match === null) throw new MacroServiceError("invalid_macro", "template condition is not allowed on the server");
  const name = safeEtaName(match[1] as string);
  if (name === undefined) throw new MacroServiceError("invalid_macro", "template condition field is invalid");
  const actual = values[name];
  const expectedToken = match[3] as string;
  const expected: MacroFieldValue | null = expectedToken === "true"
    ? true
    : expectedToken === "false"
      ? false
      : expectedToken === "null"
        ? null
        : (expectedToken.startsWith("'") || expectedToken.startsWith('"'))
          ? expectedToken.slice(1, -1).replace(/\\(['"])/g, "$1")
          : Number(expectedToken);
  const equal = actual === expected;
  return match[2] === "!==" || match[2] === "!=" ? !equal : equal;
}

function safeEtaName(expression: string): string | undefined {
  const normalized = expression.trim().replace(/^it\./u, "");
  return /^[A-Za-z_$][\w$]*$/u.test(normalized) ? normalized : undefined;
}

export function extractPlaceholders(step: MacroStep): readonly string[] {
  if (step.type !== "type" && step.type !== "wait_time" && step.type !== "wait_inactivity") return [];
  const source = step.type === "type" ? step.content : step.durationSeconds;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(PLACEHOLDER_PATTERN)) {
    const name = (match[1] ?? match[2] ?? "").trim();
    if (name && !seen.has(name)) {
      names.push(name);
      seen.add(name);
    }
  }
  return names;
}

function normalizeStep(input: unknown, index: number, limits: Required<MacroLimits>): MacroStep {
  const record = asRecord(input) ?? {};
  const id = normalizeId(record.id, `step-${index + 1}`);
  const type = typeof record.type === "string" ? record.type : "type";
  switch (type) {
    case "type": return { id, type, content: boundedString(record.content, "", limits.maxStringBytes) };
    case "key": return { id, type, key: boundedString(record.key, "Enter", limits.maxStringBytes) };
    case "secret": return { id, type, secretId: normalizeId(record.secretId, "") };
    case "wait_time":
    case "wait_inactivity": {
      const fallback = type === "wait_time" ? "1" : "3";
      const rawSeconds = record.durationSeconds;
      const rawMilliseconds = record.durationMs;
      const durationSeconds = rawSeconds !== undefined
        ? normalizeDuration(rawSeconds, fallback, limits.maxStringBytes)
        : normalizeDuration(rawMilliseconds, fallback, limits.maxStringBytes, true);
      return { id, type, durationSeconds };
    }
    case "select_line": return { id, type };
    case "paste": return { id, type };
    default: throw new MacroServiceError("invalid_macro", "macro step type is unsupported", { type });
  }
}

function normalizeField(input: unknown, index: number, limits: Required<MacroLimits>): MacroFieldDefinition {
  const record = asRecord(input) ?? {};
  const type = normalizeFieldType(record.type);
  const name = normalizeName(record.name, `field_${index + 1}`);
  const rawOptions = Array.isArray(record.options) ? record.options : [];
  const options = rawOptions.slice(0, 256).flatMap((option, optionIndex): MacroFieldOption[] => {
    const value = asRecord(option);
    if (value === undefined) return [];
    const optionValue = boundedString(value.value, boundedString(value.label, `option-${optionIndex + 1}`, limits.maxStringBytes), limits.maxStringBytes).trim();
    if (!optionValue) return [];
    return [{ label: boundedString(value.label, optionValue, limits.maxStringBytes), value: optionValue }];
  });
  const defaultValue = normalizeFieldValue(record.defaultValue, type);
  const normalizedDefault = type === "select" && options.length > 0 && (typeof defaultValue !== "string" || !options.some((option) => option.value === defaultValue))
    ? options[0]?.value ?? ""
    : defaultValue;
  return {
    id: normalizeId(record.id, `field-${index + 1}`),
    name,
    label: boundedString(record.label, name, limits.maxStringBytes),
    type,
    required: record.required !== false,
    description: boundedString(record.description, "", limits.maxStringBytes),
    placeholder: boundedString(record.placeholder, "", limits.maxStringBytes),
    defaultValue: normalizedDefault,
    options,
  };
}

function mergeFieldsWithSteps(steps: readonly MacroStep[], explicit: readonly MacroFieldDefinition[], maxFields: number): readonly MacroFieldDefinition[] {
  const fields = [...explicit];
  const names = new Set(fields.map((field) => field.name));
  for (const step of steps) {
    for (const name of extractPlaceholders(step)) {
      if (names.has(name)) continue;
      if (fields.length >= maxFields) throw new MacroServiceError("limit", "macro field count exceeds the limit");
      fields.push({ id: `field-${fields.length + 1}`, name, label: name, type: "text", required: true, description: "", placeholder: "", defaultValue: "", options: [] });
      names.add(name);
    }
  }
  return fields;
}

function normalizeFieldType(value: unknown): MacroFieldType {
  return value === "textarea" || value === "select" || value === "number" || value === "checkbox" || value === "emoji" || value === "file" ? value : "text";
}

function normalizeDuration(value: unknown, fallback: string, maxBytes: number, fromMilliseconds = false): string {
  const number = typeof value === "number" && Number.isFinite(value) ? value / (fromMilliseconds ? 1000 : 1) : undefined;
  const stringValue = typeof value === "string" && fromMilliseconds ? Number(value) / 1000 : value;
  const result = typeof stringValue === "string" ? stringValue : number === undefined ? fallback : String(number);
  const bounded = boundedString(result, fallback, maxBytes);
  if (!/^\s*(?:\d+(?:\.\d+)?|\{[^{}]+\}|{{[^{}]+}})\s*$/.test(bounded)) return fallback;
  return bounded;
}

function normalizeId(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (ID_PATTERN.test(candidate)) return candidate;
  return fallback;
}

function normalizeName(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return candidate.length > 0 && candidate.length <= 256 ? candidate : fallback;
}

function boundedString(value: unknown, fallback: string, maxBytes: number): string {
  const candidate = typeof value === "string" ? value : fallback;
  const bytes = new TextEncoder().encode(candidate);
  if (bytes.byteLength <= maxBytes) return candidate;
  return new TextDecoder().decode(bytes.slice(0, maxBytes));
}

function boundedLimit(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value === undefined) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function safeRevision(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
