import type { ProtocolId } from "@terminay/protocol";
import {
  DEFAULT_MAX_CONTEXT_BYTES,
  DEFAULT_MAX_CONTEXT_CHARS,
  DEFAULT_MAX_MODELS,
  DEFAULT_MAX_NOTE_CHARS,
  DEFAULT_MAX_PROVIDER_OUTPUT_BYTES,
  DEFAULT_MAX_TITLE_CHARS,
  DEFAULT_MODEL_LIST_TIMEOUT_MS,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  deadlineSignal,
  isAbortError,
  normalizeProviderName,
  safeProviderError,
  stripTerminalControls,
  throwIfAborted,
  trimChars,
  trimUtf8,
  utf8ByteLength,
} from "./bounds.js";
import type {
  AiMetadataContext,
  AiMetadataRequest,
  AiMetadataResult,
  AiMetadataServiceOptions,
  AiModel,
  AiProvider,
  AiProviderAdapter,
  AiServiceErrorCode,
  AiServiceLimits,
  AiRequestStatusSnapshot,
  TerminalTarget,
} from "./types.js";
import { AiServiceError } from "./types.js";

interface RunningRequest {
  readonly controller: AbortController;
  readonly snapshot: AiRequestStatusSnapshot;
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Server-owned title/note generation. The provider sees only a bounded,
 * normalized context assembled from the server replay source. */
export class AiMetadataService {
  private readonly options: AiMetadataServiceOptions;
  private readonly providers: Partial<Record<AiProvider, AiProviderAdapter>>;
  private readonly limits: Required<Pick<AiServiceLimits, "maxContextBytes" | "maxContextChars" | "maxProviderOutputBytes" | "maxTitleChars" | "maxNoteChars" | "providerTimeoutMs" | "modelListTimeoutMs" | "maxModels">> & { readonly maxStatusSnapshots: number };
  private readonly now: () => number;
  private readonly running = new Map<ProtocolId, RunningRequest>();
  private readonly history = new Map<ProtocolId, AiRequestStatusSnapshot>();

