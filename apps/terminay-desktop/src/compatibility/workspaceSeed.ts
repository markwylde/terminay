import type { JsonValue, ProtocolId } from "@terminay/protocol";
import type { WorkspaceCommandDto } from "@terminay/client-core";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_ITEMS = 4096;

export interface LegacyRendererWorkspaceState {
  readonly serverId?: string;
  readonly views?: unknown;
  readonly workspaceViews?: unknown;
  readonly projects?: unknown;
  readonly panels?: unknown;
  readonly terminalSessions?: unknown;
  /** Legacy window/renderer fields are intentionally ignored. */
  readonly [key: string]: unknown;
}

export interface WorkspaceSeedSnapshot {
  readonly serverId: ProtocolId;
  readonly revision: number;
  readonly views: Readonly<Record<ProtocolId, { readonly id: ProtocolId }>>;
  readonly projects: Readonly<Record<ProtocolId, { readonly id: ProtocolId; readonly viewId: ProtocolId; readonly root?: string; readonly name?: string }>>;
  readonly panels: Readonly<Record<ProtocolId, { readonly id: ProtocolId; readonly projectId: ProtocolId; readonly type: string; readonly sessionId?: ProtocolId }>>;
  readonly terminalSessions: Readonly<Record<ProtocolId, { readonly id: ProtocolId; readonly projectId: ProtocolId; readonly status?: string; readonly createdAt?: number }>>;
}

export interface WorkspaceSeedClient {
  readonly snapshot: () => Promise<unknown>;
  readonly command: (command: WorkspaceCommandDto, options?: { readonly commandId?: ProtocolId; readonly expectedRevision?: number }) => Promise<JsonValue>;
}

export interface WorkspaceSeedOptions {
  readonly serverId?: ProtocolId;
  readonly existingSnapshot?: unknown;
}

export interface WorkspaceSeedResult {
  readonly serverId: ProtocolId;
  readonly commands: readonly WorkspaceCommandDto[];
  readonly committed: number;
  readonly skippedInterruptedSessions: readonly ProtocolId[];
  readonly finalRevision: number;
}

interface LegacyView { readonly id: ProtocolId; readonly name: string; }
interface LegacyProject { readonly id: ProtocolId; readonly viewId: ProtocolId; readonly root: string; readonly name: string; readonly color?: string; readonly icon?: string; readonly panelIds: readonly ProtocolId[]; readonly activePanelId?: ProtocolId; }
interface LegacyPanel { readonly id: ProtocolId; readonly projectId: ProtocolId; readonly type: "terminal" | "file" | "folder"; readonly sessionId?: ProtocolId; readonly path?: string; readonly mode?: string; readonly cwd?: string; readonly expanded?: boolean; readonly createdAt: number; }
interface LegacySession { readonly id: ProtocolId; readonly projectId: ProtocolId; readonly status?: string; readonly createdAt: number; }

/** Build server commands from the legacy renderer model without uploading a
 * replacement workspace or treating a renderer/window id as authority. */
export function buildWorkspaceSeedCommands(legacy: unknown, existing: WorkspaceSeedSnapshot, options: WorkspaceSeedOptions = {}): { readonly commands: readonly WorkspaceCommandDto[]; readonly skippedInterruptedSessions: readonly ProtocolId[] } {
  const source = asRecord(legacy, "legacy workspace");
  const serverId = resolveServerId(source, existing, options.serverId);
  if (existing.serverId !== serverId) throw new Error("legacy workspace belongs to another server");
  const views = normalizeViews(source.views ?? source.workspaceViews);
  const projects = normalizeProjects(source.projects, views, serverId);
  const panels = normalizePanels(source.panels, projects, source.projects);
  const sessions = normalizeSessions(source.terminalSessions, projects);
  const commands: WorkspaceCommandDto[] = [];
  const skippedInterruptedSessions: ProtocolId[] = [];
  const defaultViewId = existingViewId(existing, serverId);

  for (const view of views.values()) {
    if (view.id === defaultViewId || existing.views[view.id] !== undefined) continue;
    commands.push({ type: "view.create", viewId: view.id, name: view.name });
  }
  for (const project of projects.values()) {
    const current = existing.projects[project.id];
    if (current === undefined) commands.push({ type: "project.create", projectId: project.id, viewId: project.viewId, root: project.root, name: project.name });
    else {
      if (current.viewId !== project.viewId) commands.push({ type: "project.move", projectId: project.id, targetViewId: project.viewId });
      if (current.name !== undefined && current.name !== project.name) commands.push({ type: "project.rename", projectId: project.id, name: project.name });
    }
  }

  for (const session of sessions.values()) {
    if (session.status === "interrupted" || session.status === "exited") {
      if (existing.terminalSessions[session.id] === undefined) skippedInterruptedSessions.push(session.id);
      continue;
    }
    if (existing.terminalSessions[session.id] === undefined) commands.push({ type: "terminal.create", sessionId: session.id, projectId: session.projectId, createdAt: session.createdAt });
  }
  for (const panel of panels.values()) {
    const current = existing.panels[panel.id];
    if (current === undefined) {
      if (panel.type === "terminal" && (panel.sessionId === undefined || sessions.get(panel.sessionId)?.status === "interrupted" || sessions.get(panel.sessionId)?.status === "exited")) continue;
      commands.push({ type: "panel.create", panel: panelPayload(panel) });
    } else if (current.projectId !== panel.projectId) {
      commands.push({ type: "panel.move", panelId: panel.id, targetProjectId: panel.projectId });
    }
  }
  for (const project of projects.values()) {
    const ids = project.panelIds.filter((id) => panels.has(id) && (panels.get(id)?.type !== "terminal" || (panels.get(id)?.sessionId !== undefined && sessions.get(panels.get(id)?.sessionId ?? "")?.status !== "interrupted" && sessions.get(panels.get(id)?.sessionId ?? "")?.status !== "exited")));
    if (ids.length > 0) commands.push({ type: "panel.reorder", projectId: project.id, panelIds: ids });
    if (project.activePanelId !== undefined && ids.includes(project.activePanelId)) commands.push({ type: "panel.activate", projectId: project.id, panelId: project.activePanelId });
  }
  return { commands: Object.freeze(commands), skippedInterruptedSessions: Object.freeze(skippedInterruptedSessions) };
}

