import { ServerRuntime, type ServerRuntimeConfig, type ServerRuntimeHooks } from "@terminay/server-core";
import type { LocalUiServer } from "./localUiServer.js";

export * from "./mcp/controlEndpoint.js";
export * from "./bootstrap.js";
export * from "./mcp/dispatcher.js";
export * from "./mcp/terminalAdapter.js";
export * from "./cliOptions.js";
export * from "./mcp/stdio.js";
export * from "./localUiServer.js";
export * from "./remote/nodeDataChannelRuntime.js";

export const serverApplicationBoundary = "@terminay/server";
export interface StandaloneServerOptions extends Omit<ServerRuntimeConfig, "runtimeMode"> {
  readonly hooks?: ServerRuntimeHooks;
  /** Optional authenticated server-bundled UI host owned by this runtime. */
  readonly uiServer?: LocalUiServer;
}

export function createStandaloneServer(options: StandaloneServerOptions): ServerRuntime {
  return createServerRuntime(options, "standalone");
}

export function createEmbeddedServer(options: StandaloneServerOptions): ServerRuntime {
  return createServerRuntime(options, "embedded");
}

function createServerRuntime(options: StandaloneServerOptions, runtimeMode: "embedded" | "standalone"): ServerRuntime {
  const { hooks, uiServer, ...config } = options;
  const composedHooks: ServerRuntimeHooks = {
    startServices: async (runtimeConfig, services) => {
      await hooks?.startServices?.(runtimeConfig, services);
      await uiServer?.start();
    },
    stopServices: async (deadline, services) => {
      await uiServer?.stop();
      await hooks?.stopServices?.(deadline, services);
    },
  };
  return new ServerRuntime({ ...config, runtimeMode }, composedHooks);
}
