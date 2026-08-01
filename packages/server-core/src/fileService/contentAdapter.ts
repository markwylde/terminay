import { scopeAllows } from "../auth.js";
import type { AuthScope, JsonValue } from "@terminay/protocol";
import type { BinaryQueryHandlerResult, CommandRequest, QueryHandler, QueryRequest } from "../types.js";
import { FileContentError, FileContentStreamService, type FileContentHexRange, type FileContentPreview, type FileContentRange, type FileContentTextRange } from "./contentStream.js";
import { ServerTextIndex } from "./textIndex.js";

/** Application-protocol operation names for bounded file content transfers. */
export const FILE_CONTENT_OPERATIONS = Object.freeze({
  capabilities: "files.content-capabilities",
  readRange: "files.content-range",
  readText: "files.content-text",
  readHex: "files.content-hex",
  readPreview: "files.content-preview",
  textMetadata: "file.text-metadata",
  textLines: "file.text-lines",
} as const);

export interface FileContentProjectContext {
  readonly projectId: string;
  readonly content: FileContentStreamService;
}

export interface FileContentAuthorization {
  readonly serverId: string;
  readonly projectId?: string;
  readonly clientId?: string;
  readonly scope: AuthScope;
}

export interface FileContentAdapterOptions {
  readonly serverId: string;
  readonly projects: ReadonlyMap<string, FileContentProjectContext> | Readonly<Record<string, FileContentProjectContext>>;
  readonly authorizeProject?: (authorization: FileContentAuthorization, projectId: string) => boolean;
}

export interface FileContentRequest {
  readonly authorization: FileContentAuthorization;
  readonly projectId?: string;
  readonly path: string;
  readonly signal?: AbortSignal;
}

/**
 * Authenticated application boundary for bounded content. The stream service
 * owns path canonicalization, caps, decoding and backpressure; this adapter
 * owns server/project claims and JSON-safe byte serialization.
 */
export class ServerFileContentAdapter {
  readonly serverId: string;
  private readonly options: FileContentAdapterOptions;
  private readonly textIndexes = new Map<string, ServerTextIndex>();

  constructor(options: FileContentAdapterOptions) {
    if (typeof options?.serverId !== "string" || !validId(options.serverId)) throw new TypeError("file content server id is invalid");
    if (options.projects === undefined || typeof options.projects !== "object" || options.projects === null) throw new TypeError("file content projects are required");
    this.serverId = options.serverId;
    this.options = options;
  }

  async capabilities(request: FileContentRequest): Promise<JsonValue> {
    return asJson(await this.authorizedContent(request, "read").capabilities(request.path, request.signal));
  }

  async readRange(request: FileContentRequest & { readonly offset: number; readonly length: number }): Promise<BinaryQueryHandlerResult> {
    const value = await this.authorizedContent(request, "read").readRange(request.path, request.offset, request.length, request.signal);
    return { result: serializeRangeMetadata(value), body: value.bytes };
  }

  async readText(request: FileContentRequest & { readonly offset: number; readonly length: number }): Promise<JsonValue> {
    return serializeText(await this.authorizedContent(request, "read").readText(request.path, request.offset, request.length, request.signal));
  }

  async readHex(request: FileContentRequest & { readonly offset: number; readonly length: number; readonly bytesPerRow?: number }): Promise<JsonValue> {
    return serializeHex(await this.authorizedContent(request, "read").readHex(request.path, request.offset, request.length, request.bytesPerRow, request.signal));
  }

  async readPreview(request: FileContentRequest): Promise<JsonValue> {
    return serializePreview(await this.authorizedContent(request, "read").readPreview(request.path, request.signal));
  }

  async textMetadata(request: FileContentRequest): Promise<JsonValue> {
    return asJson(await this.textIndex(request).metadata(request.path, request.signal));
  }

  async textLines(request: FileContentRequest & { readonly startLine: number; readonly lineCount: number }): Promise<JsonValue> {
    return asJson(await this.textIndex(request).lines(request.path, request.startLine, request.lineCount, request.signal));
  }

  operations(): { readonly queries: Readonly<Record<string, QueryHandler>>; readonly commands: Readonly<Record<string, (request: CommandRequest) => JsonValue | Promise<JsonValue>>> } {
    return {
      queries: {
        [FILE_CONTENT_OPERATIONS.capabilities]: (request) => this.capabilities(this.pathRequest(request)),
        [FILE_CONTENT_OPERATIONS.readRange]: (request) => this.readRange(this.rangeRequest(request)),
        [FILE_CONTENT_OPERATIONS.readText]: (request) => this.readText(this.rangeRequest(request)),
        [FILE_CONTENT_OPERATIONS.readHex]: (request) => this.readHex(this.hexRequest(request)),
        [FILE_CONTENT_OPERATIONS.readPreview]: (request) => this.readPreview(this.pathRequest(request)),
        [FILE_CONTENT_OPERATIONS.textMetadata]: (request) => this.textMetadata(this.pathRequest(request)),
        [FILE_CONTENT_OPERATIONS.textLines]: (request) => this.textLines(this.textLinesRequest(request)),
      },
      commands: {},
    };
  }

