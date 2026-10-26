import { gzipSync } from 'node:zlib'
import type { Page } from '@playwright/test'
import { defaultTerminalSettings, normalizeTerminalSettings } from '../src/terminalSettings'
import { expect, test } from './fixtures'
import { typeInVisibleTerminal } from './support/terminal-input'

function customExtensionRows(page: Page) {
  return page.locator('#section-file-viewer-refresh .settings-custom-extensions__item')
}

async function writeToActiveTerminal(page: Page, data: string): Promise<void> {
  await typeInVisibleTerminal(page, data)
}

function navItem(page: Page, label: string) {
  return page.locator('.settings-nav-item').filter({ has: page.locator('.settings-nav-label', { hasText: new RegExp(`^${label}$`, 'u') }) })
}

function listItem(page: Page, label: string) {
  return page.locator('.settings-list-column .settings-list-item').filter({ has: page.locator('.settings-list-item-label', { hasText: label }) })
}

test('shows selected-server extensions and installs an uploaded extension', async ({ appHarness, mainWindow }) => {
  const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'extensions' })

  await expect(settingsWindow.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(navItem(settingsWindow, 'Extensions')).toHaveAttribute('aria-current', 'true')
  // Extensions is a collection: the Install item is selected first.
  await expect(listItem(settingsWindow, 'Install extension…')).toHaveAttribute('aria-current', 'true')
  await expect(settingsWindow.locator('.settings-detail-title')).toHaveText('Install extension')
  await expect(settingsWindow.getByText('Third-party extensions are trusted code')).toBeVisible()
  await expect(settingsWindow.getByRole('button', { name: 'Reset to defaults' })).toHaveCount(0)
  await expect(settingsWindow.locator('.settings-list-section-title')).toContainText(['Built-in'])
  await expect(listItem(settingsWindow, 'Built-in Agents')).toContainText('On')
  await expect(navItem(settingsWindow, 'Extensions').locator('.settings-nav-count')).toHaveText(/\d+/u)

  await listItem(settingsWindow, 'Built-in Agents').click()
  await expect(settingsWindow.locator('.settings-detail-title')).toHaveText('Built-in Agents')
  const agentsCard = settingsWindow.getByRole('article').filter({ hasText: 'terminay-builtin-agents' })
  await expect(agentsCard).toBeVisible()
  await expect(settingsWindow.getByRole('article')).toHaveCount(1)
  const harnessSwitches = agentsCard.locator('[data-harness-switch] input[type="checkbox"]')
  await expect(harnessSwitches).toHaveCount(4)
  for (const harness of ['Claude Code', 'Codex', 'Grok', 'oh-my-pi']) {
    await expect(agentsCard.getByLabel(`Report ${harness} sessions`)).toBeChecked()
  }
  // A harness switch is a persisted server setting: it survives reopening Settings.
  // A switch shows its new state once the server has committed it.
  await agentsCard.getByLabel('Report Grok sessions').click()
  await expect(agentsCard.getByLabel('Report Grok sessions')).not.toBeChecked()
  await settingsWindow.close()
  const reopenedSettings = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'extensions' })
  await listItem(reopenedSettings, 'Built-in Agents').click()
  const reopenedAgentsCard = reopenedSettings.getByRole('article').filter({ hasText: 'terminay-builtin-agents' })
  await expect(reopenedAgentsCard.getByLabel('Report Grok sessions')).not.toBeChecked()
  await expect(reopenedAgentsCard.getByLabel('Report Codex sessions')).toBeChecked()
  await reopenedAgentsCard.getByLabel('Report Grok sessions').click()
  await expect(reopenedAgentsCard.getByLabel('Report Grok sessions')).toBeChecked()

  await listItem(reopenedSettings, 'Install extension…').click()
  const packageJson = JSON.stringify({ name: 'terminay-e2e-uploaded-extension', version: '1.0.0', type: 'module', exports: { '.': './dist/extension.js' }, terminay: { manifestVersion: 1, id: 'dev.terminay.e2e-uploaded', displayName: 'E2E uploaded agent', api: '^3.0.0', engines: { terminay: '>=1', node: '>=22' }, entrypoint: 'dist/extension.js', permissions: ['agent-observation'], contributes: { agentSessionSources: [{ id: 'dev.terminay.e2e-uploaded/sessions', displayName: 'E2E uploaded', harnesses: [{ id: 'e2e-uploaded', displayName: 'E2E uploaded' }] }] } } })
  const archive = npmPackArchive({ 'package/package.json': packageJson, 'package/dist/extension.js': 'export async function activate() {}\n' })
  await reopenedSettings.locator('input[type="file"][accept*=".tgz"]').setInputFiles({ name: 'terminay-e2e-uploaded-extension-1.0.0.tgz', mimeType: 'application/gzip', buffer: archive })
  await expect(reopenedSettings.getByRole('heading', { name: /Review terminay-e2e-uploaded-extension@1\.0\.0/u })).toBeVisible()
  await expect(reopenedSettings.getByText(/Uploaded package.*Unverified/u)).toBeVisible()
  await reopenedSettings.getByRole('button', { name: /Install on/u }).click()
  await expect(reopenedSettings.getByRole('status').filter({ hasText: /was installed/u })).toBeVisible({ timeout: 30_000 })
  await expect(reopenedSettings.getByRole('heading', { name: /Review terminay-e2e-uploaded-extension/u })).toHaveCount(0)
  // A custom install is listed under Custom and opens to its own card.
  const uploaded = listItem(reopenedSettings, 'E2E uploaded agent')
  await expect(uploaded).toBeVisible({ timeout: 30_000 })
  await uploaded.click()
  await expect(reopenedSettings.getByRole('article').filter({ hasText: 'terminay-e2e-uploaded-extension' })).toContainText('1.0.0')
})

