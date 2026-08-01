import {
  createHostCapabilityProvider,
  WorkspaceClient,
  TerminayClient,
  type HostCapabilityProvider,
  type ProjectMoveResult,
  type TerminayHost,
  type WorkspaceCommandOptions,
} from "@terminay/client-core";
import type { ByteTransport, ProtocolId, ServerHello } from "@terminay/protocol";
import {
  ConnectionProfileStore,
  createLocalProfile,
  createRemoteProfile,
  localProfileId,
  type ConnectionProfile,
  type ConnectionProfileStatus,
  type RemoteProfileInput,
} from "./connectionProfiles.js";
import { DesktopHostShellPolicy, type DesktopBundleFetcher, type DesktopBundleResource } from "./hostShell.js";
import { WindowViewRegistry, type WindowSelection, type WorkspaceViewBinding } from "./windowRegistry.js";
import { createDesktopShellHeaderModel, type DesktopShellHeaderModel } from "./shellHeader.js";

export type LocalServerState = "created" | "starting" | "ready" | "migrating" | "failed" | "crashed" | "restarting" | "stopping" | "stopped";

/** Local is always an authenticated loopback transport. It never depends on
 * hosted signaling, WebRTC, or an internet connection. */
export interface DesktopLocalMode {
  readonly transport: "loopback";
  readonly internetRequired: false;
  readonly usesWebRTC: false;
}

export const DESKTOP_LOCAL_MODE: DesktopLocalMode = Object.freeze({ transport: "loopback", internetRequired: false, usesWebRTC: false });

export interface WorkspaceAdoptionRequest {
  readonly connectionId: string;
  readonly projectId: ProtocolId;
  readonly targetViewId: ProtocolId;
  readonly currentWindowId?: string;
  readonly rebindCurrent?: boolean;
  readonly createWindowId?: () => string;
  readonly index?: number;
  readonly commandId?: ProtocolId;
  readonly expectedRevision?: number;
  readonly deadlineMs?: number;
  readonly signal?: AbortSignal;
}

export interface WorkspaceAdoptionResult {
  readonly move: ProjectMoveResult;
  readonly selection: WindowSelection;
}

export interface WorkspaceProjectPopoutRequest extends WorkspaceAdoptionRequest {
  readonly targetViewName: string;
  readonly createViewCommandId?: ProtocolId;
  readonly rollbackViewCommandId?: ProtocolId;
}

export interface WorkspaceProjectPopoutResult extends WorkspaceAdoptionResult {
  readonly view: {
    readonly viewId: ProtocolId;
    readonly revision: number;
    readonly cursor: string;
  };
}

export interface CloseWorkspaceViewRequest {
  readonly connectionId: string;
  readonly viewId: ProtocolId;
  readonly commandId?: ProtocolId;
  readonly expectedRevision?: number;
  readonly deadlineMs?: number;
  readonly signal?: AbortSignal;
}

export interface CloseWorkspaceViewResult {
  readonly command: { readonly revision: number; readonly cursor: string };
  readonly detachedBindings: readonly WorkspaceViewBinding[];
}

export interface LocalServerReadiness {
  readonly serverId: ProtocolId;
  readonly serverVersion?: string;
  readonly origin: string;
  /** The authenticated loopback endpoint selected by the embedded server. */
  readonly endpoint?: string;
  readonly fingerprint?: string;
  readonly transport?: ByteTransport;
  /**
   * Delivered over the private Desktop/bootstrap channel only. This value is
   * intentionally never copied into a connection profile or host state DTO.
   */
  readonly bootstrapCredential?: string;
  /** Epoch milliseconds after which the private bootstrap credential is invalid. */
  readonly bootstrapCredentialExpiresAt?: number;
  /** Safe diagnostic digest; the credential itself must not be logged. */
  readonly credentialDigest?: string;
}

export interface EmbeddedLocalServer {
  readonly state?: LocalServerState;
  start(): Promise<LocalServerReadiness>;
  stop(): Promise<void>;
  onStateChange?(listener: (state: LocalServerState) => void): () => void;
}

export interface ConnectionTransportFactory {
  connect(profile: ConnectionProfile, localContext?: LocalTransportContext): Promise<ByteTransport>;
}

