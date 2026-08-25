import { randomUUID } from "node:crypto";
import type { JsonValue, ProtocolId } from "@terminay/protocol";
import type { ProjectEnvironmentContribution, ProviderDefinition, ProvisioningResult } from "@terminay/extension-api";
import type { ProjectEnvironmentProviderControl, ProviderControlContext } from "../projectEnvironment/operations.js";
import type { ProjectEnvironmentRepository } from "../projectEnvironment/repository.js";
import type { EnvironmentProfile, ProjectEnvironmentRecord } from "../projectEnvironment/types.js";
import type { ServerVaultComposition } from "../settings/vaultComposition.js";
import type { ExtensionHostManager } from "./manager.js";
import type { ExtensionProfileBroker } from "./types.js";

type PendingProfile = Readonly<{ extensionId: string; profile: EnvironmentProfile }>;

/** Server-owned profile/vault boundary shared by all project-environment
 * extensions. Extension children only receive their own redacted values and
 * transient secret fields through the existing scoped brokers. */
export class ExtensionProfileService implements ExtensionProfileBroker, ProjectEnvironmentProviderControl {
  private readonly pending = new Map<string, PendingProfile>();

  constructor(private readonly repository: ProjectEnvironmentRepository, private readonly hosts: ExtensionHostManager, private readonly vault: ServerVaultComposition) {}

  async get(extensionId: string, providerId: string, profileId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const pending = this.pending.get(profileId);
    const profile = pending?.profile ?? (await this.repository.load()).profiles[profileId];
    if (profile === undefined || profile.providerId !== providerId || this.owner(providerId) !== extensionId || (pending !== undefined && pending.extensionId !== extensionId)) throw new Error("extension profile access is denied");
    const revision = profile.revisions[String(profile.activeRevision)];
    if (revision === undefined || typeof revision.configuration !== "object" || revision.configuration === null || Array.isArray(revision.configuration)) throw new Error("extension profile revision is unavailable");
    const secretFields = revision.secretReferences.map((reference) => {
      const separator = reference.indexOf("=");
      if (separator <= 0) throw new Error("extension profile secret reference is invalid");
      const fieldId = reference.slice(0, separator); const secretId = reference.slice(separator + 1);
      this.vault.extensionSecrets.upsertBinding({ extensionId, profileId, fieldId, secretId });
      return fieldId;
    });
    return { profileId, providerId, revision: profile.activeRevision, values: structuredClone(revision.configuration), secretFields };
  }

  async createProfile(providerId: ProtocolId, values: Readonly<Record<string, string | boolean>>, context: ProviderControlContext) {
    const definition = this.definition(providerId);
    const extensionId = this.owner(providerId);
    const issues = await this.invoke<readonly { message?: string }[]>(providerId, "testProfile", { values }, context);
    if (issues.length > 0) throw new Error(issues.map((issue) => issue.message ?? "profile validation failed").join("; "));
    const profileId = `profile:${randomUUID()}`;
    const secretFields = secretFieldIds(definition).filter((fieldId) => typeof values[fieldId] === "string" && values[fieldId] !== "");
    const secretIds: string[] = [];
    try {
      for (const fieldId of secretFields) {
        const secretId = `extension-profile:${randomUUID()}`;
        const bytes = new TextEncoder().encode(String(values[fieldId]));
        try { await this.vault.vault.put({ id: secretId, label: `${definition.displayName} ${fieldId}`, value: bytes }); }
        finally { bytes.fill(0); }
        this.vault.extensionSecrets.upsertBinding({ extensionId, profileId, fieldId, secretId });
        secretIds.push(secretId);
      }
      const configuration = Object.fromEntries(Object.entries(values).filter(([key]) => !secretFields.includes(key))) as JsonValue;
      const now = Date.now();
      const profile: EnvironmentProfile = { id: profileId, providerId, name: stringValue(values["display-name"], definition.displayName), endpointSummary: stringValue(values.hostname ?? values["base-url"], definition.displayName), ...(typeof values["default-root"] === "string" && values["default-root"] ? { defaultRoot: values["default-root"] } : {}), activeRevision: 1, recommendedRevision: 1, revisions: { "1": { revision: 1, createdAt: now, configuration, secretReferences: secretFields.map((fieldId, index) => `${fieldId}=${secretIds[index]}`) } }, archived: false };
      this.pending.set(profileId, { extensionId, profile });
      const environments = this.profileSaveContribution(providerId)?.profileSave?.createEnvironment === true
        ? [await this.createProfileEnvironment(definition, profile, context)]
        : [];
      return { profile, environments };
    } catch (error) {
      for (const fieldId of secretFields) this.vault.extensionSecrets.removeBinding(extensionId, profileId, fieldId);
      await Promise.allSettled(secretIds.map((secretId) => this.vault.vault.remove(secretId)));
      throw error;
    } finally { this.pending.delete(profileId); }
  }

