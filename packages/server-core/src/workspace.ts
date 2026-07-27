import type { JsonValue, ProtocolId } from "@terminay/protocol";

export const WORKSPACE_SCHEMA_VERSION = 1;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type PanelType = "terminal" | "file" | "folder";
export type TerminalStatus = "running" | "exited" | "interrupted";
export type SplitDirection = "horizontal" | "vertical";

export interface PanelBase { readonly id: ProtocolId; readonly projectId: ProtocolId; readonly type: PanelType; readonly title?: string; readonly createdAt: number; }
export interface TerminalPanel extends PanelBase { readonly type: "terminal"; readonly sessionId: ProtocolId; readonly cwd?: string; }
export interface FilePanel extends PanelBase { readonly type: "file"; readonly path: string; readonly mode?: string; }
export interface FolderPanel extends PanelBase { readonly type: "folder"; readonly path: string; readonly expanded?: boolean; }
export type WorkspacePanel = TerminalPanel | FilePanel | FolderPanel;

export interface StackLayout { readonly kind: "stack"; readonly panelIds: readonly ProtocolId[]; readonly activePanelId?: ProtocolId; }
export interface SplitLayout { readonly kind: "split"; readonly direction: SplitDirection; readonly weight: number; readonly first: LayoutNode; readonly second: LayoutNode; }
export type LayoutNode = StackLayout | SplitLayout;

export interface WorkspaceView { readonly id: ProtocolId; readonly serverId: ProtocolId; readonly name: string; readonly projectIds: readonly ProtocolId[]; readonly activeProjectId?: ProtocolId; }
export interface WorkspaceProject { readonly id: ProtocolId; readonly serverId: ProtocolId; readonly viewId: ProtocolId; readonly root: string; readonly name: string; readonly color?: string; readonly icon?: string; readonly panelIds: readonly ProtocolId[]; readonly activePanelId?: ProtocolId; readonly layout: LayoutNode; }
export interface TerminalSession { readonly id: ProtocolId; readonly serverId: ProtocolId; readonly projectId: ProtocolId; readonly status: TerminalStatus; readonly createdAt: number; readonly outputPosition: number; readonly exitCode?: number; readonly interruptedAt?: number; }

export interface WorkspaceState {
  readonly schemaVersion: number;
  readonly serverId: ProtocolId;
  readonly revision: number;
  readonly cursor: string;
  readonly viewOrder: readonly ProtocolId[];
  readonly views: Readonly<Record<ProtocolId, WorkspaceView>>;
  readonly projects: Readonly<Record<ProtocolId, WorkspaceProject>>;
  readonly panels: Readonly<Record<ProtocolId, WorkspacePanel>>;
  readonly terminalSessions: Readonly<Record<ProtocolId, TerminalSession>>;
}

/** Return the exact persisted workspace shape. Runtime callers may receive
 * objects assembled by older renderers or host adapters with transient UI
 * fields attached; those fields are deliberately discarded before a snapshot
 * can cross the repository boundary. Terminal output, modal/hover/drag state,
 * search text, and native window geometry have no representation here. */
