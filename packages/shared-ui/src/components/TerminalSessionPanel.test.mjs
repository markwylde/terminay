import assert from 'node:assert/strict'
import test from 'node:test'
import { TERMINAL_SESSION_TOUCH_TARGET_PX, createTerminalSessionPanel } from './TerminalSessionPanel.mjs'

test('terminal session states have one safe wide and narrow shared contract', () => {
  const wide = createTerminalSessionPanel({
    terminalId: 'terminal:alpha',
    label: 'Build shell',
    status: 'attached',
    layout: 'wide',
    detail: 'Connected to the server',
  })
  const narrow = createTerminalSessionPanel({
    terminalId: 'terminal:alpha',
    label: 'Build shell',
    status: 'attached',
    layout: 'narrow',
    detail: 'Connected to the server',
  })

  assert.equal(wide.role, 'region')
  assert.equal(wide.ariaLabel, 'Terminal Build shell')
  assert.equal(wide.statusLabel, 'Connected')
  assert.deepEqual(wide.statusRegion, { role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: false })
  assert.deepEqual(wide.outputRegion, { role: 'log', ariaLive: 'off', ariaLabel: 'Terminal output for Build shell' })
  assert.equal(wide.retryAction, undefined)
  assert.deepEqual({ ...narrow, layout: 'wide' }, wide)
})

test('terminal session states distinguish reconnecting, retryable failure, and closed terminal', () => {
  const reconnecting = createTerminalSessionPanel({ terminalId: 't-1', label: 'Shell', status: 'reconnecting', layout: 'narrow' })
  const failed = createTerminalSessionPanel({ terminalId: 't-1', label: 'Shell', status: 'failed', layout: 'wide' })
  const closed = createTerminalSessionPanel({ terminalId: 't-1', label: 'Shell', status: 'closed', layout: 'wide' })

  assert.equal(reconnecting.statusRegion.ariaBusy, true)
  assert.equal(reconnecting.retryAction, undefined)
  assert.deepEqual(failed.retryAction, {
    id: 'retry-terminal', terminalId: 't-1', label: 'Retry terminal', minTouchTargetPx: TERMINAL_SESSION_TOUCH_TARGET_PX,
  })
  assert.equal(closed.statusLabel, 'Terminal closed')
  assert.equal(closed.retryAction, undefined)
})

test('terminal session panel fails closed for unsafe identities, text, states, and layouts', () => {
  assert.throws(
    () => createTerminalSessionPanel({ terminalId: 'bad id', label: 'Shell', status: 'attached', layout: 'wide' }),
    /safe terminal id/u,
  )
  assert.throws(
    () => createTerminalSessionPanel({ terminalId: 't-1', label: 'Bad\nlabel', status: 'attached', layout: 'wide' }),
    /safe, non-empty text/u,
  )
  assert.throws(
    () => createTerminalSessionPanel({ terminalId: 't-1', label: 'Shell', status: 'unknown', layout: 'wide' }),
    /supported terminal status/u,
  )
  assert.throws(
    () => createTerminalSessionPanel({ terminalId: 't-1', label: 'Shell', status: 'attached', layout: 'medium' }),
    /wide or narrow/u,
  )
})
