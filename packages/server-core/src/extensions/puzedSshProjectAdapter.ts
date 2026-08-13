import { createHash } from "node:crypto";
import type { JsonValue } from "@terminay/protocol";
import type { ProjectEnvironmentRepository } from "../projectEnvironment/repository.js";
import type { ProjectEnvironmentRecord } from "../projectEnvironment/types.js";
import type { WorkspaceStore } from "../workspace.js";
import { SSH_PROVIDER_ID, type CanonicalProjectOpener } from "./puzedSshComposition.js";

/** Commits the composed environment before exposing a project. If workspace
 * creation rejects, the unreferenced environment is compensatingly removed. */
export class RepositoryCanonicalProjectOpener implements CanonicalProjectOpener {
  constructor(private readonly environments: ProjectEnvironmentRepository, private readonly workspace: WorkspaceStore) {}

  async open(input: Parameters<CanonicalProjectOpener["open"]>[0], signal: AbortSignal): Promise<{ projectId: string; environmentId: string }> {
    signal.throwIfAborted();
    let state = await this.environments.load();
    const existing = state.environments[input.environmentId];
    if (existing !== undefined) {
      const project = Object.values(this.workspace.state.projects).find((candidate) => candidate.projectEnvironmentId === input.environmentId);
      if (project !== undefined) return { projectId: project.id, environmentId: input.environmentId };
      assertSameBinding(existing, input);
    } else {
      const environment: ProjectEnvironmentRecord = {
        id: input.environmentId, providerId: SSH_PROVIDER_ID, pinnedRevision: input.sshRevision,
        name: input.displayName, endpointSummary: "Puzed VM over SSH", defaultRoot: input.canonicalRoot,
        declaredCapabilities: ["terminal", "filesystem"], availableCapabilities: ["terminal", "filesystem"], status: "ready",
        lastSuccessfulCheck: Date.now(), operationReferences: [], projectReferenceCount: 0, archived: false, builtIn: false,
        providerState: providerState(input), providerRevision: input.sshRevision,
      };
      state = await this.environments.commit(state.revision, (current) => ({ ...current, environments: { ...current.environments, [environment.id]: environment } }));
    }
    signal.throwIfAborted();
    const projectId = stableId("project", input.environmentId); const viewId = this.workspace.state.viewOrder[0];
    if (viewId === undefined) throw new Error("workspace has no project view");
    const result = this.workspace.apply({ commandId: stableId("open", input.environmentId), expectedRevision: this.workspace.state.revision, command: { type: "project.create", projectId, viewId, projectEnvironmentId: input.environmentId, environmentRevision: input.sshRevision, root: input.canonicalRoot, rootOrigin: "environment-default", name: input.displayName } });
    if (!result.ok) {
      const current = await this.environments.load();
      if (current.environments[input.environmentId]?.projectReferenceCount === 0) await this.environments.commit(current.revision, (value) => ({ ...value, environments: Object.fromEntries(Object.entries(value.environments).filter(([id]) => id !== input.environmentId)) }));
      throw new Error("canonical project creation failed");
    }
    const current = await this.environments.load();
    await this.environments.commit(current.revision, (value) => ({ ...value, environments: { ...value.environments, [input.environmentId]: { ...value.environments[input.environmentId]!, projectReferenceCount: 1 } } }));
    return { projectId, environmentId: input.environmentId };
  }
}

function providerState(input: Parameters<CanonicalProjectOpener["open"]>[0]): JsonValue { return { composition: "puzed-ssh-v1", sshBindingId: input.sshBindingId, sshRevision: input.sshRevision, puzedProfileId: input.puzedProfileId, machineId: input.machineId, root: input.canonicalRoot }; }
function assertSameBinding(environment: ProjectEnvironmentRecord, input: Parameters<CanonicalProjectOpener["open"]>[0]): void { const state = environment.providerState as Record<string, unknown>; if (environment.providerId !== SSH_PROVIDER_ID || state.sshBindingId !== input.sshBindingId || state.machineId !== input.machineId || state.puzedProfileId !== input.puzedProfileId) throw new Error("composed environment identity conflicts with durable state"); }
function stableId(prefix: string, value: string): string { return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`; }
