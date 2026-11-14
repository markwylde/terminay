import assert from "node:assert/strict";
import test from "node:test";
import { parseServerCliOptions } from "../dist/cliOptions.js";
import {
  createStandaloneVaultComposition,
  readOneShotVaultUnlockFd,
  VAULT_KEY_FILE,
  VAULT_PENDING_KEY_FILE,
} from "../dist/headlessVault.js";
import { FileVaultEnvelopeStorage, HeadlessPassphraseVaultAdapter } from "@terminay/server-core";
import { chmod, mkdir, mkdtemp, readFile, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("one-shot vault descriptor is bounded, newline-trimmed, and closed", () => {
  const source = new TextEncoder().encode("correct horse battery staple\r\n");
  let offset = 0;
  let closed = 0;
  const secret = readOneShotVaultUnlockFd(7, {
    read(_fd, target, targetOffset, length) {
      const count = Math.min(3, length, source.byteLength - offset);
      target.set(source.subarray(offset, offset + count), targetOffset);
      offset += count;
      return count;
    },
    close(fd) { assert.equal(fd, 7); closed += 1; },
  });
  assert.equal(new TextDecoder().decode(secret), "correct horse battery staple");
  assert.equal(closed, 1);
  secret.fill(0);
});

test("ordinary stdin and oversized descriptor input are rejected and closed", () => {
  assert.throws(() => readOneShotVaultUnlockFd(0), /inherited fd/);
  let closed = 0;
  assert.throws(() => readOneShotVaultUnlockFd(8, {
    read(_fd, target, offset, length) { target.fill(97, offset, offset + length); return length; },
    close() { closed += 1; },
  }), /size limit/);
  assert.equal(closed, 1);
});

test("CLI accepts only an explicit inherited descriptor and ignores environment secret channels", () => {
  assert.equal(parseServerCliOptions([], { TERMINAY_VAULT_PASSPHRASE: "must-not-be-read" }).vaultUnlockFd, undefined);
  assert.equal(parseServerCliOptions(["--vault-unlock-fd", "9"], {}).vaultUnlockFd, 9);
  assert.throws(() => parseServerCliOptions(["--vault-unlock-fd", "0"], {}), /inherited fd/);
});

test("CLI conversion flag needs a descriptor", () => {
  assert.equal(parseServerCliOptions(["--vault-unlock-fd", "9"], {}).vaultConvertToKeyFile, undefined);
  assert.equal(
    parseServerCliOptions(["--vault-unlock-fd", "9", "--vault-convert-to-key-file"], {}).vaultConvertToKeyFile,
    true,
  );
  assert.throws(() => parseServerCliOptions(["--vault-convert-to-key-file"], {}), /requires --vault-unlock-fd/);
});

const encode = (text) => new TextEncoder().encode(text);
const decode = (bytes) => new TextDecoder().decode(bytes);
const PASSPHRASE = "operator passphrase";
const quiet = () => {};

async function freshRoot() {
  return mkdtemp(join(tmpdir(), "terminay-vault-"));
}

function capture() {
  const lines = [];
  return { lines, log: (line) => lines.push(line) };
}

const paths = (dataRoot) => ({
  envelope: join(dataRoot, "vault", "headless-v1.json"),
  key: join(dataRoot, "vault", VAULT_KEY_FILE),
  pending: join(dataRoot, "vault", VAULT_PENDING_KEY_FILE),
});

async function exists(path) {
  return stat(path).then(() => true, () => false);
}

async function readSecret(composition, id) {
  let value;
  await composition.vault.withSecret(id, (bytes) => { value = decode(bytes); });
  return value;
}

function start(dataRoot, extra = {}) {
  return createStandaloneVaultComposition({ dataRoot, serverId: "server-a", log: quiet, ...extra });
}

function withDescriptor(secret = PASSPHRASE, extra = {}) {
  return { unlockFd: 9, readDescriptor: () => encode(secret), ...extra };
}

async function passphraseVault(dataRoot) {
  const adapter = await HeadlessPassphraseVaultAdapter.open({
    serverId: "server-a",
    storage: new FileVaultEnvelopeStorage(paths(dataRoot).envelope),
  });
  await adapter.unlock({ secret: encode(PASSPHRASE) });
  await adapter.put({ id: "provider.token", label: "", value: encode("passphrase-secret") });
}

test("first start writes an owner-only key and an unlocked vault", async () => {
  const dataRoot = await freshRoot();
  const { lines, log } = capture();
  const composition = await start(dataRoot, { log });
  assert.equal(composition.status().state, "unlocked");
  assert.equal((await stat(paths(dataRoot).key)).mode & 0o777, 0o600);
  assert.match(await readFile(paths(dataRoot).key, "utf8"), /^[A-Za-z0-9_-]{43}$/u);
  await composition.vault.put({ id: "provider.token", value: encode("stored-secret") });
  assert.deepEqual(lines, []);
});

test("restart unlocks with the key file and reads stored secrets", async () => {
  const dataRoot = await freshRoot();
  const first = await start(dataRoot);
  await first.vault.put({ id: "provider.token", value: encode("stored-secret") });
  const second = await start(dataRoot);
  assert.equal(second.status().state, "unlocked");
  assert.equal(await readSecret(second, "provider.token"), "stored-secret");
});

test("a first start whose key cannot be written stays locked and writes no envelope", async () => {
  const dataRoot = await freshRoot();
  const { lines, log } = capture();
  const composition = await start(dataRoot, {
    log,
    fileOps: { writeKey: async () => { throw new Error("disk full"); } },
  });
  assert.equal(composition.status().state, "locked");
  assert.match(lines.join("\n"), /could not be written/);
  assert.equal(await exists(paths(dataRoot).envelope), false);
});

test("a passphrase vault without its passphrase stays locked and says why", async () => {
  const dataRoot = await freshRoot();
  await passphraseVault(dataRoot);
  const before = await readFile(paths(dataRoot).envelope, "utf8");
  const { lines, log } = capture();
  const composition = await start(dataRoot, { log });
  assert.equal(composition.status().state, "locked");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /--vault-convert-to-key-file/);
  assert.equal(await readFile(paths(dataRoot).envelope, "utf8"), before);
  assert.equal(await exists(paths(dataRoot).key), false);
});

