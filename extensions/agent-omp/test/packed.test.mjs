import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import test from "node:test";

function execFileText(command, arguments_) {
  return new Promise((resolve, reject) => execFile(command, arguments_, (error, stdout) => error ? reject(error) : resolve(stdout)));
}

test("packed extension contains only its public runtime and author materials", async () => {
  const archives = await readdir(new URL("../.tmp-pack/", import.meta.url));
  const archive = archives.find((name) => name.endsWith(".tgz"));
  assert.ok(archive, "npm pack did not create an archive");
  const archiveUrl = new URL(`../.tmp-pack/${archive}`, import.meta.url);
  const listed = await execFileText("tar", ["-tzf", archiveUrl.pathname]);
  assert.match(listed, /package\/dist\/index\.js/);
  assert.equal(listed.includes("packages/server-core"), false);
  assert.equal(listed.includes("electron/"), false);
});
