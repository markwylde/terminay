import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

async function getActiveSessionId(page: Page): Promise<string> {
  const sessionId = await page.locator('.terminal-panel').first().getAttribute('data-termide-terminal-session-id')

  if (!sessionId) {
    throw new Error('Active terminal session id is unavailable')
  }

  return sessionId
}

async function writeToTerminal(page: Page, data: string): Promise<void> {
  const sessionId = await getActiveSessionId(page)
  await page.evaluate(({ nextData, nextSessionId }) => {
    window.termide.writeTerminal(nextSessionId, nextData)
  }, { nextData: data, nextSessionId: sessionId })
}

test.describe('terminal behavior', () => {
  test('edits the active terminal tab title and hue', async ({ mainWindow }) => {
    const firstTab = mainWindow.locator('.terminal-tab-content').first()

    await firstTab.dblclick()

    const editDialog = mainWindow.locator('.project-edit-modal')
    await expect(editDialog.getByRole('heading', { name: 'Edit Terminal Tab' })).toBeVisible()

    await editDialog.getByPlaceholder('Terminal name').fill('Build Shell')
    await editDialog.locator('.hue-slider').fill('30')
    await editDialog.getByRole('button', { name: 'Save' }).click()

    const updatedTab = mainWindow.locator('.terminal-tab-content').first()
    await expect(updatedTab.locator('.terminal-tab-title')).toHaveText('Build Shell')
    await expect(updatedTab).toHaveAttribute('data-has-color', 'true')
  })

  test('opens terminal search and navigates between matches', async ({ mainWindow }) => {
    await mainWindow.locator('.terminal-panel').first().click()
    await writeToTerminal(mainWindow, "printf 'termide-search-hit\\nother-line\\ntermide-search-hit\\n'\r")

    await mainWindow.locator('.terminal-panel').first().click()
    await mainWindow.keyboard.press('Meta+F')

    const search = mainWindow.getByRole('search', { name: 'Search terminal output' })
    await expect(search).toBeVisible()

    const input = search.getByLabel('Find in terminal')
    await input.fill('termide-search-hit')

    await expect.poll(async () => await search.locator('.terminal-search-count').textContent()).toBe('1/2')

    await search.getByLabel('Next match').click()
    await expect(search.locator('.terminal-search-count')).toHaveText('2/2')

    await search.getByLabel('Previous match').click()
    await expect(search.locator('.terminal-search-count')).toHaveText('1/2')

    await search.getByLabel('Close search').click()
    await expect(search).toBeHidden()
  })
})
