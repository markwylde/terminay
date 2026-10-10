import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FEATURE_CAPABILITIES,
  CLIENT_SERVER_COMPATIBILITY,
  WORKSPACE_CHANGE_RECORD_MAX_OBJECTS,
  WORKSPACE_DELTA_VERSION,
  WORKSPACE_RECORDS_DELTA_VERSION,
  parseWorkspaceChangeRecordDto,
  parseWorkspaceRecordsDeltaDto,
  workspaceDeltaVersionOf,
} from '../dist/index.js'

function record(fromRevision = 3, overrides = {}) {
  return {
    fromRevision,
    revision: fromRevision + 1,
    cursor: String(fromRevision + 1),
    type: 'panel.update',
    changed: { panels: { 'panel-a': { id: 'panel-a', title: 'api' } } },
    removed: {},
    ...overrides,
  }
}

function delta(overrides = {}) {
  return {
    deltaVersion: WORKSPACE_RECORDS_DELTA_VERSION,
    serverId: 'server-a',
    fromRevision: 3,
    fromCursor: '3',
    revision: 5,
    cursor: '5',
    records: [record(3), record(4, { changed: {}, removed: { panels: ['panel-a'] } })],
    ...overrides,
  }
}

const requested = { serverId: 'server-a', revision: 3, cursor: '3' }

test('a change record names whole objects by id and removed ids', () => {
  const value = record()
  assert.equal(parseWorkspaceChangeRecordDto(value), value)
  // A scoped record carries no command type.
  const { type: _type, ...scoped } = value
  assert.equal(parseWorkspaceChangeRecordDto(scoped), scoped)
  assert.equal(parseWorkspaceChangeRecordDto(record(3, { viewOrder: ['view-b', 'view-a'] })).viewOrder.length, 2)
  // Nothing visible changed, and the revision still advances.
  assert.deepEqual(parseWorkspaceChangeRecordDto(record(3, { changed: {}, removed: {} })).changed, {})
})

test('a malformed change record is refused whole', () => {
  const bad = [
    null,
    [],
    record(3, { revision: 6, cursor: '6' }),
    record(3, { cursor: '9' }),
    record(3, { type: '' }),
    record(3, { type: 7 }),
    record(3, { changed: [] }),
    record(3, { removed: null }),
    record(3, { changed: { gadgets: {} } }),
    record(3, { removed: { gadgets: [] } }),
    record(3, { changed: { panels: [] } }),
    record(3, { changed: { panels: { 'panel-a': 'api' } } }),
    // The object must be the one its key names.
    record(3, { changed: { panels: { 'panel-a': { id: 'panel-b' } } } }),
    record(3, { changed: { panels: { 'bad id': { id: 'bad id' } } } }),
    record(3, { removed: { panels: 'panel-a' } }),
    record(3, { removed: { panels: [7] } }),
    // An object cannot be both changed and removed.
    record(3, { removed: { panels: ['panel-a'] } }),
    record(3, { viewOrder: 'view-a' }),
    record(3, { viewOrder: [''] }),
  ]
  for (const value of bad)
    assert.throws(() => parseWorkspaceChangeRecordDto(value), /invalid workspace change record/, JSON.stringify(value))
})

test('an oversized change record is refused', () => {
  const panels = {}
  for (let index = 0; index <= WORKSPACE_CHANGE_RECORD_MAX_OBJECTS; index += 1) panels[`p${index}`] = { id: `p${index}` }
  assert.throws(() => parseWorkspaceChangeRecordDto(record(3, { changed: { panels } })), /invalid workspace change record/)
  const ids = Array.from({ length: WORKSPACE_CHANGE_RECORD_MAX_OBJECTS + 1 }, (_, index) => `p${index}`)
  assert.throws(() => parseWorkspaceChangeRecordDto(record(3, { changed: {}, removed: { panels: ids } })), /invalid workspace change record/)
})

test('a records delta is a contiguous chain bound to the request', () => {
  const value = delta()
  assert.equal(parseWorkspaceRecordsDeltaDto(value, requested), value)
  assert.equal(workspaceDeltaVersionOf(value), WORKSPACE_RECORDS_DELTA_VERSION)
  assert.throws(() => parseWorkspaceRecordsDeltaDto(value, { serverId: 'server-a', revision: 2, cursor: '2' }), /requested projection/)
  assert.throws(() => parseWorkspaceRecordsDeltaDto(value, { serverId: 'server-b', revision: 3, cursor: '3' }), /requested projection/)
  assert.throws(() => parseWorkspaceRecordsDeltaDto(delta({ records: [record(3)] }), requested), /invalid workspace delta/)
  assert.throws(() => parseWorkspaceRecordsDeltaDto(delta({ records: [record(4), record(3)] }), requested), /not contiguous/)
  assert.throws(() => parseWorkspaceRecordsDeltaDto(delta({ records: [record(3), record(3)] }), requested), /not contiguous/)
  assert.throws(() => parseWorkspaceRecordsDeltaDto(delta({ records: [record(3), { ...record(4), changed: [] }] }), requested), /invalid workspace change record/)
  assert.throws(() => parseWorkspaceRecordsDeltaDto(delta({ deltaVersion: WORKSPACE_DELTA_VERSION }), requested), /invalid workspace delta/)
  // Nothing happened since the requested revision.
  const empty = delta({ revision: 3, cursor: '3', records: [] })
  assert.equal(parseWorkspaceRecordsDeltaDto(empty, requested), empty)
})

test('a records delta whose history is gone carries a snapshot instead, never both', () => {
  const state = { schemaVersion: 6, serverId: 'server-a', revision: 5, cursor: '5' }
  const { records: _records, ...withoutRecords } = delta()
  const value = { ...withoutRecords, state }
  assert.equal(parseWorkspaceRecordsDeltaDto(value, requested), value)
  assert.throws(() => parseWorkspaceRecordsDeltaDto({ ...value, state: { ...state, revision: 4, cursor: '4' } }, requested), /does not match its envelope/)
  assert.throws(() => parseWorkspaceRecordsDeltaDto({ ...delta(), state }, requested), /invalid workspace delta/)
  assert.throws(() => parseWorkspaceRecordsDeltaDto(withoutRecords, requested), /invalid workspace delta/)
})

test('both new shapes are capabilities a client can do without', () => {
  assert.equal(FEATURE_CAPABILITIES.workspaceChanges, 'workspace-changes.v1')
  assert.equal(FEATURE_CAPABILITIES.terminalTitles, 'terminal-titles.v1')
  for (const capability of [FEATURE_CAPABILITIES.workspaceChanges, FEATURE_CAPABILITIES.terminalTitles]) {
    assert.equal(CLIENT_SERVER_COMPATIBILITY.optionalCapabilities.includes(capability), true)
    assert.equal(CLIENT_SERVER_COMPATIBILITY.requiredCapabilities.includes(capability), false)
  }
})
