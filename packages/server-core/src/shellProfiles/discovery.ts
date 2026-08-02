import { createHash } from "node:crypto";
import { basename, isAbsolute } from "node:path";
import {
  MAX_SHELL_PROFILE_ARGS,
  MAX_SHELL_PROFILE_ENVIRONMENT,
  MAX_SHELL_PROFILES,
  SYSTEM_SHELL_PROFILE_ID,
  type ResolvedShellLaunchTarget,
  type ShellProfileCatalogueEntry,
  type ShellProfileDefinition,
  type ShellProfileSource,
  type ShellProfileValidationIssue,
  type ShellProfileValidationResult,
} from "./types.js";
import { isProtectedTerminalEnvironmentName } from "./normalize.js";
import { supportsShellStartupMode } from "./startupMode.js";

type MaybePromise<T> = T | PromiseLike<T>;

export type ShellDiscoveryPlatform = "darwin" | "linux" | "win32";

/**
 * The privileged host adapter used by discovery. `probeExecutable` is the
 * authority boundary: a successful result must be the canonical path of an
 * executable available to the server account.
 */
export interface ShellDiscoveryHost {
  readonly platform: ShellDiscoveryPlatform;
  readonly accountShell?: string | null;
  readonly environmentShell?: string | null;
  readonly openSshDefaultShell?: string | null;
  readonly comSpec?: string | null;
  readonly windowsPowerShellCandidates?: readonly string[];
  readonly powerShell7Candidates?: readonly string[];
  readonly commandPromptCandidates?: readonly string[];
  readonly gitBashCandidates?: readonly string[];
  readonly probeExecutable: (candidate: string, signal?: AbortSignal) => MaybePromise<string | null>;
  readonly readEtcShells?: (signal?: AbortSignal) => MaybePromise<string | null>;
  readonly listWslDistributions?: (signal?: AbortSignal) => MaybePromise<readonly string[]>;
}

export interface ShellDiscoveryServiceOptions {
  /** Per-host-operation deadline. Host adapters also receive an AbortSignal. */
  readonly hostCallTimeoutMs?: number;
}

export interface ShellDiscoveryResult {
  readonly systemProfile: ShellProfileCatalogueEntry;
  readonly discoveredProfiles: readonly ShellProfileCatalogueEntry[];
  /** Canonical executable selected by the documented System default chain. */
  readonly systemExecutable: string | null;
}

export interface ShellProfileCollectionValidationResult extends ShellProfileValidationResult {
  readonly profileIssues: Readonly<Record<string, readonly ShellProfileValidationIssue[]>>;
}

export type ShellProfileDiscoveryErrorCode =
  | "invalid-profile"
  | "target-unavailable"
  | "unsupported-startup-mode";

export class ShellProfileDiscoveryError extends Error {
  readonly code: ShellProfileDiscoveryErrorCode;

  constructor(code: ShellProfileDiscoveryErrorCode, message: string) {
    super(message);
    this.name = "ShellProfileDiscoveryError";
    this.code = code;
  }
}

interface Candidate {
  readonly candidate: string;
  readonly name?: string;
  readonly source: ShellProfileSource;
  readonly systemCandidate?: boolean;
}

interface AvailableCandidate extends Candidate {
  readonly canonical: string;
}

const POSIX_FALLBACKS: Readonly<Record<"darwin" | "linux", readonly string[]>> = {
  darwin: ["/bin/zsh", "/bin/bash", "/bin/sh"],
  linux: ["/bin/bash", "/bin/zsh", "/bin/sh"],
};

const DEFAULT_WINDOWS_POWERSHELL = [
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  "powershell.exe",
];
const DEFAULT_WINDOWS_PWSH = ["pwsh.exe"];
const DEFAULT_WINDOWS_CMD = ["C:\\Windows\\System32\\cmd.exe", "cmd.exe"];
const DEFAULT_GIT_BASH = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
];

