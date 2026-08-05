import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, sign, verify } from 'node:crypto'
import {
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as bundleWithEsbuild, version as ESBUILD_VERSION } from 'esbuild'

const NODE_BUILTINS = new Set(
  builtinModules.flatMap((specifier) => [
    specifier,
    specifier.startsWith('node:') ? specifier.slice('node:'.length) : `node:${specifier}`,
  ]),
)

export const WERIFT_VERSION = '0.24.1'
export const WERIFT_CANDIDATE_VERSION = `${WERIFT_VERSION}-candidate.1`
export const WERIFT_GIT_HEAD = '243fd7e24c39fbe03fb855928daddd793fc8d4fa'
export const WERIFT_TARBALL_INTEGRITY =
  'sha512-8Mpf0FWO2pkd9UQyZ0Hb1CcimydlNh8KCvZGD2X/D0ucVY6ubJxX91cndOpTOnPA7wleopop044VSNZeCEwgeA=='
export const WERIFT_TARBALL_SHA512 =
  'f0ca5fd0558eda991df544326741dbd427229b2765361f0a0af6460f65ff0f4b9c558eae6c9c57f7572774ea533a73c0ef095ea29a29d38e1548d65e084c2078'
export const WERIFT_LICENSE_SHA256 =
  'b83683f3f71b5971e6c2e33a8b894a49d752fd24c11b8ae08b53ca20f594fca5'
export const WERIFT_TURN_REFRESH_PATCH_SHA256 =
  '34ea60bd991256adb2cd50bfe0ef9011cfc79054aff686b9ec35ef4703de4211'
const WERIFT_TURN_REFRESH_PATCH = fileURLToPath(
  new URL('./patches/werift-0.24.1-abort-turn-refresh.patch', import.meta.url),
)

export const DIRECT_RUNTIME_DEPENDENCIES = {
  '@fidm/x509': '1.2.1',
  '@noble/curves': '1.9.7',
  '@peculiar/x509': '1.14.3',
  '@shinyoshiaki/binary-data': '0.6.1',
  debug: '4.4.0',
  'multicast-dns': '7.2.5',
  tweetnacl: '1.0.3',
}

// Upstream allows a range for pvutils. Keep source-mirror acquisition on the
// audited candidate graph even when npm publishes a newer compatible release.
export const TRANSITIVE_RUNTIME_DEPENDENCY_OVERRIDES = {
  pvutils: '1.1.5',
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

function sourceMirrorManifest() {
  return {
    schemaVersion: 1,
    candidateVersion: WERIFT_CANDIDATE_VERSION,
    upstream: {
      gitHead: WERIFT_GIT_HEAD,
      integrity: WERIFT_TARBALL_INTEGRITY,
      licenseSha256: WERIFT_LICENSE_SHA256,
      package: `werift@${WERIFT_VERSION}`,
      tarballSha512: WERIFT_TARBALL_SHA512,
    },
    retainedPackages: Object.fromEntries(
      Object.entries(RETAINED_RUNTIME_PACKAGES).map(
        ([installPath, [version, integrity]]) => [installPath, { integrity, version }],
      ),
    ),
  }
}

export async function prepareSecureWeriftSourceMirror(mirrorRoot) {
  await mkdir(mirrorRoot, { recursive: true })
  const temporary = await mkdtemp(path.join(tmpdir(), 'terminay-werift-mirror-'))
  try {
    await writeFile(path.join(temporary, 'package.json'), `${JSON.stringify({
      dependencies: DIRECT_RUNTIME_DEPENDENCIES,
      overrides: TRANSITIVE_RUNTIME_DEPENDENCY_OVERRIDES,
      private: true,
    }, null, 2)}\n`)
    const cache = path.join(mirrorRoot, 'npm-cache')
    const environment = {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_cache: cache,
      npm_config_fund: 'false',
    }
    const install = await run(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '--ignore-scripts', '--omit=dev', '--package-lock=true'],
      { cwd: temporary, env: environment },
    )
    assert.equal(install.code, 0, install.stderr || install.stdout)
    const packed = await run(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['pack', `werift@${WERIFT_VERSION}`, '--json'],
      { cwd: temporary, env: environment },
    )
    assert.equal(packed.code, 0, packed.stderr || packed.stdout)
    const [packResult] = JSON.parse(packed.stdout)
    assert.equal(packResult.integrity, WERIFT_TARBALL_INTEGRITY)
    const tarball = await readFile(path.join(temporary, packResult.filename))
    assert.equal(createHash('sha512').update(tarball).digest('hex'), WERIFT_TARBALL_SHA512)

    const licenseResponse = await fetch(
      `https://raw.githubusercontent.com/shinyoshiaki/werift-webrtc/${WERIFT_GIT_HEAD}/LICENSE`,
    )
    assert.equal(licenseResponse.status, 200)
    const license = Buffer.from(await licenseResponse.arrayBuffer())
    assert.equal(createHash('sha256').update(license).digest('hex'), WERIFT_LICENSE_SHA256)
    await writeFile(path.join(mirrorRoot, 'werift.LICENSE'), license)
    await writeFile(
      path.join(mirrorRoot, 'mirror.json'),
      `${JSON.stringify(sourceMirrorManifest(), null, 2)}\n`,
    )
    return sourceMirrorManifest()
  } finally {
    await rm(temporary, { force: true, recursive: true })
  }
}

