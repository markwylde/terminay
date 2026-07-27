import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AiMetadataService,
  AiServiceError,
  DictationService,
  ExactTerminalTargetRegistry,
  ServerVaultService,
  VaultProviderCredentialResolver,
  TerminalReplayRegistry,
} from '../dist/index.js'

const serverId = 'server-a'
const target = {
  serverId,
  projectId: 'project-a',
  panelId: 'panel-a',
  sessionId: 'session-a',
}

function createTarget(options = {}) {
  const authority = new ExactTerminalTargetRegistry(serverId)
  authority.register(target, options)
  return authority
}

function createCredentialVault() {
  const secrets = new Map([
    ['ai.codex', new Uint8Array(Buffer.from('codex-secret-sentinel'))],
    ['dictation.openai', new Uint8Array(Buffer.from('dictation-secret-sentinel'))],
  ])
  const adapter = {
    backend: 'custom',
    status: () => 'unlocked',
    list: () => [...secrets.keys()].map((id) => ({ id, configured: true })),
    unlock: async () => {},
    lock: () => {},
    put: async () => { throw new Error('not used') },
    replace: async () => { throw new Error('not used') },
    test: async (id) => { if (!secrets.has(id)) throw new Error('missing secret') },
    remove: async (id) => secrets.delete(id),
    rotate: async () => {},
    withSecret: async (id, callback) => {
      const value = secrets.get(id)
      if (value === undefined) throw new Error('missing secret')
      return callback(new Uint8Array(value))
    },
  }
  return new ServerVaultService(adapter)
}

test('AI metadata uses exact server replay context and applies one revision', async () => {
  const authority = createTarget({ title: 'Terminal', note: '' })
  const replay = new TerminalReplayRegistry({ maxBytes: 64, maxChars: 64 })
  replay.append(target.sessionId, '\u001b[31msecret from target\u001b[0m\n')
  replay.append('session-other', 'other terminal must not be included')
  let providerContext
  const service = new AiMetadataService({
    serverId,
    authority,
    replay,
    providers: {
      codex: {
        generate: async (request) => {
          providerContext = request.context
          return '"Build Warnings"'
        },
      },
    },
  })

  const result = await service.generate({
    requestId: 'request-a',
    clientId: 'client-a',
    target,
    targetType: 'title',
    provider: 'codex',
    model: 'test-model',
  })

  assert.equal(result.text, 'Build Warnings')
  assert.equal(result.revision, 1)
  assert.match(providerContext.text, /secret from target/)
  assert.doesNotMatch(providerContext.text, /other terminal/)
  assert.equal(providerContext.text.includes('\u001b'), false)
  assert.equal(authority.getTarget(target).title, 'Build Warnings')
})

test('AI metadata rejects stale revision and exited target without mutation', async () => {
  const authority = createTarget({ title: 'Original' })
  const replay = new TerminalReplayRegistry()
  replay.append(target.sessionId, 'output')
  let release
  const service = new AiMetadataService({
    serverId,
    authority,
    replay,
    providers: {
      codex: {
        generate: () => new Promise((resolve) => {
          release = resolve
        }),
      },
    },
  })
  const pending = service.generate({
    requestId: 'request-stale',
    clientId: 'client-a',
    target,
    targetType: 'title',
    expectedRevision: 0,
    provider: 'codex',
    model: 'test-model',
  })
  await new Promise((resolve) => setImmediate(resolve))
  authority.updateMetadata(target, 'title', 'Manual edit', 0)
  release('Generated stale title')
  await assert.rejects(pending, (error) => error instanceof AiServiceError && error.code === 'revision_conflict')
  assert.equal(authority.getTarget(target).title, 'Manual edit')

  const exitPending = service.generate({
    requestId: 'request-exit',
    clientId: 'client-a',
    target,
    targetType: 'title',
    expectedRevision: 1,
    provider: 'codex',
    model: 'test-model',
  })
  await new Promise((resolve) => setImmediate(resolve))
  authority.markExited(target)
  release('Generated after exit')
  await assert.rejects(exitPending, (error) => error instanceof AiServiceError && error.code === 'target_exited')
})

