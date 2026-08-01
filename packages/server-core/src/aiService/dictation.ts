import type { ProtocolId } from "@terminay/protocol";
import {
  DEFAULT_ALLOWED_AUDIO_MIME_TYPES,
  DEFAULT_MAX_AUDIO_BYTES,
  DEFAULT_MAX_AUDIO_DURATION_MS,
  DEFAULT_MAX_AUDIO_UPLOAD_MS,
  DEFAULT_MAX_PROVIDER_OUTPUT_BYTES,
  DEFAULT_MAX_TRANSCRIPT_CHARS,
  deadlineSignal,
  isAbortError,
  safeProviderError,
  stripTerminalControls,
  throwIfAborted,
  utf8ByteLength,
} from "./bounds.js";
import {
  AiServiceError,
  type AiRequestStatusSnapshot,
  type AiServiceErrorCode,
  type AiServiceLimits,
  type DictationServiceOptions,
  type DictationProviderResult,
  type DictationResult,
  type DictationSettings,
  type DictationTranscribeRequest,
  type TerminalTarget,
} from "./types.js";
export const DEFAULT_DICTATION_MODEL = "gpt-4o-transcribe";

interface RunningRequest {
  readonly controller: AbortController;
  readonly snapshot: AiRequestStatusSnapshot;
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Server-side bounded dictation request handling. Microphone permission,
 * MediaRecorder, silence detection, and overlay state are deliberately absent;
 * this service accepts only the already-captured bounded bytes. */
export class DictationService {
  private readonly options: DictationServiceOptions;
  private readonly limits: Required<Pick<AiServiceLimits, "maxAudioBytes" | "maxAudioDurationMs" | "maxAudioUploadMs" | "maxProviderOutputBytes" | "maxTranscriptChars">> & { readonly allowedAudioMimeTypes: readonly string[]; readonly maxStatusSnapshots: number };
  private readonly now: () => number;
  private readonly running = new Map<ProtocolId, RunningRequest>();
  private readonly history = new Map<ProtocolId, AiRequestStatusSnapshot>();

