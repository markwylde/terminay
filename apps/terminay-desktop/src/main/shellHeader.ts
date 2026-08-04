import type {
  DesktopConnectionHeader,
  DesktopConnectionHostState,
  LocalServerState,
} from "./connectionHost.js";
import type { ConnectionProfile, ConnectionProfileStatus } from "./connectionProfiles.js";
import type { WorkspaceViewBinding } from "./windowRegistry.js";

/**
 * The native shell's connection menu is a projection of host-owned metadata.
 * It deliberately contains no project, panel, terminal, filesystem, or
 * renderer state. The shared workspace can consume the same shape without
 * being granted ownership of native windows.
 */
export interface DesktopShellConnectionEntry {
  readonly profileId: string;
  readonly serverId: string;
  readonly label: string;
  readonly kind: ConnectionProfile["kind"];
  readonly status: ConnectionProfileStatus;
  readonly local: boolean;
  readonly selected: boolean;
  readonly actions: {
    readonly open: true;
    readonly switch: boolean;
    readonly retry: boolean;
    readonly disconnect: boolean;
    readonly forget: boolean;
    readonly revoke: boolean;
  };
}

export interface DesktopShellWindowEntry {
  readonly windowId: string;
  readonly connectionId: string;
  readonly workspaceViewId?: string;
}

export type DesktopShellNativeStatus = "idle" | "starting" | "ready" | "failed" | "offline";

export interface DesktopShellHeaderModel {
  readonly version: 1;
  readonly currentConnection?: DesktopConnectionHeader;
  readonly connections: readonly DesktopShellConnectionEntry[];
  readonly windows: readonly DesktopShellWindowEntry[];
  readonly menu: {
    readonly addConnection: boolean;
    readonly manageConnections: boolean;
    readonly exposeCurrentServer: boolean;
  };
  readonly nativeStatus: {
    readonly phase: DesktopConnectionHostState["phase"];
    readonly localServer: LocalServerState;
    readonly status: DesktopShellNativeStatus;
    readonly hasError: boolean;
  };
}

export interface DesktopShellHeaderSource {
  readonly currentConnection?: DesktopConnectionHeader;
  readonly state: DesktopConnectionHostState;
  readonly profiles: readonly ConnectionProfile[];
  readonly windows: readonly WorkspaceViewBinding[];
  readonly canManageConnections?: boolean;
  readonly canExposeServer?: boolean;
}

const RETRYABLE_STATUSES: ReadonlySet<ConnectionProfileStatus> = new Set([
  "offline",
  "expired",
  "revoked",
  "identity-mismatch",
  "incompatible",
  "failed",
]);

/**
 * Create the one-way projection consumed by a Desktop header/native menu.
 * Inputs are copied and frozen so a renderer cannot mutate host state through
 * the returned model. Window ids and workspace view ids remain opaque labels;
 * no server workspace object is copied into this projection.
 */
export function createDesktopShellHeaderModel(source: DesktopShellHeaderSource): DesktopShellHeaderModel {
  if (typeof source !== "object" || source === null) throw new TypeError("Desktop shell header source is required");
  const currentId = source.currentConnection?.profileId;
  const connections = [...source.profiles]
    .filter((profile) => !profile.archived)
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
    .map((profile) => Object.freeze({
      profileId: profile.id,
      serverId: profile.serverId,
      label: profile.label,
      kind: profile.kind,
      status: profile.status,
      local: profile.kind === "local",
      selected: profile.id === currentId,
      actions: Object.freeze({
        open: true as const,
        switch: profile.id !== currentId,
        retry: RETRYABLE_STATUSES.has(profile.status),
        disconnect: profile.status === "connected" || profile.status === "connecting",
        forget: profile.kind === "remote",
        revoke: profile.kind === "remote" && (profile.status === "connected" || profile.status === "connecting"),
      }),
    }));

  const windows = [...source.windows]
    .sort((left, right) => left.windowId.localeCompare(right.windowId))
    .map((binding) => Object.freeze({
      windowId: binding.windowId,
      connectionId: binding.connectionId,
      ...(binding.workspaceViewId === undefined ? {} : { workspaceViewId: binding.workspaceViewId }),
    }));

  const nativeStatus = Object.freeze({
    phase: source.state.phase,
    localServer: source.state.localServerState,
    status: nativeStatusFor(source.state),
    hasError: source.state.error !== undefined,
  });
  const currentConnection = source.currentConnection === undefined ? undefined : Object.freeze({ ...source.currentConnection });
  const menu = Object.freeze({
    addConnection: source.canManageConnections === true,
    manageConnections: source.canManageConnections === true,
    exposeCurrentServer: source.canExposeServer === true && source.currentConnection?.local === true && source.currentConnection.status === "connected",
  });

  return Object.freeze({
    version: 1 as const,
    ...(currentConnection === undefined ? {} : { currentConnection }),
    connections: Object.freeze(connections),
    windows: Object.freeze(windows),
    menu,
    nativeStatus,
  });
}

function nativeStatusFor(state: DesktopConnectionHostState): DesktopShellNativeStatus {
  if (state.phase === "failed" || state.localServerState === "failed" || state.localServerState === "crashed") return "failed";
  if (state.phase === "stopped" || state.localServerState === "stopped") return "offline";
  if (state.phase === "starting" || state.phase === "stopping" || state.localServerState === "starting" || state.localServerState === "restarting" || state.localServerState === "migrating") return "starting";
  if (state.phase === "ready" && state.localServerState === "ready") return "ready";
  return "idle";
}
