import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  TERMINAY_HOST_BOOTSTRAP_VERSION, TERMINAY_HOST_BRIDGE_VERSION,
  TERMINAY_HOST_BYTE_ENDPOINT_VERSION, TERMINAY_HOST_CONTEXT_SCHEMA_VERSION,
  TERMINAY_UI_BUNDLE_FORMAT_VERSION, evaluateTerminayHostCompatibility,
  parseTerminayHostContext, type TerminayHostCapabilityVersions,
  type TerminayHostCompatibilityResult, type TerminayHostContext,
  type TerminayHostRuntimeSupport,
} from "@terminay/protocol";
import { verifyUiBundle, type UiBundleManifest, type VerifiedUiBundle } from "@terminay/ui-bundle";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_PATH = /^[A-Za-z0-9._/-]{1,4096}$/u;

export interface DesktopBundleIdentity { readonly profileId: string; readonly serverId: string; readonly origin: string; }
export interface DesktopLocalBundleArtifact { readonly rootDirectory: string; readonly manifestPath?: string; }
export interface DesktopBundleLaunch {
  readonly context: TerminayHostContext;
  readonly compatibility?: Extract<TerminayHostCompatibilityResult, { compatible: true }>;
  readonly entryPath: string;
  readonly assetRoot: string;
  readonly source: "embedded";
  readonly partitionKey: string;
  readonly byteEndpointHandle: string;
}
export interface DesktopServerBundleHostOptions { readonly capabilities: TerminayHostCapabilityVersions; }

/** Privileged preparation of the one workspace bundle packaged with Desktop.
 * A window runs it for its primary connection and for every attached one, so a
 * remote profile supplies a transport and never bundle bytes: there is no
 * download lane and no per-server verified bundle cache. This yields inert
 * launch metadata only after complete verification and compatibility
 * evaluation of the packaged artifact. */
export class DesktopServerBundleHost {
  private readonly support: TerminayHostRuntimeSupport;
  constructor(options: DesktopServerBundleHostOptions) {
    this.support = Object.freeze({ bootstrapVersion: TERMINAY_HOST_BOOTSTRAP_VERSION, bundleFormatVersion: TERMINAY_UI_BUNDLE_FORMAT_VERSION, hostBridgeVersion: TERMINAY_HOST_BRIDGE_VERSION, byteEndpointVersion: TERMINAY_HOST_BYTE_ENDPOINT_VERSION, capabilities: Object.freeze({ ...options.capabilities }) });
  }

  /** Prepare the packaged bundle artifact bound to one connection identity. */
  async prepareLocal(input: DesktopBundleIdentity & { readonly artifact: DesktopLocalBundleArtifact; readonly windowId: string }): Promise<DesktopBundleLaunch> {
    const identity = normalizeIdentity(input);
    if (!isAbsolute(input.artifact.rootDirectory)) throw new TypeError("embedded bundle root must be absolute");
    const root = resolve(input.artifact.rootDirectory);
    const manifestFile = input.artifact.manifestPath ?? "manifest.json";
    if (!SAFE_PATH.test(manifestFile) || manifestFile.startsWith("/") || manifestFile.includes("..")) throw new TypeError("embedded bundle manifest path is invalid");
    const manifest = JSON.parse(await readFile(join(root, manifestFile), "utf8")) as unknown;
    const parsed = manifest as UiBundleManifest;
    const verified = await verifyUiBundle(manifest, { read: async (assetPath) => readFile(join(root, relativeAssetPath(parsed.bundleId, assetPath))) }, { requireHostCompatibility: true });
    return this.launch(identity, input.windowId, verified, root);
  }

  private launch(identity: DesktopBundleIdentity, windowId: string, bundle: VerifiedUiBundle, assetRoot: string): DesktopBundleLaunch {
    if (!ID.test(windowId)) throw new TypeError("Desktop window id is invalid");
    if (bundle.manifest.hostCompatibility === undefined) throw new Error("UI bundle host compatibility metadata is required");
    const compatibility = evaluateTerminayHostCompatibility(bundle.manifest.hostCompatibility, this.support);
    if (!compatibility.compatible) throw new DesktopBundleCompatibilityError(compatibility);
    const context = parseTerminayHostContext({ schemaVersion: TERMINAY_HOST_CONTEXT_SCHEMA_VERSION, bootstrapVersion: TERMINAY_HOST_BOOTSTRAP_VERSION, sourceId: `source:${randomBytes(18).toString("base64url")}`, windowId, serverId: identity.serverId, profileId: identity.profileId, bundleId: bundle.manifest.bundleId, applicationProtocolVersion: bundle.manifest.protocolVersion, hostKind: "desktop", hostBridgeVersion: TERMINAY_HOST_BRIDGE_VERSION, byteEndpointVersion: TERMINAY_HOST_BYTE_ENDPOINT_VERSION, capabilities: this.support.capabilities });
    return Object.freeze({ context, compatibility, entryPath: relativeAssetPath(bundle.manifest.bundleId, bundle.manifest.entryPath), assetRoot, source: "embedded" as const, partitionKey: createHash("sha256").update(`${identity.serverId}\0${identity.profileId}`).digest("base64url"), byteEndpointHandle: `bytes:${randomBytes(24).toString("base64url")}` });
  }
}

export class DesktopBundleCompatibilityError extends Error {
  constructor(readonly result: Exclude<TerminayHostCompatibilityResult, { compatible: true }>) { super(`Desktop cannot launch this server bundle: ${result.component}/${result.code}`); this.name = "DesktopBundleCompatibilityError"; }
}

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