test('Group order: the sidebar groups categories, with counts for collections', async ({ appHarness, mainWindow }) => {
  const settings = await appHarness.openSettingsWindow({ page: mainWindow })
  const groups = settings.locator('.settings-nav-section-title')
  await expect(groups).toHaveText(['General', 'Terminal', 'Connections', 'Automation', 'Extensions', 'System'])
  const section = (label: string) => settings.locator('.settings-nav-section').filter({ has: settings.locator('.settings-nav-section-title', { hasText: label }) })
  await expect(section('Connections').locator('.settings-nav-label')).toHaveText(['Remote Access'])
  await expect(section('Automation').locator('.settings-nav-label')).toHaveText(['Macros', 'Recording'])
  await expect(navItem(settings, 'Macros').locator('.settings-nav-count')).toHaveText(/^3/u)
})

test('Opening Settings at a macro selects it', async ({ appHarness, mainWindow }) => {
  const settings = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'macros', itemId: 'say-hello' })
  await expect(navItem(settings, 'Macros')).toHaveAttribute('aria-current', 'true')
  await expect(settings.locator('.settings-detail-title')).toHaveText('Say hello to person')
  await expect(settings.getByLabel('Macro name')).toHaveValue('Say hello to person')
})

test('Narrow window and widening again: one column at a time, selection kept', async ({ appHarness, mainWindow }) => {
  const settings = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'macros' })
  const shell = settings.locator('.settings-shell')
  await settings.setViewportSize({ width: 1280, height: 820 })
  await expect(shell).toHaveAttribute('data-settings-layout', 'columns')
  await settings.locator('.settings-list-column').getByRole('button', { name: /Create a pull request/u }).click()
  await expect(settings.locator('.settings-detail-title')).toHaveText('Create a pull request')

  await settings.setViewportSize({ width: 760, height: 820 })
  await expect(shell).toHaveAttribute('data-settings-layout', 'narrow')
  await expect(shell).toHaveAttribute('data-settings-stage', 'detail')
  await expect(settings.locator('.settings-sidebar')).toBeHidden()
  await expect(settings.locator('.settings-list-column')).toBeHidden()
  const back = settings.locator('.settings-right-pane .settings-back-button')
  await expect(back).toHaveText(/Macros/u)
  await back.click()
  await expect(shell).toHaveAttribute('data-settings-stage', 'list')
  await expect(settings.locator('.settings-right-pane')).toBeHidden()
  const listBack = settings.locator('.settings-list-column > .settings-back-button')
  await expect(listBack).toHaveText(/Settings/u)
  await listBack.click()
  await expect(shell).toHaveAttribute('data-settings-stage', 'sidebar')
  await navItem(settings, 'Macros').click()
  await expect(shell).toHaveAttribute('data-settings-stage', 'list')
  await settings.locator('.settings-list-column').getByRole('button', { name: /Update OS/u }).click()
  await expect(shell).toHaveAttribute('data-settings-stage', 'detail')
  await expect(settings.locator('.settings-detail-title')).toHaveText('Update OS')

  await settings.setViewportSize({ width: 1280, height: 820 })
  await expect(shell).toHaveAttribute('data-settings-layout', 'columns')
  await expect(settings.locator('.settings-list-column')).toBeVisible()
  await expect(settings.locator('.settings-list-column').getByRole('button', { name: /Update OS/u })).toHaveAttribute('aria-current', 'true')
  await expect(settings.locator('.settings-detail-title')).toHaveText('Update OS')
})

