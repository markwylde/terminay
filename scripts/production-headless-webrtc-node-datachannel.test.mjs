import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const NODE_DATACHANNEL_VERSION = '0.32.3'
const CLEAN_LINUX_PROOF = process.env.TERMINAY_PROOF_REQUIRE_CLEAN_LINUX === '1'
const EXPECTED_ARCH = process.env.TERMINAY_PROOF_EXPECT_ARCH

async function proveLinuxNativeRuntime(dependencyRoot) {
  assert.equal(process.platform, 'linux', 'The Linux runtime proof must run on GNU/Linux.')
  assert.ok(
    EXPECTED_ARCH === 'x64' || EXPECTED_ARCH === 'arm64',
    'TERMINAY_PROOF_EXPECT_ARCH must be x64 or arm64.',
  )
  assert.equal(process.arch, EXPECTED_ARCH, 'The Node runtime architecture must match the proof lane.')
  if (CLEAN_LINUX_PROOF) {
    assert.equal(process.env.DISPLAY, undefined, 'The displayless proof must not inherit DISPLAY.')
    assert.equal(
      process.env.WAYLAND_DISPLAY,
      undefined,
      'The displayless proof must not inherit WAYLAND_DISPLAY.',
    )

    for (const compiler of ['cc', 'c++', 'gcc', 'g++', 'clang', 'clang++', 'cmake', 'make', 'ninja']) {
      const lookup = await run('sh', ['-c', `command -v '${compiler}'`])
      assert.notEqual(lookup.code, 0, `Clean Linux proof unexpectedly found compiler/build tool ${compiler}.`)
    }
  }

  const installedFiles = await readdir(
    path.join(dependencyRoot, 'node_modules/node-datachannel'),
    { recursive: true },
  )
  const nativeRelativePath = installedFiles.find((file) => file.endsWith('.node'))
  assert.ok(nativeRelativePath, 'The installed node-datachannel package has no native binding.')
  const nativePath = path.join(
    dependencyRoot,
    'node_modules/node-datachannel',
    nativeRelativePath,
  )
  const inspected = await run('file', ['--brief', nativePath])
  assert.equal(inspected.code, 0, inspected.stderr)
  assert.match(inspected.stdout, /ELF 64-bit LSB shared object/)
  assert.match(
    inspected.stdout,
    EXPECTED_ARCH === 'arm64' ? /ARM aarch64/ : /x86-64/,
    `The loaded native binding does not match ${EXPECTED_ARCH}.`,
  )

  return {
    arch: process.arch,
    nativeBinding: path.relative(dependencyRoot, nativePath),
    nativeFile: inspected.stdout.trim(),
    node: process.version,
  }
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

test('production service and hosted browser client use a displayless plain-Node node-datachannel host', {
  timeout: 360_000,
}, async () => {
  const dependencyRoot = await mkdtemp(
    path.join(os.tmpdir(), 'terminay-production-node-datachannel-'),
  )
  try {
    await writeFile(path.join(dependencyRoot, 'package.json'), `${JSON.stringify({
      name: 'terminay-production-node-datachannel-proof',
      private: true,
      type: 'module',
    }, null, 2)}\n`)

    const install = await run(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      [
        'install',
        '--no-save',
        '--omit=dev',
        `node-datachannel@${NODE_DATACHANNEL_VERSION}`,
      ],
      {
        cwd: dependencyRoot,
        env: {
          ...process.env,
          npm_config_audit: 'false',
          npm_config_fund: 'false',
        },
        timeoutMs: 120_000,
      },
    )
    assert.equal(install.signal, null)
    assert.equal(install.code, 0, install.stderr || install.stdout)
    const installedPackage = JSON.parse(await readFile(
      path.join(dependencyRoot, 'node_modules/node-datachannel/package.json'),
      'utf8',
    ))
    assert.equal(installedPackage.version, NODE_DATACHANNEL_VERSION)
    const linuxRuntimeEvidence = EXPECTED_ARCH
      ? await proveLinuxNativeRuntime(dependencyRoot)
      : null

    const playwrightArguments = [
      'playwright',
      'test',
      'e2e/webrtc-headless-node-host.spec.ts',
      '--workers=1',
      '--reporter=line',
    ]
    if (EXPECTED_ARCH) {
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
          TERMINAY_NODE_DATACHANNEL_SPIKE_ROOT: dependencyRoot,
        },
        timeoutMs: 300_000,
      },
    )
    assert.equal(proof.signal, null)
    assert.equal(proof.code, 0, `${proof.stdout}\n${proof.stderr}`)
    assert.match(proof.stdout, /1 passed/)
    assert.doesNotMatch(proof.stdout, /electron/i)
    if (linuxRuntimeEvidence) {
      process.stdout.write(`clean-linux-runtime=${JSON.stringify(linuxRuntimeEvidence)}\n`)
    }
  } finally {
    await rm(dependencyRoot, { force: true, recursive: true })
  }
})
