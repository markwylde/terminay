import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "terminay-puzed-pack-"));
const npmEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["INIT_CWD", "npm_config_local_prefix", "npm_config_user_agent", "npm_config_workspace"].includes(key)));
try {
  const json = execFileSync("npm", ["pack", "--workspace", "terminay-plugin-puzed", "--json", "--pack-destination", directory], { cwd: new URL("../../../", import.meta.url), encoding: "utf8", env: npmEnvironment });
  const packed = JSON.parse(json);
  const { filename } = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  execFileSync("tar", ["-xzf", join(directory, filename), "-C", directory]);
  const packageJson = JSON.parse(await readFile(join(directory, "package/package.json"), "utf8"));
  assert.equal(packageJson.terminay.id, "com.puzed.platform");
  assert.equal(packageJson.terminay.entrypoint, "dist/index.js");
  const scope = join(directory, "package/node_modules/@terminay");
  await mkdir(scope, { recursive: true });
  await symlink(new URL("../../../packages/extension-api", import.meta.url), join(scope, "extension-api"), "dir");
  const loaded = await import(pathToFileURL(join(directory, "package/dist/index.js")));
  const definitions = [];
  await loaded.activate({ extensionId: "com.puzed.platform", apiVersion: "1.0.0", paths: { configuration: "/tmp/config", data: "/tmp/data", cache: "/tmp/cache" }, registerProjectEnvironmentProvider: (value) => definitions.push(value) });
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].definition.providerId, "com.puzed.platform/vm");
  assert.equal(definitions[0].definition.profileForm.sections[0].fields.some((field) => field.id === "api-key" && field.type === "secret"), true);
  assert.equal(definitions[0].definition.browseForm.title, "Browse Terminay VMs");
  console.log("Packed extension activation passed.");
} finally { await rm(directory, { recursive: true, force: true }); }
