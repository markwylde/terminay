import assert from 'node:assert/strict'
import test from 'node:test'
import { SETTINGS_PANEL_TOUCH_TARGET_PX, createSettingsPanel } from './SettingsPanel.mjs'

const sections = [
  { id: 'appearance', label: 'Appearance', description: 'Theme and font preferences' },
  { id: 'terminal', label: 'Terminal' },
]

test('settings panels provide one accessible wide and narrow section contract', () => {
  const wide = createSettingsPanel({ sections, selectedSectionId: 'appearance', status: 'ready', layout: 'wide' })
  const narrow = createSettingsPanel({ sections, selectedSectionId: 'appearance', status: 'ready', layout: 'narrow' })

  assert.equal(wide.role, 'region')
  assert.equal(wide.ariaLabel, 'Settings')
  assert.deepEqual(wide.statusRegion, { role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: false })
  assert.deepEqual(wide.sectionList, {
    role: 'tablist',
    ariaLabel: 'Settings sections',
    items: [
      {
        id: 'appearance', label: 'Appearance', description: 'Theme and font preferences', role: 'tab', ariaSelected: true, tabIndex: 0,
        selectAction: { id: 'select-settings-section', sectionId: 'appearance', label: 'Open Appearance settings', minTouchTargetPx: SETTINGS_PANEL_TOUCH_TARGET_PX },
      },
      {
        id: 'terminal', label: 'Terminal', description: undefined, role: 'tab', ariaSelected: false, tabIndex: -1,
        selectAction: { id: 'select-settings-section', sectionId: 'terminal', label: 'Open Terminal settings', minTouchTargetPx: SETTINGS_PANEL_TOUCH_TARGET_PX },
      },
    ],
  })
  assert.deepEqual({ ...narrow, layout: 'wide' }, wide)
})

test('settings panels distinguish loading, unavailable, forbidden, and retryable failure', () => {
  const loading = createSettingsPanel({ sections: [], status: 'loading', layout: 'narrow' })
  const unavailable = createSettingsPanel({ sections: [], status: 'unavailable', layout: 'wide' })
  const forbidden = createSettingsPanel({ sections: [], status: 'forbidden', layout: 'wide' })
  const failed = createSettingsPanel({ sections: [], status: 'failed', layout: 'wide' })

  assert.equal(loading.statusRegion.ariaBusy, true)
  assert.equal(unavailable.retryAction, undefined)
  assert.equal(forbidden.retryAction, undefined)
  assert.deepEqual(failed.retryAction, {
    id: 'retry-settings', label: 'Retry settings', minTouchTargetPx: SETTINGS_PANEL_TOUCH_TARGET_PX,
  })
})

test('settings panels fail closed for unsafe or structurally invalid state', () => {
  assert.throws(
    () => createSettingsPanel({ sections: [{ id: 'bad id', label: 'One' }], status: 'ready', layout: 'wide' }),
    /safe settings section id/u,
  )
  assert.throws(
    () => createSettingsPanel({ sections: [{ id: 'one', label: 'bad\nlabel' }], status: 'ready', layout: 'wide' }),
    /safe, non-empty text/u,
  )
  assert.throws(
    () => createSettingsPanel({ sections: [{ id: 'one', label: 'One' }, { id: 'one', label: 'Two' }], status: 'ready', layout: 'wide' }),
    /must be unique/u,
  )
  assert.throws(
    () => createSettingsPanel({ sections, selectedSectionId: 'missing', status: 'ready', layout: 'wide' }),
    /must identify a section/u,
  )
  assert.throws(
    () => createSettingsPanel({ sections, status: 'ready', layout: 'medium' }),
    /wide or narrow/u,
  )
})
