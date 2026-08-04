import type { JsonValue } from "@terminay/protocol";
import type { GitStatusChangeEvent } from "./git.js";
import { createHostCapabilityProvider } from "./host.js";
import type {
  ClientEvent,
  CommandOptions,
  HostCapabilityProvider,
  HostCapabilitySet,
  QueryOptions,
} from "./types.js";

export const GIT_CLIENT_OPERATIONS = Object.freeze({
  status: "git.status",
  branch: "git.branch",
  diff: "git.diff",
  listWorktrees: "git.worktrees.list",
  openTerminal: "git.worktree.open-terminal",
  switchProject: "git.worktree.switch-project",
  renamePresentation: "git.worktree.rename",
  reveal: "git.worktree.reveal",
  copy: "git.worktree.copy",
  pull: "git.worktree.pull",
  remove: "git.worktree.remove",
  move: "git.worktree.move",
  quickPushPropose: "git.quick-push.propose",
  quickPushApprove: "git.quick-push.approve",
} as const);

export interface GitClientTransport {
  readonly query: <T extends JsonValue = JsonValue>(operation: string, payload?: JsonValue, options?: QueryOptions) => Promise<T>;
  readonly command: <T extends JsonValue = JsonValue>(operation: string, payload?: JsonValue, options?: CommandOptions) => Promise<T>;
  readonly subscribeClientEvents?: <T extends JsonValue = JsonValue>(event: string, listener: (message: ClientEvent<T>) => void, onResync?: () => void) => Promise<() => void>;
}

export interface GitClientHostOptions {
  readonly capabilities?: HostCapabilitySet | HostCapabilityProvider;
}

export interface GitWorktreeReference {
  readonly projectId: string;
  readonly repositoryId: string;
  readonly worktreeId: string;
}

export interface GitQuickPushProposalRequest extends GitWorktreeReference {
  readonly provider: string;
  readonly targetBranch?: string;
}

export interface GitQuickPushApprovalRequest {
  readonly proposalId: string;
  readonly revision: JsonValue;
  readonly actionDigest: string;
}

/**
 * Feature-facing Git client. It sends only canonical identities and reviewed
 * action data to the server; paths and provider credentials are never inputs
 * to this API. Native reveal and clipboard copy fail before transport use
 * when the current host cannot perform the requested presentation action.
 */
export class TerminayGitClient {
  readonly host: HostCapabilityProvider;

  constructor(private readonly transport: GitClientTransport, options: GitClientHostOptions = {}) {
    this.host = createHostCapabilityProvider(options.capabilities ?? {});
  }

  list(request: { readonly projectId?: string; readonly repositoryId?: string } = {}, options: QueryOptions = {}): Promise<JsonValue> {
    return this.transport.query(GIT_CLIENT_OPERATIONS.listWorktrees, boundedObject(request, "Git worktree list"), options);
  }

  subscribeStatusChanges(listener: (event: GitStatusChangeEvent) => void, onResync?: () => void): Promise<() => void> {
    if (typeof this.transport.subscribeClientEvents !== "function") throw new Error("Git status subscriptions are unavailable on this transport");
    return this.transport.subscribeClientEvents("git.status.changed", (message) => listener(validateStatusChangeEvent(message.payload)), onResync);
  }

  status(reference: Partial<GitWorktreeReference> & { readonly projectId: string }, options: QueryOptions = {}): Promise<JsonValue> {
    return this.read(GIT_CLIENT_OPERATIONS.status, reference, options);
  }

  branch(reference: Partial<GitWorktreeReference> & { readonly projectId: string }, options: QueryOptions = {}): Promise<JsonValue> {
    return this.read(GIT_CLIENT_OPERATIONS.branch, reference, options);
  }

  diff(reference: Partial<GitWorktreeReference> & { readonly projectId: string; readonly path?: string }, options: QueryOptions = {}): Promise<JsonValue> {
    const value = this.readReference(reference);
    const path = reference.path === undefined ? undefined : boundedRelativePath(reference.path);
    return this.transport.query(GIT_CLIENT_OPERATIONS.diff, { ...value, ...(path === undefined ? {} : { path }) }, options);
  }

