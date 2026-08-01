import { mkdir, open, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { DataRootLease } from "./bootstrap.js";

const LOCK_FILE = ".terminay-server.lock";
const LOCK_MODE = 0o600;

interface HeldLease {
  readonly root: string;
  readonly lockPath: string;
  readonly handle: Awaited<ReturnType<typeof open>>;
}

/**
 * A host-owned, crash-visible lease for an embedded server data root.
 *
 * `open(..., "wx")` makes acquisition atomic across processes. A lock is
 * deliberately not treated as stale automatically: silently stealing a root
 * can create two authorities and corrupt durable state. Recovery is an
 * explicit host operation after the owning process has been verified gone.
 */
export class FileDataRootLease implements DataRootLease {
  private readonly held = new Map<string, HeldLease>();

  async acquire(dataRoot: string): Promise<void> {
    const root = normalizeRoot(dataRoot);
    if (this.held.has(root)) throw new Error("data root is already leased by this host");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const lockPath = resolve(root, LOCK_FILE);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(lockPath, "wx", LOCK_MODE);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
      await handle.sync();
      this.held.set(root, { root, lockPath, handle });
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if ((error as NodeJS.ErrnoException | undefined)?.code === "EEXIST") {
        throw new Error("data root is already in use", { cause: error });
      }
      throw error;
    }
  }

  async release(dataRoot: string): Promise<void> {
    const root = normalizeRoot(dataRoot);
    const lease = this.held.get(root);
    if (lease === undefined) return;
    this.held.delete(root);
    await lease.handle.close().catch(() => undefined);
    await rm(lease.lockPath, { force: true }).catch(() => undefined);
  }
}

function normalizeRoot(dataRoot: string): string {
  if (typeof dataRoot !== "string" || dataRoot.trim().length === 0 || dataRoot.length > 4096) throw new TypeError("data root is invalid");
  return resolve(dataRoot);
}
