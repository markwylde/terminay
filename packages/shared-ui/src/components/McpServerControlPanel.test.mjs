import assert from 'node:assert/strict'
import test from 'node:test'
import { MCP_SERVER_CONTROL_TOUCH_TARGET_PX, createMcpServerControlPanel } from './McpServerControlPanel.mjs'

const servers = [
  { id: 'filesystem', label: 'Filesystem', detail: 'Project file access', state: 'running' },
  { id: 'docs', label: 'Documentation', state: 'stopped' },
  { id: 'search', label: 'Search', detail: 'Timed out during startup', state: 'failed' },
  { id: 'installer', label: 'Installing extension', state: 'installing' },
]

test('MCP server controls retain exact scoped action intents at wide and narrow widths', () => {
  const wide = createMcpServerControlPanel({ status: 'ready', servers, layout: 'wide' })
  const narrow = createMcpServerControlPanel({ status: 'ready', servers, layout: 'narrow' })

  assert.equal(wide.role, 'region')
  assert.equal(wide.servers.role, 'list')
  assert.deepEqual(wide.servers.items.map(server => server.controlAction), [
    { id: 'stop-mcp-server', serverId: 'filesystem', label: 'Stop Filesystem', minTouchTargetPx: MCP_SERVER_CONTROL_TOUCH_TARGET_PX },
    { id: 'start-mcp-server', serverId: 'docs', label: 'Start Documentation', minTouchTargetPx: MCP_SERVER_CONTROL_TOUCH_TARGET_PX },
    { id: 'retry-mcp-server', serverId: 'search', label: 'Retry Search', minTouchTargetPx: MCP_SERVER_CONTROL_TOUCH_TARGET_PX },
    undefined,
  ])
  assert.deepEqual(narrow.servers.items, wide.servers.items)
  assert.ok(wide.servers.items.filter(server => server.controlAction !== undefined).every(server => server.controlAction.minTouchTargetPx >= MCP_SERVER_CONTROL_TOUCH_TARGET_PX))
})

test('MCP server control panel exposes only an exact retry intent for retryable status failure', () => {
  const failed = createMcpServerControlPanel({ status: 'failed', layout: 'narrow' })
  const empty = createMcpServerControlPanel({ status: 'empty', layout: 'wide' })

  assert.deepEqual(failed.retryAction, { id: 'retry-mcp-servers', label: 'Retry MCP servers', minTouchTargetPx: MCP_SERVER_CONTROL_TOUCH_TARGET_PX })
  assert.equal(failed.statusRegion.ariaBusy, false)
  assert.equal(empty.servers.items.length, 0)
  assert.equal(empty.retryAction, undefined)
})

test('MCP server controls fail closed for unsafe, contradictory, or duplicate server state', () => {
  assert.throws(() => createMcpServerControlPanel({ status: 'ready', layout: 'wide' }), /must include/u)
  assert.throws(() => createMcpServerControlPanel({ status: 'failed', servers: [servers[0]], layout: 'wide' }), /Only a ready/u)
  assert.throws(() => createMcpServerControlPanel({ status: 'ready', servers: [{ ...servers[0], id: 'bad id' }], layout: 'wide' }), /safe MCP server id/u)
  assert.throws(() => createMcpServerControlPanel({ status: 'ready', servers: [servers[0], servers[0]], layout: 'wide' }), /ids must be unique/u)
  assert.throws(() => createMcpServerControlPanel({ status: 'ready', servers: [{ ...servers[0], state: 'unknown' }], layout: 'wide' }), /supported state/u)
})
