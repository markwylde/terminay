import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { OFFICIAL_EXTENSION_CATALOGUE } from "./catalog.js";
import { EXTENSION_API_VERSION, parseExtensionManifest } from "@terminay/extension-api";
import type { BuiltInExtensionArtifact, BuiltInExtensionArtifactSource, ExtensionInstallPreview, ExtensionMaterializer, ExtensionReceipt, ExtensionReferences, ExtensionRegistryClient, ExtensionRegistrySnapshot, InstalledExtensionRecord, RegistryPackageResolution } from "./installerTypes.js";
import { parsePublicNpmSpec } from "./npmClient.js";
import { validateMaterializedExtension } from "./packageValidation.js";
import { inspectNpmPackArchive, MAX_EXTENSION_ARCHIVE_BYTES } from "./npmPackArchive.js";

const WARNING = "This is third-party trusted code. It runs on the selected Terminay Server and can access files and networks available to that server account.";
const EMPTY: ExtensionRegistrySnapshot = Object.freeze({ schemaVersion: 1, revision: 0, extensions: Object.freeze({}) });

export interface ExtensionInstallerOptions {
  readonly dataRoot: string;
  readonly registryClient: ExtensionRegistryClient;
  readonly materializer: ExtensionMaterializer;
  /** Optional host-owned release inventory. Supplying this never grants a
   * network install path; each artifact is copied and revalidated locally. */
  readonly builtIns?: BuiltInExtensionArtifactSource;
  readonly now?: () => number;
  readonly probe?: (input: { extensionId: string; packageRoot: string; entrypoint: string; manifest: ExtensionReceipt["manifest"] }) => Promise<void>;
  readonly references?: (extensionId: string) => Promise<ExtensionReferences>;
  readonly audit?: (event: Readonly<Record<string, unknown>>) => Promise<void> | void;
  /** Runs after a recoverable data snapshot exists and before the active code
   * pointer changes. Throwing restores the snapshot and preserves old code. */
  readonly migrateData?: (input: Readonly<{ extensionId: string; fromVersion: string; toVersion: string; dataRoot: string }>) => Promise<void>;
  /** Optional selected-server lifecycle hook. It runs after a complete
   * built-in reconciliation transaction, so a running host can activate every
   * newly selected enabled slot before reconciliation resolves to callers. */
  readonly onBuiltInsReconciled?: (before: ExtensionRegistrySnapshot, after: ExtensionRegistrySnapshot) => Promise<void>;
}

/** Transactional immutable-slot installer. The active registry pointer is the
 * sole commit point and is written only after tree validation and probing. */
