import { createHash } from "node:crypto";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const decompress = promisify(gunzip);
export const MAX_EXTENSION_ARCHIVE_BYTES = 12 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

export interface InspectedNpmPackArchive {
  readonly packageJson: Readonly<Record<string, unknown>>;
  readonly integrity: string;
  readonly compressedBytes: number;
  readonly unpackedBytes: number;
  readonly entries: number;
}

/** Inspect a bounded npm-pack gzip tarball without extracting it. Only the
 * conventional package/ tree and regular files/directories are admitted. */
export async function inspectNpmPackArchive(bytes: Uint8Array): Promise<InspectedNpmPackArchive> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_EXTENSION_ARCHIVE_BYTES) throw new Error("extension package file must be between 1 byte and 12 MiB");
  let archive: Buffer;
  try { archive = await decompress(Buffer.from(bytes), { maxOutputLength: MAX_UNPACKED_BYTES + 1 }); }
  catch { throw new Error("extension package file is not a valid bounded gzip archive"); }
  if (archive.byteLength > MAX_UNPACKED_BYTES) throw new Error("extension package archive exceeds the unpacked size limit");
  let offset = 0; let entries = 0; let packageJson: Record<string, unknown> | undefined;
  while (offset + 512 <= archive.byteLength) {
    const header = archive.subarray(offset, offset + 512); offset += 512;
    if (header.every((value) => value === 0)) break;
    validateChecksum(header);
    const name = tarText(header.subarray(0, 100));
    const prefix = tarText(header.subarray(345, 500));
    const path = prefix.length === 0 ? name : `${prefix}/${name}`;
    const size = tarNumber(header.subarray(124, 136));
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156] ?? 0);
    entries += 1;
    if (entries > MAX_ENTRIES) throw new Error("extension package archive contains too many entries");
    if (!safePackagePath(path)) throw new Error("extension package archive contains an unsafe path");
    if (type !== "0" && type !== "5") throw new Error("extension package archive may contain regular files and directories only");
    if (offset + size > archive.byteLength) throw new Error("extension package archive is truncated");
    if (path === "package/package.json") {
      if (type !== "0" || packageJson !== undefined || size > 1024 * 1024) throw new Error("extension package archive has an invalid package manifest");
      try { const value: unknown = JSON.parse(archive.subarray(offset, offset + size).toString("utf8")); if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(); packageJson = value as Record<string, unknown>; }
      catch { throw new Error("extension package archive manifest is not valid JSON"); }
    }
    offset += Math.ceil(size / 512) * 512;
  }
  if (packageJson === undefined) throw new Error("extension package archive does not contain package/package.json");
  return Object.freeze({ packageJson: Object.freeze(packageJson), integrity: `sha512-${Buffer.from(createHash("sha512").update(bytes).digest()).toString("base64")}`, compressedBytes: bytes.byteLength, unpackedBytes: archive.byteLength, entries });
}

function safePackagePath(value: string): boolean { return value === "package" || (value.startsWith("package/") && !value.includes("\\") && !value.split("/").some((part) => part === "" || part === "." || part === "..") && !value.includes("\0")); }
function tarText(bytes: Uint8Array): string { const end = bytes.indexOf(0); return Buffer.from(end < 0 ? bytes : bytes.subarray(0, end)).toString("utf8"); }
function tarNumber(bytes: Uint8Array): number { const value = tarText(bytes).trim(); if (!/^[0-7]+$/u.test(value)) throw new Error("extension package archive contains an invalid size"); const result = Number.parseInt(value, 8); if (!Number.isSafeInteger(result) || result < 0 || result > MAX_UNPACKED_BYTES) throw new Error("extension package archive entry exceeds limits"); return result; }
function validateChecksum(header: Uint8Array): void { const expected = tarNumber(header.subarray(148, 156)); let sum = 0; for (let index = 0; index < header.length; index += 1) sum += index >= 148 && index < 156 ? 32 : header[index] ?? 0; if (sum !== expected) throw new Error("extension package archive checksum is invalid"); }
