import { scopeAllows } from "../auth.js";
import type { AuthScope, JsonValue } from "@terminay/protocol";
import type { CommandRequest, QueryRequest } from "../types.js";
import { CanonicalProjectPathResolver } from "./pathResolver.js";
import { FileServiceError } from "./types.js";
import type {
  FileMutationResult,
  FileReadRange,
  FileSessionMetadata,
  FileSessionOptions,
  FileSessionState,
  FileSessionStorage,
  ReloadOptions,
} from "./types.js";
import { FileSession } from "./fileSession.js";

/** Stable application-protocol operation names for the server-owned file contract. */
export const FILE_OPERATIONS = Object.freeze({
  open: "files.open",
  metadata: "files.metadata",
  readRange: "files.read-range",
  readText: "files.read-text",
  edit: "files.edit",
  save: "files.save",
  reload: "files.reload",
  keepLocal: "files.keep-local",
  close: "files.close",
} as const);

export interface FileProjectContext {
  readonly projectId: string;
  readonly resolver: CanonicalProjectPathResolver;
  readonly storage: FileSessionStorage;
}

export interface FileAuthorization {
  /** This assertion must come from the authenticated transport, not payload. */
  readonly serverId: string;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly clientId?: string;
  readonly scope: AuthScope;
}

export interface FileAdapterOptions {
  readonly serverId: string;
  readonly projects: ReadonlyMap<string, FileProjectContext> | Readonly<Record<string, FileProjectContext>>;
  readonly maxSessions?: number;
  readonly maxDraftBytes?: number;
  readonly maxRangeBytes?: number;
  readonly authorizeProject?: (authorization: FileAuthorization, projectId: string) => boolean;
  readonly generateSessionId?: (projectId: string, canonicalPath: string) => string;
}

export interface FileOpenRequest {
  readonly authorization: FileAuthorization;
  readonly projectId?: string;
  /** Project-relative path only; absolute paths are never accepted. */
  readonly path: string;
}

export interface FileOpenResult {
  readonly serverId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly relativePath: string;
  readonly metadata: FileSessionMetadata;
}

export interface FileSessionRequest {
  readonly authorization: FileAuthorization;
  readonly sessionId: string;
}

export interface FileReadRangeRequest extends FileSessionRequest {
  readonly offset: number;
  readonly length: number;
  readonly signal?: AbortSignal;
}

export interface FileTextRange extends FileReadRange {
  readonly text: string;
  readonly invalidEncoding: boolean;
}

export interface FileEditRequest extends FileSessionRequest {
  readonly bytes: Uint8Array;
  readonly expectedDraftRevision?: number;
}

export interface FileSaveRequest extends FileSessionRequest {
  readonly expectedDiskRevision?: number;
  readonly expectedDraftRevision?: number;
}

export interface FileReloadRequest extends FileSessionRequest {
  readonly confirm?: boolean;
  readonly expectedDiskRevision?: number;
  readonly expectedDraftRevision?: number;
}

export interface FileCloseRequest extends FileSessionRequest {
  readonly confirmDirty?: boolean;
}

export interface FileOperationHandlers {
  readonly queries: Readonly<Record<string, (request: QueryRequest) => JsonValue | Promise<JsonValue>>>;
  readonly commands: Readonly<Record<string, (request: CommandRequest) => JsonValue | Promise<JsonValue>>>;
}

interface SessionRecord {
  readonly sessionId: string;
  readonly serverId: string;
  readonly projectId: string;
  readonly relativePath: string;
  readonly canonicalPath: string;
  readonly context: FileProjectContext;
  readonly session: FileSession;
}

/**
 * Authorization/application boundary for server-owned file sessions.
 *
 * The adapter deliberately keeps canonical resolution and storage together in
 * a project context. Every operation re-resolves the stored relative path and
 * rejects a changed canonical identity, so a stale panel cannot follow a
 * rename, symlink, or cross-project alias into a new file.
 */