  constructor(options: AiMetadataServiceOptions) {
    this.options = options;
    this.providers = options.providers ?? {};
    this.limits = {
      maxContextBytes: options.limits?.maxContextBytes ?? DEFAULT_MAX_CONTEXT_BYTES,
      maxContextChars: options.limits?.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS,
      maxProviderOutputBytes: options.limits?.maxProviderOutputBytes ?? DEFAULT_MAX_PROVIDER_OUTPUT_BYTES,
      maxTitleChars: options.limits?.maxTitleChars ?? DEFAULT_MAX_TITLE_CHARS,
      maxNoteChars: options.limits?.maxNoteChars ?? DEFAULT_MAX_NOTE_CHARS,
      providerTimeoutMs: options.limits?.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
      modelListTimeoutMs: options.limits?.modelListTimeoutMs ?? DEFAULT_MODEL_LIST_TIMEOUT_MS,
      maxModels: options.limits?.maxModels ?? DEFAULT_MAX_MODELS,
      maxStatusSnapshots: options.limits?.maxStatusSnapshots ?? 256,
    };
    this.now = options.now ?? Date.now;
    for (const [name, value] of Object.entries(this.limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  }

  /** Build context from server replay state. A caller-provided context is not
   * accepted by this API, which prevents a remote client from smuggling other
   * terminals or arbitrary filesystem content to a provider. */
  async context(target: TerminalTarget): Promise<AiMetadataContext> {
    const state = await this.options.authority.getTarget(target);
    this.assertExactTarget(target, state?.serverId === this.options.serverId ? state : undefined);
    const currentTitle = trimUtf8(trimChars(stripTerminalControls(state?.title ?? "Terminal"), this.limits.maxTitleChars).text, this.limits.maxTitleChars * 4).text;
    const existingNote = trimUtf8(trimChars(stripTerminalControls(state?.note ?? ""), this.limits.maxNoteChars).text, this.limits.maxNoteChars * 4).text;
    const metadataBytes = utf8ByteLength(currentTitle) + utf8ByteLength(existingNote);
    const metadataChars = currentTitle.length + existingNote.length;
    const replay = await this.options.replay.read(target, {
      maxBytes: Math.max(0, this.limits.maxContextBytes - metadataBytes),
      maxChars: Math.max(0, this.limits.maxContextChars - metadataChars),
    });
    return {
      target: { ...target },
      text: replay.text,
      bytes: replay.bytes,
      truncated: replay.truncated,
      currentTitle,
      existingNote,
    };
  }

  async listModels(providerInput: string, signal?: AbortSignal): Promise<readonly AiModel[]> {
    const provider = normalizeProviderName(providerInput);
    if (provider === "disabled") throw new AiServiceError("provider_disabled", "AI provider is disabled.");
    const adapter = this.providers[provider];
    if (adapter?.listModels === undefined) throw new AiServiceError("provider_unavailable", `${providerLabel(provider)} model discovery is unavailable.`, true);
    const bounded = deadlineSignal(signal, this.limits.modelListTimeoutMs);
    try {
      throwIfAborted(bounded.signal);
      const withCredential = this.options.credentialResolver === undefined
        ? undefined
        : <T>(callback: (secret: Uint8Array) => T | Promise<T>): Promise<T> => this.options.credentialResolver!.withCredential(provider, callback);
      const pending = Promise.resolve(adapter.listModels({ provider, signal: bounded.signal, maxOutputBytes: this.limits.maxProviderOutputBytes, ...(withCredential === undefined ? {} : { withCredential }) }));
      const raw = await raceAbort(pending, bounded.signal, () => new AiServiceError(bounded.timedOut() ? "provider_timeout" : "provider_cancelled", bounded.timedOut() ? "AI model discovery timed out." : "AI model discovery was cancelled.", true));
      if (!Array.isArray(raw)) throw new AiServiceError("provider_unavailable", `${providerLabel(provider)} returned an invalid model list.`);
      let serializedBytes = 0;
      try { serializedBytes = utf8ByteLength(JSON.stringify(raw)); } catch { throw new AiServiceError("provider_unavailable", `${providerLabel(provider)} returned an invalid model list.`); }
      if (serializedBytes > this.limits.maxProviderOutputBytes) throw new AiServiceError("provider_output_too_large", `${providerLabel(provider)} returned an oversized model list.`);
      const result: AiModel[] = [];
      const seen = new Set<string>();
      for (const item of raw) {
        if (result.length >= this.limits.maxModels) break;
        if (typeof item !== "object" || item === null) continue;
        const candidate = item as Partial<AiModel>;
        const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
        if (!id || id.length > 256 || seen.has(id)) continue;
        const label = typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim().slice(0, 256) : id;
        seen.add(id);
        result.push({ id, label });
      }
      return result;
    } catch (error) {
      if (error instanceof AiServiceError) throw error;
      if (isAbortError(error)) throw new AiServiceError("provider_cancelled", "AI model discovery was cancelled.", true);
      throw safeProviderError(error, `Unable to list ${providerLabel(provider)} models.`);
    } finally {
      bounded.cancel();
    }
  }

  async generate(request: AiMetadataRequest): Promise<AiMetadataResult> {
    this.assertRequest(request);
    if (this.running.has(request.requestId)) throw new AiServiceError("invalid_request", "request is already running");
    const state = await this.authorizeAndState(request.clientId, request.target);
    const expectedRevision = request.expectedRevision ?? state.metadataRevision;
    if (expectedRevision !== state.metadataRevision) throw new AiServiceError("revision_conflict", "terminal metadata revision is stale.", true);
    const settings = await this.readSettings(request.targetType);
    const provider = normalizeProviderName(request.provider ?? settings.provider);
    if (this.options.settings !== undefined && request.provider !== undefined && provider !== normalizeProviderName(settings.provider)) throw new AiServiceError("invalid_request", "requested provider does not match server settings.");
    if (provider === "disabled") throw new AiServiceError("provider_disabled", `AI ${request.targetType} generation is disabled.`);
    const model = (request.model ?? settings.model).trim();
    if (!model) throw new AiServiceError("invalid_request", "Choose an AI model before generating tab metadata.");
    const adapter = this.providers[provider];
    if (adapter === undefined) throw new AiServiceError("provider_unavailable", `${providerLabel(provider)} is unavailable.`, true);

    const startedAt = this.now();
    const controller = new AbortController();
    const snapshot: AiRequestStatusSnapshot = { requestId: request.requestId, kind: "metadata", status: "running", target: { ...request.target }, startedAt };
    this.running.set(request.requestId, { controller, snapshot });
    this.history.set(request.requestId, snapshot);
    this.log(snapshot);
    const bounded = deadlineSignal(request.signal, request.deadlineMs ?? this.limits.providerTimeoutMs);
    const forwardAbort = () => controller.abort(bounded.signal.reason);
    bounded.signal.addEventListener("abort", forwardAbort, { once: true });
    try {
      throwIfAborted(bounded.signal);
      const context = await this.context(request.target);
      const withCredential = this.options.credentialResolver === undefined
        ? undefined
        : <T>(callback: (secret: Uint8Array) => T | Promise<T>): Promise<T> => this.options.credentialResolver!.withCredential(provider, callback);
      const rawPending = Promise.resolve(adapter.generate({ provider, model, target: request.targetType, context, signal: controller.signal, maxOutputBytes: this.limits.maxProviderOutputBytes, ...(withCredential === undefined ? {} : { withCredential }) }));
      // The internal controller is also aborted by cancel(requestId). The
      // deadline signal forwards timeout/parent cancellation to it, so a
      // provider that ignores AbortSignal still cannot hold this request open.
      const raw = await raceAbort(rawPending, controller.signal, () => new AiServiceError(bounded.timedOut() ? "provider_timeout" : "provider_cancelled", bounded.timedOut() ? `${providerLabel(provider)} timed out.` : `${providerLabel(provider)} request was cancelled.`, true));
      if (typeof raw !== "string" || utf8ByteLength(raw) > this.limits.maxProviderOutputBytes) throw new AiServiceError("provider_output_too_large", `${providerLabel(provider)} returned an oversized result.`);
      const text = normalizeMetadataText(request.targetType, raw, request.targetType === "title" ? this.limits.maxTitleChars : this.limits.maxNoteChars);
      if (!text) throw new AiServiceError("empty_output", `${providerLabel(provider)} returned an empty result.`);
      const after = await this.authorizeAndState(request.clientId, request.target);
      if (!after.live) throw new AiServiceError("target_exited", "terminal target has exited.");
      if (after.metadataRevision !== expectedRevision) throw new AiServiceError("revision_conflict", "terminal metadata changed while AI was running.", true);
      if (this.options.authority.applyMetadata === undefined) throw new AiServiceError("target_unavailable", "terminal metadata mutation is unavailable.", true);
      const applied = await this.options.authority.applyMetadata(request.target, request.targetType, text, expectedRevision);
      const result: AiMetadataResult = { requestId: request.requestId, target: { ...request.target }, targetType: request.targetType, text, revision: applied.revision };
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

  private async authorizeAndState(clientId: ProtocolId, target: TerminalTarget) {
    this.assertTarget(target);
    const state = await this.options.authority.getTarget(target);
    this.assertExactTarget(target, state);
    if (!state.live) throw new AiServiceError("target_exited", "terminal target has exited.");
    if (this.options.authority.authorize !== undefined && !(await this.options.authority.authorize(clientId, target))) throw new AiServiceError("not_authorized", "client is not authorized for this terminal.");
    return state;
  }

  private async readSettings(target: "title" | "note") {
    const source = this.options.settings;
    if (source === undefined) return { provider: "disabled" as const, model: "" };
    const settings = typeof source === "function" ? await source() : source;
    const value = settings[target];
    const provider = normalizeProviderName(value.provider);
    const model = value.model ?? (provider === "codex" ? value.codexModel : provider === "claude-code" ? value.claudeCodeModel : "") ?? "";
    return { provider: value.provider, model };
  }

  private assertRequest(request: AiMetadataRequest): void {
    if (!request || typeof request !== "object") throw new AiServiceError("invalid_request", "AI metadata request is required.");
    this.assertId(request.requestId, "requestId");
    this.assertId(request.clientId, "clientId");
    if (request.targetType !== "title" && request.targetType !== "note") throw new AiServiceError("invalid_request", "AI metadata target is invalid.");
    this.assertTarget(request.target);
    if (request.expectedRevision !== undefined && (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0)) throw new AiServiceError("invalid_request", "expected metadata revision is invalid.");
    if (request.deadlineMs !== undefined && (!Number.isSafeInteger(request.deadlineMs) || request.deadlineMs <= 0)) throw new AiServiceError("invalid_request", "AI deadline is invalid.");
  }

  private assertTarget(target: TerminalTarget): void {
    for (const [name, value] of Object.entries(target)) this.assertId(value as string, `target.${name}`);
    if (target.serverId !== this.options.serverId) throw new AiServiceError("target_unavailable", "terminal belongs to another server.");
  }

  private assertExactTarget(target: TerminalTarget, state: { readonly serverId: string; readonly projectId: string; readonly panelId: string; readonly sessionId: string } | undefined): asserts state is NonNullable<typeof state> {
    if (state === undefined || state.serverId !== target.serverId || state.projectId !== target.projectId || state.panelId !== target.panelId || state.sessionId !== target.sessionId) throw new AiServiceError("target_unavailable", "terminal target is unavailable.", true);
  }

  private mapError(error: unknown, timedOut: boolean): AiServiceError {
    if (error instanceof AiServiceError) return error;
    if (timedOut) return new AiServiceError("provider_timeout", "AI provider request timed out.", true);
    if (isAbortError(error)) return new AiServiceError("provider_cancelled", "AI provider request was cancelled.", true);
    return safeProviderError(error, "AI provider request failed.");
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

export const AiTabMetadataService = AiMetadataService;

export function normalizeMetadataText(target: "title" | "note", raw: string, maxChars: number): string {
  let text = stripTerminalControls(raw)
    .replace(/^```(?:text|txt|markdown|md)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  text = text.replace(/^(?:title|note|answer|result)\s*:\s*/i, "").trim();
  text = text.replace(/^(?:["'“”])([\s\S]*?)(?:["'“”])$/, "$1").trim();
  if (target === "title") text = text.replace(/\s+/g, " ");
  else text = text.replace(/\r/g, "").split("\n").map((line) => line.trimEnd()).join("\n");
  return trimChars(text, maxChars).text.trim();
}

function providerLabel(provider: AiProvider): string {
  return provider === "claude-code" ? "Claude Code" : "Codex";
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
