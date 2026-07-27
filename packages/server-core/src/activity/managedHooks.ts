import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Providers whose native hook formats are reconciled by server-core. */
export type AgentHookProvider = "codex" | "claude-code";

export const MANAGED_HOOK_MARKER = "TERMINAY_MANAGED_AGENT_HOOK=1";
export const MANAGED_HOOK_TIMEOUT_SECONDS = 2;

export const CODEX_MANAGED_HOOK_EVENTS = Object.freeze([
  { eventName: "SessionStart" },
  { eventName: "SessionEnd" },
  { eventName: "UserPromptSubmit" },
  { eventName: "PreToolUse", matcher: "*" },
  { eventName: "PermissionRequest", matcher: "*" },
  { eventName: "PostToolUse", matcher: "*" },
  { eventName: "SubagentStart" },
  { eventName: "SubagentStop" },
  { eventName: "Stop" },
] as const);

export const CLAUDE_CODE_MANAGED_HOOK_EVENTS = Object.freeze([
  { eventName: "SessionStart" },
  { eventName: "SessionEnd" },
  { eventName: "UserPromptSubmit" },
  { eventName: "PreToolUse", matcher: "*" },
  { eventName: "PermissionRequest", matcher: "*" },
  { eventName: "PostToolUse", matcher: "*" },
  { eventName: "PostToolUseFailure", matcher: "*" },
  { eventName: "SubagentStart" },
  { eventName: "SubagentStop" },
  { eventName: "Stop" },
  { eventName: "StopFailure" },
] as const);

export interface AgentHookFileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface ManagedHookPaths {
  readonly homeDir: string;
  readonly configPath: string;
  readonly scriptPath: string;
}

export interface ManagedHookOptions {
  /** Explicit home/config root. Hosts should pass their configured profile. */
  readonly homeDir?: string;
  readonly scriptDir?: string;
  readonly fileSystem?: AgentHookFileSystem;
}

export type ManagedHookInstallState = "installed" | "partial" | "not-installed" | "error";

export interface ManagedHookStatus {
  readonly provider: AgentHookProvider;
  readonly state: ManagedHookInstallState;
  readonly configPath: string;
  readonly scriptPath: string;
  readonly managedHooksPresent: boolean;
  readonly installedEvents: readonly string[];
  readonly missingEvents: readonly string[];
  readonly error?: string;
}

export interface ManagedEventDefinition {
  readonly eventName: string;
  readonly matcher?: string;
}

export interface ManagedHookReconciler {
  readonly provider: AgentHookProvider;
  paths(options?: ManagedHookOptions): ManagedHookPaths;
  status(options?: ManagedHookOptions): Promise<ManagedHookStatus>;
  install(options?: ManagedHookOptions): Promise<ManagedHookStatus>;
  uninstall(options?: ManagedHookOptions): Promise<ManagedHookStatus>;
}

