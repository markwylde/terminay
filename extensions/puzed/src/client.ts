import type { CreateMachineRequest, DeleteMachineRequest, HostBridge, HostBridgesResponse, ImagesResponse, Job, JobResponse, Machine, MachineAsyncResponse, MachineNameSuggestionResponse, MachineNICsResponse, MachinePowerRequest, MachineResponse, MachinesResponse, Me, OrgSettingsResponse, WorkersResponse } from "./api-types.js";
import { normalizeBaseUrl, validateMe, type ProfileValidation } from "./profile.js";

export class PuzedApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number, public readonly retryable: boolean) { super(message); }
}

export interface PuzedAuditEvent { action: string; result: "succeeded" | "failed"; status?: number; code?: string }
export interface ClientOptions { fetch?: typeof globalThis.fetch; timeoutMs?: number; maxBodyBytes?: number; audit?: (event: PuzedAuditEvent) => void }
export interface ApiKeySecretBroker { withApiKey<T>(use: (secret: Uint8Array) => Promise<T>): Promise<T> }

export class PuzedClient {
  readonly baseUrl: URL;
  readonly #secrets: ApiKeySecretBroker;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #maxBodyBytes: number;
  readonly #audit: (event: PuzedAuditEvent) => void;

  constructor(baseUrl: string, secrets: ApiKeySecretBroker, options: ClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.#secrets = secrets;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#maxBodyBytes = options.maxBodyBytes ?? 2 * 1024 * 1024;
    this.#audit = options.audit ?? (() => {});
  }

  async validateProfile(signal?: AbortSignal): Promise<ProfileValidation> {
    return validateMe(await this.request<Me>("/api/v1/me", { signal }));
  }

  async listTerminayMachines(cursor?: string, signal?: AbortSignal): Promise<MachinesResponse> {
    return this.request("/api/v1/machines", { query: { page_size: "100", tags: "system:Terminay", ...(cursor ? { cursor } : {}) }, signal });
  }

  async listAllTerminayMachines(signal?: AbortSignal): Promise<Machine[]> {
    const result: Machine[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listTerminayMachines(cursor, signal);
      for (const machine of page.items ?? []) if (machine.tags?.includes("system:Terminay")) result.push(machine);
      cursor = page.next_cursor;
    } while (cursor);
    return result;
  }

  getMachine(id: string, signal?: AbortSignal) { return this.request<MachineResponse>(`/api/v1/machines/${encodeURIComponent(id)}`, { signal }); }
  getMachineInterfaces(id: string, cursor?: string, signal?: AbortSignal) { return this.request<MachineNICsResponse>(`/api/v1/machines/${encodeURIComponent(id)}/interfaces`, { query: { page_size: "100", ...(cursor ? { cursor } : {}) }, signal }); }
  getJob(id: string, signal?: AbortSignal): Promise<Job> { return this.request<JobResponse>(`/api/v1/jobs/${encodeURIComponent(id)}`, { signal }).then((value) => value.job); }
  listImages(cursor?: string, signal?: AbortSignal) { return this.request<ImagesResponse>("/api/v1/images", { query: { page_size: "100", ...(cursor ? { cursor } : {}) }, signal }); }
  listWorkers(cursor?: string, signal?: AbortSignal) { return this.request<WorkersResponse>("/api/v1/workers", { query: { page_size: "100", ...(cursor ? { cursor } : {}) }, signal }); }
  listBridges(cursor?: string, signal?: AbortSignal) { return this.request<HostBridgesResponse>("/api/v1/bridges", { query: { page_size: "100", ...(cursor ? { cursor } : {}) }, signal }); }
  /** Bridges are host-local. Never use the organization-wide bridge list to
   * validate a machine's network choice. */
  listWorkerBridges(workerId: string, cursor?: string, signal?: AbortSignal) { return this.request<HostBridgesResponse>(`/api/v1/workers/${encodeURIComponent(workerId)}/bridges`, { query: { page_size: "100", ...(cursor ? { cursor } : {}) }, signal }); }
  async listAllWorkerBridges(workerId: string, signal?: AbortSignal): Promise<HostBridge[]> {
    const result: HostBridge[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listWorkerBridges(workerId, cursor, signal);
      result.push(...(page.items ?? []));
      cursor = page.next_cursor;
    } while (cursor);
    return result;
  }
  getSettings(signal?: AbortSignal) { return this.request<OrgSettingsResponse>("/api/v1/org/settings", { signal }); }
  suggestMachineName(signal?: AbortSignal) { return this.request<MachineNameSuggestionResponse>("/api/v1/machines/name-suggestion", { signal }); }

