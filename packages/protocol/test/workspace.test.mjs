import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWorkspaceDeltaDto, WORKSPACE_DELTA_VERSION } from '../dist/index.js'

function delta() {
  return {
    deltaVersion: WORKSPACE_DELTA_VERSION,
    serverId: 'server-a',
    fromRevision: 3,
    fromCursor: '3',
    revision: 5,
    cursor: '5',
    state: { schemaVersion: 2, serverId: 'server-a', revision: 5, cursor: '5' },
    events: [
      { revision: 4, cursor: '4', commandId: 'command-4', type: 'panel.create', changedIds: ['panel-a'] },
      { revision: 5, cursor: '5', commandId: 'command-5', type: 'panel.activate', changedIds: ['panel-a'] },
    ],
  }
}

test('workspace delta binds the request boundary, result state, and ordered event bounds', () => {
  const value = delta()
  assert.equal(parseWorkspaceDeltaDto(value, { serverId: 'server-a', revision: 3, cursor: '3' }), value)
  assert.throws(() => parseWorkspaceDeltaDto(value, { serverId: 'server-a', revision: 2, cursor: '2' }), /requested projection/)
  assert.throws(() => parseWorkspaceDeltaDto({ ...value, revision: 6, cursor: '6' }, { serverId: 'server-a', revision: 3, cursor: '3' }), /does not match its envelope/)
  assert.throws(() => parseWorkspaceDeltaDto({ ...value, events: [...value.events].reverse() }, { serverId: 'server-a', revision: 3, cursor: '3' }), /delta event/)
})
