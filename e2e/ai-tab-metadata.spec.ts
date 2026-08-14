import type { Page } from '@playwright/test'
import { normalizeTerminalSettings } from '../src/terminalSettings'
import type { AiTabMetadataProvider } from '../src/types/terminay'
import { expect, test } from './fixtures'
import { typeInVisibleTerminal } from './support/terminal-input'

const isRealCodexRun = process.env.TERMINAY_TEST_USE_REAL_CODEX === '1'
const isRealClaudeCodeRun = process.env.TERMINAY_TEST_USE_REAL_CLAUDE_CODE === '1'
const isRealProviderRun = isRealCodexRun || isRealClaudeCodeRun

function aiMetadataRows(page: Page) {
  return page.locator('#section-ai-tab-metadata .settings-row')
}

function aiMetadataSelect(page: Page, label: string) {
  return aiMetadataRows(page).filter({ hasText: label }).locator('select')
}

async function writeToActiveTerminal(page: Page, data: string): Promise<void> {
  await typeInVisibleTerminal(page, data)
}

async function firstAiProviderModel(
  appHarness: { openSettingsWindow: (options: { page: Page; sectionId: string }) => Promise<Page> },
  page: Page,
  provider: AiTabMetadataProvider,
): Promise<string> {
  const settingsWindow = await appHarness.openSettingsWindow({ page, sectionId: 'ai-tab-metadata' })
  await aiMetadataSelect(settingsWindow, 'Set title with AI').selectOption(provider)
  const model = await aiMetadataSelect(settingsWindow, 'Title model').inputValue()
  if (!model) {
    throw new Error(`No ${provider} model is available for AI tab metadata tests.`)
  }
  await settingsWindow.close()
  return model
}

async function configureAiTabMetadata(
  appHarness: { openSettingsWindow: (options: { page: Page; sectionId: string }) => Promise<Page> },
  page: Page,
  provider: 'claudeCode' | 'codex' = 'codex',
  model = 'codex-test-model',
) {
  const settings = await appHarness.openSettingsWindow({ page, sectionId: 'ai-tab-metadata' })
  await aiMetadataSelect(settings, 'Set title with AI').selectOption(provider)
  await aiMetadataSelect(settings, 'Title model').selectOption(model)
  await aiMetadataSelect(settings, 'Set note with AI').selectOption(provider)
  await aiMetadataSelect(settings, 'Note model').selectOption(model)
  await expect(settings.locator('.settings-status')).toContainText('Saved')
  await settings.close()
}

async function setAiMock(page: Page, options?: {
	error?: string | null
	models?: readonly Readonly<{ id: string; label: string }>[]
}) {
  if (isRealProviderRun) {
    return
  }

  await page.evaluate(async (nextOptions) => {
		if (!window.terminayAiMetadataTest) {
			throw new Error('AI metadata test seam is unavailable')
		}

		await window.terminayAiMetadataTest.setMock({
			error: nextOptions?.error ?? null,
			models: nextOptions?.models ?? [
        { id: 'codex-test-model', label: 'Codex Test Model' },
        { id: 'codex-alt-model', label: 'Codex Alt Model' },
        { id: 'claude-test-model', label: 'Claude Test Model' },
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
  test.skip(isRealProviderRun, 'Mocked settings coverage is skipped during focused real provider runs.')

  test('normalizes defaults and invalid AI tab metadata settings', () => {
    expect(normalizeTerminalSettings({}).aiTabMetadata).toEqual({
      title: { provider: 'disabled', claudeCodeModel: '', codexModel: '' },
      note: { provider: 'disabled', claudeCodeModel: '', codexModel: '' },
    })

    expect(
      normalizeTerminalSettings({
        aiTabMetadata: {
          title: { provider: 'nonsense', codexModel: '  keep-title-model  ' },
          note: {
            provider: 'claudeCode',
            claudeCodeModel: '  keep-claude-model  ',
            codexModel: '  keep-note-model  ',
          },
        },
      }).aiTabMetadata,
    ).toEqual({
      title: { provider: 'disabled', claudeCodeModel: '', codexModel: 'keep-title-model' },
      note: { provider: 'claudeCode', claudeCodeModel: 'keep-claude-model', codexModel: 'keep-note-model' },
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

    await aiMetadataSelect(settingsWindow, 'Set note with AI').selectOption('claudeCode')
    await expect(aiMetadataRows(settingsWindow).filter({ hasText: 'Note model' })).toBeVisible()
    await expect(aiMetadataSelect(settingsWindow, 'Note model')).toHaveValue('codex-test-model')
  })

	test('keeps provider selected when model loading fails', async ({ appHarness, mainWindow }) => {
		await setAiMock(mainWindow, { models: [] })
    const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'ai-tab-metadata' })

    await aiMetadataSelect(settingsWindow, 'Set note with AI').selectOption('codex')
    await expect(aiMetadataSelect(settingsWindow, 'Set note with AI')).toHaveValue('codex')
    await expect(settingsWindow.getByText('No Codex models are available.')).toBeVisible()
  })
})

test.describe('AI tab metadata command bar actions', () => {
  test.skip(isRealProviderRun, 'Mocked command coverage is skipped during focused real provider runs.')

  test('generates a terminal title and note from the Command bar', async ({ appHarness, mainWindow }) => {
    await setAiMock(mainWindow)
    await configureAiTabMetadata(appHarness, mainWindow)

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
    await expect(mainWindow.locator('.error-banner')).toContainText('Enable an AI provider')
    await expect(title).toHaveText('Terminal 1')

    await configureAiTabMetadata(appHarness, mainWindow)
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
    const model = await firstAiProviderModel(appHarness, mainWindow, 'codex')
    await configureAiTabMetadata(appHarness, mainWindow, 'codex', model)
    await runRealProviderGenerationAssertions(appHarness, mainWindow)
  })
})

test.describe('AI tab metadata real Claude Code integration', () => {
  test.skip(!isRealClaudeCodeRun, 'Real Claude Code integration is opt-in for CI and local provider smoke tests.')

  test('generates a terminal title and note with Claude Code @real-claude-code', async ({ appHarness, mainWindow }) => {
    const model = await firstAiProviderModel(appHarness, mainWindow, 'claudeCode')
    await configureAiTabMetadata(appHarness, mainWindow, 'claudeCode', model)
    await runRealProviderGenerationAssertions(appHarness, mainWindow)
  })
})

async function runRealProviderGenerationAssertions(
  appHarness: { openMacroLauncher: (page?: Page, options?: { attempts?: number }) => Promise<void> },
  mainWindow: Page,
) {
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
}
