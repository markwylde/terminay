import {
  EXTENSION_ID_PATTERN,
  ENVIRONMENT_VARIABLE_NAME_PATTERN,
  EXTENSION_LIMITS,
  LOCAL_ID_PATTERN,
  isNamespacedId,
} from "./constants.js";
import type {
  DeclarativeForm,
  AgentBindingFingerprint,
  AgentChildJournalSource,
  AgentHomeRelativeFileRequest,
  AgentHomeRelativePathRequest,
  AgentPathUnderHomeRequest,
  AgentLifecycleEvent,
  AgentModelMetadata,
  AgentObservationDiagnostic,
  AgentProviderContribution,
  AgentProviderDefinition,
  AgentSessionBindingRequest,
  AgentTerminalTtyFact,
  AgentProcessEnvironmentRequest,
  AgentRelativeToEnvironmentRequest,
  AgentPathUnderEnvironmentRequest,
  AgentEnvironmentRelativePathRequest,
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
  "external-resources:manage", "ssh-agent:use", "agent-observation",
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
  validatePlatforms(value.platforms, "$.platforms", out);
  if (value.extensionDependencies !== undefined) validateDependencies(value.extensionDependencies, out);
  if (!record(value.contributes)) out.push({ path: "$.contributes", code: "invalid_type", message: "Expected an object" });
  else {
    closed(value.contributes, new Set(["projectEnvironments", "agentProviders"]), "$.contributes", out);
    const extensionId = typeof value.id === "string" ? value.id : "";
    const projectEnvironments = value.contributes.projectEnvironments;
    const agentProviders = value.contributes.agentProviders;
    if (projectEnvironments === undefined && agentProviders === undefined) {
      out.push({ path: "$.contributes", code: "missing_contribution", message: "Declare at least one supported contribution" });
    }
    if (projectEnvironments !== undefined) validateContributions(projectEnvironments, extensionId, out);
    if (agentProviders !== undefined) validateAgentContributions(agentProviders, extensionId, out);
    if (Array.isArray(agentProviders) && agentProviders.length > 0 && !Array.isArray(value.permissions)) {
      // The permission array validator reports the more specific type error.
    } else if (Array.isArray(agentProviders) && agentProviders.length > 0 && Array.isArray(value.permissions) && !value.permissions.includes("agent-observation")) {
      out.push({ path: "$.permissions", code: "missing_permission", message: "Agent providers require agent-observation" });
    }
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

function validateAgentContributions(value: unknown, extensionId: string, out: SchemaIssue[]): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > EXTENSION_LIMITS.contributions) {
    out.push({ path: "$.contributes.agentProviders", code: "invalid_array", message: "Expected one or more bounded contributions" });
    return;
  }
  const ids: unknown[] = [];
  value.forEach((item, index) => {
    const result = validateAgentProviderContribution(item, extensionId);
    if (!result.ok) out.push(...result.issues.map((issue) => ({ ...issue, path: `$.contributes.agentProviders[${index}]${issue.path.slice(1)}` })));
    if (record(item)) ids.push(item.id);
  });
  unique(ids, "$.contributes.agentProviders", out);
}

