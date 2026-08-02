import { createHash } from "node:crypto";
import { parseTerminayHostCompatibilityRequirements } from "@terminay/protocol";
import type {
  UiBundleAsset,
  UiBundleAssetReader,
  UiBundleErrorCode,
  UiBundleIdentityMetadata,
  UiBundleLimits,
  UiBundleManifest,
  VerifiedUiBundle,
} from "./types.js";

type ResolvedUiBundleLimits = Required<
  Omit<UiBundleLimits, "requireHostCompatibility">
>;

const DEFAULT_LIMITS: ResolvedUiBundleLimits = Object.freeze({
  maxAssets: 1_024,
  maxAssetBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxPathBytes: 512,
  maxContentTypeBytes: 256,
});
const BUNDLE_ID = /^[A-Za-z0-9_-]{8,128}$/;
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/;

/**
 * The only CSP accepted for a server-bundled workspace. Keeping this in the
 * verified manifest contract means Local, standalone, and host-shell serving
 * cannot silently drift to different browser policies.
 */
export const DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export class UiBundleError extends Error {
  readonly code: UiBundleErrorCode;
  constructor(code: UiBundleErrorCode, message: string) {
    super(message);
    this.name = "UiBundleError";
    this.code = code;
  }
}

/**
 * Validate and normalize the wire manifest before it can influence a local
 * origin or an asset transfer. Paths are intentionally absolute within the
 * server's `/remote-app/<bundle-id>/` namespace; they are never filesystem
 * paths supplied by a client.
 */
