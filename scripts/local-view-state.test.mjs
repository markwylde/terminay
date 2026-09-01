import assert from 'node:assert/strict'
import test from 'node:test'
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
async function loadModule() {
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
  const module = await import(`file://${outfile}`)
  return { module, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

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
  const { module, cleanup } = await loadModule()
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
    await cleanup()
  }
})

test('a terminal this device created or dragged in becomes active', async () => {
  const { module, cleanup } = await loadModule()
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
    await cleanup()
  }
})

test('a device showing nothing adopts its first terminal rather than staying blank', async () => {
  const { module, cleanup } = await loadModule()
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
    await cleanup()
  }
})

test('a reconnecting device restores its own remembered tab, not another device\'s', async () => {
  const { module, cleanup } = await loadModule()
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
    await cleanup()
  }
})

test('a remembered tab is a hint: a workspace that changed entirely just falls back', async () => {
  const { module, cleanup } = await loadModule()
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
    await cleanup()
  }
})

test('selection is remembered per project and per device', async () => {
  const { module, cleanup } = await loadModule()
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
    await cleanup()
  }
})

test('unavailable, corrupt, or throwing storage degrades to no memory', async () => {
  const { module, cleanup } = await loadModule()
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
    await cleanup()
  }
})

test('remembered projects are bounded so a long-lived profile cannot grow forever', async () => {
  const { module, cleanup } = await loadModule()
  try {
    globalThis.localStorage = fakeStorage()
    for (let index = 0; index < 200; index += 1)
      module.rememberActiveSession(`project-${index}`, `session-${index}`)
    const stored = JSON.parse(globalThis.localStorage.getItem('terminay.view.active-session.v1'))
    assert.ok(Object.keys(stored).length <= 64, `bounded, got ${Object.keys(stored).length}`)
    assert.equal(module.recallActiveSession('project-199'), 'session-199', 'the most recent survives')
  } finally {
    delete globalThis.localStorage
    await cleanup()
  }
})