/** Validates a standalone agent-provider manifest contribution. */
export function validateAgentProviderContribution(value: unknown, extensionId: string): ValidationResult<AgentProviderContribution> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set([
    "id", "displayName", "description", "icon", "platforms", "processMatchers", "mappings", "requiredEnvironmentVariables", "requiredEnvironmentCapabilities",
  ]), "$", out);
  if (string(value.id, "$.id", out, EXTENSION_LIMITS.providerIdLength) && !isNamespacedId(value.id, extensionId)) {
    out.push({ path: "$.id", code: "invalid_namespace", message: "Provider id must be namespaced by the extension id" });
  }
  string(value.displayName, "$.displayName", out, EXTENSION_LIMITS.displayNameLength);
  if (value.description !== undefined) string(value.description, "$.description", out, EXTENSION_LIMITS.descriptionLength);
  if (value.icon !== undefined && !["terminal", "server", "cloud", "key", "folder", "network", "database", "warning", "info"].includes(String(value.icon))) {
    out.push({ path: "$.icon", code: "invalid_icon", message: "Unsupported icon" });
  }
  validatePlatforms(value.platforms, "$.platforms", out);
  validateAgentProcessMatchers(value.processMatchers, out);
  validateAgentMappings(value.mappings, out);
  validateAgentEnvironmentVariableNamesInto(value.requiredEnvironmentVariables, "$.requiredEnvironmentVariables", out, true);
  if (!Array.isArray(value.requiredEnvironmentCapabilities) || value.requiredEnvironmentCapabilities.length === 0 || value.requiredEnvironmentCapabilities.length > EXTENSION_LIMITS.agentRequiredCapabilities) {
    out.push({ path: "$.requiredEnvironmentCapabilities", code: "invalid_array", message: "Expected bounded required environment capabilities" });
  } else {
    unique(value.requiredEnvironmentCapabilities, "$.requiredEnvironmentCapabilities", out);
    value.requiredEnvironmentCapabilities.forEach((capability, index) => {
      if (!["process-observation", "filesystem-observation", "agent-journal"].includes(String(capability))) {
        out.push({ path: `$.requiredEnvironmentCapabilities[${index}]`, code: "invalid_capability", message: "Unsupported agent observation capability" });
      }
    });
  }
  return out.length === 0 ? { ok: true, value: value as unknown as AgentProviderContribution } : { ok: false, issues: out };
}

function validatePlatforms(value: unknown, path: string, out: SchemaIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) {
    out.push({ path, code: "invalid_array", message: "Expected a bounded platform array" });
    return;
  }
  unique(value, path, out);
  value.forEach((item, index) => {
    if (!["darwin", "linux", "win32"].includes(String(item))) out.push({ path: `${path}[${index}]`, code: "invalid_platform", message: "Unsupported platform metadata" });
  });
}

function validateAgentProcessMatchers(value: unknown, out: SchemaIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0 || value.length > EXTENSION_LIMITS.agentProcessMatchers) {
    out.push({ path: "$.processMatchers", code: "invalid_array", message: "Expected bounded process matchers" });
    return;
  }
  const identities: unknown[] = [];
  value.forEach((matcher, index) => {
    const path = `$.processMatchers[${index}]`;
    if (!record(matcher)) { out.push({ path, code: "invalid_type", message: "Expected an object" }); return; }
    closed(matcher, new Set(["executableName", "arguments"]), path, out);
    if (string(matcher.executableName, `${path}.executableName`, out, 128) && /[\\/\0\r\n]/.test(matcher.executableName)) {
      out.push({ path: `${path}.executableName`, code: "invalid_matcher", message: "Executable name must not contain a path or control character" });
    }
    if (matcher.arguments !== undefined) {
      if (!Array.isArray(matcher.arguments) || matcher.arguments.length > 16) out.push({ path: `${path}.arguments`, code: "invalid_array", message: "Expected bounded argument tokens" });
      else matcher.arguments.forEach((argument, argumentIndex) => string(argument, `${path}.arguments[${argumentIndex}]`, out, 256));
    }
    identities.push(JSON.stringify([matcher.executableName, matcher.arguments]));
  });
  unique(identities, "$.processMatchers", out);
}

function validateAgentMappings(value: unknown, out: SchemaIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0 || value.length > EXTENSION_LIMITS.agentMappings) {
    out.push({ path: "$.mappings", code: "invalid_array", message: "Expected bounded mapping declarations" });
    return;
  }
  const versions: unknown[] = [];
  value.forEach((mapping, index) => {
    const path = `$.mappings[${index}]`;
    if (!record(mapping)) { out.push({ path, code: "invalid_type", message: "Expected an object" }); return; }
    closed(mapping, new Set(["mappingVersion", "providerVersionRange"]), path, out);
    string(mapping.mappingVersion, `${path}.mappingVersion`, out, EXTENSION_LIMITS.agentProviderVersionLength);
    string(mapping.providerVersionRange, `${path}.providerVersionRange`, out, EXTENSION_LIMITS.agentProviderVersionLength);
    versions.push(mapping.mappingVersion);
  });
  unique(versions, "$.mappings", out);
}

/** Validates a declared/requested bounded environment-variable name list. */
export function validateAgentEnvironmentVariableNames(value: unknown): ValidationResult<string[]> {
  const out: SchemaIssue[] = [];
  validateAgentEnvironmentVariableNamesInto(value, "$.names", out);
  return out.length === 0 ? { ok: true, value: value as string[] } : { ok: false, issues: out };
}