const MAX_NAME_LENGTH = 128;
const MAX_ID_LENGTH = 128;
const MAX_PATH_LENGTH = 4096;
const MAX_ARGUMENT_LENGTH = 4096;
const MAX_ENVIRONMENT_KEY_LENGTH = 256;
const MAX_ENVIRONMENT_VALUE_LENGTH = 4_096;
const MAX_PRESENTATION_LENGTH = 128;
const MAX_DISCOVERY_CANDIDATES = 128;
const MAX_DISCOVERY_SOURCE_CANDIDATES = 32;
const MAX_ETC_SHELLS_BYTES = 65_536;
const MAX_ETC_SHELLS_LINES = 256;
const MAX_ETC_SHELLS_CANDIDATES = 120;
const MAX_WSL_DISTRIBUTIONS = 128;
/** Discovery shares a 64 KiB protocol header with durable catalogue entries. */
const MAX_DISCOVERY_SERIALIZED_BYTES = 24 * 1024;
const DEFAULT_HOST_CALL_TIMEOUT_MS = 2_000;
const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const COLOR = /^(?:#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8}|[A-Za-z][A-Za-z0-9-]{0,63})$/u;
const SECRET_LIKE_ENVIRONMENT_KEY = /(?:^|_)(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|CREDENTIALS?)(?:_|$)/iu;

/** Server-owned, deterministic shell capability discovery and validation. */
export class ShellProfileDiscoveryService {
  private readonly host: ShellDiscoveryHost;
  private readonly hostCallTimeoutMs: number;

  constructor(host: ShellDiscoveryHost, options: ShellDiscoveryServiceOptions = {}) {
    if (typeof host !== "object" || host === null || typeof host.probeExecutable !== "function") {
      throw new TypeError("shell discovery host is invalid");
    }
    if (host.platform !== "darwin" && host.platform !== "linux" && host.platform !== "win32") {
      throw new TypeError("shell discovery platform is unsupported");
    }
    this.host = host;
    const timeout = options.hostCallTimeoutMs ?? DEFAULT_HOST_CALL_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeout) || timeout < 10 || timeout > 30_000) throw new RangeError("shell discovery host timeout is invalid");
    this.hostCallTimeoutMs = timeout;
  }

  async discover(): Promise<ShellDiscoveryResult> {
    return this.host.platform === "win32" ? this.discoverWindows() : this.discoverPosix();
  }

  validate(profile: unknown, discovery?: ShellDiscoveryResult): ShellProfileValidationResult {
    const issues = validateProfileShape(profile);
    if (isStructurallyRecognizableProfile(profile)) {
      const typed = profile as ShellProfileDefinition;
      const executable = executableForStartupValidation(typed, discovery);
      if (typed.startupMode !== "default" && (executable === null || !supportsShellStartupMode(executable))) {
        issues.push(issue("unsupported-startup-mode", "startupMode", "The selected target does not support this startup mode."));
      }
      if (typed.target.kind === "system" && discovery !== undefined && discovery.systemExecutable === null) {
        issues.push(issue("target-unavailable", "target", "The System default shell is unavailable on this server."));
      }
      if (typed.target.kind === "wsl" && this.host.platform !== "win32") {
        issues.push(issue("unsupported-target", "target.kind", "WSL profiles are available only on Windows servers."));
      }
      if (typed.requiresReview === true) {
        issues.push(issue("review-required", "requiresReview", "This migrated shell profile must be reviewed before it can be launched."));
      }
    }
    return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues) });
  }

  validateProfiles(profiles: unknown, discovery?: ShellDiscoveryResult): ShellProfileCollectionValidationResult {
    const issues: ShellProfileValidationIssue[] = [];
    const byProfile: Record<string, readonly ShellProfileValidationIssue[]> = {};
    if (!Array.isArray(profiles)) {
      issues.push(issue("invalid-profiles", "profiles", "Shell profiles must be an array."));
      return Object.freeze({ valid: false, issues: Object.freeze(issues), profileIssues: Object.freeze(byProfile) });
    }
    if (profiles.length > MAX_SHELL_PROFILES) {
      issues.push(issue("profile-limit", "profiles", `At most ${MAX_SHELL_PROFILES} shell profiles are allowed.`));
    }

    const ids = new Set<string>();
    const names = new Set<string>();
    for (let index = 0; index < Math.min(profiles.length, MAX_SHELL_PROFILES + 1); index += 1) {
      const profile = profiles[index];
      const result = this.validate(profile, discovery);
      const record = isRecord(profile) ? profile : undefined;
      const id = typeof record?.id === "string" ? record.id : `#${index}`;
      const local = [...result.issues];
      if (typeof record?.id === "string") {
        if (ids.has(record.id)) local.push(issue("duplicate-id", "id", "Shell profile ids must be unique."));
        ids.add(record.id);
      }
      if (typeof record?.name === "string") {
        const key = record.name.trim().toLocaleLowerCase("en-US");
        if (names.has(key)) local.push(issue("duplicate-name", "name", "Shell profile names must be unique."));
        names.add(key);
      }
      if (local.length > 0) byProfile[id] = Object.freeze(local);
      issues.push(...local);
    }
    return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues), profileIssues: Object.freeze(byProfile) });
  }

  /** Revalidates a target immediately before launch and returns argv-safe data. */
  async resolveTarget(profile: ShellProfileDefinition, discovery?: ShellDiscoveryResult): Promise<ResolvedShellLaunchTarget> {
    const discovered = discovery ?? await this.discover();
    const validation = this.validate(profile, discovered);
    if (!validation.valid) {
      const unsupported = validation.issues.some((entry) => entry.code === "unsupported-startup-mode");
      throw new ShellProfileDiscoveryError(unsupported ? "unsupported-startup-mode" : "invalid-profile", "The shell profile is invalid.");
    }
    if (profile.target.kind === "system") {
      const executable = await this.resolveSystemExecutable();
      if (executable === null) throw new ShellProfileDiscoveryError("target-unavailable", "The System default shell is unavailable on this server.");
      return Object.freeze({ kind: "executable", executable });
    }
    if (profile.target.kind === "executable") {
      const executable = await this.probe(profile.target.executable);
      if (executable === null) throw new ShellProfileDiscoveryError("target-unavailable", "The shell profile executable is unavailable on this server.");
      return Object.freeze({ kind: "executable", executable });
    }

    const wslExecutable = await this.probe("wsl.exe");
    const distributions = await this.wslDistributions();
    const requestedDistribution = profile.target.distribution;
    const distribution = distributions.find((entry) => sameHostIdentity(entry, requestedDistribution, true));
    if (wslExecutable === null || distribution === undefined) {
      throw new ShellProfileDiscoveryError("target-unavailable", "The shell profile WSL distribution is unavailable on this server.");
    }
    return Object.freeze({
      kind: "wsl",
      executable: wslExecutable,
      distribution,
      ...(profile.target.shellPath === undefined ? {} : { shellPath: profile.target.shellPath }),
    });
  }

  private async discoverPosix(): Promise<ShellDiscoveryResult> {
    const platform = this.host.platform as "darwin" | "linux";
    const candidates: Candidate[] = [];
    if (isAbsoluteSafePath(this.host.accountShell)) addCandidate(candidates, this.host.accountShell, "account", true);
    if (isAbsoluteSafePath(this.host.environmentShell)) addCandidate(candidates, this.host.environmentShell, "environment", true);

    const rawShellsText = this.host.readEtcShells === undefined
      ? null
      : await this.callHost((signal) => this.host.readEtcShells!(signal), null);
    const shellsText = typeof rawShellsText === "string" ? rawShellsText : null;
    for (const path of parseEtcShells(shellsText)) addCandidate(candidates, path, "etc-shells", true);
    for (const path of POSIX_FALLBACKS[platform]) addCandidate(candidates, path, "fallback", true);

    return this.buildExecutableResult(candidates);
  }

  private async discoverWindows(): Promise<ShellDiscoveryResult> {
    const systemCandidates: Candidate[] = [];
    addCandidate(systemCandidates, this.host.environmentShell, "environment", true);
    addCandidate(systemCandidates, this.host.openSshDefaultShell, "fallback", true);
    for (const value of boundedCandidates(this.host.windowsPowerShellCandidates ?? DEFAULT_WINDOWS_POWERSHELL)) {
      addCandidate(systemCandidates, value, "powershell", true, "Windows PowerShell");
    }
    addCandidate(systemCandidates, this.host.comSpec, "comspec", true, "Command Prompt");

    const discoveryCandidates = [...systemCandidates];
    for (const value of boundedCandidates(this.host.powerShell7Candidates ?? DEFAULT_WINDOWS_PWSH)) addCandidate(discoveryCandidates, value, "powershell", false, "PowerShell 7");
    for (const value of boundedCandidates(this.host.commandPromptCandidates ?? DEFAULT_WINDOWS_CMD)) addCandidate(discoveryCandidates, value, "comspec", false, "Command Prompt");
    for (const value of boundedCandidates(this.host.gitBashCandidates ?? DEFAULT_GIT_BASH)) addCandidate(discoveryCandidates, value, "git-bash", false, "Git Bash");

    const executableResult = await this.buildExecutableResult(discoveryCandidates, systemCandidates);
    const discoveredProfiles = [...executableResult.discoveredProfiles];
    const wslExecutable = await this.probe("wsl.exe");
    if (wslExecutable !== null) {
      for (const distribution of await this.wslDistributions()) {
        discoveredProfiles.push(discoveredProfile({ kind: "wsl", distribution }, `WSL: ${distribution}`, "wsl"));
      }
    }
    return boundedDiscoveryResult(executableResult.systemProfile, executableResult.systemExecutable, uniqueProfileNames(discoveredProfiles));
  }

  private async buildExecutableResult(candidates: readonly Candidate[], systemCandidates: readonly Candidate[] = candidates): Promise<ShellDiscoveryResult> {
    const available: AvailableCandidate[] = [];
    const byCanonical = new Set<string>();
    const uniqueCandidates: string[] = [];
    const seenCandidates = new Set<string>();
    for (const candidate of candidates) {
      if (seenCandidates.has(candidate.candidate)) continue;
      seenCandidates.add(candidate.candidate);
      uniqueCandidates.push(candidate.candidate);
    }
    const resolvedValues = await Promise.all(uniqueCandidates.map((candidate) => this.probe(candidate)));
    const resolvedByCandidate = new Map(uniqueCandidates.map((candidate, index) => [candidate, resolvedValues[index] ?? null]));
    for (const candidate of candidates) {
      const canonical = resolvedByCandidate.get(candidate.candidate) ?? null;
      if (canonical === null) continue;
      const key = hostPathKey(canonical, this.host.platform === "win32");
      if (byCanonical.has(key)) continue;
      byCanonical.add(key);
      available.push({ ...candidate, canonical });
    }

    let systemExecutable: string | null = null;
    for (const candidate of systemCandidates) {
      const canonical = resolvedByCandidate.get(candidate.candidate) ?? null;
      if (canonical !== null) { systemExecutable = canonical; break; }
    }
    const systemProfile = systemDefaultProfile(systemExecutable !== null);
    const profiles = available.map((entry) => discoveredProfile(
      { kind: "executable", executable: entry.canonical },
      entry.name ?? displayName(entry.canonical),
      entry.source,
    ));
    return boundedDiscoveryResult(systemProfile, systemExecutable, uniqueProfileNames(profiles));
  }

  private async resolveSystemExecutable(): Promise<string | null> {
    const result = await this.discover();
    return result.systemExecutable;
  }

  private async probe(candidate: string): Promise<string | null> {
    if (!safeText(candidate, MAX_PATH_LENGTH)) return null;
    const canonical = await this.callHost((signal) => this.host.probeExecutable(candidate, signal), null);
    return safeText(canonical, MAX_PATH_LENGTH) ? canonical : null;
  }

  private async wslDistributions(): Promise<readonly string[]> {
    if (this.host.listWslDistributions === undefined) return [];
    const raw = await this.callHost((signal) => this.host.listWslDistributions!(signal), [] as readonly string[]);
    if (!Array.isArray(raw)) return [];
    const result: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < Math.min(raw.length, MAX_WSL_DISTRIBUTIONS); index += 1) {
      const value = raw[index];
      const distribution = typeof value === "string" ? value.trim() : "";
      const key = distribution.toLocaleLowerCase("en-US");
      if (!validDistribution(distribution) || seen.has(key)) continue;
      seen.add(key);
      result.push(distribution);
    }
    return Object.freeze(result);
  }

  private callHost<T>(operation: (signal: AbortSignal) => MaybePromise<T>, fallback: T): Promise<T> {
    const controller = new AbortController();
    return new Promise<T>((resolve) => {
      let complete = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (value: T): void => {
        if (complete) return;
        complete = true;
        clearTimeout(timer);
        resolve(value);
      };
      timer = setTimeout(() => {
        controller.abort();
        finish(fallback);
      }, this.hostCallTimeoutMs);
      Promise.resolve()
        .then(() => operation(controller.signal))
        .then((value) => finish(value), () => finish(fallback));
    });
  }
}

