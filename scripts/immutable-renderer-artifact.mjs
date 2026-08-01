import { createHash } from "node:crypto";
import { chmod, cp, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

/**
 * Copy one generated renderer bundle into a per-run directory, validate its
 * complete content-addressed manifest, and make the staged tree read-only.
 * Electron E2E must serve this copy rather than the shared build directory:
 * other worktree builds can then replace dist without creating a mixed hash
 * graph underneath an already-loaded entry document.
 */
export async function stageImmutableRendererArtifact({ sourceRoot, destinationParent }) {
  const source = resolve(sourceRoot);
  const parent = resolve(destinationParent);
  const destination = join(parent, "renderer-artifact");
  await mkdir(parent, { recursive: true });
  const sourceSnapshot = await validateRendererArtifact(source);
  await cp(source, destination, { recursive: true, dereference: false, errorOnExist: true, force: false });
  const stagedSnapshot = await validateRendererArtifact(destination);
  if (stagedSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
    throw new Error("renderer artifact changed while it was being staged");
  }
  await makeTreeReadOnly(destination);
  return Object.freeze({
    rootDirectory: destination,
    fingerprint: stagedSnapshot.fingerprint,
    async assertUnchanged() {
      const current = await validateRendererArtifact(destination);
      if (current.fingerprint !== stagedSnapshot.fingerprint) {
        throw new Error("immutable renderer artifact changed during the run");
      }
    },
  });
}

export async function validateRendererArtifact(rootDirectory) {
  const root = resolve(rootDirectory);
  const manifestBytes = await readFile(join(root, "manifest.json"));
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("renderer artifact manifest is invalid JSON");
  }
  if (manifest?.schemaVersion !== 1 || typeof manifest.bundleId !== "string" || !Array.isArray(manifest.assets)) {
    throw new Error("renderer artifact manifest is invalid");
  }
  const prefix = `/remote-app/${manifest.bundleId}/`;
  const declared = new Set();
  for (const asset of manifest.assets) {
    if (!asset || typeof asset.path !== "string" || !asset.path.startsWith(prefix)) {
      throw new Error("renderer artifact contains an invalid asset path");
    }
    const relativePath = asset.path.slice(prefix.length);
    assertSafeRelativePath(relativePath);
    if (declared.has(relativePath)) throw new Error(`renderer artifact contains a duplicate asset: ${relativePath}`);
    declared.add(relativePath);
    const bytes = await readFile(join(root, ...relativePath.split("/"))).catch(() => {
      throw new Error(`renderer artifact asset is missing: ${relativePath}`);
    });
    if (bytes.byteLength !== asset.size) throw new Error(`renderer artifact asset size mismatch: ${relativePath}`);
    const hash = createHash("sha256").update(bytes).digest("base64url");
    if (hash !== asset.hash) throw new Error(`renderer artifact asset hash mismatch: ${relativePath}`);
  }
  const files = await walkRegularFiles(root);
  const applicationFiles = files.filter((path) => path !== "manifest.json");
  if (applicationFiles.length !== declared.size || applicationFiles.some((path) => !declared.has(path))) {
    throw new Error("renderer artifact manifest does not declare the complete file tree");
  }
  const fingerprint = createHash("sha256")
    .update(manifestBytes)
    .update("\0")
    .update(applicationFiles.sort().map((path) => `${path}:${manifest.assets.find((asset) => asset.path === `${prefix}${path}`).hash}`).join("\n"))
    .digest("base64url");
  return Object.freeze({ bundleId: manifest.bundleId, fingerprint, files: Object.freeze(files) });
}

async function walkRegularFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new Error(`renderer artifact contains a symbolic link: ${relative(root, absolute)}`);
      if (metadata.isDirectory()) await visit(absolute);
      else if (metadata.isFile()) files.push(relative(root, absolute).split(sep).join("/"));
      else throw new Error(`renderer artifact contains a non-regular entry: ${basename(absolute)}`);
    }
  }
  await visit(root);
  return files;
}

async function makeTreeReadOnly(root) {
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else await chmod(absolute, 0o444);
    }
  }
  await visit(root);
}

function assertSafeRelativePath(path) {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("renderer artifact asset path is unsafe");
  }
}