function validateAgentEnvironmentVariableNamesInto(value: unknown, path: string, out: SchemaIssue[], optional = false): void {
  if (value === undefined && optional) return;
  if (!Array.isArray(value) || value.length === 0 || value.length > EXTENSION_LIMITS.agentEnvironmentVariables) {
    out.push({ path, code: "invalid_array", message: "Expected bounded environment-variable names" });
  } else {
    unique(value, path, out);
    value.forEach((name, index) => validateEnvironmentVariableName(name, `${path}[${index}]`, out));
  }
}

/** Validates one closed process-environment request before host routing. */
export function validateAgentProcessEnvironmentRequest(value: unknown): ValidationResult<AgentProcessEnvironmentRequest> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["names"]), "$", out);
  validateAgentEnvironmentVariableNamesInto(value.names, "$.names", out);
  return out.length === 0 ? { ok: true, value: value as unknown as AgentProcessEnvironmentRequest } : { ok: false, issues: out };
}

/** Validates bounded values returned from terminal-scoped process observation. */
export function validateAgentObservedEnvironment(value: unknown, requestedNames?: readonly string[]): ValidationResult<Record<string, string>> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  const requested = requestedNames === undefined ? undefined : new Set(requestedNames);
  const entries = Object.entries(value);
  if (entries.length > EXTENSION_LIMITS.agentEnvironmentVariables) out.push({ path: "$", code: "limit_exceeded", message: "Too many observed environment variables" });
  entries.forEach(([name, observed]) => {
    validateEnvironmentVariableName(name, `$.${name}`, out);
    if (requested !== undefined && !requested.has(name)) out.push({ path: `$.${name}`, code: "undeclared_environment_variable", message: "Observed variable was not requested" });
    if (typeof observed !== "string" || observed.length > EXTENSION_LIMITS.agentEnvironmentVariableValueLength) {
      out.push({ path: `$.${name}`, code: "invalid_environment_value", message: `Expected a string of at most ${EXTENSION_LIMITS.agentEnvironmentVariableValueLength} characters` });
    }
  });
  return out.length === 0 ? { ok: true, value: value as Record<string, string> } : { ok: false, issues: out };
}

/** Validates a known path resolved below one declared terminal environment value. */
export function validateAgentRelativeToEnvironmentRequest(value: unknown): ValidationResult<AgentRelativeToEnvironmentRequest> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["relativePath", "environmentVariable", "extension"]), "$", out);
  validateHomeRelativePath(value.relativePath, "$.relativePath", out);
  validateEnvironmentVariableName(value.environmentVariable, "$.environmentVariable", out);
  if (value.extension !== undefined) validateFileExtension(value.extension, "$.extension", out);
  return out.length === 0 ? { ok: true, value: value as unknown as AgentRelativeToEnvironmentRequest } : { ok: false, issues: out };
}

/** Validates provider-record path data constrained by one declared terminal environment value. */
export function validateAgentPathUnderEnvironmentRequest(value: unknown): ValidationResult<AgentPathUnderEnvironmentRequest> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["providerPath", "environmentVariable", "beneathRelative", "extension"]), "$", out);
  if (string(value.providerPath, "$.providerPath", out, EXTENSION_LIMITS.agentProviderPathLength)) {
    if (!isAbsoluteProviderPath(value.providerPath) || /[\0\r\n]/.test(value.providerPath)) out.push({ path: "$.providerPath", code: "unsafe_path", message: "Expected a bounded absolute provider-record path" });
  }
  validateEnvironmentVariableName(value.environmentVariable, "$.environmentVariable", out);
  if (value.beneathRelative !== undefined) validateHomeRelativePath(value.beneathRelative, "$.beneathRelative", out);
  if (value.extension !== undefined) validateFileExtension(value.extension, "$.extension", out);
  return out.length === 0 ? { ok: true, value: value as unknown as AgentPathUnderEnvironmentRequest } : { ok: false, issues: out };
}