  openTerminal(reference: GitWorktreeReference, options: CommandOptions = {}): Promise<JsonValue> {
    this.host.require("nativeWindows");
    return this.action(GIT_CLIENT_OPERATIONS.openTerminal, reference, options);
  }

  switchProject(reference: GitWorktreeReference, options: CommandOptions = {}): Promise<JsonValue> {
    this.host.require("nativeWindows");
    return this.action(GIT_CLIENT_OPERATIONS.switchProject, reference, options);
  }

  renamePresentation(reference: GitWorktreeReference, name: string, options: CommandOptions = {}): Promise<JsonValue> {
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 256 || /[\0\r\n]/u.test(name)) throw new TypeError("worktree presentation name is invalid");
    return this.transport.command(GIT_CLIENT_OPERATIONS.renamePresentation, { ...validatedReference(reference), name }, options);
  }

  reveal(reference: GitWorktreeReference, options: CommandOptions = {}): Promise<JsonValue> {
    this.host.require("nativeWindows");
    return this.action(GIT_CLIENT_OPERATIONS.reveal, reference, options);
  }

  copy(reference: GitWorktreeReference, options: CommandOptions = {}): Promise<JsonValue> {
    this.host.require("clipboard");
    return this.action(GIT_CLIENT_OPERATIONS.copy, reference, options);
  }

  pull(reference: GitWorktreeReference, options: CommandOptions = {}): Promise<JsonValue> {
    return this.action(GIT_CLIENT_OPERATIONS.pull, reference, options);
  }

  remove(reference: GitWorktreeReference, expectedHead?: string | null, options: CommandOptions = {}): Promise<JsonValue> {
    const value = validatedReference(reference);
    return this.transport.command(GIT_CLIENT_OPERATIONS.remove, { ...value, ...(expectedHead === undefined ? {} : { expectedHead: boundedHead(expectedHead) }) }, options);
  }

  move(reference: GitWorktreeReference, name: string, expectedHead?: string | null, options: CommandOptions = {}): Promise<JsonValue> {
    const value = validatedReference(reference);
    if (typeof name !== "string" || name.length === 0 || name.length > 255 || name === "." || name === ".." || name.trim() !== name || /[/\\\0\r\n]/u.test(name)) throw new TypeError("worktree directory name is invalid");
    return this.transport.command(GIT_CLIENT_OPERATIONS.move, { ...value, name, ...(expectedHead === undefined ? {} : { expectedHead: boundedHead(expectedHead) }) }, options);
  }

  proposeQuickPush(request: GitQuickPushProposalRequest, options: CommandOptions = {}): Promise<JsonValue> {
    const value = validatedReference(request);
    const provider = boundedToken(request.provider, "provider", 64);
    const targetBranch = request.targetBranch === undefined ? undefined : boundedBranch(request.targetBranch);
    return this.transport.command(GIT_CLIENT_OPERATIONS.quickPushPropose, { ...value, provider, ...(targetBranch === undefined ? {} : { targetBranch }) }, options);
  }

  approveQuickPush(request: GitQuickPushApprovalRequest, options: CommandOptions = {}): Promise<JsonValue> {
    if (typeof request !== "object" || request === null || Array.isArray(request)) throw new TypeError("Quick Push approval is invalid");
    const proposalId = boundedToken(request.proposalId, "proposalId", 128);
    const actionDigest = boundedToken(request.actionDigest, "actionDigest", 128);
    if (typeof request.revision !== "object" || request.revision === null || Array.isArray(request.revision)) throw new TypeError("Quick Push revision is invalid");
    return this.transport.command(GIT_CLIENT_OPERATIONS.quickPushApprove, { proposalId, revision: request.revision, actionDigest }, options);
  }

  private action(operation: string, reference: GitWorktreeReference, options: CommandOptions): Promise<JsonValue> {
    return this.transport.command(operation, validatedReference(reference) as unknown as JsonValue, options);
  }

  private read(operation: string, reference: Partial<GitWorktreeReference> & { readonly projectId: string }, options: QueryOptions): Promise<JsonValue> {
    return this.transport.query(operation, this.readReference(reference) as unknown as JsonValue, options);
  }

  private readReference(reference: Partial<GitWorktreeReference> & { readonly projectId: string }): Record<string, string> {
    const projectId = boundedId(reference.projectId, "projectId");
    const repositoryId = reference.repositoryId === undefined ? undefined : boundedId(reference.repositoryId, "repositoryId");
    const worktreeId = reference.worktreeId === undefined ? undefined : boundedId(reference.worktreeId, "worktreeId");
    return { projectId, ...(repositoryId === undefined ? {} : { repositoryId }), ...(worktreeId === undefined ? {} : { worktreeId }) };
  }
}