function validateProfileShape(profile: unknown): ShellProfileValidationIssue[] {
  const issues: ShellProfileValidationIssue[] = [];
  if (!isRecord(profile)) return [issue("invalid-profile", "profile", "The shell profile must be an object.")];

  rejectUnknownSecretFields(profile, "", issues);
  if (!safeText(profile.id, MAX_ID_LENGTH)) issues.push(issue("invalid-id", "id", "The shell profile id is invalid."));
  if (!safeTrimmedText(profile.name, MAX_NAME_LENGTH)) issues.push(issue("invalid-name", "name", `The shell profile name must be between 1 and ${MAX_NAME_LENGTH} characters.`));
  validateTarget(profile.target, issues);
  if (profile.startupMode !== "default" && profile.startupMode !== "login" && profile.startupMode !== "non-login") {
    issues.push(issue("invalid-startup-mode", "startupMode", "The shell profile startup mode is invalid."));
  }
  if (!Array.isArray(profile.args) || profile.args.length > MAX_SHELL_PROFILE_ARGS) {
    issues.push(issue("argument-limit", "args", `A shell profile accepts at most ${MAX_SHELL_PROFILE_ARGS} arguments.`));
  } else {
    for (let index = 0; index < profile.args.length; index += 1) {
      if (!safeText(profile.args[index], MAX_ARGUMENT_LENGTH)) issues.push(issue("invalid-argument", `args.${index}`, "The shell profile argument is invalid."));
    }
  }
  validateEnvironment(profile.environment, issues);
  if (profile.icon !== undefined && !safeTrimmedText(profile.icon, MAX_PRESENTATION_LENGTH)) issues.push(issue("invalid-icon", "icon", "The shell profile icon is invalid."));
  if (profile.color !== undefined && (typeof profile.color !== "string" || !COLOR.test(profile.color))) issues.push(issue("invalid-color", "color", "The shell profile colour is invalid."));
  return issues;
}

