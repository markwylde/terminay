import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ExtensionInstaller } from "./installer.js";
import { ExtensionHostManager } from "./manager.js";
import { NpmCliRegistryClient } from "./npmClient.js";
import type { ExtensionOperationOptions } from "./operations.js";
import type { ExtensionAgentBroker, ExtensionBroker, ExtensionProfileBroker, ExtensionSecretAccessBroker } from "./types.js";
import type { ServerVaultComposition } from "../settings/vaultComposition.js";
import type { ProjectEnvironmentRepository } from "../projectEnvironment/repository.js";
import type { WorkspaceStore } from "../workspace.js";
import { createPuzedSshCompositionBroker, SSH_EXTENSION_ID, type PuzedSshCompositionBroker } from "./puzedSshComposition.js";
import { ExtensionHostComposedSshRuntime } from "./composedSshRuntime.js";
import { RepositoryCanonicalProjectOpener } from "./puzedSshProjectAdapter.js";
import { ExtensionProfileService } from "./profileService.js";
import { DirectoryBuiltInExtensionArtifactSource } from "./builtInArtifacts.js";

export interface DefaultExtensionManagementOptions { readonly dataRoot: string; readonly authorityLabel: string; readonly broker?: ExtensionBroker; readonly childEntrypoint?: string; readonly secrets?: ExtensionSecretAccessBroker; readonly profiles?: ExtensionProfileBroker; readonly agents?: ExtensionAgentBroker; /** Host-owned immutable release resource directory. */ readonly builtInArtifactRoot?: string; }

/** Construct the identical selected-server extension authority for Desktop's
 * embedded server, standalone installations, and containers. */
export function createDefaultExtensionManagement(options: DefaultExtensionManagementOptions): ExtensionOperationOptions & { readonly installer: ExtensionInstaller; readonly hosts: ExtensionHostManager } {
  const broker: ExtensionBroker = options.broker ?? { request: async () => { throw new Error("extension broker capability is unavailable"); } };
  const hosts = new ExtensionHostManager({ broker, ...(options.childEntrypoint === undefined ? {} : { childEntrypoint: options.childEntrypoint }), ...(options.secrets === undefined ? {} : { secrets: options.secrets }), ...(options.profiles === undefined ? {} : { profiles: options.profiles }), ...(options.agents === undefined ? {} : { agents: options.agents }) });
  const npm = new NpmCliRegistryClient({ workRoot: join(options.dataRoot, "extensions", "cache", "npm") });
  const installer = new ExtensionInstaller({
    dataRoot: options.dataRoot, registryClient: npm, materializer: npm,
    ...(options.builtInArtifactRoot === undefined ? {} : { builtIns: new DirectoryBuiltInExtensionArtifactSource(options.builtInArtifactRoot) }),
    probe: async ({ extensionId, packageRoot, entrypoint, manifest }) => {
      const root = join(options.dataRoot, "extensions"); const directories = { config: join(root, "config", extensionId), data: join(root, "data", extensionId), cache: join(root, "cache", extensionId) };
      await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })));
      if ("registerManifest" in broker && typeof broker.registerManifest === "function") broker.registerManifest(manifest);
      await hosts.start({ extensionId, packageRoot, entrypoint, configDirectory: directories.config, dataDirectory: directories.data, cacheDirectory: directories.cache, permissions: manifest.permissions, agentProviders: manifest.contributes.agentProviders ?? [] }); await hosts.stop(extensionId);
    },
  });
  const activate = async (extensionId: string): Promise<void> => {
    const descriptor = await installer.launchDescriptor(extensionId);
    const root = join(options.dataRoot, "extensions");
    const directories = { config: join(root, "config", extensionId), data: join(root, "data", extensionId), cache: join(root, "cache", extensionId) };
    await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })));
    if ("registerManifest" in broker && typeof broker.registerManifest === "function") broker.registerManifest(descriptor.manifest);
    await hosts.stop(extensionId);
    await hosts.start({ ...descriptor, configDirectory: directories.config, dataDirectory: directories.data, cacheDirectory: directories.cache, permissions: descriptor.manifest.permissions, agentProviders: descriptor.agentProviders });
  };
  const activateEnabled = async (): Promise<void> => {
    for (const extensionId of await installer.enabledExtensionIds()) {
      try { await activate(extensionId); }
      catch (error) { await installer.setFailureState(extensionId, "failed", error instanceof Error ? error.message : "extension activation failed"); }
    }
  };
  return { installer, hosts, authorityLabel: options.authorityLabel, activate, activateEnabled, restart: activate };
}

export function createPuzedSshProductionExtensionManagement(options: Readonly<{ dataRoot: string; authorityLabel: string; childEntrypoint?: string; vault: ServerVaultComposition; projectEnvironments: ProjectEnvironmentRepository; workspace: WorkspaceStore; agents?: ExtensionAgentBroker; builtInArtifactRoot?: string }>) {
  let target: PuzedSshCompositionBroker | undefined;
  let ssh: ExtensionHostComposedSshRuntime | undefined;
  let profileService: ExtensionProfileService | undefined;
  const proxy = {
    request(request: Parameters<ExtensionBroker["request"]>[0], signal: AbortSignal) { if (target === undefined) return Promise.reject(new Error("extension composition broker is starting")); return target.request(request, signal); },
    registerManifest(manifest: Parameters<PuzedSshCompositionBroker["registerManifest"]>[0]) { target?.registerManifest(manifest); },
  };
  const profiles: ExtensionProfileBroker = { async get(extensionId, providerId, profileId, signal) { if (extensionId === SSH_EXTENSION_ID && providerId === "com.terminay.ssh/connection" && ssh !== undefined && profileId.startsWith("composed:")) return ssh.getProfile(profileId, signal); if (profileService === undefined) throw new Error("extension profile access is unavailable"); return profileService.get(extensionId, providerId, profileId, signal); } };
  const management = createDefaultExtensionManagement({ dataRoot: options.dataRoot, authorityLabel: options.authorityLabel, broker: proxy, ...(options.childEntrypoint === undefined ? {} : { childEntrypoint: options.childEntrypoint }), secrets: options.vault.extensionSecrets, profiles, ...(options.agents === undefined ? {} : { agents: options.agents }), ...(options.builtInArtifactRoot === undefined ? {} : { builtInArtifactRoot: options.builtInArtifactRoot }) });
  ssh = new ExtensionHostComposedSshRuntime(join(options.dataRoot, "extensions", "composition", "ssh-bindings.v1.json"), management.hosts);
  profileService = new ExtensionProfileService(options.projectEnvironments, management.hosts, options.vault);
  const projects = new RepositoryCanonicalProjectOpener(options.projectEnvironments, options.workspace);
  const composed = createPuzedSshCompositionBroker({ dataRoot: options.dataRoot, ssh, projects, vault: {
    put: (input) => options.vault.vault.put(input), remove: (id) => options.vault.vault.remove(id),
    bindSshSecret: ({ profileId, fieldId, secretId }) => options.vault.extensionSecrets.upsertBinding({ extensionId: SSH_EXTENSION_ID, profileId, fieldId, secretId }),
    unbindSshSecret: ({ profileId, fieldId }) => options.vault.extensionSecrets.removeBinding(SSH_EXTENSION_ID, profileId, fieldId),
  } });
  target = composed.broker;
  return Object.freeze({ ...management, profiles: profileService, composition: composed.service, vault: options.vault });
}
