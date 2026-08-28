import test from "node:test";
import assert from "node:assert/strict";
import { posix } from "node:path";
import { SftpFilesystem } from "../dist/index.js";

class Attrs { constructor(type, size = 0, mtime = 10) { this.type = type; this.size = size; this.mode = type === "directory" ? 0o40700 : 0o100600; this.mtime = mtime; this.atime = mtime; } isDirectory() { return this.type === "directory"; } isSymbolicLink() { return this.type === "symlink"; } }
class FakeSftp {
  constructor() { this.nodes = new Map([["/home/u", { attrs: new Attrs("directory") }], ["/home/u/project", { attrs: new Attrs("directory") }], ["/home/u/project/a.txt", { attrs: new Attrs("file", 5), data: Buffer.from("hello") }], ["/outside", { attrs: new Attrs("directory") }]]); this.links = new Map([["/home/u/project/escape", "/outside"]]); this.renames = []; this.ends = 0; this.realpaths = 0; }
  end() { this.ends++; }
  realpath(path, cb) { this.realpaths++; const normalized = path === "." || path === "~" ? "/home/u" : posix.normalize(path); const actual = this.links.get(normalized) ?? normalized; cb(this.nodes.has(actual) ? null : code("ENOENT"), actual); }
  stat(path, cb) { const actual = this.links.get(path) ?? path; const node = this.nodes.get(actual); cb(node ? null : code("ENOENT"), node?.attrs); }
  lstat(path, cb) { if (this.links.has(path)) return cb(null, new Attrs("symlink")); this.stat(path, cb); }
  readdir(path, cb) { if (path !== "/home/u/project") return cb(code("ENOTDIR")); cb(null, [{ filename: "a.txt", attrs: this.nodes.get("/home/u/project/a.txt").attrs }, { filename: "escape", attrs: new Attrs("symlink") }]); }
  open(path, flags, cb) { cb(this.nodes.has(path) ? null : code("ENOENT"), path); }
  read(handle, buffer, offset, length, position, cb) { const data = this.nodes.get(handle).data.subarray(position, position + length); data.copy(buffer, offset); cb(null, data.length); }
  close(handle, cb) { cb(null); }
  writeFile(path, data, options, cb) { this.nodes.set(path, { attrs: new Attrs("file", data.length, 20), data: Buffer.from(data) }); cb(null); }
  ext_openssh_rename(from, to, cb) { this.renames.push([from, to]); this.nodes.set(to, this.nodes.get(from)); this.nodes.delete(from); cb(null); }
  rename(from, to, cb) { this.ext_openssh_rename(from, to, cb); }
  unlink(path, cb) { const found = this.nodes.delete(path); cb(found ? null : code("ENOENT")); }
  mkdir(path, options, cb) { if (this.nodes.has(path)) return cb(code("EEXIST")); this.nodes.set(path, { attrs: new Attrs("directory") }); cb(null); }
  rmdir(path, cb) { this.unlink(path, cb); }
}
function code(value) { return Object.assign(new Error(value), { code: value }); }
function setup() { const sftp = new FakeSftp(); const client = { sftp: (cb) => cb(null, sftp) }; const pool = { acquire: async () => ({ client, release() {} }) }; return { sftp, fs: new SftpFilesystem(pool, { readBytes: 32, writeBytes: 32 }) }; }
const base = { profileId: "p", revision: 1, root: "/home/u/project" };

test("remote roots and directory browser canonicalize through SFTP", async () => {
  const { fs, sftp } = setup(); assert.deepEqual(await fs.resolveRoot({ profileId: "p", revision: 1, root: "~" }), { root: "/home/u" }); assert.equal(sftp.ends, 0);
  const result = await fs.browse({ profileId: "p", revision: 1, root: "/home/u/project" }); assert.equal(result.entries.length, 2); assert.equal(result.entries[0].path, "/home/u/project/a.txt");
  assert.equal(sftp.ends, 0, "directory listing reuses the open SFTP session");
  const realpathsAfterFirstList = sftp.realpaths;
  await fs.list({ profileId: "p", revision: 1, root: "/home/u/project", path: "." });
  assert.equal(sftp.realpaths, realpathsAfterFirstList, "listing the project root again reuses the cached realpath");
  await fs.releaseCached("p", 1);
  assert.equal(sftp.ends, 1);
});

test("directory entries without optional SFTP atime still satisfy the public metadata contract", async () => {
  const { fs, sftp } = setup();
  sftp.nodes.get("/home/u/project/a.txt").attrs.atime = undefined;
  const result = await fs.list({ ...base, path: "." });
  const entry = result.entries.find((candidate) => candidate.name === "a.txt");
  assert.equal(entry.atimeMs, entry.mtimeMs);
  assert.equal(Number.isFinite(entry.atimeMs), true);
});

test("realpath containment rejects lexical and symlink escapes", async () => {
  const { fs } = setup(); await assert.rejects(() => fs.realpath({ ...base, path: "../../outside" }), (e) => e.code === "permission-denied");
  await assert.rejects(() => fs.realpath({ ...base, path: "escape" }), (e) => e.code === "permission-denied");
});

test("ranged reads, metadata, and bounded writes stay remote", async () => {
  const { fs, sftp } = setup(); const read = await fs.read({ ...base, path: "a.txt", offset: 1, length: 3 }); assert.equal(Buffer.from(read.data, "base64").toString(), "ell");
  const result = await fs.write({ ...base, path: "new.txt", data: Buffer.from("world").toString("base64"), encoding: "base64" }); assert.equal(result.outcome, "written"); assert.equal(result.atomic, true); assert.equal(sftp.nodes.get("/home/u/project/new.txt").data.toString(), "world");
  await assert.rejects(() => fs.write({ ...base, path: "large", data: "x".repeat(33) }), (e) => e.code === "too-large");
});

test("mutations normalize conflicts and do not recursively delete", async () => {
  const { fs } = setup(); await fs.createDirectory({ ...base, path: "new-dir" });
  await assert.rejects(() => fs.createDirectory({ ...base, path: "new-dir" }), (e) => e.code === "conflict");
  await fs.rename({ ...base, path: "a.txt", destination: "b.txt" }); await fs.remove({ ...base, path: "b.txt" });
  await assert.rejects(() => fs.remove({ ...base, path: "/home/u/project" }), (e) => e.code === "permission-denied");
});

test("same profile with different roots is isolated on every operation", async () => {
  const { fs, sftp } = setup(); sftp.nodes.set("/home/u/other", { attrs: new Attrs("directory") }); sftp.nodes.set("/home/u/other/a.txt", { attrs: new Attrs("file", 5), data: Buffer.from("other") });
  const one = await fs.read({ ...base, path: "a.txt" }); const two = await fs.read({ ...base, root: "/home/u/other", path: "a.txt" });
  assert.equal(Buffer.from(one.data, "base64").toString(), "hello"); assert.equal(Buffer.from(two.data, "base64").toString(), "other");
  await assert.rejects(() => fs.read({ ...base, root: "/home/u/other", path: "/home/u/project/a.txt" }), (e) => e.code === "permission-denied");
});

test("disconnect after mutation begins reports outcome unknown and requires reconciliation", async () => {
  const { fs, sftp } = setup(); sftp.ext_openssh_rename = (from, to, cb) => cb(code("ECONNRESET"));
  await assert.rejects(() => fs.write({ ...base, path: "uncertain.txt", data: "maybe" }), (e) => e.code === "outcome-unknown" && e.details.reconciliationRequired === true);
});
