import { execFileSync } from "node:child_process";
import { closeSync, constants, openSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";
import {
  FileVaultEnvelopeStorage,
  HeadlessPassphraseVaultAdapter,
  MAX_VAULT_UNLOCK_BYTES,
  createServerVaultComposition,
  type ServerVaultComposition,
} from "@terminay/server-core";

export interface StandaloneVaultOptions {
  readonly dataRoot: string;
  readonly serverId: string;
  readonly unlockFd?: number;
}

interface UnlockIo {
  readonly read: (fd: number, target: Uint8Array, offset: number, length: number) => number;
  readonly close: (fd: number) => void;
}

const nodeUnlockIo: UnlockIo = {
  read: (fd, target, offset, length) => readSync(fd, target, offset, length, null),
  close: (fd) => closeSync(fd),
};

/** Read and consume a one-shot inherited descriptor. Descriptor zero is
 * deliberately rejected: ordinary stdin is never a vault unlock channel. */
export function readOneShotVaultUnlockFd(fd: number, io: UnlockIo = nodeUnlockIo): Uint8Array {
  if (!Number.isSafeInteger(fd) || fd < 3) throw new Error("vault unlock descriptor must be an inherited fd of 3 or greater");
  const bytes = new Uint8Array(MAX_VAULT_UNLOCK_BYTES + 1);
  let used = 0;
  try {
    while (used < bytes.byteLength) {
      const count = io.read(fd, bytes, used, bytes.byteLength - used);
      if (!Number.isSafeInteger(count) || count < 0 || count > bytes.byteLength - used) throw new Error("vault unlock descriptor read failed");
      if (count === 0) break;
      used += count;
    }
  } catch (error) {
    bytes.fill(0);
    throw error;
  } finally {
    try { io.close(fd); } catch { bytes.fill(0); }
  }
  if (used > MAX_VAULT_UNLOCK_BYTES) { bytes.fill(0); throw new Error("vault unlock input exceeds its size limit"); }
  while (used > 0 && (bytes[used - 1] === 10 || bytes[used - 1] === 13)) used -= 1;
  if (used === 0) { bytes.fill(0); throw new Error("vault unlock input is empty"); }
  const result = bytes.slice(0, used);
  bytes.fill(0);
  return result;
}

/** Read from the controlling terminal while kernel echo is disabled. This
 * never falls back to process.stdin. Headless Windows services must use an
 * inherited descriptor because Node has no portable console echo control. */
export function readVaultUnlockFromControllingTerminal(): Uint8Array {
  if (process.platform === "win32") throw new Error("vault unlock requires --vault-unlock-fd on this platform");
  let fd: number | undefined;
  let echoDisabled = false;
  const bytes = new Uint8Array(MAX_VAULT_UNLOCK_BYTES + 1);
  let used = 0;
  try {
    fd = openSync("/dev/tty", constants.O_RDWR);
    execFileSync("stty", ["-echo"], { stdio: [fd, fd, fd] });
    echoDisabled = true;
    writeSync(fd, "Terminay vault passphrase: ");
    while (used < bytes.byteLength) {
      const count = readSync(fd, bytes, used, 1, null);
      if (count === 0 || bytes[used] === 10 || bytes[used] === 13) break;
      used += count;
    }
    if (used > MAX_VAULT_UNLOCK_BYTES) throw new Error("vault unlock input exceeds its size limit");
    if (used === 0) throw new Error("vault unlock input is empty");
    return bytes.slice(0, used);
  } catch (error) {
    throw new Error(error instanceof Error && error.message.startsWith("vault unlock") ? error.message : "a controlling terminal or --vault-unlock-fd is required to unlock the server vault");
  } finally {
    bytes.fill(0);
    if (fd !== undefined) {
      if (echoDisabled) {
        try { execFileSync("stty", ["echo"], { stdio: [fd, fd, fd] }); } catch { /* best-effort terminal restoration */ }
      }
      try { writeSync(fd, "\n"); } catch { /* terminal may have disappeared */ }
      closeSync(fd);
    }
  }
}

export async function createStandaloneVaultComposition(options: StandaloneVaultOptions): Promise<ServerVaultComposition> {
  const storage = new FileVaultEnvelopeStorage(join(options.dataRoot, "vault", "headless-v1.json"));
  const adapter = await HeadlessPassphraseVaultAdapter.open({ serverId: options.serverId, storage });
  const composition = createServerVaultComposition(adapter);
  if (options.unlockFd !== undefined) {
    const secret = readOneShotVaultUnlockFd(options.unlockFd);
    await composition.unlock({ secret });
  }
  return composition;
}
