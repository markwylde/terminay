import { scopeAllows } from "../auth.js";
import type { AuthScope, JsonValue } from "@terminay/protocol";
import type { CommandRequest, QueryRequest } from "../types.js";
import { FileCatalog, type FileCatalogListOptions, type FileCatalogSearchOptions, type FileCatalogSizeOptions, type FileCatalogPreviewOptions } from "./catalog.js";
import { FileServiceError } from "./types.js";
import type { MarkdownTaskAggregationOptions } from "./tasks.js";

/** Server-owned catalog operation names. Payload paths are always project-relative. */
export const FILE_CATALOG_OPERATIONS = Object.freeze({
  list: "files.list",
  search: "files.search",
  size: "files.size",
  previewMetadata: "files.preview-metadata",
  tasks: "files.tasks",
  createFile: "files.create",
  createDirectory: "files.create-directory",
  rename: "files.rename",
  delete: "files.delete",
} as const);

export interface FileCatalogProjectContext {
  readonly projectId: string;
  readonly catalog: FileCatalog;
}

export interface FileCatalogAuthorization {
  /** Server identity and project claims are supplied by authentication. */
  readonly serverId: string;
  readonly projectId?: string;
  readonly clientId?: string;
  readonly scope: AuthScope;
}

export interface FileCatalogAdapterOptions {
  readonly serverId: string;
  readonly projects: ReadonlyMap<string, FileCatalogProjectContext> | Readonly<Record<string, FileCatalogProjectContext>>;
  readonly authorizeProject?: (authorization: FileCatalogAuthorization, projectId: string) => boolean;
}

export interface FileCatalogRequest {
  readonly authorization: FileCatalogAuthorization;
  readonly projectId?: string;
  readonly path?: string;
  readonly signal?: AbortSignal;
}

/**
 * Application-protocol boundary for catalog and Markdown task operations.
 * Catalog instances own canonicalization and resource limits; this adapter
 * owns server/project authorization and converts authenticated requests into
 * the typed service calls.
 */
export class ServerFileCatalogAdapter {
  readonly serverId: string;
  private readonly options: FileCatalogAdapterOptions;

  constructor(options: FileCatalogAdapterOptions) {
    if (typeof options?.serverId !== "string" || !validId(options.serverId)) throw new TypeError("file catalog server id is invalid");
    if (options.projects === undefined || typeof options.projects !== "object" || options.projects === null) throw new TypeError("file catalog projects are required");
    this.serverId = options.serverId;
    this.options = options;
  }

  async list(request: FileCatalogRequest & { readonly options?: FileCatalogListOptions }): Promise<JsonValue> {
    const catalog = this.authorizedCatalog(request, "read");
    return asJson(await catalog.list(request.path ?? ".", withSignal(request.options, request.signal)));
  }

  async search(request: FileCatalogRequest & { readonly query: string; readonly options?: FileCatalogSearchOptions }): Promise<JsonValue> {
    const catalog = this.authorizedCatalog(request, "read");
    return asJson(await catalog.search(request.path ?? ".", request.query, withSignal(request.options, request.signal)));
  }

  async size(request: FileCatalogRequest & { readonly options?: FileCatalogSizeOptions }): Promise<JsonValue> {
    const catalog = this.authorizedCatalog(request, "read");
    return asJson(await catalog.size(request.path ?? ".", withSignal(request.options, request.signal)));
  }

  async previewMetadata(request: FileCatalogRequest & { readonly options?: FileCatalogPreviewOptions }): Promise<JsonValue> {
    const catalog = this.authorizedCatalog(request, "read");
    return asJson(await catalog.previewMetadata(requiredPath(request.path), withSignal(request.options, request.signal)));
  }

  async tasks(request: FileCatalogRequest & { readonly options?: MarkdownTaskAggregationOptions }): Promise<JsonValue> {
    const catalog = this.authorizedCatalog(request, "read");
    return asJson(await catalog.aggregateMarkdownTasks(request.path ?? ".", withSignal(request.options, request.signal)));
  }