test('Finding a macro by its script', async ({ appHarness, mainWindow }) => {
  const settings = await appHarness.openSettingsWindow({ page: mainWindow })
  await settings.getByLabel('Search Settings settings').fill('apt-get upgrade')
  const result = settings.locator('.settings-row--button').filter({ hasText: 'Update OS' })
  await expect(result).toContainText('Macros')
  await result.click()
  await expect(navItem(settings, 'Macros')).toHaveAttribute('aria-current', 'true')
  await expect(settings.getByLabel('Search Settings settings')).toHaveValue('')
  await expect(settings.locator('.settings-detail-title')).toHaveText('Update OS')
  await expect(settings.locator('.settings-list-column').getByRole('button', { name: /Update OS/u })).toHaveAttribute('aria-current', 'true')
})

function npmPackArchive(files: Readonly<Record<string, string>>): Buffer {
  const blocks: Buffer[] = []
  for (const [path, contents] of Object.entries(files)) {
    const body = Buffer.from(contents); const header = Buffer.alloc(512); header.write(path, 0, 100, 'utf8'); writeOctal(header, 100, 8, 0o644); writeOctal(header, 108, 8, 0); writeOctal(header, 116, 8, 0); writeOctal(header, 124, 12, body.length); writeOctal(header, 136, 12, 0); header.fill(0x20, 148, 156); header[156] = 0x30; header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii'); writeOctal(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0)); blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(blocks))
}

function writeOctal(target: Buffer, offset: number, length: number, value: number): void { const text = value.toString(8).padStart(length - 2, '0'); target.write(`${text}\0 `, offset, length, 'ascii') }

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

	await settingsWindow.close()
	const reopened = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'recording-defaults',
	})
	await expect(reopened.getByLabel('Record new terminals')).toBeChecked()
	await expect(
		reopened
			.locator('#section-recording-defaults .settings-row')
			.filter({ hasText: 'Recording directory' })
			.locator('input'),
	).toHaveValue(recordingDir)
	await expect(reopened.getByLabel('Capture input')).toBeChecked()
	await expect(
		reopened
			.locator('#section-recording-defaults .settings-row')
			.filter({ hasText: 'Sensitive input' })
			.locator('select'),
	).toHaveValue('mask')
	await expect(reopened.getByLabel('Open timeline after saving')).toBeChecked()
})

