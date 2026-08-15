import { ServerRuntime, validateServerPlatformPaths, type ServerRuntimeConfig, type ServerRuntimeHooks, type ServerRuntimeServices, type ServerPlatformPaths } from "@terminay/server-core";
import type { LocalUiServer } from "./localUiServer.js";

export * from "./bootstrap.js";
export * from "./embeddedAuthority.js";
export * from "./dataRootLease.js";
export * from "./cliOptions.js";
export * from "./localUiServer.js";
export * from "./healthServer.js";
export * from "./remote/nodeDataChannelRuntime.js";
export * from "./remote/nodeDataChannelPeer.js";
export * from "./remote/nodeDataChannelHost.js";
export * from "./remote/secureWeriftRuntime.js";
export * from "./remote/secureWeriftPeer.js";
export * from "./remote/secureWeriftHost.js";
export * from "./remote/serverExposure.js";
export * from "./remote/signalingHostBoundary.js";
export * from "./remote/hostedSignalingRegistrar.js";

export const serverApplicationBoundary = "@terminay/server";
export interface StandaloneServerOptions extends Omit<ServerRuntimeConfig, "runtimeMode"> {
  readonly hooks?: ServerRuntimeHooks;
  /**
   * Server-owned construction boundary. Desktop supplies paths and this
   * factory composes privileged services before the runtime starts; Electron
   * APIs do not cross this boundary.
   */
  readonly serviceFactory?: ServerServiceFactory;
  /** Optional authenticated server-bundled UI host owned by this runtime. */
  readonly uiServer?: LocalUiServer;
}

export interface ServerServiceFactory {
  create(context: ServerCompositionContext): ServerRuntimeServices;
}

export interface ServerCompositionContext {
  readonly config: ServerRuntimeConfig;
  readonly paths: ServerPlatformPaths;
}

export function createStandaloneServer(options: StandaloneServerOptions): ServerRuntime {
  return createServerRuntime(options, "standalone");
}

export function createEmbeddedServer(options: StandaloneServerOptions): ServerRuntime {
  return createServerRuntime(options, "embedded");
}

function createServerRuntime(options: StandaloneServerOptions, runtimeMode: "embedded" | "standalone"): ServerRuntime {
  const { hooks, uiServer, serviceFactory, ...config } = options;
  const platformPaths = config.platformPaths === undefined
    ? undefined
    : validateServerPlatformPaths(config.platformPaths, config.dataRoot);
  const runtimeConfig: ServerRuntimeConfig = Object.freeze({
    ...config,
    runtimeMode,
    ...(platformPaths === undefined ? {} : { platformPaths }),
  });
  const services = serviceFactory === undefined
    ? runtimeConfig.services
    : serviceFactory.create({ config: runtimeConfig, paths: requirePlatformPaths(runtimeConfig) });
  let servicesStarted = false;
  let listenerStarted = false;
  let listenerStartAttempted = false;
  let compositionStopped = false;
  const stopComposition = async (deadline: number, services: ServerRuntimeServices | undefined): Promise<void> => {
    if (compositionStopped) return;
    compositionStopped = true;
    let listenerFailure: unknown;
    // `start()` may reject only after a listener has partially acquired local
    // resources. Always ask it to stop, but keep server-service cleanup alive
    // if that teardown itself fails.
    if (listenerStarted || listenerStartAttempted) {
      try {
        await uiServer?.stop();
      } catch (error) {
        listenerFailure = error;
      }
    }
    if (!servicesStarted) {
      if (listenerFailure !== undefined) throw listenerFailure;
      return;
    }
    try {
      await hooks?.stopServices?.(deadline, services);
    } catch (error) {
      if (listenerFailure !== undefined) {
        throw new AggregateError([listenerFailure, error], "server listener and service shutdown failed");
      }
      throw error;
    }
    if (listenerFailure !== undefined) throw listenerFailure;
  };
  const composedHooks: ServerRuntimeHooks = {
    startServices: async (runtimeConfig, services) => {
      // A host hook may allocate part of the server composition before it
      // rejects. Mark it as started before awaiting so that failure follows
      // the same rollback path as a UI-listener startup failure.
      servicesStarted = true;
      try {
        await hooks?.startServices?.(runtimeConfig, services);
        listenerStartAttempted = true;
        await uiServer?.start();
        listenerStarted = true;
      } catch (error) {
        try {
          await stopComposition(Date.now() + (runtimeConfig.shutdownTimeoutMs ?? 5_000), services);
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "server listener startup and rollback failed");
        }
        throw error;
      }
    },
    stopServices: (deadline, services) => stopComposition(deadline, services),
  };
  return new ServerRuntime({ ...runtimeConfig, ...(services === undefined ? {} : { services }) }, composedHooks);
}

function requirePlatformPaths(config: ServerRuntimeConfig): ServerPlatformPaths {
  if (config.platformPaths === undefined) throw new TypeError("service composition requires injected platform paths");
  return config.platformPaths;
}
