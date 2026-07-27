#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { spawn } from "node:child_process";

const PACKAGE = Object.freeze({
  name: "node-datachannel",
  version: "0.32.3",
  npmIntegrity:
    "sha512-Aok1ZhLsll472lRefgWYuWJ0070jh0ecHravTdRyZEmoESumebMEQV8Y+poBwSW2ZbEwAokAOGsK5Cu8pDDT2g==",
  npmSha1: "27c7cfae1c549e3a65ca51a001ae3b67301c4155",
  sourceCommit: "e495b7efad200bca44038609455c06a7f2ea812d",
  libdatachannelVersion: "0.24.2",
  libdatachannelCommit: "4e4f4892dccb2a57fe3a490d0c9d958de4244e74",
  napiVersion: 8,
});

const EXPECTED_SUBMODULES = Object.freeze({
  "deps/json": "55f93686c01528224f448c19128836e7df245f72",
  "deps/libjuice": "5948a4162d37bc213d6051b67ee2876ccc5a99a6",
  "deps/libsrtp": "ee1a77c9f9dc02c42bda9901038c500c5efe4cfa",
  "deps/plog": "94899e0b926ac1b0f4750bfbd495167b4a6ae9ef",
  "deps/usrsctp": "fec583d54493f879d2ae44a743423bf8a04371ab",
});

const EXPECTED_RELEASE_RUNS = Object.freeze({
  24952615956: "Build - Linux",
  24952618505: "Build - Mac M1",
  24952621087: "Build - Mac x64",
  24952623542: "Build - Win",
  24953023814: "npm Publish",
});

const SECURITY_REVIEW_SYMBOLS = Object.freeze([
  "ASN1_mbstring_ncopy",
  "BIO_f_linebuffer",
  "CMS_decrypt",
  "DH_check_pub_key",
  "PKCS12_parse",
  "PKCS7_verify",
  "SSL_free_buffers",
  "SSL_select_next_proto",
]);

