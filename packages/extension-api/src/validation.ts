import {
  EXTENSION_ID_PATTERN,
  EXTENSION_LIMITS,
  LOCAL_ID_PATTERN,
  isNamespacedId,
} from "./constants.js";
import type {
  DeclarativeForm,
  ExtensionPermission,
  FormField,
  ProjectEnvironmentContribution,
  TerminayExtensionManifest,
} from "./types.js";

export interface SchemaIssue {
  path: string;
  code: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: SchemaIssue[] };

const permissions = new Set<ExtensionPermission>([
  "configuration:read", "configuration:write", "data:read", "data:write",
  "cache:write", "network", "secrets:resolve", "provider:depend",
  "external-resources:manage",
]);
const capabilities = new Set([
  "terminal", "filesystem", "filesystem-watch", "git", "process-observation",
  "agent-journal", "mcp",
]);
const manifestKeys = new Set([
  "manifestVersion", "id", "displayName", "description", "api", "engines",
  "entrypoint", "platforms", "permissions", "extensionDependencies", "contributes",
]);
const fieldKeys = new Set([
  "id", "type", "label", "description", "required", "disabledReason", "visibleWhen",
  "placeholder", "minLength", "maxLength", "pattern", "minimum", "maximum", "step",
  "options", "optionSource", "searchable", "multiple",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function closed(value: Record<string, unknown>, allowed: Set<string>, path: string, out: SchemaIssue[]): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) out.push({ path: `${path}.${key}`, code: "unknown_field", message: "Unknown field" });
}
function string(value: unknown, path: string, out: SchemaIssue[], max: number = EXTENSION_LIMITS.stringLength): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    out.push({ path, code: "invalid_string", message: `Expected a non-empty string of at most ${max} characters` });
    return false;
  }
  return true;
}
function unique(values: unknown[], path: string, out: SchemaIssue[]): void {
  const seen = new Set<unknown>();
  for (let index = 0; index < values.length; index++) {
    if (seen.has(values[index])) out.push({ path: `${path}[${index}]`, code: "duplicate", message: "Duplicate value" });
    seen.add(values[index]);
  }
}
function relativeEntrypoint(value: unknown, out: SchemaIssue[]): void {
  if (!string(value, "$.entrypoint", out, 256)) return;
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || value.split("/").includes("..") || !value.endsWith(".js")) {
    out.push({ path: "$.entrypoint", code: "unsafe_entrypoint", message: "Entrypoint must be a relative, non-escaping .js path using forward slashes" });
  }
}

export function validateExtensionManifest(value: unknown): ValidationResult<TerminayExtensionManifest> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", code: "invalid_type", message: "Expected an object" }] };
  closed(value, manifestKeys, "$", out);
  if (value.manifestVersion !== 1) out.push({ path: "$.manifestVersion", code: "unsupported_version", message: "Only manifest version 1 is supported" });
  if (string(value.id, "$.id", out, EXTENSION_LIMITS.extensionIdLength) && !EXTENSION_ID_PATTERN.test(value.id)) out.push({ path: "$.id", code: "invalid_id", message: "Use lowercase DNS-style characters" });
  string(value.displayName, "$.displayName", out, EXTENSION_LIMITS.displayNameLength);
  if (value.description !== undefined) string(value.description, "$.description", out, EXTENSION_LIMITS.descriptionLength);
  string(value.api, "$.api", out, 64);
  relativeEntrypoint(value.entrypoint, out);
  if (!record(value.engines)) out.push({ path: "$.engines", code: "invalid_type", message: "Expected an object" });
  else {
    closed(value.engines, new Set(["terminay", "node"]), "$.engines", out);
    string(value.engines.terminay, "$.engines.terminay", out, 64);
    string(value.engines.node, "$.engines.node", out, 64);
  }
  if (!Array.isArray(value.permissions) || value.permissions.length > EXTENSION_LIMITS.permissions) out.push({ path: "$.permissions", code: "invalid_array", message: "Expected a bounded permission array" });
  else {
    unique(value.permissions, "$.permissions", out);
    value.permissions.forEach((permission, index) => { if (!permissions.has(permission as ExtensionPermission)) out.push({ path: `$.permissions[${index}]`, code: "unknown_permission", message: "Unknown permission" }); });
  }
  if (value.platforms !== undefined && (!Array.isArray(value.platforms) || value.platforms.some((item) => !["darwin", "linux", "win32"].includes(String(item))))) out.push({ path: "$.platforms", code: "invalid_platform", message: "Unsupported platform metadata" });
  if (value.extensionDependencies !== undefined) validateDependencies(value.extensionDependencies, out);
  if (!record(value.contributes)) out.push({ path: "$.contributes", code: "invalid_type", message: "Expected an object" });
  else {
    closed(value.contributes, new Set(["projectEnvironments"]), "$.contributes", out);
    validateContributions(value.contributes.projectEnvironments, typeof value.id === "string" ? value.id : "", out);
  }
  return out.length === 0 ? { ok: true, value: value as unknown as TerminayExtensionManifest } : { ok: false, issues: out };
}

