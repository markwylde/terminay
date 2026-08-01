import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [workflow, packageJson, builderConfig] = await Promise.all([
  readFile(new URL(".github/workflows/trigger-release.yml", root), "utf8"),
  readFile(new URL("package.json", root), "utf8"),
  readFile(new URL("electron-builder.json5", root), "utf8"),
]);
const scripts = JSON.parse(packageJson).scripts;

function job(name, nextName) {
  const start = workflow.indexOf(`  ${name}:\n`);
  const end = workflow.indexOf(`  ${nextName}:\n`, start + 1);
  assert.ok(start >= 0, `release workflow must declare ${name}`);
  assert.ok(end > start, `${name} must precede ${nextName}`);
  return workflow.slice(start, end);
}

const binaries = job("build-binaries", "build-standalone-server");

test("release Desktop matrix binds each native artifact format to its matching OS build", () => {
  const macEntry = [
    "- os: macos-latest",
    "label: macOS",
    "script: npm run build:mac",
    "pattern: release/**/*.dmg",
    "asset_template: Terminay-Mac-%VERSION%-Installer.dmg",
  ].join("\n            ");
  const linuxEntry = [
    "- os: ubuntu-latest",
    "label: Linux",
    "script: npm run build:linux",
    "pattern: release/**/*.AppImage",
    "asset_template: Terminay-Linux-%VERSION%.AppImage",
  ].join("\n            ");

  assert.match(binaries, new RegExp(macEntry.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(binaries, new RegExp(linuxEntry.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.equal((binaries.match(/^ {10}- os:/gmu) ?? []).length, 2,
    "release packaging must publish only the explicitly reviewed native OS lanes");
});

test("native package commands and artifact names agree with the release matrix", () => {
  assert.match(scripts["build:mac"], /electron-builder --mac dmg/u);
  assert.match(scripts["build:linux"], /electron-builder --linux AppImage/u);

  assert.match(builderConfig, /"artifactName": "\$\{productName\}-Mac-\$\{version\}-Installer\.\$\{ext\}"/u);
  assert.match(builderConfig, /"artifactName": "\$\{productName\}-Linux-\$\{version\}\.\$\{ext\}"/u);

  assert.match(binaries, /if: matrix\.os == 'macos-latest'/u,
    "macOS-only signing and notarization must never run for a Linux artifact");
  assert.match(binaries, /-name '\*\.dmg' -o -name '\*\.AppImage'/u,
    "the release lane must reject an artifact from the wrong native format");
});

test("release artifact selection is exact and remains scoped to the selected native lane", () => {
  const selectionStart = binaries.indexOf("- name: Verify exact release asset selection");
  const checksumStart = binaries.indexOf("- name: Write release asset checksums");
  assert.ok(selectionStart >= 0 && checksumStart > selectionStart,
    "native format selection must occur before checksumming or publication");
  const selection = binaries.slice(selectionStart, checksumStart);

  // biome-ignore lint/suspicious/noTemplateCurlyInString: this asserts literal Bash parameter expansion in the workflow.
  assert.ok(selection.includes('EXPECTED_ASSET="${ASSET_TEMPLATE//%VERSION%/$VERSION}"'),
    "the selected artifact name must be derived only from the matrix template and release version");
  assert.match(selection, /test "\$ACTUAL_FILE" = "\$EXPECTED_FILE"/u);
  assert.match(selection, /CANDIDATE_COUNT.*= 1/us);
});
