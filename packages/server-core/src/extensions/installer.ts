import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { OFFICIAL_EXTENSION_CATALOGUE } from "./catalog.js";
import { parseExtensionManifest } from "@terminay/extension-api";
import type { ExtensionInstallPreview, ExtensionMaterializer, ExtensionReceipt, ExtensionReferences, ExtensionRegistryClient, ExtensionRegistrySnapshot, InstalledExtensionRecord, RegistryPackageResolution } from "./installerTypes.js";
import { parsePublicNpmSpec } from "./npmClient.js";
import { validateMaterializedExtension } from "./packageValidation.js";

const WARNING = "This is third-party trusted code. It runs on the selected Terminay Server and can access files and networks available to that server account.";
const EMPTY: ExtensionRegistrySnapshot = Object.freeze({ schemaVersion: 1, revision: 0, extensions: Object.freeze({}) });

export interface ExtensionInstallerOptions {
  readonly dataRoot: string;
  readonly registryClient: ExtensionRegistryClient;
  readonly materializer: ExtensionMaterializer;
  readonly now?: () => number;
  readonly probe?: (input: { extensionId: string; packageRoot: string; entrypoint: string; manifest: ExtensionReceipt["manifest"] }) => Promise<void>;
  readonly references?: (extensionId: string) => Promise<ExtensionReferences>;
  readonly audit?: (event: Readonly<Record<string, unknown>>) => Promise<void> | void;
  /** Runs after a recoverable data snapshot exists and before the active code
   * pointer changes. Throwing restores the snapshot and preserves old code. */
  readonly migrateData?: (input: Readonly<{ extensionId: string; fromVersion: string; toVersion: string; dataRoot: string }>) => Promise<void>;
}

/** Transactional immutable-slot installer. The active registry pointer is the
 * sole commit point and is written only after tree validation and probing. */
