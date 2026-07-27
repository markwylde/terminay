import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  cp,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

export const WERIFT_VERSION = '0.24.1'
export const WERIFT_GIT_HEAD = '243fd7e24c39fbe03fb855928daddd793fc8d4fa'
export const WERIFT_TARBALL_INTEGRITY =
  'sha512-8Mpf0FWO2pkd9UQyZ0Hb1CcimydlNh8KCvZGD2X/D0ucVY6ubJxX91cndOpTOnPA7wleopop044VSNZeCEwgeA=='
export const WERIFT_TARBALL_SHA512 =
  'f0ca5fd0558eda991df544326741dbd427229b2765361f0a0af6460f65ff0f4b9c558eae6c9c57f7572774ea533a73c0ef095ea29a29d38e1548d65e084c2078'
export const WERIFT_LICENSE_SHA256 =
  'b83683f3f71b5971e6c2e33a8b894a49d752fd24c11b8ae08b53ca20f594fca5'

export const DIRECT_RUNTIME_DEPENDENCIES = {
  '@fidm/x509': '1.2.1',
  '@noble/curves': '1.9.7',
  '@peculiar/x509': '1.14.3',
  '@shinyoshiaki/binary-data': '0.6.1',
  debug: '4.4.0',
  'multicast-dns': '7.2.5',
  tweetnacl: '1.0.3',
}

