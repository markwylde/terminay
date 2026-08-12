import { stat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, parse } from "node:path";
import type { ProtocolId } from "@terminay/protocol";
import {
  SYSTEM_SHELL_PROFILE_ID,
  isProtectedTerminalEnvironmentName,
  shellStartupModeFamily,
  type NewTerminalCwdPolicy,
  type ResolvedShellProfile,
  type ShellProfileCatalogue,
  type ShellStartupMode,
} from "../shellProfiles/index.js";
import type { WorkspacePanel, WorkspaceState } from "../workspace.js";
import { THIS_SERVER_ENVIRONMENT_ID } from "../workspace.js";
import type { ProjectEnvironmentRouter } from "../projectEnvironment/router.js";
import type { RemoteTerminalLaunch } from "../projectEnvironment/serviceContracts.js";
import { TerminalServiceError } from "./errors.js";
import type { TerminalDimensions, TerminalIdentity } from "./types.js";

const MAX_CWD_LENGTH = 4_096;

export interface ShellProfileLaunchAuthority {
  /** Return one immutable catalogue/settings view for this resolution. */
  readonly catalogue: () => Promise<ShellProfileCatalogue>;
  /** Revalidate and resolve the selected entry on the server immediately before spawn. */
  readonly resolveProfile: (
    profileId: ProtocolId,
    catalogue: ShellProfileCatalogue,
  ) => Promise<ResolvedShellProfile>;
}

export interface TerminalLaunchPathAuthority {
  readonly canonicalDirectory: (path: string) => Promise<string | null>;
  readonly homeDirectory: () => Promise<string | null>;
  readonly isRoot: (path: string) => boolean;
}

export interface TerminalLaunchResolverOptions {
  readonly serverId: ProtocolId;
  readonly profiles: ShellProfileLaunchAuthority;
  readonly workspaceSnapshot: () => WorkspaceState;
	readonly projectEnvironmentRouter?: ProjectEnvironmentRouter;
  readonly observeTerminalCwd?: (sessionId: ProtocolId) => Promise<string | null>;
  readonly pathAuthority?: TerminalLaunchPathAuthority;
  readonly defaultEnvironment?: Readonly<Record<string, string | undefined>>;
  /** Windows environment names are case-insensitive. */
  readonly environmentCaseInsensitive?: boolean;
  /** Host policy for the reserved System default profile. Explicit profile
   * startup modes remain authoritative. */
  readonly systemDefaultStartupMode?: ShellStartupMode;
  readonly now?: () => number;
}

/** Intent accepted from an authenticated terminal-create action. Executables,
 * arguments, environment, and WSL command lines are intentionally absent. */
export interface TerminalLaunchIntent extends TerminalDimensions {
  readonly identity: TerminalIdentity;
  readonly explicitProfileId?: ProtocolId;
  readonly explicitCwd?: string;
  readonly activePanelId?: ProtocolId;
}

export interface TerminalResolvedProfileMetadata {
  readonly id: ProtocolId;
  readonly revision: number;
  readonly name: string;
  readonly targetSummary: string;
  readonly icon?: string;
  readonly color?: string;
}

/** Immutable, server-resolved input to the PTY service. Environment values are
 * deliberately absent from session/workspace metadata and protocol results. */
export interface TerminalResolvedLaunch extends TerminalDimensions {
  readonly identity: TerminalIdentity;
	readonly projectEnvironmentId: ProtocolId;
	readonly environmentRevision: number;
  readonly workspaceRevision: number;
  readonly settingsRevision: number;
  readonly profile: TerminalResolvedProfileMetadata;
  readonly shellPath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly createdAt: number;
}

export class TerminalLaunchResolver {
  private readonly pathAuthority: TerminalLaunchPathAuthority;
  private readonly now: () => number;

  constructor(private readonly options: TerminalLaunchResolverOptions) {
    if (typeof options.serverId !== "string" || options.serverId.length === 0) {
      throw new TypeError("terminal launch resolver server id is required");
    }
    this.pathAuthority = options.pathAuthority ?? nodeTerminalLaunchPathAuthority;
    this.now = options.now ?? (() => Date.now());
  }

