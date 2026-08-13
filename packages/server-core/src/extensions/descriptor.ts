import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { EXTENSION_API_VERSION, parseExtensionManifest, type TerminayExtensionManifest } from "@terminay/extension-api";
import type { ExtensionLaunchDescriptor } from "./types.js";

const EXTENSION_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;

export interface ExtensionPackageLaunchInput {
  readonly packageRoot: string;
  readonly manifest: unknown;
  readonly configDirectory: string;
  readonly dataDirectory: string;
  readonly cacheDirectory: string;
  readonly compatibility?: ExtensionCompatibilityContext;
}

export interface ExtensionCompatibilityContext {
  readonly terminayVersion: string;
  readonly nodeVersion?: string;
  readonly platform?: string;
  readonly installedExtensions?: ReadonlyMap<string, { readonly apiVersion: string }>;
}

/** Bridges the public closed manifest schema into the private launch contract.
 * Compatibility checks belong to installation/activation policy; this seam
 * guarantees the host never constructs authority from unvalidated fields. */
export async function extensionLaunchDescriptor(input: ExtensionPackageLaunchInput): Promise<{
  readonly descriptor: ExtensionLaunchDescriptor;
  readonly manifest: TerminayExtensionManifest;
}> {
  const manifest = parseExtensionManifest(input.manifest);
  assertExtensionCompatible(manifest, input.compatibility ?? { terminayVersion: "1.0.0" });
  const descriptor = await validateExtensionLaunchDescriptor({
    extensionId: manifest.id,
    packageRoot: input.packageRoot,
    entrypoint: manifest.entrypoint,
    configDirectory: input.configDirectory,
    dataDirectory: input.dataDirectory,
    cacheDirectory: input.cacheDirectory,
    permissions: manifest.permissions,
  });
  return Object.freeze({ descriptor, manifest });
}

/** Fail closed on every executable compatibility axis before resolving or
 * importing the entrypoint. Ranges intentionally support the v1 manifest
 * grammar only: exact, wildcard, >= and compatible-major (`^`) constraints. */
export function assertExtensionCompatible(manifest: TerminayExtensionManifest, context: ExtensionCompatibilityContext): void {
  const nodeVersion = context.nodeVersion ?? process.versions.node;
  const platform = context.platform ?? process.platform;
  if (!satisfiesVersion(EXTENSION_API_VERSION, manifest.api)) throw new Error(`extension API ${manifest.api} is incompatible with host ${EXTENSION_API_VERSION}`);
  if (!satisfiesVersion(context.terminayVersion, manifest.engines.terminay)) throw new Error(`extension requires Terminay ${manifest.engines.terminay}`);
  if (!satisfiesVersion(nodeVersion, manifest.engines.node)) throw new Error(`extension requires Node ${manifest.engines.node}`);
  if (manifest.platforms !== undefined && !manifest.platforms.includes(platform as "darwin" | "linux" | "win32")) throw new Error(`extension does not support platform ${platform}`);
  for (const dependency of manifest.extensionDependencies ?? []) {
    const installed = context.installedExtensions?.get(dependency.extensionId);
    if (installed === undefined) {
      if (!dependency.optional) throw new Error(`required extension dependency ${dependency.extensionId} is unavailable`);
    } else if (!satisfiesVersion(installed.apiVersion, dependency.apiRange)) {
      throw new Error(`extension dependency ${dependency.extensionId} has incompatible API ${installed.apiVersion}`);
    }
  }
}

function satisfiesVersion(version: string, range: string): boolean {
  const parsed = versionTuple(version);
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed.toLowerCase() === "latest") return true;
  if (trimmed.startsWith(">=")) return compare(parsed, versionTuple(trimmed.slice(2))) >= 0;
  if (trimmed.startsWith("^")) {
    const minimum = versionTuple(trimmed.slice(1));
    return compare(parsed, minimum) >= 0 && parsed[0] === minimum[0];
  }
  return compare(parsed, versionTuple(trimmed)) === 0;
}

function versionTuple(value: string): readonly [number, number, number] {
  const match = /^(?:v)?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?$/u.exec(value.trim());
  if (match === null) throw new Error(`unsupported version range ${value}`);
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}
function compare(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) { const difference = (left[index] ?? 0) - (right[index] ?? 0); if (difference !== 0) return difference; }
  return 0;
}

/** Revalidates the security-sensitive subset of an already parsed manifest
 * immediately before execution. Package installation performs the complete
 * public manifest/API compatibility validation. */
export async function validateExtensionLaunchDescriptor(descriptor: ExtensionLaunchDescriptor): Promise<ExtensionLaunchDescriptor> {
  if (!EXTENSION_ID.test(descriptor.extensionId)) throw new TypeError("invalid extension id");
  if (isAbsolute(descriptor.entrypoint) || descriptor.entrypoint.includes("\0")) throw new TypeError("extension entrypoint must be relative");
  const packageRoot = await realpath(descriptor.packageRoot);
  const entrypoint = resolve(packageRoot, descriptor.entrypoint);
  const unresolvedContainment = relative(packageRoot, entrypoint);
  if (unresolvedContainment === "" || unresolvedContainment.startsWith("..") || isAbsolute(unresolvedContainment)) throw new TypeError("extension entrypoint escapes its package slot");
  const canonicalEntrypoint = await realpath(entrypoint);
  const contained = relative(packageRoot, canonicalEntrypoint);
  if (contained === "" || contained.startsWith("..") || isAbsolute(contained)) throw new TypeError("extension entrypoint escapes its package slot");
  const entryStat = await lstat(entrypoint);
  // lstat deliberately observes the path itself: a symlink to a regular file
  // is not reported as a regular file and is therefore rejected.
  if (!entryStat.isFile()) throw new TypeError("extension entrypoint must be a regular non-symlink file");
  if (!canonicalEntrypoint.endsWith(".js") && !canonicalEntrypoint.endsWith(".mjs")) throw new TypeError("extension entrypoint must be ESM JavaScript");
  for (const path of [descriptor.configDirectory, descriptor.dataDirectory, descriptor.cacheDirectory]) {
    if (!isAbsolute(path) || path.includes("\0")) throw new TypeError("extension directories must be absolute");
  }
  if (descriptor.permissions.length > 64 || descriptor.permissions.some((permission) => typeof permission !== "string" || permission.length === 0 || permission.length > 100)) {
    throw new TypeError("invalid extension permissions");
  }
  return Object.freeze({ ...descriptor, packageRoot, entrypoint: canonicalEntrypoint });
}
