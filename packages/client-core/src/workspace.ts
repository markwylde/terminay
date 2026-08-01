import type { JsonValue, ProtocolId } from "@terminay/protocol";
import type { TerminayClient } from "./client.js";
import { ClientError, type ClientCommandResult } from "./types.js";

export interface WorkspaceQueryOptions { readonly signal?: AbortSignal; readonly deadlineMs?: number; }
export interface WorkspaceCommandOptions extends WorkspaceQueryOptions { readonly commandId?: ProtocolId; readonly expectedRevision?: number; }
export interface WorkspaceSnapshotDto { readonly schemaVersion: number; readonly serverId: ProtocolId; readonly revision: number; readonly cursor: string; readonly [key: string]: JsonValue; }
export interface ProjectMoveRequest {
  readonly projectId: string;
  readonly targetViewId: string;
  readonly index?: number;
}
export interface ProjectActivationRequest {
  readonly projectId: string;
}
export interface ProjectMoveResult {
  readonly projectId: string;
  readonly revision: number;
  readonly cursor: string;
}
export interface PanelActivationRequest {
  readonly projectId: string;
  readonly panelId: string;
}
export interface PanelUpdateRequest {
  readonly panelId: string;
  readonly patch: Readonly<{ title?: string; emoji?: string; color?: string; inheritsProjectColor?: boolean; activityIndicatorsEnabled?: boolean }>;
}
export interface ProjectCreateRequest { readonly projectId: string; readonly viewId: string; readonly root: string; readonly name: string; }
export interface PanelCreateRequest { readonly panel: Readonly<{ id: string; projectId: string; type: "file" | "folder"; path: string; createdAt: number; title?: string }> }
export interface PanelMoveRequest { readonly panelId: string; readonly targetProjectId: string; readonly index?: number; }
export interface WorkspaceViewCreateRequest {
  readonly viewId: string;
  readonly name: string;
}
export interface WorkspaceViewCommandResult {
  readonly revision: number;
  readonly cursor: string;
}
export interface ProjectRootUpdateRequest {
  readonly projectId: string;
  readonly root: string;
  readonly expectedRevision?: number;
}
export interface ProjectRootUpdateResult extends WorkspaceViewCommandResult {
  readonly projectId: string;
  readonly root: string;
}
export interface ProjectPresentationUpdateRequest {
  readonly projectId: string;
  readonly name: string;
  readonly root: string;
  readonly color: string;
  readonly icon: string;
}

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
    // A legacy polling projection may have retained an arbitrary cursor string.
    // The protocol only accepts the canonical cursor for the requested server
    // revision, so reject that compatibility shape before it can generate a
    // raw delta request against the connection-owned workspace authority.
    if (!Number.isSafeInteger(revision) || revision < 0 || cursor !== String(revision))
      throw new TypeError("workspace delta cursor is invalid");
    const response = await this.client.query<JsonValue>("workspace.delta", { revision, cursor }, options);
    return asSnapshot(response.result);
  }

  /**
   * Presentation selection is the only workspace mutation the shared route
   * controller may issue directly. Keep the operation name and its authority
   * payload here instead of allowing a renderer to construct a raw
   * `workspace.command` envelope.
   */
  async activatePanel(request: PanelActivationRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
    if (!isBoundedId(request.projectId) || !isBoundedId(request.panelId)) throw new TypeError("panel activation ids are invalid");
    await this.client.command("workspace.command", {
      command: { type: "panel.activate", projectId: request.projectId, panelId: request.panelId },
    }, options);
  }

  async createProject(request: ProjectCreateRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
    if (!isBoundedId(request.projectId) || !isBoundedId(request.viewId) || !boundedPath(request.root) || !boundedLabel(request.name)) throw new TypeError("project create request is invalid");
    await this.client.command("workspace.command", { command: { type: "project.create", ...request } }, options);
  }

  async activateProject(request: ProjectActivationRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
    if (!isBoundedId(request.projectId)) throw new TypeError("project activation id is invalid");
    await this.client.command("workspace.command", { command: { type: "project.activate", projectId: request.projectId } }, options);
  }

  async closeProject(projectId: string, options: WorkspaceCommandOptions = {}): Promise<void> {
    if (!isBoundedId(projectId)) throw new TypeError("project close id is invalid");
    await this.client.command("workspace.command", { command: { type: "project.close", projectId } }, options);
  }

  async createPanel(request: PanelCreateRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
    const panel = request.panel;
    if (!isBoundedId(panel.id) || !isBoundedId(panel.projectId) || (panel.type !== "file" && panel.type !== "folder") || !boundedPath(panel.path) || !Number.isSafeInteger(panel.createdAt) || panel.createdAt < 0 || (panel.title !== undefined && !boundedLabel(panel.title))) throw new TypeError("panel create request is invalid");
    await this.client.command("workspace.command", { command: { type: "panel.create", panel } }, options);
  }

  async movePanel(request: PanelMoveRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
    if (!isBoundedId(request.panelId) || !isBoundedId(request.targetProjectId) || (request.index !== undefined && (!Number.isSafeInteger(request.index) || request.index < 0))) throw new TypeError("panel move request is invalid");
    await this.client.command("workspace.command", { command: { type: "panel.move", ...request } }, options);
  }

  async closePanel(panelId: string, options: WorkspaceCommandOptions = {}): Promise<void> {
    if (!isBoundedId(panelId)) throw new TypeError("panel close id is invalid");
    await this.client.command("workspace.command", { command: { type: "panel.close", panelId } }, options);
  }

  /** Update presentation metadata for one server-owned panel without allowing
   * a renderer to change its identity, project ownership, or panel type. */
  async updatePanel(request: PanelUpdateRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
    if (!isBoundedId(request.panelId) || typeof request.patch !== "object" || request.patch === null || Array.isArray(request.patch)) throw new TypeError("panel update is invalid");
    const patch: Record<string, JsonValue> = {};
    for (const key of ["title", "emoji", "color"] as const) {
      const value = request.patch[key];
      if (value !== undefined) {
        if (typeof value !== "string" || value.length > 512 || value.includes("\0")) throw new TypeError(`panel ${key} is invalid`);
        patch[key] = value;
      }
    }
    for (const key of ["inheritsProjectColor", "activityIndicatorsEnabled"] as const) {
      const value = request.patch[key];
      if (value !== undefined) {
        if (typeof value !== "boolean") throw new TypeError(`panel ${key} is invalid`);
        patch[key] = value;
      }
    }
    if (Object.keys(patch).length === 0) throw new TypeError("panel update patch is empty");
    await this.client.command("workspace.command", { command: { type: "panel.update", panelId: request.panelId, patch } }, options);
  }

  /** Commit a cross-view project move through the authenticated server
   * operation. The compatibility drag adapter can continue carrying its
   * visual/terminal payload after this authority mutation succeeds. */
  async moveProject(request: ProjectMoveRequest, options: WorkspaceCommandOptions = {}): Promise<ProjectMoveResult> {
    if (!isBoundedId(request.projectId) || !isBoundedId(request.targetViewId)) throw new TypeError("project move ids are invalid");
    if (request.index !== undefined && (!Number.isSafeInteger(request.index) || request.index < 0)) throw new TypeError("project move index is invalid");
    const response = await this.client.command<JsonValue>("project.move", {
      projectId: request.projectId,
      targetViewId: request.targetViewId,
      ...(request.index === undefined ? {} : { index: request.index }),
    }, options);
    const result = asMoveResult(response.result);
    // A compatibility drag adapter may retain presentation state while this
    // mutation is in flight, but it never gets to choose a project identity.
    // Bind the server acknowledgement to the typed request before handing it
    // back to a renderer so an incompatible response cannot create a second
    // workspace authority.
    if (result.projectId !== request.projectId) throw new Error("project move response identity is invalid");
    return result;
  }

  /** Canonically rebind one server-owned project and its file services. */
  async updateProjectRoot(request: ProjectRootUpdateRequest, options: WorkspaceCommandOptions = {}): Promise<ProjectRootUpdateResult> {
    if (!isBoundedId(request.projectId) || typeof request.root !== "string" || request.root.length === 0 || request.root.length > 4096 || request.root.includes("\0")) throw new TypeError("project root update request is invalid");
    if (request.expectedRevision !== undefined && (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0)) throw new TypeError("project root expected revision is invalid");
    let response: ClientCommandResult<JsonValue>;
    try {
      response = await this.client.command<JsonValue>("project.root.update", {
        projectId: request.projectId,
        root: request.root,
        ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision }),
      }, options);
    } catch (error) {
      if (error instanceof ClientError && (error.code === "not_found" || error.code === "unavailable")) {
        throw new ClientError("incompatible", "connected server does not support project root updates", { cause: error });
      }
      throw error;
    }
    const result = response.result;
    if (typeof result !== "object" || result === null || Array.isArray(result) || result.projectId !== request.projectId || typeof result.root !== "string" || typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || typeof result.cursor !== "string" || result.cursor !== String(result.revision)) throw new Error("project root update response is invalid");
    return Object.freeze({ projectId: result.projectId, root: result.root, revision: result.revision, cursor: result.cursor });
  }

  async updateProject(request: ProjectPresentationUpdateRequest, options: WorkspaceCommandOptions = {}): Promise<void> {
    if (!isBoundedId(request.projectId) || typeof request.name !== "string" || request.name.trim().length === 0 || request.name.length > 256) throw new TypeError("project name is invalid");
    if (typeof request.root !== "string" || request.root.length === 0 || request.root.length > 4096 || request.root.includes("\0")) throw new TypeError("project root is invalid");
    for (const [name, value] of [["color", request.color], ["icon", request.icon]] as const)
      if (typeof value !== "string" || value.length > 128 || value.includes("\0")) throw new TypeError(`project ${name} is invalid`);
    await this.client.command("workspace.command", {
      command: { type: "project.update", projectId: request.projectId, name: request.name.trim(), root: request.root, color: request.color, icon: request.icon },
    }, options);
  }

  /** Native window compatibility can create a logical view, but it must not
   * regain a generic workspace-command capability. */
  async createView(request: WorkspaceViewCreateRequest, options: WorkspaceCommandOptions = {}): Promise<WorkspaceViewCommandResult> {
    if (!isBoundedId(request.viewId) || !isBoundedName(request.name)) throw new TypeError("workspace view create request is invalid");
    const response = await this.client.command<JsonValue>("workspace.command", {
      command: { type: "view.create", viewId: request.viewId, name: request.name },
    }, options);
    return asWorkspaceViewCommandResult(response.result);
  }

  /** Closing a logical view is a named server operation for the legacy native
   * presentation adapter; it deliberately exposes no generic command method. */
  async closeView(viewId: string, options: WorkspaceCommandOptions = {}): Promise<WorkspaceViewCommandResult> {
    if (!isBoundedId(viewId)) throw new TypeError("workspace view id is invalid");
    const response = await this.client.command<JsonValue>("workspace.command", {
      command: { type: "view.close", viewId },
    }, options);
    return asWorkspaceViewCommandResult(response.result);
  }
}

