import { spawn } from "node:child_process";
import { TextDecoder } from "node:util";
import type {
  GitCommandRunner,
  GitCommandResult,
  GitQuickPushAction,
  GitQuickPushContext,
  GitQuickPushExecutionResult,
  GitQuickPushExecutor,
  GitQuickPushPlan,
  GitQuickPushPlanner,
} from "./types.js";
import { GitServiceError } from "./types.js";
import type { GitService } from "./service.js";
import { NodeGitCommandRunner } from "./runner.js";
import { GitQuickPushService, type GitQuickPushServiceOptions } from "./quickPush.js";

export type GitHostingProvider = "github" | "gitea" | "unknown";

export interface GitRemoteInfo {
  readonly name: string;
  readonly url: string;
  readonly host: string | null;
  readonly owner: string | null;
  readonly repository: string | null;
  readonly webUrl: string | null;
  readonly provider: GitHostingProvider;
}

export interface GitProviderDiscoveryResult {
  readonly projectId: string;
  readonly repositoryId: string;
  readonly worktreeId: string;
  readonly remote: GitRemoteInfo | null;
  readonly pullRequestSupported: boolean;
}

export interface GitProviderDiscoveryRequest {
  readonly projectId: string;
  readonly repositoryId: string;
  readonly worktreeId: string;
  readonly remoteName?: string;
  readonly signal?: AbortSignal;
}

export interface GitProviderPlanner {
  readonly plan: (context: GitQuickPushContext, discovery: GitProviderDiscoveryResult, signal?: AbortSignal) => GitQuickPushPlan | PromiseLike<GitQuickPushPlan>;
}

export interface GitProviderCredentialResolver {
  /** Secret bytes are scoped to the callback and never become a result. */
  readonly withCredential: <T>(provider: string, callback: (secret: Uint8Array) => T | PromiseLike<T>) => Promise<T>;
}

export interface ProviderProcessOptions {
  readonly signal?: AbortSignal;
  readonly maxOutputBytes?: number;
  /** A provider-specific environment variable receives this server-held secret. */
  readonly credential?: Uint8Array;
  readonly credentialEnvironmentVariable?: string;
}

export interface ProviderProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly truncated: boolean;
}

export interface ProviderProcessRunner {
  readonly run: (command: string, args: readonly string[], cwd: string, options?: ProviderProcessOptions) => Promise<ProviderProcessResult>;
}

export interface GitProviderServiceOptions {
  readonly git?: GitCommandRunner;
  readonly provider?: ProviderProcessRunner;
  readonly credentials?: GitProviderCredentialResolver;
  readonly maxOutputBytes?: number;
  readonly pullRequestCommands?: Partial<Record<Exclude<GitHostingProvider, "unknown">, ProviderCommand>>;
}

export interface ProviderCommand {
  readonly command: string;
  readonly credentialEnvironmentVariable?: string;
  readonly args: (request: { readonly targetBranch: string; readonly sourceBranch: string | null; readonly title: string }) => readonly string[];
}

const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

/**
 * Server-only Git remote discovery and Quick Push execution. The client can
 * submit a reviewed action, but it cannot choose an executable, cwd, provider
 * command, or credential. All paths are resolved from opaque server-owned
 * worktree IDs and all returned output is bounded/redacted.
 */
export class GitProviderService {
  private readonly git: GitCommandRunner;
  private readonly provider: ProviderProcessRunner;
  private readonly credentials: GitProviderCredentialResolver | undefined;
  private readonly maxOutputBytes: number;
  private readonly pullRequestCommands: Partial<Record<Exclude<GitHostingProvider, "unknown">, ProviderCommand>>;

  constructor(private readonly service: GitService, options: GitProviderServiceOptions = {}) {
    this.git = options.git ?? new NodeGitCommandRunner();
    this.provider = options.provider ?? new NodeProviderProcessRunner();
    this.credentials = options.credentials;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (!Number.isSafeInteger(this.maxOutputBytes) || this.maxOutputBytes <= 0) throw new RangeError("provider output limit must be positive");
    this.pullRequestCommands = options.pullRequestCommands ?? {
      github: { command: "gh", args: ({ targetBranch, sourceBranch, title }) => ["pr", "create", "--base", targetBranch, ...(sourceBranch === null ? [] : ["--head", sourceBranch]), "--title", title] },
      gitea: { command: "tea", args: ({ targetBranch, sourceBranch, title }) => ["pr", "create", "--base", targetBranch, ...(sourceBranch === null ? [] : ["--head", sourceBranch]), "--title", title] },
    };
  }

