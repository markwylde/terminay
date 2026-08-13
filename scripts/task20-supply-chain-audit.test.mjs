import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { auditSupplyChain, createSpdx } from './task20-supply-chain-audit.mjs'

test('repository dependency audit produces deterministic SBOM and native metadata', async () => {
  const first = await auditSupplyChain(process.cwd())
  const second = await auditSupplyChain(process.cwd())
  assert.deepEqual(first, second)
  assert.equal(first.lockfileVersion, 3)
  assert.ok(first.downloadedDependencyCount > 0)
  assert.ok(first.native.some((entry) => entry.name === 'electron'))
  assert.deepEqual(first.unresolved.integrity, [])
  assert.deepEqual(first.unresolved.license, [])
  assert.equal(first.sbom.spdxVersion, 'SPDX-2.3')
  assert.equal(first.sbom.packages.length, first.dependencyCount)
})

test('dependency audit fails closed when a downloaded package loses integrity or license evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-task20-supply-chain-'))
  try {
    await mkdir(join(root, 'node_modules/demo-package'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))
    await writeFile(join(root, 'node_modules/demo-package/package.json'), JSON.stringify({ name: 'demo-package', version: '1.0.0' }))
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({
      name: 'fixture',
      version: '1.0.0',
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '1.0.0' },
        'node_modules/demo-package': { version: '1.0.0', resolved: 'https://registry.npmjs.org/demo-package/-/demo-package-1.0.0.tgz' },
      },
    }))
    await assert.rejects(() => auditSupplyChain(root), /metadata is incomplete/)
    const report = await auditSupplyChain(root, { failOnUnresolved: false })
    assert.deepEqual(report.unresolved.integrity, ['node_modules/demo-package'])
    assert.deepEqual(report.unresolved.license, ['node_modules/demo-package'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bundled npm dependencies inherit the verified carrier archive evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-task20-bundled-supply-chain-'))
  try {
    await mkdir(join(root, 'node_modules/npm/node_modules/bundled-package'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))
    await writeFile(join(root, 'node_modules/npm/node_modules/bundled-package/package.json'), JSON.stringify({
      name: 'bundled-package',
      version: '2.0.0',
      license: 'MIT',
    }))
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({
      name: 'fixture',
      version: '1.0.0',
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '1.0.0' },
        'node_modules/npm': {
          version: '12.0.2',
          resolved: 'https://registry.npmjs.org/npm/-/npm-12.0.2.tgz',
          integrity: 'sha512-ZA==',
          license: 'Artistic-2.0',
          bundleDependencies: ['bundled-package'],
        },
        'node_modules/npm/node_modules/bundled-package': {
          version: '2.0.0',
          inBundle: true,
          license: 'MIT',
        },
      },
    }))

    const report = await auditSupplyChain(root)
    const bundled = report.sbom.packages.find((entry) => entry.name === 'bundled-package')
    assert.ok(bundled)
    assert.deepEqual(report.unresolved.integrity, [])
    assert.equal(report.downloadedDependencyCount, 1)

    const lockfile = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
    delete lockfile.packages['node_modules/npm'].integrity
    await writeFile(join(root, 'package-lock.json'), JSON.stringify(lockfile))
    await assert.rejects(() => auditSupplyChain(root), /metadata is incomplete/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('SBOM output is stable for the same package records', () => {
  const entries = [{ path: 'node_modules/demo', name: 'demo', version: '1.0.0', resolved: 'https://registry.example/demo.tgz', integrity: 'sha512-ZA==', license: 'MIT', source: 'registry' }]
  assert.deepEqual(createSpdx(entries, 'fixture'), createSpdx(entries, 'fixture'))
})
