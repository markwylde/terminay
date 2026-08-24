import { posix } from "node:path";
import { randomBytes } from "node:crypto";
import { openSftp, callbackPromise } from "./transport.js";
import type { AuthenticationBroker, SshClient } from "./transport.js";
import { normalizeError, SshProviderError } from "./errors.js";
import { assertAbsolute } from "./validation.js";

const DEFAULT_LIMITS = Object.freeze({ entries: 10_000, readBytes: 8 * 1024 * 1024, writeBytes: 8 * 1024 * 1024, pathBytes: 4096 });

interface FilesystemLimits {
  entries: number;
  readBytes: number;
  writeBytes: number;
  pathBytes: number;
}

interface ConnectionLease { client: SshClient; release(): void }
interface ConnectionPool {
  acquire(profileId: string, revision: number, options: { signal?: AbortSignal; broker?: AuthenticationBroker }): Promise<ConnectionLease>;
}
interface FileAttributes {
  size: number;
  mode: number;
  mtime: number;
  atime: number;
  isDirectory(): boolean;
  isSymbolicLink?(): boolean;
}
interface DirectoryEntry { filename: string; attrs: FileAttributes }
type SftpCallback<T = unknown> = (error: Error | null | undefined, value: T) => void;
interface SftpClient {
  [method: string]: unknown;
  read(handle: unknown, buffer: Buffer, offset: number, length: number, position: number, callback: (error: unknown, bytesRead: number) => void): void;
  ext_openssh_rename?: (from: string, to: string, callback: SftpCallback<void>) => void;
}
interface BaseInput { profileId: string; revision: number; root: string; authBroker?: AuthenticationBroker }
interface PathInput extends BaseInput { path: string }
interface BrowseInput extends BaseInput { path?: string }
interface ReadInput extends PathInput { offset?: number; length?: number }
interface WriteInput extends PathInput { data?: string; encoding?: string; expectedMtimeMs?: number; mode?: number }
interface ModeInput extends PathInput { mode?: number }
interface RenameInput extends PathInput { destination: string }
interface RootInput extends Omit<BaseInput, "root"> { root?: string }
type Metadata = { path?: string; size: number; mode: number; mtimeMs: number; atimeMs: number; type: "directory" | "symlink" | "file" };

