import {
  DESKTOP_HOST_BRIDGE_VERSION,
  type DesktopHostAction,
  type DesktopHostContext,
  validateDesktopHostAction,
} from "../main/hostBridge.js";

export const DESKTOP_HOST_GET_CONTEXT_CHANNEL = "terminay:desktop-host:get-context";
export const DESKTOP_HOST_REQUEST_CHANNEL = "terminay:desktop-host:request";

export interface DesktopPreloadInvoker {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

export interface DesktopPreloadBridge {
  readonly version: typeof DESKTOP_HOST_BRIDGE_VERSION;
  getContext(): Promise<DesktopHostContext>;
  requestAction(action: DesktopHostAction, options?: { readonly userGesture?: boolean }): Promise<unknown>;
}

function copyContext(value: unknown): DesktopHostContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("desktop host context is invalid");
  const context = value as Record<string, unknown>;
  if (context.version !== DESKTOP_HOST_BRIDGE_VERSION || typeof context.windowId !== "string" || typeof context.connectionId !== "string" || typeof context.profileLabel !== "string" || typeof context.capabilities !== "object" || context.capabilities === null || Array.isArray(context.capabilities)) throw new TypeError("desktop host context is invalid");
  const capabilities = context.capabilities as Record<string, unknown>;
  const normalized: Record<string, boolean> = {};
  for (const key of ["nativeWindows", "secureStorage", "notifications", "filePicker", "clipboard", "serverExposure", "connectionProfiles"]) {
    if (capabilities[key] !== undefined && typeof capabilities[key] !== "boolean") throw new TypeError("desktop host capability is invalid");
    if (capabilities[key] === true) normalized[key] = true;
  }
  return Object.freeze({ version: DESKTOP_HOST_BRIDGE_VERSION, windowId: context.windowId, connectionId: context.connectionId, profileLabel: context.profileLabel, capabilities: Object.freeze(normalized) });
}

export function createDesktopPreloadBridge(invoker: DesktopPreloadInvoker): DesktopPreloadBridge {
  return Object.freeze({
    version: DESKTOP_HOST_BRIDGE_VERSION,
    getContext: async () => copyContext(await invoker.invoke(DESKTOP_HOST_GET_CONTEXT_CHANNEL)),
    requestAction: async (action: DesktopHostAction, options: { readonly userGesture?: boolean } = {}) => {
      const normalized = validateDesktopHostAction(action);
      if (options.userGesture !== undefined && typeof options.userGesture !== "boolean") throw new TypeError("user gesture is invalid");
      return invoker.invoke(DESKTOP_HOST_REQUEST_CHANNEL, { version: DESKTOP_HOST_BRIDGE_VERSION, action: normalized, ...(options.userGesture === undefined ? {} : { userGesture: options.userGesture }) });
    },
  });
}

export interface DesktopPreloadExposeTarget {
  exposeInMainWorld(name: string, value: unknown): void;
}

/** Hosts call this from the privileged preload entry. Subframes do not receive
 * the bridge, even if their document is supplied by the same server. */
export function installDesktopPreloadBridge(target: DesktopPreloadExposeTarget, bridge: DesktopPreloadBridge, isMainFrame = true): void {
  if (!isMainFrame) return;
  target.exposeInMainWorld("terminayHost", bridge);
}
