import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  TERMINAY_HOST_BOOTSTRAP_VERSION, TERMINAY_HOST_BRIDGE_VERSION,
  TERMINAY_HOST_BYTE_ENDPOINT_VERSION, TERMINAY_HOST_CONTEXT_SCHEMA_VERSION,
  TERMINAY_UI_BUNDLE_FORMAT_VERSION, evaluateTerminayHostCompatibility,
  parseTerminayHostContext, type TerminayHostCapabilityVersions,
  type TerminayHostCompatibilityResult, type TerminayHostContext,
  type TerminayHostRuntimeSupport,
} from "@terminay/protocol";
import { UiBundleStore, verifyUiBundle, type UiBundleManifest, type VerifiedUiBundle } from "@terminay/ui-bundle";
import { extractTerminayArchive, parseTerminayArchiveMetadata, type TerminayArchiveMetadata } from "@terminay/ui-bundle/archive";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_PATH = /^[A-Za-z0-9._/-]{1,4096}$/u;

export interface DesktopBundleIdentity { readonly profileId: string; readonly serverId: string; readonly origin: string; }
export interface DesktopArchiveAssetLane { getBundle(): Promise<Uint8Array>; }
export type DesktopAuthenticatedAssetLane =
  | DesktopArchiveAssetLane
  /** Transitional direct-HTTP lane. The authenticated WebRTC path is archive
   * only; this remains until the standalone HTTP server advertises its own
   * archive route. */
  | Readonly<{ manifest(): Promise<unknown>; read(assetPath: string): Promise<Uint8Array>; }>;
export interface DesktopLocalBundleArtifact { readonly rootDirectory: string; readonly manifestPath?: string; }
export interface DesktopBundleLaunch {
  readonly context: TerminayHostContext;
  readonly compatibility?: Extract<TerminayHostCompatibilityResult, { compatible: true }>;
  readonly entryPath: string;
  readonly assetRoot: string;
  readonly source: "embedded" | "remote-cache" | "remote-cache-recovery";
  readonly partitionKey: string;
  readonly byteEndpointHandle: string;
}
export interface DesktopServerBundleHostOptions { readonly cacheRoot: string; readonly capabilities: TerminayHostCapabilityVersions; }

/** Privileged preparation shared by Local and remote. It yields inert launch
 * metadata only after complete verification and compatibility evaluation. */
export class DesktopServerBundleHost {
  private readonly cacheRoot: string;
  private readonly support: TerminayHostRuntimeSupport;
  constructor(options: DesktopServerBundleHostOptions) {
    if (!isAbsolute(options.cacheRoot)) throw new TypeError("Desktop bundle cache root must be absolute");
    this.cacheRoot = resolve(options.cacheRoot);
    this.support = Object.freeze({ bootstrapVersion: TERMINAY_HOST_BOOTSTRAP_VERSION, bundleFormatVersion: TERMINAY_UI_BUNDLE_FORMAT_VERSION, hostBridgeVersion: TERMINAY_HOST_BRIDGE_VERSION, byteEndpointVersion: TERMINAY_HOST_BYTE_ENDPOINT_VERSION, capabilities: Object.freeze({ ...options.capabilities }) });
  }

  async prepareLocal(input: DesktopBundleIdentity & { readonly artifact: DesktopLocalBundleArtifact; readonly windowId: string }): Promise<DesktopBundleLaunch> {
    const identity = normalizeIdentity(input);
    if (!isAbsolute(input.artifact.rootDirectory)) throw new TypeError("embedded bundle root must be absolute");
    const root = resolve(input.artifact.rootDirectory);
    const manifestFile = input.artifact.manifestPath ?? "manifest.json";
    if (!SAFE_PATH.test(manifestFile) || manifestFile.startsWith("/") || manifestFile.includes("..")) throw new TypeError("embedded bundle manifest path is invalid");
    const manifest = JSON.parse(await readFile(join(root, manifestFile), "utf8")) as unknown;
    const parsed = manifest as UiBundleManifest;
    const verified = await verifyUiBundle(manifest, { read: async (assetPath) => readFile(join(root, relativeAssetPath(parsed.bundleId, assetPath))) }, { requireHostCompatibility: true });
    return this.launch(identity, input.windowId, verified, root, "embedded");
  }

