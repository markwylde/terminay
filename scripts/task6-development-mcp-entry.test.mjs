import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const repositoryRoot = new URL('..', import.meta.url).pathname
const serverRoot = join(repositoryRoot, 'apps', 'terminay-server')
const distRoot = join(serverRoot, 'dist')
const mcpEntry = join(distRoot, 'mcpEntry.js')

function runMcpWithoutInheritedControl() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [mcpEntry], {
      cwd: serverRoot,
      env: {
        ...process.env,
        TERMINAY_CONTROL_SOCKET: '',
        TERMINAY_CONTROL_TOKEN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

test('compiled development MCP entry passes release-integrity preflight and fails closed without inherited control', async () => {
  const manifest = JSON.parse(await readFile(join(distRoot, 'release-integrity.json'), 'utf8'))
  const entryRecord = manifest.files.find((file) => file.path === 'mcpEntry.js')
  assert.ok(entryRecord, 'the compiled release-integrity manifest must cover mcpEntry.js')
  assert.equal(typeof entryRecord.sha256, 'string')
  assert.match(entryRecord.sha256, /^[a-f0-9]{64}$/u)

  const result = await runMcpWithoutInheritedControl()
  assert.equal(result.code, 1)
  assert.equal(result.signal, null)
  assert.equal(result.stdout, '')
  // Reaching this deliberately safe rejection proves the compiled entry
  // completed its preflight: integrity failures exit before MCP stdio checks.
  assert.match(result.stderr, /terminay mcp failed: TypeError: Terminay MCP requires an absolute local control socket/)
  assert.doesNotMatch(result.stderr, /TERMINAY_CONTROL_TOKEN/u)
})
