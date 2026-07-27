import type { JsonValue, ProtocolId } from "@terminay/protocol";
import type { TerminayClient } from "./client.js";

export interface WorkspaceQueryOptions { readonly signal?: AbortSignal; readonly deadlineMs?: number; }
export interface WorkspaceCommandOptions extends WorkspaceQueryOptions { readonly commandId?: ProtocolId; readonly expectedRevision?: number; }
export interface WorkspaceSnapshotDto { readonly schemaVersion: number; readonly serverId: ProtocolId; readonly revision: number; readonly cursor: string; readonly [key: string]: JsonValue; }
export interface WorkspaceCommandDto { readonly type: string; readonly [key: string]: JsonValue; }

/** Feature-owned workspace facade over the transport-neutral client. It keeps
 * renderer components from inventing operation names or passing titles as
 * authority while the compatibility renderer migrates incrementally. */
export class WorkspaceClient {
  constructor(private readonly client: TerminayClient) {}

  async snapshot(options: WorkspaceQueryOptions = {}): Promise<WorkspaceSnapshotDto> {
    const response = await this.client.query<JsonValue>("workspace.snapshot", {}, options);
    return asSnapshot(response.result);
  }

  async delta(revision: number, cursor: string, options: WorkspaceQueryOptions = {}): Promise<WorkspaceSnapshotDto> {
    const response = await this.client.query<JsonValue>("workspace.delta", { revision, cursor }, options);
    return asSnapshot(response.result);
  }

  async command(command: WorkspaceCommandDto, options: WorkspaceCommandOptions = {}): Promise<JsonValue> {
    const response = await this.client.command("workspace.command", { command }, options);
    return response.result ?? null;
  }
}

function asSnapshot(value: JsonValue | undefined): WorkspaceSnapshotDto {
  if (typeof value !== "object" || value === null || Array.isArray(value) || typeof value.schemaVersion !== "number" || typeof value.serverId !== "string" || typeof value.revision !== "number" || typeof value.cursor !== "string") throw new Error("invalid workspace snapshot");
  return value as WorkspaceSnapshotDto;
}
