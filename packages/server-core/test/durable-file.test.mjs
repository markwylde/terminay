import assert from "node:assert/strict";
import * as fs from "node:fs";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acceptFreshStateStart,
  isBlank,
  loadCanonicalStateSync,
  loadRebuildableStateSync,
  loadSecretStateSync,
  observeRebuiltState,
  takeStateRecoveryNotices,
  isStateUnreadableError,
  readStateFile,
  readStateFileSync,
  StateUnreadableError,
  startStateFresh,
  writeFileDurably,
  writeFileDurablySync,
} from "../dist/index.js";

const root = () => mkdtempSync(join(tmpdir(), "terminay-durable-"));
const json = (value) => JSON.stringify(value);
const leftovers = (directory) => readdirSync(directory).filter((name) => name.endsWith(".tmp"));
const corruptCopies = (directory, name) =>
  readdirSync(directory).filter((entry) => entry.startsWith(`${name}.corrupt-`));

/** A recording fake that delegates to the real filesystem. */
function recordingOps() {
  const calls = [];
  const fdPaths = new Map();
  const label = (path) => (path.endsWith(".tmp") ? (path.includes(".previous.") ? "previous-tmp" : "tmp") : path.endsWith(".previous") ? "previous" : "target");
  return {
    calls,
    openSync(path, flags, mode) {
      const fd = fs.openSync(path, flags, mode);
      const kind = flags === "r" ? "directory" : label(path);
      fdPaths.set(fd, kind);
      calls.push(`open ${kind}`);
      return fd;
    },
    writeSync(fd, data) {
      calls.push(`write ${fdPaths.get(fd)}`);
      return fs.writeSync(fd, data);
    },
    fsyncSync(fd) {
      calls.push(`fsync ${fdPaths.get(fd)}`);
      fs.fsyncSync(fd);
    },
    closeSync(fd) {
      fs.closeSync(fd);
    },
    renameSync(from, to) {
      calls.push(`rename ${label(from)} -> ${label(to)}`);
      fs.renameSync(from, to);
    },
    readFileSync: (path) => fs.readFileSync(path),
    rmSync: (path, options) => fs.rmSync(path, options),
    existsSync: (path) => fs.existsSync(path),
  };
}

test("a durable write flushes the new bytes before the rename and the directory after it", () => {
  const directory = root();
  const target = join(directory, "state.json");
  const ops = recordingOps();
  writeFileDurablySync(target, json({ a: 1 }), {}, ops);
  const expected = ["open tmp", "write tmp", "fsync tmp", "rename tmp -> target"];
  if (process.platform !== "win32") expected.push("open directory", "fsync directory");
  assert.deepEqual(ops.calls, expected);
  assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { a: 1 });
});

test("keeping the previous copy flushes it before the target is replaced", () => {
  const directory = root();
  const target = join(directory, "state.json");
  writeFileSync(target, json({ v: 1 }));
  const ops = recordingOps();
  writeFileDurablySync(target, json({ v: 2 }), { keepPrevious: true }, ops);
  const renameTarget = ops.calls.indexOf("rename tmp -> target");
  const flushPrevious = ops.calls.indexOf("fsync previous-tmp");
  const renamePrevious = ops.calls.indexOf("rename previous-tmp -> previous");
  assert.ok(ops.calls.indexOf("fsync tmp") < renameTarget, "new bytes are flushed before the rename");
  assert.ok(flushPrevious !== -1 && flushPrevious < renamePrevious, "the previous copy is flushed before it is named");
  assert.ok(renamePrevious < renameTarget, "the previous copy exists before the target moves");
  assert.deepEqual(JSON.parse(readFileSync(`${target}.previous`, "utf8")), { v: 1 });
  assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { v: 2 });
});

test("removing the flush from a write is caught", () => {
  // A fake that drops fsync models a regression; the ordering assertion must notice.
  const directory = root();
  const ops = recordingOps();
  ops.fsyncSync = () => {};
  writeFileDurablySync(join(directory, "state.json"), "{}", {}, ops);
  assert.ok(!ops.calls.includes("fsync tmp"));
});

test("a durable write leaves no temporary file, after success or a failed write", async () => {
  const directory = root();
  const target = join(directory, "state.json");
  writeFileDurablySync(target, "{}");
  await writeFileDurably(target, "{}");
  assert.deepEqual(leftovers(directory), []);
  const ops = recordingOps();
  ops.writeSync = () => {
    throw new Error("disk full");
  };
  assert.throws(() => writeFileDurablySync(target, json({ lost: true }), {}, ops), /disk full/);
  assert.deepEqual(leftovers(directory), []);
  assert.equal(readFileSync(target, "utf8"), "{}", "a failed write leaves the old content");
});