async function verifySecureWeriftSourceMirror(mirrorRoot) {
  const manifest = JSON.parse(await readFile(path.join(mirrorRoot, 'mirror.json'), 'utf8'))
  assert.deepEqual(manifest, sourceMirrorManifest(), 'Secure Werift source mirror pins differ.')
  const license = await readFile(path.join(mirrorRoot, 'werift.LICENSE'))
  assert.equal(
    createHash('sha256').update(license).digest('hex'),
    WERIFT_LICENSE_SHA256,
    'Secure Werift mirrored license integrity mismatch.',
  )
  return { cache: path.join(mirrorRoot, 'npm-cache'), license }
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
    const absolutePath = path.join(root, relativePath)
    const metadata = await lstat(absolutePath)
    assert.equal(metadata.isSymbolicLink(), false, `Candidate artifacts cannot contain symlinks: ${relativePath}`)
    if (entry.isDirectory()) files.push(...await listFiles(root, relativePath))
    else {
      assert.equal(metadata.isFile(), true, `Candidate artifact entry must be a regular file: ${relativePath}`)
      files.push(relativePath)
    }
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

async function runtimeExternalSpecifiers(source) {
  const parsed = await bundleWithEsbuild({
    bundle: false,
    format: 'esm',
    logLevel: 'silent',
    metafile: true,
    stdin: {
      contents: source,
      loader: 'js',
      sourcefile: 'verified-runtime.mjs',
    },
    write: false,
  })
  return Object.values(parsed.metafile.outputs)
    .flatMap((output) => output.imports)
    .map(({ path: specifier }) => specifier)
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
        'bom-ref': `pkg:npm/%40terminay/werift-runtime-candidate@${WERIFT_CANDIDATE_VERSION}`,
        name: '@terminay/werift-runtime-candidate',
        type: 'library',
        version: WERIFT_CANDIDATE_VERSION,
      },
      timestamp: '2026-07-27T00:00:00.000Z',
    },
    serialNumber: 'urn:uuid:4f465c2a-50a5-4c58-9ed3-e3fbeef02401',
    specVersion: '1.6',
    version: 1,
  }
}

