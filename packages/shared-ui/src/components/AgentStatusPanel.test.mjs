import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_STATUS_TOUCH_TARGET_PX, createAgentStatusPanel } from './AgentStatusPanel.mjs'

const agents = [
  { id: 'root', label: 'Implement shared workspace', status: 'working', detail: 'Updating the route surface' },
  { id: 'review', label: 'Review changes', status: 'needs-input' },
  { id: 'tests', label: 'Run tests', status: 'waiting' },
]

test('agent status panels preserve bounded shared activity semantics at wide and narrow widths', () => {
  const wide = createAgentStatusPanel({ agents, layout: 'wide', selectedAgentId: 'review' })
  const narrow = createAgentStatusPanel({ agents, layout: 'narrow', selectedAgentId: 'review' })

  assert.equal(wide.role, 'region')
  assert.equal(wide.ariaLabel, 'Agents')
  assert.equal(wide.list.role, 'list')
  assert.equal(wide.list.ariaLabel, 'Agent activity')
  assert.equal(wide.summary.working, 1)
  assert.equal(wide.summary['needs-input'], 1)
  assert.equal(wide.summary.waiting, 1)
  assert.equal(wide.list.items[1].ariaCurrent, 'true')
  assert.equal(wide.list.items[1].ariaLabel, 'Review changes needs input')
  assert.equal(wide.list.items[1].statusLabel, 'Needs input')
  assert.deepEqual(narrow.list.items, wide.list.items)
  assert.ok(wide.list.items.every(item => item.selectAction.minTouchTargetPx >= AGENT_STATUS_TOUCH_TARGET_PX))
  assert.equal(narrow.layout, 'narrow')
})

test('agent status panels represent empty activity without a fake selectable row', () => {
  const panel = createAgentStatusPanel({ agents: [], layout: 'narrow' })

  assert.equal(panel.empty, true)
  assert.equal(panel.emptyMessage, 'No agents are active.')
  assert.deepEqual(panel.list.items, [])
  assert.equal(panel.summary.working, 0)
  assert.equal(panel.summary.failed, 0)
})

test('agent status panels fail closed for unsafe, unsupported, or cross-panel selection input', () => {
  assert.throws(
    () => createAgentStatusPanel({ agents: [{ id: 'root', label: 'Root', status: 'running' }], layout: 'wide' }),
    /supported status/u,
  )
  assert.throws(
    () => createAgentStatusPanel({ agents: [{ id: 'root', label: 'Bad\nlabel', status: 'working' }], layout: 'wide' }),
    /safe label/u,
  )
  assert.throws(
    () => createAgentStatusPanel({ agents, layout: 'wide', selectedAgentId: 'outside' }),
    /identify an agent/u,
  )
  assert.throws(
    () => createAgentStatusPanel({ agents: [agents[0], agents[0]], layout: 'wide' }),
    /ids must be unique/u,
  )
})
