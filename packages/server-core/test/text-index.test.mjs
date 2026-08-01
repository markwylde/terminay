import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalProjectPathResolver, FileContentStreamService, ServerTextIndex } from "../dist/fileService/index.js";

test("server text metadata indexes canonical text in bounded continuations and invalidates changes", async () => {
  let bytes = new TextEncoder().encode("one\ntwo\nthree\n");
  let mtimeMs = 1;
  const storage = {
    realpath(path) { if (path !== "/project" && path !== "/project/log.txt") throw Object.assign(new Error("missing"), { code: "ENOENT" }); return path; },
    stat(path) { return path === "/project" ? { isDirectory: true, size: 0 } : { isFile: true, size: bytes.byteLength, mtimeMs }; },
    readRange(_path, offset, length) { return bytes.slice(offset, offset + length); },
  };
  const content = new FileContentStreamService(new CanonicalProjectPathResolver("/project", storage), storage, { maxRangeBytes: 3 });
  const index = new ServerTextIndex(content, { chunkBytes: 3, maxBytesPerRequest: 3 });
  const first = await index.metadata("log.txt");
  assert.deepEqual({ indexed: first.indexedByteLength, lines: first.lineCount, complete: first.isComplete }, { indexed: 3, lines: 1, complete: false });
  const second = await index.metadata("log.txt");
  assert.equal(second.indexedByteLength, 6);
  let current = second;
  while (!current.isComplete) current = await index.metadata("log.txt");
  assert.equal(current.lineCount, 4);
  bytes = new TextEncoder().encode("replacement\n"); mtimeMs = 2;
  const replaced = await index.metadata("log.txt");
  assert.deepEqual({ indexed: replaced.indexedByteLength, lines: replaced.lineCount, complete: replaced.isComplete }, { indexed: 3, lines: 1, complete: false });
  await assert.rejects(() => index.metadata("../outside"), /path/u);
});

test("server text windows use exact byte boundaries for unequal lines and cross-page reads", async () => {
  const source = Array.from({ length: 132 }, (_, index) => index === 127 ? "x".repeat(80) : `line-${index}`).join("\r\n");
  const bytes = new TextEncoder().encode(source);
  const storage = {
    realpath(path) { if (path !== "/project" && path !== "/project/unequal.txt") throw Object.assign(new Error("missing"), { code: "ENOENT" }); return path; },
    stat(path) { return path === "/project" ? { isDirectory: true, size: 0 } : { isFile: true, size: bytes.byteLength, mtimeMs: 1 }; },
    readRange(_path, offset, length) { return bytes.slice(offset, offset + length); },
  };
  const content = new FileContentStreamService(new CanonicalProjectPathResolver("/project", storage), storage, { maxRangeBytes: bytes.byteLength });
  const index = new ServerTextIndex(content, { chunkBytes: 97, maxBytesPerRequest: bytes.byteLength, maxWindowBytes: 4096 });
  const window = await index.lines("unequal.txt", 127, 3);
  assert.equal(window.windowComplete, true);
  assert.equal(window.indexComplete, true);
  assert.deepEqual(window.lines.map((line) => [line.lineNumber, line.text, line.eol]), [
    [127, "x".repeat(80), "\r\n"],
    [128, "line-128", "\r\n"],
    [129, "line-129", "\r\n"],
  ]);
  assert.equal(window.lines[1].start, new TextEncoder().encode(`${Array.from({ length: 127 }, (_, index) => `line-${index}`).join("\r\n")}\r\n${"x".repeat(80)}\r\n`).byteLength);
});

test("server text windows report bounded indexing progress instead of estimating offsets", async () => {
  const bytes = new TextEncoder().encode(`${"long-first-line".repeat(20)}\nsecond\nthird`);
  const storage = {
    realpath(path) { if (path !== "/project" && path !== "/project/log.txt") throw Object.assign(new Error("missing"), { code: "ENOENT" }); return path; },
    stat(path) { return path === "/project" ? { isDirectory: true, size: 0 } : { isFile: true, size: bytes.byteLength, mtimeMs: 1 }; },
    readRange(_path, offset, length) { return bytes.slice(offset, offset + length); },
  };
  const content = new FileContentStreamService(new CanonicalProjectPathResolver("/project", storage), storage, { maxRangeBytes: 32 });
  const index = new ServerTextIndex(content, { chunkBytes: 32, maxBytesPerRequest: 32 });
  const pending = await index.lines("log.txt", 1, 1);
  assert.deepEqual({ complete: pending.windowComplete, lines: pending.lines.length, indexed: pending.indexedByteLength }, { complete: false, lines: 0, indexed: 32 });
  let result = pending;
  while (!result.windowComplete) result = await index.lines("log.txt", 1, 1);
  assert.equal(result.lines[0].text, "second");
  assert.equal(result.lines[0].start, bytes.indexOf(0x0a) + 1);
});
