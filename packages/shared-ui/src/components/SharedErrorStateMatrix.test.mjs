import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentStatusPanel } from './AgentStatusPanel.mjs'
import { createConnectionErrorPanel } from './ConnectionErrorPanel.mjs'
import { createFileViewerPanel } from './FileViewerPanel.mjs'
import { createGitStatusPanel } from './GitStatusPanel.mjs'
import { createMacroLibraryPanel } from './MacroLibraryPanel.mjs'
import { createRecordingsLibraryPanel } from './RecordingsLibraryPanel.mjs'
import { createSettingsPanel } from './SettingsPanel.mjs'
import { createTerminalSessionPanel } from './TerminalSessionPanel.mjs'

const errorPanels = Object.freeze([
  Object.freeze({
    name: 'terminal',
    create: layout => createTerminalSessionPanel({ terminalId: 'terminal-1', label: 'Build', status: 'failed', layout }),
    assert: panel => {
      assert.equal(panel.statusRegion.ariaLive, 'polite')
      assert.equal(panel.outputRegion.ariaLive, 'off')
      assert.equal(panel.retryAction?.id, 'retry-terminal')
    },
  }),
  Object.freeze({
    name: 'file',
    create: layout => createFileViewerPanel({ fileId: 'file-1', label: 'README.md', status: 'failed', layout }),
    assert: panel => {
      assert.equal(panel.statusRegion.ariaLive, 'polite')
      assert.equal(panel.contentRegion.ariaLive, 'off')
      assert.equal(panel.retryAction?.id, 'retry-file')
    },
  }),
  Object.freeze({
    name: 'Git',
    create: layout => createGitStatusPanel({ projectId: 'project-1', label: 'Terminay', status: 'failed', layout }),
    assert: panel => assert.equal(panel.retryAction?.id, 'retry-git-status'),
  }),
  Object.freeze({
    name: 'agent',
    create: layout => createAgentStatusPanel({
      layout,
      selectedAgentId: 'agent-1',
      agents: [{ id: 'agent-1', label: 'Codex', status: 'failed' }],
    }),
    assert: panel => {
      assert.equal(panel.summary.failed, 1)
      assert.equal(panel.list.items[0].selectAction.id, 'select-agent')
    },
  }),
  Object.freeze({
    name: 'macro',
    create: layout => createMacroLibraryPanel({ macros: [], status: 'failed', layout }),
    assert: panel => assert.equal(panel.retryAction?.id, 'retry-macros'),
  }),
  Object.freeze({
    name: 'recording',
    create: layout => createRecordingsLibraryPanel({ recordings: [], status: 'failed', layout }),
    assert: panel => assert.equal(panel.retryAction?.id, 'retry-recordings'),
  }),
  Object.freeze({
    name: 'settings',
    create: layout => createSettingsPanel({ sections: [], status: 'failed', layout }),
    assert: panel => assert.equal(panel.retryAction?.id, 'retry-settings'),
  }),
  Object.freeze({
    name: 'connection',
    create: layout => createConnectionErrorPanel({ status: 'unreachable', serverLabel: 'Terminay server', layout }),
    assert: panel => {
      assert.equal(panel.role, 'alert')
      assert.equal(panel.ariaLive, 'assertive')
      assert.equal(panel.actions[0].id, 'retry')
    },
  }),
])

test('shared failure states preserve accessible recovery semantics at wide and narrow widths', () => {
  for (const entry of errorPanels) {
    const wide = entry.create('wide')
    const narrow = entry.create('narrow')

    assert.equal(wide.layout, 'wide', `${entry.name} must retain the wide layout contract`)
    assert.equal(narrow.layout, 'narrow', `${entry.name} must retain the narrow layout contract`)
    entry.assert(wide)
    entry.assert(narrow)

    const actions = [
      ...(wide.retryAction === undefined ? [] : [wide.retryAction]),
      ...(wide.actions ?? []),
      ...(wide.list?.items ?? []).map(item => item.selectAction),
    ]
    assert.ok(actions.length > 0, `${entry.name} must expose a recovery or selection intent`)
    assert.ok(actions.every(action => action.minTouchTargetPx >= 44), `${entry.name} intents must remain touch-safe`)
  }
})
