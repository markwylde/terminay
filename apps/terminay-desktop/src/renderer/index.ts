import { createHostCapabilityProvider, type HostActions, type HostCapabilityProvider, type TerminayClient } from "@terminay/client-core";
import { createResponsiveUiProvider, createSharedFileSelectionModel, createSharedWorkspaceRouteRenderModel, type ResponsiveUiContext, type SharedWorkspaceRoute, type SharedWorkspaceRouteRenderModel } from "@terminay/responsive-ui";
import type { DesktopPresentationMetadata } from "../presentation.js";
import {
  createDesktopProfileWindowCommandClient,
  type DesktopProfileWindowCommandClient,
} from "./profileWindowCommands.js";

export {
  createDesktopProfileWindowCommandClient,
  type DesktopProfileWindowCommandClient,
  type DesktopProfileWindowHost,
  type OpenCurrentProfileWindowRequest,
} from "./profileWindowCommands.js";

export const desktopRendererBoundary = "desktop-renderer";

/** Desktop advertises the native picker only when the bound host context says
 * it is available; otherwise shared UI uses its in-page File-route fallback. */
export function createDesktopFileSelectionActionModel(
  capabilities: HostCapabilityProvider = createHostCapabilityProvider(),
) {
  return createSharedFileSelectionModel(capabilities);
}

/** Desktop uses the same route component contract as web and opts into a
 * native auxiliary presentation only when the host advertises native
 * windows. The component regions themselves never change with the host. */
export function createDesktopWorkspaceRouteRenderModel(
  route: SharedWorkspaceRoute,
  capabilities: HostCapabilityProvider = createHostCapabilityProvider({ nativeWindows: true }),
): SharedWorkspaceRouteRenderModel {
  return createSharedWorkspaceRouteRenderModel(route, capabilities);
}

/** Structural view of the native bridge. The renderer imports this type only;
 * it does not import Electron, preload, or Desktop main modules. */
export interface DesktopRendererHostApi {
  readonly getContext: () => Promise<{
    readonly version: number;
    readonly windowId: string;
    readonly connectionId: string;
    readonly profileLabel: string;
    readonly capabilities: Record<string, boolean>;
    readonly presentation: DesktopPresentationMetadata;
  }>;
  readonly requestAction: (action: unknown, options?: { readonly userGesture?: boolean }) => Promise<unknown>;
}

/** Build the renderer's profile/window capability from the generic preload
 * transport in one place. Shared UI receives the typed facade, not a
 * profile-id-bearing native operation. */
export function createDesktopProfileWindowCommands(
  hostApi: DesktopRendererHostApi,
): DesktopProfileWindowCommandClient {
  return createDesktopProfileWindowCommandClient({
    getContext: hostApi.getContext,
    openWindow: async (action) => hostApi.requestAction(action, { userGesture: true }),
  });
}

export interface DesktopRendererContext extends ResponsiveUiContext {}

export interface DesktopRendererContextOptions {
  readonly client: TerminayClient;
  readonly hostApi?: DesktopRendererHostApi;
  readonly capabilities?: HostCapabilityProvider;
  readonly actions?: HostActions;
}

/** Adapt the structural preload facade to the transport-neutral host actions
 * consumed by shared UI. The action objects remain narrow and versioned at the
 * native boundary. */
export function createDesktopRendererActions(hostApi: DesktopRendererHostApi): HostActions {
  const profileWindows = createDesktopProfileWindowCommands(hostApi);
  return Object.freeze({
    openWindow: async (request: { readonly view?: string; readonly serverId?: string }) => {
      if (request.serverId === undefined) throw new Error("native window open requires a connection id");
      const context = await hostApi.getContext();
      if (request.serverId !== context.connectionId) throw new Error("native window open is outside the bound connection");
      await profileWindows.openCurrentProfileWindow(
        request.view === undefined ? {} : { workspaceViewId: request.view },
      );
    },
    chooseFile: async (request: { readonly multiple?: boolean } = {}) => {
      const result = await hostApi.requestAction({ type: "file.choose", ...(request.multiple === undefined ? {} : { multiple: request.multiple }) }, { userGesture: true });
      if (!Array.isArray(result) || result.some((value) => typeof value !== "string")) throw new Error("native file chooser returned an invalid result");
      return result as readonly string[];
    },
    writeClipboard: async (text: string) => {
      await hostApi.requestAction({ type: "clipboard.write", text }, { userGesture: true });
    },
    readClipboard: async () => {
      const result = await hostApi.requestAction({ type: "clipboard.read" }, { userGesture: true });
      if (typeof result !== "string") throw new Error("native clipboard returned an invalid result");
      return result;
    },
    showNotification: async (request: { readonly title: string; readonly body?: string }) => {
      await hostApi.requestAction({ type: "notification.show", title: request.title, ...(request.body === undefined ? {} : { body: request.body }) }, { userGesture: true });
    },
  });
}

function guardDesktopRendererActions(actions: HostActions, capabilities: HostCapabilityProvider): HostActions {
  const guarded = {} as { -readonly [K in keyof HostActions]?: HostActions[K] };
  const openWindow = actions.openWindow;
  if (openWindow !== undefined) guarded.openWindow = async (request: Parameters<typeof openWindow>[0]) => { capabilities.require("nativeWindows"); return openWindow(request); };
  const chooseFile = actions.chooseFile;
  if (chooseFile !== undefined) guarded.chooseFile = async (request?: Parameters<typeof chooseFile>[0]) => { capabilities.require("filePicker"); return chooseFile(request); };
  const writeClipboard = actions.writeClipboard;
  if (writeClipboard !== undefined) guarded.writeClipboard = async (text: Parameters<typeof writeClipboard>[0]) => { capabilities.require("clipboard"); return writeClipboard(text); };
  const readClipboard = actions.readClipboard;
  if (readClipboard !== undefined) guarded.readClipboard = async () => { capabilities.require("clipboard"); return readClipboard(); };
  const showNotification = actions.showNotification;
  if (showNotification !== undefined) guarded.showNotification = async (request: Parameters<typeof showNotification>[0]) => { capabilities.require("notifications"); return showNotification(request); };
  return Object.freeze(guarded) as HostActions;
}

/** Browser-safe dependency injection boundary for server-bundled workspace UI.
 * `hostApi` remains an opaque capability adapter and is never elevated into a
 * generic IPC object. */
export function createDesktopRendererContext(options: DesktopRendererContextOptions): DesktopRendererContext {
  const capabilities = options.capabilities ?? createHostCapabilityProvider();
  const actions = options.actions ?? (options.hostApi === undefined ? undefined : createDesktopRendererActions(options.hostApi));
  const guardedActions = actions === undefined ? undefined : guardDesktopRendererActions(actions, capabilities);
  return createResponsiveUiProvider({
    client: options.client,
    capabilities,
    ...(guardedActions === undefined ? {} : { actions: guardedActions }),
  });
}
