import { createHostCapabilityProvider, type HostActions, type HostCapabilityProvider, type TerminayClient, type TerminayHost } from "@terminay/client-core";
import type { ConnectionSnapshot } from "@terminay/client-core";

export const desktopRendererBoundary = "desktop-renderer";

/** Structural view of the native bridge. The renderer imports this type only;
 * it does not import Electron, preload, or Desktop main modules. */
export interface DesktopRendererHostApi {
  readonly getContext: () => Promise<{
    readonly version: number;
    readonly windowId: string;
    readonly connectionId: string;
    readonly profileLabel: string;
    readonly capabilities: Record<string, boolean>;
  }>;
  readonly requestAction: (action: unknown, options?: { readonly userGesture?: boolean }) => Promise<unknown>;
}

export interface DesktopRendererContext {
  readonly client: TerminayClient;
  readonly host: TerminayHost;
  readonly connection: ConnectionSnapshot;
}

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
  return Object.freeze({
    openWindow: async (request: { readonly view?: string; readonly serverId?: string }) => {
      if (request.serverId === undefined) throw new Error("native window open requires a connection id");
      await hostApi.requestAction({ type: "window.open", profileId: request.serverId, ...(request.view === undefined ? {} : { workspaceViewId: request.view }) }, { userGesture: true });
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
  return Object.freeze({
    client: options.client,
    host: Object.freeze({ capabilities, ...(guardedActions === undefined ? {} : { actions: guardedActions }) }),
    connection: options.client.snapshot,
  });
}
