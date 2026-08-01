import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const execFileAsync = promisify(execFile)

test('connected browser opens Explorer folders without disconnected compatibility crash', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'terminay-browser-folder-open-'))
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'terminay-browser-folder-open-data-'))
  const web = await startStaticServer(path.resolve('dist-web'))
  let server
  let browser
  try {
    await mkdir(path.join(root, 'docs'), { recursive: true })
    await writeFile(path.join(root, 'docs', 'guide.md'), '# Guide\n')
    await execFileAsync('git', ['init'], { cwd: root })
    await execFileAsync('git', ['config', 'user.email', 'acceptance@example.invalid'], { cwd: root })
    await execFileAsync('git', ['config', 'user.name', 'Acceptance Test'], { cwd: root })
    await execFileAsync('git', ['add', '.'], { cwd: root })
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root })

    server = startServer({ dataRoot, projectRoot: root, webOrigin: web.origin })
    const ready = await readReadiness(server)

    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const diagnostics = []
    page.on('console', message => {
      if (message.type() === 'error') diagnostics.push(message.text())
    })
    page.on('pageerror', error => diagnostics.push(error.message))

    await page.goto(`${web.origin}/web.html`, { waitUntil: 'domcontentloaded' })
    await page.locator('input').first().fill(ready.pairing.pairingUrl)
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.locator('[data-terminay-app-component]').waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Toggle file explorer' }).click()

    const docsRow = page
      .locator('.file-explorer-tree-item--directory')
      .filter({ hasText: 'docs' })
      .first()
    await docsRow.waitFor({ state: 'visible' })
    await docsRow.dblclick()

    await page.locator('.folder-viewer__title').filter({ hasText: 'docs' }).waitFor({ state: 'visible' })
    await page.locator('.folder-viewer__tree-file').filter({ hasText: 'guide.md' }).waitFor({ state: 'visible' })
    await page.locator('[data-terminay-app-component]').waitFor({ state: 'visible' })
    const bodyText = await page.locator('body').innerText()
    assert.match(bodyText, /EXPLORER/u)
    assert.doesNotMatch(bodyText, /disconnected file compatibility provider is unavailable/u)
    assert.deepEqual(diagnostics, [])
  } finally {
    await browser?.close().catch(() => undefined)
    await web.close().catch(() => undefined)
    if (server !== undefined) await stopServer(server)
    await rm(root, { recursive: true, force: true })
    await rm(dataRoot, { recursive: true, force: true })
  }
})

function startServer({ dataRoot, projectRoot, webOrigin }) {
  return spawn(
    process.execPath,
    [
      path.resolve('apps/terminay-server/dist/cli.js'),
      '--server-id', 'browser-folder-open',
      '--data-root', dataRoot,
      '--project-root', projectRoot,
      '--web-origin', webOrigin,
      '--http-host', '127.0.0.1',
      '--http-port', '0',
      '--endpoint', 'loopback',
      '--agent-integration', 'disabled',
    ],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

async function readReadiness(child) {
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let output = ''
  let errorOutput = ''
  child.stderr.on('data', chunk => {
    errorOutput += chunk
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`server readiness timeout: ${errorOutput}`)),
      10_000,
    )
    child.stdout.on('data', chunk => {
      output += chunk
      const newline = output.indexOf('\n')
      if (newline < 0) return
      clearTimeout(timeout)
      resolve(JSON.parse(output.slice(0, newline)))
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (output.includes('\n')) return
      clearTimeout(timeout)
      reject(new Error(`server exited before readiness code=${code} signal=${signal}: ${errorOutput}`))
    })
  })
}

async function stopServer(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    once(child, 'exit'),
    new Promise(resolve => setTimeout(resolve, 2_000)),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function startStaticServer(root) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const relative = pathname === '/' ? 'web.html' : pathname.replace(/^\/+/u, '')
    const file = path.resolve(root, relative)
    if (!file.startsWith(root)) {
      response.writeHead(403).end()
      return
    }
    await mkdir(root, { recursive: true })
    response.setHeader(
      'content-type',
      file.endsWith('.html')
        ? 'text/html'
        : file.endsWith('.css')
          ? 'text/css'
          : 'text/javascript',
    )
    createReadStream(file)
      .on('error', () => response.writeHead(404).end())
      .pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Static server did not bind')
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      ),
  }
}
