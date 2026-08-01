import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const smokeScript = fileURLToPath(new URL('./task10-provider-smoke.mjs', import.meta.url))

test('provider smoke skips providers unless the isolated direct MCP probe passed', async () => {
  const source = await readFile(smokeScript, 'utf8')

  assert.match(source, /report\.providers\.codex = await runProviderWhenFixtureReady\(/)
  assert.match(source, /report\.providers\.claudeCode = await runProviderWhenFixtureReady\(/)
  assert.match(
    source,
    /if \(report\.fixture\.directProbe\.status !== 'passed'\) \{\s+return \{\s+status: 'skipped',\s+attempted: false,\s+reason: 'isolated direct MCP probe did not pass',/s,
  )
})