  createMachine(request: CreateMachineRequest, idempotencyKey: string, signal?: AbortSignal) {
    return this.request<MachineAsyncResponse>("/api/v1/machines", { method: "POST", body: request, headers: { "Idempotency-Key": idempotencyKey }, signal });
  }

  powerMachine(id: string, state: MachinePowerRequest["state"], idempotencyKey: string, signal?: AbortSignal) {
    return this.request<MachineAsyncResponse>(`/api/v1/machines/${encodeURIComponent(id)}/power`, { method: "POST", body: { state }, headers: { "Idempotency-Key": idempotencyKey }, signal });
  }

  deleteMachine(id: string, revision: number, idempotencyKey: string, body: DeleteMachineRequest, signal?: AbortSignal) {
    return this.request<MachineAsyncResponse>(`/api/v1/machines/${encodeURIComponent(id)}`, { method: "DELETE", body, headers: { "If-Match": String(revision), "Idempotency-Key": idempotencyKey }, signal });
  }

  openInPuzedUrl(machineId: string): string {
    return new URL(`/vms/${encodeURIComponent(machineId)}`, this.baseUrl).toString();
  }

  async openEventStream(lastEventId?: string, signal?: AbortSignal): Promise<Response> {
    const response = await this.fetchResponse("/api/v1/events", { headers: lastEventId ? { "Last-Event-ID": lastEventId } : {}, signal });
    if (!response.ok || !response.body) {
      const error = await this.errorFrom(response);
      this.audit({ action: "GET /api/v1/events", result: "failed", status: error.status, code: error.code });
      throw error;
    }
    this.audit({ action: "GET /api/v1/events", result: "succeeded", status: response.status });
    return response;
  }

  async request<T>(path: string, init: { method?: string; query?: Record<string, string>; headers?: Record<string, string>; body?: unknown; signal?: AbortSignal | undefined } = {}): Promise<T> {
    const response = await this.fetchResponse(path, init);
    if (!response.ok) {
      const error = await this.errorFrom(response);
      this.audit({ action: `${init.method ?? "GET"} ${path}`, result: "failed", status: error.status, code: error.code });
      throw error;
    }
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > this.#maxBodyBytes) throw new PuzedApiError("response_too_large", "Puzed returned an unexpectedly large response.", 502, false);
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > this.#maxBodyBytes) throw new PuzedApiError("response_too_large", "Puzed returned an unexpectedly large response.", 502, false);
    this.audit({ action: `${init.method ?? "GET"} ${path}`, result: "succeeded", status: response.status });
    return JSON.parse(text) as T;
  }

  private async fetchResponse(path: string, init: { method?: string; query?: Record<string, string>; headers?: Record<string, string>; body?: unknown; signal?: AbortSignal | undefined }): Promise<Response> {
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) throw new Error("Cross-origin Puzed request rejected.");
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.append(key, value);
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      return await this.#secrets.withApiKey(async (secret) => {
        try {
          const apiKey = new TextDecoder().decode(secret);
          return await this.#fetch(url, {
            method: init.method ?? "GET", redirect: "manual", signal,
            headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }), ...init.headers },
            ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          });
        } finally { secret.fill(0); }
      });
    } catch (error) {
      if (signal.aborted) throw new PuzedApiError("request_timeout", "Puzed did not respond before the request deadline.", 504, true);
      throw new PuzedApiError("network_error", "Puzed Platform could not be reached.", 503, true);
    }
  }

  private async errorFrom(response: Response): Promise<PuzedApiError> {
    if (response.status >= 300 && response.status < 400) return new PuzedApiError("redirect_rejected", "Puzed redirected the API request; profile URLs must name the exact API origin.", response.status, false);
    let code = "puzed_error"; const message = `Puzed request failed (${response.status}).`;
    try { const body = await response.json() as { code?: unknown }; if (typeof body.code === "string" && /^[a-z0-9_]{1,64}$/.test(body.code)) code = body.code; } catch {}
    return new PuzedApiError(code, message, response.status, response.status >= 500 || response.status === 429);
  }

  private audit(event: PuzedAuditEvent): void { try { this.#audit(event); } catch {} }
}
