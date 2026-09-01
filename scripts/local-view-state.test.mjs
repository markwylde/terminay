import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Which terminal a device is looking at is that device's business.
 *
 * The workspace's contents are shared and must sync: a terminal existing, its
 * name, its project, its output, its removal. The selection is not. A remote
 * that jumps to a terminal the desktop just created has dragged its user off
 * whatever they were reading, for a change they never asked for.
 */
/** Compiled once and shared. Each test resets the storage it observes, so a
 * per-test rebuild bought nothing and cost an esbuild run apiece. */
let compiled
async function loadModule() {
  compiled ??= (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'terminay-local-view-state-'))
    const outfile = join(directory, 'localViewState.mjs')
    await build({
      entryPoints: ['src/workspace/localViewState.ts'],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      logLevel: 'silent',
    })
    return { module: await import(`file://${outfile}`), directory }
  })()
  const { module } = await compiled
  return { module }
}

after(async () => {
  if (compiled === undefined) return
  const { directory } = await compiled
  await rm(directory, { recursive: true, force: true })
})

function fakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
    get size() { return store.size },
    raw: store,
  }
}

test('a terminal created on another device never steals this device\'s tab', async () => {
  const { module } = await loadModule()
  try {
    assert.equal(
      module.shouldActivateAdoptedTerminal({
        requestedLocally: false,
        hasActivePanel: true,
        sessionId: 'session-3',
      }),
      false,
    )
  } finally {
    /* the compiled module is shared; cleaned up by the process exit */
  }
})

test('a terminal this device created or dragged in becomes active', async () => {
  const { module } = await loadModule()
  try {
    assert.equal(
      module.shouldActivateAdoptedTerminal({
        requestedLocally: true,
        hasActivePanel: true,
        sessionId: 'session-3',
      }),
      true,
    )
  } finally {
    /* the compiled module is shared; cleaned up by the process exit */
  }
})

test('a device showing nothing adopts its first terminal rather than staying blank', async () => {
  const { module } = await loadModule()
  try {
    assert.equal(
      module.shouldActivateAdoptedTerminal({
        requestedLocally: false,
        hasActivePanel: false,
        sessionId: 'session-1',
      }),
      true,
      'a fresh device needs a default, taken from what it adopts first',
    )
    // ...and having taken one, it stops taking them.
    assert.equal(
      module.shouldActivateAdoptedTerminal({
        requestedLocally: false,
        hasActivePanel: true,
        sessionId: 'session-2',
      }),
      false,
    )
  } finally {
    /* the compiled module is shared; cleaned up by the process exit */
  }
})

test('a reconnecting device restores its own remembered tab, not another device\'s', async () => {
  const { module } = await loadModule()
  try {
    assert.equal(
      module.shouldActivateAdoptedTerminal({
        requestedLocally: false,
        hasActivePanel: true,
        rememberedSessionId: 'session-7',
        sessionId: 'session-7',
      }),
      true,
    )
    assert.equal(
      module.shouldActivateAdoptedTerminal({
        requestedLocally: false,
        hasActivePanel: true,
        rememberedSessionId: 'session-7',
        sessionId: 'session-9',
      }),
      false,
      'other terminals adopted in the same pass must not take the tab',
    )
  } finally {
    /* the compiled module is shared; cleaned up by the process exit */
  }
})

test('a remembered tab is a hint: a workspace that changed entirely just falls back', async () => {
  const { module } = await loadModule()
  try {
    globalThis.localStorage = fakeStorage()
    module.rememberActiveSession('project-a', 'session-gone')
    // Reconnected to a workspace whose terminals are all different.
    assert.equal(
      module.shouldActivateAdoptedTerminal({
        requestedLocally: false,
        hasActivePanel: false,
        rememberedSessionId: module.recallActiveSession('project-a'),
        sessionId: 'session-brand-new',
      }),
      true,
      'the blank-device rule still supplies a default when the memory misses',
    )
  } finally {
    delete globalThis.localStorage
  }
})

test('selection is remembered per project and per device', async () => {
  const { module } = await loadModule()
  try {
    globalThis.localStorage = fakeStorage()
    module.rememberActiveSession('project-a', 'session-1')
    module.rememberActiveSession('project-b', 'session-2')
    assert.equal(module.recallActiveSession('project-a'), 'session-1')
    assert.equal(module.recallActiveSession('project-b'), 'session-2')
    module.rememberActiveSession('project-a', 'session-3')
    assert.equal(module.recallActiveSession('project-a'), 'session-3')
    module.forgetActiveSession('project-a')
    assert.equal(module.recallActiveSession('project-a'), undefined)
    assert.equal(module.recallActiveSession('project-b'), 'session-2')
  } finally {
    delete globalThis.localStorage
  }
})