function createDeterministicProvenance(subjects) {
  return {
    '_type': 'https://in-toto.io/Statement/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://terminay.com/builds/secure-werift-candidate/v1',
        externalParameters: {
          dependencyScripts: 'disabled',
          node: '>=22',
          package: `werift@${WERIFT_VERSION}`,
        },
        internalParameters: {
          bundler: `esbuild@${ESBUILD_VERSION}`,
          candidateVersion: WERIFT_CANDIDATE_VERSION,
          runtimeLayout: 'self-contained-single-file',
          sourceMaps: 'omitted',
        },
        resolvedDependencies: [
          {
            digest: { sha512: WERIFT_TARBALL_SHA512 },
            name: `pkg:npm/werift@${WERIFT_VERSION}`,
            uri: `npm:werift@${WERIFT_VERSION}`,
          },
          {
            digest: { sha1: WERIFT_GIT_HEAD },
            name: 'werift source correspondence',
            uri: `git+https://github.com/shinyoshiaki/werift-webrtc@${WERIFT_GIT_HEAD}`,
          },
          {
            digest: { sha256: WERIFT_TURN_REFRESH_PATCH_SHA256 },
            name: 'Terminay abortable TURN refresh patch',
            uri: 'terminay:scripts/patches/werift-0.24.1-abort-turn-refresh.patch',
          },
          ...Object.entries(RETAINED_RUNTIME_PACKAGES)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([installPath, [version, integrity]]) => ({
              digest: { sha512: Buffer.from(integrity.slice('sha512-'.length), 'base64').toString('hex') },
              name: installPath,
              uri: `pkg:npm/${packageNameFromInstallPath(installPath)}@${version}`,
            })),
        ],
      },
      runDetails: {
        builder: { id: 'https://terminay.com/builders/secure-werift-candidate/v1' },
        metadata: {
          // A fixed build identifier is deliberate: release evidence must not
          // encode runner time, host names, or other non-reproducible data.
          invocationId: `secure-werift-${WERIFT_CANDIDATE_VERSION}`,
        },
      },
    },
    predicateType: 'https://slsa.dev/provenance/v1',
    subject: subjects.map(([name, digest]) => ({
      digest: { sha256: digest },
      name,
    })),
  }
}

/**
 * Verify a candidate before it is used as runtime or release evidence.  This
 * intentionally treats the candidate as untrusted filesystem input: no
 * symlinks, extra files, altered manifests, or detached provenance subjects
 * may slip through merely because the candidate was produced locally once.
 */
export async function verifySecureWeriftCandidate(artifactRoot) {
  const actualFiles = await listFiles(artifactRoot)
  assert.ok(actualFiles.includes('SHA256SUMS'), 'Candidate checksum manifest is required.')
  assert.ok(actualFiles.includes('provenance.intoto.json'), 'Candidate provenance is required.')

  const checksums = await readFile(path.join(artifactRoot, 'SHA256SUMS'), 'utf8')
  const expectedHashes = {}
  for (const line of checksums.trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64}) {2}([A-Za-z0-9@._/-]+)$/u.exec(line)
    assert.ok(match, `Malformed candidate checksum row: ${line}`)
    const [, hash, relativePath] = match
    assert.equal(relativePath.startsWith('/'), false, 'Candidate checksum path must be relative.')
    assert.equal(relativePath.split('/').includes('..'), false, 'Candidate checksum path must stay inside candidate.')
    assert.equal(Object.hasOwn(expectedHashes, relativePath), false, `Duplicate candidate checksum path: ${relativePath}`)
    expectedHashes[relativePath] = hash
  }

  const actualHashes = await fileHashMap(artifactRoot)
  const payloadHashes = Object.fromEntries(
    Object.entries(actualHashes).filter(([relativePath]) => relativePath !== 'SHA256SUMS'),
  )
  assert.deepEqual(
    Object.keys(expectedHashes).sort(),
    Object.keys(payloadHashes).sort(),
    'Candidate checksum manifest must cover exactly every non-manifest file.',
  )
  assert.deepEqual(expectedHashes, payloadHashes, 'Candidate payload checksum mismatch.')

  const provenance = JSON.parse(await readFile(
    path.join(artifactRoot, 'provenance.intoto.json'),
    'utf8',
  ))
  const provenanceSubjects = Object.entries(payloadHashes)
    .filter(([relativePath]) => relativePath !== 'provenance.intoto.json')
    .sort(([left], [right]) => left.localeCompare(right))
  assert.deepEqual(
    provenance,
    createDeterministicProvenance(provenanceSubjects),
    'Candidate provenance must exactly bind the reviewed payload and materials.',
  )

  const packageManifest = JSON.parse(await readFile(
    path.join(artifactRoot, 'package.json'),
    'utf8',
  ))
  assert.deepEqual(
    packageManifest.dependencies,
    undefined,
    'Candidate runtime must not require registry-installed dependencies.',
  )
  const runtimeSource = await readFile(path.join(artifactRoot, 'lib', 'index.mjs'), 'utf8')
  const externalSpecifiers = await runtimeExternalSpecifiers(runtimeSource)
  assert.deepEqual(
    externalSpecifiers.filter((specifier) => !NODE_BUILTINS.has(specifier)),
    [],
    'Candidate runtime may import only Node built-ins outside its verified payload.',
  )
  return { fileHashes: actualHashes }
}