export class ServerFileAdapter {
  readonly serverId: string;
  private readonly options: FileAdapterOptions;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sessionsByPath = new Map<string, string>();
  private readonly maxSessions: number;
  private readonly maxDraftBytes: number | undefined;
  private readonly maxRangeBytes: number | undefined;
  private sessionCounter = 0;

  constructor(options: FileAdapterOptions) {
    if (typeof options?.serverId !== "string" || !validId(options.serverId)) throw new TypeError("file server id is invalid");
    if (options.projects === undefined || typeof options.projects !== "object" || options.projects === null) throw new TypeError("file projects are required");
    this.serverId = options.serverId;
    this.options = options;
    this.maxSessions = positive(options.maxSessions ?? 1024, "maxSessions");
    this.maxDraftBytes = optionalPositive(options.maxDraftBytes, "maxDraftBytes");
    this.maxRangeBytes = optionalPositive(options.maxRangeBytes, "maxRangeBytes");
  }

  get size(): number { return this.sessions.size; }

  async open(request: FileOpenRequest): Promise<FileOpenResult> {
    const projectId = request.projectId ?? request.authorization.projectId;
    if (projectId === undefined) throw invalidRequest("projectId is required");
    const authorization = this.requireProject(request.authorization, projectId, "read");
    const relativePath = normalizeRelative(request.path);
    const context = this.project(projectId);
    const canonicalPath = await context.resolver.resolve(relativePath, { requireFile: true });
    const pathKey = `${projectId}\u0000${canonicalPath}`;
    const existingId = this.sessionsByPath.get(pathKey);
    if (existingId !== undefined) {
      const existing = this.sessions.get(existingId);
      if (existing !== undefined) {
        this.requireSession(authorization, existing, existing.sessionId);
        await this.assertCanonical(existing);
        return this.openResult(existing);
      }
      this.sessionsByPath.delete(pathKey);
    }
    if (this.sessions.size >= this.maxSessions) throw new FileServiceError("draft_too_large", "file session limit reached", { max: this.maxSessions });
    const metadata = context.storage.stat === undefined ? undefined : await context.storage.stat(canonicalPath);
    const sessionOptions: FileSessionOptions = {
      ...(metadata === undefined ? {} : { initialMetadata: metadata }),
      ...(this.maxDraftBytes === undefined ? {} : { maxDraftBytes: this.maxDraftBytes }),
      ...(this.maxRangeBytes === undefined ? {} : { maxRangeBytes: this.maxRangeBytes }),
    };
    const session = new FileSession(canonicalPath, context.storage, sessionOptions);
    const sessionId = this.makeSessionId(projectId, canonicalPath);
    const record: SessionRecord = { sessionId, serverId: this.serverId, projectId, relativePath, canonicalPath, context, session };
    this.sessions.set(sessionId, record);
    this.sessionsByPath.set(pathKey, sessionId);
    return this.openResult(record);
  }

  async metadata(request: FileSessionRequest): Promise<FileSessionMetadata> {
    const record = this.authorizedSession(request, "read");
    await this.assertCanonical(record);
    return record.session.metadata();
  }

  readRange(request: FileReadRangeRequest): Promise<FileReadRange> {
    const record = this.authorizedSession(request, "read");
    return this.assertCanonical(record).then(() => record.session.readRange(request.offset, request.length, request.signal));
  }

