import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const execFileAsync = promisify(execFile)
const REPO_FILE = 'acceptance.txt'
const ORIGINAL_TEXT = 'opened through FileViewerClient\n'
const UPDATED_TEXT = 'saved through connected browser FileViewerClient\n'

test('built connected browser lists Explorer root, opens/edits a file, and renders Git state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'terminay-browser-file-git-'))
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'terminay-browser-file-git-data-'))
  const web = await startStaticServer(path.resolve('dist-web'))
  let server
  let browser
  try {
    await writeFile(path.join(root, REPO_FILE), ORIGINAL_TEXT)
    await execFileAsync('git', ['init'], { cwd: root })
    await execFileAsync('git', ['config', 'user.email', 'acceptance@example.invalid'], { cwd: root })
    await execFileAsync('git', ['config', 'user.name', 'Acceptance Test'], { cwd: root })
    await execFileAsync('git', ['add', REPO_FILE], { cwd: root })
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

    const explorerItem = page.locator('.file-explorer-tree-item').filter({ hasText: REPO_FILE }).first()
    await explorerItem.waitFor({ state: 'visible' })
    await waitForNavigationText(page, text =>
      text.includes(`EXPLORER\n${REPO_FILE}`) &&
      /GIT\n\d+\n[\s\S]*(?:clean|No changes)/u.test(text),
      'Explorer root and Git clean state',
    )

    await explorerItem.focus()
    await explorerItem.press('Enter')
    await page.locator('.file-preview-text').filter({ hasText: ORIGINAL_TEXT.trim() }).waitFor({ state: 'visible' })
    await page.getByRole('tab', { name: 'Text' }).click()
    await page.locator('.monaco-editor').waitFor({ state: 'visible' })
    await page.evaluate((nextValue) => {
      const monacoApi = globalThis.monaco
      const model = monacoApi?.editor?.getModels()?.at(-1)
      if (model === undefined) throw new Error('No Monaco model is available')
      model.setValue(nextValue)
    }, UPDATED_TEXT)
    await page.locator('.file-status-bar').filter({ hasText: 'Unsaved changes' }).waitFor({ state: 'visible' })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S')
    await waitForFileText(path.join(root, REPO_FILE), UPDATED_TEXT)
    await page.locator('.file-status-bar').filter({ hasText: 'Synced' }).waitFor({ state: 'visible' })
    await waitForNavigationText(page, text =>
      /GIT\n\d+\n[\s\S]*acceptance\.txt/u.test(text) ||
      /GIT\n\d+\n[\s\S]*(?:dirty|modified|change)/iu.test(text),
      'Git dirty state after connected browser save',
    )

    assert.deepEqual(diagnostics, [])
  } finally {
    await browser?.close().catch(() => undefined)
    await web.close().catch(() => undefined)
    if (server !== undefined) await stopServer(server)
    await rm(root, { recursive: true, force: true })
    await rm(dataRoot, { recursive: true, force: true })
  }
})

async function waitForNavigationText(page, predicate, label) {
  const deadline = Date.now() + 10_000
  let lastText = ''
  while (Date.now() < deadline) {
    lastText = await page.locator('.workspace-split-layout__navigation').innerText().catch(() => '')
    if (predicate(lastText)) return lastText
    await page.waitForTimeout(100)
  }
  throw new Error(`Timed out waiting for ${label}. Last navigation text:\n${lastText}`)
}

async function waitForFileText(file, expected) {
  const deadline = Date.now() + 10_000
  let lastText = ''
  while (Date.now() < deadline) {
    lastText = await readFile(file, 'utf8').catch(() => '')
    if (lastText === expected) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for saved file text. Last text:\n${lastText}`)
}

function startServer({ dataRoot, projectRoot, webOrigin }) {
  return spawn(
    process.execPath,
    [
      path.resolve('apps/terminay-server/dist/cli.js'),
      '--server-id', 'browser-file-git',
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
