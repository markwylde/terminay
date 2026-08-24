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
  OptionSourceResult,
  ProgressPresentation,
  ProvisioningResult,
  ProjectEnvironmentContribution,
  ProviderDefinition,
  ProviderEnvironmentStatus,
  SshAgentIdentity,
  SshAgentSignature,
  EnvironmentActionResult,
  TerminayExtensionManifest,
  ValidationIssue,
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
  "external-resources:manage", "ssh-agent:use",
]);
const capabilities = new Set([
  "terminal", "filesystem", "filesystem-observation", "git", "process-observation",
  "agent-journal", "mcp-bridge", "infrastructure", "shell-discovery",
]);
const manifestKeys = new Set([
  "manifestVersion", "id", "displayName", "description", "api", "engines",
  "entrypoint", "platforms", "permissions", "extensionDependencies", "contributes",
]);
const fieldKeys = new Set([
  "id", "type", "label", "description", "required", "disabledReason", "visibleWhen",
  "defaultValue", "suggestionSource", "suggestionLabel",
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

export function validateProviderDefinition(value: unknown): ValidationResult<ProviderDefinition> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["providerId", "displayName", "description", "icon", "capabilities", "profileForm", "createForm"]), "$", out);
  string(value.providerId, "$.providerId", out, EXTENSION_LIMITS.providerIdLength);
  string(value.displayName, "$.displayName", out, EXTENSION_LIMITS.displayNameLength);
  if (value.description !== undefined) string(value.description, "$.description", out, EXTENSION_LIMITS.descriptionLength);
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0 || value.capabilities.some((item) => !capabilities.has(String(item)))) out.push({ path: "$.capabilities", code: "invalid_capabilities", message: "Expected supported capabilities" });
  for (const key of ["profileForm", "createForm"] as const) if (value[key] !== undefined) {
    const result = validateDeclarativeForm(value[key]);
    if (!result.ok) out.push(...result.issues.map((issue) => ({ ...issue, path: `$.${key}${issue.path.slice(1)}` })));
  }
  return out.length === 0 ? { ok: true, value: value as unknown as ProviderDefinition } : { ok: false, issues: out };
}

export function validateOptionSourceResult(value: unknown): ValidationResult<OptionSourceResult> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["options", "nextCursor"]), "$", out);
  if (!Array.isArray(value.options) || value.options.length > EXTENSION_LIMITS.fieldOptions) out.push({ path: "$.options", code: "invalid_array", message: "Expected bounded options" });
  else value.options.forEach((option, index) => { validateOption(option, `$.options[${index}]`, out); });
  if (value.nextCursor !== undefined) string(value.nextCursor, "$.nextCursor", out, 512);
  return out.length === 0 ? { ok: true, value: value as unknown as OptionSourceResult } : { ok: false, issues: out };
}

export function validateValidationIssues(value: unknown): ValidationResult<ValidationIssue[]> {
  const out: SchemaIssue[] = [];
  if (!Array.isArray(value) || value.length > 128) out.push({ path: "$", code: "invalid_array", message: "Expected bounded validation issues" });
  else value.forEach((issue, index) => {
    const path = `$[${index}]`;
    if (!record(issue)) { out.push({ path, code: "invalid_type", message: "Expected object" }); return; }
    closed(issue, new Set(["fieldId", "code", "message"]), path, out);
    if (issue.fieldId !== undefined) string(issue.fieldId, `${path}.fieldId`, out, 64);
    string(issue.code, `${path}.code`, out, 64); string(issue.message, `${path}.message`, out, 1024);
  });
  return out.length === 0 ? { ok: true, value: value as ValidationIssue[] } : { ok: false, issues: out };
}

const sshSignatureAlgorithms = new Set(["ssh-ed25519", "rsa-sha2-256", "rsa-sha2-512", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"]);

export function validateSshAgentIdentities(value: unknown): ValidationResult<SshAgentIdentity[]> {
  const out: SchemaIssue[] = [];
  if (!Array.isArray(value) || value.length > EXTENSION_LIMITS.sshAgentIdentities) out.push({ path: "$", code: "invalid_array", message: "Expected bounded agent identities" });
  else value.forEach((identity, index) => {
    const path = `$[${index}]`;
    if (!record(identity)) { out.push({ path, code: "invalid_type", message: "Expected object" }); return; }
    closed(identity, new Set(["identityId", "algorithm", "publicKey", "fingerprint", "comment"]), path, out);
    string(identity.identityId, `${path}.identityId`, out, 256); string(identity.fingerprint, `${path}.fingerprint`, out, 256);
    if (!sshSignatureAlgorithms.has(String(identity.algorithm))) out.push({ path: `${path}.algorithm`, code: "invalid_algorithm", message: "Unsupported signing algorithm" });
    bytes(identity.publicKey, `${path}.publicKey`, EXTENSION_LIMITS.sshAgentPublicKeyBytes, out);
    if (identity.comment !== undefined) string(identity.comment, `${path}.comment`, out, 512);
  });
  return out.length === 0 ? { ok: true, value: value as SshAgentIdentity[] } : { ok: false, issues: out };
}

export function validateSshAgentSignature(value: unknown): ValidationResult<SshAgentSignature> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["algorithm", "signature"]), "$", out);
  if (!sshSignatureAlgorithms.has(String(value.algorithm))) out.push({ path: "$.algorithm", code: "invalid_algorithm", message: "Unsupported signing algorithm" });
  bytes(value.signature, "$.signature", EXTENSION_LIMITS.sshAgentSignatureBytes, out);
  return out.length === 0 ? { ok: true, value: value as unknown as SshAgentSignature } : { ok: false, issues: out };
}