test("a durable write honours the requested mode on POSIX", { skip: process.platform === "win32" }, async () => {
  const directory = root();
  const target = join(directory, "secret.json");
  await writeFileDurably(target, "{}", { mode: 0o600 });
  assert.equal(statSync(target).mode & 0o777, 0o600);
});

test("concurrent durable writers never collide and the file holds one whole value", async () => {
  const directory = root();
  const target = join(directory, "state.json");
  const values = Array.from({ length: 40 }, (_, index) => ({ index, padding: "x".repeat(4096) }));
  await Promise.all(values.map((value) => writeFileDurably(target, json(value), { keepPrevious: true })));
  const final = JSON.parse(readFileSync(target, "utf8"));
  assert.ok(values.some((value) => value.index === final.index));
  assert.deepEqual(leftovers(directory), []);
});

test("a blank target never overwrites the last good previous copy", () => {
  const directory = root();
  const target = join(directory, "state.json");
  writeFileSync(`${target}.previous`, json({ good: true }));
  writeFileSync(target, Buffer.alloc(64));
  writeFileDurablySync(target, json({ next: true }), { keepPrevious: true });
  assert.deepEqual(JSON.parse(readFileSync(`${target}.previous`, "utf8")), { good: true });
});

const shapes = {
  "zero-filled": (good) => Buffer.alloc(Buffer.byteLength(good)),
  "truncated to half": (good) => Buffer.from(good.slice(0, Math.floor(good.length / 2))),
  "invalid JSON": () => Buffer.from("{not json"),
  empty: () => Buffer.alloc(0),
};
const validateShape = (value) => (value && typeof value === "object" && typeof value.version === "number" ? value : undefined);
const good = json({ version: 3, items: ["a", "b", "c", "d"] });

for (const [shape, corrupt] of Object.entries(shapes)) {
  test(`canonical, ${shape}, good previous: restored, preserved, and put back in place`, () => {
    const directory = root();
    const target = join(directory, "state.json");
    writeFileSync(target, corrupt(good));
    writeFileSync(`${target}.previous`, json({ version: 2 }));
    const result = readStateFileSync(target, { kind: "canonical", validate: validateShape });
    assert.equal(result.status, "restored");
    assert.deepEqual(result.value, { version: 2 });
    assert.equal(corruptCopies(directory, "state.json").length, 1, "the corrupt file is kept");
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { version: 2 }, "the copy is durable in place");
  });

  test(`canonical, ${shape}, corrupt previous: corrupt, and both files left untouched until the user chooses`, () => {
    const directory = root();
    const target = join(directory, "state.json");
    const bytes = corrupt(good);
    writeFileSync(target, bytes);
    writeFileSync(`${target}.previous`, Buffer.alloc(32));
    const result = readStateFileSync(target, { kind: "canonical", validate: validateShape });
    assert.equal(result.status, "corrupt");
    assert.deepEqual(result.preservedAs, []);
    assert.deepEqual(readFileSync(target), bytes, "Retry changes nothing on disk");
    assert.equal(readFileSync(`${target}.previous`).length, 32);
    const fresh = readStateFileSync(target, { kind: "canonical", validate: validateShape, acceptFresh: true });
    assert.equal(fresh.status, "corrupt");
    assert.equal(fresh.preservedAs.length, 2, "starting fresh keeps both files aside");
    assert.equal(fs.existsSync(target), false, "no file is invented in its place");
  });

  test(`secret, ${shape}: corrupt and the older copy is never read`, () => {
    const directory = root();
    const target = join(directory, "vault.json");
    writeFileSync(target, corrupt(good));
    writeFileSync(`${target}.previous`, json({ version: 1, revoked: false }));
    const result = readStateFileSync(target, { kind: "secret", validate: validateShape });
    assert.equal(result.status, "corrupt");
    assert.deepEqual(JSON.parse(readFileSync(`${target}.previous`, "utf8")), { version: 1, revoked: false });
    assert.equal(fs.existsSync(target), false);
  });

  test(`rebuildable, ${shape}: corrupt and preserved`, async () => {
    const directory = root();
    const target = join(directory, "record.json");
    writeFileSync(target, corrupt(good));
    const result = await readStateFile(target, { kind: "rebuildable" });
    assert.equal(result.status, "corrupt");
    assert.equal(corruptCopies(directory, "record.json").length, 1);
  });
}

