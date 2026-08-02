import type { ProtocolId } from "@terminay/protocol";
import type { ServerSettingsRepository } from "../settings/repository.js";
import { normalizeShellProfile, normalizeShellProfilesSettings } from "./normalize.js";
import {
  ShellProfileDiscoveryError,
  ShellProfileDiscoveryService,
  type ShellDiscoveryResult,
} from "./discovery.js";
import type {
  ResolvedShellProfile,
  ShellProfileCatalogue,
  ShellProfileCatalogueEntry,
  ShellProfileDefinition,
  ShellProfilesSettings,
} from "./types.js";

interface PrivateCatalogueSnapshot {
  readonly discovery: ShellDiscoveryResult;
  readonly definitions: ReadonlyMap<string, ShellProfileDefinition>;
}

export interface ShellProfileCatalogueServiceOptions {
  readonly settings: ServerSettingsRepository;
  readonly discovery: ShellProfileDiscoveryService;
  readonly projectReferences?: (profileId: ProtocolId) => readonly ProtocolId[];
  readonly audit?: (outcome: ShellProfileAuditOutcome) => void;
}

export interface ShellProfileAuditOutcome {
  readonly action: "catalogue" | "validate" | "create" | "update" | "reorder" | "delete" | "set-default" | "set-cwd-policy" | "reset";
  readonly ok: boolean;
  readonly profileId?: ProtocolId;
  readonly code?: string;
}

/** Combines durable profiles and ephemeral host discovery without exposing
 * environment values. The private definition map is tied to the exact public
 * catalogue object so launch cannot mix two settings revisions. */
