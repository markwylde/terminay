import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const execFileAsync = promisify(execFile)
const SMOKE_TOKEN = 'task10-provider-smoke-token'
const SMOKE_TERMINAL = 'Task 10 smoke terminal'
const COMMAND_TIMEOUT_MS = 120_000

const rootDirectory = fileURLToPath(new URL('..', import.meta.url))
const serverDirectory = join(rootDirectory, 'apps', 'terminay-server')
const serverMcpEntryPath = join(serverDirectory, 'dist', 'mcpEntry.js')

const report = {
  generatedAt: new Date().toISOString(),
  providers: {},
  fixture: {
    operation: 'list_terminals',
    terminal: SMOKE_TERMINAL,
  },
}

const workspace = await mkdtemp(join(tmpdir(), 'terminay-task10-provider-smoke-'))
const bundleDirectory = await mkdtemp(join(tmpdir(), 'terminay-task10-provider-bundle-'))
const socketPath = join(workspace, 'control.sock')
let controlServer

try {
  const { createControlServer } = await bundleImport('electron/control/server.ts', bundleDirectory)
  await buildStandaloneServerArtifact()

  controlServer = createControlServer({
    socketPath,
    resolveScope: (token) =>
      token === SMOKE_TOKEN
        ? { sessionId: 'task10-smoke-caller', webContentsId: 10 }
        : null,
    forward: async (_scope, operation) => {
      if (operation !== 'list_terminals') {
        return {
          ok: false,
          error: {
            code: 'unsupported_op',
            message: 'The Task 10 smoke fixture permits list_terminals only.',
          },
        }
      }
      return {
        ok: true,
        result: {
          terminals: [
            {
              id: 'task10-smoke-terminal',
              name: SMOKE_TERMINAL,
              busy: false,
              attention: false,
              cwd: workspace,
              lastActivityAgoMs: 0,
              exitCode: null,
              isSelf: true,
            },
          ],
        },
      }
    },
  })
  await controlServer.start()
  report.fixture.directProbe = await runDirectMcpProbe(serverMcpEntryPath)

  report.providers.codex = await runProviderWhenFixtureReady({
    id: 'codex',
    command: 'codex',
    versionArgs: ['--version'],
    authArgs: ['login', 'status'],
    smokeArgs: [
      'exec',
      '--ignore-user-config',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--json',
      '--color',
      'never',
      '-c',
      'approval_policy="never"',
      '-c',
      `mcp_servers.terminay.command=${JSON.stringify(process.execPath)}`,
      '-c',
      `mcp_servers.terminay.args=${JSON.stringify([serverMcpEntryPath])}`,
      '-c',
      `mcp_servers.terminay.env.TERMINAY_CONTROL_SOCKET=${JSON.stringify(socketPath)}`,
      '-c',
      `mcp_servers.terminay.env.TERMINAY_CONTROL_TOKEN=${JSON.stringify(SMOKE_TOKEN)}`,
      smokePrompt('Codex'),
    ],
  })

  report.providers.claudeCode = await runProviderWhenFixtureReady({
    id: 'claudeCode',
    command: 'claude',
    versionArgs: ['--version'],
    authArgs: ['auth', 'status'],
    smokeArgs: [
      '--bare',
      '--print',
      '--no-session-persistence',
      '--output-format',
      'json',
      '--permission-mode',
      'manual',
      '--strict-mcp-config',
      '--mcp-config',
      JSON.stringify({
        mcpServers: {
          terminay: {
            type: 'stdio',
            command: process.execPath,
            args: [serverMcpEntryPath],
            env: {
              TERMINAY_CONTROL_SOCKET: socketPath,
              TERMINAY_CONTROL_TOKEN: SMOKE_TOKEN,
            },
          },
        },
      }),
      smokePrompt('Claude Code'),
    ],
  })
} finally {
  await controlServer?.stop()
  await rm(bundleDirectory, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

const attempted = Object.values(report.providers).filter((provider) => provider.attempted)
if (attempted.some((provider) => provider.status === 'failed')) {
  process.exitCode = 1
}

async function runProvider({ id, command, versionArgs, authArgs, smokeArgs }) {
  const executable = await findExecutable(command)
  if (executable === null) {
    return { status: 'unavailable', attempted: false, reason: 'executable not found' }
  }

  const version = await runCommand(executable, versionArgs, { timeoutMs: 10_000 })
  const auth = await runCommand(executable, authArgs, { timeoutMs: 10_000 })
  const authOutput = `${auth.stdout}\n${auth.stderr}`
  const loggedIn =
    id === 'codex'
      ? /logged in|authenticated|chatgpt/i.test(authOutput)
      : /"loggedIn"\s*:\s*true/u.test(authOutput)
  const base = {
    executable,
    version: firstLine(version.stdout || version.stderr),
    auth: {
      exitCode: auth.exitCode,
      loggedIn,
    },
  }

  if (!loggedIn) {
    return { ...base, status: 'skipped', attempted: false, reason: 'provider is not authenticated' }
  }

  const providerEnv = {
    ...process.env,
    TERMINAY_CONTROL_SOCKET: socketPath,
    TERMINAY_CONTROL_TOKEN: SMOKE_TOKEN,
  }
  if (id === 'codex') {
    const codexHome = join(workspace, 'codex-home')
    await mkdir(codexHome, { recursive: true })
    await writeFile(
      join(codexHome, 'config.toml'),
      [
        'approval_policy = "never"',
        'sandbox_mode = "read-only"',
        '[mcp_servers.terminay]',
        `command = ${JSON.stringify(process.execPath)}`,
        `args = ${JSON.stringify([serverMcpEntryPath])}`,
        '[mcp_servers.terminay.env]',
        `TERMINAY_CONTROL_SOCKET = ${JSON.stringify(socketPath)}`,
        `TERMINAY_CONTROL_TOKEN = ${JSON.stringify(SMOKE_TOKEN)}`,
        '',
      ].join('\n'),
    )
    try {
      await symlink(join(homedir(), '.codex', 'auth.json'), join(codexHome, 'auth.json'))
    } catch {
      // A missing auth file is reflected by the provider's own smoke result.
    }
    providerEnv.CODEX_HOME = codexHome
  }

  const smoke = await runCommand(executable, smokeArgs, {
    cwd: workspace,
    env: providerEnv,
    timeoutMs: COMMAND_TIMEOUT_MS,
  })
  const output = `${smoke.stdout}\n${smoke.stderr}`
  const passed =
    smoke.exitCode === 0 &&
    output.includes('list_terminals') &&
    output.includes(SMOKE_TERMINAL)
  return {
    ...base,
    attempted: true,
    status: passed ? 'passed' : 'failed',
    exitCode: smoke.exitCode,
    timedOut: smoke.timedOut,
    observed: {
      requestedOperation: 'list_terminals',
      terminalName: output.includes(SMOKE_TERMINAL),
      operationName: output.includes('list_terminals'),
    },
    output: truncate(output),
  }
}

async function runProviderWhenFixtureReady(provider) {
  if (report.fixture.directProbe.status !== 'passed') {
    return {
      status: 'skipped',
      attempted: false,
      reason: 'isolated direct MCP probe did not pass',
    }
  }
  return runProvider(provider)
}

async function runDirectMcpProbe(entryPath) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entryPath],
    env: {
      ...process.env,
      TERMINAY_CONTROL_SOCKET: socketPath,
      TERMINAY_CONTROL_TOKEN: SMOKE_TOKEN,
    },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'terminay-task10-fixture', version: '1.0.0' })
  try {
    await client.connect(transport)
    const result = await client.callTool({ name: 'list_terminals', arguments: {} })
    const text = result.content?.find((item) => item.type === 'text')?.text ?? ''
    return {
      status: result.isError === true || !text.includes(SMOKE_TERMINAL) ? 'failed' : 'passed',
      operation: 'list_terminals',
      terminalName: text.includes(SMOKE_TERMINAL),
      output: truncate(text),
    }
  } catch (error) {
    return {
      status: 'failed',
      operation: 'list_terminals',
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await client.close().catch(() => {})
  }
}

