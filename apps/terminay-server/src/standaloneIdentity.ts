import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultRemoteOrigin, type ServerCliOptions } from "./cliOptions.js";

const IDENTITY_FILE = "server-instance.v1.json";
const WORKSPACE_FILE = "workspace.v3.json";
const SCHEMA_VERSION = 1;

interface StoredIdentity {
  readonly schemaVersion: 1;
  readonly serverId: string;
}

/**
 * Resolves the standalone server authority for one durable data root.
 *
 * New roots receive an opaque persisted identity. Existing workspaces keep
 * their canonical workspace identity (including the historical
 * `local-server`) so an upgrade cannot silently make their stored projects
 * and terminal sessions belong to a different authority. Callers must hold
 * the data-root lease while resolving a new identity.
 */
export async function resolveStandaloneServerIdentity(options: ServerCliOptions): Promise<ServerCliOptions> {
  const workspaceId = await readWorkspaceServerId(options.dataRoot);
  const stored = await readStoredIdentity(options.dataRoot);
  const requested = options.serverIdExplicit ? options.serverId : undefined;
  if (workspaceId !== undefined && stored !== undefined && workspaceId !== stored.serverId) {
    throw new Error("standalone workspace and server identity records disagree");
  }
  const canonical = workspaceId ?? stored?.serverId;
  if (requested !== undefined && canonical !== undefined && requested !== canonical) {
    throw new Error("--server-id does not match this data root's existing server authority");
  }
  const serverId = requested ?? canonical ?? newServerId();
  if (stored === undefined) await persistIdentity(options.dataRoot, serverId);
  return Object.freeze({
    ...options,
    serverId,
    ...(options.remoteOriginExplicit ? {} : { remoteOrigin: defaultRemoteOrigin(serverId) }),
  });
}

async function readWorkspaceServerId(dataRoot: string): Promise<string | undefined> {
  let raw: string;
  try { raw = await readFile(join(dataRoot, WORKSPACE_FILE), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("could not read the existing standalone workspace identity", { cause: error });
  }
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (error) { throw new Error("existing standalone workspace identity is invalid", { cause: error }); }
  const serverId = record(value)?.serverId;
  if (!validServerId(serverId)) throw new Error("existing standalone workspace has no valid server authority");
  return serverId;
}

async function readStoredIdentity(dataRoot: string): Promise<StoredIdentity | undefined> {
  let raw: string;
  try { raw = await readFile(join(dataRoot, IDENTITY_FILE), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("could not read the standalone server identity", { cause: error });
  }
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (error) { throw new Error("standalone server identity is invalid", { cause: error }); }
  const identity = record(value);
  if (identity?.schemaVersion !== SCHEMA_VERSION || !validServerId(identity.serverId)) {
    throw new Error("standalone server identity is invalid");
  }
  return Object.freeze({ schemaVersion: SCHEMA_VERSION, serverId: identity.serverId });
}

async function persistIdentity(dataRoot: string, serverId: string): Promise<void> {
  const path = join(dataRoot, IDENTITY_FILE);
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, serverId })}\n`, {
      encoding: "utf8", flag: "wx", mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new Error("could not persist the standalone server identity", { cause: error });
    }
    const concurrent = await readStoredIdentity(dataRoot);
    if (concurrent?.serverId !== serverId) throw new Error("standalone server identity changed while it was being resolved");
  }
}

function newServerId(): string { return `standalone-${randomBytes(18).toString("base64url")}`; }

function validServerId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