  async discover(request: GitProviderDiscoveryRequest): Promise<GitProviderDiscoveryResult> {
    const target = await this.resolveTarget(request);
    const remoteName = request.remoteName ?? "origin";
    assertRemoteName(remoteName);
    const result = await this.git.run(["remote", "get-url", "--", remoteName], target.path, { signal: request.signal, maxOutputBytes: this.maxOutputBytes });
    if (result.exitCode !== 0 || result.truncated) {
      return { projectId: request.projectId, repositoryId: request.repositoryId, worktreeId: request.worktreeId, remote: null, pullRequestSupported: false };
    }
    const url = result.stdout.trim();
    if (url.length === 0) return { projectId: request.projectId, repositoryId: request.repositoryId, worktreeId: request.worktreeId, remote: null, pullRequestSupported: false };
    const remote = parseGitRemote(remoteName, url);
    return { projectId: request.projectId, repositoryId: request.repositoryId, worktreeId: request.worktreeId, remote, pullRequestSupported: remote.provider !== "unknown" && this.pullRequestCommands[remote.provider] !== undefined };
  }

  createPlanner(planner: GitProviderPlanner): GitQuickPushPlanner {
    if (typeof planner?.plan !== "function") throw new TypeError("provider planner is required");
    return { plan: async (context, signal) => planner.plan(context, await this.discover(context), signal) };
  }

  createExecutor(): GitQuickPushExecutor {
    return { execute: (action, context, signal) => this.execute(action, context, signal) };
  }

  /** Compose the transport-neutral review coordinator with these server-only
   * discovery and fixed-command adapters. */
  createQuickPushService(planner: GitProviderPlanner, options: GitQuickPushServiceOptions = {}): GitQuickPushService {
    return new GitQuickPushService(this.service, this.createPlanner(planner), this.createExecutor(), options);
  }

  async execute(action: GitQuickPushAction, context: GitQuickPushContext, signal?: AbortSignal): Promise<GitQuickPushExecutionResult> {
    const target = await this.resolveTarget({ projectId: context.projectId, repositoryId: context.repositoryId, worktreeId: context.worktreeId, signal });
    if (action.kind === "commit") {
      const message = boundedText(action.summary, 512);
      const result = await this.git.run(["add", "--all", "--", "."], target.path, { signal, maxOutputBytes: this.maxOutputBytes });
      if (result.exitCode !== 0 || result.truncated) return failure("commit", result);
      const commit = await this.git.run(["commit", "-m", message], target.path, { signal, maxOutputBytes: this.maxOutputBytes });
      return commit.exitCode === 0 && !commit.truncated ? { applied: true, detail: "commit created" } : failure("commit", commit);
    }
    if (action.kind === "push") {
      const branch = boundedBranch(action.target);
      const push = await this.git.run(["push", "origin", `HEAD:refs/heads/${branch}`], target.path, { signal, maxOutputBytes: this.maxOutputBytes });
      return push.exitCode === 0 && !push.truncated ? { applied: true, detail: "remote branch updated" } : failure("push", push);
    }
    const discovery = await this.discover(context);
    if (discovery.remote === null || !discovery.pullRequestSupported || discovery.remote.provider === "unknown") return { applied: false, detail: "pull-request provider is unavailable for this remote" };
    const command = this.pullRequestCommands[discovery.remote.provider];
    if (command === undefined) return { applied: false, detail: "pull-request provider is unavailable for this remote" };
    const title = boundedText(action.summary, 512);
    const run = (credential: Uint8Array | undefined) => this.provider.run(command.command, command.args({ targetBranch: boundedBranch(action.target), sourceBranch: null, title }), target.path, { signal, maxOutputBytes: this.maxOutputBytes, ...(credential === undefined ? {} : { credential }), ...(command.credentialEnvironmentVariable === undefined ? {} : { credentialEnvironmentVariable: command.credentialEnvironmentVariable }) });
    const result = this.credentials === undefined
      ? await run(undefined)
      : await this.credentials.withCredential(discovery.remote.provider, run);
    return result.exitCode === 0 && !result.truncated ? { applied: true, detail: redactProviderOutput(result.stdout || result.stderr) } : failure("pull-request", result);
  }

  private async resolveTarget(request: GitProviderDiscoveryRequest): Promise<{ readonly path: string }> {
    const listing = await this.service.worktrees({ projectId: request.projectId, repositoryId: request.repositoryId, signal: request.signal });
    if (listing.state !== "ready" || listing.repositoryId !== request.repositoryId) throw new GitServiceError("repository-mismatch", "Git provider target is no longer bound to this project");
    const worktree = listing.worktrees.find((entry) => entry.id === request.worktreeId);
    if (worktree === undefined || worktree.isBare || worktree.isPrunable) throw new GitServiceError("worktree-not-found", "Git provider target worktree is unavailable");
    return { path: worktree.path };
  }
}

