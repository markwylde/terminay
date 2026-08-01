import type { ProtocolId } from "@terminay/protocol";
import type { WorkspaceState } from "./workspace.js";
import { validateWorkspace } from "./workspace.js";

export interface WorkspaceRootStatus {
  readonly projectId: ProtocolId;
  readonly root: string;
  readonly available: boolean;
}

export interface InterruptedSessionStatus {
  readonly sessionId: ProtocolId;
  readonly projectId: ProtocolId;
  readonly interruptedAt?: number;
}

export interface WorkspaceRecoveryReport {
  readonly serverId: ProtocolId;
  readonly missingRoots: readonly WorkspaceRootStatus[];
  readonly interruptedSessions: readonly InterruptedSessionStatus[];
}

export interface WorkspaceRootProbe {
  readonly exists: (root: string, projectId: ProtocolId) => boolean | Promise<boolean>;
}

/**
 * Report recoverability without changing canonical workspace state. Missing
 * roots and interrupted sessions remain represented by their original ids and
 * are never replaced with a renderer/default project or a new PTY session.
 */
export async function reportWorkspaceRecovery(state: WorkspaceState, probe: WorkspaceRootProbe): Promise<WorkspaceRecoveryReport> {
  validateWorkspace(state);
  if (typeof probe?.exists !== "function") throw new TypeError("workspace root probe is required");
  const missingRoots: WorkspaceRootStatus[] = [];
  for (const project of Object.values(state.projects)) {
    if (!(await probe.exists(project.root, project.id))) missingRoots.push({ projectId: project.id, root: project.root, available: false });
  }
  const interruptedSessions: InterruptedSessionStatus[] = [];
  for (const session of Object.values(state.terminalSessions)) {
    if (session.status === "interrupted") interruptedSessions.push({ sessionId: session.id, projectId: session.projectId, ...(session.interruptedAt === undefined ? {} : { interruptedAt: session.interruptedAt }) });
  }
  return Object.freeze({
    serverId: state.serverId,
    missingRoots: Object.freeze(missingRoots),
    interruptedSessions: Object.freeze(interruptedSessions),
  });
}
