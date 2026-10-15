import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLIENT_SERVER_COMPATIBILITY,
  FEATURE_CAPABILITIES,
  MAX_BROWSE_ROOT_FOLDER_ENTRIES,
  MAX_RECENT_PROJECT_FOLDERS,
  PROJECT_START_OPERATIONS,
  PROJECT_START_REFUSALS,
  parseBrowseRootFoldersRequest,
  parseBrowseRootFoldersResult,
  parseProjectStartRequest,
  parseProjectStartResult,
  parseRecentForgetRequest,
  parseRecentListResult,
  parseWorkspaceChangeRecordDto,
} from '../dist/index.js'

test('the start choice is a versioned feature capability with stable operation names', () => {
  assert.equal(FEATURE_CAPABILITIES.projectStartChoice, 'project-start-choice.v1')
  assert.deepEqual({ ...PROJECT_START_OPERATIONS }, {
    start: 'project.start',
    recentList: 'recent.list',
    recentForget: 'recent.forget',
    browseRootFolders: 'fs.browseRootFolders',
  })
  assert.equal(PROJECT_START_REFUSALS.startConflict, 'start_conflict')
  assert.equal(PROJECT_START_REFUSALS.noProjectRoot, 'no_project_root')
  assert.equal(MAX_RECENT_PROJECT_FOLDERS, 50)
  assert.equal(MAX_BROWSE_ROOT_FOLDER_ENTRIES, 1000)
  // Asked of a server by the bundle's client, never required.
  assert.equal(CLIENT_SERVER_COMPATIBILITY.requiredCapabilities.includes(FEATURE_CAPABILITIES.projectStartChoice), false)
  assert.equal(CLIENT_SERVER_COMPATIBILITY.optionalCapabilities.includes(FEATURE_CAPABILITIES.projectStartChoice), true)
})

test('project.start accepts a folder or home choice and nothing else', () => {
  assert.deepEqual(parseProjectStartRequest({ projectId: 'project-a', choice: { kind: 'home' } }), { projectId: 'project-a', choice: { kind: 'home' } })
  assert.deepEqual(parseProjectStartRequest({ projectId: 'project-a', choice: { kind: 'folder', path: '/srv/a' } }), { projectId: 'project-a', choice: { kind: 'folder', path: '/srv/a' } })
  for (const malformed of [
    undefined,
    { choice: { kind: 'home' } },
    { projectId: '', choice: { kind: 'home' } },
    { projectId: 'project a', choice: { kind: 'home' } },
    { projectId: 'project-a' },
    { projectId: 'project-a', choice: { kind: 'recent', path: '/srv/a' } },
    { projectId: 'project-a', choice: { kind: 'folder' } },
    { projectId: 'project-a', choice: { kind: 'folder', path: '' } },
    { projectId: 'project-a', choice: { kind: 'folder', path: 'a\0b' } },
    { projectId: 'project-a', choice: { kind: 'folder', path: 'x'.repeat(4097) } },
    { projectId: 'project-a', choice: { kind: 'home', path: '/srv/a' } },
  ]) assert.throws(() => parseProjectStartRequest(malformed), /invalid/, JSON.stringify(malformed))
})

test('a project.start result pairs an explicit root with a path and no root with none', () => {
  assert.equal(parseProjectStartResult({ projectId: 'p', root: '/srv/a', rootOrigin: 'explicit', revision: 3, cursor: '3' }).root, '/srv/a')
  assert.equal(parseProjectStartResult({ projectId: 'p', root: '', rootOrigin: 'none', revision: 3, cursor: '3' }).rootOrigin, 'none')
  for (const malformed of [
    { projectId: 'p', root: '/srv/a', rootOrigin: 'none', revision: 3, cursor: '3' },
    { projectId: 'p', root: '', rootOrigin: 'explicit', revision: 3, cursor: '3' },
    { projectId: 'p', root: '/srv/a', rootOrigin: 'server-default', revision: 3, cursor: '3' },
    { projectId: 'p', root: '/srv/a', rootOrigin: 'explicit', revision: 3, cursor: '4' },
  ]) assert.throws(() => parseProjectStartResult(malformed), /invalid/)
})

test('recent.forget names one path', () => {
  assert.deepEqual(parseRecentForgetRequest({ path: '/srv/a' }), { path: '/srv/a' })
  for (const malformed of [undefined, {}, { path: '' }, { path: 3 }, { path: '/a', extra: true }])
    assert.throws(() => parseRecentForgetRequest(malformed), /invalid/)
})

test('recent.list entries are bounded, unique, and say whether each folder is available', () => {
  const entry = (path, available = true) => ({ path, usedAt: 1, available })
  assert.equal(parseRecentListResult({ revision: 2, entries: [entry('/a'), entry('/b', false)] }).entries.length, 2)
  for (const malformed of [
    { revision: 2, entries: [entry('/a'), entry('/a')] },
    { revision: 2, entries: [{ path: '/a', usedAt: 1 }] },
    { revision: 2, entries: [{ path: '/a', usedAt: -1, available: true }] },
    { revision: 2, entries: Array.from({ length: 51 }, (_, i) => entry(`/f${i}`)) },
    { entries: [] },
  ]) assert.throws(() => parseRecentListResult(malformed), /invalid/)
})

test('fs.browseRootFolders takes an optional path and answers with directory names only', () => {
  assert.deepEqual(parseBrowseRootFoldersRequest(undefined), {})
  assert.deepEqual(parseBrowseRootFoldersRequest({}), {})
  assert.deepEqual(parseBrowseRootFoldersRequest({ path: '/srv' }), { path: '/srv' })
  for (const malformed of [{ path: '' }, { path: 4 }, { path: '/a', depth: 2 }, []])
    assert.throws(() => parseBrowseRootFoldersRequest(malformed), /invalid/)
  const result = { path: '/srv', parent: '/', entries: [{ name: 'a' }, { name: 'b' }], truncated: false }
  assert.deepEqual(parseBrowseRootFoldersResult(result), result)
  assert.equal(parseBrowseRootFoldersResult({ path: '/', entries: [], truncated: false }).parent, undefined)
  for (const malformed of [
    { ...result, entries: [{ name: 'a', size: 10 }] },
    { ...result, entries: [{ name: '..' }] },
    { ...result, entries: [{ name: 'a/b' }] },
    { ...result, truncated: 'no' },
    { ...result, entries: Array.from({ length: 1001 }, (_, i) => ({ name: `d${i}` })) },
  ]) assert.throws(() => parseBrowseRootFoldersResult(malformed), /invalid/)
})

test('a change record carries the recent project folders when they changed', () => {
  const base = { fromRevision: 1, revision: 2, cursor: '2', changed: {}, removed: {} }
  assert.deepEqual(parseWorkspaceChangeRecordDto({ ...base, recentProjectFolders: [{ path: '/a', usedAt: 4 }] }).recentProjectFolders, [{ path: '/a', usedAt: 4 }])
  assert.deepEqual(parseWorkspaceChangeRecordDto({ ...base, recentProjectFolders: [] }).recentProjectFolders, [])
  for (const recentProjectFolders of [{}, [{ path: '' , usedAt: 1 }], [{ path: '/a' }], Array.from({ length: 51 }, (_, i) => ({ path: `/f${i}`, usedAt: i }))])
    assert.throws(() => parseWorkspaceChangeRecordDto({ ...base, recentProjectFolders }), /invalid workspace change record/)
})
