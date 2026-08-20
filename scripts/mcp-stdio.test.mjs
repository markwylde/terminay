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
    entryPoints: [new URL('../apps/terminay-server/src/desktopMcpEntry.ts', import.meta.url).pathname],
    format: 'esm',
    outfile: entryPath,
    platform: 'node',
    target: 'node20',
  })

  const { ControlCapabilityStore, createControlEndpoint } = await importBundled('../apps/terminay-server/src/mcp/controlEndpoint.ts')
  const capabilities = new ControlCapabilityStore({ tokenFactory: () => 'project-a-token' })
  capabilities.mint('project-a-caller', 'project-a')
  const controlServer = createControlEndpoint({
    socketPath,
    capabilities,
    dispatch: async (request, scope) => {
      seen.push({ scope, op: request.op, params: request.params })
      const { op, params } = request
      if (op === 'list_terminals') {
        return {
          ok: true,
          result: {
            terminals: [
              {
                terminal: 'project-a-caller',
                name: 'Agent',
                busy: false,
                attention: false,
                cwd: '/workspace/a',
                lastActivityAgoMs: 10,
                exitCode: null,
                self: true,
              },
              {
                terminal: 'project-a-worker',
                name: 'Worker',
                busy: true,
                attention: false,
                cwd: '/workspace/a',
                lastActivityAgoMs: 2,
                exitCode: null,
                self: false,
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
    assert.notEqual(listed.isError, true)
    assert.match(textFromToolResult(listed), /"terminal":"project-a-worker"/)
    assert.match(textFromToolResult(listed), /"self":true/)

    const wrote = await client.callTool({
      name: 'write_terminal',
      arguments: {
        terminal: 'project-a-worker',
        text: 'printf ok',
        submit: true,
      },
    })
    assert.notEqual(wrote.isError, true)
    assert.match(textFromToolResult(wrote), /write_terminal ok/)

    const rejected = await client.callTool({
      name: 'read_terminal',
      arguments: { terminal: 'project-b-secret' },
    })
    assert.equal(rejected.isError, true)
    assert.match(textFromToolResult(rejected), /outside the calling project/)

    assert.deepEqual(seen, [
      {
        scope: {
          terminalSessionId: 'project-a-caller',
          projectId: 'project-a',
          scope: 'write',
          connectionId: 'connection-1',
          requestId: seen[0].scope.requestId,
          signal: seen[0].scope.signal,
        },
        op: 'list_terminals',
        params: {},
      },
      {
        scope: {
          terminalSessionId: 'project-a-caller',
          projectId: 'project-a',
          scope: 'write',
          connectionId: 'connection-1',
          requestId: seen[1].scope.requestId,
          signal: seen[1].scope.signal,
        },
        op: 'write_terminal',
        params: {
          terminal: 'project-a-worker',
          text: 'printf ok',
          submit: true,
        },
      },
      {
        scope: {
          terminalSessionId: 'project-a-caller',
          projectId: 'project-a',
          scope: 'write',
          connectionId: 'connection-1',
          requestId: seen[2].scope.requestId,
          signal: seen[2].scope.signal,
        },
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
    entryPoints: [new URL('../apps/terminay-server/src/desktopMcpEntry.ts', import.meta.url).pathname],
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
	await assert.rejects(client.connect(transport), /Connection closed/)
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
