import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const workDirectory = await mkdtemp(join(tmpdir(), 'terminay-real-mcp-clients-'))
const homeDirectory = join(workDirectory, 'home')
const bundlePath = join(workDirectory, 'mcp-install.mjs')

const clients = [
  { id: 'claudeCode', binary: 'claude', listArgs: ['mcp', 'list'] },
  { id: 'codex', binary: 'codex', listArgs: ['mcp', 'list'] },
  { id: 'cursor', binary: 'cursor-agent', listArgs: ['mcp', 'list'] },
  { id: 'gemini', binary: 'gemini', listArgs: ['mcp', 'list'] },
  { id: 'openCode', binary: 'opencode', listArgs: ['mcp', 'list'] },
]

try {
  execFileSync('esbuild', [
    'electron/mcpInstall/index.ts',
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--target=node24',
    `--outfile=${bundlePath}`,
  ], { stdio: 'inherit' })

  const { getMcpInstallStatus, installMcpAgent } = await import(pathToFileURL(bundlePath).href)
  const server = { command: '/bin/false', args: [] }
  const options = { homeDirectory }

  for (const client of clients) {
    const version = runClient(client.binary, ['--version'], 20_000)
    assert.equal(version.timedOut, false, `${client.binary} --version timed out`)
    assert.equal(version.status, 0, boundedFailure(client, '--version', version))
    process.stdout.write(`${client.binary}: ${firstLine(version.output)}\n`)

    const installed = await installMcpAgent(client.id, server, options)
    assert.equal(installed.ok, true, `${client.binary}: ${installed.error ?? installed.message}`)
  }

  const status = await getMcpInstallStatus(server, options)
  const exercised = new Set(clients.map(({ id }) => id))
  assert.deepEqual(
    status.agents.filter(({ id }) => exercised.has(id)).map(({ id, state }) => ({ id, state })),
    clients.map(({ id }) => ({ id, state: 'installed' })),
  )

  const originalHome = process.env.HOME
  process.env.HOME = homeDirectory
  try {
    for (const client of clients) {
      const listed = runClient(client.binary, client.listArgs, 30_000)
      assert.equal(listed.timedOut, false, boundedFailure(client, client.listArgs.join(' '), listed))
      assert.match(listed.output, /terminay/iu, boundedFailure(client, client.listArgs.join(' '), listed))
      process.stdout.write(`${client.binary} recognized terminay\n`)
    }
  } finally {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
  }
} finally {
  await rm(workDirectory, { recursive: true, force: true })
}

function runClient(binary, args, timeout) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDirectory, NO_COLOR: '1', TERM: 'dumb' },
    maxBuffer: 1024 * 1024,
    timeout,
  })
  return {
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim(),
    status: result.status,
    timedOut: result.error?.code === 'ETIMEDOUT',
  }
}

function boundedFailure(client, operation, result) {
  return `${client.binary} ${operation} failed with status ${String(result.status)}:\n${result.output.slice(0, 4_000)}`
}

function firstLine(value) {
  return value.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? '(no version output)'
}