  private authorizedContent(request: FileContentRequest, required: AuthScope): FileContentStreamService {
    const projectId = request.projectId ?? request.authorization.projectId;
    if (projectId === undefined) throw new FileContentError("invalid_path", "file project identity is missing");
    const authorization = request.authorization;
    if (authorization.serverId !== this.serverId) throw new FileContentError("invalid_path", "file belongs to another server");
    if (!scopeAllows(authorization.scope, required)) throw new FileContentError("invalid_path", `file operation requires ${required} scope`);
    if (authorization.projectId === undefined && authorization.scope !== "admin") throw new FileContentError("invalid_path", "file project identity is missing");
    if (authorization.projectId !== undefined && authorization.projectId !== projectId) throw new FileContentError("invalid_path", "file is outside the authorized project");
    if (this.options.authorizeProject?.(authorization, projectId) === false) throw new FileContentError("invalid_path", "file is outside the authorized project");
    const project = typeof (this.options.projects as ReadonlyMap<string, FileContentProjectContext>).get === "function"
      ? (this.options.projects as ReadonlyMap<string, FileContentProjectContext>).get(projectId)
      : (this.options.projects as Readonly<Record<string, FileContentProjectContext>>)[projectId];
    if (project === undefined || project.projectId !== projectId || !(project.content instanceof FileContentStreamService)) throw new FileContentError("storage_unavailable", "file project is unavailable");
    return project.content;
  }

  private textIndex(request: FileContentRequest): ServerTextIndex {
    const content = this.authorizedContent(request, "read");
    const projectId = request.projectId ?? request.authorization.projectId!;
    let index = this.textIndexes.get(projectId);
    if (index === undefined) {
      index = new ServerTextIndex(content);
      this.textIndexes.set(projectId, index);
    }
    return index;
  }

  private authorization(request: QueryRequest | CommandRequest): FileContentAuthorization {
    return { serverId: this.serverId, clientId: request.context.clientId, scope: request.context.authScope, ...(claimsProject(request.context.claims) === undefined ? {} : { projectId: claimsProject(request.context.claims) }) };
  }

  private payload(request: QueryRequest | CommandRequest): Record<string, unknown> {
    const value = request.envelope.payload;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidRequest("file content payload must be an object");
    return value as Record<string, unknown>;
  }

  private pathRequest(request: QueryRequest | CommandRequest): FileContentRequest {
    const payload = this.payload(request);
    return { authorization: this.authorization(request), ...(optionalProject(payload.projectId) === undefined ? {} : { projectId: optionalProject(payload.projectId) }), path: requiredPath(payload.path), signal: request.context.signal };
  }

  private rangeRequest(request: QueryRequest): FileContentRequest & { readonly offset: number; readonly length: number } {
    const payload = this.payload(request);
    return { ...this.pathRequest(request), offset: uintField(payload.offset, "offset"), length: uintField(payload.length, "length") };
  }

  private hexRequest(request: QueryRequest): FileContentRequest & { readonly offset: number; readonly length: number; readonly bytesPerRow?: number } {
    const payload = this.payload(request);
    const bytesPerRow = payload.bytesPerRow === undefined ? undefined : uintField(payload.bytesPerRow, "bytesPerRow");
    return { ...this.rangeRequest(request), ...(bytesPerRow === undefined ? {} : { bytesPerRow }) };
  }

  private textLinesRequest(request: QueryRequest): FileContentRequest & { readonly startLine: number; readonly lineCount: number } {
    const payload = this.payload(request);
    return { ...this.pathRequest(request), startLine: uintField(payload.startLine, "startLine"), lineCount: positiveUintField(payload.lineCount, "lineCount", 512) };
  }
}

function serializeRangeMetadata({ bytes: _bytes, ...value }: FileContentRange): JsonValue { return asJson({ ...value, bodyLength: _bytes.byteLength }); }
function serializeText(value: FileContentTextRange): JsonValue { return asJson({ ...value, bytes: bytesToBase64(value.bytes), text: value.text, invalidEncoding: value.invalidEncoding }); }
function serializeHex(value: FileContentHexRange): JsonValue { return asJson({ ...value, bytes: bytesToBase64(value.bytes), rows: value.rows }); }
function serializePreview(value: FileContentPreview): JsonValue { return asJson({ ...value, bytes: bytesToBase64(value.bytes) }); }
function bytesToBase64(bytes: Uint8Array): string { let value = ""; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value); }
function requiredPath(value: unknown): string { if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.includes("\0") || value.includes("\\") || value.startsWith("/")) throw invalidRequest("file path is invalid"); return value; }
function optionalProject(value: unknown): string | undefined { if (value === undefined) return undefined; if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.includes("\0")) throw invalidRequest("project id is invalid"); return value; }
function uintField(value: unknown, name: string): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalidRequest(`${name} is invalid`); return value as number; }
function positiveUintField(value: unknown, name: string, maximum: number): number { const parsed = uintField(value, name); if (parsed < 1 || parsed > maximum) throw invalidRequest(`${name} is invalid`); return parsed; }
function claimsProject(value: unknown): string | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as Record<string, unknown>).projectId === "string" ? (value as Record<string, string>).projectId : undefined; }
function invalidRequest(message: string): FileContentError { return new FileContentError("invalid_path", message); }
function asJson(value: unknown): JsonValue { return value as JsonValue; }
function validId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value); }