export function canonicalizeWorkspaceState(state: WorkspaceState): WorkspaceState {
  validateWorkspace(state);
  const views: Record<string, WorkspaceView> = {};
  for (const [id, view] of Object.entries(state.views)) {
    views[id] = {
      id: view.id,
      serverId: view.serverId,
      name: view.name,
      projectIds: [...view.projectIds],
      ...(view.activeProjectId === undefined ? {} : { activeProjectId: view.activeProjectId }),
    };
  }
  const projects: Record<string, WorkspaceProject> = {};
  for (const [id, project] of Object.entries(state.projects)) {
    projects[id] = {
      id: project.id,
      serverId: project.serverId,
      viewId: project.viewId,
      root: project.root,
      name: project.name,
      ...(project.color === undefined ? {} : { color: project.color }),
      ...(project.icon === undefined ? {} : { icon: project.icon }),
      panelIds: [...project.panelIds],
      ...(project.activePanelId === undefined ? {} : { activePanelId: project.activePanelId }),
      layout: canonicalizeLayout(project.layout),
    };
  }
  const panels: Record<string, WorkspacePanel> = {};
  for (const [id, panel] of Object.entries(state.panels)) {
    const base = {
      id: panel.id,
      projectId: panel.projectId,
      type: panel.type,
      ...(panel.title === undefined ? {} : { title: panel.title }),
      createdAt: panel.createdAt,
    };
    if (panel.type === "terminal") panels[id] = { ...base, type: "terminal", sessionId: panel.sessionId, ...(panel.cwd === undefined ? {} : { cwd: panel.cwd }) };
    else if (panel.type === "file") panels[id] = { ...base, type: "file", path: panel.path, ...(panel.mode === undefined ? {} : { mode: panel.mode }) };
    else panels[id] = { ...base, type: "folder", path: panel.path, ...(panel.expanded === undefined ? {} : { expanded: panel.expanded }) };
  }
  const terminalSessions: Record<string, TerminalSession> = {};
  for (const [id, session] of Object.entries(state.terminalSessions)) {
    terminalSessions[id] = {
      id: session.id,
      serverId: session.serverId,
      projectId: session.projectId,
      status: session.status,
      createdAt: session.createdAt,
      outputPosition: session.outputPosition,
      ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
      ...(session.interruptedAt === undefined ? {} : { interruptedAt: session.interruptedAt }),
    };
  }
  const result: WorkspaceState = {
    schemaVersion: state.schemaVersion,
    serverId: state.serverId,
    revision: state.revision,
    cursor: state.cursor,
    viewOrder: [...state.viewOrder],
    views,
    projects,
    panels,
    terminalSessions,
  };
  validateWorkspace(result);
  return result;
}

function canonicalizeLayout(node: LayoutNode): LayoutNode {
  if (node.kind === "stack") return { kind: "stack", panelIds: [...node.panelIds], ...(node.activePanelId === undefined ? {} : { activePanelId: node.activePanelId }) };
  return { kind: "split", direction: node.direction, weight: node.weight, first: canonicalizeLayout(node.first), second: canonicalizeLayout(node.second) };
}
type MutableWorkspaceState = {
  schemaVersion: number;
  serverId: ProtocolId;
  revision: number;
  cursor: string;
  viewOrder: ProtocolId[];
  views: Record<ProtocolId, WorkspaceView>;
  projects: Record<ProtocolId, WorkspaceProject>;
  panels: Record<ProtocolId, WorkspacePanel>;
  terminalSessions: Record<ProtocolId, TerminalSession>;
};

export type WorkspaceCommand =
  | { readonly type: "view.create"; readonly viewId: ProtocolId; readonly name: string }
  | { readonly type: "view.rename"; readonly viewId: ProtocolId; readonly name: string }
  | { readonly type: "view.close"; readonly viewId: ProtocolId }
  | { readonly type: "project.create"; readonly projectId: ProtocolId; readonly viewId: ProtocolId; readonly root: string; readonly name: string }
  | { readonly type: "project.rename"; readonly projectId: ProtocolId; readonly name: string }
  | { readonly type: "project.move"; readonly projectId: ProtocolId; readonly targetViewId: ProtocolId; readonly index?: number }
  | { readonly type: "project.close"; readonly projectId: ProtocolId }
  | { readonly type: "panel.create"; readonly panel: WorkspacePanel }
  | { readonly type: "panel.update"; readonly panelId: ProtocolId; readonly patch: JsonValue }
  | { readonly type: "panel.reorder"; readonly projectId: ProtocolId; readonly panelIds: readonly ProtocolId[] }
  | { readonly type: "panel.split"; readonly projectId: ProtocolId; readonly panelId: ProtocolId; readonly direction: SplitDirection; readonly weight?: number }
  | { readonly type: "panel.activate"; readonly projectId: ProtocolId; readonly panelId: ProtocolId }
  | { readonly type: "panel.move"; readonly panelId: ProtocolId; readonly targetProjectId: ProtocolId; readonly index?: number }
  | { readonly type: "panel.close"; readonly panelId: ProtocolId }
  | { readonly type: "terminal.create"; readonly sessionId: ProtocolId; readonly projectId: ProtocolId; readonly createdAt?: number }
  | { readonly type: "terminal.markInterrupted"; readonly sessionId: ProtocolId; readonly at?: number };