  async resolve(intent: TerminalLaunchIntent): Promise<TerminalResolvedLaunch> {
    if (intent.identity.serverId !== this.options.serverId) {
      throw new TerminalServiceError("forbidden", "terminal belongs to another server");
    }
    const workspace = this.options.workspaceSnapshot();
    if (workspace.serverId !== this.options.serverId) {
      throw new TerminalServiceError("forbidden", "workspace belongs to another server");
    }
    const project = workspace.projects[intent.identity.projectId];
    if (project === undefined) {
      throw new TerminalServiceError("invalid_identity", "terminal project is unavailable");
    }
	if (project.projectEnvironmentId !== undefined && project.projectEnvironmentId !== THIS_SERVER_ENVIRONMENT_ID) {
		if (this.options.projectEnvironmentRouter === undefined)
			throw new TerminalServiceError('service_shutdown', 'Project environment launch routing is unavailable.');
		const remote = await this.options.projectEnvironmentRouter.invoke<RemoteTerminalLaunch>(
			project.id,
			'terminal',
			'resolve-launch',
			{
				...(intent.explicitProfileId === undefined ? {} : { profileId: intent.explicitProfileId }),
				...(intent.explicitCwd === undefined ? {} : { cwd: intent.explicitCwd }),
				...(intent.activePanelId === undefined ? {} : { activePanelId: intent.activePanelId }),
				cols: intent.cols,
				rows: intent.rows,
			},
		);
		return remoteTerminalLaunch(intent, project, workspace.revision, remote, this.now());
	}
    const catalogue = await this.options.profiles.catalogue();
    const selectedProfileId = intent.explicitProfileId
      ?? project.defaultShellProfileId
      ?? catalogue.defaultProfileId
      ?? SYSTEM_SHELL_PROFILE_ID;
    let resolvedProfile: ResolvedShellProfile;
    try {
      resolvedProfile = await this.options.profiles.resolveProfile(selectedProfileId, catalogue);
    } catch (error) {
      throw boundedProfileError(error, selectedProfileId);
    }
    const cwd = await this.resolveCwd(
      catalogue.cwdPolicy,
      workspace,
      intent.identity.projectId,
      intent.explicitCwd,
      intent.activePanelId,
    );
    assertWslLaunchCanRepresentProfile(resolvedProfile);
    const { shellPath, prefixArgs, targetSummary } = executableLaunch(resolvedProfile);
    const startupMode = resolvedProfile.profile.id === SYSTEM_SHELL_PROFILE_ID
      && resolvedProfile.definition.startupMode === "default"
      ? this.options.systemDefaultStartupMode ?? "default"
      : resolvedProfile.definition.startupMode;
    const startupArgs = startupModeArgs(shellPathForMode(resolvedProfile), startupMode);
    const env = applyProfileEnvironment(
      this.options.defaultEnvironment,
      resolvedProfile.definition.environment,
      this.options.environmentCaseInsensitive === true,
    );
    // The PTY is rendered by Terminay's xterm.js surface, not by the terminal
    // (if any) that launched the server process. Never inherit TERM=dumb from
    // Finder, a service manager, CI, or an automation shell.
    setCanonicalEnvironment(env, "TERM", "xterm-256color", this.options.environmentCaseInsensitive === true);
    setCanonicalEnvironment(env, "COLORTERM", "truecolor", this.options.environmentCaseInsensitive === true);
    if (resolvedProfile.target.kind === "wsl") {
      const inheritedWslenv = environmentValue(env, "WSLENV", this.options.environmentCaseInsensitive === true);
      setCanonicalEnvironment(
        env,
        "WSLENV",
        mergeWslenv(inheritedWslenv, resolvedProfile.definition.environment, ["TERM", "COLORTERM"]),
        this.options.environmentCaseInsensitive === true,
      );
    }
    const createdAt = this.now();
    const profile: TerminalResolvedProfileMetadata = Object.freeze({
      id: resolvedProfile.profile.id,
      revision: resolvedProfile.settingsRevision,
      name: resolvedProfile.profile.name,
      targetSummary,
      ...(resolvedProfile.profile.icon === undefined ? {} : { icon: resolvedProfile.profile.icon }),
      ...(resolvedProfile.profile.color === undefined ? {} : { color: resolvedProfile.profile.color }),
    });
    return Object.freeze({
      identity: Object.freeze({ ...intent.identity }),
		projectEnvironmentId: project.projectEnvironmentId ?? THIS_SERVER_ENVIRONMENT_ID,
		environmentRevision: project.environmentRevision ?? 1,
      workspaceRevision: workspace.revision,
      settingsRevision: resolvedProfile.settingsRevision,
      profile,
      shellPath,
      args: Object.freeze([...prefixArgs, ...startupArgs, ...resolvedProfile.definition.args]),
      cwd,
      env: Object.freeze({ ...env }),
      cols: intent.cols,
      rows: intent.rows,
      createdAt,
    });
  }

