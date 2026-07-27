import type { ProtocolId } from "@terminay/protocol";

/** The two server-side metadata operations.  The provider values intentionally
 * use the names from the feature specification; the legacy `claudeCode` spelling
 * is accepted at the boundary and normalized to `claude-code`. */
export type AiMetadataTarget = "title" | "note";
export type AiProvider = "codex" | "claude-code";
export type AiProviderInput = AiProvider | "claudeCode";

export interface TerminalTarget {
  readonly serverId: ProtocolId;
  readonly projectId: ProtocolId;
  readonly panelId: ProtocolId;
  readonly sessionId: ProtocolId;
}

export interface TerminalTargetState extends TerminalTarget {
  readonly live: boolean;
  readonly metadataRevision: number;
  readonly title: string;
  readonly note: string;
}

export interface TerminalReplaySnapshot {
  /** Provider-safe, control-sequence-free text. */
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

export interface AiMetadataContext extends TerminalReplaySnapshot {
  readonly target: TerminalTarget;
  readonly currentTitle: string;
  readonly existingNote: string;
}

export interface AiModel {
  readonly id: string;
  readonly label: string;
}

export interface AiProviderModelRequest {
  readonly provider: AiProvider;
  readonly signal: AbortSignal;
  /** The adapter must enforce this cap while reading provider output. */
  readonly maxOutputBytes: number;
  /**
   * Resolve a configured provider credential only inside the server-owned
   * adapter callback. The callback is deliberately generic so the credential
   * cannot become part of a protocol result or status snapshot.
   */
  readonly withCredential?: AiCredentialResolver;
}

export interface AiProviderGenerateRequest {
  readonly provider: AiProvider;
  readonly model: string;
  readonly target: AiMetadataTarget;
  readonly context: AiMetadataContext;
  readonly signal: AbortSignal;
  readonly maxOutputBytes: number;
  /** Server-only scoped credential access; never a raw credential field. */
  readonly withCredential?: AiCredentialResolver;
}

export type AiCredentialResolver = <T>(
  callback: (secret: Uint8Array) => T | Promise<T>,
) => Promise<T>;

/** Resolves provider credentials without crossing the transport boundary. */
export interface AiProviderCredentialResolver {
  withCredential<T>(
    provider: string,
    callback: (secret: Uint8Array) => T | Promise<T>,
  ): Promise<T>;
}

/** Provider adapters are deliberately small and contain all CLI/credential
 * knowledge.  They never receive a client connection or a renderer object. */
export interface AiProviderAdapter {
  readonly listModels?: (
    request: AiProviderModelRequest,
  ) => readonly AiModel[] | Promise<readonly AiModel[]>;
  readonly generate: (
    request: AiProviderGenerateRequest,
  ) => string | Promise<string>;
}

export interface AiMetadataProviderSettings {
  readonly provider: AiProviderInput | "disabled";
  readonly model?: string;
  /** Legacy settings shapes remain readable during server migration. */
  readonly codexModel?: string;
  readonly claudeCodeModel?: string;
}

export interface AiMetadataSettings {
  readonly title: AiMetadataProviderSettings;
  readonly note: AiMetadataProviderSettings;
}

export interface AiMetadataRequest {
  readonly requestId: ProtocolId;
  readonly clientId: ProtocolId;
  readonly target: TerminalTarget;
  readonly targetType: AiMetadataTarget;
  readonly expectedRevision?: number;
  readonly provider?: AiProviderInput;
  readonly model?: string;
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}

export interface AiMetadataResult {
  readonly requestId: ProtocolId;
  readonly target: TerminalTarget;
  readonly targetType: AiMetadataTarget;
  readonly text: string;
  readonly revision: number;
}

export interface DictationTranscribeRequest {
  readonly requestId: ProtocolId;
  readonly clientId: ProtocolId;
  readonly target: TerminalTarget;
  readonly mimeType: string;
  /** Client duration is advisory input; the server also measures upload time. */
  readonly durationMs?: number;
  readonly language?: string;
  readonly model?: string;
  readonly prompt?: string;
  readonly appendNewline?: boolean;
  readonly peakLevel?: number;
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
  readonly audio?: Uint8Array | AsyncIterable<Uint8Array>;
}

export interface DictationProviderRequest {
  readonly model: string;
  readonly language?: string;
  readonly prompt?: string;
  readonly mimeType: string;
  readonly audio: Uint8Array;
  readonly signal: AbortSignal;
  readonly maxOutputBytes: number;
  /** Server-only scoped credential access; never a raw credential field. */
  readonly withCredential?: AiCredentialResolver;
}

export interface DictationProviderResult {
  readonly text: string;
}

export interface DictationProviderAdapter {
  readonly transcribe: (
    request: DictationProviderRequest,
  ) => DictationProviderResult | string | Promise<DictationProviderResult | string>;
}

export interface DictationResult {
  readonly requestId: ProtocolId;
  readonly target: TerminalTarget;
  readonly text: string;
  readonly inserted: boolean;
}

export type AiRequestStatus =
  | "accepted"
  | "running"
  | "complete"
  | "cancelled"
  | "failed";

/** Only bounded status metadata is observable.  Context, audio, provider
 * output, and provider diagnostics are intentionally absent. */
export interface AiRequestStatusSnapshot {
  readonly requestId: ProtocolId;
  readonly kind: "metadata" | "dictation";
  readonly status: AiRequestStatus;
  readonly target: TerminalTarget;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly errorCode?: AiServiceErrorCode;
}

export type AiServiceErrorCode =
  | "invalid_request"
  | "target_unavailable"
  | "target_exited"
  | "not_authorized"
  | "provider_disabled"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_cancelled"
  | "provider_output_too_large"
  | "empty_output"
  | "revision_conflict"
  | "cancelled"
  | "audio_empty"
  | "audio_inaudible"
  | "audio_type_unsupported"
  | "audio_too_large"
  | "audio_duration_exceeded"
  | "audio_timeout"
  | "audio_output_too_large";

export class AiServiceError extends Error {
  readonly code: AiServiceErrorCode;
  readonly retryable: boolean;