/** Validates a fact-only path lookup below one declared terminal environment value. */
export function validateAgentEnvironmentRelativePathRequest(value: unknown): ValidationResult<AgentEnvironmentRelativePathRequest> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["handle", "environmentVariable", "beneathRelative"]), "$", out);
  validateOpaqueHandle(value.handle, "$.handle", out);
  validateEnvironmentVariableName(value.environmentVariable, "$.environmentVariable", out);
  if (value.beneathRelative !== undefined) validateHomeRelativePath(value.beneathRelative, "$.beneathRelative", out);
  return out.length === 0 ? { ok: true, value: value as unknown as AgentEnvironmentRelativePathRequest } : { ok: false, issues: out };
}

/** Validates a normalized non-escaping relative path fact returned by the host. */
export function validateAgentEnvironmentRelativePath(value: unknown): ValidationResult<string> {
  const out: SchemaIssue[] = [];
  validateEnvironmentRelativePath(value, "$", out);
  return out.length === 0 ? { ok: true, value: value as string } : { ok: false, issues: out };
}

function validateEnvironmentRelativePath(value: unknown, path: string, out: SchemaIssue[]): void {
  if (!string(value, path, out, EXTENSION_LIMITS.agentEnvironmentRelativePathLength)) return;
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    out.push({ path, code: "unsafe_path", message: "Expected a normalized non-escaping relative path" });
  }
}

function validateEnvironmentVariableName(value: unknown, path: string, out: SchemaIssue[]): void {
  if (string(value, path, out, EXTENSION_LIMITS.agentEnvironmentVariableNameLength) && !ENVIRONMENT_VARIABLE_NAME_PATTERN.test(value)) {
    out.push({ path, code: "invalid_environment_variable", message: "Expected an identifier-like environment-variable name" });
  }
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

/** Validates display-only model metadata before it crosses the host boundary. */
export function validateAgentModelMetadata(value: unknown): ValidationResult<AgentModelMetadata> {
  const out: SchemaIssue[] = [];
  validateAgentModelMetadataInto(value, "$", out);
  return out.length === 0 ? { ok: true, value: value as AgentModelMetadata } : { ok: false, issues: out };
}

function validateAgentModelMetadataInto(value: unknown, path: string, out: SchemaIssue[]): void {
  if (!record(value)) { out.push({ path, code: "invalid_type", message: "Expected an object" }); return; }
  closed(value, new Set(["id", "displayName", "reasoningEffort", "contextWindowTokens"]), path, out);
  string(value.id, `${path}.id`, out, EXTENSION_LIMITS.agentNativeIdLength);
  if (value.displayName !== undefined) string(value.displayName, `${path}.displayName`, out, EXTENSION_LIMITS.displayNameLength);
  if (value.reasoningEffort !== undefined) string(value.reasoningEffort, `${path}.reasoningEffort`, out, 64);
  if (value.contextWindowTokens !== undefined && (!Number.isSafeInteger(value.contextWindowTokens) || Number(value.contextWindowTokens) < 1 || Number(value.contextWindowTokens) > 16 * 1024 * 1024)) {
    out.push({ path: `${path}.contextWindowTokens`, code: "invalid_number", message: "Context window must be a bounded positive integer" });
  }
}

/** Validates evidence used for a terminal-scoped provider session binding. */
export function validateAgentSessionBindingRequest(value: unknown): ValidationResult<AgentSessionBindingRequest> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["providerSessionId", "mappingVersion", "journal", "fingerprint", "metadata"]), "$", out);
  string(value.providerSessionId, "$.providerSessionId", out, EXTENSION_LIMITS.agentSessionIdLength);
  string(value.mappingVersion, "$.mappingVersion", out, EXTENSION_LIMITS.agentProviderVersionLength);
  if (value.journal !== undefined) validateOpaqueHandle(value.journal, "$.journal", out);
  validateAgentBindingFingerprintInto(value.fingerprint, "$.fingerprint", out);
  if (value.metadata !== undefined) validatePrimitiveMap(value.metadata, "$.metadata", EXTENSION_LIMITS.agentMetadataEntries, out);
  return out.length === 0 ? { ok: true, value: value as unknown as AgentSessionBindingRequest } : { ok: false, issues: out };
}

export function validateAgentBindingFingerprint(value: unknown): ValidationResult<AgentBindingFingerprint> {
  const out: SchemaIssue[] = [];
  validateAgentBindingFingerprintInto(value, "$", out);
  return out.length === 0 ? { ok: true, value: value as AgentBindingFingerprint } : { ok: false, issues: out };
}

