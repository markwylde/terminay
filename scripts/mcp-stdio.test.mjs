import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { build } from 'esbuild'

const EXPECTED_TOOLS = [
  'close_terminal',
  'focus_terminal',
  'get_terminal_status',
  'list_terminals',
  'open_terminal',
  'read_terminal',
  'rename_terminal',
  'run_command',
  'split_terminal',
  'wait_for_attention',
  'wait_for_command',
  'wait_for_idle',
  'write_terminal',
]

test('MCP stdio adapter registers every tool and round-trips operations through control scope', async () => {
  const testDir = await mkdtemp(join(tmpdir(), 'terminay-mcp-stdio-'))
  const socketPath = join(testDir, 'control.sock')
  const entryPath = join(testDir, 'mcp-entry.mjs')
  const seen = []

  await build({
    bundle: true,
    entryPoints: [new URL('../electron/mcpEntry.ts', import.meta.url).pathname],
    format: 'esm',
    outfile: entryPath,
    platform: 'node',
    target: 'node20',
  })

  const { createControlServer } = await importBundled('../electron/control/server.ts')
  const controlServer = createControlServer({
    socketPath,
    resolveScope: (token) =>
      token === 'project-a-token'
        ? { sessionId: 'project-a-caller', webContentsId: 41 }
        : null,
    forward: async (scope, op, params) => {
      seen.push({ scope, op, params })
      if (op === 'list_terminals') {
        return {
          ok: true,
          result: {
            terminals: [
              {
                id: 'project-a-caller',
                name: 'Agent',
                busy: false,
                attention: false,
                cwd: '/workspace/a',
                lastActivityAgoMs: 10,
                exitCode: null,
                isSelf: true,
              },
              {
                id: 'project-a-worker',
                name: 'Worker',
                busy: true,
                attention: false,
                cwd: '/workspace/a',
                lastActivityAgoMs: 2,
                exitCode: null,
                isSelf: false,
              },
            ],
          },
        }
      }
      if (op === 'write_terminal') {
        return { ok: true, result: { ok: true } }
      }
      return {
        ok: false,
        error: {
          code: 'terminal_not_found',
          message: 'The requested terminal is outside the calling project.',
        },
      }
    },
  })

  await controlServer.start()
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entryPath],
    env: {
      ...process.env,
      TERMINAY_CONTROL_SOCKET: socketPath,
      TERMINAY_CONTROL_TOKEN: 'project-a-token',
    },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'terminay-test-client', version: '1.0.0' })

  try {
    await client.connect(transport)

    const tools = await client.listTools()
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      EXPECTED_TOOLS,
    )

    const listed = await client.callTool({
      name: 'list_terminals',
      arguments: {},
    })
    assert.equal(listed.isError, false)
    assert.match(textFromToolResult(listed), /"id": "project-a-worker"/)
    assert.match(textFromToolResult(listed), /"isSelf": true/)

    const wrote = await client.callTool({
      name: 'write_terminal',
      arguments: {
        terminal: 'project-a-worker',
        text: 'printf ok',
        submit: true,
      },
    })
    assert.equal(wrote.isError, false)
    assert.match(textFromToolResult(wrote), /write_terminal ok/)

    const rejected = await client.callTool({
      name: 'read_terminal',
      arguments: { terminal: 'project-b-secret' },
    })
    assert.equal(rejected.isError, true)
    assert.match(textFromToolResult(rejected), /outside the calling project/)

    assert.deepEqual(seen, [
      {
        scope: { sessionId: 'project-a-caller', webContentsId: 41 },
        op: 'list_terminals',
        params: {},
      },
      {
        scope: { sessionId: 'project-a-caller', webContentsId: 41 },
        op: 'write_terminal',
        params: {
          terminal: 'project-a-worker',
          text: 'printf ok',
          submit: true,
        },
      },
      {
        scope: { sessionId: 'project-a-caller', webContentsId: 41 },
        op: 'read_terminal',
        params: { terminal: 'project-b-secret' },
      },
    ])
  } finally {
    await client.close().catch(() => {})
    await controlServer.stop()
    await rm(testDir, { recursive: true, force: true })
  }
})

test('MCP stdio adapter rejects operation without an inherited terminal capability', async () => {
  const testDir = await mkdtemp(join(tmpdir(), 'terminay-mcp-stdio-no-token-'))
  const entryPath = join(testDir, 'mcp-entry.mjs')
  await build({
    bundle: true,
    entryPoints: [new URL('../electron/mcpEntry.ts', import.meta.url).pathname],
    format: 'esm',
    outfile: entryPath,
    platform: 'node',
    target: 'node20',
  })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entryPath],
    env: { ...process.env, TERMINAY_CONTROL_TOKEN: '' },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'terminay-no-token-test', version: '1.0.0' })
  try {
    await client.connect(transport)
    const result = await client.callTool({ name: 'list_terminals', arguments: {} })
    assert.equal(result.isError, true)
    assert.match(
      textFromToolResult(result),
      /not running inside a Terminay terminal/,
    )
  } finally {
    await client.close().catch(() => {})
    await rm(testDir, { recursive: true, force: true })
  }
})

function textFromToolResult(result) {
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
}

async function importBundled(relativePath) {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-mcp-stdio-bundle-'))
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