function validateDependencies(value: unknown, out: SchemaIssue[]): void {
  if (!Array.isArray(value) || value.length > EXTENSION_LIMITS.dependencies) { out.push({ path: "$.extensionDependencies", code: "invalid_array", message: "Expected a bounded dependency array" }); return; }
  const ids: unknown[] = [];
  value.forEach((item, index) => {
    const path = `$.extensionDependencies[${index}]`;
    if (!record(item)) { out.push({ path, code: "invalid_type", message: "Expected an object" }); return; }
    closed(item, new Set(["extensionId", "apiRange", "optional"]), path, out);
    if (string(item.extensionId, `${path}.extensionId`, out, EXTENSION_LIMITS.extensionIdLength) && !EXTENSION_ID_PATTERN.test(item.extensionId)) out.push({ path: `${path}.extensionId`, code: "invalid_id", message: "Invalid extension id" });
    string(item.apiRange, `${path}.apiRange`, out, 64);
    if (item.optional !== undefined && typeof item.optional !== "boolean") out.push({ path: `${path}.optional`, code: "invalid_type", message: "Expected boolean" });
    ids.push(item.extensionId);
  });
  unique(ids, "$.extensionDependencies", out);
}

function validateContributions(value: unknown, extensionId: string, out: SchemaIssue[]): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > EXTENSION_LIMITS.contributions) { out.push({ path: "$.contributes.projectEnvironments", code: "invalid_array", message: "Expected one or more bounded contributions" }); return; }
  const ids: unknown[] = [];
  value.forEach((item, index) => {
    const path = `$.contributes.projectEnvironments[${index}]`;
    if (!record(item)) { out.push({ path, code: "invalid_type", message: "Expected an object" }); return; }
    closed(item, new Set(["id", "displayName", "description", "icon", "capabilities"]), path, out);
    if (string(item.id, `${path}.id`, out, EXTENSION_LIMITS.providerIdLength) && !isNamespacedId(item.id, extensionId)) out.push({ path: `${path}.id`, code: "invalid_namespace", message: "Provider id must be namespaced by the extension id" });
    string(item.displayName, `${path}.displayName`, out, EXTENSION_LIMITS.displayNameLength);
    if (!Array.isArray(item.capabilities) || item.capabilities.length === 0) out.push({ path: `${path}.capabilities`, code: "invalid_array", message: "Expected capabilities" });
    else {
      unique(item.capabilities, `${path}.capabilities`, out);
      item.capabilities.forEach((capability, capabilityIndex) => { if (!capabilities.has(String(capability))) out.push({ path: `${path}.capabilities[${capabilityIndex}]`, code: "unknown_capability", message: "Unknown capability" }); });
    }
    ids.push(item.id);
  });
  unique(ids, "$.contributes.projectEnvironments", out);
}

