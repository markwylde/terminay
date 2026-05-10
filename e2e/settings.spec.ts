import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

function remoteOriginInput(page: Page) {
  return page.locator('#section-remote-access-host .settings-row').nth(0).locator('input')
}

function bindAddressInput(page: Page) {
  return page.locator('#section-remote-access-host .settings-row').nth(1).locator('input')
}

test('opens settings focused to remote access and supports settings search', async ({ appHarness, mainWindow }) => {
  const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'remote-access-host' })

  await expect(settingsWindow.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(settingsWindow.getByRole('heading', { name: 'Host & Origin' })).toBeVisible()
  await expect(remoteOriginInput(settingsWindow)).toHaveValue('https://localhost:9443')
  await expect(bindAddressInput(settingsWindow)).toHaveValue('0.0.0.0')

  const search = settingsWindow.getByPlaceholder('Search settings...')
  await search.fill('scrollback')

  await expect(settingsWindow.getByRole('heading', { name: 'Scrollback' })).toBeVisible()
  await expect(settingsWindow.getByText('Scrollback lines')).toBeVisible()
  await expect(settingsWindow.getByRole('button', { name: 'Scrolling' })).toBeVisible()
})

test('persists settings edits across reopening the settings window', async ({ appHarness, mainWindow }) => {
  const updatedOrigin = 'https://e2e-settings.terminay.test:9443'

  const firstWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'remote-access-host' })

  const originInput = remoteOriginInput(firstWindow)
  await originInput.fill(updatedOrigin)
  await expect(firstWindow.locator('.settings-status')).toContainText('Saved')
  await firstWindow.close()

  const secondWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'remote-access-host' })

  await expect(remoteOriginInput(secondWindow)).toHaveValue(updatedOrigin)
})

test('resets settings back to defaults', async ({ appHarness, mainWindow }) => {
  const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'remote-access-host' })
  const dialogs = await appHarness.dialogs(settingsWindow)

  const originInput = remoteOriginInput(settingsWindow)
  await originInput.fill('https://reset-me.terminay.test:9443')
  await expect(settingsWindow.locator('.settings-status')).toContainText('Saved')

  await dialogs.queueConfirm(true)
  await settingsWindow.getByRole('button', { name: 'Reset to defaults' }).click()

  await expect(remoteOriginInput(settingsWindow)).toHaveValue('https://localhost:9443')
  await expect(settingsWindow.locator('.settings-status')).toContainText('Saved')
})
