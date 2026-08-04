import assert from 'node:assert/strict'
import test from 'node:test'
import { AI_TAB_METADATA_TOUCH_TARGET_PX, createAiTabMetadataPanel } from './AiTabMetadataPanel.mjs'

const readyInput = Object.freeze({
  tabId: 'tab-42',
  tabLabel: 'Release checklist',
  status: 'ready',
  metadata: { title: 'Release checklist', icon: 'rocket', colour: '#12A4f0' },
})

test('AI tab metadata uses one bounded accessible model at wide and narrow widths', () => {
  const wide = createAiTabMetadataPanel({ ...readyInput, layout: 'wide' })
  const narrow = createAiTabMetadataPanel({ ...readyInput, layout: 'narrow' })

  assert.equal(wide.role, 'region')
  assert.equal(wide.ariaLabel, 'AI tab metadata for Release checklist')
  assert.equal(wide.statusRegion.role, 'status')
  assert.equal(wide.statusRegion.ariaLive, 'polite')
  assert.equal(wide.statusRegion.ariaBusy, false)
  assert.deepEqual(wide.metadata, { title: 'Release checklist', icon: 'rocket', colour: '#12a4f0' })
  assert.equal(wide.regenerateAction, undefined)
  assert.deepEqual(narrow.metadata, wide.metadata)
  assert.equal(narrow.layout, 'narrow')
})

test('AI tab metadata distinguishes loading and recoverable server states', () => {
  const loading = createAiTabMetadataPanel({ tabId: 'tab-42', tabLabel: 'Release checklist', status: 'loading', layout: 'wide' })
  const failed = createAiTabMetadataPanel({ tabId: 'tab-42', tabLabel: 'Release checklist', status: 'failed', layout: 'narrow', detail: 'Provider timeout' })
  const disabled = createAiTabMetadataPanel({ tabId: 'tab-42', tabLabel: 'Release checklist', status: 'disabled', layout: 'wide' })

  assert.equal(loading.statusRegion.ariaBusy, true)
  assert.equal(loading.regenerateAction, undefined)
  assert.equal(failed.regenerateAction.id, 'regenerate-tab-metadata')
  assert.equal(failed.regenerateAction.tabId, 'tab-42')
  assert.ok(failed.regenerateAction.minTouchTargetPx >= AI_TAB_METADATA_TOUCH_TARGET_PX)
  assert.equal(disabled.regenerateAction, undefined)
})

test('AI tab metadata fails closed for unsafe, malformed, and contradictory input', () => {
  assert.throws(
    () => createAiTabMetadataPanel({ ...readyInput, layout: 'wide', metadata: { title: 'Bad', colour: 'red' } }),
    /six-digit hex/u,
  )
  assert.throws(
    () => createAiTabMetadataPanel({ ...readyInput, layout: 'wide', metadata: { title: 'Bad\nvalue' } }),
    /safe title/u,
  )
  assert.throws(
    () => createAiTabMetadataPanel({ tabId: 'tab-42', tabLabel: 'Release checklist', status: 'ready', layout: 'wide' }),
    /requires metadata/u,
  )
  assert.throws(
    () => createAiTabMetadataPanel({ ...readyInput, status: 'failed', layout: 'wide' }),
    /Only ready/u,
  )
})
