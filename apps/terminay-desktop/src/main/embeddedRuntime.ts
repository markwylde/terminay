import {
  createEmbeddedBootstrap,
  type EmbeddedBootstrapOptions,
  type EmbeddedBootstrapReady,
} from "@terminay/server";
import type { DesktopLocalBootstrapChannel } from "./localServer.js";
import type { EmbeddedLocalServer, LocalServerReadiness, LocalServerState } from "./connectionHost.js";

/**
 * The only Desktop adapter around the shared embedded server runtime.
 *
 * It claims the supervisor's private bootstrap credential once, injects it
 * into the Electron-free server bootstrap, and translates lifecycle/readiness
 * into the deliberately small Desktop host contract.  It does not construct
 * a second Electron server or UI listener.
 */
export function createDesktopEmbeddedLocalServer(
  channel: DesktopLocalBootstrapChannel,
  options: Omit<EmbeddedBootstrapOptions, "bootstrapCredential">,
): EmbeddedLocalServer {
  const credential = channel.claim();
  if (!Number.isSafeInteger(credential.expiresAt) || credential.expiresAt <= Date.now()) {
    throw new Error("Desktop bootstrap credential expired before embedded Local startup");
  }
  const bootstrap = createEmbeddedBootstrap({
    ...options,
    bootstrapCredential: credential.value,
  });
  const listeners = new Set<(state: LocalServerState) => void>();
  let state: LocalServerState = "created";

  const setState = (next: LocalServerState): void => {
    if (state === next) return;
    state = next;
    for (const listener of listeners) listener(next);
  };
  const readiness = (ready: EmbeddedBootstrapReady): LocalServerReadiness => Object.freeze({
    serverId: ready.serverId,
    serverVersion: ready.serverVersion,
    origin: ready.origin,
    endpoint: ready.endpoint,
    bootstrapCredential: credential.value,
    bootstrapCredentialExpiresAt: credential.expiresAt,
    credentialDigest: ready.credentialDigest,
  });

  return {
    get state() { return state; },
    async start() {
      setState("starting");
      try {
        const ready = await bootstrap.start();
        if (Date.now() >= credential.expiresAt) {
          await bootstrap.stop();
          throw new Error("Desktop bootstrap credential expired before embedded Local became ready");
        }
        if (ready.bootstrapCredential !== credential.value) throw new Error("embedded Local did not retain the Desktop bootstrap credential");
        setState("ready");
        return readiness(ready);
      } catch (error) {
        setState("failed");
        throw error;
      }
    },
    async stop() {
      setState("stopping");
      await bootstrap.stop();
      setState("stopped");
    },
    onStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