export class ExtensionInstaller {
  private readonly root: string;
  private readonly previews = new Map<string, ExtensionInstallPreview>();
  private readonly previewTimers = new Map<string, NodeJS.Timeout>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: ExtensionInstallerOptions) { this.root = join(options.dataRoot, "extensions"); }

  async initialize(): Promise<ExtensionRegistrySnapshot> {
    await Promise.all([mkdir(join(this.root, "packages"), { recursive: true }), mkdir(join(this.root, "staging"), { recursive: true }), mkdir(join(this.root, "uploads"), { recursive: true }), mkdir(join(this.root, "data"), { recursive: true }), mkdir(join(this.root, "cache"), { recursive: true })]);
    await this.recoverStaging();
    return this.reconcileBuiltIns();
  }

  /** Reconcile release-shipped rollback floors without changing a user's
   * current selection or enabled state. One invalid artifact is isolated to
   * that extension; a healthy built-in remains available offline. */
  async reconcileBuiltIns(signal?: AbortSignal): Promise<ExtensionRegistrySnapshot> {
    let before: ExtensionRegistrySnapshot | undefined;
    const reconciled = await this.serial(async () => {
      if (this.options.builtIns === undefined) return this.snapshot();
      const artifacts = orderBuiltIns(await this.options.builtIns.list(signal));
      let state = await this.snapshot();
      before = state;
      for (const artifact of artifacts) {
        try {
          state = await this.installBuiltInExact(artifact, state, signal);
        } catch (error) {
          const existing = state.extensions[artifact.extensionId];
          state = await this.commit(state, existing === undefined
            ? { extensionId: artifact.extensionId, packageName: artifact.packageName, state: "failed", enabled: true, slots: {}, failureClass: safeFailure(error) }
            : { ...existing, state: "failed", failureClass: safeFailure(error) }, "extension.built_in_failed");
          await this.options.audit?.({ kind: "extension.built_in_failed", extensionId: artifact.extensionId, packageName: artifact.packageName, version: artifact.version, failureClass: safeFailure(error) });
        }
      }
      return state;
    });
    if (before !== undefined) await this.options.onBuiltInsReconciled?.(before, reconciled);
    return this.snapshot();
  }

  async previewArchive(filename: string, bytes: Uint8Array): Promise<ExtensionInstallPreview> {
    if (!/^[^/\\\0]{1,200}\.tgz$/iu.test(filename)) throw new Error("choose an npm pack .tgz package file");
    if (bytes.byteLength > MAX_EXTENSION_ARCHIVE_BYTES) throw new Error("extension package file exceeds the 12 MiB limit");
    const inspected = await inspectNpmPackArchive(bytes);
    const packageName = inspected.packageJson.name; const version = inspected.packageJson.version;
    if (typeof packageName !== "string" || typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) throw new Error("extension package archive is missing an exact name and version");
    parsePublicNpmSpec(`${packageName}@${version}`);
    const manifest = parseExtensionManifest(inspected.packageJson.terminay);
    const uploadId = randomUUID(); const archivePath = join(this.root, "uploads", `${uploadId}.tgz`);
    await writeFile(archivePath, bytes, { flag: "wx", mode: 0o600 });
    const expiresAt = (this.options.now ?? Date.now)() + 10 * 60_000;
    const resolution: RegistryPackageResolution = Object.freeze({ packageName, version, integrity: inspected.integrity, source: "uploaded", uploadedFilename: filename, archivePath, manifestMetadata: inspected.packageJson.terminay, provenance: "unverified", dependencyCount: typeof inspected.packageJson.dependencies === "object" && inspected.packageJson.dependencies !== null ? Object.keys(inspected.packageJson.dependencies).length : 0 });
    const previewDigest = digest(canonicalJson({ packageName, version, integrity: inspected.integrity, manifest, expiresAt, uploadId }));
    const preview = Object.freeze({ ...resolution, previewDigest, expiresAt, official: false, trustedCodeWarning: WARNING, declaredPermissions: Object.freeze([...manifest.permissions]), declaredProviderIds: Object.freeze((manifest.contributes.projectEnvironments ?? []).map((provider) => provider.id)) });
    this.previews.set(previewDigest, preview);
    this.expirePreview(previewDigest, preview);
    return preview;
  }

  async preview(spec: string, signal?: AbortSignal): Promise<ExtensionInstallPreview> {
    const { packageName, selector } = parsePublicNpmSpec(spec);
    const resolution = await this.options.registryClient.resolve(packageName, selector, signal);
    validateResolution(resolution, packageName);
    const manifest = parseExtensionManifest(resolution.manifestMetadata);
    const official = OFFICIAL_EXTENSION_CATALOGUE.some((item) => item.packageName === packageName);
    const expiresAt = (this.options.now ?? Date.now)() + 10 * 60_000;
    const previewDigest = digest(canonicalJson({ resolution, manifest, expiresAt }));
    const preview = Object.freeze({ ...resolution, previewDigest, expiresAt, official, declaredPermissions: Object.freeze([...manifest.permissions]), declaredProviderIds: Object.freeze((manifest.contributes.projectEnvironments ?? []).map((provider) => provider.id)), ...(!official ? { trustedCodeWarning: WARNING } : {}) });
    this.previews.set(previewDigest, preview);
    this.expirePreview(previewDigest, preview);
    return preview;
  }

  confirm(previewDigest: string, signal?: AbortSignal): Promise<ExtensionRegistrySnapshot> {
    return this.serial(async () => {
      const preview = this.previews.get(previewDigest);
      this.previews.delete(previewDigest);
      const timer = this.previewTimers.get(previewDigest); if (timer !== undefined) clearTimeout(timer); this.previewTimers.delete(previewDigest);
      if (preview === undefined || preview.expiresAt < (this.options.now ?? Date.now)()) { await cleanupArchive(preview); throw new Error("extension install preview expired or changed"); }
      try { return await this.installExact(preview, signal); } finally { await cleanupArchive(preview); }
    });
  }

  confirmedPreview(previewDigest: string): ExtensionInstallPreview | undefined { return this.previews.get(previewDigest); }

  disable(extensionId: string): Promise<ExtensionRegistrySnapshot> { return this.serial(async () => {
    const state = await this.snapshot(); const current = required(state, extensionId);
    const refs = await this.references(extensionId);
    if ((refs.activeUses ?? 0) > 0) throw new Error("extension is in active use and must be drained before disabling");
    return this.commit(state, { ...current, enabled: false, state: "disabled" }, "extension.disabled");
  }); }

  enable(extensionId: string): Promise<ExtensionRegistrySnapshot> { return this.serial(async () => {
    const state = await this.snapshot(); const current = required(state, extensionId);
    if (current.activeSlotId === undefined) throw new Error("extension has no active slot");
    const slot = current.slots[current.activeSlotId];
    if (slot === undefined) throw new Error("active extension slot is missing");
    await this.probe(slot.receipt, this.slotPackageRoot(slot));
    return this.commit(state, { ...current, enabled: true, state: "installed", failureClass: undefined }, "extension.enabled");
  }); }

  rollback(extensionId: string): Promise<ExtensionRegistrySnapshot> { return this.serial(async () => {
    const state = await this.snapshot(); const current = required(state, extensionId);
    if (current.previousSlotId === undefined) throw new Error("no retained known-good slot is available");
    const refs = await this.references(extensionId); if ((refs.activeUses ?? 0) > 0) throw new Error("extension is in active use and must be drained before rollback");
    const slot = current.slots[current.previousSlotId]; if (slot === undefined) throw new Error("retained extension slot is missing"); await this.probe(slot.receipt, this.slotPackageRoot(slot));
    const next = { ...current, activeSlotId: slot.slotId, previousSlotId: current.activeSlotId, pendingSlotId: undefined, state: current.enabled ? "installed" as const : "disabled" as const };
    return this.commit(state, next, "extension.rolled_back");
  }); }

  activatePending(extensionId: string): Promise<ExtensionRegistrySnapshot> { return this.serial(async () => {
    const state = await this.snapshot(); const current = required(state, extensionId);
    if (current.pendingSlotId === undefined) throw new Error("extension has no pending update");
    const refs = await this.references(extensionId); if ((refs.activeUses ?? 0) > 0) throw new Error("extension is in active use and must be drained before activation");
    const slot = current.slots[current.pendingSlotId]; if (slot === undefined) throw new Error("pending extension slot is missing");
    await this.probe(slot.receipt, this.slotPackageRoot(slot));
    const active = current.activeSlotId === undefined ? undefined : current.slots[current.activeSlotId];
    if (active !== undefined && active.version !== slot.version) await this.migrateData(current, active.version, slot.version, state.revision + 1);
    return this.commit(state, { ...current, activeSlotId: slot.slotId, previousSlotId: current.activeSlotId, pendingSlotId: undefined, state: current.enabled ? "installed" : "disabled" }, "extension.updated");
  }); }

  setFailureState(extensionId: string, stateValue: "failed" | "quarantined" | "incompatible", failureClass: string): Promise<ExtensionRegistrySnapshot> { return this.serial(async () => {
    const state = await this.snapshot(); const current = required(state, extensionId);
    return this.commit(state, { ...current, state: stateValue, failureClass: safeFailure(failureClass) }, `extension.${stateValue}`);
  }); }

  async diagnostics(): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const state = await this.snapshot();
    return Object.freeze(Object.values(state.extensions).map((record) => Object.freeze({ extensionId: record.extensionId, packageName: record.packageName, state: record.state, enabled: record.enabled, activeVersion: record.activeSlotId === undefined ? undefined : record.slots[record.activeSlotId]?.version, slotCount: Object.keys(record.slots).length, failureClass: record.failureClass })));
  }

  async backupManifest(): Promise<Readonly<{ registry: string; dataRoot: string; receipts: readonly string[] }>> {
    const state = await this.snapshot();
    return Object.freeze({ registry: this.registryPath(), dataRoot: join(this.root, "data"), receipts: Object.values(state.extensions).flatMap((record) => Object.values(record.slots).map((slot) => join(this.root, "packages", slot.slotId, "terminay-receipt.json"))).sort() });
  }

  remove(extensionId: string): Promise<ExtensionRegistrySnapshot> { return this.serial(async () => {
    const state = await this.snapshot(); const current = required(state, extensionId); const refs = await this.references(extensionId);
    const bundled = bundledSlots(current);
    if (bundled.length > 0) return this.removeOverride(state, current, bundled, refs);
    const reasons = [...(current.enabled ? ["enabled"] : []), ...((refs.profiles ?? 0) ? ["profiles"] : []), ...((refs.environments ?? 0) ? ["environments"] : []), ...((refs.projects ?? 0) ? ["projects"] : []), ...((refs.activeUses ?? 0) ? ["active uses"] : []), ...((refs.dependants?.length ?? 0) ? ["dependent extensions"] : [])];
    if (reasons.length > 0) throw new Error(`extension removal is blocked by ${reasons.join(", ")}`);
    const extensions = { ...state.extensions }; delete extensions[extensionId]; const next = await this.write({ schemaVersion: 1, revision: state.revision + 1, extensions });
    await this.options.audit?.({ kind: "extension.removed", extensionId, revision: next.revision });
    for (const slot of Object.values(current.slots)) await rm(join(this.root, "packages", slot.slotId), { recursive: true, force: true });
    return next;
  }); }

  async snapshot(): Promise<ExtensionRegistrySnapshot> {
    try { const parsed: unknown = JSON.parse(await readFile(this.registryPath(), "utf8")); return validateRegistry(parsed); }
    catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return EMPTY; throw error; }
  }

  async launchDescriptor(extensionId: string): Promise<Readonly<{ extensionId: string; packageRoot: string; entrypoint: string; agentProviders: readonly import("@terminay/extension-api").AgentProviderContribution[]; manifest: ExtensionReceipt["manifest"] }>> {
    const state = await this.snapshot();
    const current = required(state, extensionId);
    if (!current.enabled || current.activeSlotId === undefined) throw new Error("extension is not enabled with an active slot");
    const slot = current.slots[current.activeSlotId];
    if (slot === undefined) throw new Error("active extension slot is missing");
    return Object.freeze({ extensionId, packageRoot: this.slotPackageRoot(slot), entrypoint: slot.receipt.manifest.entrypoint, agentProviders: Object.freeze(structuredClone(slot.receipt.manifest.contributes.agentProviders ?? [])), manifest: slot.receipt.manifest });
  }

  async enabledExtensionIds(): Promise<readonly string[]> {
    const state = await this.snapshot();
    return Object.freeze(Object.values(state.extensions)
      .filter((record) => record.enabled && record.activeSlotId !== undefined && record.state !== "incompatible" && record.state !== "quarantined")
      .map((record) => record.extensionId)
      .sort());
  }

  private async installExact(resolution: ExtensionInstallPreview, signal?: AbortSignal): Promise<ExtensionRegistrySnapshot> {
    return this.installResolved(resolution, (staging) => this.options.materializer.materialize(resolution, staging, signal));
  }

  private async installBuiltInExact(artifact: BuiltInExtensionArtifact, state: ExtensionRegistrySnapshot, signal?: AbortSignal): Promise<ExtensionRegistrySnapshot> {
    if (artifact.source !== "built-in") throw new Error("built-in artifact source is invalid");
    return this.installResolved(artifact, (staging) => {
      if (this.options.builtIns === undefined) return Promise.reject(new Error("built-in extension source is unavailable"));
      return this.options.builtIns.materialize(artifact, staging, signal);
    }, state);
  }

  private async installResolved(resolution: RegistryPackageResolution, materialize: (staging: string) => Promise<void>, suppliedState?: ExtensionRegistrySnapshot): Promise<ExtensionRegistrySnapshot> {
    const operationId = randomUUID(); const staging = join(this.root, "staging", operationId);
    try {
      await materialize(staging);
      const state = suppliedState ?? await this.snapshot();
      const installedExtensions = new Map(Object.values(state.extensions).flatMap((record) => {
        const slot = record.activeSlotId === undefined ? undefined : record.slots[record.activeSlotId];
        return slot === undefined ? [] : [[record.extensionId, { apiVersion: EXTENSION_API_VERSION }] as const];
      }));
      const validated = await validateMaterializedExtension(staging, resolution, installedExtensions);
      if (isBuiltInResolution(resolution) && (validated.inventoryHash !== resolution.inventoryHash || validated.lockHash !== resolution.lockHash)) throw new Error("built-in extension artifact digest differs from release inventory");
      const previewManifest = parseExtensionManifest(resolution.manifestMetadata);
      if (canonicalJson(previewManifest) !== canonicalJson(validated.manifest)) throw new Error("materialized extension manifest differs from the confirmed preview");
      const slotId = `${validated.manifest.id}-${resolution.version}-${validated.inventoryHash.slice(0, 16)}`.replace(/[^a-zA-Z0-9._-]/gu, "_");
      const receipt: ExtensionReceipt = Object.freeze({ schemaVersion: 1, extensionId: validated.manifest.id, slotId, packageName: resolution.packageName, version: resolution.version, integrity: resolution.integrity, source: resolution.source ?? "npmjs", ...(resolution.uploadedFilename ? { uploadedFilename: resolution.uploadedFilename } : {}), ...(resolution.tarballUrl ? { tarballUrl: resolution.tarballUrl } : {}), installedAt: new Date((this.options.now ?? Date.now)()).toISOString(), npmVersion: this.options.materializer.npmVersion, lockHash: validated.lockHash, inventoryHash: validated.inventoryHash, permissions: Object.freeze([...validated.manifest.permissions]), manifest: validated.manifest, ...(resolution.provenance ? { provenance: resolution.provenance } : {}), ...(resolution.audit ? { audit: resolution.audit } : {}) });
      await writeFile(join(staging, "terminay-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
      const packageRoot = join(staging, "node_modules", ...resolution.packageName.split("/"));
      await this.probe(receipt, packageRoot);
      const destination = join(this.root, "packages", slotId);
      try { await rename(staging, destination); } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && (error.code === "EEXIST" || error.code === "ENOTEMPTY"))) throw error;
        await rm(staging, { recursive: true, force: true });
      }
      const persisted = state.extensions[receipt.extensionId];
      if (persisted !== undefined && persisted.packageName !== receipt.packageName && resolution.source !== "built-in") throw new Error("extension identity is already owned by another package");
      // Built-in IDs are release-owned identities. Older Terminay versions could
      // leave a failed manual-install placeholder under one of those IDs. A
      // verified release artifact must be able to replace that unusable record,
      // while retaining the user's explicit enabled/disabled choice.
      const replacingLegacyBuiltInConflict = resolution.source === "built-in" && persisted !== undefined && persisted.packageName !== receipt.packageName;
      const previous = replacingLegacyBuiltInConflict ? undefined : persisted;
      if (resolution.source === "built-in" && previous?.slots[slotId] !== undefined) {
        await rm(staging, { recursive: true, force: true });
        return state;
      }
      const slot = Object.freeze({ slotId, version: receipt.version, receipt, knownGood: true });
      const slots = Object.freeze({ ...(previous?.slots ?? {}), [slotId]: slot });
      const refs = await this.references(receipt.extensionId);
      const activeUses = refs.activeUses ?? 0;
      const preserveSelection = resolution.source === "built-in" && previous?.activeSlotId !== undefined;
      const immediateUpdate = !preserveSelection && previous?.activeSlotId !== undefined && activeUses === 0 && previous.activeSlotId !== slotId;
      if (immediateUpdate) {
        const active = previous.slots[previous.activeSlotId];
        if (active === undefined) throw new Error("active extension slot is missing");
        await this.migrateData(previous, active.version, slot.version, state.revision + 1);
      }
      const enabled = persisted?.enabled ?? true;
      const next: InstalledExtensionRecord = Object.freeze({ extensionId: receipt.extensionId, packageName: receipt.packageName, state: enabled === false ? "disabled" : activeUses > 0 && previous?.activeSlotId && !preserveSelection ? "pending" : "installed", enabled, activeSlotId: preserveSelection || (activeUses > 0 && previous?.activeSlotId) ? previous.activeSlotId : slotId, ...(previous?.activeSlotId && previous.activeSlotId !== slotId && !preserveSelection ? { previousSlotId: previous.activeSlotId } : {}), ...(activeUses > 0 && previous?.activeSlotId && !preserveSelection ? { pendingSlotId: slotId } : {}), slots });
      return this.commit(state, next, "extension.installed");
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      await this.options.audit?.({ kind: "extension.install_failed", packageName: resolution.packageName, version: resolution.version, failureClass: safeFailure(error) });
      throw error;
    }
  }

  /** `remove` on a built-in record means remove the selected external
   * override, never remove the release rollback floor. */
  private async removeOverride(state: ExtensionRegistrySnapshot, current: InstalledExtensionRecord, bundled: readonly import("./installerTypes.js").ExtensionSlotRecord[], refs: ExtensionReferences): Promise<ExtensionRegistrySnapshot> {
    const active = current.activeSlotId === undefined ? undefined : current.slots[current.activeSlotId];
    if (active?.receipt.source === "built-in") throw new Error("built-in extension rollback floor cannot be removed");
    const reasons = [...((refs.profiles ?? 0) ? ["profiles"] : []), ...((refs.environments ?? 0) ? ["environments"] : []), ...((refs.projects ?? 0) ? ["projects"] : []), ...((refs.activeUses ?? 0) ? ["active uses"] : []), ...((refs.dependants?.length ?? 0) ? ["dependent extensions"] : [])];
    if (reasons.length > 0) throw new Error(`extension override removal is blocked by ${reasons.join(", ")}`);
    const floor = newestBundledSlot(bundled);
    await this.probe(floor.receipt, this.slotPackageRoot(floor));
    if (active !== undefined && active.version !== floor.version) await this.migrateData(current, active.version, floor.version, state.revision + 1);
    const slots = Object.freeze(Object.fromEntries(bundled.map((slot) => [slot.slotId, slot])));
    const next = await this.commit(state, { ...current, slots, activeSlotId: floor.slotId, previousSlotId: undefined, pendingSlotId: undefined, state: current.enabled ? "installed" : "disabled" }, "extension.override_removed");
    for (const slot of Object.values(current.slots)) if (slot.receipt.source !== "built-in") await rm(join(this.root, "packages", slot.slotId), { recursive: true, force: true });
    return next;
  }

  private async commit(state: ExtensionRegistrySnapshot, record: InstalledExtensionRecord, kind: string): Promise<ExtensionRegistrySnapshot> {
    const next = await this.write({ schemaVersion: 1, revision: state.revision + 1, extensions: { ...state.extensions, [record.extensionId]: record } });
    await this.options.audit?.({ kind, extensionId: record.extensionId, revision: next.revision, version: record.activeSlotId ? record.slots[record.activeSlotId]?.version : undefined });
    return next;
  }
  private async write(state: ExtensionRegistrySnapshot): Promise<ExtensionRegistrySnapshot> { await mkdir(dirname(this.registryPath()), { recursive: true }); const temporary = `${this.registryPath()}.${randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 }); await rename(temporary, this.registryPath()); return validateRegistry(state); }
  private async recoverStaging(): Promise<void> { for (const name of ["staging", "uploads"]) { const directory = join(this.root, name); await rm(directory, { recursive: true, force: true }); await mkdir(directory, { recursive: true }); } }
  private async migrateData(current: InstalledExtensionRecord, fromVersion: string, toVersion: string, revision: number): Promise<void> {
    const source = join(this.root, "data", current.extensionId);
    const destination = join(this.root, "data-snapshots", current.extensionId, String(revision));
    let snapshotExists = false;
    try { await cp(source, destination, { recursive: true, errorOnExist: true }); snapshotExists = true; }
    catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error; }
    try { await this.options.migrateData?.({ extensionId: current.extensionId, fromVersion, toVersion, dataRoot: source }); }
    catch (error) {
      await rm(source, { recursive: true, force: true });
      if (snapshotExists) await cp(destination, source, { recursive: true });
      throw error;
    }
  }
  private async references(extensionId: string): Promise<ExtensionReferences> { return this.options.references?.(extensionId) ?? {}; }
  private async probe(receipt: ExtensionReceipt, packageRoot: string): Promise<void> { await this.options.probe?.({ extensionId: receipt.extensionId, packageRoot, entrypoint: receipt.manifest.entrypoint, manifest: receipt.manifest }); }
  private expirePreview(digestValue: string, preview: ExtensionInstallPreview): void { const timer = setTimeout(() => { if (this.previews.get(digestValue) !== preview) return; this.previews.delete(digestValue); this.previewTimers.delete(digestValue); void cleanupArchive(preview); }, Math.max(1, preview.expiresAt - (this.options.now ?? Date.now)())); timer.unref?.(); this.previewTimers.set(digestValue, timer); }
  private slotPackageRoot(slot: { receipt: ExtensionReceipt }): string { return join(this.root, "packages", slot.receipt.slotId, "node_modules", ...slot.receipt.packageName.split("/")); }
  private registryPath(): string { return join(this.root, "registry.v1.json"); }
  private serial<T>(work: () => Promise<T>): Promise<T> { const result = this.queue.then(work, work); this.queue = result.then(() => undefined, () => undefined); return result; }
}

function orderBuiltIns(artifacts: readonly BuiltInExtensionArtifact[]): readonly BuiltInExtensionArtifact[] {
  const remaining = new Map(artifacts.map((artifact) => [artifact.extensionId, artifact]));
  const ordered: BuiltInExtensionArtifact[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((artifact) => builtInDependencies(artifact).every((id) => !remaining.has(id)));
    const next = (ready.length > 0 ? ready : [...remaining.values()]).sort((left, right) => left.extensionId.localeCompare(right.extensionId))[0];
    if (next === undefined) break;
    ordered.push(next);
    remaining.delete(next.extensionId);
  }
  return Object.freeze(ordered);
}

function builtInDependencies(artifact: BuiltInExtensionArtifact): readonly string[] {
  const metadata = artifact.manifestMetadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return [];
  const dependencies = (metadata as { extensionDependencies?: unknown }).extensionDependencies;
  if (!Array.isArray(dependencies)) return [];
  return dependencies.flatMap((dependency) => typeof dependency === "object" && dependency !== null && !Array.isArray(dependency) && typeof (dependency as { extensionId?: unknown }).extensionId === "string" ? [(dependency as { extensionId: string }).extensionId] : []);
}

function validateResolution(value: RegistryPackageResolution, expectedName: string): void { if (value.packageName !== expectedName || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value.version) || !/^(?:sha512|sha256)-[A-Za-z0-9+/=]+$/u.test(value.integrity)) throw new Error("npmjs resolution is not exact or lacks integrity"); if (value.tarballUrl !== undefined && !value.tarballUrl.startsWith("https://registry.npmjs.org/")) throw new Error("resolved tarball is not hosted by public npmjs"); }
async function cleanupArchive(preview: ExtensionInstallPreview | undefined): Promise<void> { if (preview?.source === "uploaded" && preview.archivePath !== undefined) await rm(preview.archivePath, { force: true }); }
function validateRegistry(value: unknown): ExtensionRegistrySnapshot { if (typeof value !== "object" || value === null || Array.isArray(value) || (value as { schemaVersion?: unknown }).schemaVersion !== 1 || !Number.isSafeInteger((value as { revision?: unknown }).revision) || typeof (value as { extensions?: unknown }).extensions !== "object" || (value as { extensions?: unknown }).extensions === null) throw new Error("extension registry is invalid"); return structuredClone(value) as ExtensionRegistrySnapshot; }
function required(state: ExtensionRegistrySnapshot, id: string): InstalledExtensionRecord { const value = state.extensions[id]; if (value === undefined) throw new Error("extension is not installed"); return value; }
function isBuiltInResolution(value: RegistryPackageResolution): value is BuiltInExtensionArtifact { return value.source === "built-in" && typeof (value as Partial<BuiltInExtensionArtifact>).extensionId === "string" && typeof (value as Partial<BuiltInExtensionArtifact>).inventoryHash === "string" && typeof (value as Partial<BuiltInExtensionArtifact>).lockHash === "string"; }
function bundledSlots(record: InstalledExtensionRecord): readonly import("./installerTypes.js").ExtensionSlotRecord[] { return Object.values(record.slots).filter((slot) => slot.receipt.source === "built-in"); }
function newestBundledSlot(slots: readonly import("./installerTypes.js").ExtensionSlotRecord[]): import("./installerTypes.js").ExtensionSlotRecord { const value = [...slots].sort((left, right) => compareVersion(right.version, left.version))[0]; if (value === undefined) throw new Error("built-in extension rollback floor is missing"); return value; }
function compareVersion(left: string, right: string): number { const parse = (value: string) => value.split(/[.+-]/u, 3).map((part) => Number(part)); const [leftMajor = 0, leftMinor = 0, leftPatch = 0] = parse(left); const [rightMajor = 0, rightMinor = 0, rightPatch = 0] = parse(right); return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch || left.localeCompare(right); }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function canonicalJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (typeof value === "object" && value !== null) return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`; return JSON.stringify(value) ?? "null"; }
function safeFailure(error: unknown): string { const message = error instanceof Error ? error.message : typeof error === "string" ? error : "unknown"; return message.toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 80); }