interface HooksConfig {
  readonly hooks?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

interface ReadConfigSuccess {
  readonly config: HooksConfig;
  readonly exists: boolean;
}

interface ReadConfigFailure {
  readonly error: string;
  readonly exists: boolean;
}

/**
 * Reconcile one provider's JSON hook file. The only persisted command is a
 * static script path; endpoint/session/token are inherited from the provider
 * process environment and therefore never enter global config or snapshots.
 */
export function createManagedHookReconciler(
  provider: AgentHookProvider,
  events: readonly ManagedEventDefinition[],
  options: { readonly placement?: "append" | "prepend" } = {},
): ManagedHookReconciler {
  const placement = options.placement ?? "prepend";
  const configSegments = provider === "codex" ? [".codex", "hooks.json"] : [".claude", "settings.json"];
  const scriptName = `terminay-${provider}-agent-hook.sh`;
  const paths = (hookOptions: ManagedHookOptions = {}): ManagedHookPaths => {
    const homeDir = hookOptions.homeDir ?? homedir();
    const scriptDir = hookOptions.scriptDir ?? join(homeDir, ".terminay", "agent-hooks");
    return Object.freeze({ homeDir, configPath: join(homeDir, ...configSegments), scriptPath: join(scriptDir, scriptName) });
  };

  return {
    provider,
    paths,
    async status(hookOptions = {}) {
      const resolved = paths(hookOptions);
      const result = await readHooksConfig(resolved.configPath, hookOptions.fileSystem ?? createNodeAgentHookFileSystem());
      if ("error" in result) return errorStatus(provider, resolved, events, result.error);
      return statusFromPresence(provider, resolved, events, result.config);
    },
    async install(hookOptions = {}) {
      const resolved = paths(hookOptions);
      const fs = hookOptions.fileSystem ?? createNodeAgentHookFileSystem();
      const result = await readHooksConfig(resolved.configPath, fs);
      if ("error" in result) return errorStatus(provider, resolved, events, result.error);
      try {
        const command = buildManagedHookCommand(resolved.scriptPath, provider);
        const hooks = getHookRecord(result.config);
        for (const event of events) {
          const existing = hooks[event.eventName];
          if (existing !== undefined && !Array.isArray(existing)) {
            return errorStatus(provider, resolved, events, `${resolved.configPath} has a non-array ${event.eventName} hook; refusing to overwrite it`);
          }
          hooks[event.eventName] = reconcileManagedDefinition(existing, command, event.matcher, placement);
        }
        await writeManagedHookScript(resolved.scriptPath, fs);
        await writeJsonAtomically(resolved.configPath, { ...result.config, hooks }, fs);
        return statusFromPresence(provider, resolved, events, { ...result.config, hooks });
      } catch (error) {
        return errorStatus(provider, resolved, events, error);
      }
    },
    async uninstall(hookOptions = {}) {
      const resolved = paths(hookOptions);
      const fs = hookOptions.fileSystem ?? createNodeAgentHookFileSystem();
      const result = await readHooksConfig(resolved.configPath, fs);
      if ("error" in result) return errorStatus(provider, resolved, events, result.error);
      try {
        const hooks = getHookRecord(result.config);
        let changed = false;
        for (const [eventName, definitions] of Object.entries(hooks)) {
          if (!Array.isArray(definitions)) continue;
          const cleaned = removeManagedHooks(definitions);
          if (JSON.stringify(cleaned) === JSON.stringify(definitions)) continue;
          changed = true;
          if (cleaned.length === 0) delete hooks[eventName];
          else hooks[eventName] = cleaned;
        }
        if (changed && result.exists) await writeJsonAtomically(resolved.configPath, { ...result.config, hooks }, fs);
        await fs.remove(resolved.scriptPath);
        return statusFromPresence(provider, resolved, events, { ...result.config, hooks });
      } catch (error) {
        return errorStatus(provider, resolved, events, error);
      }
    },
  };
}

export const codexManagedHookReconciler = createManagedHookReconciler("codex", CODEX_MANAGED_HOOK_EVENTS, { placement: "append" });
export const claudeCodeManagedHookReconciler = createManagedHookReconciler("claude-code", CLAUDE_CODE_MANAGED_HOOK_EVENTS);

export function createManagedHookReconcilers(): Readonly<Record<AgentHookProvider, ManagedHookReconciler>> {
  return Object.freeze({ codex: codexManagedHookReconciler, "claude-code": claudeCodeManagedHookReconciler });
}

export function buildManagedHookCommand(scriptPath: string, provider: AgentHookProvider): string {
  return `${MANAGED_HOOK_MARKER} /bin/sh ${quotePosix(scriptPath)} ${quotePosix(provider)}`;
}

/** Hook delivery is best-effort and never blocks the provider's hook chain. */
export function buildManagedHookScript(): string {
  return [
    "#!/bin/sh",
    "payload=$(cat)",
    "provider=${1:-}",
    "if [ -z \"$payload\" ] || [ -z \"$provider\" ]; then exit 0; fi",
    "if [ -z \"$TERMINAY_SESSION_ID\" ] || [ -z \"$TERMINAY_AGENT_HOOK_ENDPOINT\" ] || [ -z \"$TERMINAY_AGENT_HOOK_TOKEN\" ]; then exit 0; fi",
    'case "$TERMINAY_AGENT_HOOK_ENDPOINT" in http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*) ;; *) exit 0 ;; esac',
    "printf '%s' \"$payload\" | curl -sS -X POST \"$TERMINAY_AGENT_HOOK_ENDPOINT\" --connect-timeout 0.5 --max-time 1.5 --noproxy '*' -H 'Content-Type: application/json' -H \"X-Terminay-Agent-Hook-Token: $TERMINAY_AGENT_HOOK_TOKEN\" -H \"X-Terminay-Session-Id: $TERMINAY_SESSION_ID\" -H \"X-Terminay-Agent-Provider: $provider\" --data-binary @- >/dev/null 2>&1 || true",
    "exit 0",
    "",
  ].join("\n");
}

export function createNodeAgentHookFileSystem(): AgentHookFileSystem {
  return {
    readFile: (path) => readFile(path, "utf8"),
    writeFile: (path, content) => writeFile(path, content, "utf8"),
    mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    rename,
    chmod,
    remove: (path) => rm(path, { force: true }),
  };
}

export async function readHooksConfig(path: string, fs: AgentHookFileSystem): Promise<ReadConfigSuccess | ReadConfigFailure> {
  let raw: string;
  try {
    raw = await fs.readFile(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { config: {}, exists: false };
    return { error: describeError(cause), exists: false };
  }
  if (raw.trim() === "") return { config: {}, exists: true };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return { error: `${path} does not contain a JSON object; refusing to overwrite it`, exists: true };
    if (parsed.hooks !== undefined && !isPlainObject(parsed.hooks)) return { error: `${path} has a non-object hooks value; refusing to overwrite it`, exists: true };
    return { config: parsed as HooksConfig, exists: true };
  } catch (cause) {
    return { error: `Could not parse ${path} as JSON: ${describeError(cause)}`, exists: true };
  }
}

export function reconcileManagedDefinition(definitions: unknown, command: string, matcher: string | undefined, placement: "append" | "prepend"): Record<string, unknown>[] {
  const current = Array.isArray(definitions) ? definitions : [];
  let retained = false;
  const reconciled: Record<string, unknown>[] = [];
  for (const value of current) {
    if (!isPlainObject(value)) {
      reconciled.push(value as Record<string, unknown>);
      continue;
    }
    const definition = { ...value } as Record<string, unknown>;
    if (!Array.isArray(definition.hooks)) {
      reconciled.push(definition);
      continue;
    }
    const hooks: Record<string, unknown>[] = [];
    for (const hook of definition.hooks) {
      if (!isPlainObject(hook) || !isManagedCommand(hook.command)) {
        hooks.push(hook as Record<string, unknown>);
      } else if (!retained) {
        hooks.push({ type: "command", command, timeout: MANAGED_HOOK_TIMEOUT_SECONDS });
        retained = true;
      }
    }
    if (hooks.length > 0) definition.hooks = hooks;
    if (hooks.length > 0) reconciled.push(definition);
  }
  if (retained) return reconciled;
  const managed: Record<string, unknown> = { hooks: [{ type: "command", command, timeout: MANAGED_HOOK_TIMEOUT_SECONDS }] };
  if (matcher !== undefined) managed.matcher = matcher;
  return placement === "append" ? [...reconciled, managed] : [managed, ...reconciled];
}

export function removeManagedHooks(definitions: unknown): Record<string, unknown>[] {
  if (!Array.isArray(definitions)) return [];
  const cleaned: Record<string, unknown>[] = [];
  for (const value of definitions) {
    if (!isPlainObject(value)) {
      cleaned.push(value as Record<string, unknown>);
      continue;
    }
    const definition = { ...value } as Record<string, unknown>;
    if (!Array.isArray(definition.hooks)) {
      if (!isManagedCommand(definition.command)) cleaned.push(definition);
      continue;
    }
    const hooks = definition.hooks.filter((hook) => !isPlainObject(hook) || !isManagedCommand(hook.command));
    if (hooks.length > 0) {
      definition.hooks = hooks;
      cleaned.push(definition);
    }
  }
  return cleaned;
}

export function isManagedCommand(command: unknown): boolean {
  return typeof command === "string" && command.startsWith(`${MANAGED_HOOK_MARKER} `);
}

export function getHookRecord(config: HooksConfig): Record<string, unknown> {
  return isPlainObject(config.hooks) ? { ...config.hooks } : {};
}

export function getManagedEventPresence(config: HooksConfig, events: readonly ManagedEventDefinition[]): { readonly installedEvents: readonly string[]; readonly missingEvents: readonly string[] } {
  const hooks = getHookRecord(config);
  const installedEvents: string[] = [];
  const missingEvents: string[] = [];
  for (const { eventName } of events) {
    const definitions = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
    const installed = definitions.some((definition) => isPlainObject(definition) && Array.isArray(definition.hooks) && definition.hooks.some((hook) => isPlainObject(hook) && isManagedCommand(hook.command)));
    (installed ? installedEvents : missingEvents).push(eventName);
  }
  return { installedEvents, missingEvents };
}

export function quotePosix(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function writeJsonAtomically(path: string, value: unknown, fs: AgentHookFileSystem): Promise<void> {
  await fs.mkdir(dirname(path));
  const temporaryPath = join(dirname(path), `.terminay-agent-hook-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await fs.rename(temporaryPath, path);
    await fs.chmod(path, 0o600);
  } catch (cause) {
    await fs.remove(temporaryPath).catch(() => undefined);
    throw cause;
  }
}

async function writeManagedHookScript(path: string, fs: AgentHookFileSystem): Promise<void> {
  await fs.mkdir(dirname(path));
  const temporaryPath = join(dirname(path), `.terminay-agent-hook-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporaryPath, buildManagedHookScript());
    await fs.rename(temporaryPath, path);
    await fs.chmod(path, 0o700);
  } catch (cause) {
    await fs.remove(temporaryPath).catch(() => undefined);
    throw cause;
  }
}

function statusFromPresence(provider: AgentHookProvider, paths: ManagedHookPaths, events: readonly ManagedEventDefinition[], config: HooksConfig): ManagedHookStatus {
  const { installedEvents, missingEvents } = getManagedEventPresence(config, events);
  return Object.freeze({ provider, state: missingEvents.length === 0 ? "installed" : installedEvents.length === 0 ? "not-installed" : "partial", configPath: paths.configPath, scriptPath: paths.scriptPath, managedHooksPresent: installedEvents.length > 0, installedEvents: Object.freeze([...installedEvents]), missingEvents: Object.freeze([...missingEvents]) });
}

function errorStatus(provider: AgentHookProvider, paths: ManagedHookPaths, events: readonly ManagedEventDefinition[], error: unknown): ManagedHookStatus {
  return Object.freeze({ provider, state: "error", configPath: paths.configPath, scriptPath: paths.scriptPath, managedHooksPresent: false, installedEvents: Object.freeze([]), missingEvents: Object.freeze(events.map(({ eventName }) => eventName)), error: describeError(error) });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describeError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