/** Validates a bounded terminal device fact without treating it as a path. */
export function validateAgentTerminalTtyFact(value: unknown): ValidationResult<AgentTerminalTtyFact> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["deviceId", "deviceName"]), "$", out);
  string(value.deviceId, "$.deviceId", out, EXTENSION_LIMITS.agentTtyDeviceIdLength);
  if (value.deviceName !== undefined) string(value.deviceName, "$.deviceName", out, EXTENSION_LIMITS.agentTtyDeviceNameLength);
  return out.length === 0 ? { ok: true, value: value as unknown as AgentTerminalTtyFact } : { ok: false, issues: out };
}

/**
 * Validates a known home-relative resolution request. Absolute paths,
 * backslashes, traversal, and extension escapes are rejected before routing to
 * an environment broker.
 */
export function validateAgentHomeRelativeFileRequest(value: unknown): ValidationResult<AgentHomeRelativeFileRequest> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["relativePath", "beneath", "extension"]), "$", out);
  validateHomeRelativePath(value.relativePath, "$.relativePath", out);
  if (value.beneath !== undefined) {
    if (!record(value.beneath)) out.push({ path: "$.beneath", code: "invalid_type", message: "Expected a home-relative constraint" });
    else {
      closed(value.beneath, new Set(["homeRelative"]), "$.beneath", out);
      validateHomeRelativePath(value.beneath.homeRelative, "$.beneath.homeRelative", out);
    }
  }
  if (value.extension !== undefined) validateFileExtension(value.extension, "$.extension", out);
  return out.length === 0 ? { ok: true, value: value as unknown as AgentHomeRelativeFileRequest } : { ok: false, issues: out };
}

/**
 * Validates one provider-record path that the host may canonicalize only under
 * a declared home-relative root. The provider path is data, never authority.
 */
export function validateAgentPathUnderHomeRequest(value: unknown): ValidationResult<AgentPathUnderHomeRequest> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["providerPath", "beneath", "extension"]), "$", out);
  if (string(value.providerPath, "$.providerPath", out, EXTENSION_LIMITS.agentProviderPathLength)) {
    if (!isAbsoluteProviderPath(value.providerPath) || /[\0\r\n]/.test(value.providerPath)) out.push({ path: "$.providerPath", code: "unsafe_path", message: "Expected a bounded absolute provider-record path" });
  }
  if (!record(value.beneath)) out.push({ path: "$.beneath", code: "invalid_type", message: "Expected an explicit home-relative constraint" });
  else {
    closed(value.beneath, new Set(["homeRelative"]), "$.beneath", out);
    validateHomeRelativePath(value.beneath.homeRelative, "$.beneath.homeRelative", out);
  }
  if (value.extension !== undefined) validateFileExtension(value.extension, "$.extension", out);
  return out.length === 0 ? { ok: true, value: value as unknown as AgentPathUnderHomeRequest } : { ok: false, issues: out };
}

/** Validates a fact-only normalized path lookup for an opaque file handle. */
export function validateAgentHomeRelativePathRequest(value: unknown): ValidationResult<AgentHomeRelativePathRequest> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["handle", "beneath"]), "$", out);
  validateOpaqueHandle(value.handle, "$.handle", out);
  if (!record(value.beneath)) out.push({ path: "$.beneath", code: "invalid_type", message: "Expected an explicit home-relative constraint" });
  else {
    closed(value.beneath, new Set(["homeRelative"]), "$.beneath", out);
    validateHomeRelativePath(value.beneath.homeRelative, "$.beneath.homeRelative", out);
  }
  return out.length === 0 ? { ok: true, value: value as unknown as AgentHomeRelativePathRequest } : { ok: false, issues: out };
}

/**
 * Child sources are bounded evidence under an already established root
 * binding. Their stable ids are required so a second root can never be
 * inferred from a child journal.
 */