function asSnapshot(value: JsonValue | undefined): WorkspaceSnapshotDto {
  // workspace.delta returns the store envelope ({ state, events }), whereas
  // workspace.snapshot returns the state directly. The feature facade gives
  // callers one consistent snapshot shape.
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "state" in value) {
    value = value.state as JsonValue;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof value.schemaVersion !== "number" ||
    !Number.isSafeInteger(value.schemaVersion) ||
    value.schemaVersion <= 0 ||
    !isBoundedId(value.serverId) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.cursor !== "string" ||
    value.cursor !== String(value.revision)
  ) throw new Error("invalid workspace snapshot");
  return value as WorkspaceSnapshotDto;
}

function asMoveResult(value: JsonValue | undefined): ProjectMoveResult {
  if (typeof value !== "object" || value === null || Array.isArray(value) || typeof value.projectId !== "string" || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || typeof value.cursor !== "string") throw new Error("invalid project move result");
  return value as unknown as ProjectMoveResult;
}

function asWorkspaceViewCommandResult(value: JsonValue | undefined): WorkspaceViewCommandResult {
  if (typeof value !== "object" || value === null || Array.isArray(value) || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.cursor !== "string" || value.cursor !== String(value.revision)) throw new Error("invalid workspace view command result");
  return Object.freeze({ revision: value.revision, cursor: value.cursor });
}

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function isBoundedName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128 && ![...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function boundedPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && !value.includes("\0");
}

function boundedLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512 && !value.includes("\0");
}
