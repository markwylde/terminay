import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const bundleDirectory = await mkdtemp(path.join(os.tmpdir(), 'terminay-language-gateway-test-'))
const outputPath = path.join(bundleDirectory, 'language-gateway.cjs')

await build({
  bundle: true,
  entryPoints: ['src/services/fileViewer/languageGateway.ts'],
  format: 'cjs',
  logLevel: 'silent',
  outfile: outputPath,
  platform: 'node',
})

const {
  createLanguageGateway,
  DEFAULT_LANGUAGE_GATEWAY_TIMINGS,
  LANGUAGE_COMPLETION_DEBOUNCE_MS,
  LANGUAGE_COMPLETION_DEADLINE_MS,
  LANGUAGE_DEFINITION_DEADLINE_MS,
  LANGUAGE_HOVER_DEBOUNCE_MS,
  LANGUAGE_HOVER_DEADLINE_MS,
} = require(outputPath)

test.after(async () => {
  await rm(bundleDirectory, { force: true, recursive: true })
})

const FAST_TIMINGS = {
  debounceMs: { completion: 20, definition: 0, hover: 20 },
  deadlineMs: { completion: 1500, definition: 3000, hover: 1500 },
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolveFn, rejectFn) => {
    resolve = resolveFn
    reject = rejectFn
  })
  return { promise, reject, resolve }
}

/** Records every envelope the gateway sends and lets a test settle queries by
 * hand, which is how superseded and stale results are exercised. */
function createFakeTransport() {
  const queries = []
  const commands = []
  const diagnosticsListeners = []
  let respond = () => ({ items: [], isIncomplete: false, isTruncated: false })
  return {
    commands,
    diagnosticsListeners,
    queries,
    setResponder(next) {
      respond = next
    },
    emitDiagnostics(payload) {
      for (const listener of diagnosticsListeners) listener(payload)
    },
    async query(operation, payload, options = {}) {
      const record = { operation, options, payload, signal: options.signal }
      queries.push(record)
      return respond(record)
    },
    async command(operation, payload) {
      commands.push({ operation, payload })
      return null
    },
    async subscribeEvents(_event, listener) {
      diagnosticsListeners.push(listener)
      return () => {
        const index = diagnosticsListeners.indexOf(listener)
        if (index >= 0) diagnosticsListeners.splice(index, 1)
      }
    },
  }
}

function completionResult(revision, labels) {
  return {
    isIncomplete: false,
    isTruncated: false,
    items: labels.map((label) => ({ label })),
    path: 'src/index.ts',
    projectId: 'project-1',
    revision,
  }
}

test('language gateway ships the phase-4 debounce and deadline budget', () => {
  assert.equal(LANGUAGE_COMPLETION_DEBOUNCE_MS, 80)
  assert.equal(LANGUAGE_HOVER_DEBOUNCE_MS, 150)
  assert.equal(LANGUAGE_COMPLETION_DEADLINE_MS, 1500)
  assert.equal(LANGUAGE_HOVER_DEADLINE_MS, 1500)
  assert.equal(LANGUAGE_DEFINITION_DEADLINE_MS, 3000)
  assert.equal(DEFAULT_LANGUAGE_GATEWAY_TIMINGS.debounceMs.completion, 80)
  assert.equal(DEFAULT_LANGUAGE_GATEWAY_TIMINGS.deadlineMs.definition, 3000)
})

test('opening, changing, and closing a document counts revisions', async () => {
  const transport = createFakeTransport()
  const gateway = createLanguageGateway({ timings: FAST_TIMINGS, transport })

  assert.equal(gateway.revision('project-1', 'src/index.ts'), 0)
  assert.equal(await gateway.open('project-1', 'src/index.ts', 'typescript', 'const a = 1\n'), true)
  assert.equal(gateway.revision('project-1', 'src/index.ts'), 1)
  await gateway.change('project-1', 'src/index.ts', 'const a = 2\n')
  await gateway.change('project-1', 'src/index.ts', 'const a = 3\n')
  assert.equal(gateway.revision('project-1', 'src/index.ts'), 3)
  await gateway.close('project-1', 'src/index.ts')

  assert.deepEqual(
    transport.commands.map((entry) => [entry.operation, entry.payload.revision]),
    [
      ['language.document.open', 1],
      ['language.document.change', 2],
      ['language.document.change', 3],
      ['language.document.close', 3],
    ],
  )
  assert.equal(transport.commands[0].payload.languageId, 'typescript')
  // A closed document starts counting again rather than inheriting a revision.
  assert.equal(gateway.revision('project-1', 'src/index.ts'), 0)
  gateway.dispose()
})