export class SftpFilesystem {
  #pool: ConnectionPool; #limits: FilesystemLimits;
  constructor(pool: ConnectionPool, limits: Partial<FilesystemLimits> = {}) { this.#pool = pool; this.#limits = { ...DEFAULT_LIMITS, ...limits }; }
  async resolveRoot(input: RootInput, signal?: AbortSignal): Promise<{ root: string }> {
    const lease = await this.#pool.acquire(input.profileId, input.revision, { signal, broker: input.authBroker });
    try { const sftp = await openSftp(lease.client) as SftpClient; const requested = input.root === "~" || !input.root ? "." : input.root; const canonical = assertAbsolute(await call<string>(sftp, "realpath", requested)); const attrs = await call<FileAttributes>(sftp, "stat", canonical); if (!attrs.isDirectory()) throw new SshProviderError("root-unavailable", "Remote project root is not a directory"); return { root: canonical }; }
    catch (error) { throw rootError(error); } finally { lease.release(); }
  }
  async browse(input: BrowseInput, signal?: AbortSignal) { const root = await this.resolveRoot(input, signal); return this.list({ ...input, root: root.root, path: input.path ?? root.root }, signal); }
  async realpath(input: PathInput, signal?: AbortSignal) { return this.#with(input, signal, async (sftp, root) => ({ path: await containedExisting(sftp, root, input.path, this.#limits.pathBytes) })); }
  async stat(input: PathInput, signal?: AbortSignal, follow = true) { return this.#with(input, signal, async (sftp, root) => { const path = follow ? await containedExisting(sftp, root, input.path, this.#limits.pathBytes) : containedLexical(root, input.path, this.#limits.pathBytes); const attrs = await call<FileAttributes>(sftp, follow ? "stat" : "lstat", path); return metadata(path, attrs); }); }
  async list(input: PathInput, signal?: AbortSignal) { return this.#with(input, signal, async (sftp, root) => { const path = await containedExisting(sftp, root, input.path, this.#limits.pathBytes); const attrs = await call<FileAttributes>(sftp, "stat", path); if (!attrs.isDirectory()) throw new SshProviderError("not-directory", "Remote path is not a directory"); const items = await call<DirectoryEntry[]>(sftp, "readdir", path); if (items.length > this.#limits.entries) throw new SshProviderError("too-large", "Remote directory contains too many entries"); return { path, entries: items.map((item) => ({ name: item.filename, path: posix.join(path, item.filename), ...metadata(undefined, item.attrs) })) }; }); }
  async read(input: ReadInput, signal?: AbortSignal) { return this.#with(input, signal, async (sftp, root) => { const path = await containedExisting(sftp, root, input.path, this.#limits.pathBytes); const attrs = await call<FileAttributes>(sftp, "stat", path); const offset = integer(input.offset ?? 0, 0, Number.MAX_SAFE_INTEGER); const length = integer(input.length ?? Math.min(attrs.size, this.#limits.readBytes), 0, this.#limits.readBytes); if (offset + length > attrs.size + 1) throw new SshProviderError("invalid-input", "Remote read range is invalid"); const handle = await call<unknown>(sftp, "open", path, "r"); try { const buffer = Buffer.alloc(length); const bytesRead = await readAt(sftp, handle, buffer, offset); return { path, data: buffer.subarray(0, bytesRead).toString("base64"), encoding: "base64", metadata: metadata(path, attrs) }; } finally { await closeQuietly(sftp, handle); } }); }
  async write(input: WriteInput, signal?: AbortSignal) {
    const data = decodeData(input.data, input.encoding, this.#limits.writeBytes);
    return this.#with(input, signal, async (sftp, root) => {
      const target = await containedForCreate(sftp, root, input.path, this.#limits.pathBytes); const temp = posix.join(posix.dirname(target), `.${posix.basename(target)}.terminay-${randomBytes(12).toString("hex")}.tmp`);
      let mutationStarted = false;
      try {
        if (input.expectedMtimeMs !== undefined) { const current = await call<FileAttributes>(sftp, "stat", target); if (Math.round(current.mtime * 1000) !== Math.round(input.expectedMtimeMs)) throw new SshProviderError("conflict", "Remote file changed since it was opened"); }
        mutationStarted = true; await call(sftp, "writeFile", temp, data, { mode: input.mode ?? 0o600 });
        const atomicRename = sftp.ext_openssh_rename;
        if (atomicRename) await callbackPromise<void>((callback) => atomicRename.call(sftp, temp, target, callback));
        else await call(sftp, "rename", temp, target);
        const attrs = await call<FileAttributes>(sftp, "stat", target); return { outcome: "written", metadata: metadata(target, attrs), atomic: typeof sftp.ext_openssh_rename === "function" };
      } catch (error) {
        await callQuietly(sftp, "unlink", temp);
        const normalized = normalizeError(error, mutationStarted ? "outcome-unknown" : "unreachable");
        if (mutationStarted && ["unreachable", "transport-lost"].includes(normalized.code)) throw new SshProviderError("outcome-unknown", "Remote save outcome is unknown; refresh before retrying", { reconciliationRequired: true });
        throw normalized;
      } finally { data.fill(0); }
    });
  }
  async createDirectory(input: ModeInput, signal?: AbortSignal) { return this.#mutation(input, signal, async (sftp, path) => { await call(sftp, "mkdir", path, { mode: input.mode ?? 0o700 }); return { outcome: "created", path }; }); }
  async rename(input: RenameInput, signal?: AbortSignal) { return this.#with(input, signal, async (sftp, root) => { const from = await containedExisting(sftp, root, input.path, this.#limits.pathBytes); const to = await containedForCreate(sftp, root, input.destination, this.#limits.pathBytes); try { await call(sftp, "rename", from, to); return { outcome: "renamed", from, to }; } catch (error) { throw ambiguous(error); } }); }
  async remove(input: PathInput, signal?: AbortSignal) { return this.#with(input, signal, async (sftp, root) => { const path = await containedExisting(sftp, root, input.path, this.#limits.pathBytes); if (path === root) throw new SshProviderError("permission-denied", "Project root cannot be removed"); try { const attrs = await call<FileAttributes>(sftp, "lstat", path); await call(sftp, attrs.isDirectory() ? "rmdir" : "unlink", path); return { outcome: "removed", path }; } catch (error) { throw ambiguous(error); } }); }
  async #mutation<T>(input: PathInput, signal: AbortSignal | undefined, operation: (sftp: SftpClient, path: string) => Promise<T>): Promise<T> { return this.#with(input, signal, async (sftp, root) => { const path = await containedForCreate(sftp, root, input.path, this.#limits.pathBytes); try { return await operation(sftp, path); } catch (error) { throw ambiguous(error); } }); }
  async #with<T>(input: BaseInput, signal: AbortSignal | undefined, operation: (sftp: SftpClient, root: string) => Promise<T>): Promise<T> { signal?.throwIfAborted(); const root = assertAbsolute(input.root); const lease = await this.#pool.acquire(input.profileId, input.revision, { signal, broker: input.authBroker }); try { const sftp = await openSftp(lease.client) as SftpClient; signal?.throwIfAborted(); const result = await operation(sftp, root); signal?.throwIfAborted(); return result; } catch (error) { if (signal?.aborted) throw new SshProviderError("cancelled", "Remote filesystem operation was cancelled"); throw error; } finally { lease.release(); } }
}

async function containedExisting(sftp: SftpClient, root: string, path: string, max: number): Promise<string> { const requested = containedLexical(root, path, max); const canonicalRoot = await call<string>(sftp, "realpath", root); const canonical = await call<string>(sftp, "realpath", requested); assertContained(canonicalRoot, canonical); return canonical; }
async function containedForCreate(sftp: SftpClient, root: string, path: string, max: number): Promise<string> { const requested = containedLexical(root, path, max); const canonicalRoot = await call<string>(sftp, "realpath", root); const parent = await call<string>(sftp, "realpath", posix.dirname(requested)); assertContained(canonicalRoot, parent); return posix.join(parent, posix.basename(requested)); }
function containedLexical(root: string, path: string, max: number): string { assertAbsolute(root); if (typeof path !== "string" || Buffer.byteLength(path) > max || path.includes("\0")) throw new SshProviderError("invalid-input", "Remote path is invalid"); const absolute = path.startsWith("/") ? posix.normalize(path) : posix.resolve(root, path); assertContained(posix.normalize(root), absolute); return absolute; }
function assertContained(root: string, path: string): void { if (path !== root && !path.startsWith(`${root.endsWith("/") ? root.slice(0, -1) : root}/`)) throw new SshProviderError("permission-denied", "Remote path escapes the project root"); }
function metadata(path: string | undefined, attrs: FileAttributes): Metadata { return { ...(path ? { path } : {}), size: attrs.size, mode: attrs.mode, mtimeMs: attrs.mtime * 1000, atimeMs: attrs.atime * 1000, type: attrs.isDirectory() ? "directory" : attrs.isSymbolicLink?.() ? "symlink" : "file" }; }
function call<T = unknown>(target: SftpClient, method: string, ...args: unknown[]): Promise<T> { const operation = target[method]; if (typeof operation !== "function") return Promise.reject(new SshProviderError("unsupported", `SFTP operation ${method} is unavailable`)); return callbackPromise((callback) => operation.call(target, ...args, callback)) as Promise<T>; }
async function callQuietly(target: SftpClient, method: string, ...args: unknown[]): Promise<void> { try { await call(target, method, ...args); } catch {} }
async function closeQuietly(sftp: SftpClient, handle: unknown): Promise<void> { try { await call(sftp, "close", handle); } catch {} }
function readAt(sftp: SftpClient, handle: unknown, buffer: Buffer, offset: number): Promise<number> { return new Promise((resolve, reject) => sftp.read(handle, buffer, 0, buffer.length, offset, (error, bytesRead) => error ? reject(normalizeError(error)) : resolve(bytesRead))); }
function decodeData(data: string | undefined, encoding: string | undefined, limit: number): Buffer { let value: Buffer; try { value = Buffer.from(data ?? "", encoding === "base64" ? "base64" : "utf8"); } catch { throw new SshProviderError("invalid-input", "File data is invalid"); } if (value.length > limit) throw new SshProviderError("too-large", "Remote write exceeds the size limit"); return value; }
function integer(value: number, min: number, max: number): number { if (!Number.isInteger(value) || value < min || value > max) throw new SshProviderError("invalid-input", "Numeric input is invalid"); return value; }
function ambiguous(error: unknown): SshProviderError { const normalized = normalizeError(error, "outcome-unknown"); return ["unreachable", "transport-lost", "outcome-unknown"].includes(normalized.code) ? new SshProviderError("outcome-unknown", "Remote mutation outcome is unknown; refresh before retrying", { reconciliationRequired: true }) : normalized; }
function rootError(error: unknown): SshProviderError { const normalized = normalizeError(error); return ["missing", "not-directory", "permission-denied"].includes(normalized.code) ? new SshProviderError("root-unavailable", "Remote project root is unavailable") : normalized; }