  async prepareRemote(input: DesktopBundleIdentity & { readonly lane: DesktopAuthenticatedAssetLane; readonly windowId: string }): Promise<DesktopBundleLaunch> {
    const identity = normalizeIdentity(input);
    const storeRoot = this.serverCacheRoot(identity.serverId);
    try {
      if (!isArchiveAssetLane(input.lane)) {
        const legacyLane = input.lane as Readonly<{ manifest(): Promise<unknown>; read(assetPath: string): Promise<Uint8Array>; }>;
        const store = new UiBundleStore({ rootDirectory: storeRoot, requireHostCompatibility: true });
        const installed = await store.install({ manifest: await legacyLane.manifest(), read: (assetPath) => legacyLane.read(assetPath) });
        return this.launch(identity, input.windowId, installed, join(storeRoot, installed.manifest.bundleId), "remote-cache");
      }
      const installed = await installRemoteArchive(storeRoot, await input.lane.getBundle());
      return this.launchArchive(identity, input.windowId, installed.metadata, installed.rootDirectory, "remote-cache");
    } catch (error) {
      if (!isArchiveAssetLane(input.lane)) {
        const store = new UiBundleStore({ rootDirectory: storeRoot, requireHostCompatibility: true });
        const retained = await store.open().catch(() => undefined);
        if (retained === undefined) throw error;
        return this.launch(identity, input.windowId, retained, join(storeRoot, retained.manifest.bundleId), "remote-cache-recovery");
      }
      const retained = await openRemoteArchive(storeRoot).catch(() => undefined);
      if (retained === undefined) throw error;
      return this.launchArchive(identity, input.windowId, retained.metadata, retained.rootDirectory, "remote-cache-recovery");
    }
  }

  private launch(identity: DesktopBundleIdentity, windowId: string, bundle: VerifiedUiBundle, assetRoot: string, source: DesktopBundleLaunch["source"]): DesktopBundleLaunch {
    if (!ID.test(windowId)) throw new TypeError("Desktop window id is invalid");
    if (bundle.manifest.hostCompatibility === undefined) throw new Error("UI bundle host compatibility metadata is required");
    const compatibility = evaluateTerminayHostCompatibility(bundle.manifest.hostCompatibility, this.support);
    if (!compatibility.compatible) throw new DesktopBundleCompatibilityError(compatibility);
    const context = parseTerminayHostContext({ schemaVersion: TERMINAY_HOST_CONTEXT_SCHEMA_VERSION, bootstrapVersion: TERMINAY_HOST_BOOTSTRAP_VERSION, sourceId: `source:${randomBytes(18).toString("base64url")}`, windowId, serverId: identity.serverId, profileId: identity.profileId, bundleId: bundle.manifest.bundleId, applicationProtocolVersion: bundle.manifest.protocolVersion, hostKind: "desktop", hostBridgeVersion: TERMINAY_HOST_BRIDGE_VERSION, byteEndpointVersion: TERMINAY_HOST_BYTE_ENDPOINT_VERSION, capabilities: this.support.capabilities });
    return Object.freeze({ context, compatibility, entryPath: relativeAssetPath(bundle.manifest.bundleId, bundle.manifest.entryPath), assetRoot, source, partitionKey: createHash("sha256").update(`${identity.serverId}\0${identity.profileId}`).digest("base64url"), byteEndpointHandle: `bytes:${randomBytes(24).toString("base64url")}` });
  }
  private launchArchive(identity: DesktopBundleIdentity, windowId: string, metadata: TerminayArchiveMetadata, assetRoot: string, source: DesktopBundleLaunch["source"]): DesktopBundleLaunch {
    if (!ID.test(windowId)) throw new TypeError("Desktop window id is invalid");
    const context = parseTerminayHostContext({ schemaVersion: TERMINAY_HOST_CONTEXT_SCHEMA_VERSION, bootstrapVersion: TERMINAY_HOST_BOOTSTRAP_VERSION, sourceId: `source:${randomBytes(18).toString("base64url")}`, windowId, serverId: identity.serverId, profileId: identity.profileId, bundleId: metadata.bundleId, applicationProtocolVersion: metadata.applicationProtocolVersion, hostKind: "desktop", hostBridgeVersion: TERMINAY_HOST_BRIDGE_VERSION, byteEndpointVersion: TERMINAY_HOST_BYTE_ENDPOINT_VERSION, capabilities: this.support.capabilities });
    return Object.freeze({ context, entryPath: metadata.entryPath, assetRoot, source, partitionKey: createHash("sha256").update(`${identity.serverId}\0${identity.profileId}`).digest("base64url"), byteEndpointHandle: `bytes:${randomBytes(24).toString("base64url")}` });
  }
  private serverCacheRoot(serverId: string): string { return join(this.cacheRoot, createHash("sha256").update(serverId).digest("hex")); }
}

export class DesktopBundleCompatibilityError extends Error {
  constructor(readonly result: Exclude<TerminayHostCompatibilityResult, { compatible: true }>) { super(`Desktop cannot launch this server bundle: ${result.component}/${result.code}`); this.name = "DesktopBundleCompatibilityError"; }
}

const ARCHIVE_POINTER = "archive-current.json";
const ARCHIVE_METADATA = "terminay-bundle.json";
const MAX_COMPRESSED_ARCHIVE_BYTES = 32 * 1024 * 1024;

/** Stage all archive entries before changing the current pointer. This cache is
 * deliberately separate from the retired manifest cache, so recovery cannot
 * accidentally execute a bundle accepted under the old protocol. */