export function validateAgentChildJournalSources(value: unknown): ValidationResult<AgentChildJournalSource[]> {
  const out: SchemaIssue[] = [];
  if (!Array.isArray(value) || value.length > EXTENSION_LIMITS.agentChildJournalSources) {
    out.push({ path: "$", code: "invalid_array", message: "Expected bounded child journal sources" });
  } else {
    const childIds: unknown[] = [];
    value.forEach((source, index) => {
      const path = `$[${index}]`;
      if (!record(source)) { out.push({ path, code: "invalid_type", message: "Expected a child journal source" }); return; }
      closed(source, new Set(["childId", "journal", "source"]), path, out);
      agentId(source.childId, `${path}.childId`, out);
      validateOpaqueHandle(source.journal, `${path}.journal`, out);
      if (!isWatcherOrPromise(source.source)) out.push({ path: `${path}.source`, code: "invalid_watcher", message: "Expected an async file watcher or promise" });
      childIds.push(source.childId);
    });
    unique(childIds, "$", out);
  }
  return out.length === 0 ? { ok: true, value: value as unknown as AgentChildJournalSource[] } : { ok: false, issues: out };
}

function validateHomeRelativePath(value: unknown, path: string, out: SchemaIssue[]): void {
  if (!string(value, path, out, EXTENSION_LIMITS.agentHomeRelativePathLength)) return;
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    out.push({ path, code: "unsafe_path", message: "Expected a non-escaping home-relative path using forward slashes" });
  }
}
function isAbsoluteProviderPath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
function validateFileExtension(value: unknown, path: string, out: SchemaIssue[]): void {
  if (!string(value, path, out, EXTENSION_LIMITS.agentFileExtensionLength)) return;
  if (!value.startsWith(".") || value.includes("/") || value.includes("\\") || value.includes("\0")) out.push({ path, code: "unsafe_extension", message: "Expected a filename extension" });
}
function isWatcherOrPromise(value: unknown): boolean {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  const candidate = value as { then?: unknown; [Symbol.asyncIterator]?: unknown };
  return typeof candidate.then === "function" || typeof candidate[Symbol.asyncIterator] === "function";
}

function validateAgentBindingFingerprintInto(value: unknown, path: string, out: SchemaIssue[]): void {
  if (!record(value)) { out.push({ path, code: "invalid_type", message: "Expected an object" }); return; }
  closed(value, new Set(["kind", "process", "file", "metadata"]), path, out);
  string(value.kind, `${path}.kind`, out, 128);
  if (value.process === undefined && value.file === undefined) out.push({ path, code: "missing_evidence", message: "A binding fingerprint needs scoped process or file evidence" });
  if (value.process !== undefined) validateOpaqueHandle(value.process, `${path}.process`, out);
  if (value.file !== undefined) validateOpaqueHandle(value.file, `${path}.file`, out);
  if (value.metadata !== undefined) validatePrimitiveMap(value.metadata, `${path}.metadata`, EXTENSION_LIMITS.agentFingerprintEntries, out);
}

function validateOpaqueHandle(value: unknown, path: string, out: SchemaIssue[]): void {
  if (!record(value) || !string(value.id, `${path}.id`, out, 256)) {
    if (!record(value)) out.push({ path, code: "invalid_handle", message: "Expected a host-issued opaque handle" });
  }
}

function validatePrimitiveMap(value: unknown, path: string, maximum: number, out: SchemaIssue[]): void {
  if (!record(value)) { out.push({ path, code: "invalid_type", message: "Expected an object" }); return; }
  const entries = Object.entries(value);
  if (entries.length > maximum) { out.push({ path, code: "limit_exceeded", message: "Too many metadata entries" }); return; }
  entries.forEach(([key, item]) => {
    if (key.length === 0 || key.length > 128 || !["string", "number", "boolean"].includes(typeof item) && item !== null) {
      out.push({ path: `${path}.${key}`, code: "invalid_metadata", message: "Metadata must use bounded JSON primitives" });
    } else if (typeof item === "string" && item.length > EXTENSION_LIMITS.stringLength) {
      out.push({ path: `${path}.${key}`, code: "limit_exceeded", message: "Metadata string is too long" });
    } else if (typeof item === "number" && !Number.isFinite(item)) {
      out.push({ path: `${path}.${key}`, code: "invalid_metadata", message: "Metadata number must be finite" });
    }
  });
}

