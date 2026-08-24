import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileDataRootLease, parseServerCliOptions, resolveStandaloneServerIdentity } from "../dist/index.js";

const rootOptions = (dataRoot, extra = []) => parseServerCliOptions(["--data-root", dataRoot, ...extra], {});

test("separate standalone data roots receive stable distinct implicit authorities", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "terminay-instance-one-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "terminay-instance-two-"));
  const firstLease = new FileDataRootLease();
  const secondLease = new FileDataRootLease();
  try {
    await firstLease.acquire(firstRoot); await secondLease.acquire(secondRoot);
    const first = await resolveStandaloneServerIdentity(rootOptions(firstRoot));
    const second = await resolveStandaloneServerIdentity(rootOptions(secondRoot));
    const firstAgain = await resolveStandaloneServerIdentity(rootOptions(firstRoot));
    assert.match(first.serverId, /^standalone-[A-Za-z0-9_-]+$/u);
    assert.notEqual(first.serverId, second.serverId);
    assert.equal(firstAgain.serverId, first.serverId);
    assert.notEqual(first.remoteOrigin, second.remoteOrigin);
    assert.deepEqual(JSON.parse(await readFile(join(firstRoot, "server-instance.v1.json"), "utf8")), {
      schemaVersion: 1, serverId: first.serverId,
    });
  } finally {
    await firstLease.release(firstRoot); await secondLease.release(secondRoot);
    await rm(firstRoot, { recursive: true, force: true }); await rm(secondRoot, { recursive: true, force: true });
  }
});

test("a legacy workspace retains its canonical identity and rejects an inconsistent explicit override", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-legacy-instance-"));
  const lease = new FileDataRootLease();
  try {
    await writeFile(join(root, "workspace.v3.json"), JSON.stringify({ schemaVersion: 4, serverId: "local-server" }));
    await lease.acquire(root);
    const legacy = await resolveStandaloneServerIdentity(rootOptions(root));
    assert.equal(legacy.serverId, "local-server");
    assert.equal(JSON.parse(await readFile(join(root, "server-instance.v1.json"), "utf8")).serverId, "local-server");
    await assert.rejects(resolveStandaloneServerIdentity(rootOptions(root, ["--server-id", "other-server"])), /does not match/u);
    assert.equal((await resolveStandaloneServerIdentity(rootOptions(root, ["--server-id", "local-server"]))).serverId, "local-server");
  } finally {
    await lease.release(root);
    await rm(root, { recursive: true, force: true });
  }
});

test("conflicting legacy workspace and identity records fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-conflicting-instance-"));
  const lease = new FileDataRootLease();
  try {
    await writeFile(join(root, "workspace.v3.json"), JSON.stringify({ schemaVersion: 4, serverId: "legacy-server" }));
    await writeFile(join(root, "server-instance.v1.json"), JSON.stringify({ schemaVersion: 1, serverId: "other-server" }));
    await lease.acquire(root);
    await assert.rejects(resolveStandaloneServerIdentity(rootOptions(root)), /records disagree/u);
  } finally {
    await lease.release(root);
    await rm(root, { recursive: true, force: true });
  }
});

test("a second standalone authority cannot acquire the same data root", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-shared-instance-"));
  const first = new FileDataRootLease(); const second = new FileDataRootLease();
  try {
    await first.acquire(root);
    await assert.rejects(second.acquire(root), /data root is already in use/u);
  } finally {
    await first.release(root); await second.release(root);
    await rm(root, { recursive: true, force: true });
  }
});
