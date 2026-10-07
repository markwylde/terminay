import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AiMetadataService,
  AiServiceError,
  MAX_PANEL_NOTE_CHARS,
  TerminalReplayRegistry,
  WorkspaceStore,
  canonicalizeWorkspaceState,
  createInitialWorkspace,
  createWorkspaceAiTargetAuthority,
  createWorkspaceOperationRegistry,
  validateWorkspace,
} from '../dist/index.js'

const serverId = 'server-a'
const target = { serverId, projectId: 'project-a', panelId: 'panel-a', sessionId: 'session-a' }

function createStore() {
  const store = new WorkspaceStore(createInitialWorkspace(serverId))
  const viewId = store.state.viewOrder[0]
  assert.equal(store.apply({ commandId: 'project', command: { type: 'project.create', projectId: 'project-a', viewId, root: '/tmp/a', name: 'A' } }).ok, true)
  assert.equal(store.apply({ commandId: 'terminal', command: { type: 'terminal.createPanel', projectId: 'project-a', sessionId: 'session-a', panelId: 'panel-a', title: 'Terminal 1' } }).ok, true)
  return store
}

let sequence = 0
function update(store, patch, panelId = 'panel-a') {
  sequence += 1
  return store.apply({ commandId: `update-${sequence}`, command: { type: 'panel.update', panelId, patch } })
}

function revision(store) {
  return store.state.panels['panel-a'].metadataRevision ?? 0
}

test('terminal panel state without note or metadata revision still validates', () => {
  const store = createStore()
  const panel = store.state.panels['panel-a']
  assert.equal(Object.hasOwn(panel, 'note'), false)
  assert.equal(Object.hasOwn(panel, 'metadataRevision'), false)
  validateWorkspace(store.state)
  assert.deepEqual(canonicalizeWorkspaceState(store.state).panels['panel-a'], panel)
})

test('metadata revision advances only when the title or note changes value', () => {
  const store = createStore()
  assert.equal(update(store, { title: 'Build' }).ok, true)
  assert.equal(revision(store), 1)
  assert.equal(update(store, { title: 'Build' }).ok, true)
  assert.equal(revision(store), 1)
  assert.equal(update(store, { color: '#123456', emoji: '⚡' }).ok, true)
  assert.equal(revision(store), 1)
  assert.equal(update(store, { note: 'Watching the build' }).ok, true)
  assert.equal(revision(store), 2)
  assert.equal(store.state.panels['panel-a'].note, 'Watching the build')
  assert.equal(update(store, { note: null }).ok, true)
  assert.equal(revision(store), 3)
  assert.equal(Object.hasOwn(store.state.panels['panel-a'], 'note'), false)
  const canonical = canonicalizeWorkspaceState(store.state).panels['panel-a']
  assert.equal(canonical.metadataRevision, 3)
})

test('a note survives canonicalization and an empty note is still a note', () => {
  const store = createStore()
  assert.equal(update(store, { note: '' }).ok, true)
  assert.equal(store.state.panels['panel-a'].note, '')
  assert.equal(revision(store), 1)
  assert.equal(canonicalizeWorkspaceState(store.state).panels['panel-a'].note, '')
})

test('a client patch cannot set the metadata revision or an invalid note', () => {
  const store = createStore()
  const before = store.state.revision
  assert.equal(update(store, { metadataRevision: 40 }).ok, false)
  assert.equal(update(store, { note: 'x'.repeat(MAX_PANEL_NOTE_CHARS + 1) }).ok, false)
  assert.equal(update(store, { note: 7 }).ok, false)
  assert.equal(update(store, { note: 'a\0b' }).ok, false)
  assert.equal(store.state.revision, before)
  assert.equal(revision(store), 0)
  assert.equal(update(store, { note: 'x'.repeat(MAX_PANEL_NOTE_CHARS) }).ok, true)
})

test('stored state with an oversized note fails validation', () => {
  const store = createStore()
  const state = structuredClone(store.state)
  state.panels['panel-a'].note = 'x'.repeat(MAX_PANEL_NOTE_CHARS + 1)
  assert.throws(() => validateWorkspace(state), /note is invalid/)
})

test('the workspace protocol bounds a note the same way', async () => {
  const store = createStore()
  const registry = createWorkspaceOperationRegistry(store)
  const command = registry.operations.commands['workspace.command']
  let protocolSequence = 0
  const nextCommandId = () => {
    protocolSequence += 1
    return `protocol-${protocolSequence}`
  }
  const request = (patch) => ({
    envelope: { commandId: nextCommandId(), payload: { command: { type: 'panel.update', panelId: 'panel-a', patch } } },
    context: { clientId: 'client-a', authScope: 'admin', permissions: ['workspace:write'], signal: new AbortController().signal },
    body: new Uint8Array(),
  })
  await command(request({ note: 'From a client' }))
  assert.equal(store.state.panels['panel-a'].note, 'From a client')
  await assert.rejects(async () => command(request({ note: 'x'.repeat(MAX_PANEL_NOTE_CHARS + 1) })))
  await assert.rejects(async () => command(request({ note: 7 })))
  assert.equal(store.state.panels['panel-a'].note, 'From a client')
})

function createAuthority(store, sessions = { 'session-a': { projectId: 'project-a', status: 'running' } }) {
  const registry = createWorkspaceOperationRegistry(store)
  return createWorkspaceAiTargetAuthority({
    serverId,
    state: () => store.state,
    applyHostCommand: (commandId, command) => registry.applyHostCommand(commandId, command),
    getSession: (sessionId) => sessions[sessionId],
  })
}