function validatedReference(reference: GitWorktreeReference): GitWorktreeReference {
  if (typeof reference !== "object" || reference === null || Array.isArray(reference)) throw new TypeError("Git worktree reference is invalid");
  return {
    projectId: boundedId(reference.projectId, "projectId"),
    repositoryId: boundedId(reference.repositoryId, "repositoryId"),
    worktreeId: boundedId(reference.worktreeId, "worktreeId"),
  };
}

function boundedObject(value: Record<string, unknown>, label: string): JsonValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} payload is invalid`);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    result[key] = boundedToken(item, key, 128);
  }
  return result;
}

function boundedToken(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\0\r\n]/u.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function boundedId(value: unknown, label: string): string {
  const token = boundedToken(value, label, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(token)) throw new TypeError(`${label} is invalid`);
  return token;
}

function boundedHead(value: string | null): string | null { return value === null ? null : boundedToken(value, "expectedHead", 256); }
function boundedBranch(value: string): string { const branch = boundedToken(value, "targetBranch", 256); if (branch.startsWith("-") || branch.includes("..") || branch.includes("@{") || /[\s~^:?*[\\\]]/u.test(branch)) throw new TypeError("targetBranch is invalid"); return branch; }
function boundedRelativePath(value: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 4096 || /[\0\r\n]/u.test(value) || value.startsWith("/") || value.split(/[\\/]+/u).some((part) => part === "..")) throw new TypeError("Git diff path is invalid"); return value; }
function validateStatusChangeEvent(value: JsonValue | undefined): GitStatusChangeEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Git status event is invalid");
  const event = value as Record<string, JsonValue | undefined>;
  if (event.type !== "git.status.changed") throw new TypeError("Git status event type is invalid");
  if (typeof event.revision !== "number" || !Number.isSafeInteger(event.revision) || event.revision < 0 || event.cursor !== String(event.revision)) throw new TypeError("Git status event revision is invalid");
  const projectId = boundedId(event.projectId, "projectId");
  const repositoryId = event.repositoryId === null ? null : boundedId(event.repositoryId, "repositoryId");
  const worktreeId = event.worktreeId === null ? null : boundedId(event.worktreeId, "worktreeId");
  const state = event.state;
  if (!["ready", "not-repository", "git-unavailable", "missing-gitfile", "command-error"].includes(String(state))) throw new TypeError("Git status event state is invalid");
  const branch = event.branch === null ? null : boundedToken(event.branch, "branch", 256);
  const head = event.head === null ? null : boundedToken(event.head, "head", 256);
  if (typeof event.changedFiles !== "number" || !Number.isSafeInteger(event.changedFiles) || event.changedFiles < 0 || typeof event.bounded !== "boolean") throw new TypeError("Git status event is invalid");
  return Object.freeze({
    revision: event.revision,
    cursor: event.cursor as string,
    type: "git.status.changed",
    projectId,
    repositoryId,
    worktreeId,
    state: state as GitStatusChangeEvent["state"],
    branch,
    head,
    changedFiles: event.changedFiles,
    bounded: event.bounded,
  });
}
