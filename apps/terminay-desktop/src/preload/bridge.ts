import {
  TERMINAY_HOST_BRIDGE_VERSION,
  parseTerminayHostAction,
  parseTerminayHostContext,
  type TerminayHostAction,
  type TerminayHostActionRequest,
  type TerminayHostContext,
} from "@terminay/protocol";

export const DESKTOP_HOST_GET_CONTEXT_CHANNEL = "terminay:desktop-host:get-context";
export const DESKTOP_HOST_REQUEST_CHANNEL = "terminay:desktop-host:request";
export interface DesktopPreloadInvoker { invoke(channel: string, payload?: unknown): Promise<unknown>; }
export interface DesktopPreloadBridge { readonly version: typeof TERMINAY_HOST_BRIDGE_VERSION; getContext(): Promise<TerminayHostContext>; requestAction(action: TerminayHostAction, options: { readonly context: TerminayHostContext; readonly userGesture: true }): Promise<unknown>; }

export function createDesktopPreloadBridge(invoker: DesktopPreloadInvoker): DesktopPreloadBridge {
  return Object.freeze({
    version: TERMINAY_HOST_BRIDGE_VERSION,
    getContext: async () => parseTerminayHostContext(await invoker.invoke(DESKTOP_HOST_GET_CONTEXT_CHANNEL)),
    requestAction: async (action: TerminayHostAction, options: { readonly context: TerminayHostContext; readonly userGesture: true }) => {
      const context = parseTerminayHostContext(options.context);
      const request: TerminayHostActionRequest = Object.freeze({ schemaVersion: context.schemaVersion, bridgeVersion: TERMINAY_HOST_BRIDGE_VERSION, sourceId: context.sourceId, windowId: context.windowId, profileId: context.profileId, serverId: context.serverId, userGesture: true, action: parseTerminayHostAction(action) });
      return invoker.invoke(DESKTOP_HOST_REQUEST_CHANNEL, request);
    },
  });
}
export interface DesktopPreloadExposeTarget { exposeInMainWorld(name: string, value: unknown): void; }
export function installDesktopPreloadBridge(target: DesktopPreloadExposeTarget, bridge: DesktopPreloadBridge, isMainFrame = true): void {
  if (!isMainFrame) return;
  target.exposeInMainWorld("terminayHost", Object.freeze({ version: TERMINAY_HOST_BRIDGE_VERSION, getContext: () => bridge.getContext(), requestAction: (action: TerminayHostAction, options: { readonly context: TerminayHostContext; readonly userGesture: true }) => bridge.requestAction(action, options) }));
}
