import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const { createControlServer } = await importBundled('../electron/control/server.ts')
const bundleDir = await mkdtemp(join(tmpdir(), 'terminay-mcp-flow-bundle-'))
const mcpBundlePath = join(bundleDir, 'mcp-server.mjs')

await build({
  bundle: true,
  entryPoints: [new URL('../electron/mcpEntry.ts', import.meta.url).pathname],
  format: 'esm',
  outfile: mcpBundlePath,
  platform: 'node',
  target: 'node20',
})

after(async () => {
  await rm(bundleDir, { recursive: true, force: true })
})

const TOOL_NAMES = [
  'list_terminals',
  'read_terminal',
  'get_terminal_status',
  'open_terminal',
  'write_terminal',
  'run_command',
  'close_terminal',
  'focus_terminal',
  'rename_terminal',
  'split_terminal',
  'wait_for_idle',
  'wait_for_command',
  'wait_for_attention',
]

test('MCP stdio handshake exposes every terminal-control tool', async () => {
  const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-home-'))
  const peer = startMcpProcess({ home })
  try {
    await initialize(peer)
    const response = await peer.request('tools/list', {})
    assert.equal(response.error, undefined)
    assert.deepEqual(
      response.result.tools.map((tool) => tool.name).sort(),
      [...TOOL_NAMES].sort(),
    )
  } finally {
    await peer.close()
    await rm(home, { recursive: true, force: true })
  }
})

test('MCP stdio clients remain isolated when two projects share one ControlServer', async () => {
  const socketDir = await mkdtemp(join(tmpdir(), 'terminay-mcp-socket-'))
  const socketPath = join(socketDir, 'control.sock')
  const projects = new Map([
    [
      'token-one',
      {
        scope: { sessionId: 'project-one-session', webContentsId: 101 },
        terminal: {
          id: 'project-one-terminal',
          name: 'Project One Terminal',
          busy: false,
          attention: false,
          cwd: '/projects/one',
          lastActivityAgoMs: 25,
          exitCode: null,
          isSelf: true,
        },
      },
    ],
    [
      'token-two',
      {
        scope: { sessionId: 'project-two-session', webContentsId: 202 },
        terminal: {
          id: 'project-two-terminal',
          name: 'Project Two Terminal',
          busy: true,
          attention: false,
          cwd: '/projects/two',
          lastActivityAgoMs: 5,
          exitCode: null,
          isSelf: true,
        },
      },
    ],
  ])
  const forwarded = []
  const server = createControlServer({
    socketPath,
    resolveScope: (token) => projects.get(token)?.scope ?? null,
    forward: async (scope, op, params) => {
      const project = [...projects.values()].find(
        (candidate) => candidate.scope.sessionId === scope.sessionId,
      )
      assert.ok(project, `unexpected scope ${scope.sessionId}`)
      forwarded.push({ project: scope.sessionId, op, params })

      if (op === 'list_terminals') {
        return { ok: true, result: { terminals: [project.terminal] } }
      }
      if (op === 'open_terminal') {
        return { ok: true, result: { id: `${scope.sessionId}-opened`, name: params.name ?? 'Terminal 2' } }
      }

      const terminalRef = params?.terminal
      const terminalMatches =
        terminalRef === project.terminal.id || terminalRef === project.terminal.name
      if (!terminalMatches) {
        return {
          ok: false,
          error: {
            code: 'terminal_not_found',
            message: `Terminal ${String(terminalRef)} is not in this project.`,
          },
        }
      }

      switch (op) {
        case 'read_terminal':
          return { ok: true, result: { id: project.terminal.id, name: project.terminal.name, output: `${scope.sessionId} output` } }
        case 'get_terminal_status':
          return {
            ok: true,
            result: {
              id: project.terminal.id,
              name: project.terminal.name,
              status: project.terminal.busy ? 'working' : 'idle',
              attention: project.terminal.attention,
              exitCode: project.terminal.exitCode,
              lastActivityAgoMs: project.terminal.lastActivityAgoMs,
            },
          }
        case 'split_terminal':
          return { ok: true, result: { id: `${scope.sessionId}-split`, name: 'Split terminal' } }
        case 'wait_for_idle':
          return { ok: true, result: { idle: true, timedOut: false } }
        case 'wait_for_command':
          return { ok: true, result: { exitCode: 0, timedOut: false } }
        case 'wait_for_attention':
          return { ok: true, result: { attention: true, timedOut: false } }
        default:
          return { ok: true, result: { ok: true } }
      }
    },
  })
  await server.start()

  const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-home-'))
  const first = startMcpProcess({ socketPath, token: 'token-one', home })
  const second = startMcpProcess({ socketPath, token: 'token-two', home })
  try {
    await Promise.all([initialize(first), initialize(second)])

    const firstList = parseToolPayload(await callTool(first, 'list_terminals'))
    const secondList = parseToolPayload(await callTool(second, 'list_terminals'))
    assert.deepEqual(firstList.terminals.map((terminal) => terminal.name), ['Project One Terminal'])
    assert.deepEqual(secondList.terminals.map((terminal) => terminal.name), ['Project Two Terminal'])

    const firstTerminal = 'Project One Terminal'
    const calls = [
      ['read_terminal', { terminal: firstTerminal, lines: 20 }],
      ['get_terminal_status', { terminal: firstTerminal }],
      ['open_terminal', { name: 'Project One New Tab', cwd: '/projects/one', split: 'right' }],
      ['write_terminal', { terminal: firstTerminal, text: 'echo one', submit: true }],
      ['run_command', { terminal: firstTerminal, command: 'printf one' }],
      ['focus_terminal', { terminal: firstTerminal }],
      ['rename_terminal', { terminal: firstTerminal, name: 'Renamed One' }],
      ['split_terminal', { terminal: firstTerminal, direction: 'below' }],
      ['wait_for_idle', { terminal: firstTerminal, seconds: 1, timeout: 2 }],
      ['wait_for_command', { terminal: firstTerminal, timeout: 2 }],
      ['wait_for_attention', { terminal: firstTerminal, timeout: 2 }],
      ['close_terminal', { terminal: firstTerminal }],
    ]
    for (const [name, args] of calls) {
      const result = await callTool(first, name, args)
      assert.notEqual(result.isError, true, `${name} unexpectedly failed`)
      assert.match(result.content[0].text, new RegExp(`^${name} ok\\n`))
    }

    const crossProject = await callTool(second, 'read_terminal', { terminal: firstTerminal })
    assert.equal(crossProject.isError, true)
    assert.match(crossProject.content[0].text, /not in this project/)

    const firstCalls = forwarded.filter((entry) => entry.project === 'project-one-session')
    const secondCalls = forwarded.filter((entry) => entry.project === 'project-two-session')
    assert.deepEqual(
      [...new Set(firstCalls.map((entry) => entry.op))].sort(),
      [...TOOL_NAMES].sort(),
    )
    assert.deepEqual(secondCalls.map((entry) => entry.op), ['list_terminals', 'read_terminal'])
    assert.ok(firstCalls.every((entry) => entry.project === 'project-one-session'))
    assert.ok(secondCalls.every((entry) => entry.project === 'project-two-session'))
  } finally {
    await Promise.all([first.close(), second.close()])
    await server.stop()
    await rm(home, { recursive: true, force: true })
    await rm(socketDir, { recursive: true, force: true })
  }
})

