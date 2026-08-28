import { createHash } from "node:crypto";
import type { AuthenticationBroker, SshChannel, SshClient } from "./transport.js";
import { execRemote } from "./transport.js";
import { SshProviderError } from "./errors.js";
import { assertAbsolute, quotePosix } from "./validation.js";

interface Lease { client: SshClient; release(): void }
interface Pool {
  acquire(profileId: string, revision: number, options: { signal?: AbortSignal; broker?: AuthenticationBroker }): Promise<Lease>;
}

export interface RemoteGitInput {
  profileId: string;
  revision: number;
  root: string;
  authBroker?: AuthenticationBroker;
  payload?: { projectId?: unknown; path?: unknown };
}

const EMPTY_BRANCH = Object.freeze({
  name: null, detached: false, head: null, upstream: null, upstreamState: "none", ahead: null, behind: null,
});

/**
 * Minimal remote Git adapter.  It deliberately executes on the SSH host,
 * never on Terminay Server.  Non-repository roots are a normal result: a new
 * VM opens at its account home before a repository has been cloned there.
 * Query results match Terminay's Git application protocol so the host
 * validator and Git sidebar can treat a missing repository as an empty
 * state instead of a failed load.
 */
export class RemoteGitService {
  constructor(private readonly pool: Pool) {}

  async invoke(operation: string, input: RemoteGitInput, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const root = assertAbsolute(input.root);
    const projectId = projectIdOf(input);
    const probe = await this.run(input, `git -C ${quotePosix(root)} rev-parse --is-inside-work-tree`, signal);
    if (probe.exitCode !== 0 || probe.stdout.trim() !== "true") return notRepository(operation, projectId, pathOf(input));
    const repositoryRootResult = await this.run(input, `git -C ${quotePosix(root)} rev-parse --show-toplevel`, signal);
    const repositoryRoot = repositoryRootResult.exitCode === 0 ? repositoryRootResult.stdout.trim() : root;
    const repositoryId = stableId("repository", repositoryRoot);
    const worktreeId = stableId("worktree", root);
    if (operation === "discover") return { state: "ready", repositoryRoot, repositoryId, worktreeId };
    if (operation === "worktrees") return this.worktrees(input, projectId, repositoryRoot, repositoryId, signal);
    if (operation === "status" || operation === "branches") {
      const branch = await this.branch(input, signal);
      const head = typeof branch.head === "string" ? branch.head : await this.head(input, signal);
      const status = statusResult({ projectId, repositoryId, repositoryRoot, worktreeId, worktreeRoot: root, state: "ready", branch, head });
      return operation === "branches" ? { ...status, operation: "branch" } : status;
    }
    if (operation === "diff") return diffResult({ projectId, repositoryId, worktreeId, state: "ready", path: pathOf(input) });
    throw new SshProviderError("unsupported", "SSH Git operation is unavailable");
  }