export class ShellProfileCatalogueService {
  private readonly snapshots = new WeakMap<ShellProfileCatalogue, PrivateCatalogueSnapshot>();
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: ShellProfileCatalogueServiceOptions) {}

  async catalogue(): Promise<ShellProfileCatalogue> {
    try {
    const state = this.options.settings.snapshot();
    const settings = normalizeShellProfilesSettings(state.settings.shellProfiles);
    const discovery = await this.options.discovery.discover();
    const definitions = new Map<string, ShellProfileDefinition>();
    const entries: ShellProfileCatalogueEntry[] = [];

    const systemDefinition = definitionFromEntry(discovery.systemProfile);
    definitions.set(systemDefinition.id, systemDefinition);
    entries.push(withReferences(discovery.systemProfile, this.references(systemDefinition.id)));
    for (const discovered of discovery.discoveredProfiles) {
      const definition = definitionFromEntry(discovered);
      definitions.set(definition.id, definition);
      entries.push(withReferences(discovered, this.references(definition.id)));
    }
    const definitionsById = new Map(settings.profiles.map((definition) => [definition.id, definition]));
    for (const id of settings.order) {
      const definition = definitionsById.get(id);
      if (definition === undefined) continue;
      definitions.set(definition.id, definition);
      entries.push(await this.customEntry(definition, discovery));
    }

    const catalogue: ShellProfileCatalogue = Object.freeze({
      settingsRevision: state.revision,
      defaultProfileId: settings.defaultProfileId,
      cwdPolicy: settings.cwdPolicy,
      entries: Object.freeze(entries),
    });
    if (new TextEncoder().encode(JSON.stringify(catalogue)).byteLength > 60 * 1024) {
      throw new Error("shell profile catalogue exceeds the protocol response budget");
    }
    this.snapshots.set(catalogue, { discovery, definitions });
    this.audit({ action: "catalogue", ok: true });
    return catalogue;
    } catch (error) {
      this.audit({ action: "catalogue", ok: false, code: "unavailable" });
      throw error;
    }
  }

  async resolveProfile(profileId: ProtocolId, catalogue: ShellProfileCatalogue): Promise<ResolvedShellProfile> {
    const snapshot = this.snapshots.get(catalogue);
    if (snapshot === undefined) throw new Error("shell profile catalogue snapshot is unavailable");
    const profile = catalogue.entries.find((entry) => entry.id === profileId);
    const definition = snapshot.definitions.get(profileId);
    if (profile === undefined || definition === undefined) throw new Error("shell profile does not exist");
    if (definition.requiresReview === true || !profile.availability.available) throw new Error("shell profile is unavailable");
    const target = await this.options.discovery.resolveTarget(definition, snapshot.discovery);
    return Object.freeze({ profile, definition, settingsRevision: catalogue.settingsRevision, target });
  }

  async detail(profileId: ProtocolId): Promise<ShellProfileDefinition> {
    const settings = this.currentSettings();
    const profile = settings.profiles.find((candidate) => candidate.id === profileId);
    if (profile === undefined) throw new ShellProfileMutationError("not-found", "custom shell profile not found");
    return structuredClone(profile);
  }

  isDurableProfile(profileId: ProtocolId): boolean {
    const settings = this.currentSettings();
    return profileId === "system" || settings.profiles.some((profile) => profile.id === profileId);
  }

  async validate(profile: unknown) {
    try {
      const normalized = normalizeShellProfile(profile);
      const discoveredValidation = this.options.discovery.validate(normalized, await this.options.discovery.discover());
      const duplicateName = this.currentSettings().profiles.some((candidate) =>
        candidate.id !== normalized.id && candidate.name.toLocaleLowerCase() === normalized.name.toLocaleLowerCase());
      const issues = duplicateName
        ? [...discoveredValidation.issues, { code: "duplicate-name", field: "name", message: "A shell profile with this name already exists." }]
        : [...discoveredValidation.issues];
      const result = Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues) });
      this.audit({ action: "validate", ok: result.valid, profileId: normalized.id, ...(result.valid ? {} : { code: result.issues[0]?.code ?? "invalid" }) });
      return result;
    } catch (error) { this.audit({ action: "validate", ok: false, code: "validation" }); throw error; }
  }

  create(profile: unknown, expectedRevision?: number, commandId?: string) {
    return this.mutate("create", commandId, async () => {
      const current = this.currentSettings();
      const normalized = normalizeShellProfile(profile);
      if (current.profiles.some((entry) => entry.id === normalized.id)) throw new ShellProfileMutationError("conflict", "shell profile already exists");
      this.assertUniqueName(normalized, current);
      await this.assertValid(normalized);
      return this.commit({ ...current, profiles: [...current.profiles, normalized], order: [...current.order, normalized.id] }, expectedRevision, commandId);
    });
  }

  update(profile: unknown, expectedRevision?: number, commandId?: string) {
    return this.mutate("update", commandId, async () => {
      const current = this.currentSettings();
      const normalized = normalizeShellProfile(profile);
      if (!current.profiles.some((entry) => entry.id === normalized.id)) throw new ShellProfileMutationError("not-found", "custom shell profile not found");
      this.assertUniqueName(normalized, current);
      await this.assertValid(normalized);
      return this.commit({ ...current, profiles: current.profiles.map((entry) => entry.id === normalized.id ? normalized : entry) }, expectedRevision, commandId);
    });
  }

  reorder(profileIds: readonly string[], expectedRevision?: number, commandId?: string) {
    return this.mutate("reorder", commandId, () => this.commit({ ...this.currentSettings(), order: profileIds }, expectedRevision, commandId));
  }

  delete(profileId: string, expectedRevision?: number, commandId?: string) {
    return this.mutate("delete", commandId, async () => {
      const current = this.currentSettings();
      if (current.defaultProfileId === profileId) throw new ShellProfileMutationError("referenced", "reassign the server default before deleting this profile");
      const references = this.references(profileId);
      if (references.length > 0) throw new ShellProfileMutationError("referenced", "clear or reassign project defaults before deleting this profile", references);
      if (!current.profiles.some((entry) => entry.id === profileId)) throw new ShellProfileMutationError("not-found", "custom shell profile not found");
      return this.commit({ ...current, profiles: current.profiles.filter((entry) => entry.id !== profileId), order: current.order.filter((id) => id !== profileId) }, expectedRevision, commandId);
    });
  }

  setDefault(profileId: string, expectedRevision?: number, commandId?: string) {
    return this.mutate("set-default", commandId, async () => {
      const current = this.currentSettings();
      if (profileId !== "system" && !current.profiles.some((entry) => entry.id === profileId)) {
        throw new ShellProfileMutationError("not-found", "only System default or a custom profile can be the server default");
      }
      return this.commit({ ...current, defaultProfileId: profileId }, expectedRevision, commandId);
    });
  }

  setCwdPolicy(cwdPolicy: ShellProfilesSettings["cwdPolicy"], expectedRevision?: number, commandId?: string) {
    return this.mutate("set-cwd-policy", commandId, () => this.commit({ ...this.currentSettings(), cwdPolicy }, expectedRevision, commandId));
  }

  reset(expectedRevision?: number, commandId?: string) {
    return this.mutate("reset", commandId, async () => {
      const referenced = this.currentSettings().profiles.flatMap((profile) => this.references(profile.id));
      if (referenced.length > 0) throw new ShellProfileMutationError("referenced", "clear project shell defaults before resetting profiles", referenced);
      return this.commit({ defaultProfileId: "system", cwdPolicy: "current", profiles: [], order: [] }, expectedRevision, commandId);
    });
  }

  private references(profileId: ProtocolId): readonly ProtocolId[] {
    return Object.freeze([...(this.options.projectReferences?.(profileId) ?? [])]);
  }

  private currentSettings(): ShellProfilesSettings {
    return normalizeShellProfilesSettings(this.options.settings.snapshot().settings.shellProfiles);
  }

  private async assertValid(profile: ShellProfileDefinition): Promise<void> {
    const result = this.options.discovery.validate(profile, await this.options.discovery.discover());
    if (!result.valid) throw new ShellProfileMutationError("validation", result.issues[0]?.message ?? "shell profile is invalid");
  }

  private assertUniqueName(profile: ShellProfileDefinition, settings: ShellProfilesSettings): void {
    if (settings.profiles.some((candidate) =>
      candidate.id !== profile.id && candidate.name.toLocaleLowerCase() === profile.name.toLocaleLowerCase())) {
      throw new ShellProfileMutationError("validation", "a shell profile with this name already exists");
    }
  }

  private commit(settings: ShellProfilesSettings, expectedRevision?: number, commandId?: string) {
    const normalized = normalizeShellProfilesSettings(settings);
    return this.options.settings.set("shellProfiles", normalized as unknown as import("@terminay/protocol").JsonValue, expectedRevision, commandId);
  }

  private async mutate<T>(action: ShellProfileAuditOutcome["action"], commandId: string | undefined, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const replay = this.options.settings.commandOutcome(commandId);
      const result = replay === undefined ? await operation() : replay as T;
      this.audit({ action, ok: true });
      return result;
    } catch (error) {
      this.audit({ action, ok: false, code: error instanceof ShellProfileMutationError ? error.code : "internal" });
      throw error;
    } finally { release(); }
  }

  private audit(outcome: ShellProfileAuditOutcome): void { this.options.audit?.(Object.freeze(outcome)); }

  private async customEntry(
    definition: ShellProfileDefinition,
    discovery: ShellDiscoveryResult,
  ): Promise<ShellProfileCatalogueEntry> {
    let availability: ShellProfileCatalogueEntry["availability"] = { available: true };
    if (definition.requiresReview === true) {
      availability = { available: false, reason: "This migrated profile requires review." };
    } else {
      try {
        await this.options.discovery.resolveTarget(definition, discovery);
      } catch (error) {
        availability = {
          available: false,
          reason: error instanceof ShellProfileDiscoveryError && error.code === "unsupported-startup-mode"
            ? "The selected startup mode is unsupported."
            : "The configured shell target is unavailable.",
        };
      }
    }
    return Object.freeze({
      ...redactDefinition(definition),
      kind: "custom",
      readOnly: false,
      source: definition.requiresReview === true ? "migrated" : "custom",
      availability: Object.freeze(availability),
      projectReferences: this.references(definition.id),
    });
  }
}

