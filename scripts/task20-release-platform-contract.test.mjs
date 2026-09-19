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
    "asset_templates: Terminay-Mac-%VERSION%-Installer.dmg Terminay-Mac-%VERSION%.zip Terminay-Mac-%VERSION%.zip.blockmap",
    "update_payload: Terminay-Mac-%VERSION%.zip",
    "update_metadata: latest-mac.yml",
  ].join("\n            ");
  const linuxEntry = [
    "- os: ubuntu-latest",
    "label: Linux",
    "script: npm run build:linux",
    "asset_templates: Terminay-Linux-%VERSION%.AppImage",
    "update_payload: Terminay-Linux-%VERSION%.AppImage",
    "update_metadata: latest-linux.yml",
  ].join("\n            ");

  assert.match(binaries, new RegExp(macEntry.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(binaries, new RegExp(linuxEntry.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.equal((binaries.match(/^ {10}- os:/gmu) ?? []).length, 2,
    "release packaging must publish only the explicitly reviewed native OS lanes");
});

test("native package commands and artifact names agree with the release matrix", () => {
  assert.equal(scripts["build:mac"], "npm run build:app && electron-builder --mac dmg zip --publish never");
  assert.equal(scripts["build:linux"], "npm run build:app && electron-builder --linux AppImage --publish never");
  // The workflow uploads every asset itself; electron-builder never publishes.
  // (An unpacked --dir build produces no artifact to publish.)
  for (const [name, command] of Object.entries(scripts)) {
    if (/\belectron-builder\b/u.test(command) && !/\belectron-builder --dir\b/u.test(command)) {
      assert.match(command, /--publish never/u, `${name} must not let electron-builder publish`);
    }
  }

  assert.match(builderConfig, /"target": \[\n\s+"dmg",\n\s+"zip"\n\s+\]/u,
    "the macOS build must produce the zip Squirrel.Mac installs updates from");
  assert.match(builderConfig, /"artifactName": "\$\{productName\}-Mac-\$\{version\}\.\$\{ext\}"/u);
  assert.match(builderConfig, /"dmg": \{\n\s+"artifactName": "\$\{productName\}-Mac-\$\{version\}-Installer\.\$\{ext\}",/u,
    "the DMG keeps its installer name, distinct from the update zip");
  assert.match(builderConfig, /"writeUpdateInfo": false/u,
    "the stapled DMG must not appear in update metadata whose digest stapling invalidates");
  assert.match(builderConfig, /"artifactName": "\$\{productName\}-Linux-\$\{version\}\.\$\{ext\}"/u);
  assert.match(builderConfig, /"publish": \{\n\s+"provider": "github",\n\s+"owner": "markwylde",\n\s+"repo": "terminay",\n\s+"releaseType": "release"\n\s+\}/u,
    "update metadata must point clients at this repository's GitHub releases");

  assert.match(binaries, /if: matrix\.os == 'macos-latest'/u,
    "macOS-only signing and notarization must never run for a Linux artifact");
  assert.match(binaries, /-name '\*\.dmg' -o -name '\*\.zip' -o -name '\*\.blockmap' -o -name '\*\.AppImage'/u,
    "the release lane must reject an artifact from the wrong native format");
});

test("release artifact selection is exact and remains scoped to the selected native lane", () => {
  const selectionStart = binaries.indexOf("- name: Verify exact release asset selection");
  const checksumStart = binaries.indexOf("- name: Write release asset checksums");
  assert.ok(selectionStart >= 0 && checksumStart > selectionStart,
    "native format selection must occur before checksumming or publication");
  const selection = binaries.slice(selectionStart, binaries.indexOf("- name:", selectionStart + 1));

  // biome-ignore lint/suspicious/noTemplateCurlyInString: this asserts literal Bash parameter expansion in the workflow.
  assert.ok(selection.includes('EXPECTED_ASSET="${ASSET_TEMPLATE//%VERSION%/$VERSION}"'),
    "the selected artifact names must be derived only from the matrix templates and release version");
  assert.match(selection, /test "\$ACTUAL_FILES" = "\$EXPECTED_FILES"/u);
  assert.match(selection, /CANDIDATE_COUNT.*= "\$EXPECTED_COUNT"/us);
  // Later steps publish only the names selected here.
  for (const step of ["Write release asset checksums", "Verify release asset checksums before upload", "Attach checksummed binaries to GitHub release"]) {
    const start = binaries.indexOf(`- name: ${step}`);
    const body = binaries.slice(start, binaries.indexOf("- name:", start + 1) === -1 ? undefined : binaries.indexOf("- name:", start + 1));
    assert.match(body, /ASSET_FILES: \$\{\{ steps\.asset_selection\.outputs\.files \}\}/u, `${step} must use the exact selection`);
  }
});