  async createFile(request: FileCatalogRequest & { readonly bytes: Uint8Array }): Promise<null> {
    const catalog = this.authorizedCatalog(request, "write");
    const bytes = new Uint8Array(request.bytes.byteLength);
    bytes.set(request.bytes);
    await catalog.createFile(requiredPath(request.path), bytes, request.signal);
    return null;
  }

  async createDirectory(request: FileCatalogRequest): Promise<null> {
    const catalog = this.authorizedCatalog(request, "write");
    await catalog.createDirectory(requiredPath(request.path), request.signal);
    return null;
  }

  async rename(request: FileCatalogRequest & { readonly destination: string }): Promise<null> {
    const catalog = this.authorizedCatalog(request, "write");
    await catalog.rename(requiredPath(request.path), requiredPath(request.destination), request.signal);
    return null;
  }

  async delete(request: FileCatalogRequest & { readonly recursive?: boolean }): Promise<null> {
    const catalog = this.authorizedCatalog(request, "write");
    await catalog.delete(requiredPath(request.path), { recursive: request.recursive === true, signal: request.signal });
    return null;
  }

  operations(): { readonly queries: Readonly<Record<string, (request: QueryRequest) => JsonValue | Promise<JsonValue>>>; readonly commands: Readonly<Record<string, (request: CommandRequest) => JsonValue | Promise<JsonValue>>> } {
    return {
      queries: {
        [FILE_CATALOG_OPERATIONS.list]: (request) => this.list(this.listRequest(request)),
        [FILE_CATALOG_OPERATIONS.search]: (request) => this.search(this.searchRequest(request)),
        [FILE_CATALOG_OPERATIONS.size]: (request) => this.size(this.optionsRequest(request) as FileCatalogRequest & { readonly options?: FileCatalogSizeOptions }),
        [FILE_CATALOG_OPERATIONS.previewMetadata]: (request) => this.previewMetadata(this.optionsRequest(request) as FileCatalogRequest & { readonly options?: FileCatalogPreviewOptions }),
        [FILE_CATALOG_OPERATIONS.tasks]: (request) => this.tasks(this.optionsRequest(request) as FileCatalogRequest & { readonly options?: MarkdownTaskAggregationOptions }),
      },
      commands: {
        [FILE_CATALOG_OPERATIONS.createFile]: (request) => this.createFile(this.createFileRequest(request)),
        [FILE_CATALOG_OPERATIONS.createDirectory]: (request) => this.createDirectory(this.pathRequest(request)),
        [FILE_CATALOG_OPERATIONS.rename]: (request) => this.rename(this.renameRequest(request)),
        [FILE_CATALOG_OPERATIONS.delete]: (request) => this.delete(this.deleteRequest(request)),
      },
    };
  }

  private authorizedCatalog(request: FileCatalogRequest, required: AuthScope): FileCatalog {
    const projectId = request.projectId ?? request.authorization.projectId;
    if (projectId === undefined) throw new FileServiceError("path_escape", "file project identity is missing");
    const authorization = request.authorization;
    if (authorization.serverId !== this.serverId) throw new FileServiceError("path_escape", "file belongs to another server");
    if (!scopeAllows(authorization.scope, required)) throw new FileServiceError("path_escape", `file operation requires ${required} scope`);
    if (authorization.projectId === undefined && authorization.scope !== "admin") throw new FileServiceError("path_escape", "file project identity is missing");
    if (authorization.projectId !== undefined && authorization.projectId !== projectId) throw new FileServiceError("path_escape", "file is outside the authorized project");
    if (this.options.authorizeProject?.(authorization, projectId) === false) throw new FileServiceError("path_escape", "file is outside the authorized project");
    const project = typeof (this.options.projects as ReadonlyMap<string, FileCatalogProjectContext>).get === "function"
      ? (this.options.projects as ReadonlyMap<string, FileCatalogProjectContext>).get(projectId)
      : (this.options.projects as Readonly<Record<string, FileCatalogProjectContext>>)[projectId];
    if (project === undefined || project.projectId !== projectId || !(project.catalog instanceof FileCatalog)) throw new FileServiceError("path_escape", "project is not authorized");
    return project.catalog;
  }

