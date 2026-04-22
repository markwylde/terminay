import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from './fixtures'

async function sendAppCommand(page: Page, command: string): Promise<void> {
  await page.evaluate(async (nextCommand) => {
    const bridge = (window as Window & {
      termideTest?: { sendAppCommand: (command: string) => Promise<void> }
    }).termideTest

    if (!bridge) {
      throw new Error('termideTest bridge is unavailable')
    }

    await bridge.sendAppCommand(nextCommand)
  }, command)
}

async function openMacroLauncher(page: Page): Promise<void> {
  const launcher = page.getByRole('dialog', { name: 'Macro launcher' })

  for (let attempt = 0; attempt < 3; attempt++) {
    await sendAppCommand(page, 'open-macro-launcher')

    try {
      await expect(launcher).toBeVisible({ timeout: 2_000 })
      return
    } catch (error) {
      if (attempt === 2) {
        throw error
      }
    }
  }
}

async function openChildWindow(
  electronApp: ElectronApplication,
  action: () => Promise<void>,
): Promise<Page> {
  const nextWindowPromise = electronApp.waitForEvent('window')
  await action()
  const nextWindow = await nextWindowPromise
  await nextWindow.waitForLoadState('domcontentloaded')
  return nextWindow
}

test('opens and closes terminal tabs', async ({ mainWindow }) => {
  const closeButtons = mainWindow.getByLabel('Close terminal')
  await expect(closeButtons).toHaveCount(1)

  await expect(mainWindow.locator('.termide-add-tab-button').first()).toBeVisible()
  await mainWindow.locator('.termide-add-tab-button').first().click()
  await expect(closeButtons).toHaveCount(2)

  await closeButtons.nth(1).click()
  await expect(closeButtons).toHaveCount(1)
})

test('opens and closes the file explorer sidebar', async ({ mainWindow }) => {
  const toggleButton = mainWindow.getByLabel('Toggle file explorer')
  const sidebar = mainWindow.locator('.file-explorer-sidebar')

  await expect(sidebar).toHaveCount(0)
  await toggleButton.click()
  await expect(sidebar).toBeVisible()

  await toggleButton.click()
  await expect(sidebar).toHaveCount(0)
})

test('opens the settings window', async ({ electronApp, mainWindow }) => {
  const settingsWindow = await openChildWindow(electronApp, async () => {
    await mainWindow.evaluate(async () => {
      await window.termide.openSettingsWindow()
    })
  })

  await expect(settingsWindow.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(settingsWindow.getByPlaceholder('Search settings...')).toBeVisible()
})

test('opens the macros window', async ({ electronApp, mainWindow }) => {
  const macrosWindow = await openChildWindow(electronApp, async () => {
    await mainWindow.evaluate(async () => {
      await window.termide.openMacrosWindow()
    })
  })

  await expect(macrosWindow.getByRole('heading', { name: 'Macros' })).toBeVisible()
  await expect(macrosWindow.getByRole('button', { name: 'New Macro' })).toBeVisible()
  await expect(macrosWindow.getByText('Build reusable automation steps.')).toBeVisible()
})

test('runs a macro from the launcher and records the completed run', async ({ mainWindow }) => {
  await openMacroLauncher(mainWindow)
  await mainWindow.getByRole('button', { name: 'Create a pull request' }).click()

  const macroQueueTrigger = mainWindow.getByLabel('Show macro queue (1)')
  await expect(macroQueueTrigger).toBeVisible()
  await macroQueueTrigger.click()

  const macroQueue = mainWindow.getByRole('menu', { name: 'Macro queue' })
  await expect(macroQueue).toBeVisible()
  await expect(macroQueue.locator('.terminal-tab-macro-run__title')).toHaveText('Create a pull request')
  await expect(macroQueue.locator('.terminal-tab-macro-run__status')).toHaveText('completed')
})