  constructor(options: DictationServiceOptions) {
    this.options = options;
    this.limits = {
      maxAudioBytes: options.limits?.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES,
      maxAudioDurationMs: options.limits?.maxAudioDurationMs ?? DEFAULT_MAX_AUDIO_DURATION_MS,
      maxAudioUploadMs: options.limits?.maxAudioUploadMs ?? DEFAULT_MAX_AUDIO_UPLOAD_MS,
      maxProviderOutputBytes: options.limits?.maxProviderOutputBytes ?? DEFAULT_MAX_PROVIDER_OUTPUT_BYTES,
      maxTranscriptChars: options.limits?.maxTranscriptChars ?? DEFAULT_MAX_TRANSCRIPT_CHARS,
      allowedAudioMimeTypes: options.limits?.allowedAudioMimeTypes ?? DEFAULT_ALLOWED_AUDIO_MIME_TYPES,
      maxStatusSnapshots: options.limits?.maxStatusSnapshots ?? 256,
    };
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.limits.maxAudioBytes) || this.limits.maxAudioBytes <= 0) throw new RangeError("maxAudioBytes must be positive");
    if (!Number.isSafeInteger(this.limits.maxAudioDurationMs) || this.limits.maxAudioDurationMs <= 0) throw new RangeError("maxAudioDurationMs must be positive");
    if (!Number.isSafeInteger(this.limits.maxAudioUploadMs) || this.limits.maxAudioUploadMs <= 0) throw new RangeError("maxAudioUploadMs must be positive");
    if (!Number.isSafeInteger(this.limits.maxProviderOutputBytes) || this.limits.maxProviderOutputBytes <= 0) throw new RangeError("maxProviderOutputBytes must be positive");
    if (!Number.isSafeInteger(this.limits.maxTranscriptChars) || this.limits.maxTranscriptChars <= 0) throw new RangeError("maxTranscriptChars must be positive");
  }

  async transcribe(request: DictationTranscribeRequest): Promise<DictationResult> {
    this.assertRequest(request);
    if (this.running.has(request.requestId)) throw new AiServiceError("invalid_request", "request is already running");
    const before = await this.authorizeAndState(request.clientId, request.target);
    const settings = await this.readSettings();
    if (settings.enabled === false || settings.provider === "disabled") throw new AiServiceError("provider_disabled", "dictation provider is disabled.");
    const model = (request.model ?? settings.model ?? DEFAULT_DICTATION_MODEL).trim();
    if (!model) throw new AiServiceError("invalid_request", "dictation model is invalid.");

    const startedAt = this.now();
    const controller = new AbortController();
    const snapshot: AiRequestStatusSnapshot = { requestId: request.requestId, kind: "dictation", status: "running", target: { ...request.target }, startedAt };
    this.running.set(request.requestId, { controller, snapshot });
    this.history.set(request.requestId, snapshot);
    this.log(snapshot);
    const bounded = deadlineSignal(request.signal, request.deadlineMs ?? this.limits.maxAudioUploadMs);
    const forwardAbort = () => controller.abort(bounded.signal.reason);
    bounded.signal.addEventListener("abort", forwardAbort, { once: true });
    try {
      throwIfAborted(bounded.signal);
      const audio = await raceAbort(
        collectAudio(request, this.limits.maxAudioBytes, controller.signal),
        controller.signal,
        () => new AiServiceError(bounded.timedOut() ? "audio_timeout" : "provider_cancelled", bounded.timedOut() ? "dictation upload timed out." : "dictation upload was cancelled.", true),
      );
      if (audio.byteLength === 0) throw new AiServiceError("audio_empty", "dictation audio is empty.");
      if (request.peakLevel !== undefined && (!Number.isFinite(request.peakLevel) || request.peakLevel < 0)) throw new AiServiceError("invalid_request", "dictation audio level is invalid.");
      if (request.peakLevel === 0) throw new AiServiceError("audio_inaudible", "dictation audio contains no audible speech.");
      const elapsed = Math.max(0, this.now() - startedAt);
      if (request.durationMs !== undefined && request.durationMs > this.limits.maxAudioDurationMs) throw new AiServiceError("audio_duration_exceeded", "dictation recording exceeds the duration limit.");
      if (elapsed > this.limits.maxAudioDurationMs) throw new AiServiceError("audio_duration_exceeded", "dictation recording exceeds the duration limit.");
      throwIfAborted(bounded.signal);
      const language = (request.language ?? settings.language)?.trim() || undefined;
      const prompt = request.prompt ?? settings.prompt;
      const withCredential = this.options.credentialResolver === undefined
        ? undefined
        : <T>(callback: (secret: Uint8Array) => T | Promise<T>): Promise<T> => this.options.credentialResolver!.withCredential(settings.provider ?? "", callback);
      const pending = Promise.resolve(this.options.provider.transcribe({ model, language, prompt, mimeType: normalizeMime(request.mimeType), audio: new Uint8Array(audio), signal: controller.signal, maxOutputBytes: this.limits.maxProviderOutputBytes, ...(withCredential === undefined ? {} : { withCredential }) }));
      const raw = await raceAbort(pending, controller.signal, () => new AiServiceError(bounded.timedOut() ? "audio_timeout" : "provider_cancelled", bounded.timedOut() ? "dictation transcription timed out." : "dictation transcription was cancelled.", true));
      const text = normalizeTranscript(raw, this.limits.maxProviderOutputBytes, this.limits.maxTranscriptChars);
      if (!text) throw new AiServiceError("empty_output", "dictation provider returned an empty transcript.");
      const after = await this.authorizeAndState(request.clientId, request.target);
      if (!after.live || before.sessionId !== after.sessionId || before.panelId !== after.panelId || before.projectId !== after.projectId) throw new AiServiceError("target_exited", "terminal target changed or has exited.");
      if (this.options.authority.writeInput === undefined) throw new AiServiceError("target_unavailable", "terminal input is unavailable.", true);
      const appendNewline = request.appendNewline ?? settings.appendNewline ?? false;
      await this.options.authority.writeInput(request.target, appendNewline ? `${text}\n` : text);
      const result: DictationResult = { requestId: request.requestId, target: { ...request.target }, text, inserted: true };
      this.finish(request.requestId, "complete");
      return result;
    } catch (error) {
      const mapped = this.mapError(error, bounded.timedOut());
      this.finish(request.requestId, mapped.code === "cancelled" || mapped.code === "provider_cancelled" ? "cancelled" : "failed", mapped.code);
      throw mapped;
    } finally {
      bounded.signal.removeEventListener("abort", forwardAbort);
      bounded.cancel();
      this.running.delete(request.requestId);
    }
  }

  /** Alias used by protocol command adapters. */
  upload(request: DictationTranscribeRequest): Promise<DictationResult> {
    return this.transcribe(request);
  }

  cancel(requestId: ProtocolId): boolean {
    const running = this.running.get(requestId);
    if (running === undefined) return false;
    running.controller.abort(new DOMException("Request cancelled", "AbortError"));
    return true;
  }

  status(requestId: ProtocolId): AiRequestStatusSnapshot | undefined {
    const value = this.history.get(requestId);
    return value === undefined ? undefined : { ...value, target: { ...value.target } };
  }

  snapshots(): readonly AiRequestStatusSnapshot[] {
    return [...this.history.values()].map((value) => ({ ...value, target: { ...value.target } }));
  }

  private async readSettings(): Promise<DictationSettings> {
    const source = this.options.settings;
    if (source === undefined) return {};
    return typeof source === "function" ? await source() : source;
  }

  private async authorizeAndState(clientId: ProtocolId, target: TerminalTarget) {
    this.assertTarget(target);
    const state = await this.options.authority.getTarget(target);
    if (state === undefined || state.serverId !== target.serverId || state.projectId !== target.projectId || state.panelId !== target.panelId || state.sessionId !== target.sessionId) throw new AiServiceError("target_unavailable", "terminal target is unavailable.", true);
    if (!state.live) throw new AiServiceError("target_exited", "terminal target has exited.");
    if (this.options.authority.authorize !== undefined && !(await this.options.authority.authorize(clientId, target))) throw new AiServiceError("not_authorized", "client is not authorized for this terminal.");
    return state;
  }

  private assertRequest(request: DictationTranscribeRequest): void {
    if (!request || typeof request !== "object") throw new AiServiceError("invalid_request", "dictation request is required.");
    this.assertId(request.requestId, "requestId");
    this.assertId(request.clientId, "clientId");
    this.assertTarget(request.target);
    const mime = normalizeMime(request.mimeType);
    if (!this.limits.allowedAudioMimeTypes.map((value) => value.toLowerCase()).includes(mime)) throw new AiServiceError("audio_type_unsupported", "dictation audio MIME type is unsupported.");
    if (request.durationMs !== undefined && (!Number.isFinite(request.durationMs) || request.durationMs < 0)) throw new AiServiceError("invalid_request", "dictation duration is invalid.");
    if (request.audio === undefined) throw new AiServiceError("audio_empty", "dictation audio is empty.");
  }

  private assertTarget(target: TerminalTarget): void {
    if (!target || typeof target !== "object") throw new AiServiceError("invalid_request", "dictation target is required.");
    for (const [name, value] of Object.entries(target)) this.assertId(value as string, `target.${name}`);
    if (target.serverId !== this.options.serverId) throw new AiServiceError("target_unavailable", "terminal belongs to another server.");
  }

  private mapError(error: unknown, timedOut: boolean): AiServiceError {
    if (error instanceof AiServiceError) return error;
    if (timedOut) return new AiServiceError("audio_timeout", "dictation request timed out.", true);
    if (isAbortError(error)) return new AiServiceError("provider_cancelled", "dictation request was cancelled.", true);
    return safeProviderError(error, "dictation transcription failed.");
  }

  private finish(requestId: string, status: "complete" | "cancelled" | "failed", errorCode?: AiServiceErrorCode): void {
    const current = this.history.get(requestId);
    if (current === undefined) return;
    const next: AiRequestStatusSnapshot = { ...current, status, finishedAt: this.now(), ...(errorCode === undefined ? {} : { errorCode }) };
    this.history.set(requestId, next);
    while (this.history.size > this.limits.maxStatusSnapshots) {
      const oldest = this.history.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.history.delete(oldest);
    }
    this.log(next);
  }

  private log(snapshot: AiRequestStatusSnapshot): void {
    this.options.logger?.status?.({ requestId: snapshot.requestId, kind: snapshot.kind, status: snapshot.status, targetSessionId: snapshot.target.sessionId, ...(snapshot.errorCode === undefined ? {} : { errorCode: snapshot.errorCode }) });
  }

  private assertId(value: string, name: string): void {
    if (typeof value !== "string" || !idPattern.test(value)) throw new AiServiceError("invalid_request", `${name} is invalid.`);
  }
}