export interface WorkspaceCommandEnvelope { readonly commandId: ProtocolId; readonly expectedRevision?: number; readonly command: WorkspaceCommand; }
export interface WorkspaceConflict { readonly code: "conflict"; readonly currentRevision: number; readonly currentCursor: string; readonly message: string; }
export interface WorkspaceEvent { readonly revision: number; readonly cursor: string; readonly commandId: ProtocolId; readonly type: WorkspaceCommand["type"]; readonly changedIds: readonly ProtocolId[]; }
export interface WorkspaceSnapshot { readonly state: WorkspaceState; readonly events: readonly WorkspaceEvent[]; }
export type WorkspaceApplyResult = { readonly ok: true; readonly revision: number; readonly cursor: string; readonly event: WorkspaceEvent; readonly state: WorkspaceState } | { readonly ok: false; readonly conflict: WorkspaceConflict };

export function createInitialWorkspace(serverId: ProtocolId): WorkspaceState {
  assertId(serverId, "serverId");
  const viewId = `${serverId}:view:default`.slice(0, 128);
  const view: WorkspaceView = { id: viewId, serverId, name: "Workspace", projectIds: [] };
  return { schemaVersion: WORKSPACE_SCHEMA_VERSION, serverId, revision: 0, cursor: "0", viewOrder: [viewId], views: { [viewId]: view }, projects: {}, panels: {}, terminalSessions: {} };
}

export function validateWorkspace(state: WorkspaceState): void {
  assertId(state.serverId, "serverId");
  if (state.schemaVersion !== WORKSPACE_SCHEMA_VERSION || !Number.isSafeInteger(state.revision) || state.revision < 0 || state.cursor !== String(state.revision)) throw new TypeError("invalid workspace revision/schema");
  const viewIds = new Set(state.viewOrder);
  if (viewIds.size !== state.viewOrder.length || state.viewOrder.some((id) => state.views[id] === undefined)) throw new TypeError("invalid view order");
  for (const [id, view] of Object.entries(state.views)) {
    assertId(id, "viewId"); if (view.id !== id || view.serverId !== state.serverId) throw new TypeError("view crosses server boundary");
    if (view.projectIds.some((projectId) => state.projects[projectId]?.viewId !== id)) throw new TypeError("view/project ownership mismatch");
    if (view.activeProjectId !== undefined && !view.projectIds.includes(view.activeProjectId)) throw new TypeError("active project is outside view");
  }
  for (const [id, project] of Object.entries(state.projects)) {
    assertId(id, "projectId"); if (project.id !== id || project.serverId !== state.serverId || state.views[project.viewId] === undefined) throw new TypeError("project crosses server/view boundary");
    if (project.panelIds.some((panelId) => state.panels[panelId]?.projectId !== id)) throw new TypeError("project/panel ownership mismatch");
    if (project.activePanelId !== undefined && !project.panelIds.includes(project.activePanelId)) throw new TypeError("active panel is outside project");
    validateLayout(project.layout, new Set(project.panelIds));
  }
  for (const [id, panel] of Object.entries(state.panels)) {
    assertId(id, "panelId"); if (panel.id !== id || state.projects[panel.projectId] === undefined) throw new TypeError("panel crosses project boundary");
    if (panel.type === "terminal" && state.terminalSessions[panel.sessionId]?.projectId !== panel.projectId) throw new TypeError("terminal panel/session ownership mismatch");
  }
  for (const [id, session] of Object.entries(state.terminalSessions)) {
    assertId(id, "sessionId"); if (session.id !== id || session.serverId !== state.serverId || state.projects[session.projectId] === undefined || !Number.isSafeInteger(session.outputPosition) || session.outputPosition < 0) throw new TypeError("invalid terminal session");
  }
}

