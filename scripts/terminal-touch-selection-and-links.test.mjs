import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Touch over the terminal has one settled behaviour and it must stay settled.
 *
 * A drag belongs to xterm: it becomes wheel mouse reports, a viewport scroll,
 * or cursor keys depending on what the foreground program asked for. These
 * tests pin the two gestures added alongside it — a stationary one-second hold
 * that selects text, and a tap that follows a link — to the cases where the
 * gesture does nothing today, so neither can grow into the drag's territory.
 */
let compiled
async function loadModules() {
  compiled ??= (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'terminay-touch-selection-'))
    const build1 = build({
      entryPoints: ['src/components/terminalTouchSelectionInteraction.ts'],
      outfile: join(directory, 'touchSelection.mjs'),
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      logLevel: 'silent',
    })
    const build2 = build({
      entryPoints: ['src/components/terminalLinkInteraction.ts'],
      outfile: join(directory, 'linkInteraction.mjs'),
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      logLevel: 'silent',
    })
    await Promise.all([build1, build2])
    return {
      directory,
      touchSelection: await import(`file://${join(directory, 'touchSelection.mjs')}`),
      linkInteraction: await import(`file://${join(directory, 'linkInteraction.mjs')}`),
    }
  })()
  return compiled
}

after(async () => {
  if (compiled === undefined) return
  const { directory } = await compiled
  await rm(directory, { recursive: true, force: true })
})

function timers() {
  const pending = new Map()
  let next = 1
  return {
    setTimeout: (handler, delay) => {
      const id = next++
      pending.set(id, { handler, delay })
      return id
    },
    clearTimeout: (id) => pending.delete(id),
    run: (id) => {
      const entry = pending.get(id)
      pending.delete(id)
      entry?.handler()
    },
    runAll: () => {
      for (const id of [...pending.keys()]) {
        const entry = pending.get(id)
        pending.delete(id)
        entry.handler()
      }
    },
    get size() {
      return pending.size
    },
  }
}

function session(module, { enabled = true, holdMs = 1000 } = {}) {
  const clock = timers()
  const events = []
  const instance = module.createTerminalTouchSelectionSession({
    clearTimeout: clock.clearTimeout,
    holdMs,
    isEnabled: () => enabled,
    moveThresholdPx: 8,
    onSelectionStart: (point) => events.push(['start', point.clientX, point.clientY]),
    onSelectionMove: (point) => events.push(['move', point.clientX, point.clientY]),
    onSelectionEnd: (point) => events.push(['end', point.clientX, point.clientY]),
    setTimeout: clock.setTimeout,
  })
  return { clock, events, instance }
}

const point = (clientX, clientY, pointerId = 1) => ({ clientX, clientY, pointerId })

test('a drag is left to xterm: no hold ever fires once the finger travels', async () => {
  const { touchSelection } = await loadModules()
  const { clock, events, instance } = session(touchSelection)

  instance.pointerDown(point(100, 100))
  instance.pointerMove(point(100, 130))
  clock.runAll()
  instance.pointerUp(point(100, 200))

  assert.deepEqual(events, [])
  assert.equal(instance.isSelecting(), false)
})

test('a tap is left alone: releasing before the hold selects nothing', async () => {
  const { touchSelection } = await loadModules()
  const { clock, events, instance } = session(touchSelection)

  instance.pointerDown(point(40, 60))
  instance.pointerUp(point(40, 60))
  clock.runAll()

  assert.deepEqual(events, [])
  assert.equal(instance.isSelecting(), false)
})

test('a stationary hold selects, and the drag after it extends the selection', async () => {
  const { touchSelection } = await loadModules()
  const { clock, events, instance } = session(touchSelection)

  instance.pointerDown(point(40, 60))
  // Below the movement threshold: a finger is never perfectly still.
  instance.pointerMove(point(43, 62))
  clock.runAll()
  assert.equal(instance.isSelecting(), true)
  instance.pointerMove(point(300, 200))
  instance.pointerUp(point(300, 200))

  assert.deepEqual(events, [
    ['start', 40, 60],
    ['move', 300, 200],
    ['end', 300, 200],
  ])
  assert.equal(instance.isSelecting(), false)
})

test('the toggle off leaves every touch exactly as it is today', async () => {
  const { touchSelection } = await loadModules()
  const { clock, events, instance } = session(touchSelection, { enabled: false })

  instance.pointerDown(point(40, 60))
  clock.runAll()
  instance.pointerUp(point(40, 60))

  assert.deepEqual(events, [])
  assert.equal(clock.size, 0, 'a disabled gesture must not arm a timer at all')
})

test('a cancelled touch abandons the hold and reports no selection', async () => {
  const { touchSelection } = await loadModules()
  const { clock, events, instance } = session(touchSelection)

  instance.pointerDown(point(40, 60))
  instance.pointerCancel(point(40, 60))
  clock.runAll()

  assert.deepEqual(events, [])
  assert.equal(instance.isSelecting(), false)
})

