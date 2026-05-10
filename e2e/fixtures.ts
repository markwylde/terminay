import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, type ElectronApplication, type Page, test as base } from '@playwright/test'
import {
  openChildWindow,
  openMacroLauncher,
  openMacrosWindow,
  openSettingsWindow,
  prepareWindow,
  sendAppCommand,
} from './support/app'
import { createDialogController, type DialogController } from './support/dialogs'
import { createFixtureWorkspace, type FixtureWorkspace, type WorkspaceOptions } from './support/workspace'

type ElectronFixtures = {
  appHarness: {
    dialogs: (page?: Page) => Promise<DialogController>
    openChildWindow: (action: () => Promise<void>) => Promise<Page>
    openMacroLauncher: (page?: Page, options?: { attempts?: number }) => Promise<void>
    openMacrosWindow: (page?: Page) => Promise<Page>
    openSettingsWindow: (options?: { page?: Page; sectionId?: string }) => Promise<Page>
    prepareWindow: (page: Page) => Promise<Page>
    sendAppCommand: (command: import('../src/types/terminay').AppCommand, page?: Page) => Promise<void>
  }
  createWorkspace: (options?: WorkspaceOptions) => Promise<FixtureWorkspace>
  electronApp: ElectronApplication
  mainWindow: Page
  tempDir: string
  userDataDir: string
}

async function closeElectronAppGracefully(electronApp: ElectronApplication): Promise<void> {
  const closeTimeoutMs = process.env.CI ? 15_000 : 5_000

  const raceWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  }

  try {
    await raceWithTimeout(electronApp.close(), closeTimeoutMs, 'Timed out waiting for Electron to close gracefully.')
    return
  } catch {
    // Fall through to a harder shutdown path to keep teardown deterministic in CI.
  }

  try {
    await electronApp.evaluate(({ BrowserWindow, app }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.destroy()
        }
      }

      app.exit(0)
    })
  } catch {
    // If the main process is already gone, the process kill fallback below will no-op.
  }

  if (electronApp.process().exitCode !== null) {
    return
  }

  try {
    await raceWithTimeout(
      electronApp.waitForEvent('close', { timeout: closeTimeoutMs }),
      closeTimeoutMs,
      'Timed out waiting for Electron to exit after forcing shutdown.',
    )
  } catch {
    if (electronApp.process().exitCode === null) {
      electronApp.process().kill('SIGKILL')
    }
  }
}

export const test = base.extend<ElectronFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture callbacks require an object pattern here.
  userDataDir: async ({}, use) => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'terminay-e2e-'))

    try {
      await use(userDataDir)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  },

  tempDir: async ({ userDataDir }, use) => {
    const tempDir = path.join(userDataDir, 'temp')

    await rm(tempDir, { recursive: true, force: true })
    await mkdir(tempDir, { recursive: true })
    await use(tempDir)
  },

  electronApp: async ({ tempDir, userDataDir }, use) => {
    const electronApp = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        CI: '1',
        TEMP: tempDir,
        TERMINAY_E2E_TEMP_DIR: tempDir,
        TERMINAY_TEST: '1',
        TERMINAY_USER_DATA_DIR: userDataDir,
        TMP: tempDir,
        TMPDIR: tempDir,
      },
    })

    try {
      await use(electronApp)
    } finally {
      await closeElectronAppGracefully(electronApp)
    }
  },

  mainWindow: async ({ electronApp }, use) => {
    const mainWindow = await prepareWindow(await electronApp.firstWindow())
    await expect(mainWindow.locator('.project-tabbar')).toBeVisible()
    await expect(mainWindow.locator('.terminal-tab-content')).toHaveCount(1)
    await use(mainWindow)
  },

  appHarness: async ({ electronApp, mainWindow }, use) => {
    await use({
      dialogs: async (page = mainWindow) => {
        await prepareWindow(page)
        return createDialogController(page)
      },
      openChildWindow: (action) => openChildWindow(electronApp, action),
      openMacroLauncher: (page = mainWindow, options) => openMacroLauncher(page, options),
      openMacrosWindow: (page = mainWindow) => openMacrosWindow(electronApp, page),
      openSettingsWindow: (options) =>
        openSettingsWindow(electronApp, options?.page ?? mainWindow, { sectionId: options?.sectionId }),
      prepareWindow,
      sendAppCommand: (command, page = mainWindow) => sendAppCommand(page, command),
    })
  },

  createWorkspace: async ({ tempDir }, use) => {
    await use((options?: WorkspaceOptions) => createFixtureWorkspace(tempDir, options))
  },
})

export { expect }