test("a descriptor unlock stays operator-managed and writes no key file", async () => {
  const dataRoot = await freshRoot();
  await passphraseVault(dataRoot);
  for (let run = 0; run < 2; run += 1) {
    const composition = await start(dataRoot, withDescriptor());
    assert.equal(composition.status().state, "unlocked");
    assert.equal(await readSecret(composition, "provider.token"), "passphrase-secret");
  }
  assert.equal(await exists(paths(dataRoot).key), false);
});

test("an explicit conversion writes a key file used with or without the old descriptor", async () => {
  const dataRoot = await freshRoot();
  await passphraseVault(dataRoot);
  const { lines, log } = capture();
  const converted = await start(dataRoot, withDescriptor(PASSPHRASE, { convertToKeyFile: true, log }));
  assert.equal(converted.status().state, "unlocked");
  const key = await readFile(paths(dataRoot).key, "utf8");
  assert.equal((await stat(paths(dataRoot).key)).mode & 0o777, 0o600);
  assert.equal(await exists(paths(dataRoot).pending), false);

  const plain = await start(dataRoot, { log });
  assert.equal(await readSecret(plain, "provider.token"), "passphrase-secret");
  const withOld = await start(dataRoot, withDescriptor(PASSPHRASE, { log }));
  assert.equal(withOld.status().state, "unlocked");
  assert.equal(await readSecret(withOld, "provider.token"), "passphrase-secret");
  assert.equal(lines.some((line) => line.includes(key) || line.includes(PASSPHRASE)), false);
});

test("a descriptor that does not unlock falls through to a valid key file", async () => {
  const dataRoot = await freshRoot();
  const first = await start(dataRoot);
  await first.vault.put({ id: "provider.token", value: encode("stored-secret") });
  const composition = await start(dataRoot, withDescriptor("not the right passphrase"));
  assert.equal(composition.status().state, "unlocked");
  assert.equal(await readSecret(composition, "provider.token"), "stored-secret");
});