test('a second finger mid-selection does not hijack the drag in progress', async () => {
  const { touchSelection } = await loadModules()
  const { clock, events, instance } = session(touchSelection)

  instance.pointerDown(point(40, 60, 1))
  clock.runAll()
  instance.pointerDown(point(200, 200, 2))
  instance.pointerMove(point(120, 90, 1))

  assert.equal(instance.isSelecting(), true)
  assert.deepEqual(events, [
    ['start', 40, 60],
    ['move', 120, 90],
  ])
})

function recordingElement() {
  const dispatched = []
  const element = {
    dispatchEvent: (event) => {
      dispatched.push(['screen', event.type, event.detail])
      return true
    },
  }
  element.ownerDocument = {
    dispatchEvent: (event) => {
      dispatched.push(['document', event.type, event.detail])
      return true
    },
  }
  return { dispatched, element }
}

function fakeMouseEvent() {
  // The modules under test build real MouseEvents; node has no DOM, so stand
  // in with the two fields the assertions read.
  globalThis.MouseEvent = class {
    constructor(type, init = {}) {
      this.type = type
      this.detail = init.detail
      Object.assign(this, init)
    }
  }
}

test('a hold in a mouse-tracking program borrows the selection back, then returns it', async () => {
  const { touchSelection } = await loadModules()
  fakeMouseEvent()
  const { dispatched, element } = recordingElement()
  const calls = []
  const terminal = {
    modes: { mouseTrackingMode: 'any' },
    _core: {
      _selectionService: {
        enable: () => calls.push('enable'),
        disable: () => calls.push('disable'),
      },
    },
  }

  const driver = touchSelection.createTerminalTouchSelectionDriver({
    screenElement: element,
    terminal,
  })
  driver.begin(point(10, 20))
  driver.extend(point(30, 40))
  driver.end(point(30, 40))

  assert.deepEqual(calls, ['enable', 'disable'])
  assert.deepEqual(dispatched, [
    ['screen', 'mousedown', 2],
    ['document', 'mousemove', 0],
    ['document', 'mouseup', 0],
  ])
})

test('a hold outside mouse tracking leaves the selection service untouched', async () => {
  const { touchSelection } = await loadModules()
  fakeMouseEvent()
  const { element } = recordingElement()
  const calls = []
  const driver = touchSelection.createTerminalTouchSelectionDriver({
    screenElement: element,
    terminal: {
      modes: { mouseTrackingMode: 'none' },
      _core: {
        _selectionService: {
          enable: () => calls.push('enable'),
          disable: () => calls.push('disable'),
        },
      },
    },
  })
  driver.begin(point(10, 20))
  driver.end(point(10, 20))

  assert.deepEqual(calls, [])
})

test('a tap replays the move and release xterm needs to activate a link', async () => {
  const { touchSelection } = await loadModules()
  fakeMouseEvent()
  const { dispatched, element } = recordingElement()
  const deferred = []

  touchSelection.activateTerminalLinkAtTouch({
    afterFrame: (run) => deferred.push(run),
    point: point(12, 34),
    screenElement: element,
    terminal: { modes: { mouseTrackingMode: 'none' } },
  })

  assert.deepEqual(dispatched, [['screen', 'mousemove', 0]])
  // Link resolution is asynchronous, so the release must wait a frame or the
  // linkifier has nothing to activate yet.
  for (const run of deferred) run()
  assert.deepEqual(dispatched, [
    ['screen', 'mousemove', 0],
    ['screen', 'mouseup', 1],
  ])
})

test('a tap inside a mouse-tracking program is left to the program', async () => {
  const { touchSelection } = await loadModules()
  fakeMouseEvent()
  const { dispatched, element } = recordingElement()

  touchSelection.activateTerminalLinkAtTouch({
    afterFrame: (run) => run(),
    point: point(12, 34),
    screenElement: element,
    terminal: { modes: { mouseTrackingMode: 'any' } },
  })

  assert.deepEqual(dispatched, [], 'a synthesised release would be a phantom button report')
})

test('the copy pill stays inside the panel, and below the finger when the top is out of room', async () => {
  const { touchSelection } = await loadModules()

  assert.deepEqual(
    touchSelection.touchSelectionCopyAnchor({
      height: 400,
      point: { x: 200, y: 300 },
      width: 600,
    }),
    { x: 158, y: 248 },
  )
  const nearTop = touchSelection.touchSelectionCopyAnchor({
    height: 400,
    point: { x: 4, y: 10 },
    width: 600,
  })
  assert.equal(nearTop.x, 0, 'clamped to the left edge rather than off it')
  assert.ok(nearTop.y > 10, 'flipped below the finger rather than off the top')
})

test('a touch tap opens a link without the modifier a touch device cannot hold', async () => {
  const { linkInteraction } = await loadModules()
  const opened = []
  let isTouch = false
  const interaction = linkInteraction.createTerminalLinkInteraction({
    isMac: true,
    isTouchActivation: () => isTouch,
    openExternal: (uri) => opened.push(uri),
    pointerTarget: { style: { cursor: '' } },
  })
  const event = () => ({ ctrlKey: false, metaKey: false, preventDefault: () => {} })

  interaction.activate(event(), 'https://example.com/one')
  assert.deepEqual(opened, [], 'a plain desktop click still must not open a link')

  isTouch = true
  interaction.activate(event(), 'https://example.com/two')
  assert.deepEqual(opened, ['https://example.com/two'])
})