export async function buildSecureWeriftCandidate(workRoot, { sourceMirror } = {}) {
  const mirror = sourceMirror
    ? await verifySecureWeriftSourceMirror(sourceMirror)
    : undefined
  await mkdir(workRoot, { recursive: true })
  const packageJson = {
    dependencies: DIRECT_RUNTIME_DEPENDENCIES,
    name: 'terminay-secure-werift-candidate-build',
    overrides: TRANSITIVE_RUNTIME_DEPENDENCY_OVERRIDES,
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
        ...(mirror ? {
          npm_config_cache: mirror.cache,
          npm_config_offline: 'true',
        } : {}),
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
        ...(mirror ? {
          npm_config_cache: mirror.cache,
          npm_config_offline: 'true',
        } : {}),
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

  if (!mirror) {
    const registryMetadata = await run(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['view', `werift@${WERIFT_VERSION}`, 'gitHead', '--json'],
      { cwd: workRoot },
    )
    assert.equal(registryMetadata.signal, null)
    assert.equal(registryMetadata.code, 0, registryMetadata.stderr || registryMetadata.stdout)
    assert.equal(JSON.parse(registryMetadata.stdout), WERIFT_GIT_HEAD)
  }

  const upstreamRoot = path.join(workRoot, 'upstream')
  await mkdir(upstreamRoot)
  const extracted = await run('tar', ['-xzf', tarballPath, '-C', upstreamRoot])
  assert.equal(extracted.signal, null)
  assert.equal(extracted.code, 0, extracted.stderr || extracted.stdout)
  const patchBytes = await readFile(WERIFT_TURN_REFRESH_PATCH)
  assert.equal(
    createHash('sha256').update(patchBytes).digest('hex'),
    WERIFT_TURN_REFRESH_PATCH_SHA256,
  )
  const patched = await run(
    'patch',
    ['--batch', '--forward', '--fuzz=0', '-p1', '--input', WERIFT_TURN_REFRESH_PATCH],
    { cwd: path.join(upstreamRoot, 'package') },
  )
  assert.equal(patched.signal, null)
  assert.equal(patched.code, 0, patched.stderr || patched.stdout)

  const upstreamLicense = mirror
    ? mirror.license
    : Buffer.from(await (async () => {
      const response = await fetch(
        `https://raw.githubusercontent.com/shinyoshiaki/werift-webrtc/${WERIFT_GIT_HEAD}/LICENSE`,
      )
      assert.equal(response.status, 200)
      return response.arrayBuffer()
    })())
  assert.equal(
    createHash('sha256').update(upstreamLicense).digest('hex'),
    WERIFT_LICENSE_SHA256,
  )

  const artifactRoot = path.join(workRoot, 'artifact')
  const licensesRoot = path.join(artifactRoot, 'LICENSES')
  await mkdir(path.join(artifactRoot, 'lib'), { recursive: true })
  await mkdir(licensesRoot)
  const upstreamEntry = path.join(upstreamRoot, 'package', 'lib', 'index.mjs')
  const bundleResult = await bundleWithEsbuild({
    absWorkingDir: workRoot,
    banner: {
      js: "import { createRequire as __createNodeRequire } from 'node:module';\n"
        + 'const require = __createNodeRequire(import.meta.url);',
    },
    bundle: true,
    entryPoints: [upstreamEntry],
    external: ['node:*'],
    format: 'esm',
    legalComments: 'none',
    metafile: true,
    outfile: path.join(artifactRoot, 'lib', 'index.mjs'),
    platform: 'node',
    sourcemap: false,
    target: 'node22',
  })
  const bundledInputs = Object.keys(bundleResult.metafile.inputs)
  assert.ok(
    bundledInputs.some((input) =>
      input.replaceAll('\\', '/').endsWith('upstream/package/lib/index.mjs')
    ),
    'Werift entry point must be included in the runtime closure.',
  )
  for (const dependency of Object.keys(DIRECT_RUNTIME_DEPENDENCIES)) {
    assert.ok(
      bundledInputs.some((input) =>
        input.replaceAll('\\', '/').includes(`node_modules/${dependency}/`)
      ),
      `Runtime closure must include ${dependency}.`,
    )
  }
  const bundledSource = await readFile(path.join(artifactRoot, 'lib', 'index.mjs'), 'utf8')
  assert.match(bundledSource, /from "node:net"/)
  const bundledExternalSpecifiers = await runtimeExternalSpecifiers(bundledSource)
  assert.deepEqual(
    bundledExternalSpecifiers.filter((specifier) => !NODE_BUILTINS.has(specifier)),
    [],
  )
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
        bundler: `esbuild@${ESBUILD_VERSION}`,
        dependencyScripts: 'disabled',
        runtimeLayout: 'self-contained-single-file; no registry-installed runtime dependencies',
        sourceMaps: 'omitted: upstream npm ESM output contains no source map or sourceMappingURL; exact npm tarball, gitHead, and governed patch provide source correspondence',
      },
      upstream: {
        gitHead: WERIFT_GIT_HEAD,
        licenseSha256: WERIFT_LICENSE_SHA256,
        licenseUrl: `https://raw.githubusercontent.com/shinyoshiaki/werift-webrtc/${WERIFT_GIT_HEAD}/LICENSE`,
        npmIntegrity: WERIFT_TARBALL_INTEGRITY,
        npmPackage: `werift@${WERIFT_VERSION}`,
        tarballSha512: WERIFT_TARBALL_SHA512,
      },
      patches: [{
        path: 'scripts/patches/werift-0.24.1-abort-turn-refresh.patch',
        sha256: WERIFT_TURN_REFRESH_PATCH_SHA256,
        purpose: 'Abort the pending TURN allocation refresh timer during peer close.',
      }],
    }, null, 2)}\n`,
  )
  await writeFile(
    path.join(artifactRoot, 'SOURCE_MAP_POLICY.md'),
    '# Source map policy\n\n'
      + 'This candidate does not distribute a source map. The pinned upstream npm ESM '
      + 'output contains neither a map nor a `sourceMappingURL`. The exact npm tarball, '
      + 'registry `gitHead`, governed patch, source license, runtime lock, SBOM, and file hashes preserve '
      + 'source correspondence without implying a nonexistent map.\n',
  )
  await writeFile(
    path.join(artifactRoot, 'MEDIA_SURFACE_POLICY.md'),
    '# Media surface policy\n\n'
      + 'Terminay uses this runtime only for ordered WebRTC data channels. The exact patched '
      + 'upstream ESM closure is intentionally retained because standards-compliant peer '
      + 'negotiation shares SDP, ICE, DTLS, RTP/RTCP, certificate, decorator-registration, '
      + 'and transport internals even when no audio or video track is created. A deterministic '
      + '`RTCPeerConnection`-only tree-shaken entry imported successfully and exchanged signed '
      + 'SDP/ICE, but failed the full Chromium data-channel connection proof twice; stripping '
      + 'that closure is therefore not considered safe evidence. Terminay instead constrains '
      + 'capability at `loadSelectedSecureWeriftRuntime`, which returns a frozen object whose '
      + 'only key is `RTCPeerConnection`. Server code never receives upstream media exports and '
      + 'never calls `addTrack`, `addTransceiver`, or media-source APIs; application admission '
      + 'accepts exactly the four named data-channel lanes. Any future media use requires a '
      + 'candidate identity update and the full release gate rerun.\n',
  )
  await writeFile(
    path.join(artifactRoot, 'package.json'),
    `${JSON.stringify({
      description: `Auditable self-contained patched candidate of werift ${WERIFT_VERSION} ESM output`,
      engines: { node: '>=22' },
      exports: './lib/index.mjs',
      license: 'MIT',
      name: '@terminay/werift-runtime-proof',
      private: true,
      type: 'module',
      version: WERIFT_CANDIDATE_VERSION,
    }, null, 2)}\n`,
  )

  // Bind every distributable payload file to a deterministic in-toto/SLSA
  // statement before writing the checksum manifest. SHA256SUMS then covers
  // this provenance file as well, so neither its subjects nor materials can
  // be substituted independently of the candidate artifact.
  const provenanceSubjects = Object.entries(await fileHashMap(artifactRoot))
    .sort(([left], [right]) => left.localeCompare(right))
  await writeFile(
    path.join(artifactRoot, 'provenance.intoto.json'),
    `${JSON.stringify(createDeterministicProvenance(provenanceSubjects), null, 2)}\n`,
  )

  const preChecksumHashes = await fileHashMap(artifactRoot)
  const checksumLines = Object.entries(preChecksumHashes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, hash]) => `${hash}  ${relativePath}`)
  await writeFile(path.join(artifactRoot, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`)

  await verifySecureWeriftCandidate(artifactRoot)

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