function isStructurallyRecognizableProfile(value: unknown): value is ShellProfileDefinition {
  if (!isRecord(value) || !isRecord(value.target)) return false;
  const targetKind = value.target.kind;
  return (targetKind === "system" || targetKind === "executable" || targetKind === "wsl")
    && (value.startupMode === "default" || value.startupMode === "login" || value.startupMode === "non-login");
}

function validateTarget(target: unknown, issues: ShellProfileValidationIssue[]): void {
  if (!isRecord(target)) { issues.push(issue("invalid-target", "target", "The shell profile target is invalid.")); return; }
  if (target.kind === "system") return;
  if (target.kind === "executable") {
    if (!safeTrimmedText(target.executable, MAX_PATH_LENGTH)) issues.push(issue("invalid-executable", "target.executable", "The shell profile executable is invalid."));
    return;
  }
  if (target.kind === "wsl") {
    if (!validDistribution(target.distribution)) issues.push(issue("invalid-distribution", "target.distribution", "The WSL distribution is invalid."));
    if (target.shellPath !== undefined && (!safeTrimmedText(target.shellPath, MAX_PATH_LENGTH) || !isAbsolute(target.shellPath))) {
      issues.push(issue("invalid-wsl-shell", "target.shellPath", "The WSL shell path must be an absolute path."));
    }
    return;
  }
  issues.push(issue("invalid-target", "target.kind", "The shell profile target kind is invalid."));
}