  async readText(request: FileReadRangeRequest): Promise<FileTextRange> {
    const range = await this.readRange(request);
    let text: string;
    let invalidEncoding = false;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(range.bytes); }
    catch { text = new TextDecoder("utf-8").decode(range.bytes); invalidEncoding = true; }
    return Object.freeze({ ...range, text, invalidEncoding });
  }

  async edit(request: FileEditRequest): Promise<FileMutationResult<FileSessionState>> {
    const record = this.authorizedSession(request, "write");
    await this.assertCanonical(record);
    return record.session.applyDraft(request.bytes, { expectedDraftRevision: request.expectedDraftRevision });
  }

  save(request: FileSaveRequest): Promise<FileMutationResult<FileSessionState>> {
    const record = this.authorizedSession(request, "write");
    return this.assertCanonical(record).then(() => record.session.save({ expectedDiskRevision: request.expectedDiskRevision, expectedDraftRevision: request.expectedDraftRevision }));
  }

  reload(request: FileReloadRequest): Promise<FileMutationResult<FileSessionState>> {
    const record = this.authorizedSession(request, "write");
    const options: ReloadOptions = { confirm: request.confirm, expectedDiskRevision: request.expectedDiskRevision, expectedDraftRevision: request.expectedDraftRevision };
    return this.assertCanonical(record).then(() => record.session.reload(options));
  }

  async keepLocal(request: FileSessionRequest): Promise<FileMutationResult<FileSessionState>> {
    const record = this.authorizedSession(request, "write");
    await this.assertCanonical(record);
    return record.session.keepLocal();
  }

  async close(request: FileCloseRequest): Promise<FileMutationResult<FileSessionState>> {
    const record = this.authorizedSession(request, "write");
    await this.assertCanonical(record);
    if (record.session.dirty && request.confirmDirty !== true) return { ok: false, error: new FileServiceError("save_precondition", "dirty file requires explicit close confirmation") };
    if (record.session.dirty) {
      const reloaded = await record.session.reload({ confirm: true });
      if (!reloaded.ok) return reloaded;
    }
    const closed = record.session.close();
    if (closed.ok) this.remove(record);
    return closed;
  }

  /** Client disconnects do not discard server-owned dirty drafts. */
  disconnect(): readonly FileOpenResult[] { return [...this.sessions.values()].map((record) => this.openResult(record)); }

  operations(): FileOperationHandlers {
    return {
      queries: {
        [FILE_OPERATIONS.open]: (request) => asJson(this.open(this.openRequest(request))),
        [FILE_OPERATIONS.metadata]: async (request) => asJson(await this.metadata(this.sessionRequest(request))),
        [FILE_OPERATIONS.readRange]: async (request) => asJson(serializeRange(await this.readRange(this.rangeRequest(request)))),
        [FILE_OPERATIONS.readText]: async (request) => asJson(serializeText(await this.readText(this.rangeRequest(request)))),
      },
      commands: {
        [FILE_OPERATIONS.edit]: async (request) => asJson(await this.edit(this.editRequest(request))),
        [FILE_OPERATIONS.save]: async (request) => asJson(await this.save(this.saveRequest(request))),
        [FILE_OPERATIONS.reload]: async (request) => asJson(await this.reload(this.reloadRequest(request))),
        [FILE_OPERATIONS.keepLocal]: async (request) => asJson(await this.keepLocal(this.sessionRequest(request))),
        [FILE_OPERATIONS.close]: async (request) => asJson(await this.close(this.closeRequest(request))),
      },
    };
  }

  private project(projectId: string): FileProjectContext {
    const project = typeof (this.options.projects as ReadonlyMap<string, FileProjectContext>).get === "function"
      ? (this.options.projects as ReadonlyMap<string, FileProjectContext>).get(projectId)
      : (this.options.projects as Readonly<Record<string, FileProjectContext>>)[projectId];
    if (project === undefined || project.projectId !== projectId) throw new FileServiceError("path_escape", "project is not authorized");
    if (!(project.resolver instanceof CanonicalProjectPathResolver)) throw new TypeError("project resolver is invalid");
    if (typeof project.storage.atomicWrite !== "function") throw new TypeError("project storage cannot save files");
    return project;
  }

  private requireProject(authorization: FileAuthorization, projectId: string, required: AuthScope): FileAuthorization {
    this.requireServer(authorization);
    if (!scopeAllows(authorization.scope, required)) throw new FileServiceError("path_escape", `file operation requires ${required} scope`);
    if (authorization.projectId === undefined && authorization.scope !== "admin") throw new FileServiceError("path_escape", "file project identity is missing");
    if (authorization.projectId !== undefined && authorization.projectId !== projectId) throw new FileServiceError("path_escape", "file is outside the authorized project");
    if (this.options.authorizeProject?.(authorization, projectId) === false) throw new FileServiceError("path_escape", "file is outside the authorized project");
    return authorization;
  }

  private requireServer(authorization: FileAuthorization): void {
    if (authorization.serverId !== this.serverId) throw new FileServiceError("path_escape", "file belongs to another server");
  }

  private authorizedSession(request: FileSessionRequest, required: AuthScope): SessionRecord {
    this.requireServer(request.authorization);
    if (!scopeAllows(request.authorization.scope, required)) throw new FileServiceError("path_escape", `file operation requires ${required} scope`);
    const record = this.sessions.get(request.sessionId);
    if (record === undefined) throw new FileServiceError("path_missing", "file session not found", { canonical: request.sessionId });
    this.requireProject(request.authorization, record.projectId, required);
    this.requireSession(request.authorization, record, request.sessionId);
    return record;
  }

  private requireSession(authorization: FileAuthorization, record: SessionRecord, sessionId: string): void {
    if (record.serverId !== this.serverId || (authorization.projectId === undefined && authorization.scope !== "admin") || (authorization.projectId !== undefined && record.projectId !== authorization.projectId)) throw new FileServiceError("path_escape", "file session identity mismatch");
    if (authorization.sessionId !== undefined && authorization.sessionId !== sessionId) throw new FileServiceError("path_escape", "file session identity mismatch");
  }

  private async assertCanonical(record: SessionRecord): Promise<void> {
    const canonical = await record.context.resolver.resolve(record.relativePath, { requireFile: true });
    if (canonical !== record.canonicalPath) throw new FileServiceError("revision_conflict", "file canonical identity changed", { canonical: record.canonicalPath });
  }

  private openResult(record: SessionRecord): FileOpenResult {
    return Object.freeze({ serverId: record.serverId, projectId: record.projectId, sessionId: record.sessionId, relativePath: record.relativePath, metadata: Object.freeze(record.session.metadata()) });
  }

  private makeSessionId(projectId: string, canonicalPath: string): string {
    const generated = this.options.generateSessionId?.(projectId, canonicalPath) ?? `file-${(++this.sessionCounter).toString(36)}`;
    if (!validId(generated) || this.sessions.has(generated)) throw new FileServiceError("path_missing", "file session id is unavailable");
    return generated;
  }

  private remove(record: SessionRecord): void {
    this.sessions.delete(record.sessionId);
    this.sessionsByPath.delete(`${record.projectId}\u0000${record.canonicalPath}`);
  }

  private openRequest(request: QueryRequest): FileOpenRequest {
    const payload = objectPayload(request.envelope.payload);
    return { authorization: this.authorization(request), path: stringField(payload, "path"), ...(optionalString(payload.projectId) === undefined ? {} : { projectId: optionalString(payload.projectId) }) };
  }

  private sessionRequest(request: QueryRequest | CommandRequest): FileSessionRequest { return { authorization: this.authorization(request), sessionId: stringField(objectPayload(request.envelope.payload), "sessionId") }; }
  private rangeRequest(request: QueryRequest): FileReadRangeRequest { const payload = objectPayload(request.envelope.payload); return { authorization: this.authorization(request), sessionId: stringField(payload, "sessionId"), offset: uintField(payload, "offset"), length: uintField(payload, "length"), signal: request.context.signal }; }
  private editRequest(request: CommandRequest): FileEditRequest { const payload = objectPayload(request.envelope.payload); return { authorization: this.authorization(request), sessionId: stringField(payload, "sessionId"), bytes: request.body.byteLength > 0 ? new Uint8Array(request.body) : textBytes(typeof payload.text === "string" ? payload.text : ""), ...(optionalUInt(payload.expectedDraftRevision) === undefined ? {} : { expectedDraftRevision: optionalUInt(payload.expectedDraftRevision) }) }; }
  private saveRequest(request: CommandRequest): FileSaveRequest { const payload = objectPayload(request.envelope.payload); return { authorization: this.authorization(request), sessionId: stringField(payload, "sessionId"), ...(optionalUInt(payload.expectedDiskRevision) === undefined ? {} : { expectedDiskRevision: optionalUInt(payload.expectedDiskRevision) }), ...(optionalUInt(payload.expectedDraftRevision) === undefined ? {} : { expectedDraftRevision: optionalUInt(payload.expectedDraftRevision) }) }; }
  private reloadRequest(request: CommandRequest): FileReloadRequest { const payload = objectPayload(request.envelope.payload); return { authorization: this.authorization(request), sessionId: stringField(payload, "sessionId"), ...(typeof payload.confirm === "boolean" ? { confirm: payload.confirm } : {}), ...(optionalUInt(payload.expectedDiskRevision) === undefined ? {} : { expectedDiskRevision: optionalUInt(payload.expectedDiskRevision) }), ...(optionalUInt(payload.expectedDraftRevision) === undefined ? {} : { expectedDraftRevision: optionalUInt(payload.expectedDraftRevision) }) }; }
  private closeRequest(request: CommandRequest): FileCloseRequest { const payload = objectPayload(request.envelope.payload); return { authorization: this.authorization(request), sessionId: stringField(payload, "sessionId"), ...(typeof payload.confirmDirty === "boolean" ? { confirmDirty: payload.confirmDirty } : {}) }; }
  private authorization(request: QueryRequest | CommandRequest): FileAuthorization { return { serverId: this.serverId, clientId: request.context.clientId, scope: request.context.authScope, ...(claimsProject(request.context.claims) === undefined ? {} : { projectId: claimsProject(request.context.claims) }), ...(claimsSession(request.context.claims) === undefined ? {} : { sessionId: claimsSession(request.context.claims) }) }; }
}

