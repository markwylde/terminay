#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const UI_BUNDLE_CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export const UI_BUNDLE_HOST_COMPATIBILITY = Object.freeze({
  bootstrap: Object.freeze({ minimum: 1, maximum: 1 }),
  bundleFormat: Object.freeze({ minimum: 1, maximum: 1 }),
  hostBridge: Object.freeze({ minimum: 1, maximum: 1 }),
  byteEndpoint: Object.freeze({ minimum: 1, maximum: 1 }),
  executionRuntime: Object.freeze({ minimum: 120, maximum: 255 }),
  requiredCapabilities: Object.freeze({}),
  optionalCapabilities: Object.freeze({
    nativeWindows: Object.freeze({ minimum: 1, maximum: 1 }),
    nativeMenus: Object.freeze({ minimum: 1, maximum: 1 }),
    filePicker: Object.freeze({ minimum: 1, maximum: 1 }),
    clipboardWrite: Object.freeze({ minimum: 1, maximum: 1 }),
    notifications: Object.freeze({ minimum: 1, maximum: 1 }),
    updater: Object.freeze({ minimum: 1, maximum: 1 }),
    osIntegration: Object.freeze({ minimum: 1, maximum: 1 }),
  }),
});

export async function buildUiBundleManifest({
  rootDirectory,
  serverVersion,
  protocolVersion = "1",
  entryFile = "index.html",
  hostCompatibility = UI_BUNDLE_HOST_COMPATIBILITY,
}) {
  const root = resolve(rootDirectory);
  const files = await walkRegularFiles(root);
  const manifestRelativePath = "manifest.json";
  const applicationFiles = files.filter(
    (path) => path !== manifestRelativePath,
  );
  if (!applicationFiles.includes(entryFile))
    throw new Error(`UI bundle entry is missing: ${entryFile}`);
  if (applicationFiles.length === 0)
    throw new Error("UI bundle contains no application files");

  const provisionalAssets = await Promise.all(
    applicationFiles.map(async (path) => {
      const bytes = await readFile(join(root, ...path.split("/")));
      return {
        contentType: contentType(path),
        hash: createHash("sha256").update(bytes).digest("base64url"),
        path: `/remote-app/provisional/${path}`,
        size: bytes.byteLength,
      };
    }),
  );
  const assetInventory = provisionalAssets
    .map(
      (asset) =>
        `${asset.path.slice("/remote-app/provisional/".length)}:${asset.hash}`,
    )
    .sort()
    .join("\n");
  const canonical = `${assetInventory}\n--identity--\n${JSON.stringify({
    bundleFormatVersion: 1,
    protocolVersion: String(protocolVersion),
    serverVersion,
    hostCompatibility: canonicalHostCompatibility(hostCompatibility),
  })}`;
  const bundleId = createHash("sha256")
    .update(canonical)
    .digest("base64url")
    .slice(0, 32);
  const assets = provisionalAssets.map((asset) => ({
    ...asset,
    path: asset.path.replace(
      "/remote-app/provisional/",
      `/remote-app/${bundleId}/`,
    ),
  }));
  const manifest = {
    schemaVersion: 1,
    bundleId,
    entryPath: `/remote-app/${bundleId}/${entryFile}`,
    protocolVersion: String(protocolVersion),
    serverVersion,
    contentSecurityPolicy: UI_BUNDLE_CSP,
    bundleFormatVersion: 1,
    hostCompatibility,
    assets,
  };
  await writeFile(
    join(root, manifestRelativePath),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

function canonicalHostCompatibility(value) {
  const capabilities = (input) =>
    Object.fromEntries(
      Object.entries(input).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  return {
    bootstrap: value.bootstrap,
    bundleFormat: value.bundleFormat,
    hostBridge: value.hostBridge,
    byteEndpoint: value.byteEndpoint,
    executionRuntime: value.executionRuntime,
    requiredCapabilities: capabilities(value.requiredCapabilities),
    optionalCapabilities: capabilities(value.optionalCapabilities),
  };
}

async function walkRegularFiles(root) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink())
        throw new Error(
          `UI bundle contains a symbolic link: ${relative(root, absolute)}`,
        );
      if (metadata.isDirectory()) {
        await visit(absolute);
      } else if (metadata.isFile()) {
        const path = relative(root, absolute).split(sep).join("/");
        if (
          path.length === 0 ||
          path
            .split("/")
            .some((part) => part === "" || part === "." || part === "..")
        ) {
          throw new Error(`UI bundle contains an unsafe path: ${path}`);
        }
        output.push(path);
      } else {
        throw new Error(
          `UI bundle contains a non-regular entry: ${relative(root, absolute)}`,
        );
      }
    }
  }
  await visit(root);
  return output;
}

function contentType(path) {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".webmanifest":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".icns":
      return "image/icns";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".wasm":
      return "application/wasm";
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const rootDirectory = process.argv[2] ?? "dist";
  const serverVersion = process.argv[3];
  if (serverVersion === undefined || serverVersion.length === 0) {
    throw new Error(
      "usage: build-ui-bundle-manifest.mjs [root-directory] <server-version> [protocol-version] [entry-file]",
    );
  }
  const manifest = await buildUiBundleManifest({
    rootDirectory,
    serverVersion,
    protocolVersion: process.argv[4] ?? "1",
    entryFile: process.argv[5] ?? "index.html",
  });
  process.stdout.write(`${manifest.bundleId}\n`);
}