  private authorization(request: QueryRequest | CommandRequest): FileCatalogAuthorization {
    return { serverId: this.serverId, clientId: request.context.clientId, scope: request.context.authScope, ...(claimsProject(request.context.claims) === undefined ? {} : { projectId: claimsProject(request.context.claims) }) };
  }

  private payload(request: QueryRequest | CommandRequest): Record<string, unknown> {
    const value = request.envelope.payload;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidRequest("file catalog payload must be an object");
    return value as Record<string, unknown>;
  }

  private pathRequest(request: QueryRequest | CommandRequest): FileCatalogRequest {
    const payload = this.payload(request);
    return { authorization: this.authorization(request), ...(optionalProject(payload.projectId) === undefined ? {} : { projectId: optionalProject(payload.projectId) }), path: requiredPath(typeof payload.path === "string" ? payload.path : undefined), signal: request.context.signal };
  }

  private optionsRequest(request: QueryRequest): FileCatalogRequest & { readonly options?: Record<string, unknown> } {
    const payload = this.payload(request);
    const path = typeof payload.path === "string" ? payload.path : ".";
    const options = typeof payload.options === "object" && payload.options !== null && !Array.isArray(payload.options) ? payload.options as Record<string, unknown> : undefined;
    return { authorization: this.authorization(request), ...(optionalProject(payload.projectId) === undefined ? {} : { projectId: optionalProject(payload.projectId) }), path, signal: request.context.signal, ...(options === undefined ? {} : { options }) };
  }

  private listRequest(request: QueryRequest): FileCatalogRequest & { readonly options?: FileCatalogListOptions } { return this.optionsRequest(request) as FileCatalogRequest & { readonly options?: FileCatalogListOptions }; }
  private searchRequest(request: QueryRequest): FileCatalogRequest & { readonly query: string; readonly options?: FileCatalogSearchOptions } {
    const payload = this.payload(request);
    return { ...this.optionsRequest(request), query: typeof payload.query === "string" ? payload.query : invalidRequest("search query is invalid") as never } as FileCatalogRequest & { readonly query: string; readonly options?: FileCatalogSearchOptions };
  }
  private createFileRequest(request: CommandRequest): FileCatalogRequest & { readonly bytes: Uint8Array } {
    const payload = this.payload(request);
    const bytes = request.body.byteLength > 0 ? new Uint8Array(request.body) : decodeBase64(payload.bytesBase64);
    return { ...this.pathRequest(request), bytes };
  }
  private renameRequest(request: CommandRequest): FileCatalogRequest & { readonly destination: string } {
    const payload = this.payload(request);
    return { ...this.pathRequest(request), destination: requiredPath(typeof payload.destination === "string" ? payload.destination : undefined) };
  }
  private deleteRequest(request: CommandRequest): FileCatalogRequest & { readonly recursive?: boolean } {
    const payload = this.payload(request);
    return { ...this.pathRequest(request), ...(typeof payload.recursive === "boolean" ? { recursive: payload.recursive } : {}) };
  }
}

function requiredPath(value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.includes("\0") || value.includes("\\") || value.startsWith("/")) throw invalidRequest("file path is invalid");
  return value;
}

function optionalProject(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.includes("\0")) throw invalidRequest("project id is invalid");
  return value;
}

function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) throw invalidRequest("file bytes are invalid");
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function claimsProject(value: unknown): string | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as Record<string, unknown>).projectId === "string" ? (value as Record<string, string>).projectId : undefined; }
function withSignal<T extends object>(options: T | undefined, signal: AbortSignal | undefined): T & { readonly signal?: AbortSignal } {
  return { ...(options ?? {}), ...(signal === undefined ? {} : { signal }) } as T & { readonly signal?: AbortSignal };
}
function invalidRequest(message: string): FileServiceError { return new FileServiceError("invalid_path", message); }
function asJson(value: unknown): JsonValue { return value as JsonValue; }
function validId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value); }
