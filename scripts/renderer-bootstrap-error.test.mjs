import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('renderer bootstrap failures leave the loading state and render a visible error', async () => {
  const source = await readFile(
    new URL('../src/rendererRuntime.tsx', import.meta.url),
    'utf8',
  )

  assert.match(
    source,
    /setServerConnectionError\(errorMessage\)/u,
    'the connection rejection must update visible renderer state',
  )
  assert.match(
    source,
    /Server connection unavailable: \{serverConnectionError\}/u,
    'the updated error state must render instead of the indefinite loading shell',
  )
})
