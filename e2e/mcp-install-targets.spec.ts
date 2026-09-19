import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

const TARGETS = ['claude-code', 'codex', 'cursor', 'gemini', 'grok', 'opencode']

async function openMcpInstallModal(appHarness: { openMacroLauncher(page: Page): Promise<void> }, page: Page) {
  await appHarness.openMacroLauncher(page)
  await page.getByLabel('Search commands').fill('install terminay mcp')
  const item = page.locator('.macro-launcher-item').filter({
    has: page.locator('.macro-launcher-item-title', { hasText: 'Install Terminay MCP' }),
  })
  await expect(item).toBeVisible()
  await item.click()
  const dialog = page.getByRole('dialog', { name: 'Install Terminay MCP' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('lists the built-in agents extension install targets and explains when it is disabled', async ({ appHarness, mainWindow }) => {
  let dialog = await openMcpInstallModal(appHarness, mainWindow)
  const rows = dialog.locator('[data-mcp-install-target]')
  await expect(rows).toHaveCount(TARGETS.length, { timeout: 30_000 })
  expect(await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-mcp-install-target')))).toEqual(
    TARGETS.map((target) => `com.terminay.builtin-agents/${target}`),
  )
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'extensions' })
  const agentsCard = settingsWindow.getByRole('article').filter({ hasText: 'terminay-builtin-agents' })
  await agentsCard.getByRole('button', { name: 'Disable' }).click()
  await expect(agentsCard.getByRole('button', { name: 'Enable' })).toBeVisible({ timeout: 30_000 })

  dialog = await openMcpInstallModal(appHarness, mainWindow)
  await expect(dialog.getByRole('note')).toContainText('Built-in Agents extension', { timeout: 30_000 })
  await expect(dialog.locator('[data-mcp-install-target]')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /^(Install|Uninstall)$/u })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()

  await agentsCard.getByRole('button', { name: 'Enable' }).click()
  await expect(agentsCard.getByRole('button', { name: 'Disable' })).toBeVisible({ timeout: 30_000 })
})
