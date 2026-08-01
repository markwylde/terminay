import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const acceptance = await readFile(
  'scripts/acceptance/shared-app-production-parity.spec.ts',
  'utf8',
)

test('production browser acceptance runs under a fail-fast stability budget', () => {
  assert.match(acceptance, /function createBrowserStabilityBudget/u)
  assert.match(acceptance, /DEFAULT_BROWSER_STABILITY_THRESHOLDS/u)
  assert.match(acceptance, /maxProtocolRequests:\s*160/u)
  assert.match(acceptance, /maxPendingProtocolRequests:\s*12/u)
  assert.match(acceptance, /maxConsoleErrors:\s*0/u)
  assert.match(acceptance, /maxResourceFailures:\s*0/u)
  assert.match(acceptance, /maxLongTasks:\s*0/u)
  assert.match(acceptance, /maxLongTaskMs:\s*200/u)
  assert.match(acceptance, /Promise\.race\(\[/u)
  assert.match(acceptance, /webStability\.failure/u)
  assert.match(acceptance, /webStability\.assertHealthy\(\)/u)
  assert.match(acceptance, /webStability\.diagnostics\(\)/u)
  assert.match(acceptance, /page\.on\('request'/u)
  assert.match(acceptance, /page\.on\('requestfinished'/u)
  assert.match(acceptance, /page\.on\('requestfailed'/u)
  assert.match(acceptance, /page\.on\('console'/u)
  assert.match(acceptance, /PerformanceObserver/u)
  assert.match(acceptance, /entryTypes:\s*\['longtask'\]/u)
  assert.match(acceptance, /setInterval\(\(\) =>/u)
  assert.match(acceptance, /clearInterval\(longTaskTimer\)/u)
  assert.match(acceptance, /web-runtime-diagnostics\.json/u)
})