test('the workspace AI authority reports and applies canonical title and note', () => {
  const store = createStore()
  const authority = createAuthority(store)
  assert.deepEqual(authority.getTarget(target), { ...target, live: true, metadataRevision: 0, title: 'Terminal 1', note: '' })
  assert.deepEqual(authority.applyMetadata(target, 'title', 'Build Warnings', 0), { revision: 1 })
  assert.equal(store.state.panels['panel-a'].title, 'Build Warnings')
  assert.deepEqual(authority.applyMetadata(target, 'note', 'Reviewing warnings', 1), { revision: 2 })
  assert.equal(store.state.panels['panel-a'].note, 'Reviewing warnings')
  assert.equal(authority.getTarget(target).note, 'Reviewing warnings')
})

test('the workspace AI authority rejects a stale revision and leaves state unchanged', () => {
  const store = createStore()
  const authority = createAuthority(store)
  assert.equal(update(store, { title: 'Mine' }).ok, true)
  const before = store.state.revision
  assert.throws(
    () => authority.applyMetadata(target, 'title', 'Build Warnings', 0),
    (error) => error instanceof AiServiceError && error.code === 'revision_conflict',
  )
  assert.equal(store.state.revision, before)
  assert.equal(store.state.panels['panel-a'].title, 'Mine')
})

test('the workspace AI authority refuses unknown and foreign-project targets', () => {
  const store = createStore()
  const authority = createAuthority(store)
  assert.equal(authority.getTarget({ ...target, panelId: 'panel-missing' }), undefined)
  assert.equal(authority.getTarget({ ...target, projectId: 'project-b' }), undefined)
  assert.equal(authority.getTarget({ ...target, serverId: 'server-b' }), undefined)
  assert.equal(authority.getTarget({ ...target, sessionId: 'session-b' }), undefined)
  assert.equal(authority.authorize('client-a', { ...target, projectId: 'project-b' }), false)
  assert.throws(
    () => authority.applyMetadata({ ...target, projectId: 'project-b' }, 'title', 'Stolen', 0),
    (error) => error instanceof AiServiceError && error.code === 'target_unavailable',
  )
  assert.equal(store.state.panels['panel-a'].title, 'Terminal 1')
})

function createService(store, generate) {
  return new AiMetadataService({
    serverId,
    authority: createAuthority(store),
    replay: new TerminalReplayRegistry(),
    providers: { codex: { generate } },
  })
}

function deferred() {
  let resolve
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

const generation = { clientId: 'client-a', target, provider: 'codex', model: 'test-model' }

test('generation commits the title and note to the canonical panel', async () => {
  const store = createStore()
  const service = createService(store, (request) => (request.target === 'title' ? 'Build Warnings' : 'Reviewing warnings'))
  const title = await service.generate({ ...generation, requestId: 'request-title', targetType: 'title' })
  assert.equal(title.revision, 1)
  assert.equal(store.state.panels['panel-a'].title, 'Build Warnings')
  const note = await service.generate({ ...generation, requestId: 'request-note', targetType: 'note' })
  assert.equal(note.revision, 2)
  assert.equal(store.state.panels['panel-a'].note, 'Reviewing warnings')
})

test('a manual rename during generation wins and the result is a conflict', async () => {
  const store = createStore()
  const held = deferred()
  const service = createService(store, () => held.promise)
  const pending = service.generate({ ...generation, requestId: 'request-conflict', targetType: 'title' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(update(store, { title: 'Mine' }).ok, true)
  held.resolve('Build Warnings')
  await assert.rejects(pending, (error) => error instanceof AiServiceError && error.code === 'revision_conflict')
  assert.equal(store.state.panels['panel-a'].title, 'Mine')
})

test('a client generating over the protocol changes canonical workspace state', async () => {
  const { TerminayAiClient, TerminayClient, TerminayClientFacade } = await import('@terminay/client-core')
  const { createInMemoryTransportPair } = await import('@terminay/protocol-conformance')
  const { AiService, ServerConnection, createAiOperationHandlers } = await import('../dist/index.js')
  const store = createStore()
  const service = new AiService({
    serverId,
    authority: createAuthority(store),
    replay: new TerminalReplayRegistry(),
    providers: { codex: { generate: () => 'Build Warnings' } },
  })
  const pair = createInMemoryTransportPair()
  await pair.open()
  const server = new ServerConnection(pair.server, {
    serverId,
    serverVersion: '1.0.0',
    capabilities: ['ai.metadata'],
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: 'write' }),
    ...createAiOperationHandlers(service),
  })
  void server.start()
  const client = new TerminayClient({ transport: pair.client, clientId: 'client-a', capabilities: ['ai.metadata'] })
  await client.connect()
  const ai = new TerminayAiClient(new TerminayClientFacade(client))
  const response = await ai.generateMetadata({ requestId: 'request-wire', target, targetType: 'title', provider: 'codex', model: 'test-model' })
  assert.equal(response.revision, 1)
  assert.equal(response.text, 'Build Warnings')
  assert.equal(store.state.panels['panel-a'].title, 'Build Warnings')
})

test('an unrelated change during generation does not conflict', async () => {
  const store = createStore()
  const held = deferred()
  const service = createService(store, () => held.promise)
  const pending = service.generate({ ...generation, requestId: 'request-unrelated', targetType: 'title' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(update(store, { color: '#abcdef' }).ok, true)
  held.resolve('Build Warnings')
  assert.equal((await pending).text, 'Build Warnings')
  assert.equal(store.state.panels['panel-a'].title, 'Build Warnings')
  assert.equal(store.state.panels['panel-a'].color, '#abcdef')
})
