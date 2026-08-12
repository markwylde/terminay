import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ExtensionInstaller } from "./installer.js";
import { ExtensionHostManager } from "./manager.js";
import { NpmCliRegistryClient } from "./npmClient.js";
import type { ExtensionOperationOptions } from "./operations.js";
import type { ExtensionBroker } from "./types.js";

export interface DefaultExtensionManagementOptions { readonly dataRoot: string; readonly authorityLabel: string; readonly broker?: ExtensionBroker; }

/** Construct the identical selected-server extension authority for Desktop's
 * embedded server, standalone installations, and containers. */
export function createDefaultExtensionManagement(options: DefaultExtensionManagementOptions): ExtensionOperationOptions & { readonly installer: ExtensionInstaller; readonly hosts: ExtensionHostManager } {
  const broker: ExtensionBroker = options.broker ?? { request: async () => { throw new Error("extension broker capability is unavailable"); } };
  const hosts = new ExtensionHostManager({ broker });
  const npm = new NpmCliRegistryClient({ workRoot: join(options.dataRoot, "extensions", "cache", "npm") });
  const installer = new ExtensionInstaller({
    dataRoot: options.dataRoot, registryClient: npm, materializer: npm,
    probe: async ({ extensionId, packageRoot, entrypoint, manifest }) => {
      const root = join(options.dataRoot, "extensions"); const directories = { config: join(root, "config", extensionId), data: join(root, "data", extensionId), cache: join(root, "cache", extensionId) };
      await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })));
      if ("registerManifest" in broker && typeof broker.registerManifest === "function") broker.registerManifest(manifest);
      await hosts.start({ extensionId, packageRoot, entrypoint, configDirectory: directories.config, dataDirectory: directories.data, cacheDirectory: directories.cache, permissions: [] }); await hosts.stop(extensionId);
    },
  });
  return { installer, hosts, authorityLabel: options.authorityLabel, restart: async (extensionId) => { await hosts.stop(extensionId); } };
}
