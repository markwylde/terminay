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
const { runBoundedBrowserRecoveryStep } = await import(`${bundlePath}?test=${Date.now()}`)
test.after(() => rm(bundleDirectory, { force: true, recursive: true }))

test('browser recovery bounds an acquisition which ignores cancellation', async () => {
  let callback
  let cleared = false
  const attempt = new AbortController()
  const pending = runBoundedBrowserRecoveryStep({
    clock: {
      clearTimeout: () => { cleared = true },
      setTimeout: (next) => { callback = next; return 1 },
    },
    label: 'Credential lookup',
    operation: async () => new Promise(() => {}),
    signal: attempt.signal,
    timeoutMs: 30,
  })
  callback()
  await assert.rejects(pending, /Credential lookup timed out after 30ms/)
  assert.equal(cleared, true)
})

test('browser recovery aborts a hung acquisition when its generation is cancelled', async () => {
  const attempt = new AbortController()
  const pending = runBoundedBrowserRecoveryStep({
    clock: {
      clearTimeout: () => undefined,
      setTimeout: () => 1,
    },
    label: 'Reconnect ticket',
    operation: async () => new Promise(() => {}),
    signal: attempt.signal,
  })
  attempt.abort(new Error('superseded'))
  await assert.rejects(pending, /superseded/)
})

test('pre-profile pairing never enters the profile-scoped connection controller', () => {
	assert.match(source, /const intent = beginPairingIntent\(\)/u)
	assert.doesNotMatch(source, /beginConnectionAttempt\(`pairing:|\.begin\(`pairing:/u)
	assert.doesNotMatch(source, /connectionController\.current!?\.begin\(origin\)/u)
	assert.match(source, /const rendererAttempt = connectionController\.current!\.begin\(profile\.id\)/u)
})

test('mounted terminal resume is the recovery verification command', () => {
	const pipeline = source.slice(source.indexOf('\tfunction browserRecoveryPipeline()'), source.indexOf('\n\tfunction startBrowserRecovery', source.indexOf('\tfunction browserRecoveryPipeline()')))
	assert.match(pipeline, /await recovery\.terminalHydrated/u)
	assert.doesNotMatch(pipeline, /ServerHealthClient|snapshot\(\)/u)
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
	assert.match(source, /parsed\.protocol === 'http:'[\s\S]*parsed\.hostname === 'localhost'[\s\S]*parsed\.hostname\.endsWith\('\.localhost'\)[\s\S]*parsed\.hostname === '127\.0\.0\.1'[\s\S]*parsed\.hostname === '\[::1\]'/u)
	assert.match(source, /if \(isBrowserReconnectOrigin\(profile\.origin\)\) \{/u)
	assert.match(source, /const credential = await reconnectVault\.credential\(profile\.origin\)/u)
	assert.match(source, /AUTO_RESTORE_PROFILE_STATUSES\.has\(profile\.status\)/u)
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
