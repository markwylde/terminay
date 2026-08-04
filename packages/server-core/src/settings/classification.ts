import type { JsonValue } from "@terminay/protocol";
import { isSettingsObject, type SettingAuthority, type SettingsObject } from "./types.js";

/** Top-level settings from the legacy Desktop settings object. */
export const SETTING_AUTHORITY: Readonly<Record<string, SettingAuthority>> = {
  agentIntegration: "server",
  aiTabMetadata: "server",
  activityIndicators: "server",
  autoCloseTerminalOnExitZero: "server",
  convertEol: "server",
  dictation: "server",
  disableStdin: "server",
  fileViewer: "server",
  gitPushAgent: "server",
  ignoreBracketedPasteMode: "server",
  macros: "server",
  recording: "server",
  remoteAccess: "server",
  rightClickSelectsWord: "server",
  scrollback: "server",
  scrollOnEraseInDisplay: "server",
  scrollOnUserInput: "server",
  scrollSensitivity: "server",
  shell: "server",
  shellProfiles: "server",
  smoothScrollDuration: "server",
  tabStopWidth: "server",
  terminayMcp: "server",
  wordSeparator: "server",

  // Native accelerators, renderer appearance, and sidebar/window state are
  // deliberately local to the connection host.
  allowTransparency: "connection-host",
  altClickMovesCursor: "connection-host",
  customGlyphs: "connection-host",
  cursorBlink: "connection-host",
  cursorInactiveStyle: "connection-host",
  cursorStyle: "connection-host",
  cursorWidth: "connection-host",
  drawBoldTextInBrightColors: "connection-host",
  fastScrollSensitivity: "connection-host",
  fontFamily: "connection-host",
  fontSize: "connection-host",
  fontWeight: "connection-host",
  fontWeightBold: "connection-host",
  keyboardShortcuts: "connection-host",
  letterSpacing: "connection-host",
  lineHeight: "connection-host",
  macOptionClickForcesSelection: "connection-host",
  macOptionIsMeta: "connection-host",
  minimumContrastRatio: "connection-host",
  rescaleOverlappingGlyphs: "connection-host",
  screenReaderMode: "connection-host",
  sidebar: "connection-host",
  theme: "connection-host",
};

export const SETTING_CLASSIFICATIONS = SETTING_AUTHORITY;

export const DEVICE_OVERRIDE_PATHS: ReadonlySet<string> = new Set([
  "dictation.microphoneDeviceId",
]);

const TRANSIENT_PREFIXES = [
  "active",
  "draft",
  "runtime",
  "window",
  "transient",
  "session",
  "modal",
  "focused",
];

/** Unknown paths are transient so an unreviewed setting cannot become server state. */
export function classifySetting(path: string): SettingAuthority {
  const normalized = normalizePath(path);
  if (DEVICE_OVERRIDE_PATHS.has(normalized)) return "device-override";
  const first = normalized.split(".")[0] ?? "";
  const topLevel = SETTING_AUTHORITY[first];
  if (topLevel !== undefined) return topLevel;
  if (TRANSIENT_PREFIXES.some((prefix) => first === prefix || first.startsWith(`${prefix}-`))) return "transient";
  return "transient";
}

export function isServerSettingPath(path: string): boolean {
  return classifySetting(path) === "server";
}

export interface PartitionedSettings {
  readonly server: SettingsObject;
  readonly connectionHost: SettingsObject;
  readonly deviceOverrides: SettingsObject;
  readonly transient: SettingsObject;
}

/** Partition legacy settings without allowing non-server state into a server snapshot. */
export function partitionSettings(input: unknown): PartitionedSettings {
  const result: {
    server: Record<string, JsonValue>;
    connectionHost: Record<string, JsonValue>;
    deviceOverrides: Record<string, JsonValue>;
    transient: Record<string, JsonValue>;
  } = { server: {}, connectionHost: {}, deviceOverrides: {}, transient: {} };
  if (!isSettingsObject(input)) return result;
  for (const [key, value] of Object.entries(input)) {
    partitionValue(result, key, value, key);
  }
  return result;
}

export function serializeServerSettings(input: unknown): SettingsObject {
  return partitionSettings(input).server;
}