/** Closed validator for provider-neutral lifecycle events. */
export function validateAgentLifecycleEvent(value: unknown): ValidationResult<AgentLifecycleEvent> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  const kind = value.kind;
  if (typeof kind !== "string") {
    out.push({ path: "$.kind", code: "invalid_event", message: "Expected a lifecycle event kind" });
    return { ok: false, issues: out };
  }
  const common = ["kind", "occurredAt"];
  const targeted = ["agentId"];
  switch (kind) {
    case "session.started":
      closed(value, new Set([...common, "title", "promptText", "model"]), "$", out);
      agentText(value.title, "$.title", EXTENSION_LIMITS.agentTitleLength, out, false);
      agentText(value.promptText, "$.promptText", EXTENSION_LIMITS.agentPromptLength, out, false);
      if (value.model !== undefined) validateAgentModelMetadataInto(value.model, "$.model", out);
      break;
    case "agent.metadata":
      closed(value, new Set([...common, ...targeted, "title", "promptText", "model"]), "$", out);
      validateOptionalAgentId(value.agentId, "$.agentId", out);
      if (value.title === undefined && value.promptText === undefined && value.model === undefined) out.push({ path: "$", code: "missing_metadata", message: "Metadata changes must contain metadata" });
      agentText(value.title, "$.title", EXTENSION_LIMITS.agentTitleLength, out, false);
      agentText(value.promptText, "$.promptText", EXTENSION_LIMITS.agentPromptLength, out, false);
      if (value.model !== undefined) validateAgentModelMetadataInto(value.model, "$.model", out);
      break;
    case "turn.started":
      closed(value, new Set([...common, ...targeted, "turnId", "promptText"]), "$", out);
      validateOptionalAgentId(value.agentId, "$.agentId", out); agentId(value.turnId, "$.turnId", out);
      agentText(value.promptText, "$.promptText", EXTENSION_LIMITS.agentPromptLength, out, false);
      break;
    case "tool.started":
      closed(value, new Set([...common, ...targeted, "toolId", "name", "description"]), "$", out);
      validateOptionalAgentId(value.agentId, "$.agentId", out); agentId(value.toolId, "$.toolId", out);
      agentText(value.name, "$.name", EXTENSION_LIMITS.displayNameLength, out, true); agentText(value.description, "$.description", EXTENSION_LIMITS.agentReasonLength, out, false);
      break;
    case "tool.finished":
      closed(value, new Set([...common, ...targeted, "toolId", "outcome"]), "$", out);
      validateOptionalAgentId(value.agentId, "$.agentId", out); agentId(value.toolId, "$.toolId", out); validateOutcome(value.outcome, "$.outcome", out, false);
      break;
    case "wait.started":
      closed(value, new Set([...common, ...targeted, "waitId", "state", "reason"]), "$", out);
      validateOptionalAgentId(value.agentId, "$.agentId", out); agentId(value.waitId, "$.waitId", out);
      if (value.state !== "waiting" && value.state !== "blocked") out.push({ path: "$.state", code: "invalid_state", message: "Wait state must be waiting or blocked" });
      agentText(value.reason, "$.reason", EXTENSION_LIMITS.agentReasonLength, out, false);
      break;
    case "wait.finished":
      closed(value, new Set([...common, ...targeted, "waitId"]), "$", out);
      validateOptionalAgentId(value.agentId, "$.agentId", out); agentId(value.waitId, "$.waitId", out);
      break;
    case "agent.done":
      closed(value, new Set([...common, ...targeted, "outcome", "summary"]), "$", out);
      validateOptionalAgentId(value.agentId, "$.agentId", out); validateOutcome(value.outcome, "$.outcome", out, true); agentText(value.summary, "$.summary", EXTENSION_LIMITS.agentSummaryLength, out, false);
      break;
    case "agent.exited":
      closed(value, new Set([...common, ...targeted, "exitCode", "signal"]), "$", out);
      validateOptionalAgentId(value.agentId, "$.agentId", out);
      if (value.exitCode === undefined && value.signal === undefined) out.push({ path: "$", code: "missing_exit_status", message: "Exit events require an exit code or signal" });
      if (value.exitCode !== undefined && (!Number.isSafeInteger(value.exitCode) || Math.abs(Number(value.exitCode)) > 255)) out.push({ path: "$.exitCode", code: "invalid_exit_code", message: "Expected a bounded integer exit code" });
      agentText(value.signal, "$.signal", 64, out, false);
      break;
    case "session.stopped":
      closed(value, new Set([...common, "reason"]), "$", out);
      agentText(value.reason, "$.reason", EXTENSION_LIMITS.agentReasonLength, out, false);
      break;
    case "subagent.started":
      closed(value, new Set([...common, "subagentId", "parentAgentId", "title", "promptText", "model"]), "$", out);
      agentId(value.subagentId, "$.subagentId", out); validateOptionalAgentId(value.parentAgentId, "$.parentAgentId", out);
      agentText(value.title, "$.title", EXTENSION_LIMITS.agentTitleLength, out, false); agentText(value.promptText, "$.promptText", EXTENSION_LIMITS.agentPromptLength, out, false);
      if (value.model !== undefined) validateAgentModelMetadataInto(value.model, "$.model", out);
      break;
    case "subagent.done":
      closed(value, new Set([...common, "subagentId", "outcome", "summary"]), "$", out);
      agentId(value.subagentId, "$.subagentId", out); validateOutcome(value.outcome, "$.outcome", out, true); agentText(value.summary, "$.summary", EXTENSION_LIMITS.agentSummaryLength, out, false);
      break;
    default:
      out.push({ path: "$.kind", code: "invalid_event", message: "Unknown lifecycle event kind" });
  }
  validateOccurredAt(value.occurredAt, out);
  return out.length === 0 ? { ok: true, value: value as unknown as AgentLifecycleEvent } : { ok: false, issues: out };
}