  private async worktrees(input: RemoteGitInput, projectId: string, repositoryRoot: string, repositoryId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const listing = await this.run(input, `git -C ${quotePosix(input.root)} worktree list --porcelain`, signal);
    if (listing.exitCode !== 0) return { projectId, repositoryId, repositoryRoot, defaultBranch: null, state: "ready", worktrees: [], bounded: false };
    const records = parseWorktrees(listing.stdout);
    const worktrees = records.slice(0, 256).map((record) => {
      const branch = record.branch?.replace(/^refs\/heads\//u, "") ?? null;
      return {
        id: stableId("worktree", record.path), repositoryId, path: record.path, branch,
        detached: record.detached, head: record.head ?? null, isMain: record.path === repositoryRoot,
        isBare: record.bare, isPrunable: record.prunable, locked: record.locked,
        state: record.detached ? "detached" : "clean", aheadOfDefaultBranchCount: null, lineAdditions: null,
        lineDeletions: null, hasCommittedChanges: null, entries: [],
      };
    });
    const currentBranch = await this.branch(input, signal);
    return { projectId, repositoryId, repositoryRoot, defaultBranch: currentBranch.name, state: "ready", worktrees, bounded: records.length > 256 };
  }

  private async branch(input: RemoteGitInput, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const result = await this.run(input, `git -C ${quotePosix(input.root)} symbolic-ref --quiet --short HEAD`, signal);
    const name = result.exitCode === 0 ? result.stdout.trim() || null : null;
    return { name, detached: name === null, head: await this.head(input, signal), upstream: null, upstreamState: "none", ahead: null, behind: null };
  }

  private async head(input: RemoteGitInput, signal?: AbortSignal): Promise<string | null> {
    const result = await this.run(input, `git -C ${quotePosix(input.root)} rev-parse HEAD`, signal);
    return result.exitCode === 0 ? result.stdout.trim() || null : null;
  }

  private async run(input: RemoteGitInput, command: string, signal?: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    signal?.throwIfAborted();
    const lease = await this.pool.acquire(input.profileId, input.revision, { signal, broker: input.authBroker });
    let channel: SshChannel | undefined;
    try {
      channel = await execRemote(lease.client, command);
      return await collect(channel, signal);
    } catch (error) {
      if (signal?.aborted) throw new SshProviderError("cancelled", "Remote Git operation was cancelled");
      throw error;
    } finally {
      lease.release();
    }
  }
}

function notRepository(operation: string, projectId: string, path: string | null): Record<string, unknown> {
  if (operation === "discover") return { state: "not-repository", repositoryRoot: null, repositoryId: null, worktreeId: null };
  if (operation === "worktrees") return { projectId, repositoryId: null, repositoryRoot: null, defaultBranch: null, state: "not-repository", worktrees: [], bounded: false };
  if (operation === "status") return statusResult({ projectId, repositoryId: null, repositoryRoot: null, worktreeId: null, worktreeRoot: null, state: "not-repository", branch: EMPTY_BRANCH, head: null });
  if (operation === "branches") return { ...statusResult({ projectId, repositoryId: null, repositoryRoot: null, worktreeId: null, worktreeRoot: null, state: "not-repository", branch: EMPTY_BRANCH, head: null }), operation: "branch" };
  if (operation === "diff") return diffResult({ projectId, repositoryId: null, worktreeId: null, state: "not-repository", path });
  throw new SshProviderError("unsupported", "SSH Git operation is unavailable");
}

function statusResult(value: {
  projectId: string; repositoryId: string | null; repositoryRoot: string | null; worktreeId: string | null;
  worktreeRoot: string | null; state: string; branch: Record<string, unknown>; head: string | null;
}): Record<string, unknown> {
  return { ...value, entries: [], bounded: false };
}

function diffResult(value: {
  projectId: string; repositoryId: string | null; worktreeId: string | null; state: string; path: string | null;
}): Record<string, unknown> {
  return { ...value, compareTarget: "HEAD", files: [], hunks: [], patch: "", binary: false, bounded: false };
}

function projectIdOf(input: RemoteGitInput): string {
  return typeof input.payload?.projectId === "string" && input.payload.projectId.length > 0 ? input.payload.projectId : "remote-project";
}

function pathOf(input: RemoteGitInput): string | null {
  return typeof input.payload?.path === "string" && input.payload.path.length > 0 ? input.payload.path : null;
}

function stableId(kind: string, value: string): string { return `${kind}:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`; }

function parseWorktrees(output: string): Array<{ path: string; head?: string; branch?: string; detached: boolean; bare: boolean; prunable: boolean; locked: boolean }> {
  const parsed: Array<{ path: string; head?: string; branch?: string; detached: boolean; bare: boolean; prunable: boolean; locked: boolean }> = [];
  for (const block of output.split(/\n\n+/u)) {
    const lines = block.split(/\r?\n/u); const path = lines.find((line) => line.startsWith("worktree "))?.slice(9);
    if (!path) continue;
    parsed.push({ path, head: lines.find((line) => line.startsWith("HEAD "))?.slice(5), branch: lines.find((line) => line.startsWith("branch "))?.slice(7), detached: lines.includes("detached"), bare: lines.includes("bare"), prunable: lines.some((line) => line.startsWith("prunable")), locked: lines.some((line) => line.startsWith("locked")) });
  }
  return parsed;
}

function collect(channel: SshChannel, signal?: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let bytes = 0; let settled = false;
    const finish = (error?: Error, exitCode: number | null = null): void => {
      if (settled) return; settled = true; signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), exitCode });
    };
    const append = (target: Buffer[], chunk: Uint8Array | string): void => { const value = Buffer.from(chunk); bytes += value.length; if (bytes > 512 * 1024) { channel.end(); finish(new SshProviderError("too-large", "Remote Git response exceeds the limit")); return; } target.push(value); };
    const abort = (): void => { channel.end(); finish(new SshProviderError("cancelled", "Remote Git operation was cancelled")); };
    channel.on("data", (chunk) => append(stdout, chunk));
    channel.stderr?.on("data", (chunk) => append(stderr, chunk));
    channel.once("close", (code) => finish(undefined, Number.isInteger(code) ? code! : null));
    signal?.addEventListener("abort", abort, { once: true });
  });
}