test('AI cancellation aborts provider work and exposes no provider output', async () => {
  const authority = createTarget()
  const replay = new TerminalReplayRegistry()
  let providerSignal
  const logs = []
  const service = new AiMetadataService({
    serverId,
    authority,
    replay,
    logger: { status: (event) => logs.push(event) },
    providers: {
      codex: {
        generate: ({ signal }) => {
          providerSignal = signal
          return new Promise(() => {})
        },
      },
    },
  })
  const pending = service.generate({
    requestId: 'request-cancel',
    clientId: 'client-a',
    target,
    targetType: 'note',
    provider: 'codex',
    model: 'test-model',
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(service.cancel('request-cancel'), true)
  await assert.rejects(pending, (error) => error instanceof AiServiceError && error.code === 'provider_cancelled')
  assert.equal(providerSignal.aborted, true)
  assert.equal(JSON.stringify(service.snapshots()).includes('secret'), false)
  assert.equal(logs.some((event) => 'text' in event || 'output' in event), false)
})

test('dictation validates bounded audio and writes only to original live target', async () => {
  const inserted = []
  const authority = createTarget({
    writeInput: (input) => inserted.push(input),
  })
  let seen
  const service = new DictationService({
    serverId,
    authority,
    provider: {
      transcribe: async (request) => {
        seen = request
        return { text: 'ls -la' }
      },
    },
    limits: { maxAudioBytes: 4, allowedAudioMimeTypes: ['audio/webm'] },
  })

  const result = await service.transcribe({
    requestId: 'dictation-a',
    clientId: 'client-a',
    target,
    mimeType: 'audio/webm;codecs=opus',
    audio: new Uint8Array([1, 2, 3]),
    appendNewline: true,
  })
  assert.equal(result.text, 'ls -la')
  assert.deepEqual(inserted, ['ls -la\n'])
  assert.deepEqual([...seen.audio], [1, 2, 3])
  assert.equal('apiKey' in seen, false)

  await assert.rejects(
    service.transcribe({ requestId: 'dictation-type', clientId: 'client-a', target, mimeType: 'audio/ogg', audio: new Uint8Array([1]) }),
    (error) => error instanceof AiServiceError && error.code === 'audio_type_unsupported',
  )
  await assert.rejects(
    service.transcribe({ requestId: 'dictation-size', clientId: 'client-a', target, mimeType: 'audio/webm', audio: new Uint8Array([1, 2, 3, 4, 5]) }),
    (error) => error instanceof AiServiceError && error.code === 'audio_too_large',
  )
})

test('dictation cancellation and target exit prevent insertion', async () => {
  const inserted = []
  const authority = createTarget({ writeInput: (input) => inserted.push(input) })
  let release
  const service = new DictationService({
    serverId,
    authority,
    provider: {
      transcribe: () => new Promise((resolve) => {
        release = resolve
      }),
    },
  })
  const pending = service.transcribe({ requestId: 'dictation-cancel', clientId: 'client-a', target, mimeType: 'audio/webm', audio: new Uint8Array([1]) })
  await new Promise((resolve) => setImmediate(resolve))
  service.cancel('dictation-cancel')
  release({ text: 'must not insert' })
  await assert.rejects(pending, (error) => error instanceof AiServiceError && error.code === 'provider_cancelled')
  assert.deepEqual(inserted, [])

  const exitPending = service.transcribe({ requestId: 'dictation-exit', clientId: 'client-a', target, mimeType: 'audio/webm', audio: new Uint8Array([1]) })
  await new Promise((resolve) => setImmediate(resolve))
  authority.markExited(target)
  release({ text: 'must not insert' })
  await assert.rejects(exitPending, (error) => error instanceof AiServiceError && error.code === 'target_exited')
  assert.deepEqual(inserted, [])
})

test('dictation upload timeout detaches a slow async source', async () => {
  const authority = createTarget()
  const service = new DictationService({
    serverId,
    authority,
    provider: { transcribe: () => ({ text: 'never reached' }) },
    limits: { maxAudioUploadMs: 5 },
  })
  const audio = {
    async *[Symbol.asyncIterator]() {
      await new Promise(() => {})
      yield new Uint8Array([1])
    },
  }
  await assert.rejects(
    service.transcribe({ requestId: 'dictation-timeout', clientId: 'client-a', target, mimeType: 'audio/webm', audio }),
    (error) => error instanceof AiServiceError && error.code === 'audio_timeout',
  )
})

test('AI and dictation resolve provider credentials only inside server callbacks', async () => {
  const vault = createCredentialVault()
  const credentials = new VaultProviderCredentialResolver({
    vault,
    bindings: [
      { provider: 'codex', secretId: 'ai.codex' },
      { provider: 'openai', secretId: 'dictation.openai' },
    ],
  })
  const authority = createTarget({ writeInput: () => {} })
  const replay = new TerminalReplayRegistry()
  replay.append(target.sessionId, 'safe context')
  const logs = []
  let metadataSecret = ''
  const metadata = new AiMetadataService({
    serverId,
    authority,
    replay,
    credentialResolver: credentials,
    logger: { status: (event) => logs.push(event) },
    providers: {
      codex: {
        generate: async ({ withCredential }) => {
          metadataSecret = await withCredential((secret) => Buffer.from(secret).toString())
          return 'Safe title'
        },
      },
    },
  })
  const metadataResult = await metadata.generate({
    requestId: 'credential-metadata',
    clientId: 'client-a',
    target,
    targetType: 'title',
    provider: 'codex',
    model: 'test-model',
  })
  assert.equal(metadataResult.text, 'Safe title')
  assert.equal(metadataSecret, 'codex-secret-sentinel')
  assert.equal(JSON.stringify(metadata.snapshots()).includes('codex-secret-sentinel'), false)

  let dictationSecret = ''
  const dictation = new DictationService({
    serverId,
    authority,
    credentialResolver: credentials,
    logger: { status: (event) => logs.push(event) },
    settings: { enabled: true, provider: 'openai', model: 'test-transcribe' },
    provider: {
      transcribe: async ({ withCredential }) => {
        dictationSecret = await withCredential((secret) => Buffer.from(secret).toString())
        return { text: 'safe transcript' }
      },
    },
  })
  const dictationResult = await dictation.transcribe({
    requestId: 'credential-dictation',
    clientId: 'client-a',
    target,
    mimeType: 'audio/webm',
    audio: new Uint8Array([1]),
  })
  assert.equal(dictationResult.text, 'safe transcript')
  assert.equal(dictationSecret, 'dictation-secret-sentinel')
  assert.equal(JSON.stringify(dictation.snapshots()).includes('dictation-secret-sentinel'), false)
  assert.equal(JSON.stringify(logs).includes('secret-sentinel'), false)
  await assert.rejects(
    credentials.withCredential('missing-provider', () => 'not reached'),
    (error) => error instanceof AiServiceError && error.code === 'provider_unavailable' && !String(error).includes('secret-sentinel'),
  )
})