test("a valid file reads ok and a missing one reads missing", () => {
  const directory = root();
  const target = join(directory, "state.json");
  assert.deepEqual(readStateFileSync(target, { kind: "canonical" }), { status: "missing" });
  writeFileSync(target, good);
  const result = readStateFileSync(target, { kind: "canonical", validate: validateShape });
  assert.equal(result.status, "ok");
  assert.equal(result.value.version, 3);
});

test("a canonical target lost after being moved aside is recovered from previous", () => {
  const directory = root();
  const target = join(directory, "state.json");
  writeFileSync(`${target}.previous`, json({ version: 9 }));
  const result = readStateFileSync(target, { kind: "canonical", validate: validateShape });
  assert.equal(result.status, "restored");
  assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { version: 9 });
});

test("isBlank and the unreadable error carry no path", () => {
  assert.equal(isBlank(Buffer.alloc(10)), true);
  assert.equal(isBlank(Buffer.from([0, 1])), false);
  const error = new StateUnreadableError("workspace", ["/secret/path.corrupt"]);
  assert.equal(isStateUnreadableError(error), true);
  assert.equal(error.message.includes("/secret"), false);
  assert.equal(isStateUnreadableError({ code: "state_unreadable", store: "macros" }), true);
});

test("canonical loads: restore queues one notice; corrupt throws until the user starts fresh", () => {
  takeStateRecoveryNotices();
  const directory = root();
  const target = join(directory, "settings.json");
  writeFileSync(target, Buffer.alloc(100));
  writeFileSync(`${target}.previous`, json({ version: 5 }));
  assert.deepEqual(loadCanonicalStateSync(target, "server-settings", { validate: validateShape }), { version: 5 });
  assert.deepEqual(takeStateRecoveryNotices(), [{ kind: "restored", store: "server-settings" }]);
  assert.deepEqual(takeStateRecoveryNotices(), [], "a notice is given once");

  const other = join(directory, "macros.json");
  writeFileSync(other, Buffer.alloc(100));
  assert.throws(() => loadCanonicalStateSync(other, "macros"), (error) => error.code === "state_unreadable" && error.store === "macros");
  assert.throws(() => loadCanonicalStateSync(other, "macros"), /macros/, "retrying is the same check");
  assert.equal(readFileSync(other).length, 100);
  acceptFreshStateStart("macros");
  assert.equal(loadCanonicalStateSync(other, "macros"), undefined);
  assert.equal(fs.existsSync(other), false);
  assert.equal(corruptCopies(directory, "macros.json").length, 1);
  assert.deepEqual(takeStateRecoveryNotices(), [{ kind: "started-fresh", store: "macros" }]);
});

test("secret loads fail closed with a notice and never read the older copy", () => {
  takeStateRecoveryNotices();
  const directory = root();
  const target = join(directory, "devices.json");
  writeFileSync(target, Buffer.alloc(50));
  writeFileSync(`${target}.previous`, json([{ id: "revoked-device" }]));
  assert.equal(loadSecretStateSync(target, "paired devices"), undefined);
  assert.deepEqual(takeStateRecoveryNotices(), [{ kind: "secret-reset", store: "paired devices" }]);
});

test("rebuildable loads read as missing and report to the observer", () => {
  const seen = [];
  observeRebuiltState((store, preserved) => seen.push([store, preserved.length]));
  const directory = root();
  const target = join(directory, "holder.json");
  writeFileSync(target, Buffer.alloc(20));
  assert.equal(loadRebuildableStateSync(target, "session holder record"), undefined);
  assert.deepEqual(seen, [["session holder record", 1]]);
  observeRebuiltState(undefined);
});

test("starting fresh keeps the damaged file and its copy aside, so a relaunch begins empty", () => {
  takeStateRecoveryNotices();
  const directory = root();
  const target = join(directory, "workspace.json");
  writeFileSync(target, Buffer.alloc(80));
  writeFileSync(`${target}.previous`, "{trunc");
  let error;
  try {
    loadCanonicalStateSync(target, "workspace");
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.store, "workspace");
  assert.equal(error.message.includes(directory), false, "the path never reaches the message");
  const preserved = startStateFresh(error);
  assert.equal(preserved.length, 2);
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.existsSync(`${target}.previous`), false);
  assert.deepEqual(readStateFileSync(target, { kind: "canonical" }), { status: "missing" });
  assert.deepEqual(takeStateRecoveryNotices(), [{ kind: "started-fresh", store: "workspace" }]);
});
