import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import test from 'node:test'

const script = new URL('./stage-macos-app-from-dmg.sh', import.meta.url)

test('the DMG staging helper is a macOS-only ditto copy off a read-only volume', async () => {
  const source = await readFile(script, 'utf8')
  const mode = (await stat(script)).mode
  assert.equal(Boolean(mode & 0o111), true, 'staging helper must be executable')
  assert.match(source, /ditto/u)
  assert.match(source, /hdiutil attach/u)
  assert.match(source, /-readonly/u)
  assert.doesNotMatch(source, /mapfile/u)
  assert.doesNotMatch(source, /codesign --verify/u,
    'unsigned electron-builder apps fail codesign --verify; release verifies signed bytes separately')
})

test('the DMG staging helper rejects missing arguments', async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn('bash', [script.pathname], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stderr }))
  })
  assert.equal(result.code, 1)
  assert.match(result.stderr, /usage: stage-macos-app-from-dmg\.sh/u)
})
