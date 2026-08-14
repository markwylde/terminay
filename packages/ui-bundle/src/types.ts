import type {
  TerminayBundleCompatibilityResult,
  TerminayHostCompatibilityRequirements,
} from "@terminay/protocol";

export interface UiBundleAsset {
  readonly contentType: string;
  readonly hash: string;
  readonly path: string;
  readonly size: number;
}

export interface UiBundleManifest {
  readonly schemaVersion: 1;
  readonly bundleId: string;
  readonly entryPath: string;
  readonly protocolVersion: string;
  readonly serverVersion: string;
  /**
   * The browser policy required for a server-bundled session. This is
   * normalized and validated at the server boundary rather than left to a
   * host shell to infer from the asset contents.
   */
  readonly contentSecurityPolicy: string;
  /** Present on current manifests and included in the bundle identity. Legacy
   * manifests remain readable only for bounded migration/recovery paths. */
  readonly bundleFormatVersion?: 1;
  readonly hostCompatibility?: TerminayHostCompatibilityRequirements;
  readonly assets: readonly UiBundleAsset[];
}

export interface UiBundleLimits {
  readonly maxAssets?: number;
  readonly maxAssetBytes?: number;
  readonly maxTotalBytes?: number;
  readonly maxPathBytes?: number;
  readonly maxContentTypeBytes?: number;
  /** Launch boundaries set this true. Store migration may read a legacy
   * manifest without treating it as launch-compatible. */
  readonly requireHostCompatibility?: boolean;
}

export interface UiBundleIdentityMetadata {
  readonly bundleFormatVersion: 1;
  readonly protocolVersion: string;
  readonly serverVersion: string;
  readonly hostCompatibility: TerminayHostCompatibilityRequirements;
}

export interface UiBundleAssetReader {
  read(path: string): Promise<Uint8Array> | Uint8Array;
}

export interface VerifiedUiBundle {
  readonly manifest: UiBundleManifest;
  read(path: string): Uint8Array;
}

export type UiBundleHostCompatibilityResult = TerminayBundleCompatibilityResult;

export type UiBundleErrorCode =
  | "validation"
  | "limit"
  | "not_found"
  | "integrity";