async function installRemoteArchive(storeRoot: string, compressed: Uint8Array): Promise<Readonly<{ metadata: TerminayArchiveMetadata; rootDirectory: string }>> {
  if (!(compressed instanceof Uint8Array) || compressed.byteLength === 0 || compressed.byteLength > MAX_COMPRESSED_ARCHIVE_BYTES) throw new RangeError("Remote UI archive exceeds the Desktop compressed size limit");
  let expanded: Uint8Array;
  try { expanded = new Uint8Array(gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 })); }
  catch { throw new TypeError("Remote UI archive gzip data is invalid"); }
  const archive = extractTerminayArchive(expanded);
  await mkdir(storeRoot, { recursive: true });
  const rootDirectory = join(storeRoot, archive.metadata.bundleId);
  const staging = join(storeRoot, `.archive-staging-${randomUUID()}`);
  try {
    await mkdir(staging, { recursive: true });
    for (const entry of archive.entries) {
      const destination = archiveChild(staging, entry.path);
      await mkdir(resolve(destination, ".."), { recursive: true });
      await writeFile(destination, entry.bytes, { mode: 0o600 });
    }
    try { await rename(staging, rootDirectory); }
    catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = await openRemoteArchiveById(storeRoot, archive.metadata.bundleId);
      if (existing.metadata.entryPath !== archive.metadata.entryPath || existing.metadata.applicationProtocolVersion !== archive.metadata.applicationProtocolVersion) throw new TypeError("Remote UI archive bundle id conflicts with cached metadata");
      await rm(staging, { recursive: true, force: true });
    }
    await atomicWrite(join(storeRoot, ARCHIVE_POINTER), JSON.stringify({ schemaVersion: 1, bundleId: archive.metadata.bundleId }));
    return Object.freeze({ metadata: archive.metadata, rootDirectory });
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function openRemoteArchive(storeRoot: string): Promise<Readonly<{ metadata: TerminayArchiveMetadata; rootDirectory: string }>> {
  let pointer: unknown;
  try { pointer = JSON.parse(await readFile(join(storeRoot, ARCHIVE_POINTER), "utf8")); }
  catch { throw new Error("Remote UI archive cache is unavailable"); }
  const candidate = pointer as Record<string, unknown>;
  if (typeof pointer !== "object" || pointer === null || candidate.schemaVersion !== 1 || typeof candidate.bundleId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/u.test(candidate.bundleId)) throw new Error("Remote UI archive cache pointer is invalid");
  return openRemoteArchiveById(storeRoot, candidate.bundleId);
}

async function openRemoteArchiveById(storeRoot: string, bundleId: string): Promise<Readonly<{ metadata: TerminayArchiveMetadata; rootDirectory: string }>> {
  const rootDirectory = join(storeRoot, bundleId);
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(rootDirectory, ARCHIVE_METADATA), "utf8")); }
  catch { throw new Error("Remote UI archive metadata is unavailable"); }
  const metadata = parseTerminayArchiveMetadata(raw);
  if (metadata.bundleId !== bundleId) throw new Error("Remote UI archive metadata does not match its cache namespace");
  await readFile(archiveChild(rootDirectory, metadata.entryPath));
  return Object.freeze({ metadata, rootDirectory });
}

function archiveChild(root: string, path: string): string {
  if (!SAFE_PATH.test(path) || path.startsWith("/") || path.includes("..") || path.split("/").some((part) => !part || part === ".")) throw new TypeError("Remote UI archive path is invalid");
  return join(root, path);
}
async function atomicWrite(path: string, body: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, body, { encoding: "utf8", mode: 0o600, flag: "wx" }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }).catch(() => undefined); }
}
function isAlreadyExists(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EEXIST"; }
function isArchiveAssetLane(value: DesktopAuthenticatedAssetLane): value is DesktopArchiveAssetLane { return "getBundle" in value; }

function normalizeIdentity(input: DesktopBundleIdentity): DesktopBundleIdentity {
  if (!ID.test(input.profileId) || !ID.test(input.serverId)) throw new TypeError("Desktop bundle identity is invalid");
  const origin = new URL(input.origin); const loopback = origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if ((!loopback && origin.protocol !== "https:") || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new TypeError("Desktop bundle origin is invalid");
  return Object.freeze({ profileId: input.profileId, serverId: input.serverId, origin: origin.origin });
}
function relativeAssetPath(bundleId: string, assetPath: string): string {
  const prefix = `/remote-app/${bundleId}/`; if (!assetPath.startsWith(prefix)) throw new TypeError("bundle asset is outside its namespace");
  const relative = assetPath.slice(prefix.length); if (!SAFE_PATH.test(relative) || relative.startsWith("/") || relative.split("/").some((part) => part === ".." || part === ".")) throw new TypeError("bundle asset path is invalid"); return relative;
}
