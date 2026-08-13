import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createReleaseManifest, createSbom, inspectReleaseInputs, writeReleaseEvidence } from './release-readiness.mjs'

test('release evidence is deterministic and records native/runtime provenance', async () => {
  const inputs = await inspectReleaseInputs()
  const first = createSbom(inputs)
  const second = createSbom(inputs)
  assert.deepEqual(first, second)
  const manifest = createReleaseManifest(inputs, first)
  assert.equal(manifest.lockfileVersion, 3)
  assert.ok(manifest.nativePackages.some((name) => name.includes('node-pty')))
	assert.match(manifest.provenance.nativeRuntime, /build-standalone-server-artifact/)
  assert.match(manifest.provenance.webrtcRuntime, /build-secure-werift/)
  assert.ok(manifest.dependencyEvidence.packageCount > 0)
  assert.ok(manifest.dependencyEvidence.integrityCoverage > 0)
  assert.ok(manifest.dependencyEvidence.licenseCoverage > 0)
  assert.equal(manifest.importBoundaryEvidence.violationCount, 0)
  assert.equal(manifest.importBoundaryEvidence.checker, 'scripts/check-workspace-boundaries.mjs')
  assert.match(manifest.importBoundaryEvidence.sha256, /^[a-f0-9]{64}$/u)
  const downloaded = first.packages.find((entry) => entry.downloadLocation !== 'NOASSERTION')
  assert.ok(downloaded)
  assert.equal(downloaded.checksums?.[0]?.algorithm, 'SHA512')
  assert.match(downloaded.licenseDeclared, /.+/)
})

test('release evidence writes an SBOM and manifest without timestamps or secrets', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'terminay-release-'))
  try {
    const evidence = await writeReleaseEvidence(process.cwd(), outputDir)
    const sbom = await readFile(join(outputDir, 'sbom.spdx.json'), 'utf8')
    const manifest = await readFile(join(outputDir, 'release-manifest.json'), 'utf8')
    assert.match(sbom, /SPDX-2\.3/)
    assert.match(manifest, /sourceCorrespondence/)
    assert.equal(sbom.includes('OPENROUTER_API_KEY'), false)
    assert.equal(evidence.manifest.sbomSha256.length, 64)
    assert.equal(evidence.manifest.importBoundaryEvidence.violationCount, 0)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
})

test('standalone operations runbook documents paths, network trust, recovery, and foreground supervisors', async () => {
  const runbook = await readFile(join(process.cwd(), 'specs/operations/standalone-server.md'), 'utf8')
  assert.match(runbook, /configuration and paths/i)
  assert.match(runbook, /TERMINAY_DATA_ROOT/)
  assert.match(runbook, /TERMINAY_LOG_SINK/)
  assert.match(runbook, /firewall/i)
  assert.match(runbook, /STUN\/TURN/i)
  assert.match(runbook, /pairing/i)
  assert.match(runbook, /revocation/i)
  assert.match(runbook, /vault/i)
  assert.match(runbook, /backup, restore, upgrades, and incidents/i)
  assert.match(runbook, /systemd/i)
  assert.match(runbook, /launchd/i)
  assert.match(runbook, /foreground/i)
})

test('release workflow keeps readiness, artifact builds, and hosted publication ordered', async () => {
  const release = await readFile(join(process.cwd(), '.github/workflows/trigger-release.yml'), 'utf8')

  const smokeIndex = release.indexOf('  smoke-test:')
  const releaseIndex = release.indexOf('  release:')
  const binariesIndex = release.indexOf('  build-binaries:')
  const standaloneIndex = release.indexOf('  build-standalone-server:')
  const webImageIndex = release.indexOf('  build-web-image:')
  const notesIndex = release.indexOf('  publish-release-notes:')
  assert.ok(smokeIndex >= 0 && smokeIndex < releaseIndex)
  assert.ok(releaseIndex < binariesIndex && binariesIndex < notesIndex)
  assert.ok(releaseIndex < standaloneIndex && standaloneIndex < notesIndex)
  assert.ok(releaseIndex < webImageIndex && webImageIndex < notesIndex)
  assert.match(release.slice(releaseIndex, binariesIndex), /needs: smoke-test/)
  assert.match(release.slice(binariesIndex, notesIndex), /needs: release/)
  assert.match(release.slice(webImageIndex, notesIndex), /needs: release/)
  assert.match(release.slice(notesIndex), /needs: \[release, build-binaries, build-standalone-server, build-web-image\]/)
  assert.match(release.slice(webImageIndex, notesIndex), /ref: \$\{\{ needs\.release\.outputs\.tag \}\}/)
  assert.match(release.slice(webImageIndex, notesIndex), /TERMINAY_SOURCE_REVISION=\$\{\{ needs\.release\.outputs\.source_commit \}\}/)
  assert.match(release.slice(webImageIndex, notesIndex), /echo "\$IMAGE_NAME:\$VERSION"/)
  assert.match(release.slice(webImageIndex, notesIndex), /echo "\$IMAGE_NAME:\$MAJOR_MINOR"/)
  assert.match(release.slice(webImageIndex, notesIndex), /echo "\$IMAGE_NAME:sha-\$EXPECTED_COMMIT"/)
  assert.match(release, /npm run test:hosted-deployment-order/)
  assert.match(release, /npm run test:task20-artifact-contract/)
  assert.match(release, /npm run test:release-readiness/)
  assert.match(release, /npm run test:security-fuzz/)
  assert.match(release, /npm run test:security-boundaries/)
  assert.match(release, /node scripts\/production-dependency-audit\.mjs/)
})
