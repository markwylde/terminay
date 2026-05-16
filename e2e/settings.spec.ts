import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

function remoteOriginInput(page: Page) {
  return page.locator('#section-remote-access-host .settings-row').filter({ hasText: 'Remote origin' }).locator('input')
}

function bindAddressInput(page: Page) {
  return page.locator('#section-remote-access-host .settings-row').filter({ hasText: 'Bind address' }).locator('input')
}

async function getActiveTerminalSessionId(page: Page): Promise<string> {
  const sessionId = await page.locator('.terminal-panel').first().getAttribute('data-terminay-terminal-session-id')
  if (!sessionId) {
    throw new Error('Active terminal session id is unavailable')
  }

  return sessionId
}

async function writeToActiveTerminal(page: Page, data: string): Promise<void> {
  const sessionId = await getActiveTerminalSessionId(page)
  await page.evaluate(({ nextData, nextSessionId }) => {
    window.terminay.writeTerminal(nextSessionId, nextData)
  }, { nextData: data, nextSessionId: sessionId })
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

test('shows recording settings and saves recording defaults', async ({ appHarness, mainWindow, tempDir }) => {
  const recordingDir = `${tempDir}/settings-recordings`
  const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'recording-defaults' })

  await expect(settingsWindow.getByRole('heading', { name: 'Session Recording' })).toBeVisible()
  await expect(settingsWindow.getByRole('button', { name: /Recording/ })).toBeVisible()

  await settingsWindow.getByLabel('Record new terminals').check()
  await settingsWindow
    .locator('#section-recording-defaults .settings-row')
    .filter({ hasText: 'Recording directory' })
    .locator('input')
    .fill(recordingDir)
  await settingsWindow.getByLabel('Capture input').check()
  await settingsWindow
    .locator('#section-recording-defaults .settings-row')
    .filter({ hasText: 'Sensitive input' })
    .locator('select')
    .selectOption('mask')
  await settingsWindow.getByLabel('Open timeline after saving').check()
  await expect(settingsWindow.locator('.settings-status')).toContainText('Saved')

  const savedRecordingSettings = await mainWindow.evaluate(async () => {
    return (await window.terminay.getTerminalSettings()).recording
  })

  expect(savedRecordingSettings).toMatchObject({
    captureInput: true,
    directory: recordingDir,
    openTimelineAfterSaving: true,
    recordNewTerminals: true,
    sensitiveInputPolicy: 'mask',
  })
})

test('keeps the active terminal visible after changing settings and closing settings', async ({
  appHarness,
  mainWindow,
}) => {
  const sentinel = 'terminay-settings-terminal-survived'

  await writeToActiveTerminal(mainWindow, `printf '${sentinel}\\n'\r`)
  await expect(mainWindow.locator('.xterm-rows')).toContainText(sentinel)

  const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'typography' })
  const fontSizeInput = settingsWindow
    .locator('#section-typography .settings-row')
    .filter({ hasText: 'Font size' })
    .locator('input[type="number"]')

  await fontSizeInput.fill('14')
  await expect(settingsWindow.locator('.settings-status')).toContainText('Saved')
  await settingsWindow.close()

  await expect(mainWindow.locator('.xterm-rows')).toContainText(sentinel)
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