  private async resolveCwd(
    policy: NewTerminalCwdPolicy,
    workspace: WorkspaceState,
    projectId: ProtocolId,
    explicitCwd: string | undefined,
    activePanelId: ProtocolId | undefined,
  ): Promise<string> {
    if (explicitCwd !== undefined) {
      const canonical = await this.explicitDirectory(explicitCwd);
      if (canonical === null) {
        throw new TerminalServiceError("invalid_cwd", "The requested terminal folder does not exist or is not a directory.");
      }
      return canonical;
    }
    const project = workspace.projects[projectId];
    if (project === undefined) throw new TerminalServiceError("invalid_identity", "terminal project is unavailable");
    if (policy === "home") return this.safeHomeDirectory();
    if (policy === "current" && activePanelId !== undefined) {
      const panel = workspace.panels[activePanelId];
      if (panel !== undefined && panel.projectId !== projectId) {
        throw new TerminalServiceError("forbidden", "The active panel belongs to another project.");
      }
      if (panel?.projectId === projectId) {
        const observed = await this.observedPanelDirectory(panel);
        if (observed !== null && !this.pathAuthority.isRoot(observed)) return observed;
      }
    }
    return this.projectDirectory(project.root, project.rootOrigin);
  }

  private async explicitDirectory(value: string): Promise<string | null> {
    if (!validCwdInput(value)) return null;
    return this.pathAuthority.canonicalDirectory(value);
  }

  private async observedPanelDirectory(panel: WorkspacePanel): Promise<string | null> {
    let candidate: string | null = null;
    if (panel.type === "terminal") {
      candidate = await this.options.observeTerminalCwd?.(panel.sessionId) ?? panel.cwd ?? null;
    } else if (panel.type === "folder") {
      candidate = panel.path;
    } else {
      candidate = dirname(panel.path);
    }
    return candidate === null || !validCwdInput(candidate)
      ? null
      : this.pathAuthority.canonicalDirectory(candidate);
  }

  private async projectDirectory(root: string, rootOrigin: "explicit" | "server-default" | "environment-default" | "legacy-unverified" | undefined): Promise<string> {
    if (!validCwdInput(root) || root === ".") {
      throw new TerminalServiceError("missing_project_root", "The project does not have a usable folder.");
    }
    const canonical = await this.pathAuthority.canonicalDirectory(root);
    if (canonical === null) {
      throw new TerminalServiceError("missing_project_root", "The project folder is missing or inaccessible.");
    }
    if (this.pathAuthority.isRoot(canonical) && rootOrigin !== "explicit" && rootOrigin !== "server-default" && rootOrigin !== "environment-default") {
      throw new TerminalServiceError(
        "unsafe_legacy_root",
        "This legacy project points at a filesystem root. Confirm or change the project folder before opening a terminal.",
      );
    }
    // A filesystem root is valid here because the project root is durable,
    // explicit project state rather than an implicit process-directory fallback.
    return canonical;
  }

