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
  readonly assets: readonly UiBundleAsset[];
}

export interface UiBundleLimits {
  readonly maxAssets?: number;
  readonly maxAssetBytes?: number;
  readonly maxTotalBytes?: number;
  readonly maxPathBytes?: number;
  readonly maxContentTypeBytes?: number;
}

export interface UiBundleAssetReader {
  read(path: string): Promise<Uint8Array> | Uint8Array;
}

export interface VerifiedUiBundle {
  readonly manifest: UiBundleManifest;
  read(path: string): Uint8Array;
}

export type UiBundleErrorCode = "validation" | "limit" | "not_found" | "integrity";
