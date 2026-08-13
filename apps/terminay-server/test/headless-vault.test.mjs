import assert from "node:assert/strict";
import test from "node:test";
import { parseServerCliOptions } from "../dist/cliOptions.js";
import { createStandaloneVaultComposition, readOneShotVaultUnlockFd } from "../dist/headlessVault.js";
import { mkdtemp } from "node:fs/promises";
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

test("noninteractive startup composes a locked vault without reading stdin or a controlling terminal", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "terminay-locked-vault-"));
  const composition = await createStandaloneVaultComposition({ dataRoot, serverId: "server-a" });
  assert.equal(composition.status().state, "locked");
});
