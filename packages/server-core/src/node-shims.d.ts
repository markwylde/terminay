/** Minimal Node declarations kept local so the browser-safe workspace does
 * not need a global @types/node dependency. Runtime implementations are
 * provided by Node in the privileged server application. */

declare class Buffer extends Uint8Array {
  static from(value: string | ArrayBuffer | ArrayLike<number> | ArrayBufferView, encoding?: string): Buffer;
  static alloc(size: number): Buffer;
  static allocUnsafe(size: number): Buffer;
  static concat(list: readonly Uint8Array[], totalLength?: number): Buffer;
  static isBuffer(value: unknown): value is Buffer;
  static byteLength(value: string | ArrayBufferView | ArrayBuffer, encoding?: string): number;
  toString(encoding?: string): string;
  subarray(begin?: number, end?: number): Buffer;
  indexOf(value: number): number;
}

declare namespace NodeJS {
  interface ErrnoException extends Error { code?: string; }
}

declare module "node:util" {
  export const TextDecoder: typeof globalThis.TextDecoder;
}

declare module "node:crypto" {
  export function randomUUID(): string;
  interface Hash { update(value: string | Uint8Array, inputEncoding?: string): Hash; digest(): Buffer; digest(encoding: "hex" | "base64url"): string; }
  export function createHash(algorithm: string): Hash;
}

declare module "node:child_process" {
  interface ChildInput {
    end(data?: string | Uint8Array): void;
    write(data: string | Uint8Array): boolean;
  }
  interface ChildStream {
    on(event: "data", listener: (chunk: Buffer | string) => void): this;
  }
  interface ChildProcess {
    readonly stdin: ChildInput;
    readonly stdout: ChildStream;
    readonly stderr: ChildStream;
    readonly connected: boolean;
    kill(signal?: string): boolean;
    send(message: unknown): boolean;
    on(event: "message", listener: (message: unknown) => void): this;
    once(event: "error", listener: (error: NodeJS.ErrnoException) => void): this;
    once(event: "exit", listener: (exitCode: number | null, signal: string | null) => void): this;
    once(event: "close", listener: (exitCode: number | null, signal: string | null) => void): this;
    removeAllListeners(event?: string): this;
  }
  export function spawn(command: string, args?: readonly string[], options?: {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly stdio?: readonly ("ignore" | "pipe")[];
    readonly windowsHide?: boolean;
    readonly signal?: AbortSignal;
  }): ChildProcess;
  export function fork(modulePath: string, args?: readonly string[], options?: {
    readonly cwd?: string;
    readonly execPath?: string;
    readonly execArgv?: readonly string[];
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly stdio?: readonly ("ignore" | "pipe" | "ipc")[];
    readonly serialization?: "json" | "advanced";
  }): ChildProcess;
}

declare module "node:path" {
  interface PathModule {
    readonly sep: string;
    resolve(...paths: string[]): string;
    join(...paths: string[]): string;
    dirname(path: string): string;
    basename(path: string, suffix?: string): string;
    relative(from: string, to: string): string;
    isAbsolute(path: string): boolean;
    normalize(path: string): string;
  }
  const path: PathModule;
  export default path;
  export const sep: string;
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, suffix?: string): string;
  export function relative(from: string, to: string): string;
  export function isAbsolute(path: string): boolean;
  export function normalize(path: string): string;
}

declare module "node:fs" {
  interface Dirent<T = string> {
    readonly name: T;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  interface Stats {
    readonly size: number;
    readonly birthtimeMs: number;
    isFile(): boolean;
    isDirectory(): boolean;
  }
  export function chmodSync(path: string, mode: number): void;
  export function closeSync(fd: number): void;
  export function existsSync(path: string): boolean;
  export function fsyncSync(fd: number): void;
  export function mkdirSync(path: string, options?: { readonly recursive?: boolean; readonly mode?: number }): string | undefined;
  export function openSync(path: string, flags: string, mode?: number): number;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readFileSync(path: string): Buffer;
  export function readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number): number;
  export function readdirSync<T extends string = string>(path: string, options: { readonly withFileTypes: true; readonly encoding?: T }): Dirent<T>[];
  export function realpathSync(path: string): string;
  export function renameSync(oldPath: string, newPath: string): void;
  export function rmSync(path: string, options?: { readonly force?: boolean }): void;
  export function statSync(path: string): Stats;
  export function writeFileSync(fdOrPath: number | string, data: string | Uint8Array, encoding?: string): void;
}

declare module "node:fs/promises" {
  interface Stats {
    readonly size: number;
    readonly mtimeMs: number;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  interface FileHandle {
    read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ readonly bytesRead: number; readonly buffer: Buffer }>;
    close(): Promise<void>;
  }
  interface Dirent { readonly name: string; isDirectory(): boolean; isFile(): boolean; }
  export function open(path: string, flags: string): Promise<FileHandle>;
  export function readFile(path: string): Promise<Buffer>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function readlink(path: string): Promise<string>;
  export function readdir(path: string): Promise<string[]>;
  export function readdir(path: string, options: { readonly withFileTypes: true }): Promise<Dirent[]>;
  export function realpath(path: string): Promise<string>;
  export function stat(path: string): Promise<Stats>;
}