export function parseGitRemote(name: string, url: string): GitRemoteInfo {
  assertRemoteName(name);
  if (typeof url !== "string" || url.length === 0 || url.length > 4096 || /[\0\r\n]/u.test(url)) throw new GitServiceError("invalid-project", "Git remote URL is invalid");
  let host: string | null = null;
  let path: string | null = null;
  try {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(url)) {
      const parsed = new URL(url);
      host = parsed.hostname.toLowerCase();
      path = parsed.pathname.replace(/^\/+|\/+$/gu, "");
    } else {
      const match = /^(?:[^@\s]+@)?([^:\s]+):([^\s]+)$/u.exec(url);
      if (match !== null) { host = (match[1] ?? "").toLowerCase(); path = match[2] ?? null; }
    }
  } catch { /* malformed remotes remain discoverable as unknown */ }
  const parts = path?.replace(/\.git$/u, "").split("/").filter(Boolean) ?? [];
  const owner = parts.length >= 2 ? parts.at(-2) ?? null : null;
  const repository = parts.length >= 1 ? parts.at(-1) ?? null : null;
  const provider: GitHostingProvider = host === "github.com" ? "github" : host !== null && /(?:gitea|gitlab|forgejo)/iu.test(host) ? "gitea" : "unknown";
  const webUrl = host !== null && owner !== null && repository !== null && (provider === "github" || provider === "gitea") ? `https://${host}/${owner}/${repository}` : null;
  return { name, url, host, owner, repository, webUrl, provider };
}

function assertRemoteName(value: string): void { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value)) throw new GitServiceError("invalid-project", "Git remote name is invalid"); }
function boundedText(value: string, max: number): string { if (typeof value !== "string" || value.length === 0 || value.length > max || /[\0\r\n]/u.test(value)) throw new GitServiceError("invalid-proposal", "Git provider action text is invalid"); return value; }
function boundedBranch(value: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.startsWith("-") || value.includes("..") || value.includes("@{") || /[\0\r\n\s~^:?*[\\\]]/u.test(value)) throw new GitServiceError("invalid-proposal", "Git provider branch is invalid"); return value; }
function failure(operation: string, result: ProviderProcessResult | GitCommandResult): GitQuickPushExecutionResult { return { applied: false, detail: redactProviderOutput(`${operation} failed${result.stderr.length === 0 ? "" : `: ${result.stderr}`}`) }; }
function redactProviderOutput(value: string): string { return value.replace(/((?:token|secret|password|passphrase|private[_-]?key|api[_-]?key)[=:]\s*)[^\s,;]+/giu, "$1[redacted]").replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gu, "Bearer [redacted]").slice(0, 2048); }

class NodeProviderProcessRunner implements ProviderProcessRunner {
  run(command: string, args: readonly string[], cwd: string, options: ProviderProcessOptions = {}): Promise<ProviderProcessResult> {
    return runProcess(command, args, cwd, options);
  }
}

function runProcess(command: string, args: readonly string[], cwd: string, options: ProviderProcessOptions): Promise<ProviderProcessResult> {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) return Promise.reject(new RangeError("provider output limit must be positive"));
  return new Promise((resolve, reject) => {
    const environment = { ...process.env } as Record<string, string | undefined>;
    let secretName: string | undefined;
    if (options.credential !== undefined) {
      secretName = options.credentialEnvironmentVariable ?? "TERMINAY_PROVIDER_CREDENTIAL";
      environment[secretName] = new TextDecoder().decode(options.credential);
    }
    const child = spawn(command, [...args], { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, signal: options.signal });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    const collect = (target: Buffer[], chunk: Buffer | string) => { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); const remaining = Math.max(0, maxOutputBytes - bytes); if (remaining === 0) { truncated = true; child.kill("SIGTERM"); return; } const kept = value.subarray(0, remaining); target.push(kept); bytes += kept.byteLength; if (kept.byteLength !== value.byteLength) { truncated = true; child.kill("SIGTERM"); } };
    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, chunk));
    child.once("error", (error) => reject(error));
    child.once("close", (exitCode) => {
      if (secretName !== undefined) environment[secretName] = undefined;
      resolve({ stdout: new TextDecoder().decode(Buffer.concat(stdout)), stderr: new TextDecoder().decode(Buffer.concat(stderr)), exitCode: truncated ? null : exitCode, truncated });
    });
  });
}
