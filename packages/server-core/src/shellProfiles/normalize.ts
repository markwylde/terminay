import type { JsonValue, ProtocolId } from "@terminay/protocol";
import {
  MAX_SHELL_PROFILES,
  MAX_SHELL_PROFILE_ARGS,
  MAX_SHELL_PROFILE_ENVIRONMENT,
  MAX_SHELL_PROFILE_BYTES,
  MAX_SHELL_PROFILES_BYTES,
  SYSTEM_SHELL_PROFILE_ID,
  type NewTerminalCwdPolicy,
  type ShellProfileDefinition,
  type ShellProfilesSettings,
  type ShellProfileTarget,
  type ShellStartupMode,
} from "./types.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SECRET_LIKE = /(?:secret|token|password|passphrase|credential|private[_-]?key|api[_-]?key|plaintext|pairing[_-]?pin)/i;
const COMMAND_ARGUMENTS = new Set(["-c", "--command", "/c", "-command", "-encodedcommand"]);
const STARTUP_MODES = new Set<ShellStartupMode>(["default", "login", "non-login"]);
const CWD_POLICIES = new Set<NewTerminalCwdPolicy>(["current", "project", "home"]);

export const DEFAULT_SHELL_PROFILES_SETTINGS: ShellProfilesSettings = Object.freeze({
  defaultProfileId: SYSTEM_SHELL_PROFILE_ID,
  cwdPolicy: "current",
  profiles: [],
  order: [],
});

export function shellProfilesSettingsAsJson(settings: ShellProfilesSettings): JsonValue {
  return structuredClone(settings) as unknown as JsonValue;
}

/** Strict normalization boundary used for persisted and protocol mutations. */
export function normalizeShellProfilesSettings(input: unknown): ShellProfilesSettings {
  const raw = object(input, "shellProfiles");
  const profilesRaw = raw.profiles;
  if (!Array.isArray(profilesRaw) || profilesRaw.length > MAX_SHELL_PROFILES) {
    throw new TypeError(`shell profiles must contain at most ${MAX_SHELL_PROFILES} entries`);
  }
  const profiles = profilesRaw.map((profile, index) => normalizeShellProfile(profile, index));
  if (utf8Bytes(JSON.stringify(profiles)) > MAX_SHELL_PROFILES_BYTES) throw new TypeError("shell profiles exceed the aggregate storage limit");
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) throw new TypeError("shell profile ids must be unique");
    const name = profile.name.toLocaleLowerCase();
    if (names.has(name)) throw new TypeError("shell profile names must be unique");
    ids.add(profile.id);
    names.add(name);
  }
  const defaultProfileId = id(raw.defaultProfileId ?? SYSTEM_SHELL_PROFILE_ID, "defaultProfileId");
  if (defaultProfileId !== SYSTEM_SHELL_PROFILE_ID && !ids.has(defaultProfileId)) {
    throw new TypeError("default shell profile does not exist");
  }
  const cwdPolicy = raw.cwdPolicy ?? "current";
  if (typeof cwdPolicy !== "string" || !CWD_POLICIES.has(cwdPolicy as NewTerminalCwdPolicy)) {
    throw new TypeError("new-terminal cwd policy is invalid");
  }
  const orderRaw = raw.order ?? profiles.map((profile) => profile.id);
  if (!Array.isArray(orderRaw) || orderRaw.some((entry) => typeof entry !== "string")) {
    throw new TypeError("shell profile order is invalid");
  }
  const order = orderRaw.map((entry) => id(entry, "order id"));
  if (order.length !== profiles.length || new Set(order).size !== order.length || order.some((entry) => !ids.has(entry))) {
    throw new TypeError("shell profile order must contain every custom profile exactly once");
  }
  return { defaultProfileId, cwdPolicy: cwdPolicy as NewTerminalCwdPolicy, profiles, order };
}

export function normalizeShellProfile(input: unknown, index = 0): ShellProfileDefinition {
  const raw = object(input, `profile ${index}`);
  const profileId = id(raw.id, "profile id");
  if (profileId === SYSTEM_SHELL_PROFILE_ID) throw new TypeError("the System default profile id is reserved");
  const name = boundedString(raw.name, "profile name", 1, 128);
  const startupMode = raw.startupMode ?? "default";
  if (typeof startupMode !== "string" || !STARTUP_MODES.has(startupMode as ShellStartupMode)) {
    throw new TypeError("shell startup mode is invalid");
  }
  const args = normalizeArgs(raw.args ?? []);
  const environment = normalizeEnvironment(raw.environment ?? {});
  const target = normalizeTarget(raw.target);
  const icon = optionalBoundedString(raw.icon, "profile icon", 8);
  if (icon !== undefined && [...icon].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  })) throw new TypeError("profile icon is invalid");
  const color = optionalBoundedString(raw.color, "profile color", 9);
  if (color !== undefined && !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) throw new TypeError("profile color is invalid");
  const requiresReview = raw.requiresReview === true;
  const result: ShellProfileDefinition = {
    id: profileId,
    name,
    target,
    args,
    startupMode: startupMode as ShellStartupMode,
    environment,
    ...(icon === undefined ? {} : { icon }),
    ...(color === undefined ? {} : { color }),
    ...(requiresReview ? { requiresReview: true } : {}),
  };
  if (utf8Bytes(JSON.stringify(result)) > MAX_SHELL_PROFILE_BYTES) throw new TypeError("shell profile exceeds the storage limit");
  return result;
}

