import type { EnvironmentCapability, JsonValue } from "@terminay/extension-api";
import type { ProjectEnvironmentRuntime, ProjectEnvironmentInvocationContext } from "../projectEnvironment/registry.js";
import type { ProjectEnvironmentCapability, ProjectEnvironmentState } from "../projectEnvironment/types.js";
import type { ExtensionHostManager } from "./manager.js";

const OPERATIONS: Readonly<Record<ProjectEnvironmentCapability, ReadonlySet<string>>> = Object.freeze({
  terminal: new Set(["create", "input", "resize", "read", "kill", "dispose"]),
  filesystem: new Set(["resolveRoot", "browse", "realpath", "stat", "list", "read", "write", "createDirectory", "rename", "remove"]),
  "filesystem-observation": new Set(["observe", "poll", "stop"]),
  git: new Set(["discover", "status", "branches", "worktrees", "diff", "fetch", "quickPush", "cancel"]),
  "process-observation": new Set(["observe", "stop"]),
  "agent-journal": new Set(["observe", "stop"]),
  "mcp-bridge": new Set(["open", "exchange", "close", "revoke"]),
  "shell-discovery": new Set(["list"]),
  infrastructure: new Set<string>(),
});

/** Adapts one registered extension provider into the canonical environment
 * router. Provider state is always loaded from server-owned state, never from
 * a client request, and a revision change fails closed before child IPC. */
export class ExtensionProjectEnvironmentRuntime implements ProjectEnvironmentRuntime {
  constructor(
    readonly providerId: string,
    readonly capabilities: readonly ProjectEnvironmentCapability[],
    private readonly hosts: Pick<ExtensionHostManager, "invokeProvider">,
    private readonly snapshot: () => ProjectEnvironmentState,
  ) {}

  async invoke(capability: ProjectEnvironmentCapability, operation: string, input: unknown, context: ProjectEnvironmentInvocationContext): Promise<unknown> {
    if (!this.capabilities.includes(capability) || !OPERATIONS[capability].has(operation)) throw new Error("provider service operation is unavailable");
    const environment = this.snapshot().environments[context.projectEnvironmentId];
    if (environment === undefined || environment.providerId !== this.providerId || environment.pinnedRevision !== context.environmentRevision || environment.status !== "ready" || environment.archived) throw new Error("project environment binding changed");
    const remaining = Math.max(1, context.deadline - Date.now());
    return this.hosts.invokeProvider({
      providerId: this.providerId,
      callback: "invokeService",
      deadlineMs: remaining,
      signal: context.signal,
      request: {
        environmentId: environment.id,
        ...(environment.profileId === undefined ? {} : { profileId: environment.profileId }),
        providerState: environment.providerState,
        capability: capability as EnvironmentCapability,
        operation,
        projectId: context.projectId,
        environmentRevision: context.environmentRevision,
        input: toJson(input),
      },
    });
  }
}

function toJson(value: unknown): JsonValue {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || Buffer.byteLength(encoded) > 1024 * 1024) throw new TypeError("provider service input is invalid or too large");
  return JSON.parse(encoded) as JsonValue;
}
