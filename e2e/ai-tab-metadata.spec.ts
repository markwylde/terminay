import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { normalizeTerminalSettings } from '../src/terminalSettings'

const isRealCodexRun = process.env.TERMIDE_TEST_USE_REAL_CODEX === '1'

function aiMetadataRows(page: Page) {
  return page.locator('#section-ai-tab-metadata .settings-row')
}

function aiMetadataSelect(page: Page, label: string) {
  return aiMetadataRows(page).filter({ hasText: label }).locator('select')
}

async function getActiveTerminalSessionId(page: Page): Promise<string> {
  const sessionId = await page.locator('.terminal-panel').first().getAttribute('data-termide-terminal-session-id')
  if (!sessionId) {
    throw new Error('Active terminal session id is unavailable')
  }

  return sessionId
}

async function writeToActiveTerminal(page: Page, data: string): Promise<void> {
  const sessionId = await getActiveTerminalSessionId(page)
  await page.evaluate(
    ({ nextSessionId, nextData }) => {
      window.termide.writeTerminal(nextSessionId, nextData)
    },
    { nextData: data, nextSessionId: sessionId },
  )
}

async function firstCodexModel(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const models = await window.termide.listAiTabMetadataModels('codex')
    const model = models[0]?.id
    if (!model) {
      throw new Error('No Codex model is available for AI tab metadata tests.')
    }

    return model
  })
}

async function configureAiTabMetadata(page: Page, model = 'codex-test-model') {
  await page.evaluate(async (codexModel) => {
    const settings = await window.termide.getTerminalSettings()
    await window.termide.updateTerminalSettings({
      ...settings,
      aiTabMetadata: {
        title: {
          provider: 'codex',
          codexModel,
        },
        note: {
          provider: 'codex',
          codexModel,
        },
      },
    })
  }, model)
  await page.waitForTimeout(100)
}

async function setAiMock(page: Page, options?: { error?: string | null }) {
  if (isRealCodexRun) {
    return
  }

  await page.evaluate(async (nextOptions) => {
    if (!window.termideTest) {
      throw new Error('termideTest bridge is unavailable')
    }

    await window.termideTest.setAiTabMetadataMock({
      error: nextOptions?.error ?? null,
      models: [
        { id: 'codex-test-model', label: 'Codex Test Model' },
        { id: 'codex-alt-model', label: 'Codex Alt Model' },
      ],
      noteResult: 'Reviewing package warnings from the latest build.',
      titleResult: 'Build Warnings',
    })
  }, options ?? null)
}

async function runCommandBarItem(page: Page, title: string) {
  await page.getByLabel('Search commands').fill(title.toLowerCase())
  const item = page.locator('.macro-launcher-item').filter({
    has: page.locator('.macro-launcher-item-title', { hasText: title }),
  })
  await expect(item).toBeVisible()
  await item.click()
  await expect(page.getByRole('dialog', { name: 'Command bar' })).toHaveCount(0)
}

test.describe('AI tab metadata settings', () => {
  test.skip(isRealCodexRun, 'Mocked settings coverage is skipped during the focused real Codex run.')

  test('normalizes defaults and invalid AI tab metadata settings', () => {
    expect(normalizeTerminalSettings({}).aiTabMetadata).toEqual({
      title: { provider: 'disabled', codexModel: '' },
      note: { provider: 'disabled', codexModel: '' },
    })

    expect(
      normalizeTerminalSettings({
        aiTabMetadata: {
          title: { provider: 'nonsense', codexModel: '  keep-title-model  ' },
          note: { provider: 'codex', codexModel: '  keep-note-model  ' },
        },
      }).aiTabMetadata,
    ).toEqual({
      title: { provider: 'disabled', codexModel: 'keep-title-model' },
      note: { provider: 'codex', codexModel: 'keep-note-model' },
    })
  })

  test('shows disabled defaults and reveals Codex model dropdowns', async ({ appHarness, mainWindow }) => {
    await setAiMock(mainWindow)
    const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'ai-tab-metadata' })

    await expect(settingsWindow.getByRole('heading', { name: 'Tab Metadata' })).toBeVisible()
    await expect(aiMetadataSelect(settingsWindow, 'Set title with AI')).toHaveValue('disabled')
    await expect(aiMetadataSelect(settingsWindow, 'Set note with AI')).toHaveValue('disabled')
    await expect(aiMetadataRows(settingsWindow).filter({ hasText: 'Title model' })).toHaveCount(0)

    await aiMetadataSelect(settingsWindow, 'Set title with AI').selectOption('codex')
    await expect(aiMetadataRows(settingsWindow).filter({ hasText: 'Title model' })).toBeVisible()
    await expect(aiMetadataSelect(settingsWindow, 'Title model')).toHaveValue('codex-test-model')
  })

  test('keeps provider selected when model loading fails', async ({ appHarness, mainWindow }) => {
    await mainWindow.evaluate(async () => {
      if (!window.termideTest) {
        throw new Error('termideTest bridge is unavailable')
      }

      await window.termideTest.setAiTabMetadataMock({
        error: null,
        models: [],
      })
    })
    const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'ai-tab-metadata' })

    await aiMetadataSelect(settingsWindow, 'Set note with AI').selectOption('codex')
    await expect(aiMetadataSelect(settingsWindow, 'Set note with AI')).toHaveValue('codex')
    await expect(settingsWindow.getByText('No Codex models are available.')).toBeVisible()
  })
})