/**
 * Produce the exact npm archive that a release workflow could distribute.
 * Callers compare independent outputs before accepting it as reproducible.
 */
export async function packSecureWeriftCandidate(artifactRoot) {
  await verifySecureWeriftCandidate(artifactRoot)
  const packed = await run(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['pack', '--json', '--ignore-scripts'],
    {
      cwd: artifactRoot,
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
      },
    },
  )
  assert.equal(packed.signal, null)
  assert.equal(packed.code, 0, packed.stderr || packed.stdout)
  const [archive] = JSON.parse(packed.stdout)
  assert.equal(archive.name, '@terminay/werift-runtime-proof')
  assert.equal(archive.version, WERIFT_CANDIDATE_VERSION)
  const archivePath = path.join(artifactRoot, archive.filename)
  const bytes = await readFile(archivePath)
  // `npm pack` writes into its working directory. The archive is evidence
  // returned to the caller, not a candidate payload; retaining it would make
  // an otherwise verified candidate appear to have an unchecked extra file.
  await rm(archivePath, { force: true })
  return {
    bytes,
    filename: archive.filename,
    integrity: archive.integrity,
  }
}

/** Detached release-signing hook for the exact deterministic npm archive.
 * Signing keys remain outside the candidate build so CI/HSM policy does not
 * make unsigned local builds impure. */