/** Private context supplied only while creating the embedded Local transport. */
export interface LocalTransportContext {
  readonly serverId: ProtocolId;
  readonly serverVersion?: string;
  readonly origin: string;
  readonly endpoint?: string;
  readonly bootstrapCredential?: string;
  readonly bootstrapCredentialExpiresAt?: number;
  readonly credentialDigest?: string;
}

export type DesktopConnectionHostPhase = "idle" | "starting" | "ready" | "failed" | "stopping" | "stopped";

export interface DesktopConnectionHostOptions {
  readonly localServer: EmbeddedLocalServer;
  readonly profiles?: ConnectionProfileStore;
  readonly transports?: ConnectionTransportFactory;
  readonly clientId?: ProtocolId;
  readonly clientVersion?: string;
  readonly capabilities?: readonly string[];
  readonly hostCapabilities?: HostCapabilityProvider;
  readonly windows?: WindowViewRegistry;
}

export interface DesktopConnection {
  readonly profile: ConnectionProfile;
  readonly client: TerminayClient;
  readonly server: ServerHello;
}

export interface DesktopConnectionHeader {
  readonly profileId: string;
  readonly serverId: ProtocolId;
  readonly label: string;
  readonly kind: ConnectionProfile["kind"];
  readonly status: ConnectionProfileStatus;
  readonly local: boolean;
}

export interface DesktopWindowOpenResult {
  readonly connection: DesktopConnection;
  readonly selection: WindowSelection;
}

export interface DesktopWindowCloseResult {
  /** The host-local presentation binding that was detached. */
  readonly binding: WorkspaceViewBinding;
  /** Closing a native window never deletes the server logical view. */
  readonly logicalViewDeleted: false;
}

export interface DesktopConnectionHostState {
  readonly phase: DesktopConnectionHostPhase;
  readonly currentProfileId?: string;
  readonly localServerState: LocalServerState;
  readonly error?: Error;
}

export interface DesktopConnectionStateChange {
  readonly previous: DesktopConnectionHostState;
  readonly current: DesktopConnectionHostState;
}

/** Native host composition for Local and remote server connections. It owns
 * only connection metadata and client transports; workspace and PTY state stay
 * behind the TerminayClient protocol. */
export class DesktopConnectionHost {
  readonly localMode: DesktopLocalMode = DESKTOP_LOCAL_MODE;
  readonly profiles: ConnectionProfileStore;
  readonly windows: WindowViewRegistry;
  readonly host: TerminayHost;
  private readonly localServer: EmbeddedLocalServer;
  private readonly transports: ConnectionTransportFactory | undefined;
  private readonly clientId: ProtocolId | undefined;
  private readonly clientVersion: string | undefined;
  private readonly capabilities: readonly string[] | undefined;
  private readonly active = new Map<string, DesktopConnection>();
  private readonly listeners = new Set<(change: DesktopConnectionStateChange) => void>();
  private localServerState: LocalServerState = "created";
  private phase: DesktopConnectionHostPhase = "idle";
  private currentProfileId: string | undefined;
  private error: Error | undefined;
  private localReadiness: LocalServerReadiness | undefined;
  private localTransportContext: LocalTransportContext | undefined;
  private localStateUnsubscribe: (() => void) | undefined;

  constructor(options: DesktopConnectionHostOptions) {
    this.localServer = options.localServer;
    this.profiles = options.profiles ?? new ConnectionProfileStore();
    this.transports = options.transports;
    this.clientId = options.clientId;
    this.clientVersion = options.clientVersion;
    this.capabilities = options.capabilities;
    this.windows = options.windows ?? new WindowViewRegistry();
    const capabilityProvider = options.hostCapabilities ?? createHostCapabilityProvider({ nativeWindows: true, connectionProfiles: true, secureStorage: false, updater: true, osIntegration: true });
    this.host = Object.freeze({ capabilities: capabilityProvider });
    this.localStateUnsubscribe = options.localServer.onStateChange?.((state) => this.onLocalState(state));
    if (options.localServer.state !== undefined) this.localServerState = options.localServer.state;
  }

  get state(): DesktopConnectionHostState {
    return Object.freeze({ phase: this.phase, ...(this.currentProfileId === undefined ? {} : { currentProfileId: this.currentProfileId }), localServerState: this.localServerState, ...(this.error === undefined ? {} : { error: this.error }) });
  }

