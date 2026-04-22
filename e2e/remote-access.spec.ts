import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { openRemoteMenu } from './support/ui'

function remoteOriginInput(page: Page) {
  return page.locator('#section-remote-access-host .settings-row').nth(0).locator('input')
}

test('opens remote access settings from the host menu', async ({ appHarness, mainWindow }) => {
  await openRemoteMenu(mainWindow)

  const settingsWindow = await appHarness.openChildWindow(async () => {
    await mainWindow.getByRole('button', { name: 'Remote Access Settings' }).click()
  })

  await expect(settingsWindow.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(settingsWindow.getByRole('heading', { name: 'Host & Origin' })).toBeVisible()
  await expect(remoteOriginInput(settingsWindow)).toHaveValue('https://localhost:9443')
})

test('starts remote access from the host menu and shows a pairing qr modal', async ({ mainWindow }) => {
  await openRemoteMenu(mainWindow)
  await mainWindow.getByRole('button', { name: 'Start Server & Show QR' }).click()

  const pairingDialog = mainWindow.getByRole('dialog', { name: 'Pair device' })
  await expect(pairingDialog).toBeVisible()
  await expect(pairingDialog.getByRole('heading', { name: 'Pair Device' })).toBeVisible()
  await expect(pairingDialog.getByAltText('Pair device QR code')).toBeVisible()
  await expect(pairingDialog.getByText('Open this address in your browser')).toBeVisible()
  await expect(pairingDialog.getByText(/^Expires /)).toBeVisible()

  await pairingDialog.getByRole('button', { name: 'Close' }).click()
  await expect(pairingDialog).toHaveCount(0)

  await openRemoteMenu(mainWindow)
  await expect(mainWindow.getByRole('button', { name: 'Show Pairing QR' })).toBeVisible()
  await expect(mainWindow.getByRole('button', { name: 'Stop Server' })).toBeVisible()
  await mainWindow.getByRole('button', { name: 'Stop Server' }).click()
  await openRemoteMenu(mainWindow)
  await expect(mainWindow.locator('.remote-access-menu__item').filter({ hasText: 'Start Server' }).first()).toBeVisible()
})

test('manages remote access from the settings window host section', async ({ appHarness, mainWindow }) => {
  const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'remote-access-host' })

  await expect(settingsWindow.getByRole('heading', { name: 'Pair Device & Live Access' })).toBeVisible()
  await expect(settingsWindow.getByText('Click Pair Device to start remote access and generate a fresh pairing QR code for browsers.')).toBeVisible()

  await settingsWindow.getByRole('button', { name: 'Pair Device' }).click()

  await expect(settingsWindow.getByText('Paired Devices')).toBeVisible()
  await expect(settingsWindow.getByAltText('Remote pairing QR code')).toBeVisible()
  await expect(settingsWindow.getByText('No paired browsers yet.')).toBeVisible()
  await expect(settingsWindow.getByText('No live remote connections.')).toBeVisible()
  await expect(settingsWindow.getByText('No remote access events yet.')).toBeVisible()

  await settingsWindow.getByRole('button', { name: 'Stop Remote Access' }).click()
  await expect(settingsWindow.getByRole('button', { name: 'Pair Device' })).toBeVisible()
})