function validateEnvironment(value: unknown, issues: ShellProfileValidationIssue[]): void {
  if (!isRecord(value) || Object.keys(value).length > MAX_SHELL_PROFILE_ENVIRONMENT) {
    issues.push(issue("environment-limit", "environment", `A shell profile accepts at most ${MAX_SHELL_PROFILE_ENVIRONMENT} environment entries.`));
    return;
  }
  for (const [key, environmentValue] of Object.entries(value)) {
    if (key.length > MAX_ENVIRONMENT_KEY_LENGTH || !ENVIRONMENT_KEY.test(key)) {
      issues.push(issue("invalid-environment-key", `environment.${key}`, "The environment variable name is invalid."));
      continue;
    }
    if (isProtectedTerminalEnvironmentName(key)) {
      issues.push(issue("protected-environment", `environment.${key}`, "This server-managed environment variable cannot be changed by a shell profile."));
    } else if (SECRET_LIKE_ENVIRONMENT_KEY.test(key)) {
      issues.push(issue("secret-environment", `environment.${key}`, "Secret material cannot be stored in a shell profile."));
    }
    if (environmentValue !== null && (!safeText(environmentValue, MAX_ENVIRONMENT_VALUE_LENGTH) || new TextEncoder().encode(environmentValue).byteLength > MAX_ENVIRONMENT_VALUE_LENGTH)) {
      issues.push(issue("invalid-environment-value", `environment.${key}`, "The environment variable value is invalid."));
    }
  }
}

