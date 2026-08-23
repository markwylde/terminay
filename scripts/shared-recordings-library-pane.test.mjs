import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const shared = await readFile(new URL('../src/shared/SharedRecordingsLibraryPane.tsx', import.meta.url), 'utf8')
const desktop = await readFile(new URL('../src/components/RecordingsWindow.tsx', import.meta.url), 'utf8')

test('recordings library is a host-neutral shared route body', () => {
  assert.match(shared, /export function SharedRecordingsLibraryPane/u)
  assert.match(shared, /data-shared-route-body="recordings-library"/u)
  assert.match(shared, /groupedRecordings/u)
  assert.match(shared, /onSelect/u)
  assert.doesNotMatch(shared, /window\.|electron|node:|TerminayClient|createLegacyRecordingsClient|@xterm\//u)
})

test('recordings search has a durable accessible name', () => {
  assert.match(shared, /<input\s+aria-label="Search recordings"/u)
})

test('desktop recordings replay consumes the shared library without owning sidebar markup', () => {
  assert.match(desktop, /import \{ SharedRecordingsLibraryPane \}/u)
  assert.match(desktop, /<SharedRecordingsLibraryPane/u)
  assert.doesNotMatch(desktop, /<aside className="recordings-sidebar">/u)
})

test('desktop recordings keep replay transport chrome outside the xterm error boundary', () => {
  assert.match(desktop, /function RecordingsReplayPane/u)
  assert.match(desktop, /aria-label=\{isPlaying \? 'Pause replay' : 'Play replay'\}/u)
  assert.match(
    desktop,
    /<RecordingsRouteErrorBoundary>[\s\S]*recordings-terminal-shell[\s\S]*<\/RecordingsRouteErrorBoundary>/u,
  )
  assert.doesNotMatch(
    desktop,
    /<RecordingsRouteErrorBoundary[\s\S]*<RecordingsReplayPane/u,
  )
})