async function findExecutable(command) {
  try {
    const result = await execFileAsync('sh', ['-lc', `command -v ${command}`], { timeout: 5_000 })
    return result.stdout.trim().split('\n')[0] || null
  } catch {
    return null
  }
}

async function buildStandaloneServerArtifact() {
  await execFileAsync(
    'npm',
    ['run', 'build', '--workspace=@terminay/server', '--if-present'],
    {
      cwd: rootDirectory,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    },
  )
}

async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stdout = []
  const stderr = []
  child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 2_000).unref()
  }, options.timeoutMs ?? COMMAND_TIMEOUT_MS)
  const [result] = await once(child, 'close')
  clearTimeout(timer)
  return {
    exitCode: result,
    stdout: stdout.join(''),
    stderr: stderr.join(''),
    timedOut,
  }
}

async function bundleImport(relativePath, outputDirectory) {
  const outputPath = join(outputDirectory, `${relativePath.split('/').pop()}.mjs`)
  await build({
    bundle: true,
    entryPoints: [join(rootDirectory, relativePath)],
    format: 'esm',
    outfile: outputPath,
    platform: 'node',
    target: 'node20',
  })
  return import(`file://${outputPath}`)
}

function smokePrompt(provider) {
  return `You are running a bounded ${provider} MCP smoke test. Use only the Terminay MCP server and call its read-only list_terminals tool exactly once. Do not use shell, filesystem, edit, network, or any other MCP tool. After the tool returns, report the exact terminal name from the result. If the Terminay tool is unavailable, report that and stop.`
}

function firstLine(value) {
  return value.trim().split('\n')[0] ?? ''
}

function truncate(value, max = 12_000) {
  return value.length <= max ? value : `${value.slice(0, max)}\n[output truncated]`
}
