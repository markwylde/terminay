import type { TerminayExtensionManifest } from "@terminay/extension-api";

export type ExtensionInstallState = "installed" | "disabled" | "incompatible" | "failed" | "quarantined" | "pending";

export interface RegistryPackageResolution {
  readonly packageName: string;
  readonly version: string;
  readonly integrity: string;
  readonly tarballUrl?: string;
  readonly publisher?: string;
  readonly maintainers?: readonly string[];
  readonly repository?: string;
  readonly provenance?: "verified" | "unverified" | "unavailable";
  readonly audit?: Readonly<{ critical: number; high: number; moderate: number; low: number }>;
  readonly dependencyCount?: number;
  readonly manifestMetadata?: unknown;
  readonly source?: "npmjs" | "uploaded";
  readonly uploadedFilename?: string;
  /** Private server staging path. Never serialized into receipts or DTOs. */
  readonly archivePath?: string;
}

export interface ExtensionInstallPreview extends RegistryPackageResolution {
  readonly previewDigest: string;
  readonly expiresAt: number;
  readonly official: boolean;
  readonly trustedCodeWarning?: string;
  readonly declaredPermissions: readonly string[];
  readonly declaredProviderIds: readonly string[];
}

export interface ExtensionReceipt extends RegistryPackageResolution {
  readonly schemaVersion: 1;
  readonly extensionId: string;
  readonly slotId: string;
  readonly installedAt: string;
  readonly npmVersion: string;
  readonly lockHash: string;
  readonly inventoryHash: string;
  readonly permissions: readonly string[];
  readonly manifest: TerminayExtensionManifest;
}

export interface ExtensionSlotRecord {
  readonly slotId: string;
  readonly version: string;
  readonly receipt: ExtensionReceipt;
  readonly knownGood: boolean;
}

export interface InstalledExtensionRecord {
  readonly extensionId: string;
  readonly packageName: string;
  readonly state: ExtensionInstallState;
  readonly enabled: boolean;
  readonly activeSlotId?: string;
  readonly previousSlotId?: string;
  readonly pendingSlotId?: string;
  readonly slots: Readonly<Record<string, ExtensionSlotRecord>>;
  readonly failureClass?: string;
}

export interface ExtensionRegistrySnapshot {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly extensions: Readonly<Record<string, InstalledExtensionRecord>>;
}

export interface ExtensionRegistryClient {
  resolve(packageName: string, selector: string, signal?: AbortSignal): Promise<RegistryPackageResolution>;
}

export interface ExtensionMaterializer {
  readonly npmVersion: string;
  materialize(resolution: RegistryPackageResolution, stagingRoot: string, signal?: AbortSignal): Promise<void>;
}

export interface ExtensionReferences {
  readonly profiles?: number;
  readonly environments?: number;
  readonly projects?: number;
  readonly dependants?: readonly string[];
  readonly activeUses?: number;
}