export class ShellProfileMutationError extends Error {
  constructor(
    readonly code: "validation" | "not-found" | "conflict" | "referenced" | "review-required",
    message: string,
    readonly projectIds: readonly string[] = [],
  ) { super(message); this.name = "ShellProfileMutationError"; }
}

function definitionFromEntry(entry: ShellProfileCatalogueEntry): ShellProfileDefinition {
  return Object.freeze({
    id: entry.id,
    name: entry.name,
    target: structuredClone(entry.target),
    args: Object.freeze([...entry.args]),
    startupMode: entry.startupMode,
    environment: Object.freeze({}),
    ...(entry.icon === undefined ? {} : { icon: entry.icon }),
    ...(entry.color === undefined ? {} : { color: entry.color }),
    ...(entry.requiresReview === true ? { requiresReview: true } : {}),
  });
}

function redactDefinition(definition: ShellProfileDefinition): Omit<ShellProfileCatalogueEntry, "kind" | "readOnly" | "source" | "availability" | "projectReferences"> {
  return {
    id: definition.id,
    name: definition.name,
    target: structuredClone(definition.target),
    // Full argv is privileged profile detail and server-private launch data.
    args: Object.freeze([]),
    startupMode: definition.startupMode,
    ...(definition.icon === undefined ? {} : { icon: definition.icon }),
    ...(definition.color === undefined ? {} : { color: definition.color }),
    ...(definition.requiresReview === true ? { requiresReview: true } : {}),
    environmentEntryCount: Object.keys(definition.environment).length,
    hasEnvironmentOverlay: Object.keys(definition.environment).length > 0,
    argumentCount: definition.args.length,
  };
}

function withReferences(entry: ShellProfileCatalogueEntry, projectReferences: readonly ProtocolId[]): ShellProfileCatalogueEntry {
  return Object.freeze({ ...entry, projectReferences });
}