export function validateUiBundleManifest(
  value: unknown,
  options: UiBundleLimits = {},
): UiBundleManifest {
  const { requireHostCompatibility = false, ...limitOptions } = options;
  if (typeof requireHostCompatibility !== "boolean")
    throw new UiBundleError(
      "validation",
      "invalid UI bundle host compatibility policy",
    );
  const limits = resolveLimits(limitOptions);
  if (!isRecord(value) || value.schemaVersion !== 1)
    throw new UiBundleError(
      "validation",
      "unsupported UI bundle manifest schema",
    );
  const bundleId = stringField(value.bundleId, "bundleId", BUNDLE_ID);
  const protocolVersion = stringField(
    value.protocolVersion,
    "protocolVersion",
    VERSION,
  );
  const serverVersion = stringField(
    value.serverVersion,
    "serverVersion",
    VERSION,
  );
  // Older on-disk manifests are accepted for migration, but every verified
  // manifest is emitted with the canonical policy. A supplied policy must
  // match exactly so a bundle cannot weaken the host's browser boundary.
  const contentSecurityPolicy =
    value.contentSecurityPolicy === undefined
      ? DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY
      : stringField(value.contentSecurityPolicy, "contentSecurityPolicy");
  if (contentSecurityPolicy !== DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY) {
    throw new UiBundleError(
      "validation",
      "UI bundle content security policy is not supported",
    );
  }
  const hasHostCompatibility =
    value.bundleFormatVersion !== undefined ||
    value.hostCompatibility !== undefined;
  if (
    hasHostCompatibility &&
    (value.bundleFormatVersion !== 1 || value.hostCompatibility === undefined)
  ) {
    throw new UiBundleError(
      "validation",
      "UI bundle host compatibility metadata is incomplete",
    );
  }
  if (requireHostCompatibility && !hasHostCompatibility) {
    throw new UiBundleError(
      "validation",
      "UI bundle host compatibility metadata is required",
    );
  }
  let hostCompatibility: UiBundleManifest["hostCompatibility"];
  if (hasHostCompatibility) {
    try {
      hostCompatibility = parseTerminayHostCompatibilityRequirements(
        value.hostCompatibility,
      );
    } catch (error) {
      throw new UiBundleError(
        "validation",
        error instanceof Error
          ? error.message
          : "UI bundle host compatibility metadata is invalid",
      );
    }
  }
  if (!Array.isArray(value.assets) || value.assets.length === 0)
    throw new UiBundleError(
      "validation",
      "UI bundle manifest must contain assets",
    );
  if (value.assets.length > limits.maxAssets)
    throw new UiBundleError("limit", "UI bundle asset count exceeds the limit");

  const assets: UiBundleAsset[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const candidate of value.assets) {
    if (!isRecord(candidate))
      throw new UiBundleError(
        "validation",
        "UI bundle asset must be an object",
      );
    const path = stringField(candidate.path, "asset path");
    assertBundlePath(path, bundleId, limits.maxPathBytes);
    if (seen.has(path))
      throw new UiBundleError(
        "validation",
        `duplicate UI bundle asset path: ${path}`,
      );
    seen.add(path);
    const contentType = stringField(
      candidate.contentType,
      "asset content type",
    );
    if (
      byteLength(contentType) > limits.maxContentTypeBytes ||
      /[\r\n]/u.test(contentType)
    )
      throw new UiBundleError("validation", "invalid UI bundle content type");
    const hash = stringField(candidate.hash, "asset hash", SHA256_BASE64URL);
    const size = unsignedInteger(candidate.size, "asset size");
    if (size > limits.maxAssetBytes)
      throw new UiBundleError(
        "limit",
        `UI bundle asset exceeds the ${limits.maxAssetBytes}-byte limit`,
      );
    totalBytes += size;
    if (totalBytes > limits.maxTotalBytes)
      throw new UiBundleError(
        "limit",
        "UI bundle exceeds the total byte limit",
      );
    assets.push(Object.freeze({ contentType, hash, path, size }));
  }

  const entryPath = stringField(value.entryPath, "entryPath");
  assertBundlePath(entryPath, bundleId, limits.maxPathBytes);
  if (!seen.has(entryPath))
    throw new UiBundleError(
      "validation",
      "UI bundle entry path is not present in assets",
    );
  const entry = assets.find((asset) => asset.path === entryPath);
  // The entry point is the document that establishes the isolated session UI.
  // Do not let a manifest claim an arbitrary binary/style asset as that
  // document: doing so would bypass the complete executable/style graph check
  // below and leave the host with an invalid browser launch target.
  if (entry === undefined || !isHtmlContentType(entry.contentType)) {
    throw new UiBundleError(
      "validation",
      "UI bundle entry path must declare an HTML document",
    );
  }
  const identity =
    hostCompatibility === undefined
      ? undefined
      : {
          bundleFormatVersion: 1 as const,
          protocolVersion,
          serverVersion,
          hostCompatibility,
        };
  const derivedBundleId = deriveUiBundleId(assets, bundleId, identity);
  if (derivedBundleId !== bundleId)
    throw new UiBundleError(
      "integrity",
      "UI bundle id does not match its asset hashes",
    );
  return Object.freeze({
    schemaVersion: 1,
    bundleId,
    entryPath,
    protocolVersion,
    serverVersion,
    contentSecurityPolicy,
    ...(hostCompatibility === undefined
      ? {}
      : { bundleFormatVersion: 1 as const, hostCompatibility }),
    assets: Object.freeze(assets),
  });
}

/** Derive the deterministic id used in asset paths and manifests. */
export function deriveUiBundleId(
  assets: readonly UiBundleAsset[],
  expectedBundleId?: string,
  identity?: UiBundleIdentityMetadata,
): string {
  const assetInventory = assets
    .map(
      (asset) =>
        `${relativeAssetPath(asset.path, expectedBundleId)}:${asset.hash}`,
    )
    .sort()
    .join("\n");
  const canonical =
    identity === undefined
      ? assetInventory
      : `${assetInventory}\n--identity--\n${canonicalBundleIdentity(identity)}`;
  return createHash("sha256")
    .update(canonical)
    .digest("base64url")
    .slice(0, 32);
}