function rejectUnknownSecretFields(value: Record<string, unknown>, prefix: string, issues: ShellProfileValidationIssue[]): void {
  for (const [key, fieldValue] of Object.entries(value)) {
    const field = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (/(?:secret|password|credential|token)/iu.test(key) && prefix !== "environment") {
      issues.push(issue("secret-field", field, "Secret fields are not supported by shell profiles."));
    }
    if ((key === "target" || key === "presentation") && isRecord(fieldValue)) rejectUnknownSecretFields(fieldValue, field, issues);
  }
}

function executableForStartupValidation(profile: ShellProfileDefinition, discovery?: ShellDiscoveryResult): string | null {
  if (profile.target.kind === "executable") return profile.target.executable;
  if (profile.target.kind === "system") return discovery?.systemExecutable ?? null;
  return profile.target.shellPath ?? null;
}

function parseEtcShells(value: string | null): readonly string[] {
  if (value === null) return [];
  if (value.length > MAX_ETC_SHELLS_BYTES || new TextEncoder().encode(value).byteLength > MAX_ETC_SHELLS_BYTES) return [];
  const result: string[] = [];
  const lines = value.split(/\r?\n/u, MAX_ETC_SHELLS_LINES + 1);
  for (let index = 0; index < Math.min(lines.length, MAX_ETC_SHELLS_LINES); index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || !isAbsoluteSafePath(line)) continue;
    result.push(line);
    if (result.length >= MAX_ETC_SHELLS_CANDIDATES) break;
  }
  return result;
}

function systemDefaultProfile(available: boolean): ShellProfileCatalogueEntry {
  return Object.freeze({
    id: SYSTEM_SHELL_PROFILE_ID,
    name: "System default",
    target: Object.freeze({ kind: "system" }),
    args: Object.freeze([]),
    startupMode: "default",
    kind: "system",
    readOnly: true,
    source: "system",
    availability: Object.freeze({ available, ...(available ? {} : { reason: "No usable system shell was found." }) }),
    projectReferences: Object.freeze([]),
    environmentEntryCount: 0,
    hasEnvironmentOverlay: false,
    argumentCount: 0,
  });
}

function discoveredProfile(target: ShellProfileDefinition["target"], name: string, source: ShellProfileSource): ShellProfileCatalogueEntry {
  return Object.freeze({
    id: stableDiscoveredId(target),
    name,
    target: Object.freeze(target),
    args: Object.freeze([]),
    startupMode: "default",
    kind: "discovered",
    readOnly: true,
    source,
    availability: Object.freeze({ available: true }),
    projectReferences: Object.freeze([]),
    environmentEntryCount: 0,
    hasEnvironmentOverlay: false,
    argumentCount: 0,
  });
}