test('MCP reports a clear no-terminals result without Terminay environment', async () => {
  const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-home-'))
  const defaultConfigDir =
    process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support', 'Terminay')
      : join(home, '.config', 'Terminay')
  await mkdir(defaultConfigDir, { recursive: true })
  const peer = startMcpProcess({ home })
  try {
    await initialize(peer)
    const result = await callTool(peer, 'list_terminals')
    assert.equal(result.isError, true)
    assert.equal(
      result.content[0].text,
      'Terminay MCP is not running inside a Terminay terminal, so there are no terminals to control.',
    )
  } finally {
    await peer.close()
    await rm(home, { recursive: true, force: true })
  }
})

test('MCP reports the same clear result when the broker cannot resolve a caller', async () => {
  const socketDir = await mkdtemp(join(tmpdir(), 'terminay-mcp-socket-'))
  const socketPath = join(socketDir, 'control.sock')
  let forwarded = false
  const server = createControlServer({
    socketPath,
    resolveScope: () => null,
    forward: async () => {
      forwarded = true
      return { ok: true, result: {} }
    },
  })
  await server.start()
  const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-home-'))
  const peer = startMcpProcess({ socketPath, home })
  try {
    await initialize(peer)
    const result = await callTool(peer, 'list_terminals')
    assert.equal(result.isError, true)
    assert.equal(
      result.content[0].text,
      'Terminay MCP is not running inside a Terminay terminal, so there are no terminals to control.',
    )
    assert.equal(forwarded, false)
  } finally {
    await peer.close()
    await server.stop()
    await rm(home, { recursive: true, force: true })
    await rm(socketDir, { recursive: true, force: true })
  }
})

async function initialize(peer) {
  const response = await peer.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'terminay-test', version: '1.0.0' },
  })
  assert.equal(response.error, undefined)
  peer.notify('notifications/initialized')
}

async function callTool(peer, name, args = {}) {
  const response = await peer.request('tools/call', { name, arguments: args })
  assert.equal(response.error, undefined)
  return response.result
}

function parseToolPayload(result) {
  const text = result.content[0].text
  return JSON.parse(text.slice(text.indexOf('\n') + 1))
}

function startMcpProcess({ socketPath, token, home }) {
  const {
    TERMINAY_CONTROL_SOCKET: _socket,
    TERMINAY_CONTROL_TOKEN: _token,
    ...baseEnv
  } = process.env
  const child = spawn(process.execPath, [mcpBundlePath], {
    env: {
      ...baseEnv,
      ...(socketPath ? { TERMINAY_CONTROL_SOCKET: socketPath } : {}),
      ...(token ? { TERMINAY_CONTROL_TOKEN: token } : {}),
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdin.setDefaultEncoding('utf8')
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  let buffer = ''
  let stderr = ''
  let nextId = 1
  const pending = new Map()
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line.length > 0) {
        const message = JSON.parse(line)
        const entry = pending.get(message.id)
        if (entry) {
          pending.delete(message.id)
          clearTimeout(entry.timer)
          entry.resolve(message)
        }
      }
      newlineIndex = buffer.indexOf('\n')
    }
  })

  return {
    request(method, params) {
      const id = `mcp-test-${nextId++}`
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Timed out waiting for ${method}; stderr: ${stderr}`))
        }, 5_000)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
    },
    async close() {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(new Error('MCP test process closed'))
      }
      pending.clear()
      if (child.exitCode !== null) {
        return
      }
      const exited = once(child, 'exit')
      child.kill()
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1_000))])
    },
  }
}

async function importBundled(relativePath) {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-mcp-test-bundle-'))
  const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`)
  await build({
    bundle: true,
    entryPoints: [new URL(relativePath, import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'node',
    target: 'node20',
  })
  return import(outputPath)
}