test('a burst of completions debounces into one query at the current revision', async () => {
  const transport = createFakeTransport()
  transport.setResponder((record) => completionResult(record.payload.revision, ['toUpperCase']))
  const gateway = createLanguageGateway({ timings: FAST_TIMINGS, transport })
  await gateway.open('project-1', 'src/index.ts', 'typescript', 'util.\n')

  const first = gateway.completion('project-1', 'src/index.ts', { character: 5, line: 0 })
  const second = gateway.completion('project-1', 'src/index.ts', { character: 5, line: 0 })
  const third = gateway.completion('project-1', 'src/index.ts', { character: 5, line: 0 })

  assert.equal(await first, null)
  assert.equal(await second, null)
  const result = await third
  assert.deepEqual(result.items.map((item) => item.label), ['toUpperCase'])
  assert.equal(transport.queries.length, 1)
  assert.equal(transport.queries[0].operation, 'language.completion')
  assert.equal(transport.queries[0].payload.revision, 1)
  assert.equal(transport.queries[0].options.deadlineMs, 1500)
  gateway.dispose()
})

test('a superseded in-flight query is aborted and its result is not delivered', async () => {
  const transport = createFakeTransport()
  const first = deferred()
  let queryIndex = 0
  transport.setResponder((record) => {
    queryIndex += 1
    return queryIndex === 1 ? first.promise : completionResult(record.payload.revision, ['second'])
  })
  const gateway = createLanguageGateway({ timings: FAST_TIMINGS, transport })
  await gateway.open('project-1', 'src/index.ts', 'typescript', 'util.\n')

  const superseded = gateway.completion('project-1', 'src/index.ts', { character: 5, line: 0 })
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(transport.queries.length, 1)
  assert.equal(transport.queries[0].signal.aborted, false)

  const winner = gateway.completion('project-1', 'src/index.ts', { character: 5, line: 0 })
  assert.equal(transport.queries[0].signal.aborted, true)
  assert.equal(await superseded, null)

  first.resolve(completionResult(1, ['first']))
  const result = await winner
  assert.deepEqual(result.items.map((item) => item.label), ['second'])
  gateway.dispose()
})

test('a result computed against an older revision is dropped', async () => {
  const transport = createFakeTransport()
  const pending = deferred()
  transport.setResponder(() => pending.promise)
  const gateway = createLanguageGateway({ timings: FAST_TIMINGS, transport })
  await gateway.open('project-1', 'src/index.ts', 'typescript', 'util.\n')

  const inFlight = gateway.hover('project-1', 'src/index.ts', { character: 1, line: 0 })
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(transport.queries[0].payload.revision, 1)

  await gateway.change('project-1', 'src/index.ts', 'util.t\n')
  pending.resolve({
    contents: 'stale hover',
    isTruncated: false,
    path: 'src/index.ts',
    projectId: 'project-1',
    revision: 1,
  })
  assert.equal(await inFlight, null)
  gateway.dispose()
})

test('diagnostics are filtered to the subscribed project and path', async () => {
  const transport = createFakeTransport()
  const gateway = createLanguageGateway({ timings: FAST_TIMINGS, transport })
  const seen = []
  const stop = gateway.subscribeDiagnostics(
    { path: 'src/index.ts', projectId: 'project-1' },
    (event) => seen.push(event),
  )
  await new Promise((resolve) => setTimeout(resolve, 10))

  const diagnostic = {
    message: 'Type error',
    range: { end: { character: 3, line: 0 }, start: { character: 0, line: 0 } },
    severity: 'error',
  }
  transport.emitDiagnostics({
    diagnostics: [diagnostic],
    isTruncated: false,
    path: 'src/other.ts',
    projectId: 'project-1',
    revision: 1,
  })
  transport.emitDiagnostics({
    diagnostics: [diagnostic],
    isTruncated: false,
    path: 'src/index.ts',
    projectId: 'project-2',
    revision: 1,
  })
  transport.emitDiagnostics({
    diagnostics: [diagnostic],
    isTruncated: false,
    path: 'src/index.ts',
    projectId: 'project-1',
    revision: 2,
  })

  assert.equal(seen.length, 1)
  assert.equal(seen[0].revision, 2)
  assert.equal(seen[0].diagnostics[0].message, 'Type error')
  stop()
  assert.equal(transport.diagnosticsListeners.length, 0)
  gateway.dispose()
})

test('a failed request leaves the editor with no error to surface', async () => {
  const transport = createFakeTransport()
  transport.setResponder(() => {
    throw new Error('language session unavailable')
  })
  const gateway = createLanguageGateway({ timings: FAST_TIMINGS, transport })
  assert.equal(await gateway.capabilities('project-1', 'src/index.ts'), null)
  assert.equal(await gateway.definition('project-1', 'src/index.ts', { character: 0, line: 0 }), null)
  gateway.dispose()
})