export function uiBundleIdentity(
  manifest: UiBundleManifest,
): UiBundleIdentityMetadata | undefined {
  if (
    manifest.bundleFormatVersion !== 1 ||
    manifest.hostCompatibility === undefined
  )
    return undefined;
  return Object.freeze({
    bundleFormatVersion: 1,
    protocolVersion: manifest.protocolVersion,
    serverVersion: manifest.serverVersion,
    hostCompatibility: manifest.hostCompatibility,
  });
}

/**
 * Read and hash every listed asset once at startup. The returned reader only
 * serves bytes from this verified, bounded snapshot, so a file replacement
 * cannot turn a previously verified manifest into different UI code.
 */
export async function verifyUiBundle(
  value: unknown,
  reader: UiBundleAssetReader,
  options: UiBundleLimits = {},
): Promise<VerifiedUiBundle> {
  const manifest = validateUiBundleManifest(value, options);
  const bytesByPath = new Map<string, Uint8Array>();
  for (const asset of manifest.assets) {
    const raw = await reader.read(asset.path);
    if (!(raw instanceof Uint8Array))
      throw new UiBundleError(
        "integrity",
        `UI bundle reader returned invalid bytes for ${asset.path}`,
      );
    if (raw.byteLength !== asset.size)
      throw new UiBundleError(
        "integrity",
        `UI bundle asset size mismatch for ${asset.path}`,
      );
    const hash = createHash("sha256").update(raw).digest("base64url");
    if (hash !== asset.hash)
      throw new UiBundleError(
        "integrity",
        `UI bundle asset hash mismatch for ${asset.path}`,
      );
    bytesByPath.set(asset.path, new Uint8Array(raw));
  }
  assertEntryDocumentAssetsAreDeclared(manifest, bytesByPath);
  return Object.freeze({
    manifest,
    read(path: string): Uint8Array {
      const bytes = bytesByPath.get(path);
      if (bytes === undefined)
        throw new UiBundleError(
          "not_found",
          `UI bundle asset is not declared: ${path}`,
        );
      return new Uint8Array(bytes);
    },
  });
}

/**
 * A verified entry document must not be able to load an undeclared script or
 * stylesheet. This closes the gap between checking every listed byte and
 * proving that the browser-visible application graph is actually represented
 * by the content-addressed manifest.
 *
 * Deliberately only executable/style document references are considered here.
 * Images, anchors, and data/blob URLs are governed by CSP and may be dynamic
 * application content rather than part of the application code graph.
 */