export const sanitizeServerSettings = serializeServerSettings;

/**
 * Resolve an effective device view without mutating or persisting shared
 * server settings. Only explicitly classified device-override paths win;
 * connection-host, transient, and unknown values are ignored here.
 */
export function resolveServerSettingsForDevice(serverSettings: SettingsObject, deviceOverrides: unknown): SettingsObject {
  const result = cloneJsonObject(serverSettings);
  const flattened: Array<[string, JsonValue]> = [];
  collectOverrideValues(deviceOverrides, "", flattened);
  for (const [path, value] of flattened) {
    if (classifySetting(path) !== "device-override" || !DEVICE_OVERRIDE_PATHS.has(normalizePath(path))) continue;
    setJsonPath(result, path, value);
  }
  return result;
}

function partitionValue(
  result: { server: Record<string, JsonValue>; connectionHost: Record<string, JsonValue>; deviceOverrides: Record<string, JsonValue>; transient: Record<string, JsonValue> },
  key: string,
  value: unknown,
  path: string,
): void {
  if (isSecretKey(key)) return;
  const authority = classifySetting(path);
  if (authority === "server" && isSettingsObject(value)) {
    const child: Record<string, JsonValue> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      partitionNested(child, childKey, childValue, `${path}.${childKey}`, authority, result);
    }
    result.server[key] = child;
    return;
  }
  if (authority === "server") result.server[key] = cloneJson(value);
  else if (authority === "connection-host") result.connectionHost[key] = cloneJson(value);
  else if (authority === "device-override") result.deviceOverrides[key] = cloneJson(value);
  else result.transient[key] = cloneJson(value);
}

function partitionNested(
  target: Record<string, JsonValue>,
  key: string,
  value: unknown,
  path: string,
  parentAuthority: SettingAuthority,
  result: { server: Record<string, JsonValue>; connectionHost: Record<string, JsonValue>; deviceOverrides: Record<string, JsonValue>; transient: Record<string, JsonValue> },
): void {
  if (isSecretKey(key)) return;
  const authority = classifySetting(path);
  if (authority === parentAuthority && isSettingsObject(value)) {
    const child: Record<string, JsonValue> = {};
    for (const [childKey, childValue] of Object.entries(value)) partitionNested(child, childKey, childValue, `${path}.${childKey}`, parentAuthority, result);
    target[key] = child;
    return;
  }
  if (authority === parentAuthority) target[key] = cloneJson(value);
  else if (authority === "device-override") result.deviceOverrides[path] = cloneJson(value);
  else if (authority === "connection-host") result.connectionHost[path] = cloneJson(value);
  else result.transient[path] = cloneJson(value);
}

function normalizePath(path: string): string {
  return path.trim().replace(/^settings\./, "").replace(/\.\.+/g, ".").replace(/^\.|\.$/g, "");
}

function isSecretKey(key: string): boolean {
  return /(?:secret|token|password|passphrase|credential|privatekey|api[_-]?key|plaintext|pairingpinhash)/i.test(key);
}

function cloneJson(value: unknown): JsonValue {
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") return null;
  try {
    const cloned = structuredClone(value);
    return (cloned === undefined ? null : cloned) as JsonValue;
  } catch {
    return null;
  }
}

function cloneJsonObject(value: SettingsObject): SettingsObject {
  return cloneJson(value) as SettingsObject;
}

function collectOverrideValues(value: unknown, prefix: string, output: Array<[string, JsonValue]>): void {
  if (!isSettingsObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isSettingsObject(child)) collectOverrideValues(child, path, output);
    else output.push([path, cloneJson(child)]);
  }
}

function setJsonPath(target: SettingsObject, path: string, value: JsonValue): void {
  const parts = normalizePath(path).split(".").filter(Boolean);
  if (parts.length === 0) return;
  const root = target as Record<string, JsonValue>;
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (child === undefined || typeof child !== "object" || child === null || Array.isArray(child)) current[part] = {};
    else current[part] = cloneJson(child);
    current = current[part] as Record<string, JsonValue>;
  }
  current[parts[parts.length - 1] as string] = cloneJson(value);
}
