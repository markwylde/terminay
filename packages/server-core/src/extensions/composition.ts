import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ExtensionInstaller } from "./installer.js";
import { ExtensionHostManager } from "./manager.js";
import { NpmCliRegistryClient } from "./npmClient.js";
import type { ExtensionOperationOptions } from "./operations.js";
import type { ExtensionAgentBroker, ExtensionBroker, ExtensionProfileBroker, ExtensionSecretAccessBroker } from "./types.js";
import type { ServerVaultComposition } from "../settings/vaultComposition.js";
import type { ProjectEnvironmentRepository } from "../projectEnvironment/repository.js";
import { ExtensionProfileService } from "./profileService.js";
import { DirectoryBuiltInExtensionArtifactSource } from "./builtInArtifacts.js";

export interface DefaultExtensionManagementOptions { readonly dataRoot: string; readonly authorityLabel: string; readonly broker?: ExtensionBroker; readonly childEntrypoint?: string; readonly secrets?: ExtensionSecretAccessBroker; readonly profiles?: ExtensionProfileBroker; readonly agents?: ExtensionAgentBroker; readonly vault?: ServerVaultComposition; /** Host-owned immutable release resource directory. */ readonly builtInArtifactRoot?: string; }

/** Construct the identical selected-server extension authority for Desktop's
 * embedded server, standalone installations, and containers. */
export function createDefaultExtensionManagement(options: DefaultExtensionManagementOptions): ExtensionOperationOptions & { readonly installer: ExtensionInstaller; readonly hosts: ExtensionHostManager } {
  const broker: ExtensionBroker = options.broker ?? { request: async () => { throw new Error("extension broker capability is unavailable"); } };
  const hosts = new ExtensionHostManager({ broker, ...(options.childEntrypoint === undefined ? {} : { childEntrypoint: options.childEntrypoint }), ...(options.secrets === undefined ? {} : { secrets: options.secrets }), ...(options.profiles === undefined ? {} : { profiles: options.profiles }), ...(options.agents === undefined ? {} : { agents: options.agents }), ...(options.vault === undefined ? {} : { vault: options.vault.vault }) });
  const npm = new NpmCliRegistryClient({ workRoot: join(options.dataRoot, "extensions", "cache", "npm") });
  const installer = new ExtensionInstaller({
    dataRoot: options.dataRoot, registryClient: npm, materializer: npm,
    ...(options.builtInArtifactRoot === undefined ? {} : { builtIns: new DirectoryBuiltInExtensionArtifactSource(options.builtInArtifactRoot) }),
    probe: async ({ extensionId, packageRoot, entrypoint, manifest }) => {
      const root = join(options.dataRoot, "extensions"); const directories = { config: join(root, "config", extensionId), data: join(root, "data", extensionId), cache: join(root, "cache", extensionId) };
      await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })));
      if ("registerManifest" in broker && typeof broker.registerManifest === "function") broker.registerManifest(manifest);
      await hosts.start({ extensionId, packageRoot, entrypoint, configDirectory: directories.config, dataDirectory: directories.data, cacheDirectory: directories.cache, permissions: manifest.permissions, agentProviders: manifest.contributes.agentProviders ?? [], projectEnvironmentProviders: manifest.contributes.projectEnvironments ?? [], extensionDependencies: manifest.extensionDependencies ?? [] }); await hosts.stop(extensionId);
    },
  });
  const activate = async (extensionId: string): Promise<void> => {
    const descriptor = await installer.launchDescriptor(extensionId);
    const root = join(options.dataRoot, "extensions");
    const directories = { config: join(root, "config", extensionId), data: join(root, "data", extensionId), cache: join(root, "cache", extensionId) };
    await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })));
    if ("registerManifest" in broker && typeof broker.registerManifest === "function") broker.registerManifest(descriptor.manifest);
    await hosts.stop(extensionId);
    await hosts.start({ ...descriptor, configDirectory: directories.config, dataDirectory: directories.data, cacheDirectory: directories.cache, permissions: descriptor.manifest.permissions, agentProviders: descriptor.agentProviders, projectEnvironmentProviders: descriptor.manifest.contributes.projectEnvironments ?? [], extensionDependencies: descriptor.manifest.extensionDependencies ?? [] });
  };
  const activateEnabled = async (): Promise<void> => {
    for (const extensionId of await installer.enabledExtensionIds()) {
      try { await activate(extensionId); }
      catch (error) { await installer.setFailureState(extensionId, "failed", error instanceof Error ? error.message : "extension activation failed"); }
    }
  };
  return { installer, hosts, authorityLabel: options.authorityLabel, activate, activateEnabled, restart: activate };
}

/** Production composition for ordinary public project-environment extensions.
 * Provider dependencies are authorized and routed by ExtensionHostManager;
 * this layer contains no SSH/Puzed identities or operation knowledge. */
export function createProductionExtensionManagement(options: Readonly<{ dataRoot: string; authorityLabel: string; childEntrypoint?: string; vault: ServerVaultComposition; projectEnvironments: ProjectEnvironmentRepository; agents?: ExtensionAgentBroker; builtInArtifactRoot?: string }>) {
  let profileService: ExtensionProfileService | undefined;
  const profiles: ExtensionProfileBroker = { async get(extensionId, providerId, profileId, signal) { if (profileService === undefined) throw new Error("extension profile access is unavailable"); return profileService.get(extensionId, providerId, profileId, signal); } };
  const management = createDefaultExtensionManagement({ dataRoot: options.dataRoot, authorityLabel: options.authorityLabel, secrets: options.vault.extensionSecrets, profiles, vault: options.vault, ...(options.childEntrypoint === undefined ? {} : { childEntrypoint: options.childEntrypoint }), ...(options.agents === undefined ? {} : { agents: options.agents }), ...(options.builtInArtifactRoot === undefined ? {} : { builtInArtifactRoot: options.builtInArtifactRoot }) });
  profileService = new ExtensionProfileService(options.projectEnvironments, management.hosts, options.vault);
  return Object.freeze({ ...management, profiles: profileService, vault: options.vault });
}