/** Validates safe, displayable fallback diagnostics. */
export function validateAgentObservationDiagnostic(value: unknown): ValidationResult<AgentObservationDiagnostic> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["reason", "message"]), "$", out);
  if (!["environment-capability-missing", "process-not-recognized", "session-not-found", "session-not-bound", "unsupported-provider-version", "malformed-observation", "observation-limit-exceeded", "cancelled"].includes(String(value.reason))) {
    out.push({ path: "$.reason", code: "invalid_reason", message: "Unknown safe diagnostic reason" });
  }
  agentText(value.message, "$.message", EXTENSION_LIMITS.agentDiagnosticLength, out, false);
  return out.length === 0 ? { ok: true, value: value as unknown as AgentObservationDiagnostic } : { ok: false, issues: out };
}

/** Runtime shape check for an activation-time agent provider implementation. */
export function validateAgentProviderDefinition(value: unknown): ValidationResult<AgentProviderDefinition> {
  const out: SchemaIssue[] = [];
  if (!record(value)) return invalidObject();
  closed(value, new Set(["mappingVersion", "matchesForeground", "observe"]), "$", out);
  string(value.mappingVersion, "$.mappingVersion", out, EXTENSION_LIMITS.agentProviderVersionLength);
  if (typeof value.matchesForeground !== "function") out.push({ path: "$.matchesForeground", code: "invalid_type", message: "Expected a foreground matcher function" });
  if (typeof value.observe !== "function") out.push({ path: "$.observe", code: "invalid_type", message: "Expected an observation function" });
  return out.length === 0 ? { ok: true, value: value as unknown as AgentProviderDefinition } : { ok: false, issues: out };
}

function agentId(value: unknown, path: string, out: SchemaIssue[]): void { string(value, path, out, EXTENSION_LIMITS.agentNativeIdLength); }
function validateOptionalAgentId(value: unknown, path: string, out: SchemaIssue[]): void { if (value !== undefined) agentId(value, path, out); }
function agentText(value: unknown, path: string, maximum: number, out: SchemaIssue[], required: boolean): void {
  if (value === undefined && !required) return;
  string(value, path, out, maximum);
}
function validateOutcome(value: unknown, path: string, out: SchemaIssue[], required: boolean): void {
  if (value === undefined && !required) return;
  if (value !== "success" && value !== "error" && value !== "cancelled") out.push({ path, code: "invalid_outcome", message: "Unknown completion outcome" });
}
function validateOccurredAt(value: unknown, out: SchemaIssue[]): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length > 64 || Number.isNaN(Date.parse(value))) out.push({ path: "$.occurredAt", code: "invalid_timestamp", message: "Expected an ISO-8601 timestamp" });
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