  async testProfile(profile: EnvironmentProfile, context: ProviderControlContext): Promise<void> {
    const issues = await this.invoke<readonly { message?: string }[]>(profile.providerId, "testProfile", { profileId: profile.id, values: {} }, context);
    if (issues.length > 0) throw new Error(issues.map((issue) => issue.message ?? "profile validation failed").join("; "));
  }

  async updateProfile(profile: EnvironmentProfile, values: Readonly<Record<string, string | boolean>>, context: ProviderControlContext) {
    const definition = this.definition(profile.providerId); const extensionId = this.owner(profile.providerId);
    const current = profile.revisions[String(profile.activeRevision)];
    if (current === undefined || typeof current.configuration !== "object" || current.configuration === null || Array.isArray(current.configuration)) throw new Error("extension profile revision is unavailable");
    const fields = secretFieldIds(definition); const oldSecrets = secretReferences(current.secretReferences); const nextSecrets = new Map(oldSecrets); const createdIds: string[] = [];
    try {
      for (const fieldId of fields) {
        const replacement = values[fieldId]; if (typeof replacement !== "string" || replacement.length === 0) continue;
        const secretId = `extension-profile:${randomUUID()}`; const bytes = new TextEncoder().encode(replacement);
        try { await this.vault.vault.put({ id: secretId, label: `${definition.displayName} ${fieldId}`, value: bytes }); } finally { bytes.fill(0); }
        this.vault.extensionSecrets.upsertBinding({ extensionId, profileId: profile.id, fieldId, secretId }); nextSecrets.set(fieldId, secretId); createdIds.push(secretId);
      }
      const configuration = { ...(current.configuration as Record<string, JsonValue>), ...Object.fromEntries(Object.entries(values).filter(([key]) => !fields.includes(key))) } as JsonValue;
      const revision = profile.activeRevision + 1;
      const updated: EnvironmentProfile = { ...profile, name: stringValue(values["display-name"], profile.name), endpointSummary: stringValue(values.hostname ?? values["base-url"], profile.endpointSummary), ...(typeof values["default-root"] === "string" && values["default-root"] ? { defaultRoot: values["default-root"] } : {}), activeRevision: revision, recommendedRevision: revision, revisions: { ...profile.revisions, [String(revision)]: { revision, createdAt: Date.now(), configuration, secretReferences: [...nextSecrets].map(([fieldId, secretId]) => `${fieldId}=${secretId}`) } } };
      this.pending.set(profile.id, { extensionId, profile: updated }); await this.testProfile(updated, context);
      for (const [fieldId, secretId] of oldSecrets) if (nextSecrets.get(fieldId) !== secretId) await this.vault.vault.remove(secretId);
      return { profile: updated };
    } catch (error) { await Promise.allSettled(createdIds.map((id) => this.vault.vault.remove(id))); for (const [fieldId, secretId] of oldSecrets) this.vault.extensionSecrets.upsertBinding({ extensionId, profileId: profile.id, fieldId, secretId }); throw error; }
    finally { this.pending.delete(profile.id); }
  }