function assertEntryDocumentAssetsAreDeclared(
  manifest: UiBundleManifest,
  bytesByPath: ReadonlyMap<string, Uint8Array>,
): void {
  const entry = bytesByPath.get(manifest.entryPath);
  if (entry === undefined)
    throw new UiBundleError(
      "integrity",
      "UI bundle entry document is unavailable",
    );
  const entryAsset = manifest.assets.find(
    (asset) => asset.path === manifest.entryPath,
  );
  if (entryAsset === undefined || !isHtmlContentType(entryAsset.contentType)) {
    throw new UiBundleError("integrity", "UI bundle entry document is invalid");
  }

  let document: string;
  try {
    document = new TextDecoder("utf-8", { fatal: true }).decode(entry);
  } catch {
    throw new UiBundleError(
      "integrity",
      "UI bundle entry document is not valid UTF-8",
    );
  }
  const references = document.matchAll(
    /<(?:script\b[^>]*\bsrc|link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*\bhref)\s*=\s*(["'])([^"']+)\1/giu,
  );
  for (const match of references) {
    const reference = match[2];
    if (
      reference === undefined ||
      reference.startsWith("data:") ||
      reference.startsWith("blob:")
    )
      continue;
    const resolved = resolveEntryAssetReference(manifest, reference);
    if (!bytesByPath.has(resolved)) {
      throw new UiBundleError(
        "integrity",
        `UI bundle entry document references an undeclared asset: ${reference}`,
      );
    }
  }
}

function resolveEntryAssetReference(
  manifest: UiBundleManifest,
  reference: string,
): string {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(reference) || reference.startsWith("//")) {
    throw new UiBundleError(
      "integrity",
      `UI bundle entry document references an external asset: ${reference}`,
    );
  }
  const withoutFragment = reference.split(/[?#]/u, 1)[0] ?? "";
  if (withoutFragment.length === 0)
    throw new UiBundleError(
      "integrity",
      "UI bundle entry document references an empty asset",
    );
  if (withoutFragment.startsWith(`/remote-app/${manifest.bundleId}/`))
    return withoutFragment;
  // Vite emits root-relative asset URLs (`/assets/...`). LocalUiServer maps
  // those at request time into this verified bundle namespace.
  if (withoutFragment.startsWith("/"))
    return `/remote-app/${manifest.bundleId}${withoutFragment}`;
  return new URL(
    withoutFragment,
    `http://ui-bundle.invalid${manifest.entryPath}`,
  ).pathname;
}

function resolveLimits(
  options: Omit<UiBundleLimits, "requireHostCompatibility">,
): ResolvedUiBundleLimits {
  const limits = { ...DEFAULT_LIMITS, ...options };
  for (const [key, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new UiBundleError("validation", `invalid UI bundle limit: ${key}`);
  return limits;
}

function canonicalBundleIdentity(identity: UiBundleIdentityMetadata): string {
  const requirements = parseTerminayHostCompatibilityRequirements(
    identity.hostCompatibility,
  );
  const capabilities = (value: typeof requirements.requiredCapabilities) =>
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  return JSON.stringify({
    bundleFormatVersion: identity.bundleFormatVersion,
    protocolVersion: stringField(
      identity.protocolVersion,
      "protocolVersion",
      VERSION,
    ),
    serverVersion: stringField(
      identity.serverVersion,
      "serverVersion",
      VERSION,
    ),
    hostCompatibility: {
      bootstrap: requirements.bootstrap,
      bundleFormat: requirements.bundleFormat,
      hostBridge: requirements.hostBridge,
      byteEndpoint: requirements.byteEndpoint,
      executionRuntime: requirements.executionRuntime,
      requiredCapabilities: capabilities(requirements.requiredCapabilities),
      optionalCapabilities: capabilities(requirements.optionalCapabilities),
    },
  });
}

function assertBundlePath(
  path: string,
  bundleId: string,
  maxPathBytes: number,
): void {
  if (
    byteLength(path) > maxPathBytes ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.includes("?") ||
    path.includes("#")
  )
    throw new UiBundleError("validation", "UI bundle path is invalid");
  const prefix = `/remote-app/${bundleId}/`;
  if (!path.startsWith(prefix))
    throw new UiBundleError(
      "validation",
      "UI bundle path is outside its bundle namespace",
    );
  const relative = path.slice(prefix.length);
  if (
    relative.length === 0 ||
    relative.startsWith("/") ||
    relative
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  )
    throw new UiBundleError(
      "validation",
      "UI bundle path contains an unsafe segment",
    );
}

function relativeAssetPath(path: string, bundleId?: string): string {
  const match = path.match(/^\/remote-app\/([^/]+)\/(.+)$/u);
  if (!match || (bundleId !== undefined && match[1] !== bundleId))
    throw new UiBundleError("validation", "UI bundle path is malformed");
  const relative = match[2];
  if (relative === undefined)
    throw new UiBundleError("validation", "UI bundle path is malformed");
  return relative;
}

function stringField(value: unknown, name: string, pattern?: RegExp): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (pattern !== undefined && !pattern.test(value))
  )
    throw new UiBundleError("validation", `invalid UI bundle ${name}`);
  return value;
}

function unsignedInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new UiBundleError("validation", `invalid UI bundle ${name}`);
  return value as number;
}

function isHtmlContentType(value: string): boolean {
  return /^text\/html(?:\s*;|\s*$)/iu.test(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
