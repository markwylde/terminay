import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ExtensionInstaller } from "./installer.js";
import { ExtensionHostManager } from "./manager.js";
import { NpmCliRegistryClient } from "./npmClient.js";
import type { ExtensionOperationOptions } from "./operations.js";
import type { ExtensionBroker, ExtensionProfileBroker, ExtensionSecretAccessBroker } from "./types.js";
import type { ServerVaultComposition } from "../settings/vaultComposition.js";
import type { ProjectEnvironmentRepository } from "../projectEnvironment/repository.js";
import type { WorkspaceStore } from "../workspace.js";
import { createPuzedSshCompositionBroker, SSH_EXTENSION_ID, type PuzedSshCompositionBroker } from "./puzedSshComposition.js";
import { ExtensionHostComposedSshRuntime } from "./composedSshRuntime.js";
import { RepositoryCanonicalProjectOpener } from "./puzedSshProjectAdapter.js";

export interface DefaultExtensionManagementOptions { readonly dataRoot: string; readonly authorityLabel: string; readonly broker?: ExtensionBroker; readonly childEntrypoint?: string; readonly secrets?: ExtensionSecretAccessBroker; readonly profiles?: ExtensionProfileBroker; }

/** Construct the identical selected-server extension authority for Desktop's
 * embedded server, standalone installations, and containers. */
export function createDefaultExtensionManagement(options: DefaultExtensionManagementOptions): ExtensionOperationOptions & { readonly installer: ExtensionInstaller; readonly hosts: ExtensionHostManager } {
  const broker: ExtensionBroker = options.broker ?? { request: async () => { throw new Error("extension broker capability is unavailable"); } };
  const hosts = new ExtensionHostManager({ broker, ...(options.childEntrypoint === undefined ? {} : { childEntrypoint: options.childEntrypoint }), ...(options.secrets === undefined ? {} : { secrets: options.secrets }), ...(options.profiles === undefined ? {} : { profiles: options.profiles }) });
  const npm = new NpmCliRegistryClient({ workRoot: join(options.dataRoot, "extensions", "cache", "npm") });
  const installer = new ExtensionInstaller({
    dataRoot: options.dataRoot, registryClient: npm, materializer: npm,
    probe: async ({ extensionId, packageRoot, entrypoint, manifest }) => {
      const root = join(options.dataRoot, "extensions"); const directories = { config: join(root, "config", extensionId), data: join(root, "data", extensionId), cache: join(root, "cache", extensionId) };
      await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })));
      if ("registerManifest" in broker && typeof broker.registerManifest === "function") broker.registerManifest(manifest);
      await hosts.start({ extensionId, packageRoot, entrypoint, configDirectory: directories.config, dataDirectory: directories.data, cacheDirectory: directories.cache, permissions: manifest.permissions }); await hosts.stop(extensionId);
    },
  });
  return { installer, hosts, authorityLabel: options.authorityLabel, restart: async (extensionId) => { await hosts.stop(extensionId); } };
}

export function createPuzedSshProductionExtensionManagement(options: Readonly<{ dataRoot: string; authorityLabel: string; childEntrypoint?: string; vault: ServerVaultComposition; projectEnvironments: ProjectEnvironmentRepository; workspace: WorkspaceStore }>) {
  let target: PuzedSshCompositionBroker | undefined;
  let ssh: ExtensionHostComposedSshRuntime | undefined;
  const proxy = {
    request(request: Parameters<ExtensionBroker["request"]>[0], signal: AbortSignal) { if (target === undefined) return Promise.reject(new Error("extension composition broker is starting")); return target.request(request, signal); },
    registerManifest(manifest: Parameters<PuzedSshCompositionBroker["registerManifest"]>[0]) { target?.registerManifest(manifest); },
  };
  const profiles: ExtensionProfileBroker = { get(extensionId, providerId, profileId, signal) { if (extensionId !== SSH_EXTENSION_ID || providerId !== "com.terminay.ssh/connection" || ssh === undefined) return Promise.reject(new Error("extension profile access is denied")); return ssh.getProfile(profileId, signal); } };
  const management = createDefaultExtensionManagement({ dataRoot: options.dataRoot, authorityLabel: options.authorityLabel, broker: proxy, ...(options.childEntrypoint === undefined ? {} : { childEntrypoint: options.childEntrypoint }), secrets: options.vault.extensionSecrets, profiles });
  ssh = new ExtensionHostComposedSshRuntime(join(options.dataRoot, "extensions", "composition", "ssh-bindings.v1.json"), management.hosts);
  const projects = new RepositoryCanonicalProjectOpener(options.projectEnvironments, options.workspace);
  const composed = createPuzedSshCompositionBroker({ dataRoot: options.dataRoot, ssh, projects, vault: {
    put: (input) => options.vault.vault.put(input), remove: (id) => options.vault.vault.remove(id),
    bindSshSecret: ({ profileId, fieldId, secretId }) => options.vault.extensionSecrets.upsertBinding({ extensionId: SSH_EXTENSION_ID, profileId, fieldId, secretId }),
    unbindSshSecret: ({ profileId, fieldId }) => options.vault.extensionSecrets.removeBinding(SSH_EXTENSION_ID, profileId, fieldId),
  } });
  target = composed.broker;
  return Object.freeze({ ...management, composition: composed.service, vault: options.vault });
}