  /** Header data is host-local metadata only; activity/terminal attention is
   * intentionally not folded into connection status. When Local crashes, its
   * immutable profile remains visible with the explicit failed/offline state. */
  get currentConnectionHeader(): DesktopConnectionHeader | undefined {
    const selectedId = this.currentProfileId;
    const localId = this.localReadiness === undefined ? undefined : localProfileId(this.localReadiness.serverId);
    const profile = (selectedId === undefined ? undefined : this.profiles.get(selectedId)) ?? (localId === undefined ? undefined : this.profiles.get(localId));
    if (profile === undefined) return undefined;
    return Object.freeze({ profileId: profile.id, serverId: profile.serverId, label: profile.label, kind: profile.kind, status: profile.status, local: profile.kind === "local" });
  }

  /**
   * Single host-owned projection for the native header, connection menu,
   * native lifecycle status, and window/view mapping. The renderer workspace
   * remains the authority for workspace state; only opaque view ids cross this
   * boundary.
   */
  get shellHeader(): DesktopShellHeaderModel {
    const currentConnection = this.currentConnectionHeader;
    return createDesktopShellHeaderModel({
      ...(currentConnection === undefined ? {} : { currentConnection }),
      state: this.state,
      profiles: this.profiles.list(),
      windows: this.windows.list(),
      canManageConnections: this.host.capabilities.has("connectionProfiles"),
      canExposeServer: this.host.capabilities.has("serverExposure"),
    });
  }

