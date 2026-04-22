import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, type ElectronApplication, type Page, test as base } from '@playwright/test'

type ElectronFixtures = {
  electronApp: ElectronApplication
  mainWindow: Page
  userDataDir: string
}

export const test = base.extend<ElectronFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture callbacks require an object pattern here.
  userDataDir: async ({}, use) => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'termide-e2e-'))

    try {
      await use(userDataDir)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  },

  electronApp: async ({ userDataDir }, use) => {
    const electronApp = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        CI: '1',
        TERMIDE_TEST: '1',
        TERMIDE_USER_DATA_DIR: userDataDir,
      },
    })

    try {
      await use(electronApp)
    } finally {
      await electronApp.close()
    }
  },

  mainWindow: async ({ electronApp }, use) => {
    const mainWindow = await electronApp.firstWindow()
    await mainWindow.waitForLoadState('domcontentloaded')
    await expect(mainWindow.locator('.project-tabbar')).toBeVisible()
    await use(mainWindow)
  },
})

export { expect }
