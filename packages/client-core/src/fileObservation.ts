import type { JsonValue } from "@terminay/protocol";
import type { QueryCommandTransport } from "./queryCommand.js";

export const FILE_OBSERVATION_OPERATIONS = Object.freeze({
  watchStart: "files.watch.start",
  watchRead: "files.watch.read",
  watchStop: "files.watch.stop",
  watchEvent: "files.watch",
  folderSizeStart: "files.folder-size.start",
  folderSizeCancel: "files.folder-size.cancel",
  folderSizeEvent: "files.folder-size",
} as const);

export type FileObservationKind = "created" | "changed" | "deleted" | "renamed" | "unavailable" | "resync";
export interface FileWatchHandle { readonly subscriptionId: string; readonly projectId: string; readonly resource: string; readonly cursor: number; }
export interface FileWatchEvent {
  readonly serverId?: string;
  readonly subscriptionId?: string;
  readonly projectId: string;
  readonly resource: string;
  readonly kind: FileObservationKind;
  readonly sequence: number;
  readonly relatedResource?: string;
}
export interface FileWatchBatch {
  readonly subscriptionId: string;
  readonly cursor: number;
  readonly events: readonly FileWatchEvent[];
  readonly resyncRequired: boolean;
}
export interface FolderSizeHandle { readonly jobId: string; readonly projectId: string; readonly resource: string; }
export interface FolderSizeEvent extends FolderSizeHandle {
  readonly phase: "progress" | "completed" | "cancelled" | "failed";
  readonly bytes?: number;
  readonly files?: number;
  readonly directories?: number;
}

export interface FileObservationTransport extends QueryCommandTransport {
  subscribeEvents(event: string, listener: (payload: JsonValue) => void, onResync?: () => void): Promise<() => void>;
}

/** Project-scoped client facade for canonical file-system observations. */
export class FileObservationClient {
  constructor(private readonly transport: FileObservationTransport) {}

  async startWatch(projectId: string, resource: string): Promise<FileWatchHandle> {
    return watchHandle(await this.transport.command(FILE_OBSERVATION_OPERATIONS.watchStart, { projectId, resource }), projectId, resource);
  }
  async readWatch(handle: Pick<FileWatchHandle, "subscriptionId" | "projectId">): Promise<FileWatchBatch> {
    const value = record(await this.transport.query(FILE_OBSERVATION_OPERATIONS.watchRead, { subscriptionId: id(handle.subscriptionId, "subscriptionId") }), "watch batch");
    if (value.subscriptionId !== handle.subscriptionId) throw new TypeError("watch batch subscription mismatch");
    const events = array(value.events, "watch events").map((event) => watchEvent(event, handle.projectId));
    return Object.freeze({
      subscriptionId: handle.subscriptionId,
      cursor: counter(value.cursor, "watch cursor"),
      events: Object.freeze(events),
      resyncRequired: boolean(value.resyncRequired, "watch resync state"),
    });
  }
  async stopWatch(subscriptionId: string): Promise<void> {
    try {
      await this.transport.command(FILE_OBSERVATION_OPERATIONS.watchStop, { subscriptionId: id(subscriptionId, "subscriptionId") });
    } catch (error) {
      if (isExpectedDisconnect(error)) return;
      throw error;
    }
  }
  async subscribeWatch(handle: FileWatchHandle, listener: (event: FileWatchEvent) => void, onResync?: () => void): Promise<() => void> {
    return this.transport.subscribeEvents(FILE_OBSERVATION_OPERATIONS.watchEvent, (payload) => {
      const value = record(payload, "watch event");
      if (value.subscriptionId !== handle.subscriptionId) return;
      listener(watchEvent(value, handle.projectId, handle.resource));
    }, onResync);
  }
  async startFolderSize(projectId: string, resource: string): Promise<FolderSizeHandle> {
    const value = record(await this.transport.command(FILE_OBSERVATION_OPERATIONS.folderSizeStart, { projectId, resource }), "folder-size handle");
    const result = Object.freeze({ jobId: id(value.jobId, "jobId"), projectId: id(value.projectId, "projectId"), resource: path(value.resource) });
    if (result.projectId !== projectId || result.resource !== resource) throw new TypeError("folder-size handle identity mismatch");
    return result;
  }
  async cancelFolderSize(jobId: string): Promise<void> {
    try {
      await this.transport.command(FILE_OBSERVATION_OPERATIONS.folderSizeCancel, { jobId: id(jobId, "jobId") });
    } catch (error) {
      if (isExpectedDisconnect(error)) return;
      throw error;
    }
  }
  async subscribeFolderSize(handle: FolderSizeHandle, listener: (event: FolderSizeEvent) => void, onResync?: () => void): Promise<() => void> {
    return this.transport.subscribeEvents(FILE_OBSERVATION_OPERATIONS.folderSizeEvent, (payload) => {
      const value = record(payload, "folder-size event");
      if (value.jobId !== handle.jobId) return;
      if (value.projectId !== handle.projectId || value.resource !== handle.resource) throw new TypeError("folder-size event identity mismatch");
      const phase = value.phase;
      if (!["progress", "completed", "cancelled", "failed"].includes(String(phase))) throw new TypeError("folder-size phase is invalid");
      const withCounters = phase === "progress" || phase === "completed";
      listener(Object.freeze({
        ...handle, phase: phase as FolderSizeEvent["phase"],
        ...(withCounters ? {
          bytes: counter(value.bytes, "folder-size bytes"),
          files: counter(value.files, "folder-size files"),
          directories: counter(value.directories, "folder-size directories"),
        } : {}),
      }));
    }, onResync);
  }
}