// The install path is the key because npm retains a second tslib version
// beneath tsyringe. Version, integrity, and declared license are all pinned.
export const RETAINED_RUNTIME_PACKAGES = {
  'node_modules/@fidm/asn1': ['1.0.4', 'sha512-esd1jyNvRb2HVaQGq2Gg8Z0kbQPXzV9Tq5Z14KNIov6KfFD6PTaRIO8UpcsYiTNzOqJpmyzWgVTrUwFV3UF4TQ==', 'MIT'],
  'node_modules/@fidm/x509': ['1.2.1', 'sha512-nwc2iesjyc9hkuzcrMCBXQRn653XuAUKorfWM8PZyJawiy1QzLj4vahwzaI25+pfpwOLvMzbJ0uKpWLDNmo16w==', 'MIT'],
  'node_modules/@leichtgewicht/ip-codec': ['2.0.5', 'sha512-Vo+PSpZG2/fmgmiNzYK9qWRh8h/CHrwD0mo1h1DzL4yzHNSfWYujGTYsWGreD000gcgmZ7K4Ys6Tx9TxtsKdDw==', 'MIT'],
  'node_modules/@noble/curves': ['1.9.7', 'sha512-gbKGcRUYIjA3/zCCNaWDciTMFI0dCkvou3TL8Zmy5Nc7sJ47a0jtOeZoTaMxkuqRo9cRhjOdZJXegxYE5FN/xw==', 'MIT'],
  'node_modules/@noble/hashes': ['1.8.0', 'sha512-jCs9ldd7NwzpgXDIf6P3+NrHh9/sD6CQdxHyjQI+h/6rDNo88ypBxxz45UDuZHz9r3tNz7N/VInSVoVdtXEI4A==', 'MIT'],
  'node_modules/@peculiar/asn1-cms': ['2.8.0', 'sha512-NgekZOrSJFSBFLFoLfwePguAWAx7z1+f2TEsWFUMyiqqfntZ4+S/S5hzqME3q4pCA0iOsFKdwiQ35dwY24eVqA==', 'MIT'],
  'node_modules/@peculiar/asn1-csr': ['2.8.0', 'sha512-akbF8+uvleHs8sejNPQxwmVFuInAg6FMNHOwMILXfP518YfFJwdR3jr6oNUPOaEJfuEhn/vkNOCIT6ASUd4mbg==', 'MIT'],
  'node_modules/@peculiar/asn1-ecc': ['2.8.0', 'sha512-ohwlk+u9Rv2NOAY1c6MfHj45ATVF8R1DUN/WCgABiRtLi2ZftlZWZX7KvpAbU8v9xPcmoILfELeEABj/rn18AQ==', 'MIT'],
  'node_modules/@peculiar/asn1-pfx': ['2.8.0', 'sha512-5yof1ytoB++RQtaFbqSUJ8pxDJtZT6vbVqZ8XoJ61ph7UjNVvfFwAilnCodqkNsAodpy13gDhoxZXw00pghnyg==', 'MIT'],
  'node_modules/@peculiar/asn1-pkcs8': ['2.8.0', 'sha512-qAKXtLpBEw9LqhKpjw3ajZSXlBur+ipW+y2ivVBQAG6F6qRx94yO+1ZR4mvw+YaCfKSaOzLeYEzsPaBp4SJELA==', 'MIT'],
  'node_modules/@peculiar/asn1-pkcs9': ['2.8.0', 'sha512-b5nDWCnkV60+cQ141D6sVVwK9nz64R5n3zSVnklGd+ECdkW2Ol3U1a6yYFlalpSOaD557yuJB64A+q42jG7lUQ==', 'MIT'],
  'node_modules/@peculiar/asn1-rsa': ['2.8.0', 'sha512-zHEUlCqB2mk7x2lxDwHHJy7hWZOPdGHVlsmITWKB5/PbQo61atbu9PJ/0r9dQNMwFzbKPXZ8uK8/91eUhRznSg==', 'MIT'],
  'node_modules/@peculiar/asn1-schema': ['2.8.0', 'sha512-7YT0U/ze0tF2QOBbE15gKZwy5tvgGyLRiRHLzhlbOpf7BT032oBSd0haZqXn5W6l26WLlu3dyxzjM+2638/z2Q==', 'MIT'],
  'node_modules/@peculiar/asn1-x509': ['2.8.0', 'sha512-N0CMuhWUzsWEVq6F1q9X6+VKUnWzSW+cSVg+aPaGGwDdbFoFWTYgin5MHwXgpWd6y9COMBxnfy/Qc+Xc7F0Zwg==', 'MIT'],
  'node_modules/@peculiar/asn1-x509-attr': ['2.8.0', 'sha512-tHjkfS/qhMnmrlB2J9NhflQlQ7In3khO3CfmVrriOlpTeErY9ZIKOso1hQ5JQiyrJ7ShvqVPk7E5fQmbclkSKA==', 'MIT'],
  'node_modules/@peculiar/utils': ['2.0.3', 'sha512-+oL3HPFRIZ1St2K50lWCXiioIgSoxzz7R1J3uF6neO2yl1sgmpgY6XXJH4BdpoDkMWznQTeYF6oWNDZLCdQ4eQ==', 'MIT'],
  'node_modules/@peculiar/x509': ['1.14.3', 'sha512-C2Xj8FZ0uHWeCXXqX5B4/gVFQmtSkiuOolzAgutjTfseNOHT3pUjljDZsTSxXFGgio54bCzVFqmEOUrIVk8RDA==', 'MIT'],
  'node_modules/@shinyoshiaki/binary-data': ['0.6.1', 'sha512-7HDb/fQAop2bCmvDIzU5+69i+UJaFgIVp99h1VzK1mpg1JwSODOkjbqD7ilTYnqlnadF8C4XjpwpepxDsGY6+w==', 'MIT'],
  'node_modules/asn1js': ['3.0.10', 'sha512-S2s3aOytiKdFRdulw2qPE51MzjzVOisppcVv7jVFR+Kw0kxwvFrDcYA0h7Ndqbmj0HkMIXYWaoj7fli8kgx1eg==', 'BSD-3-Clause'],
  'node_modules/debug': ['4.4.0', 'sha512-6WTZ/IxCY/T6BALoZHaE4ctp9xm+Z5kY/pzYaCHRFeyVhojxlrm+46y68HA6hr0TcwEssoxNiDEUJQjfPZ/RYA==', 'MIT'],
  'node_modules/dns-packet': ['5.6.1', 'sha512-l4gcSouhcgIKRvyy99RNVOgxXiicE+2jZoNmaNmZ6JXiGajBOJAesk1OBlJuM5k2c+eudGdLxDqXuPCKIj6kpw==', 'MIT'],
  'node_modules/generate-function': ['2.3.1', 'sha512-eeB5GfMNeevm/GRYq20ShmsaGcmI81kIX2K9XQx5miC8KdHaC6Jm0qQ8ZNeGOi7wYB8OsdxKs+Y2oVuTFuVwKQ==', 'MIT'],
  'node_modules/is-plain-object': ['2.0.4', 'sha512-h5PpgXkWitc38BBMYawTYMWJHFZJVnBquFE57xFpjB8pJFiF6gZ+bU+WyI/yqXiFR5mdLsgYNaPe8uao6Uv9Og==', 'MIT'],
  'node_modules/is-property': ['1.0.2', 'sha512-Ks/IoX00TtClbGQr4TWXemAnktAQvYB7HzcCxDGqEZU6oCmb2INHuOoKxbtR+HFkmYWBKv/dOZtGRiAjDhj92g==', 'MIT'],
  'node_modules/isobject': ['3.0.1', 'sha512-WhB9zCku7EGTj/HQQRz5aUQEUeoQZH2bWcltRErOpymJ4boYE6wL9Tbr23krRPSZ+C5zqNSrSw+Cc7sZZ4b7vg==', 'MIT'],
  'node_modules/ms': ['2.1.3', 'sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==', 'MIT'],
  'node_modules/multicast-dns': ['7.2.5', 'sha512-2eznPJP8z2BFLX50tf0LuODrpINqP1RVIm/CObbTcBRITQgmC/TjcREF1NeTBzIcR5XO/ukWo+YHOjBbFwIupg==', 'MIT'],
  'node_modules/pvtsutils': ['1.3.6', 'sha512-PLgQXQ6H2FWCaeRak8vvk1GW462lMxB5s3Jm673N82zI4vqtVUPuZdffdZbPDFRoU8kAhItWFtPCWiPpp4/EDg==', 'MIT'],
  'node_modules/pvutils': ['1.1.5', 'sha512-KTqnxsgGiQ6ZAzZCVlJH5eOjSnvlyEgx1m8bkRJfOhmGRqfo5KLvmAlACQkrjEtOQ4B7wF9TdSLIs9O90MX9xA==', 'MIT'],
  'node_modules/reflect-metadata': ['0.2.2', 'sha512-urBwgfrvVP/eAyXx4hluJivBKzuEbSQs9rKWCrCkbSxNv8mxPcUZKeuoF3Uy4mJl3Lwprp6yy5/39VWigZ4K6Q==', 'Apache-2.0'],
  'node_modules/thunky': ['1.1.0', 'sha512-eHY7nBftgThBqOyHGVN+l8gF0BucP09fMo0oO/Lb0w1OF80dJv+lDVpXG60WMQvkcxAkNybKsrEIE3ZtKGmPrA==', 'MIT'],
  'node_modules/tslib': ['2.8.1', 'sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==', '0BSD'],
  'node_modules/tsyringe': ['4.10.0', 'sha512-axr3IdNuVIxnaK5XGEUFTu3YmAQ6lllgrvqfEoR16g/HGnYY/6We4oWENtAnzK6/LpJ2ur9PAb80RBt7/U4ugw==', 'MIT'],
  'node_modules/tsyringe/node_modules/tslib': ['1.14.1', 'sha512-Xni35NKzjgMrwevysHTCArtLDpPvye8zV/0E4EyYn43P7/7qvQwPh9BGkHewbMulVntbigmcT7rdX3BNo9wRJg==', '0BSD'],
  'node_modules/tweetnacl': ['1.0.3', 'sha512-6rt+RN7aOi1nGMyC4Xa5DdYiukl2UWCbcJft7YhxReBGQD7OAM8Pbxw6YMo4r2diNEA8FEmu32YOn9rhaiE5yw==', 'Unlicense'],
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${command} ${args.join(' ')} timed out.`))
    }, options.timeoutMs ?? 120_000)
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

function packageNameFromInstallPath(installPath) {
  const marker = 'node_modules/'
  const lastMarker = installPath.lastIndexOf(marker)
  return installPath.slice(lastMarker + marker.length)
}

function licenseFilename(installPath, version) {
  return `${installPath
    .replaceAll('node_modules/', '')
    .replaceAll('@', '')
    .replaceAll('/', '__')}-${version}.txt`
}

async function findLicenseFile(packageRoot) {
  const names = await readdir(packageRoot)
  const candidates = names
    .filter((name) => /^(licen[cs]e|copying|unlicense)(\.|$)/i.test(name))
    .sort((left, right) => left.localeCompare(right))
  assert.ok(candidates[0], `No retained license file found in ${packageRoot}`)
  return path.join(packageRoot, candidates[0])
}

async function listFiles(root, prefix = '') {
  const names = (await readdir(path.join(root, prefix), { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const files = []
  for (const entry of names) {
    const relativePath = path.posix.join(prefix, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(root, relativePath))
    else files.push(relativePath)
  }
  return files
}

async function fileHashMap(root) {
  const result = {}
  for (const relativePath of await listFiles(root)) {
    const content = await readFile(path.join(root, relativePath))
    result[relativePath] = createHash('sha256').update(content).digest('hex')
  }
  return result
}

function assertPinnedRuntimeGraph(lock) {
  const actualPaths = Object.keys(lock.packages)
    .filter(Boolean)
    .sort()
  const expectedPaths = Object.keys(RETAINED_RUNTIME_PACKAGES).sort()
  assert.deepEqual(actualPaths, expectedPaths)
  for (const installPath of expectedPaths) {
    const [version, integrity, license] = RETAINED_RUNTIME_PACKAGES[installPath]
    const installed = lock.packages[installPath]
    assert.equal(installed.version, version, `${installPath} version`)
    assert.equal(installed.integrity, integrity, `${installPath} integrity`)
    assert.equal(installed.license, license, `${installPath} license`)
    assert.notEqual(packageNameFromInstallPath(installPath), 'ip')
    assert.notEqual(packageNameFromInstallPath(installPath), 'werift-ice')
  }
}

function createCycloneDx(lock) {
  const components = Object.keys(RETAINED_RUNTIME_PACKAGES).sort().map((installPath) => {
    const packageEntry = lock.packages[installPath]
    const name = packageNameFromInstallPath(installPath)
    return {
      'bom-ref': `pkg:npm/${encodeURIComponent(name)}@${packageEntry.version}?install_path=${encodeURIComponent(installPath)}`,
      hashes: [{
        alg: 'SHA-512',
        content: Buffer.from(packageEntry.integrity.slice('sha512-'.length), 'base64').toString('hex'),
      }],
      licenses: [{ license: { id: packageEntry.license } }],
      name,
      purl: `pkg:npm/${encodeURIComponent(name)}@${packageEntry.version}`,
      type: 'library',
      version: packageEntry.version,
    }
  })
  components.unshift({
    'bom-ref': `pkg:npm/werift@${WERIFT_VERSION}`,
    hashes: [{ alg: 'SHA-512', content: WERIFT_TARBALL_SHA512 }],
    licenses: [{ license: { id: 'MIT' } }],
    name: 'werift',
    purl: `pkg:npm/werift@${WERIFT_VERSION}`,
    type: 'library',
    version: WERIFT_VERSION,
  })
  return {
    bomFormat: 'CycloneDX',
    components,
    metadata: {
      component: {
        'bom-ref': `pkg:npm/%40terminay/werift-runtime-candidate@${WERIFT_VERSION}-candidate.0`,
        name: '@terminay/werift-runtime-candidate',
        type: 'library',
        version: `${WERIFT_VERSION}-candidate.0`,
      },
      timestamp: '2026-07-27T00:00:00.000Z',
    },
    serialNumber: 'urn:uuid:4f465c2a-50a5-4c58-9ed3-e3fbeef02401',
    specVersion: '1.6',
    version: 1,
  }
}

export async function buildSecureWeriftCandidate(workRoot) {
  await mkdir(workRoot, { recursive: true })
  const packageJson = {
    dependencies: DIRECT_RUNTIME_DEPENDENCIES,
    name: 'terminay-secure-werift-candidate-build',
    private: true,
    type: 'module',
    version: '0.0.0',
  }
  await writeFile(
    path.join(workRoot, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  )
  const install = await run(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '--ignore-scripts', '--omit=dev', '--package-lock=true'],
    {
      cwd: workRoot,
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
      },
    },
  )
  assert.equal(install.signal, null)
  assert.equal(install.code, 0, install.stderr || install.stdout)

  const lock = JSON.parse(await readFile(path.join(workRoot, 'package-lock.json'), 'utf8'))
  assertPinnedRuntimeGraph(lock)

  const packed = await run(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['pack', `werift@${WERIFT_VERSION}`, '--json'],
    {
      cwd: workRoot,
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
      },
    },
  )
  assert.equal(packed.signal, null)
  assert.equal(packed.code, 0, packed.stderr || packed.stdout)
  const [packResult] = JSON.parse(packed.stdout)
  assert.equal(packResult.version, WERIFT_VERSION)
  assert.equal(packResult.integrity, WERIFT_TARBALL_INTEGRITY)
  const tarballPath = path.join(workRoot, packResult.filename)
  const tarball = await readFile(tarballPath)
  assert.equal(
    createHash('sha512').update(tarball).digest('hex'),
    WERIFT_TARBALL_SHA512,
  )

  const registryMetadata = await run(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['view', `werift@${WERIFT_VERSION}`, 'gitHead', '--json'],
    { cwd: workRoot },
  )
  assert.equal(registryMetadata.signal, null)
  assert.equal(registryMetadata.code, 0, registryMetadata.stderr || registryMetadata.stdout)
  assert.equal(JSON.parse(registryMetadata.stdout), WERIFT_GIT_HEAD)

  const upstreamRoot = path.join(workRoot, 'upstream')
  await mkdir(upstreamRoot)
  const extracted = await run('tar', ['-xzf', tarballPath, '-C', upstreamRoot])
  assert.equal(extracted.signal, null)
  assert.equal(extracted.code, 0, extracted.stderr || extracted.stdout)

  const upstreamLicenseResponse = await fetch(
    `https://raw.githubusercontent.com/shinyoshiaki/werift-webrtc/${WERIFT_GIT_HEAD}/LICENSE`,
  )
  assert.equal(upstreamLicenseResponse.status, 200)
  const upstreamLicense = Buffer.from(await upstreamLicenseResponse.arrayBuffer())
  assert.equal(
    createHash('sha256').update(upstreamLicense).digest('hex'),
    WERIFT_LICENSE_SHA256,
  )

  const artifactRoot = path.join(workRoot, 'artifact')
  const licensesRoot = path.join(artifactRoot, 'LICENSES')
  await mkdir(path.join(artifactRoot, 'lib'), { recursive: true })
  await mkdir(licensesRoot)
  await cp(
    path.join(upstreamRoot, 'package', 'lib', 'index.mjs'),
    path.join(artifactRoot, 'lib', 'index.mjs'),
  )
  const bundledSource = await readFile(path.join(artifactRoot, 'lib', 'index.mjs'), 'utf8')
  assert.match(bundledSource, /from "node:net"/)
  assert.doesNotMatch(bundledSource, /from "ip"/)
  assert.doesNotMatch(bundledSource, /from "werift-ice"/)
  assert.doesNotMatch(bundledSource, /sourceMappingURL/)

  await writeFile(path.join(licensesRoot, `werift-${WERIFT_VERSION}.txt`), upstreamLicense)
  const noticeRows = [
    '# Third-party notices',
    '',
    'This candidate contains Werift output and executes the pinned packages below.',
    'The corresponding license texts are retained verbatim in `LICENSES/`.',
    '',
    '| Component | Version | License | License file |',
    '| --- | --- | --- | --- |',
    `| werift | ${WERIFT_VERSION} | MIT | LICENSES/werift-${WERIFT_VERSION}.txt |`,
  ]
  for (const installPath of Object.keys(RETAINED_RUNTIME_PACKAGES).sort()) {
    const [version, , license] = RETAINED_RUNTIME_PACKAGES[installPath]
    const sourceLicense = await findLicenseFile(path.join(workRoot, installPath))
    const filename = licenseFilename(installPath, version)
    await cp(sourceLicense, path.join(licensesRoot, filename))
    noticeRows.push(
      `| ${packageNameFromInstallPath(installPath)} | ${version} | ${license} | LICENSES/${filename} |`,
    )
  }
  await writeFile(
    path.join(artifactRoot, 'THIRD_PARTY_NOTICES.md'),
    `${noticeRows.join('\n')}\n`,
  )

  const runtimeLock = Object.fromEntries(
    Object.entries(RETAINED_RUNTIME_PACKAGES).sort(([left], [right]) =>
      left.localeCompare(right)
    ).map(([installPath, [version, integrity, license]]) => [
      installPath,
      { integrity, license, version },
    ]),
  )
  await writeFile(
    path.join(artifactRoot, 'RUNTIME-LOCK.json'),
    `${JSON.stringify(runtimeLock, null, 2)}\n`,
  )
  await writeFile(
    path.join(artifactRoot, 'sbom.cdx.json'),
    `${JSON.stringify(createCycloneDx(lock), null, 2)}\n`,
  )
  await writeFile(
    path.join(artifactRoot, 'SOURCE-CORRESPONDENCE.json'),
    `${JSON.stringify({
      buildPolicy: {
        dependencyScripts: 'disabled',
        sourceMaps: 'omitted: upstream npm ESM output contains no source map or sourceMappingURL; exact npm tarball and gitHead provide source correspondence',
      },
      upstream: {
        gitHead: WERIFT_GIT_HEAD,
        licenseSha256: WERIFT_LICENSE_SHA256,
        licenseUrl: `https://raw.githubusercontent.com/shinyoshiaki/werift-webrtc/${WERIFT_GIT_HEAD}/LICENSE`,
        npmIntegrity: WERIFT_TARBALL_INTEGRITY,
        npmPackage: `werift@${WERIFT_VERSION}`,
        tarballSha512: WERIFT_TARBALL_SHA512,
      },
    }, null, 2)}\n`,
  )
  await writeFile(
    path.join(artifactRoot, 'SOURCE_MAP_POLICY.md'),
    '# Source map policy\n\n'
      + 'This candidate does not distribute a source map. The pinned upstream npm ESM '
      + 'output contains neither a map nor a `sourceMappingURL`. The exact npm tarball, '
      + 'registry `gitHead`, source license, runtime lock, SBOM, and file hashes preserve '
      + 'source correspondence without implying a nonexistent map.\n',
  )
  await writeFile(
    path.join(artifactRoot, 'package.json'),
    `${JSON.stringify({
      dependencies: DIRECT_RUNTIME_DEPENDENCIES,
      description: `Auditable candidate repack of werift ${WERIFT_VERSION} ESM output`,
      engines: { node: '>=22' },
      exports: './lib/index.mjs',
      license: 'MIT',
      name: '@terminay/werift-runtime-proof',
      private: true,
      type: 'module',
      version: `${WERIFT_VERSION}-candidate.0`,
    }, null, 2)}\n`,
  )

  const preChecksumHashes = await fileHashMap(artifactRoot)
  const checksumLines = Object.entries(preChecksumHashes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, hash]) => `${hash}  ${relativePath}`)
  await writeFile(path.join(artifactRoot, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`)

  const artifactNodeModulesRoot = path.join(workRoot, 'node_modules', '@terminay')
  await mkdir(artifactNodeModulesRoot, { recursive: true })
  await cp(
    artifactRoot,
    path.join(artifactNodeModulesRoot, 'werift-runtime-proof'),
    { recursive: true },
  )

  return {
    artifactRoot,
    auditRoot: workRoot,
    fileHashes: await fileHashMap(artifactRoot),
  }
}
