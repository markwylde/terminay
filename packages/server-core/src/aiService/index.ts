export * from "./types.js";
export * from "./bounds.js";
export * from "./replay.js";
export * from "./targets.js";
export * from "./metadata.js";
export * from "./dictation.js";
export * from "./cliProvider.js";
export * from "./credentials.js";
export * from "./protocol.js";

import { AiMetadataService } from "./metadata.js";
import { DictationService } from "./dictation.js";
import type { AiMetadataRequest, AiMetadataResult, AiMetadataServiceOptions, AiRequestStatusSnapshot, DictationResult, DictationServiceOptions, DictationTranscribeRequest } from "./types.js";

export interface AiServiceOptions extends AiMetadataServiceOptions {
  readonly dictationProvider?: DictationServiceOptions["provider"];
  readonly dictationSettings?: DictationServiceOptions["settings"];
}

/** Convenience composition for protocol/runtime hosts. It does not add any
 * transport or Electron dependency; callers may use the focused services when
 * they need separate lifecycle wiring. */
export class AiService {
  readonly metadata: AiMetadataService;
  readonly dictation: DictationService | undefined;

  constructor(options: AiServiceOptions) {
    this.metadata = new AiMetadataService(options);
    this.dictation = options.dictationProvider === undefined ? undefined : new DictationService({
      serverId: options.serverId,
      authority: options.authority,
      provider: options.dictationProvider,
      credentialResolver: options.credentialResolver,
      settings: options.dictationSettings,
      limits: options.limits,
      now: options.now,
      logger: options.logger,
    });
  }

  generate(request: AiMetadataRequest): Promise<AiMetadataResult> {
    return this.metadata.generate(request);
  }

  transcribe(request: DictationTranscribeRequest): Promise<DictationResult> {
    if (this.dictation === undefined) throw new Error("dictation provider is not configured");
    return this.dictation.transcribe(request);
  }

  listModels(provider: string, signal?: AbortSignal) {
    return this.metadata.listModels(provider, signal);
  }

  status(requestId: string): AiRequestStatusSnapshot | undefined {
    return this.metadata.status(requestId) ?? this.dictation?.status(requestId);
  }

  cancel(requestId: string): boolean {
    return this.metadata.cancel(requestId) || (this.dictation?.cancel(requestId) ?? false);
  }
}

export const ServerAiService = AiService;