for (const fault of ["pending write", "envelope write", "envelope written then failed", "promotion"]) {
  test(`a conversion interrupted at ${fault} recovers on the next start`, async () => {
    const dataRoot = await freshRoot();
    await passphraseVault(dataRoot);
    const extra = { convertToKeyFile: true };
    if (fault === "pending write")
      extra.fileOps = { writeKey: async (path) => { await writeFile(path, "partial"); throw new Error("crash"); } };
    if (fault === "promotion")
      extra.fileOps = { promote: async () => { throw new Error("crash"); } };
    if (fault === "envelope write" || fault === "envelope written then failed") {
      let armed = true;
      extra.storage = (inner) => ({
        read: () => inner.read(),
        async write(serialized) {
          if (!armed) return inner.write(serialized);
          armed = false;
          if (fault === "envelope written then failed") await inner.write(serialized);
          throw new Error("crash");
        },
      });
    }
    const interrupted = await start(dataRoot, withDescriptor(PASSPHRASE, extra));
    assert.equal(interrupted.status().state, "unlocked");

    // The next start, with the old descriptor as a service would still pass it.
    const { lines, log } = capture();
    const next = await start(dataRoot, withDescriptor(PASSPHRASE, { log }));
    assert.equal(next.status().state, "unlocked", lines.join("\n"));
    assert.equal(await readSecret(next, "provider.token"), "passphrase-secret");
    assert.equal(await exists(paths(dataRoot).pending), false);

    // And without it, when the conversion had committed.
    if (fault === "envelope written then failed" || fault === "promotion") {
      const plain = await start(dataRoot);
      assert.equal(plain.status().state, "unlocked");
      assert.equal(await readSecret(plain, "provider.token"), "passphrase-secret");
    }
  });
}

test("a pending key is kept while the vault stays locked", async () => {
  const dataRoot = await freshRoot();
  await passphraseVault(dataRoot);
  await writeFile(paths(dataRoot).pending, "not-the-right-key-for-this-vault", { mode: 0o600 });
  const composition = await start(dataRoot);
  assert.equal(composition.status().state, "locked");
  assert.equal(await readFile(paths(dataRoot).pending, "utf8"), "not-the-right-key-for-this-vault");
});

test("a pending key that opens the vault is promoted", async () => {
  const dataRoot = await freshRoot();
  await start(dataRoot);
  await rename(paths(dataRoot).key, paths(dataRoot).pending);
  const promoted = await start(dataRoot);
  assert.equal(promoted.status().state, "unlocked");
  assert.equal(await exists(paths(dataRoot).key), true);
  assert.equal(await exists(paths(dataRoot).pending), false);
});

test("a key file that does not match stays locked, is untouched, and logs no key", async () => {
  const dataRoot = await freshRoot();
  await start(dataRoot);
  await writeFile(paths(dataRoot).key, "wrong-key-wrong-key-wrong-key", { mode: 0o600 });
  const { lines, log } = capture();
  const composition = await start(dataRoot, { log });
  assert.equal(composition.status().state, "locked");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /does not unlock/);
  assert.equal(lines[0].includes("wrong-key"), false);
  assert.equal(await readFile(paths(dataRoot).key, "utf8"), "wrong-key-wrong-key-wrong-key");
});

test("a key path that is a directory or oversized is unusable and untouched", async () => {
  for (const shape of ["directory", "oversized"]) {
    const dataRoot = await freshRoot();
    await mkdir(join(dataRoot, "vault"), { recursive: true });
    if (shape === "directory") await mkdir(paths(dataRoot).key);
    else await writeFile(paths(dataRoot).key, "a".repeat(5000), { mode: 0o600 });
    const { lines, log } = capture();
    const composition = await start(dataRoot, { log });
    assert.equal(composition.status().state, "locked", shape);
    assert.match(lines.join("\n"), shape === "directory" ? /is not a file/ : /too large/, shape);
    assert.equal(await exists(paths(dataRoot).envelope), false, shape);
  }
});

test("a key file readable by others is restricted to its owner and used", async () => {
  const dataRoot = await freshRoot();
  await start(dataRoot);
  await chmod(paths(dataRoot).key, 0o644);
  const { lines, log } = capture();
  const composition = await start(dataRoot, { log });
  assert.equal(composition.status().state, "unlocked");
  assert.equal((await stat(paths(dataRoot).key)).mode & 0o777, 0o600);
  assert.match(lines.join("\n"), /restricted it to its owner/);
});