  onStateChange(listener: (change: DesktopConnectionStateChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<DesktopConnection> {
    if (this.phase === "ready" && this.currentProfileId !== undefined) {
      const current = this.active.get(this.currentProfileId);
      if (current !== undefined) return current;
    }
    if (this.phase !== "idle" && this.phase !== "failed") throw new Error(`desktop connection host is ${this.phase}`);
    this.setPhase("starting");
    this.error = undefined;
    try {
      // Recover host-local metadata before opening Local. Server startup may
      // rotate its loopback origin, but remembered remote profiles and their
      // explicit statuses must be present when the connection menu appears.
      await this.windows.load();
      await this.profiles.load();
      this.setLocalServerState("starting");
      const readiness = await this.localServer.start();
      this.localReadiness = readiness;
      this.localTransportContext = localTransportContext(readiness);
      this.setLocalServerState("ready");
      let profile: ConnectionProfile;
      try {
        profile = this.profiles.ensureLocal({ serverId: readiness.serverId, origin: readiness.origin, ...(readiness.fingerprint === undefined ? {} : { fingerprint: readiness.fingerprint }) });
      } catch (cause) {
        // Keep the remembered Local record visible as an explicit failure when
        // the embedded server identity changes; never fabricate a replacement
        // Local profile or fall back to another connection.
        const localProfile = this.profiles.list({ includeArchived: true }).find((candidate) => candidate.kind === "local");
        if (localProfile !== undefined) this.profiles.patch(localProfile.id, { status: "identity-mismatch" });
        throw cause;
      }
      const local = await this.openProfile(profile.id, readiness.transport);
      this.currentProfileId = profile.id;
      this.setPhase("ready");
      return local;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.error = error;
      this.setLocalServerState(this.localServerState === "stopping" ? this.localServerState : "failed");
      this.setPhase("failed");
      throw error;
    }
  }

  /** Start Local and bind the first native window to its immutable profile. */
  async openInitialWindow(options: { readonly workspaceViewId?: ProtocolId; readonly createWindowId?: () => string } = {}): Promise<DesktopWindowOpenResult> {
    const connection = await this.start();
    if (connection.profile.kind !== "local" || connection.profile.immutable !== true) throw new Error("initial Desktop window must bind immutable Local");
    const selection = this.selectWindow(connection.profile.id, options.workspaceViewId, { ...(options.createWindowId === undefined ? {} : { createWindowId: options.createWindowId }) });
    return Object.freeze({ connection, selection });
  }

  async stop(): Promise<void> {
    if (this.phase === "stopped") return;
    this.setPhase("stopping");
    for (const connection of this.active.values()) await connection.client.close().catch(() => undefined);
    this.active.clear();
    await this.localServer.stop();
    this.setLocalServerState("stopped");
    this.localReadiness = undefined;
    this.localTransportContext = undefined;
    this.currentProfileId = undefined;
    this.setPhase("stopped");
    this.localStateUnsubscribe?.();
    this.localStateUnsubscribe = undefined;
  }

  /**
   * Explicitly recover the embedded Local authority after a crash or failed
   * startup. Existing Local clients are detached before stopping the old
   * authority, and the new readiness identity is checked through the same
   * immutable Local profile path as initial startup.
   */
  async restartLocal(): Promise<DesktopConnection> {
    if (this.phase === "stopping" || this.phase === "stopped") throw new Error(`desktop connection host is ${this.phase}`);
    const priorReadiness = this.localReadiness;
    if (priorReadiness === undefined) throw new Error("Local server has not started");

    const localId = localProfileId(priorReadiness.serverId);
    this.setPhase("starting");
    this.setLocalServerState("restarting");
    const localConnection = this.active.get(localId);
    if (localConnection !== undefined) {
      await localConnection.client.close().catch(() => undefined);
      this.active.delete(localId);
    }
    if (this.currentProfileId === localId) this.currentProfileId = undefined;
    try {
      await this.localServer.stop();
      this.localReadiness = undefined;
      this.localTransportContext = undefined;
      this.setLocalServerState("restarting");
      const readiness = await this.localServer.start();
      this.localReadiness = readiness;
      this.localTransportContext = localTransportContext(readiness);
      this.setLocalServerState("ready");
      const profile = this.profiles.ensureLocal({ serverId: readiness.serverId, origin: readiness.origin, ...(readiness.fingerprint === undefined ? {} : { fingerprint: readiness.fingerprint }) });
      const connection = await this.openProfile(profile.id, readiness.transport);
      this.currentProfileId = profile.id;
      this.setPhase("ready");
      this.error = undefined;
      return connection;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.error = error;
      this.setLocalServerState("failed");
      this.setPhase("failed");
      throw error;
    }
  }

  async openProfile(profileId: string, localTransport?: ByteTransport): Promise<DesktopConnection> {
    const profile = this.profiles.get(profileId);
    if (profile === undefined || profile.archived) throw new Error(`unknown or archived connection profile: ${profileId}`);
    const prior = this.active.get(profileId);
    if (prior !== undefined && prior.client.state !== "closed") {
      this.currentProfileId = profileId;
      return prior;
    }
    this.profiles.patch(profileId, { status: "connecting", lastOpenedAt: new Date().toISOString() });
    let client: TerminayClient | undefined;
    try {
      let transport = localTransport;
      if (transport === undefined && profile.kind === "local") transport = this.localReadiness?.transport;
      if (transport === undefined) {
        if (this.transports === undefined) throw new Error("no transport factory is configured for this connection");
        transport = profile.kind === "local" ? await this.transports.connect(profile, this.localTransportContext) : await this.transports.connect(profile);
      }
      client = new TerminayClient({ transport, ...(this.clientId === undefined ? {} : { clientId: this.clientId }), ...(this.clientVersion === undefined ? {} : { clientVersion: this.clientVersion }), ...(this.capabilities === undefined ? {} : { capabilities: this.capabilities }), hostCapabilities: this.host.capabilities });
      const server = await client.connect();
      if (server.serverId !== profile.serverId) {
        await client.close().catch(() => undefined);
        this.profiles.patch(profileId, { status: "identity-mismatch" });
        throw new Error(`server identity mismatch for ${profile.label}`);
      }
      const connectedProfile = this.profiles.patch(profileId, { status: "connected", lastConnectedAt: new Date().toISOString() });
      const connection = Object.freeze({ profile: connectedProfile, client, server });
      this.active.set(profileId, connection);
      this.currentProfileId = profileId;
      return connection;
    } catch (cause) {
      await client?.close().catch(() => undefined);
      if (this.profiles.get(profileId)?.status === "connecting") this.profiles.patch(profileId, { status: "failed" });
      throw cause;
    }
  }

  /** Load a server bundle only for the currently authenticated connection.
   * The identity is checked again after the fetch so a late response cannot be
   * rendered in a window that has switched profiles or lost its connection. */
  async loadCurrentServerBundle(fetcher: DesktopBundleFetcher, assetPath = "/manifest.json"): Promise<DesktopBundleResource> {
    const connection = this.currentConnection;
    if (connection === undefined) throw new Error("no connected current connection");
    const policy = new DesktopHostShellPolicy();
    policy.selectConnection({ connectionId: connection.profile.id, origin: connection.profile.origin });
    const resource = await policy.loadSelectedBundle(fetcher, assetPath);
    if (this.currentConnection?.profile.id !== connection.profile.id) throw new Error("current connection changed while loading bundle");
    return resource;
  }

  /** Open a connection and select its native window/view as one host action.
   * Existing `(connection, workspaceView)` bindings focus instead of creating
   * duplicate windows; a distinct logical view gets its own binding. */
  async openProfileWindow(
    profileId: string,
    workspaceViewId?: ProtocolId,
    options: { readonly currentWindowId?: string; readonly rebindCurrent?: boolean; readonly createWindowId?: () => string } = {},
  ): Promise<DesktopWindowOpenResult> {
    const previousBinding = options.rebindCurrent === true && options.currentWindowId !== undefined
      ? this.windows.get(options.currentWindowId)
      : undefined;
    const selection = this.selectWindow(profileId, workspaceViewId, options);
    try {
      const connection = await this.openProfile(profileId);
      return Object.freeze({ connection, selection });
    } catch (cause) {
      // A failed transport must not leave a phantom native window binding.
      if (selection.action === "open") {
        this.windows.unbind(selection.binding.windowId);
        if (previousBinding !== undefined) this.windows.bind(previousBinding);
      }
      throw cause;
    }
  }

  /**
   * Adopt a project into another logical server view and present that view in
   * the requested native window. The project move is authenticated by the
   * selected server connection; the native binding is only a reversible host
   * presentation update.
   */
  async adoptProjectWindow(
    profileId: string,
    request: Omit<WorkspaceAdoptionRequest, "connectionId">,
  ): Promise<DesktopWindowOpenResult & Pick<WorkspaceAdoptionResult, "move">> {
    const connection = await this.openProfile(profileId);
    const previousBinding = request.currentWindowId === undefined
      ? undefined
      : this.windows.get(request.currentWindowId);
    const selection = this.windows.select(profileId, request.targetViewId, windowSelectionOptions(request));
    try {
      const move = await new WorkspaceClient(connection.client).moveProject(
        {
          projectId: request.projectId,
          targetViewId: request.targetViewId,
          ...(request.index === undefined ? {} : { index: request.index }),
        },
        workspaceCommandOptions(request),
      );
      return Object.freeze({ connection, selection, move });
    } catch (error) {
      restoreFailedWindowSelection(this.windows, selection, previousBinding);
      throw error;
    }
  }

  /**
   * Pop out a project by creating a server-owned logical workspace view and
   * moving the project into it before presenting that view in a native window.
   * Failed server mutations restore the host-local native binding.
   */
  async popoutProjectWindow(
    profileId: string,
    request: Omit<WorkspaceProjectPopoutRequest, "connectionId">,
  ): Promise<DesktopWindowOpenResult & WorkspaceProjectPopoutResult> {
    const connection = await this.openProfile(profileId);
    const workspace = new WorkspaceClient(connection.client);
    const previousBinding = request.currentWindowId === undefined
      ? undefined
      : this.windows.get(request.currentWindowId);
    const selection = this.windows.select(profileId, request.targetViewId, windowSelectionOptions(request));
    let view: WorkspaceProjectPopoutResult["view"] | undefined;
    try {
      const created = await workspace.createView(
        { viewId: request.targetViewId, name: request.targetViewName },
        {
          ...(request.createViewCommandId === undefined ? {} : { commandId: request.createViewCommandId }),
          ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision }),
          ...(request.deadlineMs === undefined ? {} : { deadlineMs: request.deadlineMs }),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      );
      view = Object.freeze({ viewId: request.targetViewId, ...created });
      const move = await workspace.moveProject(
        {
          projectId: request.projectId,
          targetViewId: request.targetViewId,
          ...(request.index === undefined ? {} : { index: request.index }),
        },
        workspaceCommandOptions({ ...request, expectedRevision: view.revision }),
      );
      return Object.freeze({ connection, selection, view, move });
    } catch (error) {
      restoreFailedWindowSelection(this.windows, selection, previousBinding);
      if (view !== undefined) {
        await workspace.closeView(request.targetViewId, {
          commandId: request.rollbackViewCommandId ?? rollbackWorkspaceViewCommandId(request.targetViewId),
          expectedRevision: view.revision,
        }).catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * Explicitly close a logical server view through the authenticated
   * workspace command. Native bindings for that view are detached only after
   * the server accepts the command; closing a native window alone never calls
   * this method.
   */
  async closeWorkspaceView(
    profileId: string,
    request: Omit<CloseWorkspaceViewRequest, "connectionId">,
  ): Promise<{ readonly connection: DesktopConnection } & CloseWorkspaceViewResult> {
    const connection = await this.openProfile(profileId);
    const command = await new WorkspaceClient(connection.client).closeView(
      request.viewId,
      workspaceCommandOptions(request),
    );
    const detachedBindings = this.windows
      .list(profileId)
      .filter((binding) => binding.workspaceViewId === request.viewId);
    for (const binding of detachedBindings) this.windows.unbind(binding.windowId);
    return Object.freeze({
      connection,
      command,
      detachedBindings: Object.freeze([...detachedBindings]),
    });
  }

  /**
   * Detach one native window from its server connection/view presentation.
   *
   * The connection is shared by windows targeting the same profile, so a
   * native close must not close that client. The workspace view id is returned
   * as an opaque server identity; deleting it or closing its terminals is an
   * explicit server command, never an effect of native-window cleanup.
   */
  closeWindow(windowId: string): DesktopWindowCloseResult | undefined {
    const binding = this.windows.unbind(windowId);
    if (binding === undefined) return undefined;
    return Object.freeze({ binding, logicalViewDeleted: false as const });
  }

  async disconnect(profileId: string): Promise<void> {
    const connection = this.active.get(profileId);
    if (connection !== undefined) {
      await connection.client.close();
      this.active.delete(profileId);
    }
    const profile = this.profiles.get(profileId);
    if (profile !== undefined && !profile.archived) this.profiles.patch(profileId, { status: "offline" });
    if (this.currentProfileId === profileId) this.currentProfileId = undefined;
  }

  getConnection(profileId: string): DesktopConnection | undefined {
    return this.active.get(profileId);
  }

  /** Consume a one-time pairing/deep-link URL without ever retaining its
   * fragment. Pairing protocol completion happens separately against the
   * exact origin; this host method only remembers sanitized metadata. */
  importPairingUrl(rawUrl: string, metadata: Omit<RemoteProfileInput, "origin">): ConnectionProfile {
    const parsed = normalizePairingDeepLink(rawUrl);
    return this.profiles.add(createRemoteProfile({ ...metadata, origin: parsed.origin }));
  }

  get currentConnection(): DesktopConnection | undefined {
    if (this.currentProfileId === undefined) return undefined;
    const connection = this.active.get(this.currentProfileId);
    return connection !== undefined && connection.client.state === "connected" && this.profiles.get(this.currentProfileId)?.status === "connected" ? connection : undefined;
  }

  selectWindow(profileId: string, workspaceViewId?: ProtocolId, options?: { readonly currentWindowId?: string; readonly rebindCurrent?: boolean; readonly createWindowId?: () => string }): WindowSelection {
    const profile = this.profiles.get(profileId);
    if (profile === undefined || profile.archived) throw new Error(`unknown or archived connection profile: ${profileId}`);
    return this.windows.select(profileId, workspaceViewId, options);
  }

  setProfileStatus(profileId: string, status: ConnectionProfileStatus): ConnectionProfile {
    return this.profiles.patch(profileId, { status });
  }

  private onLocalState(state: LocalServerState): void {
    this.setLocalServerState(state);
  }

  private setLocalServerState(state: LocalServerState): void {
    const previous = this.state;
    this.localServerState = state;
    const localId = this.localReadiness === undefined ? undefined : localProfileId(this.localReadiness.serverId);
    if (localId !== undefined && state !== "ready") {
      const connection = this.active.get(localId);
      if (connection !== undefined) {
        void connection.client.close().catch(() => undefined);
        this.active.delete(localId);
      }
      if (this.currentProfileId === localId) this.currentProfileId = undefined;
      if (state === "failed" || state === "crashed") this.phase = "failed";
      else if (state === "starting" || state === "restarting" || state === "migrating") this.phase = "starting";
    }
    if (localId !== undefined && this.profiles.get(localId) !== undefined) {
      const status: ConnectionProfileStatus = state === "ready" ? (this.active.get(localId)?.client.state === "connected" ? "connected" : "known") : state === "starting" || state === "restarting" || state === "migrating" ? "connecting" : state === "crashed" || state === "failed" ? "failed" : state === "stopped" ? "offline" : "known";
      this.profiles.patch(localId, { status });
    }
    this.notify(previous);
  }

  private setPhase(phase: DesktopConnectionHostPhase): void {
    const previous = this.state;
    this.phase = phase;
    this.notify(previous);
  }

  private notify(previous: DesktopConnectionHostState): void {
    const current = this.state;
    if (previous.phase === current.phase && previous.currentProfileId === current.currentProfileId && previous.localServerState === current.localServerState && previous.error === current.error) return;
    const change = Object.freeze({ previous, current });
    for (const listener of this.listeners) listener(change);
  }
}

/** A small helper for hosts that need to establish Local before constructing a
 * full DesktopConnectionHost. */
export function localProfileFromReadiness(readiness: LocalServerReadiness): ConnectionProfile {
  return createLocalProfile({ serverId: readiness.serverId, origin: readiness.origin, ...(readiness.fingerprint === undefined ? {} : { fingerprint: readiness.fingerprint }) });
}

export interface PairingDeepLinkMetadata {
  readonly origin: string;
  readonly path: string;
  readonly fragmentLength: number;
}

/** Validate a user-supplied pairing deep link without returning or retaining
 * its one-time fragment. Only the exact HTTPS origin is profile metadata. */
export function normalizePairingDeepLink(rawUrl: string): PairingDeepLinkMetadata {
  if (typeof rawUrl !== "string" || rawUrl.length > 16_384) throw new TypeError("pairing URL is invalid");
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new TypeError("pairing URL is invalid");
  }
  if (parsed.protocol !== "https:") throw new TypeError("pairing URL must use HTTPS");
  if (parsed.username || parsed.password || parsed.search) throw new TypeError("pairing URL contains credentials or query data");
  if (parsed.hash.length < 2 || parsed.hash.length > 8193) throw new TypeError("pairing URL fragment is invalid");
  let decodedFragment: string;
  try {
    decodedFragment = decodeURIComponent(parsed.hash.slice(1));
  } catch {
    throw new TypeError("pairing URL fragment is invalid");
  }
  if (hasControlCharacter(decodedFragment)) throw new TypeError("pairing URL fragment is invalid");
  return Object.freeze({ origin: parsed.origin, path: parsed.pathname, fragmentLength: parsed.hash.length - 1 });
}

function windowSelectionOptions(
  request: Pick<WorkspaceAdoptionRequest, "currentWindowId" | "rebindCurrent" | "createWindowId">,
): {
  readonly currentWindowId?: string;
  readonly rebindCurrent?: boolean;
  readonly createWindowId?: () => string;
} {
  return {
    ...(request.currentWindowId === undefined ? {} : { currentWindowId: request.currentWindowId }),
    ...(request.rebindCurrent === true ? { rebindCurrent: true } : {}),
    ...(request.createWindowId === undefined ? {} : { createWindowId: request.createWindowId }),
  };
}

function workspaceCommandOptions(
  request: Pick<WorkspaceAdoptionRequest, "commandId" | "expectedRevision" | "deadlineMs" | "signal">,
): WorkspaceCommandOptions {
  return {
    ...(request.commandId === undefined ? {} : { commandId: request.commandId }),
    ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision }),
    ...(request.deadlineMs === undefined ? {} : { deadlineMs: request.deadlineMs }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  };
}

function restoreFailedWindowSelection(
  windows: WindowViewRegistry,
  selection: WindowSelection,
  previousBinding: WorkspaceViewBinding | undefined,
): void {
  if (selection.action !== "open") return;
  windows.unbind(selection.binding.windowId);
  if (previousBinding !== undefined) windows.bind(previousBinding);
}

function rollbackWorkspaceViewCommandId(viewId: ProtocolId): ProtocolId {
  return `rollback-${viewId}`.slice(0, 128);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function localTransportContext(readiness: LocalServerReadiness): LocalTransportContext {
  return Object.freeze({
    serverId: readiness.serverId,
    ...(readiness.serverVersion === undefined ? {} : { serverVersion: readiness.serverVersion }),
    origin: readiness.origin,
    ...(readiness.endpoint === undefined ? {} : { endpoint: readiness.endpoint }),
    ...(readiness.bootstrapCredential === undefined ? {} : { bootstrapCredential: readiness.bootstrapCredential }),
    ...(readiness.bootstrapCredentialExpiresAt === undefined ? {} : { bootstrapCredentialExpiresAt: readiness.bootstrapCredentialExpiresAt }),
    ...(readiness.credentialDigest === undefined ? {} : { credentialDigest: readiness.credentialDigest }),
  });
}