export function signSecureWeriftArchive({ bytes, filename }, privateKey, keyId) {
  assert.ok(bytes instanceof Uint8Array, 'Secure Werift archive bytes are required.')
  assert.equal(filename, `terminay-werift-runtime-proof-${WERIFT_CANDIDATE_VERSION}.tgz`)
  assert.match(keyId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u)
  return Object.freeze({
    algorithm: 'Ed25519',
    artifact: filename,
    keyId,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    signature: sign(null, bytes, privateKey).toString('base64'),
  })
}

export function verifySecureWeriftArchiveSignature({ bytes, filename }, record, publicKey) {
  assert.ok(bytes instanceof Uint8Array, 'Secure Werift archive bytes are required.')
  assert.deepEqual(
    Object.keys(record).sort(),
    ['algorithm', 'artifact', 'keyId', 'sha256', 'signature'],
    'Secure Werift signature metadata shape is invalid.',
  )
  assert.equal(record.algorithm, 'Ed25519')
  assert.equal(record.artifact, filename)
  assert.equal(
    record.sha256,
    createHash('sha256').update(bytes).digest('hex'),
    'Secure Werift archive SHA-256 verification failed.',
  )
  assert.equal(
    verify(null, bytes, publicKey, Buffer.from(record.signature, 'base64')),
    true,
    'Secure Werift detached signature verification failed.',
  )
  return true
}