test('unavailable, corrupt, or throwing storage degrades to no memory', async () => {
  const { module } = await loadModule()
  try {
    delete globalThis.localStorage
    assert.equal(module.recallActiveSession('project-a'), undefined)
    module.rememberActiveSession('project-a', 'session-1')

    globalThis.localStorage = fakeStorage({ 'terminay.view.active-session.v1': '{not json' })
    assert.equal(module.recallActiveSession('project-a'), undefined)

    globalThis.localStorage = {
      getItem: () => { throw new Error('storage disabled') },
      setItem: () => { throw new Error('storage disabled') },
    }
    assert.equal(module.recallActiveSession('project-a'), undefined)
    module.rememberActiveSession('project-a', 'session-1')
  } finally {
    delete globalThis.localStorage
  }
})

test('remembered projects are bounded so a long-lived profile cannot grow forever', async () => {
  const { module } = await loadModule()
  try {
    globalThis.localStorage = fakeStorage()
    for (let index = 0; index < 200; index += 1)
      module.rememberActiveSession(`project-${index}`, `session-${index}`)
    const stored = JSON.parse(globalThis.localStorage.getItem('terminay.view.active-session.v1'))
    assert.ok(Object.keys(stored).length <= 64, `bounded, got ${Object.keys(stored).length}`)
    assert.equal(module.recallActiveSession('project-199'), 'session-199', 'the most recent survives')
  } finally {
    delete globalThis.localStorage
  }
})

/**
 * The reload regression.
 *
 * Restoring a workspace adopts terminals one at a time. The first one activates
 * itself because nothing is selected yet, and that activation is recorded as
 * this device's choice — which erases the memory of the terminal actually being
 * restored, before its panel is adopted. The reload then landed on the first
 * terminal instead of the one the user was on.
 *
 * The memory must be read once, before any adoption, and spent once.
 */
test('restoring a workspace does not let the first terminal erase the remembered one', async () => {
  const { module } = await loadModule()
  try {
    globalThis.localStorage = fakeStorage()
    // The user was on the second terminal when the window reloaded.
    module.rememberActiveSession('default', 'desktop-abc:session:1')

    // Read once, before anything is adopted. This is the fix: re-reading storage
    // per adoption would observe the clobbering write below.
    const snapshot = module.recallActiveSession('default')

    const adopted = []
    let hasActivePanel = false
    for (const sessionId of ['default', 'desktop-abc:session:1']) {
      const activate = module.shouldActivateAdoptedTerminal({
        requestedLocally: false,
        hasActivePanel,
        rememberedSessionId: snapshot,
        sessionId,
      })
      if (activate) {
        hasActivePanel = true
        adopted.push(sessionId)
        // Activating records this device's choice, exactly as the panel
        // lifecycle does. This is the write that used to destroy the memory.
        module.rememberActiveSession('default', sessionId)
      }
    }

    assert.deepEqual(
      adopted,
      ['default', 'desktop-abc:session:1'],
      'the first terminal seeds the view, then the remembered one takes it back',
    )
    assert.equal(
      module.recallActiveSession('default'),
      'desktop-abc:session:1',
      'the restored terminal is what this device remembers going forward',
    )
  } finally {
    delete globalThis.localStorage
  }
})

test('a remembered selection is spent once and cannot pull focus back later', async () => {
  const { module } = await loadModule()
  try {
    const snapshot = 'desktop-abc:session:1'
    assert.equal(
      module.shouldActivateAdoptedTerminal({
        requestedLocally: false,
        hasActivePanel: true,
        rememberedSessionId: snapshot,
        sessionId: snapshot,
      }),
      true,
      'restored on first sight',
    )
    // Once consumed the caller drops the snapshot, so a later adoption of any
    // terminal cannot steal focus from whatever the user has since chosen.
    assert.equal(
      module.shouldActivateAdoptedTerminal({
        requestedLocally: false,
        hasActivePanel: true,
        rememberedSessionId: undefined,
        sessionId: snapshot,
      }),
      false,
    )
  } finally {
    delete globalThis.localStorage
  }
})

/**
 * The test above simulates the adoption loop, so this ties that invariant to
 * the controller that actually runs it: the remembered session must be read
 * into a ref once, not re-read from storage on every adoption.
 */
test('the adoption controller reads the remembered session once, not per adoption', async () => {
  const source = await readFile('src/workspace/useTerminalAdoptionController.ts', 'utf8')
  const calls = source.match(/recallActiveSession\(/gu) ?? []
  assert.equal(calls.length, 1, 'exactly one read of persisted storage')
  assert.match(
    source,
    /rememberedSessionRef\.current === null\s*\)?\s*\n?\s*rememberedSessionRef\.current = recallActiveSession/u,
    'the single read is guarded so it happens once per project view',
  )
  assert.match(
    source,
    /rememberedSessionRef\.current = undefined/u,
    'and the restored selection is spent so it cannot pull focus back later',
  )
})
