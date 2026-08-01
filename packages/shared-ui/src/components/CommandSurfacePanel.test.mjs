import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMAND_SURFACE_TOUCH_TARGET_PX, createCommandSurfacePanel } from './CommandSurfacePanel.mjs'

const commands = Object.freeze([
  Object.freeze({ id: 'command:new-terminal', label: 'New terminal', shortcut: '⌘T' }),
  Object.freeze({ id: 'command:open-settings', label: 'Open settings' }),
])

test('command surface has one safe accessible wide and narrow contract', () => {
  const wide = createCommandSurfacePanel({ status: 'ready', layout: 'wide', query: 'new', commands, selectedCommandId: 'command:new-terminal' })
  const narrow = createCommandSurfacePanel({ status: 'ready', layout: 'narrow', query: 'new', commands, selectedCommandId: 'command:new-terminal' })

  assert.equal(wide.role, 'region')
  assert.deepEqual(wide.search, { role: 'searchbox', ariaLabel: 'Search commands', value: 'new', maxLength: 256 })
  assert.equal(wide.commandCount, 2)
  assert.deepEqual(wide.list.items[0], {
    id: 'command:new-terminal', label: 'New terminal', shortcut: '⌘T', selected: true, role: 'option', ariaSelected: true,
    action: { id: 'run-command', commandId: 'command:new-terminal', label: 'Run New terminal', minTouchTargetPx: COMMAND_SURFACE_TOUCH_TARGET_PX },
  })
  assert.equal(wide.list.overflowX, 'visible')
  assert.equal(narrow.list.overflowX, 'auto')
})

test('command surface distinguishes empty, unavailable, and retryable failure state', () => {
  const empty = createCommandSurfacePanel({ status: 'empty', layout: 'wide' })
  const unavailable = createCommandSurfacePanel({ status: 'unavailable', layout: 'narrow' })
  const failed = createCommandSurfacePanel({ status: 'failed', layout: 'wide' })

  assert.equal(empty.statusLabel, 'No commands')
  assert.equal(unavailable.statusRegion.ariaBusy, false)
  assert.deepEqual(failed.retryAction, { id: 'retry-commands', label: 'Retry commands', minTouchTargetPx: COMMAND_SURFACE_TOUCH_TARGET_PX })
})

test('command surface fails closed for unsafe or inconsistent command state', () => {
  assert.throws(() => createCommandSurfacePanel({ status: 'ready', layout: 'wide', commands: [{ id: 'bad id', label: 'Open' }] }), /safe command id/u)
  assert.throws(() => createCommandSurfacePanel({ status: 'ready', layout: 'wide', commands: [{ id: 'command:one', label: 'bad\nlabel' }] }), /safe, non-empty text/u)
  assert.throws(() => createCommandSurfacePanel({ status: 'loading', layout: 'wide' }), /supported command surface status/u)
  assert.throws(() => createCommandSurfacePanel({ status: 'empty', layout: 'wide', commands }), /cannot contain commands/u)
  assert.throws(() => createCommandSurfacePanel({ status: 'ready', layout: 'wide', commands, selectedCommandId: 'command:missing' }), /selected command/u)
})