  constructor(code: AiServiceErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "AiServiceError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface AiServiceLimits {
  readonly maxContextBytes?: number;
  readonly maxContextChars?: number;
  readonly maxProviderOutputBytes?: number;
  readonly maxTitleChars?: number;
  readonly maxNoteChars?: number;
  readonly providerTimeoutMs?: number;
  readonly modelListTimeoutMs?: number;
  readonly maxModels?: number;
  readonly maxAudioBytes?: number;
  readonly maxAudioDurationMs?: number;
  readonly maxAudioUploadMs?: number;
  readonly maxTranscriptChars?: number;
  readonly allowedAudioMimeTypes?: readonly string[];
  readonly maxStatusSnapshots?: number;
}

export interface AiTargetAuthority {
  /** Return the current exact target state, or undefined when it is unknown. */
  readonly getTarget: (
    target: TerminalTarget,
  ) => TerminalTargetState | undefined | Promise<TerminalTargetState | undefined>;
  /** Check the authenticated client against the exact target. */
  readonly authorize?: (
    clientId: ProtocolId,
    target: TerminalTarget,
  ) => boolean | Promise<boolean>;
  /** Apply a canonical metadata mutation after expectedRevision validation. */
  readonly applyMetadata?: (
    target: TerminalTarget,
    targetType: AiMetadataTarget,
    value: string,
    expectedRevision: number,
  ) => { readonly revision: number } | Promise<{ readonly revision: number }>;
  /** Write through the normal server PTY input path. */
  readonly writeInput?: (
    target: TerminalTarget,
    input: string,
  ) => void | Promise<void>;
}

export interface TerminalReplaySource {
  readonly read: (
    target: TerminalTarget,
    limits: { readonly maxBytes: number; readonly maxChars: number },
  ) => TerminalReplaySnapshot | Promise<TerminalReplaySnapshot>;
}

export interface AiServiceLogger {
  /** Status only; implementations must not log request payloads. */
  readonly status?: (event: {
    readonly requestId: string;
    readonly kind: "metadata" | "dictation";
    readonly status: AiRequestStatus;
    readonly targetSessionId: string;
    readonly errorCode?: AiServiceErrorCode;
  }) => void;
}

export interface AiMetadataServiceOptions {
  readonly serverId: ProtocolId;
  readonly authority: AiTargetAuthority;
  readonly replay: TerminalReplaySource;
  readonly providers?: Partial<Record<AiProvider, AiProviderAdapter>>;
  readonly credentialResolver?: AiProviderCredentialResolver;
  readonly settings?: AiMetadataSettings | (() => AiMetadataSettings | Promise<AiMetadataSettings>);
  readonly limits?: AiServiceLimits;
  readonly now?: () => number;
  readonly logger?: AiServiceLogger;
}

export interface DictationServiceOptions {
  readonly serverId: ProtocolId;
  readonly authority: AiTargetAuthority;
  readonly provider: DictationProviderAdapter;
  readonly credentialResolver?: AiProviderCredentialResolver;
  readonly settings?: (() => DictationSettings | Promise<DictationSettings>) | DictationSettings;
  readonly limits?: AiServiceLimits;
  readonly now?: () => number;
  readonly logger?: AiServiceLogger;
}

export interface DictationSettings {
  readonly enabled?: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly language?: string;
  readonly prompt?: string;
  readonly appendNewline?: boolean;
}