function objectPayload(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidRequest("file payload must be an object"); return value as Record<string, unknown>; }
function stringField(value: Record<string, unknown>, key: string): string { const candidate = value[key]; if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 4096 || candidate.includes("\0")) throw invalidRequest(`${key} is invalid`); return candidate; }
function optionalString(value: unknown): string | undefined { if (value === undefined) return undefined; if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.includes("\0")) throw invalidRequest("string field is invalid"); return value; }
function optionalUInt(value: unknown): number | undefined { if (value === undefined) return undefined; if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalidRequest("revision is invalid"); return value as number; }
function uintField(value: Record<string, unknown>, key: string): number { const candidate = value[key]; if (!Number.isSafeInteger(candidate) || (candidate as number) < 0) throw invalidRequest(`${key} is invalid`); return candidate as number; }
function normalizeRelative(value: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.includes("\0") || value.includes("\\") || value.startsWith("/")) throw new FileServiceError("invalid_path", "file path is invalid"); const parts = value.split("/"); if (parts.some((part) => part.length === 0 || part === "." || part === "..")) throw new FileServiceError("invalid_path", "file path is not canonical"); return parts.join("/"); }
function claimsProject(value: unknown): string | undefined { return claimsString(value, "projectId"); }
function claimsSession(value: unknown): string | undefined { return claimsString(value, "sessionId"); }
function claimsString(value: unknown, key: string): string | undefined { if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined; const candidate = (value as Record<string, unknown>)[key]; return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined; }
function serializeRange(range: FileReadRange): JsonValue { return { ...range, bytes: bytesToBase64(range.bytes) } as unknown as JsonValue; }
function serializeText(range: FileTextRange): JsonValue { return { ...serializeRange(range) as Record<string, unknown>, text: range.text, invalidEncoding: range.invalidEncoding } as unknown as JsonValue; }
function bytesToBase64(bytes: Uint8Array): string { let value = ""; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value); }
function textBytes(value: string): Uint8Array { return new TextEncoder().encode(value); }
function asJson(value: unknown): JsonValue { return value as JsonValue; }
function invalidRequest(message: string): FileServiceError { return new FileServiceError("invalid_path", message); }
function validId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value); }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`); return value; }
function optionalPositive(value: number | undefined, name: string): number | undefined { return value === undefined ? undefined : positive(value, name); }
