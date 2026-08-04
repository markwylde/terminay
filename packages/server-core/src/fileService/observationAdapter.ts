import type { JsonValue } from "@terminay/protocol";
import { scopeAllows } from "../auth.js";
import type { AuthenticatedClient, CommandRequest, OperationRegistries, OrderedEvent, OrderedEventJournalLike, QueryRequest } from "../types.js";
import { FileWatchRegistry, type FileWatchEventInput } from "./watchRegistry.js";

export const FILE_OBSERVATION_OPERATIONS = Object.freeze({
  watchStart: "files.watch.start",
  watchRead: "files.watch.read",
  watchStop: "files.watch.stop",
  watchEvent: "files.watch",
  folderSizeStart: "files.folder-size.start",
  folderSizeCancel: "files.folder-size.cancel",
  folderSizeEvent: "files.folder-size",
} as const);

export interface FileObservationHost {
  watch(input: {
    readonly projectId: string;
    readonly resource: string;
    readonly signal: AbortSignal;
    readonly publish: (event: Omit<FileWatchEventInput, "projectId">) => void;
  }): void | Promise<void>;
  calculateFolderSize(input: {
    readonly projectId: string;
    readonly resource: string;
    readonly signal: AbortSignal;
    readonly progress: (value: { readonly bytes: number; readonly files: number; readonly directories: number }) => void;
  }): Promise<{ readonly bytes: number; readonly files: number; readonly directories: number }>;
}

export interface FileObservationAdapterOptions {
  readonly serverId: string;
  readonly host: FileObservationHost;
  readonly eventJournal: OrderedEventJournalLike;
  readonly maxWatches?: number;
  readonly maxFolderSizeJobs?: number;
}

interface WatchState { readonly projectId: string; readonly clientId: string; readonly controller: AbortController; }
interface SizeJob { readonly projectId: string; readonly clientId: string; readonly controller: AbortController; }

/** Canonical project-scoped directory observation and cancellable folder-size
 * authority. Host filesystem APIs stay behind FileObservationHost; clients see
 * only relative resources, bounded counters, opaque ids, and ordered events. */
export class ServerFileObservationAdapter {
  readonly operations: OperationRegistries;
  private readonly watches: FileWatchRegistry;
  private readonly watchStates = new Map<string, WatchState>();
  private readonly jobs = new Map<string, SizeJob>();
  private readonly maxFolderSizeJobs: number;
  private jobSequence = 0;

  constructor(private readonly options: FileObservationAdapterOptions) {
    validId(options.serverId, "serverId");
    if (typeof options.host?.watch !== "function" || typeof options.host?.calculateFolderSize !== "function") throw new TypeError("file observation host is invalid");
    this.maxFolderSizeJobs = positive(options.maxFolderSizeJobs ?? 128, "maxFolderSizeJobs");
    this.watches = new FileWatchRegistry({ serverId: options.serverId, maxSubscriptions: options.maxWatches ?? 1024 });
    this.operations = {
      queries: { [FILE_OBSERVATION_OPERATIONS.watchRead]: (request) => this.read(request) },
      commands: {
        [FILE_OBSERVATION_OPERATIONS.watchStart]: (request) => this.startWatch(request),
        [FILE_OBSERVATION_OPERATIONS.watchStop]: (request) => this.stopWatch(request),
        [FILE_OBSERVATION_OPERATIONS.folderSizeStart]: (request) => this.startFolderSize(request),
        [FILE_OBSERVATION_OPERATIONS.folderSizeCancel]: (request) => this.cancelFolderSize(request),
      },
      policies: {
        [FILE_OBSERVATION_OPERATIONS.watchRead]: { scope: "read" },
        [FILE_OBSERVATION_OPERATIONS.watchStart]: { scope: "read" },
        [FILE_OBSERVATION_OPERATIONS.watchStop]: { scope: "read" },
        [FILE_OBSERVATION_OPERATIONS.folderSizeStart]: { scope: "read" },
        [FILE_OBSERVATION_OPERATIONS.folderSizeCancel]: { scope: "read" },
      },
    };
  }