export class ExtensionInstaller {
  private readonly root: string;
  private readonly previews = new Map<string, ExtensionInstallPreview>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: ExtensionInstallerOptions) { this.root = join(options.dataRoot, "extensions"); }

  async initialize(): Promise<ExtensionRegistrySnapshot> {
    await Promise.all([mkdir(join(this.root, "packages"), { recursive: true }), mkdir(join(this.root, "staging"), { recursive: true }), mkdir(join(this.root, "data"), { recursive: true }), mkdir(join(this.root, "cache"), { recursive: true })]);
    await this.recoverStaging();
    return this.snapshot();
  }

  async preview(spec: string, signal?: AbortSignal): Promise<ExtensionInstallPreview> {
    const { packageName, selector } = parsePublicNpmSpec(spec);
    const resolution = await this.options.registryClient.resolve(packageName, selector, signal);
    validateResolution(resolution, packageName);
    const manifest = parseExtensionManifest(resolution.manifestMetadata);
    const official = OFFICIAL_EXTENSION_CATALOGUE.some((item) => item.packageName === packageName);
    const expiresAt = (this.options.now ?? Date.now)() + 10 * 60_000;
    const previewDigest = digest(canonicalJson({ resolution, manifest, expiresAt }));
    const preview = Object.freeze({ ...resolution, previewDigest, expiresAt, official, declaredPermissions: Object.freeze([...manifest.permissions]), declaredProviderIds: Object.freeze(manifest.contributes.projectEnvironments.map((provider) => provider.id)), ...(!official ? { trustedCodeWarning: WARNING } : {}) });
    this.previews.set(previewDigest, preview);
    return preview;
  }

  confirm(previewDigest: string, signal?: AbortSignal): Promise<ExtensionRegistrySnapshot> {
    return this.serial(async () => {
      const preview = this.previews.get(previewDigest);
      this.previews.delete(previewDigest);
      if (preview === undefined || preview.expiresAt < (this.options.now ?? Date.now)()) throw new Error("extension install preview expired or changed");
      return this.installExact(preview, signal);
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

  private async installExact(resolution: ExtensionInstallPreview, signal?: AbortSignal): Promise<ExtensionRegistrySnapshot> {
    const operationId = randomUUID(); const staging = join(this.root, "staging", operationId);
    try {
      await this.options.materializer.materialize(resolution, staging, signal);
      const validated = await validateMaterializedExtension(staging, resolution);
      const previewManifest = parseExtensionManifest(resolution.manifestMetadata);
      if (canonicalJson(previewManifest) !== canonicalJson(validated.manifest)) throw new Error("materialized extension manifest differs from the confirmed preview");
      const slotId = `${validated.manifest.id}-${resolution.version}-${validated.inventoryHash.slice(0, 16)}`.replace(/[^a-zA-Z0-9._-]/gu, "_");
      const receipt: ExtensionReceipt = Object.freeze({ schemaVersion: 1, extensionId: validated.manifest.id, slotId, packageName: resolution.packageName, version: resolution.version, integrity: resolution.integrity, ...(resolution.tarballUrl ? { tarballUrl: resolution.tarballUrl } : {}), installedAt: new Date((this.options.now ?? Date.now)()).toISOString(), npmVersion: this.options.materializer.npmVersion, lockHash: validated.lockHash, inventoryHash: validated.inventoryHash, permissions: Object.freeze([...validated.manifest.permissions]), manifest: validated.manifest, ...(resolution.provenance ? { provenance: resolution.provenance } : {}), ...(resolution.audit ? { audit: resolution.audit } : {}) });
      await writeFile(join(staging, "terminay-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
      const packageRoot = join(staging, "node_modules", ...resolution.packageName.split("/"));
      await this.probe(receipt, packageRoot);
      const destination = join(this.root, "packages", slotId);
      try { await rename(staging, destination); } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && (error.code === "EEXIST" || error.code === "ENOTEMPTY"))) throw error;
        await rm(staging, { recursive: true, force: true });
      }
      const state = await this.snapshot(); const previous = state.extensions[receipt.extensionId];
      if (previous !== undefined && previous.packageName !== receipt.packageName) throw new Error("extension identity is already owned by another package");
      const slot = Object.freeze({ slotId, version: receipt.version, receipt, knownGood: true });
      const slots = Object.freeze({ ...(previous?.slots ?? {}), [slotId]: slot });
      const refs = await this.references(receipt.extensionId);
      const activeUses = refs.activeUses ?? 0;
      const immediateUpdate = previous?.activeSlotId !== undefined && activeUses === 0 && previous.activeSlotId !== slotId;
      if (immediateUpdate) {
        const active = previous.slots[previous.activeSlotId];
        if (active === undefined) throw new Error("active extension slot is missing");
        await this.migrateData(previous, active.version, slot.version, state.revision + 1);
      }
      const next: InstalledExtensionRecord = Object.freeze({ extensionId: receipt.extensionId, packageName: receipt.packageName, state: activeUses > 0 && previous?.activeSlotId ? "pending" : "installed", enabled: previous?.enabled ?? true, activeSlotId: activeUses > 0 && previous?.activeSlotId ? previous.activeSlotId : slotId, ...(previous?.activeSlotId && previous.activeSlotId !== slotId ? { previousSlotId: previous.activeSlotId } : {}), ...(activeUses > 0 && previous?.activeSlotId ? { pendingSlotId: slotId } : {}), slots });
      return this.commit(state, next, "extension.installed");
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      await this.options.audit?.({ kind: "extension.install_failed", packageName: resolution.packageName, version: resolution.version, failureClass: safeFailure(error) });
      throw error;
    }
  }

  private async commit(state: ExtensionRegistrySnapshot, record: InstalledExtensionRecord, kind: string): Promise<ExtensionRegistrySnapshot> {
    const next = await this.write({ schemaVersion: 1, revision: state.revision + 1, extensions: { ...state.extensions, [record.extensionId]: record } });
    await this.options.audit?.({ kind, extensionId: record.extensionId, revision: next.revision, version: record.activeSlotId ? record.slots[record.activeSlotId]?.version : undefined });
    return next;
  }
  private async write(state: ExtensionRegistrySnapshot): Promise<ExtensionRegistrySnapshot> { await mkdir(dirname(this.registryPath()), { recursive: true }); const temporary = `${this.registryPath()}.${randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 }); await rename(temporary, this.registryPath()); return validateRegistry(state); }
  private async recoverStaging(): Promise<void> { const staging = join(this.root, "staging"); await rm(staging, { recursive: true, force: true }); await mkdir(staging, { recursive: true }); }
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
  private async probe(receipt: ExtensionReceipt, packageRoot: string): Promise<void> { await this.options.probe?.({ extensionId: receipt.extensionId, packageRoot, entrypoint: join(packageRoot, receipt.manifest.entrypoint), manifest: receipt.manifest }); }
  private slotPackageRoot(slot: { receipt: ExtensionReceipt }): string { return join(this.root, "packages", slot.receipt.slotId, "node_modules", ...slot.receipt.packageName.split("/")); }
  private registryPath(): string { return join(this.root, "registry.v1.json"); }
  private serial<T>(work: () => Promise<T>): Promise<T> { const result = this.queue.then(work, work); this.queue = result.then(() => undefined, () => undefined); return result; }
}

function validateResolution(value: RegistryPackageResolution, expectedName: string): void { if (value.packageName !== expectedName || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value.version) || !/^(?:sha512|sha256)-[A-Za-z0-9+/=]+$/u.test(value.integrity)) throw new Error("npmjs resolution is not exact or lacks integrity"); if (value.tarballUrl !== undefined && !value.tarballUrl.startsWith("https://registry.npmjs.org/")) throw new Error("resolved tarball is not hosted by public npmjs"); }
function validateRegistry(value: unknown): ExtensionRegistrySnapshot { if (typeof value !== "object" || value === null || Array.isArray(value) || (value as { schemaVersion?: unknown }).schemaVersion !== 1 || !Number.isSafeInteger((value as { revision?: unknown }).revision) || typeof (value as { extensions?: unknown }).extensions !== "object" || (value as { extensions?: unknown }).extensions === null) throw new Error("extension registry is invalid"); return structuredClone(value) as ExtensionRegistrySnapshot; }
function required(state: ExtensionRegistrySnapshot, id: string): InstalledExtensionRecord { const value = state.extensions[id]; if (value === undefined) throw new Error("extension is not installed"); return value; }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function canonicalJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (typeof value === "object" && value !== null) return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`; return JSON.stringify(value) ?? "null"; }
function safeFailure(error: unknown): string { const message = error instanceof Error ? error.message : typeof error === "string" ? error : "unknown"; return message.toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 80); }