const EXPECTED_ASSETS = Object.freeze({
  "node-datachannel-v0.32.3-napi-v8-darwin-arm64.tar.gz": {
    archiveSha256:
      "69fbffdacb9abda2a76809693443328b6aad71af25947e0733913340365f4da8",
    binarySha256:
      "1d4f814bede82a5412b19e8973e44eb484d504acc52f17796e90add75dc9ac80",
    openssl: "OpenSSL 3.6.2 7 Apr 2026",
    libsrtp: "libsrtp2 2.7.0",
  },
  "node-datachannel-v0.32.3-napi-v8-darwin-x64.tar.gz": {
    archiveSha256:
      "4f79b7ff0fe035db8d2006842537aca2a2def957569aae6ff578107b56adec38",
    binarySha256:
      "d38ddb63ab5ffa397be6830e050484ee9338055e732909db4c077ce08bb29495",
    openssl: "OpenSSL 3.6.2 7 Apr 2026",
    libsrtp: "libsrtp2 2.7.0",
  },
  "node-datachannel-v0.32.3-napi-v8-linux-arm.tar.gz": {
    archiveSha256:
      "4212da9a978bf6fb37e6147230268cbdf4ac19297ffa9b93cc05acde129137fb",
    binarySha256:
      "0f351d041ed18b9c67be82078878ac5d30e4a4858c798cf8f7eea429199fc91c",
    openssl: "OpenSSL 1.1.1w  11 Sep 2023",
    libsrtp: "libsrtp2 2.7.0",
  },
  "node-datachannel-v0.32.3-napi-v8-linux-arm64.tar.gz": {
    archiveSha256:
      "4bdbd80aeb11fb0a903318defe663a833a1f0af2615450fe10dab75c81723445",
    binarySha256:
      "18ffa3e08a07578c9fea053cd32350a69506f2bfa615c077c6e5ad5843df27a3",
    openssl: "OpenSSL 1.1.1w  11 Sep 2023",
    libsrtp: "libsrtp2 2.7.0",
  },
  "node-datachannel-v0.32.3-napi-v8-linux-x64.tar.gz": {
    archiveSha256:
      "4092afc9cd594a3326eb1bd823da452b227b742ea8222689b2cea6f7344cf67a",
    binarySha256:
      "1da298b65c65c2d47109708af662ee2a3b92cf1f34881da6455619e14729e7b4",
    openssl: "OpenSSL 1.1.1w  11 Sep 2023",
    libsrtp: "libsrtp2 2.7.0",
  },
  "node-datachannel-v0.32.3-napi-v8-linuxmusl-arm.tar.gz": {
    archiveSha256:
      "c1d9eaf66a5c14c719947b755db91d7604ebaa6d09b8e75b7a177f239ea19950",
    binarySha256:
      "9544f5219a3cefc845b7e36d18927b68d17910f4c0158bf764d57827cf166f2f",
    openssl: "OpenSSL 1.1.1w  11 Sep 2023",
    libsrtp: "libsrtp2 2.7.0",
  },
  "node-datachannel-v0.32.3-napi-v8-linuxmusl-arm64.tar.gz": {
    archiveSha256:
      "894f7ad9f7a78c2f8cf3ba8c1dc24774322cc3f1bad68891cadf5f1223dcfd63",
    binarySha256:
      "db2f11fd00bbdf9bc06b183bd97f3914b06b1163816afb2c73006d85878fbcb2",
    openssl: "OpenSSL 1.1.1w  11 Sep 2023",
    libsrtp: "libsrtp2 2.7.0",
  },
  "node-datachannel-v0.32.3-napi-v8-linuxmusl-x64.tar.gz": {
    archiveSha256:
      "543dbd84b2f15b531714b51f8ce29a4690a8d6af6ee69affd5cec5b85c54e871",
    binarySha256:
      "2540f2bbd1602bc2505070b9e2764e3c8092d9c4969b4a42306badb90ade6eae",
    openssl: "OpenSSL 1.1.1w  11 Sep 2023",
    libsrtp: "libsrtp2 2.7.0",
  },
  "node-datachannel-v0.32.3-napi-v8-win32-arm64.tar.gz": {
    archiveSha256:
      "64fe160b953f6dfd44ae3e1f75da0d654e7d23c75c976a2e6a94102fbbc08bb0",
    binarySha256:
      "c8ce3ad67f7be2eb2a1a0c749b8bf26e39106f2f5062ecdcf628e1d1eb7ac39e",
    openssl: "OpenSSL 3.6.2 7 Apr 2026",
    libsrtp: null,
  },
  "node-datachannel-v0.32.3-napi-v8-win32-x64.tar.gz": {
    archiveSha256:
      "3bfacc4125b296197fe9e22ebd9a52f05321c50aca9d80b92897507f898c12c3",
    binarySha256:
      "9c994ed1262f12313694d34f18a4b8e291b21790360d603a78cd23a4f5539b25",
    openssl: "OpenSSL 3.6.2 7 Apr 2026",
    libsrtp: null,
  },
  "node-datachannel-v0.32.3-napi-v8-win32-x86.tar.gz": {
    archiveSha256:
      "cf97f107bc73864ec7907f25baf7a7691010ed3bdedde56d6720542deb806d27",
    binarySha256:
      "01b1fe9ab0d6e313493edf17a390dd83d30b2fed166cdb4d9a528214d7df99ab",
    openssl: "OpenSSL 3.6.2 7 Apr 2026",
    libsrtp: null,
  },
});

const apiHeaders = Object.freeze({
  Accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
  "User-Agent": "terminay-node-datachannel-supply-chain-inventory",
  "X-GitHub-Api-Version": "2022-11-28",
});

function sha(buffer, algorithm = "sha256") {
  return createHash(algorithm).update(buffer).digest("hex");
}

function sri(buffer, algorithm = "sha512") {
  return `${algorithm}-${createHash(algorithm)
    .update(buffer)
    .digest("base64")}`;
}