test.describe('AI tab metadata command bar actions', () => {
  test.skip(isRealCodexRun, 'Mocked command coverage is skipped during the focused real Codex run.')

  test('generates a terminal title and note from the Command bar', async ({ appHarness, mainWindow }) => {
    await setAiMock(mainWindow)
    await configureAiTabMetadata(mainWindow)

    await appHarness.openMacroLauncher(mainWindow)
    await runCommandBarItem(mainWindow, 'Set tab title with AI')
    await expect(mainWindow.locator('.project-workspace--active .terminal-tab-title').first()).toHaveText('Build Warnings')

    await appHarness.openMacroLauncher(mainWindow)
    await runCommandBarItem(mainWindow, 'Set tab note with AI')
    await expect(mainWindow.getByRole('textbox', { name: 'Terminal note' })).toHaveValue(
      'Reviewing package warnings from the latest build.',
    )
  })

  test('leaves metadata unchanged when disabled or when the provider fails', async ({ appHarness, mainWindow }) => {
    const title = mainWindow.locator('.project-workspace--active .terminal-tab-title').first()
    await expect(title).toHaveText('Terminal 1')

    await appHarness.openMacroLauncher(mainWindow)
    await runCommandBarItem(mainWindow, 'Set tab title with AI')
    await expect(mainWindow.locator('.error-banner')).toContainText('Enable Codex')
    await expect(title).toHaveText('Terminal 1')

    await configureAiTabMetadata(mainWindow)
    await setAiMock(mainWindow, { error: 'Codex test failure' })
    await appHarness.openMacroLauncher(mainWindow)
    await runCommandBarItem(mainWindow, 'Set tab title with AI')
    await expect(mainWindow.locator('.error-banner')).toContainText('Codex test failure')
    await expect(title).toHaveText('Terminal 1')
  })
})

test.describe('AI tab metadata real Codex integration', () => {
  test.skip(!isRealCodexRun, 'Real Codex integration is opt-in for CI and local provider smoke tests.')

  test('generates a terminal title and note with Codex @real-codex', async ({ appHarness, mainWindow }) => {
    const model = await firstCodexModel(mainWindow)
    await configureAiTabMetadata(mainWindow, model)
    await writeToActiveTerminal(
      mainWindow,
      "printf 'build completed successfully\\nunit tests passed\\ncoverage report generated\\n'\r",
    )
    await expect(mainWindow.locator('.xterm-rows')).toContainText('coverage report generated')

    await appHarness.openMacroLauncher(mainWindow)
    await runCommandBarItem(mainWindow, 'Set tab title with AI')

    const title = mainWindow.locator('.project-workspace--active .terminal-tab-title').first()
    await expect
      .poll(async () => ((await title.textContent()) ?? '').trim(), { timeout: 120_000 })
      .toMatch(/^(?!Terminal 1$)(?!Generating\.\.\.$)\S/)
    expect(((await title.textContent()) ?? '').trim().length).toBeLessThanOrEqual(64)

    await appHarness.openMacroLauncher(mainWindow)
    await runCommandBarItem(mainWindow, 'Set tab note with AI')

    const note = mainWindow.getByRole('textbox', { name: 'Terminal note' })
    await expect
      .poll(async () => ((await note.inputValue()) ?? '').trim(), { timeout: 120_000 })
      .toMatch(/\S/)
    expect(((await note.inputValue()) ?? '').trim().length).toBeLessThanOrEqual(1200)
  })
})
