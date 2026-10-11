import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { sendNotificationCommand } from './support/notifications'
import { submitTerminalCommand } from './support/terminal'

const PHONE = { x: 40, y: 40, width: 390, height: 740 } as const

async function resize(
  page: Page,
  electronApp: ElectronApplication,
  bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const nativeWindow = await electronApp.browserWindow(page)
  await nativeWindow.evaluate((window, next) => {
    window.setBounds(next)
  }, bounds)
}

const bellOf = (page: Page) => page.locator('[data-compact-notifications-button="true"]')
const sheetOf = (page: Page) => page.getByRole('dialog', { name: 'Notifications' })

/** One notification a process sent, then the window at phone width. */
async function phoneWithNotification(
  page: Page,
  electronApp: ElectronApplication,
  userDataDir: string,
  body: string,
): Promise<void> {
  const send = await sendNotificationCommand(userDataDir, { title: 'Deploy finished', body })
  await submitTerminalCommand(page, `${send}\r`)
  await expect(page.locator('.notifications-count')).toHaveText('1', { timeout: 15_000 })
  await resize(page, electronApp, PHONE)
  await expect(page.locator('[data-compact-chrome="true"]')).toBeVisible()
}

test.describe('notifications at phone width', () => {
  test('the bell counts notifications and its sheet lists and clears them', async ({
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    await phoneWithNotification(mainWindow, electronApp, userDataDir, 'api is live')

    const bell = bellOf(mainWindow)
    await expect(bell).toHaveAccessibleName('Notifications, 1 notification')
    await expect(bell.locator('.notifications-count')).toHaveText('1')

    await bell.click()
    const sheet = sheetOf(mainWindow)
    await expect(sheet).toBeVisible()
    const row = sheet.locator('.terminal-activity-menu__row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Deploy finished')
    await expect(row).toContainText('api is live')

    await sheet.getByRole('button', { name: 'Clear all' }).click()
    await expect(sheet).toContainText('No notifications')
    await expect(bell.locator('.notifications-count')).toHaveCount(0)
    await expect(bell).toHaveAccessibleName('Notifications')

    await mainWindow.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
  })

  test('choosing a notification goes to its terminal, closes the sheet, and clears it', async ({
    electronApp,
    mainWindow,
    userDataDir,
  }) => {
    await phoneWithNotification(mainWindow, electronApp, userDataDir, 'come and look')

    await bellOf(mainWindow).click()
    const sheet = sheetOf(mainWindow)
    await sheet.locator('.terminal-activity-menu__item').click()

    await expect(sheet).toHaveCount(0)
    await expect(bellOf(mainWindow).locator('.notifications-count')).toHaveCount(0)
  })

  test('the bell and the terminal switcher never show together', async ({
    electronApp,
    mainWindow,
  }) => {
    await resize(mainWindow, electronApp, PHONE)
    await expect(mainWindow.locator('[data-compact-chrome="true"]')).toBeVisible()

    await mainWindow.locator('[data-compact-breadcrumb="true"]').click()
    const switcher = mainWindow.getByRole('dialog', { name: 'Switch terminal' })
    await expect(switcher).toBeVisible()
    await mainWindow.keyboard.press('Escape')
    await expect(switcher).toHaveCount(0)

    await bellOf(mainWindow).click()
    await expect(sheetOf(mainWindow)).toBeVisible()
    await expect(sheetOf(mainWindow)).toContainText('No notifications')
    await expect(switcher).toHaveCount(0)
  })
})