export function isProtectedTerminalEnvironmentName(name: string): boolean {
  const upper = name.toUpperCase();
  return upper.startsWith("TERMINAY_") || upper === "TERM" || upper === "COLORTERM" ||
    upper === "TERM_PROGRAM" || upper === "TERM_PROGRAM_VERSION" || upper === "WSLENV" || upper === "LANG" || upper.startsWith("LC_");
}

export function parseLegacyShellArguments(input: string): { readonly args: readonly string[]; readonly requiresReview: boolean } {
  if (input.trim() === "") return { args: [], requiresReview: false };
  const args: string[] = [];
  let value = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  let started = false;
  for (const character of input) {
    if (escaping) { value += character; escaping = false; started = true; continue; }
    if (character === "\\" && quote !== "'") { escaping = true; started = true; continue; }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else value += character;
      started = true;
      continue;
    }
    if (character === "'" || character === '"') { quote = character; started = true; continue; }
    if (/\s/.test(character)) {
      if (started) { args.push(value); value = ""; started = false; }
      continue;
    }
    value += character;
    started = true;
  }
  if (escaping || quote !== undefined) return { args: [input], requiresReview: true };
  if (started) args.push(value);
  const unsafe = args.length > MAX_SHELL_PROFILE_ARGS || args.some((argument) => COMMAND_ARGUMENTS.has(argument.toLocaleLowerCase()));
  return unsafe ? { args: [input], requiresReview: true } : { args, requiresReview: false };
}

function normalizeTarget(input: unknown): ShellProfileTarget {
  const raw = object(input, "profile target");
  if (raw.kind === "system") {
    if (Object.keys(raw).some((key) => key !== "kind")) throw new TypeError("System target has unsupported fields");
    return { kind: "system" };
  }
  if (raw.kind === "executable") {
    const executable = boundedString(raw.executable, "shell executable", 1, 4096);
    if (executable.includes("\0") || /[\r\n]/.test(executable)) throw new TypeError("shell executable is invalid");
    return { kind: "executable", executable };
  }
  if (raw.kind === "wsl") {
    const distribution = boundedString(raw.distribution, "WSL distribution", 1, 128);
    if (/^[.-]|[\0\r\n]/.test(distribution)) throw new TypeError("WSL distribution is invalid");
    const shellPath = optionalBoundedString(raw.shellPath, "WSL shell path", 4096);
    if (shellPath !== undefined && (!shellPath.startsWith("/") || shellPath.includes("\0") || /[\r\n]/.test(shellPath))) {
      throw new TypeError("WSL shell path must be absolute");
    }
    return { kind: "wsl", distribution, ...(shellPath === undefined ? {} : { shellPath }) };
  }
  throw new TypeError("shell profile target kind is invalid");
}

function normalizeArgs(input: unknown): readonly string[] {
  if (!Array.isArray(input) || input.length > MAX_SHELL_PROFILE_ARGS) throw new TypeError("shell profile arguments are invalid");
  return input.map((value) => {
    const argument = boundedString(value, "shell argument", 0, 4096);
    if (argument.includes("\0") || /[\r\n]/.test(argument)) throw new TypeError("shell argument is invalid");
    if (COMMAND_ARGUMENTS.has(argument.toLocaleLowerCase())) throw new TypeError("shell command arguments are not supported");
    return argument;
  });
}

function normalizeEnvironment(input: unknown): Readonly<Record<string, string | null>> {
  const raw = object(input, "profile environment");
  const entries = Object.entries(raw);
  if (entries.length > MAX_SHELL_PROFILE_ENVIRONMENT) throw new TypeError("shell profile environment has too many entries");
  const result: Record<string, string | null> = {};
  for (const [key, value] of entries) {
    if (!ENVIRONMENT_KEY_PATTERN.test(key)) throw new TypeError("shell profile environment key is invalid");
    if (isProtectedTerminalEnvironmentName(key)) throw new TypeError("shell profile environment key is server protected");
    if (SECRET_LIKE.test(key)) throw new TypeError("shell profiles cannot contain secret-like environment fields");
    if (value !== null && (typeof value !== "string" || utf8Bytes(value) > 4096 || value.includes("\0"))) {
      throw new TypeError("shell profile environment value is invalid");
    }
    result[key] = value as string | null;
  }
  return result;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function id(value: unknown, name: string): ProtocolId {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function boundedString(value: unknown, name: string, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) throw new TypeError(`${name} is invalid`);
  return value;
}

function optionalBoundedString(value: unknown, name: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  return boundedString(value, name, 1, maximum);
}