  async removeProfile(profile: EnvironmentProfile): Promise<void> {
    const extensionId = this.owner(profile.providerId); const revision = profile.revisions[String(profile.activeRevision)];
    if (revision === undefined) return;
    const references = secretReferences(revision.secretReferences);
    for (const [fieldId] of references) this.vault.extensionSecrets.removeBinding(extensionId, profile.id, fieldId);
    await Promise.allSettled([...references.values()].map((secretId) => this.vault.vault.remove(secretId)));
  }

  async validateRoot(environment: ProjectEnvironmentRecord, root: string | undefined): Promise<string> { return root ?? environment.defaultRoot ?? "~"; }

  private async createProfileEnvironment(definition: ProviderDefinition, profile: EnvironmentProfile, context: ProviderControlContext): Promise<ProjectEnvironmentRecord> {
    const environmentId = `environment:${randomUUID()}`;
    const result = await this.invoke<ProvisioningResult>(profile.providerId, "createEnvironment", { environmentId, displayName: profile.name, profileId: profile.id, values: {} }, context);
    const ready = result.state === "ready";
    const status = ready ? result.status : undefined;
    return { id: environmentId, providerId: profile.providerId, profileId: profile.id, pinnedRevision: 1, name: profile.name, endpointSummary: profile.endpointSummary, defaultRoot: status?.defaultRoot ?? profile.defaultRoot, declaredCapabilities: definition.capabilities as ProjectEnvironmentRecord["declaredCapabilities"], availableCapabilities: ready ? definition.capabilities as ProjectEnvironmentRecord["availableCapabilities"] : [], status: ready ? "ready" : "provisioning", ...(ready ? { lastSuccessfulCheck: Date.now() } : {}), operationReferences: [], projectReferenceCount: 0, archived: false, builtIn: false, providerState: result.providerState, providerRevision: ready ? result.status.revision : 1 };
  }

  private definition(providerId: string): ProviderDefinition { const value = this.hosts.providerDefinitions().find((item) => item.providerId === providerId); if (value === undefined) throw new Error("project environment provider is unavailable"); return value; }
  private profileSaveContribution(providerId: string): ProjectEnvironmentContribution | undefined { return this.hosts.activatedProjectEnvironmentContributions().find((item) => item.id === providerId); }
  private owner(providerId: string): string { const status = this.hosts.statuses().find((item) => item.providers?.some((provider) => provider.providerId === providerId)); if (status === undefined) throw new Error("project environment provider is unavailable"); return status.extensionId; }
  private invoke<T>(providerId: string, callback: Parameters<ExtensionHostManager["invokeProvider"]>[0]["callback"], request: JsonValue, context: ProviderControlContext): Promise<T> { return this.hosts.invokeProvider({ providerId, callback, request, deadlineMs: context.deadline === undefined ? 30_000 : Math.max(1, context.deadline - Date.now()), ...(context.idempotencyKey === undefined ? {} : { idempotencyKey: context.idempotencyKey }), ...(context.expectedRevision === undefined ? {} : { expectedRevision: context.expectedRevision }), signal: context.signal }) as Promise<T>; }
}

function secretFieldIds(definition: ProviderDefinition): string[] { return definition.profileForm?.sections.flatMap((section) => section.fields.filter((field) => field.type === "secret").map((field) => field.id)) ?? []; }
function secretReferences(references: readonly string[]): Map<string,string> { const result=new Map<string,string>();for(const reference of references){const separator=reference.indexOf("=");if(separator<=0)throw new Error("extension profile secret reference is invalid");result.set(reference.slice(0,separator),reference.slice(separator+1));}return result; }
function stringValue(value: unknown, fallback: string): string { return typeof value === "string" && value.length > 0 ? value : fallback; }