export function validateProgressPresentation(value: unknown): ValidationResult<ProgressPresentation> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["operationId", "title", "stages", "resumable"]), "$", out);
  string(value.operationId, "$.operationId", out, 256); string(value.title, "$.title", out, 128);
  if (typeof value.resumable !== "boolean") out.push({ path: "$.resumable", code: "invalid_type", message: "Expected boolean" });
  if (!Array.isArray(value.stages) || value.stages.length > EXTENSION_LIMITS.progressStages) out.push({ path: "$.stages", code: "invalid_array", message: "Expected bounded stages" });
  else value.stages.forEach((stage, index) => {
    const path = `$.stages[${index}]`;
    if (!record(stage)) { out.push({ path, code: "invalid_type", message: "Expected object" }); return; }
    closed(stage, new Set(["id", "label", "state", "detail"]), path, out);
    string(stage.id, `${path}.id`, out, 64); string(stage.label, `${path}.label`, out, 128);
    if (!["pending", "active", "complete", "failed"].includes(String(stage.state))) out.push({ path: `${path}.state`, code: "invalid_state", message: "Unknown progress state" });
    if (stage.detail !== undefined) string(stage.detail, `${path}.detail`, out, 1024);
  });
  return out.length === 0 ? { ok: true, value: value as unknown as ProgressPresentation } : { ok: false, issues: out };
}

export function validateProviderEnvironmentStatus(value: unknown): ValidationResult<ProviderEnvironmentStatus> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["state", "message", "defaultRoot", "card", "progress", "revision"]), "$", out);
  if (!["available", "connecting", "unavailable", "failed", "deleting"].includes(String(value.state))) out.push({ path: "$.state", code: "invalid_state", message: "Unknown environment state" });
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) out.push({ path: "$.revision", code: "invalid_revision", message: "Expected a non-negative integer" });
  if (value.message !== undefined) string(value.message, "$.message", out, 1024);
  if (value.defaultRoot !== undefined) string(value.defaultRoot, "$.defaultRoot", out, 4096);
  if (value.card !== undefined) validateStatusCardInto(value.card, "$.card", out);
  if (value.progress !== undefined) {
    const result = validateProgressPresentation(value.progress);
    if (!result.ok) out.push(...result.issues.map((issue) => ({ ...issue, path: `$.progress${issue.path.slice(1)}` })));
  }
  return out.length === 0 ? { ok: true, value: value as unknown as ProviderEnvironmentStatus } : { ok: false, issues: out };
}

export function validateProvisioningResult(value: unknown): ValidationResult<ProvisioningResult> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  if (value.state === "ready") {
    closed(value, new Set(["state", "providerState", "status"]), "$", out);
    ensureJson(value.providerState, "$.providerState", out);
    const status = validateProviderEnvironmentStatus(value.status);
    if (!status.ok) out.push(...status.issues.map((issue) => ({ ...issue, path: `$.status${issue.path.slice(1)}` })));
  } else if (value.state === "pending") {
    closed(value, new Set(["state", "operationId", "providerState", "progress", "pollAfterMs"]), "$", out);
    string(value.operationId, "$.operationId", out, 256); ensureJson(value.providerState, "$.providerState", out);
    const progress = validateProgressPresentation(value.progress);
    if (!progress.ok) out.push(...progress.issues.map((issue) => ({ ...issue, path: `$.progress${issue.path.slice(1)}` })));
    if (value.pollAfterMs !== undefined && (!Number.isSafeInteger(value.pollAfterMs) || Number(value.pollAfterMs) < 100 || Number(value.pollAfterMs) > EXTENSION_LIMITS.deadlineMs)) out.push({ path: "$.pollAfterMs", code: "invalid_poll_interval", message: "Poll interval is out of bounds" });
  } else out.push({ path: "$.state", code: "invalid_state", message: "Unknown provisioning result state" });
  return out.length === 0 ? { ok: true, value: value as unknown as ProvisioningResult } : { ok: false, issues: out };
}