/** Query the canonical snapshot and commit one bounded command at a time. The
 * expected revision makes moves and adoption server-authorized mutations. */
export async function seedLegacyWorkspace(client: WorkspaceSeedClient, legacy: unknown, options: WorkspaceSeedOptions = {}): Promise<WorkspaceSeedResult> {
  const existing = normalizeExisting(options.existingSnapshot ?? await client.snapshot(), options.serverId);
  const built = buildWorkspaceSeedCommands(legacy, existing, options);
  let revision = existing.revision;
  let committed = 0;
  for (const [index, command] of built.commands.entries()) {
    const result = await client.command(command, { commandId: `legacy-seed:${index}:${command.type}`.slice(0, 128), expectedRevision: revision });
    committed += 1;
    const next = revisionFromResult(result);
    revision = next === undefined ? revision + 1 : next;
  }
  return Object.freeze({ serverId: existing.serverId, commands: built.commands, committed, skippedInterruptedSessions: built.skippedInterruptedSessions, finalRevision: revision });
}

function normalizeExisting(value: unknown, fallbackServerId?: string): WorkspaceSeedSnapshot {
  const object = asRecord(value, "workspace snapshot");
  const state = typeof object.state === "object" && object.state !== null && !Array.isArray(object.state) ? object.state as Record<string, unknown> : object;
  const serverId = typeof state.serverId === "string" ? state.serverId : typeof object.serverId === "string" ? object.serverId : fallbackServerId;
  assertId(serverId, "serverId");
  const revisionValue = state.revision ?? object.revision;
  const revision = revisionValue === undefined ? 0 : safeNumber(revisionValue, "workspace revision");
  return { serverId, revision, views: indexById(state.views), projects: indexById(state.projects), panels: indexById(state.panels), terminalSessions: indexById(state.terminalSessions) } as WorkspaceSeedSnapshot;
}

function normalizeViews(value: unknown): Map<string, LegacyView> {
  const result = new Map<string, LegacyView>();
  for (const [key, raw] of collection(value)) {
    const object = asRecord(raw, "legacy view");
    const id = stringId(object.id ?? key, "viewId");
    const name = boundedName(object.name ?? id);
    result.set(id, { id, name });
  }
  return result;
}

function normalizeProjects(value: unknown, views: Map<string, LegacyView>, serverId: string): Map<string, LegacyProject> {
  const result = new Map<string, LegacyProject>();
  for (const [key, raw] of collection(value)) {
    const object = asRecord(raw, "legacy project");
    const id = stringId(object.id ?? key, "projectId");
    const root = boundedPath(object.root);
    const name = boundedName(object.name ?? id);
    const viewId = stringId(object.viewId ?? object.workspaceViewId ?? object.view ?? `${serverId}:view:default`, "viewId");
    if (!views.has(viewId)) views.set(viewId, { id: viewId, name: viewId });
    const panelIds = normalizeIds(object.panelIds ?? (Array.isArray(object.panels) ? object.panels.map((panel) => typeof panel === "object" && panel !== null ? (panel as Record<string, unknown>).id : panel) : []), "panelId");
    result.set(id, { id, viewId, root, name, ...(typeof object.color === "string" ? { color: object.color } : {}), ...(typeof object.icon === "string" ? { icon: object.icon } : {}), panelIds, ...(object.activePanelId === undefined ? {} : { activePanelId: stringId(object.activePanelId, "panelId") }) });
  }
  return result;
}