/** Idempotent migration boundary for the first persisted workspace shape. A
 * legacy v0 snapshot may contain only server identity and project roots; it is
 * upgraded without inventing panels or terminal content. */
export function migrateWorkspaceState(input: unknown, fallbackServerId: ProtocolId): WorkspaceState {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new TypeError("workspace snapshot must be an object");
  const value = input as Record<string, unknown>;
  if (value.schemaVersion === WORKSPACE_SCHEMA_VERSION) { return canonicalizeWorkspaceState(value as unknown as WorkspaceState); }
  if (value.schemaVersion !== 0) throw new Error("unsupported workspace schema");
  const serverId = typeof value.serverId === "string" ? value.serverId : fallbackServerId;
  const result = createInitialWorkspace(serverId);
  const defaultViewId = result.viewOrder[0]; if (defaultViewId === undefined) throw new Error("workspace has no default view");
  const legacyProjects = typeof value.projects === "object" && value.projects !== null && !Array.isArray(value.projects) ? value.projects as Record<string, unknown> : {};
  for (const [id, raw] of Object.entries(legacyProjects)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const project = raw as Record<string, unknown>; if (typeof project.root !== "string") continue;
    const name = typeof project.name === "string" && project.name.length > 0 ? project.name : id;
    const created: WorkspaceProject = { id, serverId, viewId: defaultViewId, root: project.root, name, panelIds: [], layout: stack([]) };
    (result.projects as Record<string, WorkspaceProject>)[id] = created;
    const view = result.views[defaultViewId]; if (view === undefined) throw new Error("default view missing"); (result.views as Record<string, WorkspaceView>)[defaultViewId] = { ...view, projectIds: [...view.projectIds, id], activeProjectId: id };
  }
  validateWorkspace(result); return result;
}

function validateLayout(node: LayoutNode, panelIds: Set<string>): void {
  if (node.kind === "stack") {
    const seen = new Set(node.panelIds); if (seen.size !== node.panelIds.length || node.panelIds.some((id) => !panelIds.has(id)) || (node.activePanelId !== undefined && !seen.has(node.activePanelId))) throw new TypeError("invalid stack layout");
    return;
  }
  if (node.kind !== "split" || !["horizontal", "vertical"].includes(node.direction) || !Number.isFinite(node.weight) || node.weight <= 0 || node.weight >= 1) throw new TypeError("invalid split layout");
  validateLayout(node.first, panelIds); validateLayout(node.second, panelIds);
}

function assertId(value: string, name: string): void { if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TypeError(`invalid ${name}`); }
function clone<T>(value: T): T { return structuredClone(value); }
function indexAt(index: number | undefined, length: number): number { return Math.max(0, Math.min(length, index ?? length)); }
function stack(panelIds: readonly ProtocolId[], activePanelId?: ProtocolId): StackLayout { return { kind: "stack", panelIds: [...panelIds], ...(activePanelId === undefined ? {} : { activePanelId }) }; }

/** In-memory authoritative workspace reducer. Persistence adapters can commit
 * the returned state atomically; no renderer/window identity is involved. */
export class WorkspaceStore {
  private current: MutableWorkspaceState;
  private readonly outcomes = new Map<ProtocolId, WorkspaceApplyResult>();
  private readonly history: WorkspaceEvent[] = [];
  private readonly maxHistory: number;