test('normalizes custom file viewer extension defaults', () => {
  expect(normalizeTerminalSettings({}).fileViewer).toEqual(defaultTerminalSettings.fileViewer)

  expect(
    normalizeTerminalSettings({
      fileViewer: {
        customFileExtensions: [
          { extension: '  demo ', defaultMode: 'text' },
          { extension: '.bin', defaultMode: 'hex' },
          { extension: '.demo', defaultMode: 'preview' },
          { extension: '.', defaultMode: 'hex' },
          { extension: '.bad', defaultMode: 'nonsense' },
        ],
        diffLayout: 'unified',
        refreshIntervalSeconds: 9,
      },
    }).fileViewer,
  ).toEqual({
    customFileExtensions: [
      { extension: '.demo', defaultMode: 'text' },
      { extension: '.bin', defaultMode: 'hex' },
      { extension: '.bad', defaultMode: 'preview' },
    ],
    diffLayout: 'unified',
    folderTaskIgnoredDirectories: defaultTerminalSettings.fileViewer.folderTaskIgnoredDirectories,
    refreshIntervalSeconds: 9,
  })
})

test('normalizes dictation settings defaults and bounds', () => {
  expect(normalizeTerminalSettings({}).dictation).toEqual(defaultTerminalSettings.dictation)

  expect(
    normalizeTerminalSettings({
      dictation: {
        enabled: false,
        language: ' en ',
        maxDurationSeconds: 999,
        microphoneDeviceId: ' hd-pro-webcam ',
        model: 'gpt-4o-mini-transcribe',
        prompt: 'Prefer terminal command names.',
        silenceStopSeconds: 0,
      },
    }).dictation,
  ).toEqual({
    enabled: false,
    language: 'en',
    maxDurationSeconds: 300,
    microphoneDeviceId: 'hd-pro-webcam',
    model: 'gpt-4o-mini-transcribe',
	provider: 'openai',
    prompt: 'Prefer terminal command names.',
    silenceStopSeconds: 1,
  })

  expect(
    normalizeTerminalSettings({
      dictation: {
        maxDurationSeconds: 2,
        model: 'invalid',
        silenceStopSeconds: 99,
      },
    }).dictation,
  ).toMatchObject({
    maxDurationSeconds: 5,
    model: defaultTerminalSettings.dictation.model,
    silenceStopSeconds: 15,
  })
})

test('saves custom file extension default tabs in settings', async ({ appHarness, mainWindow }) => {
  const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'file-viewer-refresh' })

  await expect(settingsWindow.getByRole('heading', { name: 'File Viewer' })).toBeVisible()
  await settingsWindow.getByRole('button', { name: 'Add Extension' }).click()

  const row = customExtensionRows(settingsWindow).first()
  await row.getByLabel('File extension').fill('.e2eunknown')
  await row.getByLabel('File extension').press('Enter')
  await row.getByLabel('Default file viewer tab').selectOption('text')
  await expect(settingsWindow.locator('.settings-status')).toContainText('Saved')

	await settingsWindow.close()
	const reopened = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'file-viewer-refresh',
	})
	const savedRow = customExtensionRows(reopened).filter({
		has: reopened.locator('input[value=".e2eunknown"]'),
	})
	await expect(savedRow).toHaveCount(1)
	await expect(savedRow.getByLabel('Default file viewer tab')).toHaveValue(
		'text',
	)
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
  const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'typography' })
  const dialogs = await appHarness.dialogs(settingsWindow)

  const fontSizeInput = settingsWindow
    .locator('#section-typography .settings-row')
    .filter({ hasText: 'Font size' })
    .locator('input[type="number"]')
  await fontSizeInput.fill(String(defaultTerminalSettings.fontSize + 1))
  await expect(settingsWindow.locator('.settings-status')).toContainText('Saved')

  await dialogs.queueConfirm(true)
  await settingsWindow.getByRole('button', { name: 'Reset to defaults' }).click()

  await expect(fontSizeInput).toHaveValue(String(defaultTerminalSettings.fontSize))
  await expect(settingsWindow.locator('.settings-status')).toContainText('Saved')
})
