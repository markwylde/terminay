import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildSecureWeriftCandidate,
  packSecureWeriftCandidate,
  RETAINED_RUNTIME_PACKAGES,
  verifySecureWeriftCandidate,
  WERIFT_CANDIDATE_VERSION,
  WERIFT_GIT_HEAD,
  WERIFT_TARBALL_SHA512,
  WERIFT_TURN_REFRESH_PATCH_SHA256,
  WERIFT_VERSION,
} from './build-secure-werift-candidate.mjs'

function assertRequestedRuntimeTarget() {
  const expectedArch = process.env.TERMINAY_PROOF_EXPECT_ARCH
  if (!expectedArch) return
  assert.equal(
    process.platform,
    'linux',
    'TERMINAY_PROOF_EXPECT_ARCH is supported only by the clean Linux runtime lanes.',
  )
  assert.ok(
    expectedArch === 'x64' || expectedArch === 'arm64',
    'TERMINAY_PROOF_EXPECT_ARCH must be x64 or arm64.',
  )
  assert.equal(
    process.arch,
    expectedArch,
    'The executing Node architecture must match TERMINAY_PROOF_EXPECT_ARCH.',
  )
  assert.equal(process.env.DISPLAY, undefined, 'The runtime proof must not inherit DISPLAY.')
  assert.equal(
    process.env.WAYLAND_DISPLAY,
    undefined,
    'The runtime proof must not inherit WAYLAND_DISPLAY.',
  )
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stderr = []
    const stdout = []
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${command} ${args.join(' ')} timed out.`))
    }, options.timeoutMs ?? 300_000)
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolve({
        code,
        signal,
        stderr: Buffer.concat(stderr).toString(),
        stdout: Buffer.concat(stdout).toString(),
      })
    })
  })
}

async function proveNode22Runtime(buildRoot) {
  const upstreamProof = await readFile(
    path.join(process.cwd(), 'scripts', 'spikes', 'headless-webrtc-werift.mjs'),
    'utf8',
  )
  const candidateProof = upstreamProof
    .replace("from 'werift'", "from '@terminay/werift-runtime-proof'")
    .replace(
      "import.meta.resolve('werift')",
      "import.meta.resolve('@terminay/werift-runtime-proof')",
    )
  assert.notEqual(candidateProof, upstreamProof)
  const proofPath = path.join(buildRoot, 'candidate-node22-proof.mjs')
  await writeFile(proofPath, candidateProof)
  const result = await run(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['--yes', '--package=node@22.23.1', '--', 'node', proofPath],
    { cwd: buildRoot, timeoutMs: 60_000 },
  )
  assert.equal(result.signal, null)
  assert.equal(result.code, 0, result.stderr || result.stdout)
  const output = JSON.parse(result.stdout)
  assert.equal(output.weriftVersion, WERIFT_CANDIDATE_VERSION)
  assert.equal(
    output.activeResourcesAfterClose.some((name) => /Socket|Timeout/i.test(name)),
    false,
  )
  assert.ok(output.closeDurationMs < 5_000)
  return output
}

async function proveElectronMainAndChildImport(buildRoot) {
  const candidateUrl = new URL(
    `file://${path.join(
      buildRoot,
      'node_modules',
      '@terminay',
      'werift-runtime-proof',
      'lib',
      'index.mjs',
    )}`,
  ).href
  const childProbe = path.join(buildRoot, 'electron-child-import.mjs')
  const mainProbe = path.join(buildRoot, 'electron-main-import.cjs')
  await writeFile(
    childProbe,
    "const runtime = await import(process.argv[2]);\n"
      + "if (typeof runtime.RTCPeerConnection !== 'function') process.exit(2);\n"
      + "process.stdout.write('electron-child-import-ok\\n');\n",
  )
  await writeFile(
    mainProbe,
    "const { app } = require('electron');\n"
      + "const { spawn } = require('node:child_process');\n"
      + "(async () => {\n"
      + "  const runtime = await import(process.argv[2]);\n"
      + "  if (typeof runtime.RTCPeerConnection !== 'function') throw new Error('main import failed');\n"
      + "  const child = spawn(process.execPath, [process.argv[3], process.argv[2]], {\n"
      + "    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },\n"
      + "    stdio: ['ignore', 'pipe', 'pipe'],\n"
      + "  });\n"
      + "  const stdout = []; const stderr = [];\n"
      + "  child.stdout.on('data', chunk => stdout.push(chunk));\n"
      + "  child.stderr.on('data', chunk => stderr.push(chunk));\n"
      + "  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);\n"
      + "  const code = await new Promise((resolve, reject) => {\n"
      + "    child.once('error', reject); child.once('exit', resolve);\n"
      + "  });\n"
      + "  clearTimeout(timeout);\n"
      + "  if (code !== 0) throw new Error(Buffer.concat(stderr).toString());\n"
      + "  if (!Buffer.concat(stdout).toString().includes('electron-child-import-ok')) throw new Error('child import missing');\n"
      + "  process.stdout.write('electron-main-and-child-import-ok\\n');\n"
      + "  app.exit(0);\n"
      + "})().catch(error => { console.error(error); app.exit(1); });\n",
  )
  const electronExecutable = path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron',
  )
  const args = process.platform === 'linux'
    ? ['--no-sandbox', mainProbe, candidateUrl, childProbe]
    : [mainProbe, candidateUrl, childProbe]
  const result = await run(electronExecutable, args, {
    cwd: buildRoot,
    timeoutMs: 30_000,
  })
  assert.equal(result.signal, null)
  assert.equal(result.code, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /electron-main-and-child-import-ok/)
}

async function proveArchiveIsSelfContained(testRoot, archive) {
  const isolatedRoot = path.join(testRoot, 'isolated-archive')
  await mkdir(isolatedRoot)
  const archivePath = path.join(isolatedRoot, archive.filename)
  await writeFile(archivePath, archive.bytes)
  const extracted = await run('tar', ['-xzf', archivePath, '-C', isolatedRoot])
  assert.equal(extracted.signal, null)
  assert.equal(extracted.code, 0, extracted.stderr || extracted.stdout)

  const packageRoot = path.join(isolatedRoot, 'package')
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies, undefined)
  const imported = await run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "const runtime = await import('./package/lib/index.mjs');"
        + "if (typeof runtime.RTCPeerConnection !== 'function') process.exit(2);"
        + "process.stdout.write('self-contained-runtime-ok\\n');",
    ],
    {
      cwd: isolatedRoot,
      env: {
        PATH: process.env.PATH,
      },
    },
  )
  assert.equal(imported.signal, null)
  assert.equal(imported.code, 0, imported.stderr || imported.stdout)
  assert.match(imported.stdout, /self-contained-runtime-ok/u)
}

test('a minimized Werift candidate is deterministic, auditable, and importable', {
  timeout: 360_000,
}, async (t) => {
  assertRequestedRuntimeTarget()
  const testRoot = await mkdtemp(
    path.join(os.tmpdir(), 'terminay-secure-werift-candidate-'),
  )
  try {
    const first = await buildSecureWeriftCandidate(path.join(testRoot, 'first'))
    const second = await buildSecureWeriftCandidate(path.join(testRoot, 'second'))
    assert.deepEqual(first.fileHashes, second.fileHashes)
    const stagedRuntimeRoot = path.join(testRoot, 'staged-selected-runtime')
    await mkdir(stagedRuntimeRoot, { recursive: true })
    await cp(
      path.resolve('build/webrtc-runtime/selection.json'),
      path.join(stagedRuntimeRoot, 'selection.json'),
    )
    await cp(first.artifactRoot, path.join(stagedRuntimeRoot, 'artifact'), {
      recursive: true,
      dereference: false,
    })
    const stagedSelection = JSON.parse(
      await readFile(path.join(stagedRuntimeRoot, 'selection.json'), 'utf8'),
    )
    const stagedPackage = JSON.parse(
      await readFile(path.join(stagedRuntimeRoot, 'artifact', 'package.json'), 'utf8'),
    )
    assert.equal(stagedSelection.runtime, 'secure-werift')
    assert.equal(stagedSelection.runtimePolicy?.fallback, 'disabled')
    assert.equal(stagedSelection.package?.version, WERIFT_CANDIDATE_VERSION)
    assert.deepEqual(stagedSelection.patches, [{
      path: 'scripts/patches/werift-0.24.1-abort-turn-refresh.patch',
      purpose: 'Abort the pending TURN allocation refresh timer during peer close.',
      sha256: WERIFT_TURN_REFRESH_PATCH_SHA256,
    }])
    assert.deepEqual(stagedSelection.package, {
      name: stagedPackage.name,
      version: stagedPackage.version,
    })
    await verifySecureWeriftCandidate(path.join(stagedRuntimeRoot, 'artifact'))
    const firstArchive = await packSecureWeriftCandidate(first.artifactRoot)
    const secondArchive = await packSecureWeriftCandidate(second.artifactRoot)
    assert.equal(firstArchive.filename, secondArchive.filename)
    assert.equal(firstArchive.integrity, secondArchive.integrity)
    assert.deepEqual(firstArchive.bytes, secondArchive.bytes)
    await proveArchiveIsSelfContained(testRoot, firstArchive)

    const expectedFiles = [
      'RUNTIME-LOCK.json',
      'MEDIA_SURFACE_POLICY.md',
      'SHA256SUMS',
      'SOURCE-CORRESPONDENCE.json',
      'SOURCE_MAP_POLICY.md',
      'THIRD_PARTY_NOTICES.md',
      'lib/index.mjs',
      'package.json',
      'provenance.intoto.json',
      'sbom.cdx.json',
      `LICENSES/werift-${WERIFT_VERSION}.txt`,
      ...Object.entries(RETAINED_RUNTIME_PACKAGES).map(([installPath, [version]]) =>
        `LICENSES/${installPath
          .replaceAll('node_modules/', '')
          .replaceAll('@', '')
          .replaceAll('/', '__')}-${version}.txt`
      ),
    ].sort()
    assert.deepEqual(Object.keys(first.fileHashes).sort(), expectedFiles)
    const candidateManifest = JSON.parse(await readFile(
      path.join(first.artifactRoot, 'package.json'),
      'utf8',
    ))
    assert.equal(candidateManifest.dependencies, undefined)
    const mediaPolicy = await readFile(
      path.join(first.artifactRoot, 'MEDIA_SURFACE_POLICY.md'),
      'utf8',
    )
    assert.match(mediaPolicy, /only key is `RTCPeerConnection`/u)
    assert.match(mediaPolicy, /failed the full Chromium data-channel connection proof twice/u)

    const provenance = JSON.parse(await readFile(
      path.join(first.artifactRoot, 'provenance.intoto.json'),
      'utf8',
    ))
    assert.equal(provenance._type, 'https://in-toto.io/Statement/v1')
    assert.equal(provenance.predicateType, 'https://slsa.dev/provenance/v1')
    assert.equal(
      provenance.predicate.buildDefinition.buildType,
      'https://terminay.com/builds/secure-werift-candidate/v1',
    )
    assert.equal(
      provenance.predicate.runDetails.metadata.invocationId,
      `secure-werift-${WERIFT_CANDIDATE_VERSION}`,
    )
    assert.deepEqual(
      provenance.subject.map(({ name, digest }) => [name, digest.sha256]),
      Object.entries(first.fileHashes)
        .filter(([name]) => name !== 'SHA256SUMS' && name !== 'provenance.intoto.json')
        .sort(([left], [right]) => left.localeCompare(right)),
    )
    assert.equal(
      provenance.predicate.buildDefinition.resolvedDependencies[0].digest.sha512,
      WERIFT_TARBALL_SHA512,
    )
    await verifySecureWeriftCandidate(first.artifactRoot)

    const tamperedArtifact = path.join(testRoot, 'tampered')
    await cp(first.artifactRoot, tamperedArtifact, { recursive: true })
    await writeFile(path.join(tamperedArtifact, 'lib', 'index.mjs'), 'export const tampered = true\n')
    await assert.rejects(
      () => verifySecureWeriftCandidate(tamperedArtifact),
      /Candidate payload checksum mismatch/u,
    )

    const malformedChecksums = path.join(testRoot, 'malformed-checksums')
    await cp(first.artifactRoot, malformedChecksums, { recursive: true })
    await writeFile(path.join(malformedChecksums, 'SHA256SUMS'), 'not-a-checksum\n')
    await assert.rejects(
      () => verifySecureWeriftCandidate(malformedChecksums),
      /Malformed candidate checksum row/u,
    )

    const extraPayload = path.join(testRoot, 'extra-payload')
    await cp(first.artifactRoot, extraPayload, { recursive: true })
    await writeFile(path.join(extraPayload, 'unexpected.txt'), 'unreviewed payload\n')
    await assert.rejects(
      () => verifySecureWeriftCandidate(extraPayload),
      /Candidate checksum manifest must cover exactly every non-manifest file/u,
    )

    const symlinkedPayload = path.join(testRoot, 'symlinked-payload')
    await cp(first.artifactRoot, symlinkedPayload, { recursive: true })
    const symlinkTarget = path.join(testRoot, 'outside-candidate.mjs')
    await writeFile(symlinkTarget, 'outside candidate\n')
    await unlink(path.join(symlinkedPayload, 'lib', 'index.mjs'))
    await symlink(symlinkTarget, path.join(symlinkedPayload, 'lib', 'index.mjs'))
    await assert.rejects(
      () => verifySecureWeriftCandidate(symlinkedPayload),
      /Candidate artifacts cannot contain symlinks/u,
    )

    const provenanceMismatch = path.join(testRoot, 'provenance-mismatch')
    await cp(first.artifactRoot, provenanceMismatch, { recursive: true })
    const provenancePath = path.join(provenanceMismatch, 'provenance.intoto.json')
    const alteredProvenance = JSON.parse(await readFile(provenancePath, 'utf8'))
    alteredProvenance.predicate.runDetails.builder.id = 'https://example.invalid/tampered'
    await writeFile(provenancePath, `${JSON.stringify(alteredProvenance, null, 2)}\n`)
    const alteredProvenanceHash = createHash('sha256')
      .update(await readFile(provenancePath))
      .digest('hex')
    const checksumPath = path.join(provenanceMismatch, 'SHA256SUMS')
    const amendedChecksums = (await readFile(checksumPath, 'utf8')).replace(
      /^[a-f0-9]{64} {2}provenance\.intoto\.json$/mu,
      `${alteredProvenanceHash}  provenance.intoto.json`,
    )
    await writeFile(checksumPath, amendedChecksums)
    await assert.rejects(
      () => verifySecureWeriftCandidate(provenanceMismatch),
      /Candidate provenance must exactly bind the reviewed payload and materials/u,
    )

    const audit = await run(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['audit', '--omit=dev', '--audit-level=high', '--json'],
      { cwd: first.auditRoot, timeoutMs: 120_000 },
    )
    assert.equal(audit.signal, null)
    assert.equal(audit.code, 0, audit.stderr || audit.stdout)
    const auditReport = JSON.parse(audit.stdout)
    assert.equal(auditReport.metadata.vulnerabilities.critical, 0)
    assert.equal(auditReport.metadata.vulnerabilities.high, 0)

    const node22 = await proveNode22Runtime(first.auditRoot)
    const runtimeOnly = process.env.TERMINAY_RUNTIME_ONLY === '1'
    if (runtimeOnly) {
      process.stdout.write(`secure-werift-candidate=${JSON.stringify({
        arch: process.arch,
        artifactFiles: expectedFiles.length,
        audit: auditReport.metadata.vulnerabilities,
        gitHead: WERIFT_GIT_HEAD,
        node22CloseDurationMs: node22.closeDurationMs,
        platform: process.platform,
        retainedPackages: Object.keys(RETAINED_RUNTIME_PACKAGES).length,
        runtimeOnly: true,
        tarballSha512: WERIFT_TARBALL_SHA512,
        version: WERIFT_VERSION,
      })}\n`)
      return
    }
    await proveElectronMainAndChildImport(first.auditRoot)

    const routeOnly = process.env.TERMINAY_TURN_ROUTE_ONLY === '1'
    const siblingBridgeProof =
      process.env.TERMINAY_RUN_SIBLING_WEBRTC_BRIDGE_PROOF === '1'
    const playwrightSpecs = []
    if (!routeOnly && siblingBridgeProof) {
      playwrightSpecs.push('e2e/webrtc-headless-node-host.spec.ts')
    } else if (!routeOnly) {
      await t.test('sibling peer-owner canonical browser bridge proof', {
        skip: 'requires TERMINAY_RUN_SIBLING_WEBRTC_BRIDGE_PROOF=1 and a sibling terminay.com peer owner that installs the ticket-bound four-channel bridge',
      }, () => {})
    }
    if (process.env.TERMINAY_TURN_CONFIG_PATH) {
      playwrightSpecs.push('e2e/webrtc-production-turn-routes.spec.ts')
    }
    if (playwrightSpecs.length > 0) {
      const playwrightArguments = [
        'playwright',
        'test',
        ...playwrightSpecs,
        '--workers=1',
        '--reporter=line',
      ]
      // The direct-LAN interoperability proof deliberately exposes Chromium's
      // numeric host candidates. This models the supported same-network path
      // where both peers can route to one another without a relay. The separate
      // TURN-only proof retains Chromium's default mDNS privacy behavior.
      if (!routeOnly) {
        playwrightArguments.push(
          '--config=scripts/support/playwright-headless-webrtc-linux.config.mjs',
        )
      }
      const proof = await run(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        playwrightArguments,
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            TERMINAY_HOSTED_SERVER_REPO:
              process.env.TERMINAY_HOSTED_SERVER_REPO ??
              path.resolve(process.cwd(), '../terminay.com-headless-webrtc-security'),
            TERMINAY_WEBRTC_SPIKE_ROOT: first.auditRoot,
            TERMINAY_WEBRTC_SPIKE_RUNTIME: 'werift',
            TERMINAY_WEBRTC_STAGED_RUNTIME_ROOT: path.join(
              stagedRuntimeRoot,
              'artifact',
            ),
          },
          timeoutMs: 300_000,
        },
      )
      assert.equal(proof.signal, null)
      assert.equal(proof.code, 0, `${proof.stdout}\n${proof.stderr}`)
      assert.match(
        proof.stdout,
        routeOnly
          ? /2 passed/
          : process.env.TERMINAY_TURN_CONFIG_PATH
            ? /3 passed/
            : /Chromium pairs, reconnects, and revokes through a plain-Node werift host[\s\S]*1 passed/,
      )
      assert.doesNotMatch(proof.stdout, /electron/i)
    }

    process.stdout.write(`secure-werift-candidate=${JSON.stringify({
      artifactFiles: expectedFiles.length,
      audit: auditReport.metadata.vulnerabilities,
      gitHead: WERIFT_GIT_HEAD,
      node22CloseDurationMs: node22.closeDurationMs,
      retainedPackages: Object.keys(RETAINED_RUNTIME_PACKAGES).length,
      routeTests: process.env.TERMINAY_TURN_CONFIG_PATH ? 2 : 0,
      runtimeOnly: false,
      tarballSha512: WERIFT_TARBALL_SHA512,
      version: WERIFT_VERSION,
    })}\n`)
  } finally {
    await rm(testRoot, { force: true, recursive: true })
  }
})