  private async safeHomeDirectory(): Promise<string> {
    const home = await this.pathAuthority.homeDirectory();
    if (home === null || this.pathAuthority.isRoot(home)) {
      throw new TerminalServiceError("unsafe_cwd", "A safe server home folder could not be resolved.");
    }
    return home;
  }
}

function remoteTerminalLaunch(intent: TerminalLaunchIntent, project: WorkspaceState['projects'][string], workspaceRevision: number, input: RemoteTerminalLaunch, createdAt: number): TerminalResolvedLaunch {
	if (typeof input !== 'object' || input === null || typeof input.shellPath !== 'string' || input.shellPath.length === 0 || input.shellPath.length > 4096 || typeof input.cwd !== 'string' || !validCwdInput(input.cwd) || !Array.isArray(input.args) || input.args.length > 256 || !input.args.every((value) => typeof value === 'string' && value.length <= 4096))
		throw new TerminalServiceError('spawn_failed', 'Project environment returned an invalid terminal launch.');
	const profile = input.profile;
	if (typeof profile !== 'object' || profile === null || typeof profile.id !== 'string' || typeof profile.revision !== 'number' || typeof profile.name !== 'string' || typeof profile.targetSummary !== 'string')
		throw new TerminalServiceError('spawn_failed', 'Project environment returned invalid shell profile metadata.');
	const env = filterRemoteLaunchEnvironment(input.env ?? {});
	return Object.freeze({
		identity: Object.freeze({ ...intent.identity }), projectEnvironmentId: project.projectEnvironmentId,
		environmentRevision: project.environmentRevision, workspaceRevision,
		settingsRevision: input.settingsRevision ?? profile.revision,
		profile: Object.freeze({ ...profile }), shellPath: input.shellPath,
		args: Object.freeze([...input.args]), cwd: input.cwd, env,
		cols: intent.cols, rows: intent.rows, createdAt,
	});
}

function filterRemoteLaunchEnvironment(input: Readonly<Record<string, string | undefined>>): Readonly<Record<string, string | undefined>> {
	const result: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(input)) {
		const upper = key.toUpperCase();
		if (upper.startsWith('TERMINAY_') || upper.startsWith('MCP_') || upper === 'SSH_AUTH_SOCK' || upper === 'NODE_OPTIONS' || upper === 'GIT_ASKPASS') continue;
		result[key] = value;
	}
	result.TERM = 'xterm-256color'; result.COLORTERM = 'truecolor';
	return Object.freeze(result);
}

export const nodeTerminalLaunchPathAuthority: TerminalLaunchPathAuthority = Object.freeze({
  canonicalDirectory: async (path: string) => {
    if (!validCwdInput(path)) return null;
    try {
      const canonical = await realpath(path);
      return (await stat(canonical)).isDirectory() ? canonical : null;
    } catch {
      return null;
    }
  },
  homeDirectory: async () => {
    const value = homedir();
    if (!validCwdInput(value)) return null;
    try {
      const canonical = await realpath(value);
      return (await stat(canonical)).isDirectory() ? canonical : null;
    } catch {
      return null;
    }
  },
  isRoot: (path: string) => {
    const parsed = parse(path);
    return parsed.root.length > 0 && path === parsed.root;
  },
});

function executableLaunch(profile: ResolvedShellProfile): {
  shellPath: string;
  prefixArgs: readonly string[];
  targetSummary: string;
} {
  if (profile.target.kind === "executable") {
    return {
      shellPath: profile.target.executable,
      prefixArgs: [],
      targetSummary: basename(profile.target.executable),
    };
  }
  const prefixArgs = ["--distribution", profile.target.distribution];
  if (profile.target.shellPath !== undefined) prefixArgs.push("--exec", profile.target.shellPath);
  return {
    shellPath: profile.target.executable,
    prefixArgs,
    targetSummary: profile.target.shellPath === undefined
      ? `WSL · ${profile.target.distribution}`
      : `WSL · ${profile.target.distribution} · ${basename(profile.target.shellPath)}`,
  };
}

