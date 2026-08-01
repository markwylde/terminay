import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { join } from 'node:path'
import test from 'node:test'

const source = await readFile(new URL('../src/web/main.tsx', import.meta.url), 'utf8')
const bundleDirectory = await mkdtemp(join(process.cwd(), '.web-reconnect-attempt-'))
const bundlePath = join(bundleDirectory, 'reconnectAttempt.mjs')
await build({
  entryPoints: ['src/web/reconnectAttempt.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'silent',
})
const { BrowserConnectionAttemptGate } = await import(`${bundlePath}?test=${Date.now()}`)
test.after(() => rm(bundleDirectory, { force: true, recursive: true }))

test('forgetting a browser profile invalidates only its pending reconnect attempt', () => {
  const gate = new BrowserConnectionAttemptGate()
  const discarded = gate.begin('discarded-server')
  gate.invalidate('discarded-server')
  assert.equal(gate.isCurrent(discarded), false)

  const selected = gate.begin('selected-server')
  gate.invalidate('discarded-server')
  assert.equal(gate.isCurrent(selected), true)
  assert.equal(gate.isCurrent(discarded), false)
})

test('web connection activation checks the gate before replacing the workspace', () => {
  assert.match(source, /BrowserConnectionAttemptGate/u)
  assert.match(source, /const connectionAttemptGate = useRef\(new BrowserConnectionAttemptGate\(\)\)/u)
  assert.match(source, /function beginConnectionAttempt\(profileId: string\): BrowserConnectionAttempt/u)
  assert.match(source, /function isCurrentConnectionAttempt\(\s*profile: ConnectionProfile,\s*attempt: BrowserConnectionAttempt,\s*\): boolean/u)
  assert.match(source, /function invalidateConnectionAttempt\(profileId: string\): void/u)
  assert.match(source, /attempt = beginConnectionAttempt\(profile\.id\)/u)
  assert.match(source, /const attempt = beginConnectionAttempt\(profile\.id\)/u)
  assert.match(source, /if \(!isCurrentConnectionAttempt\(profile, attempt\)\) return/u)
  assert.match(source, /await context\.dispose\?\.\(\)/u)
  assert.match(source, /function forgetConnection[\s\S]*invalidateConnectionAttempt\(profileId\);[\s\S]*if \(activeConnection/u)
})

test('transient restart failures retry with bounded backoff and one visible outcome', () => {
  assert.match(source, /const reconnectAttempts = useRef\(new Map<string, number>\(\)\)/u)
  assert.match(source, /function scheduleRecovery\(profileId: string\): void/u)
  assert.match(source, /Math\.min\(10_000, 750 \* 2 \*\* Math\.min\(attempt, 4\)\)/u)
  assert.match(source, /void openConnection\(profileId, false, true\)/u)
  assert.match(source, /if \(recovering\) scheduleRecovery\(profile\.id\)/u)
  assert.match(source, /reconnectAttempts\.current\.delete\(profile\.id\);\s+setError\(null\);\s+setStatus\(null\)/u)
  assert.match(source, /setError\('Connection lost\. Reconnecting…'\);\s+setStatus\(null\)/u)
  assert.match(source, /window\.clearTimeout\(reconnectTimer\)/u)
})

test('invalid persisted reconnect proofs stop retrying and require fresh pairing', () => {
	assert.match(source, /function reconnectNeedsFreshPairing\(cause: unknown\): boolean/u)
	assert.match(source, /cause\.message === 'reconnect proof request is invalid'/u)
	assert.match(source, /Saved reconnect credentials were rejected/u)
	assert.match(source, /400\|401\|403\|404/u)
	assert.match(source, /if \(reconnectNeedsFreshPairing\(cause\)\) \{/u)
	assert.match(source, /invalidateConnectionAttempt\(profile\.id\)/u)
	assert.match(source, /host\.disconnect\(profile\.id\)/u)
	assert.match(source, /const AUTO_RESTORE_PROFILE_STATUSES:[\s\S]*?new Set/u)
	assert.match(source, /'connected',\s+'connecting',\s+'unreachable'/u)
	assert.match(source, /function isAutoRestorableProfile\(profile: ConnectionProfile\): boolean/u)
	assert.match(source, /await reconnectVault\.forget\(profile\.origin\)/u)
	assert.match(source, /Saved reconnect credentials are no longer valid\. Paste a fresh pairing URL\./u)
})

test('browser auto-restore reconnects HTTPS and loopback profiles in-page', () => {
	assert.match(source, /function isBrowserReconnectOrigin\(origin: string\): boolean/u)
	assert.match(source, /parsed\.protocol === 'https:'/u)
	assert.match(source, /parsed\.protocol === 'http:'[\s\S]*parsed\.hostname === 'localhost'[\s\S]*parsed\.hostname === '127\.0\.0\.1'[\s\S]*parsed\.hostname === '\[::1\]'/u)
	assert.match(source, /if \(isBrowserReconnectOrigin\(profile\.origin\)\) \{/u)
	assert.match(source, /const credential = await reconnectVault\.credential\(profile\.origin\)/u)
	assert.match(source, /profile\.status === 'connected' \|\| recovering/u)
	assert.match(source, /host\.open\(profileId, \{ newTab \}\);[\s\S]*return;/u)
	assert.doesNotMatch(source, /profile\?\?\.origin\.startsWith\('http:\/\/'\)|profile\.origin\.startsWith\('http:\/\/'\)/u)
})

test('browser auto-restore retries the current unreachable profile after restart', () => {
	assert.match(source, /const autoRestoreAttemptedProfileId = useRef<string \| null>\(null\)/u)
	assert.match(source, /snapshot\.current !== undefined &&\s+isAutoRestorableProfile\(snapshot\.current\)/u)
	assert.match(source, /const profile = currentProfile \?\? latestProfile/u)
	assert.match(source, /if \(autoRestoreAttemptedProfileId\.current === profile\.id\) return/u)
	assert.match(source, /void openConnection\(profile\.id, false, true\)\.catch/u)
	assert.doesNotMatch(source, /const autoRestoreAttempted = useRef\(false\)/u)
	assert.doesNotMatch(source, /candidate\.status !== 'connected'/u)
})
