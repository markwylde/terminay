import type { ProtocolId } from "@terminay/protocol";

export const SYSTEM_SHELL_PROFILE_ID = "system";
export const MAX_SHELL_PROFILES = 64;
export const MAX_SHELL_PROFILE_ARGS = 64;
export const MAX_SHELL_PROFILE_ENVIRONMENT = 128;
export const MAX_SHELL_PROFILE_BYTES = 16_384;
/** Leaves room for discovered summaries and protocol envelope metadata inside
 * the negotiated 64 KiB control-header limit. */
export const MAX_SHELL_PROFILES_BYTES = 32_768;

export type ShellStartupMode = "default" | "login" | "non-login";
export type NewTerminalCwdPolicy = "current" | "project" | "home";

export type ShellProfileTarget =
  | { readonly kind: "system" }
  | { readonly kind: "executable"; readonly executable: string }
  | { readonly kind: "wsl"; readonly distribution: string; readonly shellPath?: string };

export interface ShellProfileDefinition {
  readonly id: ProtocolId;
  readonly name: string;
  readonly target: ShellProfileTarget;
  readonly args: readonly string[];
  readonly startupMode: ShellStartupMode;
  readonly environment: Readonly<Record<string, string | null>>;
  readonly icon?: string;
  readonly color?: string;
  /** Set only by migration when a legacy argument string could not be
   * represented unambiguously. Such a profile is retained but not launched. */
  readonly requiresReview?: boolean;
}

export interface ShellProfilesSettings {
  readonly defaultProfileId: ProtocolId;
  readonly cwdPolicy: NewTerminalCwdPolicy;
  readonly profiles: readonly ShellProfileDefinition[];
  readonly order: readonly ProtocolId[];
}

export type ShellProfileKind = "system" | "discovered" | "custom";
export type ShellProfileSource =
  | "system"
  | "account"
  | "environment"
  | "etc-shells"
  | "fallback"
  | "powershell"
  | "comspec"
  | "git-bash"
  | "wsl"
  | "custom"
  | "migrated";

export interface ShellProfileAvailability {
  readonly available: boolean;
  readonly reason?: string;
}

export interface ShellProfileCatalogueEntry extends Omit<ShellProfileDefinition, "environment"> {
  readonly kind: ShellProfileKind;
  readonly readOnly: boolean;
  readonly source: ShellProfileSource;
  readonly availability: ShellProfileAvailability;
  readonly projectReferences: readonly ProtocolId[];
  readonly environmentEntryCount: number;
  readonly hasEnvironmentOverlay: boolean;
  readonly argumentCount: number;
}

export interface ShellProfileCatalogue {
  readonly settingsRevision: number;
  readonly defaultProfileId: ProtocolId;
  readonly cwdPolicy: NewTerminalCwdPolicy;
  readonly entries: readonly ShellProfileCatalogueEntry[];
}

export interface ShellProfileValidationIssue {
  readonly code: string;
  readonly field: string;
  readonly message: string;
}

export interface ShellProfileValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ShellProfileValidationIssue[];
}

/** The resolved executable shape is deliberately structured. No field is a
 * shell command string and WSL distribution identity remains an argv item. */
export type ResolvedShellLaunchTarget =
  | { readonly kind: "executable"; readonly executable: string }
  | {
      readonly kind: "wsl";
      readonly executable: string;
      readonly distribution: string;
      readonly shellPath?: string;
    };

export interface ResolvedShellProfile {
  readonly profile: ShellProfileCatalogueEntry;
  /** Full server-private definition used only by the launch boundary. */
  readonly definition: ShellProfileDefinition;
  readonly settingsRevision: number;
  readonly target: ResolvedShellLaunchTarget;
}