export function validateEnvironmentActionResult(value: unknown): ValidationResult<EnvironmentActionResult> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  ensureJson(value.providerState, "$.providerState", out);
  if (value.state === "complete") {
    closed(value, new Set(["state", "providerState", "status"]), "$", out);
    const status = validateProviderEnvironmentStatus(value.status);
    if (!status.ok) out.push(...status.issues.map((issue) => ({ ...issue, path: `$.status${issue.path.slice(1)}` })));
  } else if (value.state === "pending") {
    closed(value, new Set(["state", "operationId", "providerState", "progress"]), "$", out);
    string(value.operationId, "$.operationId", out, 256);
    const progress = validateProgressPresentation(value.progress);
    if (!progress.ok) out.push(...progress.issues.map((issue) => ({ ...issue, path: `$.progress${issue.path.slice(1)}` })));
  } else out.push({ path: "$.state", code: "invalid_state", message: "Unknown action result state" });
  return out.length === 0 ? { ok: true, value: value as unknown as EnvironmentActionResult } : { ok: false, issues: out };
}

function invalidObject<T>(): ValidationResult<T> { return { ok: false, issues: [{ path: "$", code: "invalid_type", message: "Expected an object" }] }; }
function validateOption(value: unknown, path: string, out: SchemaIssue[]): void {
  if (!record(value)) { out.push({ path, code: "invalid_type", message: "Expected object" }); return; }
  closed(value, new Set(["value", "label", "description", "disabledReason", "icon", "default"]), path, out);
  string(value.value, `${path}.value`, out, 1024); string(value.label, `${path}.label`, out, 128);
  if (value.description !== undefined) string(value.description, `${path}.description`, out, 1024);
  if (value.disabledReason !== undefined) string(value.disabledReason, `${path}.disabledReason`, out, 1024);
  if (value.default !== undefined && typeof value.default !== "boolean") out.push({ path: `${path}.default`, code: "invalid_type", message: "Expected a boolean" });
}
function validateStatusCardInto(value: unknown, path: string, out: SchemaIssue[]): void {
  if (!record(value)) { out.push({ path, code: "invalid_type", message: "Expected object" }); return; }
  closed(value, new Set(["id", "title", "summary", "icon", "tone", "facts", "actions", "httpsLink"]), path, out);
  string(value.id, `${path}.id`, out, 64); string(value.title, `${path}.title`, out, 128); string(value.summary, `${path}.summary`, out, 1024);
  if (value.actions !== undefined && (!Array.isArray(value.actions) || value.actions.length > EXTENSION_LIMITS.actions)) out.push({ path: `${path}.actions`, code: "invalid_array", message: "Expected bounded actions" });
  if (value.httpsLink !== undefined) {
    if (!record(value.httpsLink) || typeof value.httpsLink.url !== "string" || !value.httpsLink.url.startsWith("https://")) out.push({ path: `${path}.httpsLink`, code: "unsafe_url", message: "Only credential-free HTTPS links are supported" });
    else if (/^[^/]*\/\/[^/]*@/.test(value.httpsLink.url)) out.push({ path: `${path}.httpsLink.url`, code: "credentialed_url", message: "URL credentials are forbidden" });
  }
}
function ensureJson(value: unknown, path: string, out: SchemaIssue[], depth = 0): void {
  if (depth > 24) { out.push({ path, code: "json_depth", message: "JSON nesting limit exceeded" }); return; }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isFinite(value)) out.push({ path, code: "invalid_number", message: "Expected finite number" }); return; }
  if (Array.isArray(value)) { if (value.length > 1024) out.push({ path, code: "json_size", message: "Array is too large" }); else value.forEach((item, index) => { ensureJson(item, `${path}[${index}]`, out, depth + 1); }); return; }
  if (record(value)) { const entries = Object.entries(value); if (entries.length > 1024) out.push({ path, code: "json_size", message: "Object is too large" }); else entries.forEach(([key, item]) => { ensureJson(item, `${path}.${key}`, out, depth + 1); }); return; }
  out.push({ path, code: "invalid_json", message: "Expected JSON-safe data" });
}
function bytes(value: unknown, path: string, maximum: number, out: SchemaIssue[]): void {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > maximum) out.push({ path, code: "invalid_bytes", message: `Expected 1-${maximum} bytes` });
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
  if (value.defaultValue !== undefined && !["string", "number", "boolean"].includes(typeof value.defaultValue) && value.defaultValue !== null) out.push({ path: `${path}.defaultValue`, code: "invalid_type", message: "Expected a JSON primitive" });
  if (value.suggestionSource !== undefined && !["text", "url"].includes(String(value.type))) out.push({ path: `${path}.suggestionSource`, code: "invalid_field", message: "Suggestions are supported only by text and URL fields" });
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
