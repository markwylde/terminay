import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const directory = await mkdtemp(join(tmpdir(), 'terminay-file-observation-'))
const registryOutput = join(directory, 'watchRegistry.mjs')
const adapterOutput = join(directory, 'observationAdapter.mjs')
const eventsOutput = join(directory, 'events.mjs')
await Promise.all([
  build({ bundle: true, entryPoints: ['packages/server-core/src/fileService/watchRegistry.ts'], format: 'esm', outfile: registryOutput, platform: 'node' }),
  build({ bundle: true, entryPoints: ['packages/server-core/src/fileService/observationAdapter.ts'], format: 'esm', outfile: adapterOutput, platform: 'node' }),
  build({ bundle: true, entryPoints: ['packages/server-core/src/events.ts'], format: 'esm', outfile: eventsOutput, platform: 'node' }),
])
const { FileWatchRegistry } = await import(pathToFileURL(registryOutput).href)
const { FILE_OBSERVATION_OPERATIONS, ServerFileObservationAdapter } = await import(pathToFileURL(adapterOutput).href)
const { OrderedEventJournal } = await import(pathToFileURL(eventsOutput).href)

test.after(async () => rm(directory, { force: true, recursive: true }))

test('same-turn callbacks coalesce but a later identical atomic rename is preserved', async () => {
  const registry = new FileWatchRegistry({ serverId: 'server-a' })
  registry.subscribe({ clientId: 'client-a', projectId: 'project-a', resource: 'file.txt' })
  const event = { projectId: 'project-a', resource: 'file.txt', kind: 'renamed', relatedResource: 'file.txt' }

  assert.equal(registry.publish(event).accepted, true)
  assert.equal(registry.publish(event).deduplicated, true)
  await Promise.resolve()
  const repeated = registry.publish(event)

  assert.equal(repeated.accepted, true)
  assert.equal(repeated.sequence, 2)
})

test('one accepted host event wakes every matching client subscription', async () => {
  const journal = new OrderedEventJournal()
  const watchers = []
  const adapter = new ServerFileObservationAdapter({
    serverId: 'server-a',
    eventJournal: journal,
    host: {
      watch(input) { watchers.push(input) },
      async calculateFolderSize() { return { bytes: 0, files: 0, directories: 0 } },
    },
  })
  const start = adapter.operations.commands[FILE_OBSERVATION_OPERATIONS.watchStart]
  const request = (clientId) => ({
    envelope: {
      type: 'command',
      commandId: `start-${clientId}`,
      correlationId: `correlation-${clientId}`,
      operation: FILE_OBSERVATION_OPERATIONS.watchStart,
      payload: { projectId: 'project-a', resource: 'file.txt' },
    },
    body: new Uint8Array(),
    context: {
      connectionId: `connection-${clientId}`,
      clientId,
      authScope: 'read',
      claims: { projectId: 'project-a' },
      signal: new AbortController().signal,
    },
  })
  await start(request('client-a'))
  await start(request('client-b'))

  watchers[0].publish({ resource: 'file.txt', kind: 'renamed', relatedResource: 'file.txt' })
  const notifications = journal.replay(0).events.map((event) => event.payload.clientId).sort()

  assert.deepEqual(notifications, ['client-a', 'client-b'])
  adapter.close()
})