export const ServerDictationService = DictationService;

function normalizeMime(value: string): string {
  if (typeof value !== "string") throw new AiServiceError("invalid_request", "dictation audio MIME type is required.");
  const mime = value.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  if (!mime) throw new AiServiceError("audio_type_unsupported", "dictation audio MIME type is required.");
  return mime;
}

async function collectAudio(request: DictationTranscribeRequest, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const append = (chunk: Uint8Array): void => {
    if (!(chunk instanceof Uint8Array)) throw new AiServiceError("invalid_request", "dictation audio chunk is invalid.");
    total += chunk.byteLength;
    if (total > maxBytes) throw new AiServiceError("audio_too_large", "dictation audio exceeds the upload limit.");
    chunks.push(new Uint8Array(chunk));
  };
  throwIfAborted(signal);
  const audio = request.audio;
  if (audio instanceof Uint8Array) append(audio);
  else {
    if (audio === undefined) throw new AiServiceError("audio_empty", "dictation audio is empty.");
    for await (const chunk of audio) {
      throwIfAborted(signal);
      append(chunk);
    }
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function normalizeTranscript(value: DictationProviderResult | string, maxOutputBytes: number, maxChars: number): string {
  const raw = typeof value === "string" ? value : value && typeof value === "object" && typeof value.text === "string" ? value.text : "";
  if (utf8ByteLength(raw) > maxOutputBytes) throw new AiServiceError("audio_output_too_large", "dictation provider returned an oversized transcript.");
  const normalized = stripTerminalControls(raw).replace(/^```(?:text|txt|markdown|md)?\s*/i, "").replace(/```\s*$/i, "").replace(/^(?:transcript|text|answer)\s*:\s*/i, "").trim();
  if (normalized.length > maxChars) throw new AiServiceError("audio_output_too_large", "dictation provider returned an oversized transcript.");
  return normalized;
}

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal, error: () => Error): Promise<T> {
  if (signal.aborted) throw error();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(error());
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, (reason: unknown) => {
      signal.removeEventListener("abort", abort);
      reject(reason);
    });
  });
}