  constructor(initial: WorkspaceState, options: { readonly maxHistory?: number } = {}) {
    this.current = canonicalizeWorkspaceState(initial) as MutableWorkspaceState; this.maxHistory = options.maxHistory ?? 1024;
    if (!Number.isSafeInteger(this.maxHistory) || this.maxHistory <= 0) throw new RangeError("maxHistory must be positive");
  }

  get state(): WorkspaceState { return clone(this.current); }
  snapshot(): WorkspaceSnapshot { return { state: this.state, events: [] }; }
  delta(afterRevision: number): WorkspaceSnapshot | { readonly state: WorkspaceState; readonly events: readonly WorkspaceEvent[] } {
    if (!Number.isSafeInteger(afterRevision) || afterRevision < 0 || afterRevision > this.current.revision) throw new RangeError("invalid revision");
    const oldest = this.history[0]?.revision;
    if (oldest !== undefined && afterRevision < oldest - 1) return this.snapshot();
    return { state: this.state, events: this.history.filter((event) => event.revision > afterRevision) };
  }

  apply(envelope: WorkspaceCommandEnvelope): WorkspaceApplyResult {
    assertId(envelope.commandId, "commandId");
    const prior = this.outcomes.get(envelope.commandId); if (prior !== undefined) return clone(prior);
    if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== this.current.revision) {
      const conflict: WorkspaceApplyResult = { ok: false, conflict: { code: "conflict", currentRevision: this.current.revision, currentCursor: this.current.cursor, message: "workspace revision is stale" } };
      this.outcomes.set(envelope.commandId, conflict); return clone(conflict);
    }
    const next = clone(this.current) as MutableWorkspaceState; const changedIds: ProtocolId[] = [];
    try { this.reduce(next, envelope.command, changedIds); validateWorkspace(next); }
    catch (error) { const conflict: WorkspaceApplyResult = { ok: false, conflict: { code: "conflict", currentRevision: this.current.revision, currentCursor: this.current.cursor, message: error instanceof Error ? error.message : "workspace command rejected" } }; this.outcomes.set(envelope.commandId, conflict); return clone(conflict); }
    next.revision += 1; next.cursor = String(next.revision); const event: WorkspaceEvent = { revision: next.revision, cursor: next.cursor, commandId: envelope.commandId, type: envelope.command.type, changedIds };
    this.current = next; this.history.push(event); while (this.history.length > this.maxHistory) this.history.shift();
    const result: WorkspaceApplyResult = { ok: true, revision: next.revision, cursor: next.cursor, event, state: clone(next) }; this.outcomes.set(envelope.commandId, result); return clone(result);
  }

  markInterruptedSessions(at = Date.now()): WorkspaceState {
    const next = clone(this.current) as MutableWorkspaceState; const changedIds: ProtocolId[] = [];
    for (const [id, session] of Object.entries(next.terminalSessions)) if (session.status === "running") { next.terminalSessions[id] = { ...session, status: "interrupted", interruptedAt: at }; changedIds.push(id); }
    if (changedIds.length > 0) { next.revision += 1; next.cursor = String(next.revision); const event: WorkspaceEvent = { revision: next.revision, cursor: next.cursor, commandId: "system:restart", type: "terminal.markInterrupted", changedIds }; this.history.push(event); while (this.history.length > this.maxHistory) this.history.shift(); }
    validateWorkspace(next); this.current = next; return this.state;
  }

  private reduce(state: MutableWorkspaceState, command: WorkspaceCommand, changed: ProtocolId[]): void {
    switch (command.type) {
      case "view.create": { assertId(command.viewId, "viewId"); if (state.views[command.viewId] !== undefined) throw new Error("view already exists"); state.views[command.viewId] = { id: command.viewId, serverId: state.serverId, name: boundedName(command.name), projectIds: [] }; state.viewOrder = [...state.viewOrder, command.viewId]; changed.push(command.viewId); break; }
      case "view.rename": { const view = requireView(state, command.viewId); state.views[command.viewId] = { ...view, name: boundedName(command.name) }; changed.push(command.viewId); break; }
      case "view.close": { const view = requireView(state, command.viewId); if (view.projectIds.length > 0) throw new Error("view must be empty before close"); if (state.viewOrder.length <= 1) throw new Error("cannot close the last view"); delete state.views[command.viewId]; state.viewOrder = state.viewOrder.filter((id) => id !== command.viewId); changed.push(command.viewId); break; }
      case "project.create": { assertId(command.projectId, "projectId"); if (state.projects[command.projectId] !== undefined) throw new Error("project already exists"); const view = requireView(state, command.viewId); const project: WorkspaceProject = { id: command.projectId, serverId: state.serverId, viewId: command.viewId, root: boundedPath(command.root), name: boundedName(command.name), panelIds: [], layout: stack([]) }; state.projects[command.projectId] = project; state.views[command.viewId] = { ...view, projectIds: [...view.projectIds, command.projectId], activeProjectId: command.projectId }; changed.push(command.projectId, command.viewId); break; }
      case "project.rename": { const project = requireProject(state, command.projectId); state.projects[command.projectId] = { ...project, name: boundedName(command.name) }; changed.push(command.projectId); break; }
      case "project.move": { const project = requireProject(state, command.projectId); const from = requireView(state, project.viewId); const to = requireView(state, command.targetViewId); state.views[project.viewId] = { ...from, projectIds: from.projectIds.filter((id) => id !== project.id), activeProjectId: from.activeProjectId === project.id ? from.projectIds.find((id) => id !== project.id) : from.activeProjectId }; const ids = to.projectIds.filter((id) => id !== project.id); ids.splice(indexAt(command.index, ids.length), 0, project.id); state.views[command.targetViewId] = { ...to, projectIds: ids, activeProjectId: project.id }; state.projects[project.id] = { ...project, viewId: command.targetViewId }; changed.push(project.id, from.id, to.id); break; }
      case "project.close": { const project = requireProject(state, command.projectId); if (project.panelIds.length > 0) throw new Error("project must be empty before close"); const view = requireView(state, project.viewId); delete state.projects[project.id]; state.views[view.id] = { ...view, projectIds: view.projectIds.filter((id) => id !== project.id), activeProjectId: view.activeProjectId === project.id ? undefined : view.activeProjectId }; changed.push(project.id, view.id); break; }
      case "panel.create": { const panel = command.panel; assertId(panel.id, "panelId"); if (state.panels[panel.id] !== undefined) throw new Error("panel already exists"); const project = requireProject(state, panel.projectId); if (panel.type === "terminal") { const session = state.terminalSessions[panel.sessionId]; if (session === undefined || session.projectId !== panel.projectId) throw new Error("terminal session is outside project"); } state.panels[panel.id] = clone(panel); const ids = [...project.panelIds, panel.id]; state.projects[project.id] = { ...project, panelIds: ids, activePanelId: panel.id, layout: stack(ids, panel.id) }; changed.push(panel.id, project.id); break; }
      case "panel.update": { const panel = requirePanel(state, command.panelId); if (typeof command.patch !== "object" || command.patch === null || Array.isArray(command.patch)) throw new Error("panel patch must be an object"); const patch = command.patch as Record<string, JsonValue>; if ("projectId" in patch || "id" in patch || "type" in patch) throw new Error("panel ownership/type is immutable"); state.panels[panel.id] = { ...panel, ...(patch as Partial<WorkspacePanel>) } as WorkspacePanel; changed.push(panel.id); break; }
      case "panel.reorder": { const project = requireProject(state, command.projectId); if (command.panelIds.length !== project.panelIds.length || new Set(command.panelIds).size !== project.panelIds.length || command.panelIds.some((id) => !project.panelIds.includes(id))) throw new Error("panel reorder crosses project boundary"); state.projects[project.id] = { ...project, panelIds: [...command.panelIds], layout: stack(command.panelIds, project.activePanelId) }; changed.push(project.id, ...command.panelIds); break; }
      case "panel.split": { const project = requireProject(state, command.projectId); if (!project.panelIds.includes(command.panelId)) throw new Error("panel is outside project"); state.projects[project.id] = { ...project, layout: { kind: "split", direction: command.direction, weight: command.weight ?? 0.5, first: stack([command.panelId], command.panelId), second: stack(project.panelIds.filter((id) => id !== command.panelId)) } }; changed.push(project.id, command.panelId); break; }
      case "panel.activate": { const project = requireProject(state, command.projectId); if (!project.panelIds.includes(command.panelId)) throw new Error("panel is outside project"); state.projects[project.id] = { ...project, activePanelId: command.panelId, layout: project.layout.kind === "stack" ? stack(project.panelIds, command.panelId) : project.layout }; changed.push(project.id, command.panelId); break; }
      case "panel.move": { const panel = requirePanel(state, command.panelId); const from = requireProject(state, panel.projectId); const to = requireProject(state, command.targetProjectId); const sourceIds = from.panelIds.filter((id) => id !== panel.id); const targetIds = to.panelIds.filter((id) => id !== panel.id); targetIds.splice(indexAt(command.index, targetIds.length), 0, panel.id); state.projects[from.id] = { ...from, panelIds: sourceIds, activePanelId: from.activePanelId === panel.id ? sourceIds[0] : from.activePanelId, layout: stack(sourceIds) }; state.projects[to.id] = { ...to, panelIds: targetIds, activePanelId: panel.id, layout: stack(targetIds, panel.id) }; state.panels[panel.id] = { ...panel, projectId: to.id } as WorkspacePanel; if (panel.type === "terminal") { const session = state.terminalSessions[panel.sessionId]; if (session === undefined) throw new Error("terminal session not found"); state.terminalSessions[panel.sessionId] = { ...session, projectId: to.id }; } changed.push(panel.id, from.id, to.id); break; }
      case "panel.close": { const panel = requirePanel(state, command.panelId); const project = requireProject(state, panel.projectId); delete state.panels[panel.id]; state.projects[project.id] = { ...project, panelIds: project.panelIds.filter((id) => id !== panel.id), activePanelId: project.activePanelId === panel.id ? undefined : project.activePanelId, layout: stack(project.panelIds.filter((id) => id !== panel.id)) }; changed.push(panel.id, project.id); break; }
      case "terminal.create": { assertId(command.sessionId, "sessionId"); if (state.terminalSessions[command.sessionId] !== undefined) throw new Error("terminal session already exists"); const project = requireProject(state, command.projectId); state.terminalSessions[command.sessionId] = { id: command.sessionId, serverId: state.serverId, projectId: project.id, status: "running", createdAt: command.createdAt ?? Date.now(), outputPosition: 0 }; changed.push(command.sessionId, project.id); break; }
      case "terminal.markInterrupted": { const session = state.terminalSessions[command.sessionId]; if (session === undefined) throw new Error("terminal session not found"); if (session.status === "running") state.terminalSessions[session.id] = { ...session, status: "interrupted", interruptedAt: command.at ?? Date.now() }; changed.push(session.id); break; }
    }
  }
}

function boundedName(value: string): string { if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) throw new Error("name is invalid"); return value.trim(); }
function boundedPath(value: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.includes("\0")) throw new Error("root/path is invalid"); return value; }
function requireView(state: WorkspaceState, id: ProtocolId): WorkspaceView { assertId(id, "viewId"); const value = state.views[id]; if (value === undefined) throw new Error("view not found"); return value; }
function requireProject(state: WorkspaceState, id: ProtocolId): WorkspaceProject { assertId(id, "projectId"); const value = state.projects[id]; if (value === undefined) throw new Error("project not found"); return value; }
function requirePanel(state: WorkspaceState, id: ProtocolId): WorkspacePanel { assertId(id, "panelId"); const value = state.panels[id]; if (value === undefined) throw new Error("panel not found"); return value; }