export function validateDeclarativeForm(value: unknown): ValidationResult<DeclarativeForm> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", code: "invalid_type", message: "Expected an object" }] };
  closed(value, new Set(["id", "title", "description", "sections", "submitLabel"]), "$", out);
  if (string(value.id, "$.id", out, 64) && !LOCAL_ID_PATTERN.test(value.id)) out.push({ path: "$.id", code: "invalid_id", message: "Invalid form id" });
  string(value.title, "$.title", out, 128);
  string(value.submitLabel, "$.submitLabel", out, 64);
  if (!Array.isArray(value.sections) || value.sections.length > EXTENSION_LIMITS.formSections) out.push({ path: "$.sections", code: "invalid_array", message: "Expected bounded sections" });
  else {
    const allFields: unknown[] = [];
    for (const [sectionIndex, section] of value.sections.entries()) {
      const path = `$.sections[${sectionIndex}]`;
      if (!record(section)) { out.push({ path, code: "invalid_type", message: "Expected an object" }); continue; }
      closed(section, new Set(["id", "title", "description", "disclosure", "fields"]), path, out);
      string(section.id, `${path}.id`, out, 64); string(section.title, `${path}.title`, out, 128);
      if (!Array.isArray(section.fields)) { out.push({ path: `${path}.fields`, code: "invalid_array", message: "Expected fields" }); continue; }
      for (const [fieldIndex, field] of section.fields.entries()) { validateField(field, `${path}.fields[${fieldIndex}]`, out); if (record(field)) allFields.push(field.id); }
    }
    if (allFields.length > EXTENSION_LIMITS.formFields) out.push({ path: "$.sections", code: "limit_exceeded", message: "Too many fields" });
    unique(allFields, "$.sections[*].fields", out);
  }
  return out.length === 0 ? { ok: true, value: value as unknown as DeclarativeForm } : { ok: false, issues: out };
}

function validateField(value: unknown, path: string, out: SchemaIssue[]): void {
  if (!record(value)) { out.push({ path, code: "invalid_type", message: "Expected an object" }); return; }
  closed(value, fieldKeys, path, out);
  if (string(value.id, `${path}.id`, out, 64) && !LOCAL_ID_PATTERN.test(value.id)) out.push({ path: `${path}.id`, code: "invalid_id", message: "Invalid field id" });
  string(value.label, `${path}.label`, out, 128);
  const types = ["text", "url", "secret", "textarea", "number", "checkbox", "switch", "select", "preset-cards"];
  if (!types.includes(String(value.type))) out.push({ path: `${path}.type`, code: "unknown_field_type", message: "Unsupported field type" });
  if ((value.type === "select" || value.type === "preset-cards") && value.options === undefined && value.optionSource === undefined) out.push({ path, code: "missing_options", message: "Select fields need options or an option source" });
  if (value.options !== undefined && (!Array.isArray(value.options) || value.options.length > EXTENSION_LIMITS.fieldOptions)) out.push({ path: `${path}.options`, code: "invalid_array", message: "Expected bounded options" });
  if (value.visibleWhen !== undefined && !record(value.visibleWhen)) out.push({ path: `${path}.visibleWhen`, code: "invalid_type", message: "Expected visibility condition" });
}

export function parseExtensionManifest(value: unknown): TerminayExtensionManifest {
  const result = validateExtensionManifest(value);
  if (!result.ok) throw new ExtensionSchemaError("Invalid Terminay extension manifest", result.issues);
  return result.value;
}

export class ExtensionSchemaError extends Error {
  constructor(message: string, readonly issues: SchemaIssue[]) { super(message); this.name = "ExtensionSchemaError"; }
}

export function assertManifestMatchesPackage(manifest: TerminayExtensionManifest, packageJson: unknown): void {
  if (!record(packageJson)) throw new ExtensionSchemaError("Invalid package.json", [{ path: "$", code: "invalid_type", message: "Expected object" }]);
  if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") throw new ExtensionSchemaError("Invalid package identity", [{ path: "$", code: "missing_package_identity", message: "Package name and version are required" }]);
  if (!record(packageJson.exports)) throw new ExtensionSchemaError("Missing package exports", [{ path: "$.exports", code: "missing_exports", message: "Extension entrypoint must be exported" }]);
  const exported = Object.values(packageJson.exports).some((entry) => entry === `./${manifest.entrypoint}` || (record(entry) && Object.values(entry).includes(`./${manifest.entrypoint}`)));
  if (!exported) throw new ExtensionSchemaError("Entrypoint is not exported", [{ path: "$.exports", code: "entrypoint_not_exported", message: manifest.entrypoint }]);
}

export type { FormField, ProjectEnvironmentContribution };
