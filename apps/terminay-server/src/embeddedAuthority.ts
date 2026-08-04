import {
  createServerCoreComposition,
  type ServerCoreComposition,
  type ServerCoreCompositionOptions,
} from "@terminay/server-core";

/**
 * Electron-free authority surface for the embedded Desktop server.
 *
 * Desktop supplies a host-neutral PTY factory and authentication policy, then
 * wires `composition.core.accept(...)` to its private framed transport. The
 * server package owns the terminal service, operation registry, event journal,
 * and connection cleanup; no Electron object crosses this boundary.
 */
export type EmbeddedDesktopAuthorityOptions = ServerCoreCompositionOptions;

export function createEmbeddedDesktopAuthority(
  options: EmbeddedDesktopAuthorityOptions,
): ServerCoreComposition {
  return createServerCoreComposition(options);
}