function stableDiscoveredId(target: ShellProfileDefinition["target"]): string {
  const identity = target.kind === "wsl"
    ? `wsl\0${target.distribution}\0${target.shellPath ?? ""}`
    : target.kind === "executable" ? `executable\0${target.executable}` : "system";
  return `discovered-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function uniqueProfileNames(profiles: readonly ShellProfileCatalogueEntry[]): ShellProfileCatalogueEntry[] {
  const counts = new Map<string, number>();
  return profiles.map((profile) => {
    const baseName = boundedDisplayName(profile.name);
    const key = baseName.toLocaleLowerCase("en-US");
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count === 1 && baseName === profile.name) return profile;
    const suffix = count === 1 ? "" : ` (${count})`;
    return Object.freeze({ ...profile, name: `${baseName.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}` });
  });
}

function displayName(executable: string): string {
  const value = portableBasename(executable).replace(/\.exe$/iu, "");
  const names: Readonly<Record<string, string>> = { bash: "Bash", cmd: "Command Prompt", fish: "Fish", ksh: "KornShell", powershell: "Windows PowerShell", pwsh: "PowerShell 7", sh: "sh", zsh: "Zsh" };
  return boundedDisplayName(names[value.toLocaleLowerCase("en-US")] ?? value);
}

function portableBasename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return basename(normalized);
}

function addCandidate(list: Candidate[], value: string | null | undefined, source: ShellProfileSource, systemCandidate = false, name?: string): void {
  if (list.length >= MAX_DISCOVERY_CANDIDATES || !safeTrimmedText(value, MAX_PATH_LENGTH)) return;
  list.push({ candidate: value, source, systemCandidate, ...(name === undefined ? {} : { name }) });
}

function boundedCandidates(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  for (let index = 0; index < Math.min(values.length, MAX_DISCOVERY_SOURCE_CANDIDATES); index += 1) {
    const value = values[index];
    if (typeof value === "string") result.push(value);
  }
  return result;
}

function boundedDiscoveryResult(
  systemProfile: ShellProfileCatalogueEntry,
  systemExecutable: string | null,
  profiles: readonly ShellProfileCatalogueEntry[],
): ShellDiscoveryResult {
  const discoveredProfiles: ShellProfileCatalogueEntry[] = [];
  for (const profile of profiles) {
    if (discoveredProfiles.length >= MAX_DISCOVERY_CANDIDATES) break;
    const candidate = { systemProfile, discoveredProfiles: [...discoveredProfiles, profile], systemExecutable };
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > MAX_DISCOVERY_SERIALIZED_BYTES) break;
    discoveredProfiles.push(profile);
  }
  return Object.freeze({ systemProfile, discoveredProfiles: Object.freeze(discoveredProfiles), systemExecutable });
}

function boundedDisplayName(value: string): string {
  return value.slice(0, MAX_NAME_LENGTH);
}

function validDistribution(value: unknown): value is string {
  return safeTrimmedText(value, 128) && !value.includes("\0") && !value.includes("\r") && !value.includes("\n") && !value.startsWith("-");
}

function isAbsoluteSafePath(value: unknown): value is string {
  return safeTrimmedText(value, MAX_PATH_LENGTH) && isAbsolute(value);
}

function safeText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !value.includes("\0") && !value.includes("\r") && !value.includes("\n");
}

function safeTrimmedText(value: unknown, max: number): value is string {
  return safeText(value, max) && value.trim().length > 0 && value === value.trim();
}

function hostPathKey(value: string, windows: boolean): string {
  return windows ? value.replace(/\//g, "\\").toLocaleLowerCase("en-US") : value;
}

function sameHostIdentity(left: string, right: string, windows: boolean): boolean {
  return windows ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US") : left === right;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(code: string, field: string, message: string): ShellProfileValidationIssue {
  return Object.freeze({ code, field, message });
}