function normalizePanels(value: unknown, projects: Map<string, LegacyProject>, projectSource: unknown): Map<string, LegacyPanel> {
  const result = new Map<string, LegacyPanel>();
  const entries = [...collection(value)];
  for (const [projectKey, rawProject] of collection(projectSource)) {
    const project = asRecord(rawProject, "legacy project");
    const projectId = typeof project.id === "string" ? project.id : projectKey;
    if (Array.isArray(project.panels)) for (const panel of project.panels) entries.push([`${projectId}:panel:${entries.length}`, { ...(asRecord(panel, "legacy panel")), projectId }]);
  }
  for (const [key, raw] of entries) {
    const object = asRecord(raw, "legacy panel");
    const id = stringId(object.id ?? key, "panelId");
    const projectId = stringId(object.projectId, "projectId");
    if (!projects.has(projectId)) continue;
    const type = object.type === "terminal" || object.type === "file" || object.type === "folder" ? object.type : undefined;
    if (type === undefined) continue;
    const createdAt = object.createdAt === undefined ? 0 : safeNumber(object.createdAt, "panel createdAt");
    const path = type === "terminal" ? undefined : boundedPath(object.path);
    const sessionId = type === "terminal" ? stringId(object.sessionId, "sessionId") : undefined;
    result.set(id, { id, projectId, type, ...(sessionId === undefined ? {} : { sessionId }), ...(path === undefined ? {} : { path }), ...(typeof object.mode === "string" ? { mode: object.mode } : {}), ...(typeof object.cwd === "string" ? { cwd: object.cwd } : {}), ...(typeof object.expanded === "boolean" ? { expanded: object.expanded } : {}), createdAt });
  }
  return result;
}

function normalizeSessions(value: unknown, projects: Map<string, LegacyProject>): Map<string, LegacySession> {
  const result = new Map<string, LegacySession>();
  for (const [key, raw] of collection(value)) {
    const object = asRecord(raw, "legacy terminal session");
    const id = stringId(object.id ?? key, "sessionId");
    const projectId = stringId(object.projectId, "projectId");
    if (!projects.has(projectId)) continue;
    result.set(id, { id, projectId, ...(typeof object.status === "string" ? { status: object.status } : {}), createdAt: object.createdAt === undefined ? 0 : safeNumber(object.createdAt, "session createdAt") });
  }
  return result;
}

function panelPayload(panel: LegacyPanel): JsonValue {
  return panel.type === "terminal"
    ? { id: panel.id, projectId: panel.projectId, type: "terminal", sessionId: panel.sessionId as string, createdAt: panel.createdAt, ...(panel.cwd === undefined ? {} : { cwd: panel.cwd }) }
    : { id: panel.id, projectId: panel.projectId, type: panel.type, path: panel.path as string, createdAt: panel.createdAt, ...(panel.mode === undefined ? {} : { mode: panel.mode }), ...(panel.expanded === undefined ? {} : { expanded: panel.expanded }) };
}

function existingViewId(existing: WorkspaceSeedSnapshot, serverId: string): string {
  const first = Object.keys(existing.views).sort()[0];
  return first ?? `${serverId}:view:default`;
}

function resolveServerId(source: Record<string, unknown>, existing: WorkspaceSeedSnapshot, fallback?: string): string {
  const value = typeof source.serverId === "string" ? source.serverId : fallback ?? existing.serverId;
  assertId(value, "serverId");
  return value;
}

function indexById(value: unknown): Readonly<Record<string, Record<string, unknown>>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, raw] of collection(value)) if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) result[key] = raw as Record<string, unknown>;
  return result;
}

function collection(value: unknown): Array<[string, unknown]> {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item, index) => [String(index), item]);
  if (typeof value !== "object") throw new TypeError("legacy workspace collection is invalid");
  return Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS);
}

function normalizeIds(value: unknown, name: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new TypeError(`${name} list is invalid`);
  return Object.freeze(value.map((item) => stringId(item, name)));
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${name} is invalid`);
  return value as Record<string, unknown>;
}

function stringId(value: unknown, name: string): string {
  assertId(value, name);
  return value;
}

function assertId(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TypeError(`${name} is invalid`);
}

function boundedName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) throw new TypeError("legacy name is invalid");
  return value.trim();
}

function boundedPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.includes("\0")) throw new TypeError("legacy root/path is invalid");
  return value;
}

function safeNumber(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${name} is invalid`);
  return value as number;
}

function revisionFromResult(value: JsonValue): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !Number.isSafeInteger(value.revision)) return undefined;
  return value.revision as number;
}