function watchHandle(value: unknown, projectId: string, resource: string): FileWatchHandle {
  const candidate = record(value, "watch handle");
  const result = Object.freeze({
    subscriptionId: id(candidate.subscriptionId, "subscriptionId"),
    projectId: id(candidate.projectId, "projectId"),
    resource: path(candidate.resource),
    cursor: counter(candidate.cursor, "watch cursor"),
  });
  if (result.projectId !== projectId || result.resource !== resource) throw new TypeError("watch handle identity mismatch");
  return result;
}
function watchEvent(value: unknown, projectId: string, watchedResource?: string): FileWatchEvent {
  const candidate = record(value, "watch event");
  if (candidate.projectId !== projectId) throw new TypeError("watch event project mismatch");
  const kind = candidate.kind;
  if (!["created", "changed", "deleted", "renamed", "unavailable", "resync"].includes(String(kind))) throw new TypeError("watch event kind is invalid");
  const resource = path(candidate.resource);
  if (watchedResource !== undefined && watchedResource !== "" && resource !== watchedResource && !resource.startsWith(`${watchedResource}/`)) throw new TypeError("watch event resource is outside subscription");
  return Object.freeze({
    ...(candidate.serverId === undefined ? {} : { serverId: id(candidate.serverId, "serverId") }),
    ...(candidate.subscriptionId === undefined ? {} : { subscriptionId: id(candidate.subscriptionId, "subscriptionId") }),
    projectId, resource, kind: kind as FileObservationKind,
    sequence: counter(candidate.sequence, "watch sequence"),
    ...(candidate.relatedResource === undefined ? {} : { relatedResource: path(candidate.relatedResource) }),
  });
}
function record(value: unknown, name: string): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${name} is invalid`); return value as Record<string, unknown>; }
function array(value: unknown, name: string): readonly unknown[] { if (!Array.isArray(value) || value.length > 256) throw new TypeError(`${name} are invalid`); return value; }
function id(value: unknown, name: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError(`${name} is invalid`); return value; }
function path(value: unknown): string { if (value === "") return ""; if (typeof value !== "string" || value.length > 4096 || value.startsWith("/") || value.includes("\\") || value.split("/").some((part) => part === "" || part === "." || part === "..")) throw new TypeError("resource is invalid"); return value; }
function counter(value: unknown, name: string): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${name} is invalid`); return value as number; }
function boolean(value: unknown, name: string): boolean { if (typeof value !== "boolean") throw new TypeError(`${name} is invalid`); return value; }
function isExpectedDisconnect(error: unknown): boolean {
  return error instanceof Error
    && (
      error.name === "ClientDisconnectedError"
      || error.name === "CommandOutcomeUnknownError"
      || (error as { code?: unknown }).code === "disconnected"
      || (error as { code?: unknown }).code === "unknown_command_outcome"
    );
}