  closeClient(clientId: string): void {
    for (const [id, state] of this.watchStates) if (state.clientId === clientId) this.closeWatch(id, state);
    for (const [id, job] of this.jobs) if (job.clientId === clientId) this.closeJob(id, job);
  }

  close(): void {
    for (const [id, state] of this.watchStates) this.closeWatch(id, state);
    for (const [id, job] of this.jobs) this.closeJob(id, job);
    this.watches.close();
  }

  private startWatch(request: CommandRequest): JsonValue {
    const payload = objectPayload(request.envelope.payload);
    const projectId = this.project(request, payload.projectId);
    const resource = relativeResource(payload.resource);
    const subscription = this.watches.subscribe({ clientId: request.context.clientId, projectId, resource });
    const existing = this.watchStates.get(subscription.subscriptionId);
    if (existing !== undefined) {
      return { subscriptionId: subscription.subscriptionId, projectId, resource, cursor: this.watches.sequence };
    }
    const controller = new AbortController();
    const state = { projectId, clientId: request.context.clientId, controller };
    this.watchStates.set(subscription.subscriptionId, state);
    void Promise.resolve(this.options.host.watch({
      projectId, resource, signal: controller.signal,
      publish: (event) => {
        if (controller.signal.aborted) return;
        const result = this.watches.publish({ ...event, projectId });
        if (!result.accepted || result.sequence === undefined) return;
        for (const matched of result.subscriptions) {
          this.options.eventJournal.append(FILE_OBSERVATION_OPERATIONS.watchEvent, {
            subscriptionId: matched.subscriptionId,
            clientId: matched.clientId,
            projectId,
            resource: event.resource,
            kind: event.kind,
            sequence: result.sequence,
            ...(event.relatedResource === undefined ? {} : { relatedResource: event.relatedResource }),
          });
        }
      },
    })).catch(() => {
      if (controller.signal.aborted) return;
      const result = this.watches.publish({ projectId, resource, kind: "unavailable" });
      if (result.accepted && result.sequence !== undefined) {
        for (const matched of result.subscriptions) {
          this.options.eventJournal.append(FILE_OBSERVATION_OPERATIONS.watchEvent, {
            subscriptionId: matched.subscriptionId, clientId: matched.clientId,
            projectId, resource, kind: "unavailable", sequence: result.sequence,
          });
        }
      }
    });
    return { subscriptionId: subscription.subscriptionId, projectId, resource, cursor: this.watches.sequence };
  }

  private async read(request: QueryRequest): Promise<JsonValue> {
    const payload = objectPayload(request.envelope.payload);
    const id = text(payload.subscriptionId, "subscriptionId", 128);
    const state = this.requireWatch(id, request.context.clientId);
    this.project(request, state.projectId);
    return await this.watches.read(id, { signal: request.context.signal }) as unknown as JsonValue;
  }

  private stopWatch(request: CommandRequest): JsonValue {
    const payload = objectPayload(request.envelope.payload);
    const id = text(payload.subscriptionId, "subscriptionId", 128);
    const state = this.requireWatch(id, request.context.clientId);
    this.project(request, state.projectId);
    this.closeWatch(id, state);
    return null;
  }

  private startFolderSize(request: CommandRequest): JsonValue {
    if (this.jobs.size >= this.maxFolderSizeJobs) throw new Error("folder-size job limit reached");
    const payload = objectPayload(request.envelope.payload);
    const projectId = this.project(request, payload.projectId);
    const resource = relativeResource(payload.resource);
    const jobId = `size-${(++this.jobSequence).toString(36)}`;
    const controller = new AbortController();
    const job = { projectId, clientId: request.context.clientId, controller };
    this.jobs.set(jobId, job);
    const emit = (phase: "progress" | "completed" | "cancelled" | "failed", value?: { readonly bytes: number; readonly files: number; readonly directories: number }): void => {
      this.options.eventJournal.append(FILE_OBSERVATION_OPERATIONS.folderSizeEvent, {
        jobId, clientId: request.context.clientId, projectId, resource, phase,
        ...(value === undefined ? {} : counters(value)),
      });
    };
    void Promise.resolve().then(() => this.options.host.calculateFolderSize({
      projectId, resource, signal: controller.signal, progress: (value) => { if (!controller.signal.aborted) emit("progress", value); },
    })).then((value) => { if (!controller.signal.aborted) emit("completed", value); })
      .catch(() => emit(controller.signal.aborted ? "cancelled" : "failed"))
      .finally(() => { this.jobs.delete(jobId); });
    return { jobId, projectId, resource };
  }