function shellPathForMode(profile: ResolvedShellProfile): string {
  return profile.target.kind === "wsl"
    ? profile.target.shellPath ?? ""
    : profile.target.executable;
}

function startupModeArgs(shellPath: string, mode: ShellStartupMode): readonly string[] {
  if (mode === "default") return [];
  const family = shellStartupModeFamily(shellPath);
  if (family === "posix") {
    return mode === "login" ? ["-l"] : [];
  }
  if (family === "powershell") {
    return mode === "login" ? ["-Login"] : [];
  }
  throw new TerminalServiceError(
    "unsupported_startup_mode",
    `The selected profile does not support ${mode} startup mode.`,
  );
}

function applyProfileEnvironment(
  baseline: Readonly<Record<string, string | undefined>> | undefined,
  overlay: Readonly<Record<string, string | null>>,
  caseInsensitive: boolean,
): Record<string, string | undefined> {
  const result = { ...(baseline ?? {}) };
  for (const [key, value] of Object.entries(overlay)) {
    if (isProtectedTerminalEnvironmentName(key)) {
      throw new TerminalServiceError("invalid_environment", "The shell profile contains a protected environment variable.");
    }
    const existingKey = caseInsensitive
      ? Object.keys(result).find((candidate) => candidate.toUpperCase() === key.toUpperCase())
      : key;
    if (value === null) {
      if (existingKey !== undefined) delete result[existingKey];
    } else {
      if (existingKey !== undefined && existingKey !== key) delete result[existingKey];
      result[key] = value;
    }
  }
  return result;
}

function setCanonicalEnvironment(
  environment: Record<string, string | undefined>,
  name: string,
  value: string,
  caseInsensitive: boolean,
): void {
  if (caseInsensitive) {
    for (const candidate of Object.keys(environment)) {
      if (candidate !== name && candidate.toUpperCase() === name) delete environment[candidate];
    }
  }
  environment[name] = value;
}

function environmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  caseInsensitive: boolean,
): string | undefined {
  if (!caseInsensitive) return environment[name];
  const key = Object.keys(environment).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : environment[key];
}

function assertWslLaunchCanRepresentProfile(profile: ResolvedShellProfile): void {
  if (profile.target.kind !== "wsl" || profile.target.shellPath !== undefined) return;
  if (profile.definition.startupMode !== "default" || profile.definition.args.length > 0) {
    throw new TerminalServiceError(
      "unsupported_startup_mode",
      "A WSL profile needs an explicit shell path before startup mode or shell arguments can be configured.",
    );
  }
}

function mergeWslenv(
  inherited: string | undefined,
  overlay: Readonly<Record<string, string | null>>,
  serverManaged: readonly string[] = [],
): string {
  const entries = (inherited ?? "").split(":").filter((entry) => entry.length > 0);
  const names = new Set(entries.map((entry) => entry.split("/")[0]?.toUpperCase()));
  for (const [key, value] of Object.entries(overlay)) {
    if (value === null || names.has(key.toUpperCase())) continue;
    entries.push(key);
    names.add(key.toUpperCase());
  }
  for (const key of serverManaged) {
    if (names.has(key.toUpperCase())) continue;
    entries.push(key);
    names.add(key.toUpperCase());
  }
  return entries.join(":");
}

function boundedProfileError(error: unknown, profileId: string): TerminalServiceError {
  if (error instanceof TerminalServiceError) return error;
  const reason = error instanceof Error && /unavailable/iu.test(error.message)
    ? "profile_unavailable"
    : "profile_not_found";
  return new TerminalServiceError(reason, reason === "profile_unavailable"
    ? `Shell profile ${profileId} is unavailable on this server.`
    : `Shell profile ${profileId} does not exist on this server.`);
}

function validCwdInput(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_CWD_LENGTH && value.indexOf("\0") === -1;
}
