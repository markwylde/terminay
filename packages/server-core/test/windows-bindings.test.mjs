import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// ADR-0083: Win32 bindings are loaded only when a Windows function is first
// called. Importing server-core on macOS or Linux must never load koffi.

const require = createRequire(import.meta.url);
const koffiLoaded = () => Object.keys(require.cache).some((path) => /[\\/]koffi[\\/]/u.test(path));

test("importing server-core does not load koffi", async () => {
  const core = await import("../dist/index.js");
  assert.equal(typeof core.readWindowsProcessTable, "function");
  assert.equal(koffiLoaded(), false);
});

test("a SID is formatted in its string form", async () => {
  const { formatSid } = await import("../dist/index.js");
  // S-1-5-21-1004336348-1177238915-682003330-1001
  const sid = new Uint8Array(28);
  const view = new DataView(sid.buffer);
  view.setUint8(0, 1);
  view.setUint8(1, 5);
  view.setUint8(7, 5);
	[21, 1004336348, 1177238915, 682003330, 1001].forEach((value, index) => {
		view.setUint32(8 + index * 4, value, true);
	});
  assert.equal(formatSid(sid), "S-1-5-21-1004336348-1177238915-682003330-1001");
  // LocalSystem.
  assert.equal(formatSid(new Uint8Array([1, 1, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0])), "S-1-5-18");
  assert.equal(formatSid(new Uint8Array([1, 2, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0])), null, "a truncated SID is refused");
});

test("a second copy of the bindings reuses koffi's named structs instead of failing", async () => {
  const { koffiStruct } = await import("../dist/index.js");
  const koffi = require("koffi");
  const name = `TERMINAY_PROBE_${process.pid}`;
  const definition = { dwSize: "uint32", th32ProcessID: "uint32" };
  const first = koffiStruct(koffi, name, definition);
  // A plain second declaration is what an application bundle with two copies
  // of the module did, and koffi refuses it.
  assert.throws(() => koffi.struct(name, definition), /Duplicate type name/u);
  const second = koffiStruct(koffi, name, definition);
  assert.equal(koffi.sizeof(second), koffi.sizeof(first));
  assert.equal(koffi.sizeof(second), 8);
});