async function fetchBuffer(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GET ${url} returned ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fetchJson(url, headers = {}) {
  return JSON.parse((await fetchBuffer(url, headers)).toString("utf8"));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (!options.allowFailure && (code !== 0 || signal !== null)) {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed (${signal ?? code})\n${
              result.stderr
            }`,
          ),
        );
        return;
      }
      resolve(result);
    });
  });
}

async function findFiles(root, predicate) {
  const found = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && predicate(path)) {
        found.push(path);
      }
    }
  }
  await visit(root);
  return found.sort();
}

function printableStrings(buffer, minimumLength = 6) {
  const values = [];
  let start = -1;
  for (let index = 0; index <= buffer.length; index += 1) {
    const byte = buffer[index];
    const printable = byte >= 0x20 && byte <= 0x7e;
    if (printable && start === -1) {
      start = index;
    } else if (!printable && start !== -1) {
      if (index - start >= minimumLength) {
        values.push(buffer.subarray(start, index).toString("ascii"));
      }
      start = -1;
    }
  }
  return values;
}

function embeddedVersions(buffer) {
  const values = printableStrings(buffer);
  return {
    openssl:
      values
        .map(
          (value) =>
            value.match(
              /OpenSSL \d+\.\d+\.\d+[a-z]? {1,2}\d+ [A-Z][a-z]{2} \d{4}/,
            )?.[0],
        )
        .find(Boolean) ?? null,
    libsrtp:
      values
        .map((value) => value.match(/libsrtp2 \d+\.\d+\.\d+/)?.[0])
        .find(Boolean) ?? null,
  };
}

function embeddedSecuritySymbols(buffer) {
  const values = new Set(printableStrings(buffer));
  return SECURITY_REVIEW_SYMBOLS.filter((symbol) => values.has(symbol));
}

async function optionalTool(command, args) {
  try {
    const result = await run(command, args, { allowFailure: true });
    return result.code === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

function currentAssetName() {
  let platform = process.platform;
  let arch = process.arch;
  if (platform === "win32" && arch === "ia32") {
    arch = "x86";
  }
  if (platform === "linux") {
    const report = process.report?.getReport?.();
    const glibc = report?.header?.glibcVersionRuntime;
    platform = glibc ? "linux" : "linuxmusl";
  }
  const name = `node-datachannel-v${PACKAGE.version}-napi-v${PACKAGE.napiVersion}-${platform}-${arch}.tar.gz`;
  assert.ok(
    Object.hasOwn(EXPECTED_ASSETS, name),
    `the current target has no published candidate asset: ${platform}-${arch}`,
  );
  return name;
}

async function sourceInventory() {
  const nodeTag = await fetchJson(
    `https://api.github.com/repos/murat-dogan/node-datachannel/git/ref/tags/v${PACKAGE.version}`,
    apiHeaders,
  );
  assert.equal(nodeTag.object.type, "commit");
  assert.equal(nodeTag.object.sha, PACKAGE.sourceCommit);

  const libTagRef = await fetchJson(
    `https://api.github.com/repos/paullouisageneau/libdatachannel/git/ref/tags/v${PACKAGE.libdatachannelVersion}`,
    apiHeaders,
  );
  assert.equal(libTagRef.object.type, "tag");
  const libTag = await fetchJson(libTagRef.object.url, apiHeaders);
  assert.equal(libTag.object.type, "commit");
  assert.equal(libTag.object.sha, PACKAGE.libdatachannelCommit);

  const wrapperCmake = (
    await fetchBuffer(
      `https://raw.githubusercontent.com/murat-dogan/node-datachannel/${PACKAGE.sourceCommit}/CMakeLists.txt`,
    )
  ).toString("utf8");
  assert.match(
    wrapperCmake,
    new RegExp(
      `GIT_TAG "v${PACKAGE.libdatachannelVersion.replaceAll(".", "\\.")}"`,
    ),
  );
  assert.match(wrapperCmake, /set\(OPENSSL_USE_STATIC_LIBS TRUE\)/);
  assert.match(wrapperCmake, /option\(NO_MEDIA .* OFF\)/);
  assert.match(wrapperCmake, /option\(NO_WEBSOCKET .* OFF\)/);

  const libTree = await fetchJson(
    `https://api.github.com/repos/paullouisageneau/libdatachannel/git/trees/${PACKAGE.libdatachannelCommit}?recursive=1`,
    apiHeaders,
  );
  assert.equal(libTree.truncated, false);
  const submodules = Object.fromEntries(
    libTree.tree
      .filter((entry) => entry.mode === "160000")
      .map((entry) => [entry.path, entry.sha])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  assert.deepEqual(submodules, EXPECTED_SUBMODULES);

  const workflowResponse = await fetchJson(
    `https://api.github.com/repos/murat-dogan/node-datachannel/actions/runs?head_sha=${PACKAGE.sourceCommit}&per_page=100`,
    apiHeaders,
  );
  const releaseRuns = [];
  for (const [id, expectedName] of Object.entries(EXPECTED_RELEASE_RUNS)) {
    const workflow = workflowResponse.workflow_runs.find(
      (candidate) => candidate.id === Number(id),
    );
    assert.ok(workflow, `release workflow run is missing: ${id}`);
    assert.equal(workflow.name, expectedName);
    assert.equal(workflow.event, "workflow_dispatch");
    assert.equal(workflow.head_sha, PACKAGE.sourceCommit);
    assert.equal(workflow.status, "completed");
    assert.equal(workflow.conclusion, "success");
    releaseRuns.push({
      id: workflow.id,
      name: workflow.name,
      sourceCommit: workflow.head_sha,
      startedAt: workflow.run_started_at,
      completedAt: workflow.updated_at,
      workflow: workflow.path,
      url: workflow.html_url,
    });
  }

  return {
    wrapper: {
      tag: `v${PACKAGE.version}`,
      tagType: nodeTag.object.type,
      commit: nodeTag.object.sha,
    },
    libdatachannel: {
      tag: `v${PACKAGE.libdatachannelVersion}`,
      tagType: libTagRef.object.type,
      tagObject: libTagRef.object.sha,
      commit: libTag.object.sha,
    },
    buildConfiguration: {
      opensslStatic: true,
      mediaEnabled: true,
      websocketEnabled: true,
    },
    submodules,
    releaseRuns,
  };
}

async function registryInventory(workspace) {
  const metadata = await fetchJson(
    `https://registry.npmjs.org/${PACKAGE.name}/${PACKAGE.version}`,
  );
  assert.equal(metadata.name, PACKAGE.name);
  assert.equal(metadata.version, PACKAGE.version);
  assert.equal(metadata.dist.integrity, PACKAGE.npmIntegrity);
  assert.equal(metadata.dist.shasum, PACKAGE.npmSha1);

  const tarball = await fetchBuffer(metadata.dist.tarball);
  assert.equal(sri(tarball), PACKAGE.npmIntegrity);
  assert.equal(sha(tarball, "sha1"), PACKAGE.npmSha1);
  const tarballPath = join(workspace, `${PACKAGE.name}-${PACKAGE.version}.tgz`);
  await writeFile(tarballPath, tarball);
  const listing = (await run("tar", ["-tzf", tarballPath])).stdout
    .trim()
    .split("\n")
    .filter(Boolean);
  const licenseFiles = listing.filter((path) =>
    /(^|\/)(license|copying|notice)(\.|$)/i.test(path),
  );
  assert.deepEqual(licenseFiles, ["package/LICENSE"]);

  return {
    integrity: metadata.dist.integrity,
    sha1: metadata.dist.shasum,
    signatures: metadata.dist.signatures ?? [],
    attestations: metadata._attestations ?? null,
    provenance: metadata._provenance ?? null,
    fileCount: metadata.dist.fileCount,
    unpackedSize: metadata.dist.unpackedSize,
    maintainers: metadata.maintainers ?? [],
    licenseFiles,
  };
}

async function installInventory(workspace) {
  const project = join(workspace, "isolated-install");
  await mkdir(project);
  await writeFile(
    join(project, "package.json"),
    `${JSON.stringify(
      {
        name: "terminay-node-datachannel-inventory",
        private: true,
        version: "0.0.0",
      },
      null,
      2,
    )}\n`,
  );
  const install = await run(
    "npm",
    [
      "install",
      "--save-exact",
      "--ignore-scripts=false",
      "--no-audit",
      "--no-fund",
      `${PACKAGE.name}@${PACKAGE.version}`,
    ],
    { cwd: project },
  );
  const auditResult = await run("npm", ["audit", "--omit=dev", "--json"], {
    cwd: project,
    allowFailure: true,
  });
  const audit = JSON.parse(auditResult.stdout);

  const packageDirectory = join(project, "node_modules", PACKAGE.name);
  const installedPackage = JSON.parse(
    await readFile(join(packageDirectory, "package.json"), "utf8"),
  );
  assert.equal(installedPackage.version, PACKAGE.version);
  const binaries = await findFiles(packageDirectory, (path) =>
    path.endsWith(".node"),
  );
  assert.equal(binaries.length, 1);
  const binary = await readFile(binaries[0]);

  const libraryVersion = (
    await run(
      process.execPath,
      [
        "-e",
        `process.stdout.write(require(${JSON.stringify(
          PACKAGE.name,
        )}).getLibraryVersion())`,
      ],
      { cwd: project },
    )
  ).stdout;
  assert.equal(libraryVersion, PACKAGE.libdatachannelVersion);

  const lock = JSON.parse(
    await readFile(join(project, "package-lock.json"), "utf8"),
  );
  const dependencies = Object.entries(lock.packages)
    .filter(([path]) => path.startsWith("node_modules/"))
    .map(([path, value]) => ({
      name: basename(path),
      version: value.version,
      license: value.license ?? null,
      integrity: value.integrity ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    project,
    installWarnings: install.stderr
      .split("\n")
      .filter((line) => line.toLowerCase().includes("warn")),
    auditExitCode: auditResult.code,
    audit: audit.metadata?.vulnerabilities ?? null,
    dependencies,
    binaryPath: binaries[0],
    binarySha256: sha(binary),
    embeddedVersions: embeddedVersions(binary),
    embeddedSecuritySymbols: embeddedSecuritySymbols(binary),
    libraryVersion,
  };
}

async function inspectReleaseAsset(asset, expected, workspace) {
  const archive = await fetchBuffer(asset.browser_download_url);
  assert.equal(sha(archive), expected.archiveSha256);
  assert.equal(asset.digest, `sha256:${expected.archiveSha256}`);
  const archivePath = join(workspace, asset.name);
  await writeFile(archivePath, archive);

  const entries = (await run("tar", ["-tzf", archivePath])).stdout
    .trim()
    .split("\n")
    .filter(Boolean);
  assert.deepEqual(entries, ["build/Release/node_datachannel.node"]);
  const extractDirectory = join(workspace, `${asset.name}.unpacked`);
  await mkdir(extractDirectory);
  await run("tar", ["-xzf", archivePath, "-C", extractDirectory]);
  const binaryPath = join(
    extractDirectory,
    "build",
    "Release",
    "node_datachannel.node",
  );
  const binary = await readFile(binaryPath);
  assert.equal(sha(binary), expected.binarySha256);
  const versions = embeddedVersions(binary);
  assert.equal(versions.openssl, expected.openssl);
  if (expected.libsrtp !== null) {
    assert.equal(versions.libsrtp, expected.libsrtp);
  }

  const fileDescription = await optionalTool("file", ["-b", binaryPath]);
  const macUuidOutput = asset.name.includes("-darwin-")
    ? await optionalTool("dwarfdump", ["--uuid", binaryPath])
    : null;
  const macUuid = macUuidOutput?.match(/UUID: ([A-F0-9-]+)/)?.[1] ?? null;
  const dependencyOutput = asset.name.includes("-darwin-")
    ? await optionalTool("otool", ["-L", binaryPath])
    : await optionalTool("objdump", ["-p", binaryPath]);
  const dynamicDependencies = dependencyOutput
    ? asset.name.includes("-darwin-")
      ? dependencyOutput
          .split("\n")
          .slice(1)
          .map((line) => line.trim().split(/\s+/)[0])
          .filter(Boolean)
      : [
          ...dependencyOutput.matchAll(/(?:NEEDED\s+|DLL Name:\s*)([^\s]+)/g),
        ].map((match) => match[1])
    : null;
  const buildId =
    fileDescription?.match(/BuildID\[sha1\]=([a-f0-9]+)/)?.[1] ?? null;
  const peTimestamp =
    dependencyOutput?.match(/Time\/Date\s+([^\n]+)/)?.[1]?.trim() ?? null;

  return {
    name: asset.name,
    size: asset.size,
    archiveSha256: expected.archiveSha256,
    binarySha256: expected.binarySha256,
    embeddedVersions: versions,
    embeddedSecuritySymbols: embeddedSecuritySymbols(binary),
    fileDescription,
    buildId,
    macUuid,
    peTimestamp,
    dynamicDependencies:
      dynamicDependencies === null
        ? null
        : [...new Set(dynamicDependencies)].sort(),
  };
}

async function releaseInventory(workspace, allAssets) {
  const release = await fetchJson(
    `https://api.github.com/repos/murat-dogan/node-datachannel/releases/tags/v${PACKAGE.version}`,
    apiHeaders,
  );
  const actual = Object.fromEntries(
    release.assets.map((asset) => [
      asset.name,
      asset.digest?.replace(/^sha256:/, "") ?? null,
    ]),
  );
  const expected = Object.fromEntries(
    Object.entries(EXPECTED_ASSETS).map(([name, value]) => [
      name,
      value.archiveSha256,
    ]),
  );
  assert.deepEqual(actual, expected);

  const selectedNames = allAssets
    ? Object.keys(EXPECTED_ASSETS)
    : [currentAssetName()];
  const assets = [];
  for (const name of selectedNames) {
    const asset = release.assets.find((candidate) => candidate.name === name);
    assert.ok(asset, `release asset is missing: ${name}`);
    assets.push(
      await inspectReleaseAsset(asset, EXPECTED_ASSETS[name], workspace),
    );
  }
  return {
    releaseId: release.id,
    tag: release.tag_name,
    publishedAt: release.published_at,
    matrix: Object.keys(EXPECTED_ASSETS),
    inspectedAssets: assets,
  };
}

async function main() {
  const allAssets = process.argv.includes("--all-assets");
  const unexpected = process.argv
    .slice(2)
    .filter((value) => value !== "--all-assets");
  assert.deepEqual(
    unexpected,
    [],
    `unknown arguments: ${unexpected.join(", ")}`,
  );

  const workspace = await mkdtemp(
    join(tmpdir(), "terminay-node-datachannel-inventory-"),
  );
  try {
    const [source, registry] = await Promise.all([
      sourceInventory(),
      registryInventory(workspace),
    ]);
    const installed = await installInventory(workspace);
    const release = await releaseInventory(workspace, allAssets);
    const installedAsset = release.inspectedAssets.find(
      (asset) => asset.name === currentAssetName(),
    );
    if (installedAsset) {
      assert.equal(installed.binarySha256, installedAsset.binarySha256);
      assert.deepEqual(
        installed.embeddedVersions,
        installedAsset.embeddedVersions,
      );
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          package: PACKAGE,
          source,
          registry,
          installed: {
            ...installed,
            project: relative(workspace, installed.project),
            binaryPath: relative(workspace, installed.binaryPath),
          },
          release,
          scope: {
            npmAudit:
              "JavaScript package dependency advisories known to the npm registry",
            notCoveredByNpmAudit: [
              "the statically linked OpenSSL implementation",
              "libdatachannel and its C/C++ submodules",
              "native release provenance, signatures, and source correspondence",
            ],
          },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

await main();