  private cancelFolderSize(request: CommandRequest): JsonValue {
    const payload = objectPayload(request.envelope.payload);
    const id = text(payload.jobId, "jobId", 128);
    const job = this.jobs.get(id);
    if (job === undefined || job.clientId !== request.context.clientId) return null;
    this.project(request, job.projectId);
    this.closeJob(id, job);
    return null;
  }

  private project(request: QueryRequest | CommandRequest, candidate: unknown): string {
    if (!scopeAllows(request.context.authScope, "read")) throw new Error("file observation requires read scope");
    const projectId = text(candidate, "projectId", 128);
    const claim = typeof request.context.claims === "object" && request.context.claims !== null && !Array.isArray(request.context.claims)
      ? (request.context.claims as Record<string, unknown>).projectId : undefined;
    if (typeof claim === "string" && claim !== projectId) throw new Error("file observation is outside authenticated project scope");
    return projectId;
  }
  private requireWatch(id: string, clientId: string): WatchState {
    const state = this.watchStates.get(id);
    if (state === undefined || state.clientId !== clientId) throw new Error("file watch subscription is unavailable");
    return state;
  }
  private closeWatch(id: string, state: WatchState): void { state.controller.abort(); this.watches.unsubscribe(id); this.watchStates.delete(id); }
  private closeJob(id: string, job: SizeJob): void { job.controller.abort(); this.jobs.delete(id); }
}

function objectPayload(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("file observation payload is invalid"); return value as Record<string, unknown>; }
function text(value: unknown, name: string, max: number): string { if (typeof value !== "string" || value.length === 0 || value.length > max || value.includes("\0")) throw new TypeError(`${name} is invalid`); return value; }
function validId(value: unknown, name: string): string { const result = text(value, name, 128); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(result)) throw new TypeError(`${name} is invalid`); return result; }
/** Filters the globally ordered journal before replay/live delivery. File
 * observation facts are private to the exact client that created the handle,
 * in addition to remaining inside the authenticated project claim. */
export function createFileObservationEventProjector(
  event: OrderedEvent,
  client: AuthenticatedClient | undefined,
): OrderedEvent | undefined {
  if (event.event !== FILE_OBSERVATION_OPERATIONS.watchEvent && event.event !== FILE_OBSERVATION_OPERATIONS.folderSizeEvent) return event;
  if (client === undefined || typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) return undefined;
  const payload = event.payload as Record<string, JsonValue>;
  if (payload.clientId !== client.clientId) return undefined;
  const claim = typeof client.claims === "object" && client.claims !== null && !Array.isArray(client.claims)
    ? (client.claims as Record<string, unknown>).projectId : undefined;
  return typeof claim === "string" && payload.projectId !== claim ? undefined : event;
}

function relativeResource(value: unknown): string { if (value === "") return ""; const result = text(value, "resource", 4096); if (result.startsWith("/") || result.includes("\\") || result.split("/").some((part) => part === "" || part === "." || part === "..")) throw new TypeError("resource must be project-relative"); return result; }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} is invalid`); return value; }
function counters(value: { readonly bytes: number; readonly files: number; readonly directories: number }): Record<string, number> { for (const number of [value.bytes, value.files, value.directories]) if (!Number.isSafeInteger(number) || number < 0) throw new RangeError("folder-size counters are invalid"); return { bytes: value.bytes, files: value.files, directories: value.directories }; }
