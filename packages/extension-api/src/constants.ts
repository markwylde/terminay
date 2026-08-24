export const EXTENSION_MANIFEST_VERSION = 1 as const;
export const EXTENSION_API_VERSION = "1.1.0" as const;

export const EXTENSION_LIMITS = Object.freeze({
  manifestBytes: 64 * 1024,
  extensionIdLength: 128,
  providerIdLength: 192,
  displayNameLength: 96,
  descriptionLength: 1_024,
  contributions: 32,
  permissions: 32,
  dependencies: 32,
  formSections: 32,
  formFields: 128,
  fieldOptions: 256,
  stringLength: 4_096,
  progressStages: 64,
  actions: 32,
  messageBytes: 1024 * 1024,
  deadlineMs: 120_000,
  sshAgentIdentities: 64,
  sshAgentPublicKeyBytes: 16 * 1024,
  sshAgentChallengeBytes: 256 * 1024,
  sshAgentSignatureBytes: 16 * 1024,
  agentProcessMatchers: 16,
  agentMappings: 32,
  agentRequiredCapabilities: 16,
  agentProviderVersionLength: 64,
  agentSessionIdLength: 256,
  agentNativeIdLength: 256,
  agentTitleLength: 512,
  agentPromptLength: 4 * 1024,
  agentReasonLength: 1_024,
  agentSummaryLength: 4 * 1024,
  agentDiagnosticLength: 512,
  agentMetadataEntries: 32,
  agentFingerprintEntries: 16,
  agentEventDepth: 8,
  agentInitialReplayBytes: 4 * 1024 * 1024,
  agentRecordBytes: 256 * 1024,
  agentFileReadBytes: 4 * 1024 * 1024,
  agentFollowChunkBytes: 256 * 1024,
  agentStreamInFlight: 64,
  /** A terminal device fact is an identifier, never a filesystem capability. */
  agentTtyDeviceIdLength: 256,
  agentTtyDeviceNameLength: 128,
  agentHomeRelativePathLength: 1_024,
  agentProviderPathLength: 4_096,
  agentAllowedHomeRoots: 8,
  agentFileExtensionLength: 64,
  /** Child journals share a root binding and are never root candidates. */
  agentChildJournalSources: 64,
} as const);

export const EXTENSION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{1,126}[a-z0-9])?$/;
export const LOCAL_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export function namespacedId(extensionId: string, localId: string): string {
  if (!EXTENSION_ID_PATTERN.test(extensionId)) throw new Error("invalid extension id");
  if (!LOCAL_ID_PATTERN.test(localId)) throw new Error("invalid local id");
  return `${extensionId}/${localId}`;
}

export function isNamespacedId(value: string, extensionId: string): boolean {
  const prefix = `${extensionId}/`;
  return value.startsWith(prefix) && LOCAL_ID_PATTERN.test(value.slice(prefix.length));
}
