import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, test } from '@playwright/test'

const repositoryRoot = process.cwd()
const serverCli = join(repositoryRoot, 'apps/terminay-server/dist/cli.js')

interface ServerReadiness {
  ready: true
  pairing: {
    pairingUrl: string
  }
}

// biome-ignore lint/correctness/noEmptyPattern: Playwright test callbacks require an object fixture pattern.
test('Desktop remote connection modal returns before a real standalone handshake and switches authority', async ({}, testInfo) => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'terminay-task7-remote-server-'))
  const userDataRoot = await mkdtemp(join(tmpdir(), 'terminay-task7-electron-'))
  const server = spawn(process.execPath, [
    serverCli,
    '--server-id', 'task7-remote-authority',
    '--data-root', dataRoot,
    '--project-root', repositoryRoot,
    '--http-host', '127.0.0.1',
    '--http-port', '0',
  ], {
    cwd: repositoryRoot,
    env: { ...process.env, TERMINAY_SERVER_VERSION: 'task7' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.setEncoding('utf8')
  server.stderr.setEncoding('utf8')
  let stderr = ''
  server.stderr.on('data', (chunk) => { stderr += chunk })

  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let stage = 'start standalone server'
  try {
    const readiness = await readReadiness(server)
    stage = 'validate standalone readiness'
    assert.equal(readiness.ready, true, stderr)
    assert.equal(typeof readiness.pairing?.pairingUrl, 'string')

    stage = 'launch Electron'
    application = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        CI: '1',
        TERMINAY_TEST: '1',
        TERMINAY_USER_DATA_DIR: userDataRoot,
      },
    })
    stage = 'open Electron main window'
    const page = await application.firstWindow()
    stage = 'wait for Local workspace'
    await page.locator('.project-tabbar').waitFor({ state: 'visible' })
    stage = 'open remote connection modal'
    await page.getByLabel('Open connection menu').click()
    await page.getByRole('button', { name: 'Manage connections…' }).click()

    const dialog = page.getByRole('dialog', { name: 'Connections' })
    await dialog.getByRole('textbox', { name: 'Pairing URL' }).fill(readiness.pairing.pairingUrl)
    stage = 'submit pairing URL'
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click()

    // Regression for the historical IPC/MessagePort deadlock: the invoke
    // resolves as soon as the port is transferred, rather than awaiting a
    // client_hello that cannot be sent until this renderer receives the port.
    stage = 'wait for modal to close after IPC return'
    await dialog.waitFor({ state: 'detached', timeout: 5_000 })
    // Local is already connected when this test begins.  A global "connected"
    // flag therefore cannot establish that the newly requested remote client
    // completed.  The connection-menu projection is the host's authoritative,
    // user-visible binding, and includes the actual remote server identity.
    stage = 'wait for the requested remote authority'
    await page.getByLabel('Open connection menu').click()
    const connectionMenu = page.getByRole('menu', { name: 'Connection menu' })
    try {
      await connectionMenu.getByText('Server ID: task7-remote-authority', { exact: true }).waitFor({ timeout: 10_000 })
      await connectionMenu.getByText('This Desktop host', { exact: true }).waitFor({ state: 'detached', timeout: 10_000 })
    } catch (error) {
      await testInfo.attach('task7-connection-menu.txt', {
        body: await connectionMenu.innerText().catch(() => '<connection menu unavailable>'),
        contentType: 'text/plain',
      })
      await testInfo.attach('task7-renderer-context.txt', {
        body: await page.evaluate(() => {
          const root = document.querySelector('#root') as (HTMLElement & Record<string, unknown>) | null
          const container = root === null ? undefined : Object.values(root).find((value) => typeof value === 'object' && value !== null && 'current' in value) as { current?: unknown } | undefined
          const pending = [container?.current as { child?: unknown } | undefined]
          while (pending.length > 0) {
            const fiber = pending.pop() as { child?: unknown; sibling?: unknown; type?: { name?: unknown }; memoizedProps?: { terminalClientContext?: { serverId?: unknown } } } | undefined
            if (fiber === undefined) continue
            if (fiber.type?.name === 'App') return String(fiber.memoizedProps?.terminalClientContext?.serverId ?? '<no terminal client context>')
            pending.push(fiber.child as { child?: unknown } | undefined, fiber.sibling as { child?: unknown } | undefined)
          }
          return '<App fiber unavailable>'
        }),
        contentType: 'text/plain',
      })
      await testInfo.attach('task7-renderer-server-state.txt', {
        body: await page.evaluate(() => JSON.stringify({
          state: (window as Window & { __terminayServerClientState?: unknown }).__terminayServerClientState,
        })),
        contentType: 'application/json',
      })
      const serverState = await page.evaluate(() => JSON.stringify({
        state: (window as Window & { __terminayServerClientState?: unknown }).__terminayServerClientState,
      }))
      throw new Error(`Remote authority did not project; renderer server state: ${serverState}`, { cause: error })
    }
  } finally {
    await testInfo.attach('task7-stage.txt', { body: stage, contentType: 'text/plain' })
    await closeElectronApplication(application)
    if (server.exitCode === null) {
      server.kill('SIGTERM')
      await Promise.race([
        once(server, 'exit'),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])
    }
    await rm(dataRoot, { recursive: true, force: true })
    await rm(userDataRoot, { recursive: true, force: true })
  }
})

async function closeElectronApplication(application: Awaited<ReturnType<typeof electron.launch>> | undefined): Promise<void> {
  if (application === undefined) return
  const closeWithin = async (promise: Promise<unknown>, timeoutMs: number): Promise<boolean> => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise.then(() => true).catch(() => false),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), timeoutMs)
        }),
      ])
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }
  if (await closeWithin(application.close(), 5_000)) return
  await closeWithin(application.evaluate(({ BrowserWindow, app }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.destroy()
    }
    app.exit(0)
  }), 5_000)
  if (await closeWithin(application.waitForEvent('close'), 5_000)) return
  const process = application.process()
  if (process.exitCode === null) process.kill('SIGKILL')
  await closeWithin(once(process, 'exit'), 5_000)
}

async function readReadiness(server: ReturnType<typeof spawn>): Promise<ServerReadiness> {
  let buffered = ''
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('standalone server readiness timed out')), 20_000)
    const cleanup = () => {
      clearTimeout(timeout)
      server.stdout.off('data', onData)
      server.off('exit', onExit)
    }
    const onExit = (code: number | null) => {
      cleanup()
      reject(new Error(`standalone server exited before readiness (${code ?? 'signal'})`))
    }
    const onData = (chunk: string) => {
      buffered += chunk
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          if (parsed?.ready === true) {
            cleanup()
            resolve(parsed as ServerReadiness)
            return
          }
        } catch {
          // Non-readiness logs are not protocol output.
        }
      }
    }
    server.stdout.on('data', onData)
    server.once('exit', onExit)
  })
}
