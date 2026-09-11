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

test('shows selected-server extensions and installs an uploaded extension', async ({ appHarness, mainWindow }) => {
  const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'extensions' })

  await expect(settingsWindow.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(settingsWindow.getByRole('button', { name: 'Extensions' })).toHaveAttribute('aria-current', 'true')
  await expect(settingsWindow.locator('#section-extensions')).toBeVisible()
  await expect(settingsWindow.getByText('Third-party extensions are trusted code')).toBeVisible()
  await expect(settingsWindow.getByRole('button', { name: 'Reset to defaults' })).toHaveCount(0)
  await expect(settingsWindow.getByRole('article').filter({ hasText: 'terminay-agent-codex' })).toBeVisible()
  await expect(settingsWindow.getByRole('article').filter({ hasText: 'terminay-agent-claude-code' })).toBeVisible()

  const packageJson = JSON.stringify({ name: 'terminay-e2e-uploaded-extension', version: '1.0.0', type: 'module', exports: { '.': './dist/extension.js' }, terminay: { manifestVersion: 1, id: 'dev.terminay.e2e-uploaded', displayName: 'E2E uploaded agent', api: '>=1', engines: { terminay: '>=1', node: '>=22' }, entrypoint: 'dist/extension.js', permissions: ['agent-observation'], contributes: { agentProviders: [{ id: 'dev.terminay.e2e-uploaded/cli', displayName: 'E2E uploaded', description: 'Fixture agent provider used by the settings E2E.', icon: 'terminal', processMatchers: [{ executableName: 'terminay-e2e-uploaded' }], mappings: [{ mappingVersion: '0.1', providerVersionRange: '>=0' }] }] } } })
  const archive = npmPackArchive({ 'package/package.json': packageJson, 'package/dist/extension.js': 'export async function activate() {}\n' })
  await settingsWindow.locator('input[type="file"][accept*=".tgz"]').setInputFiles({ name: 'terminay-e2e-uploaded-extension-1.0.0.tgz', mimeType: 'application/gzip', buffer: archive })
  await expect(settingsWindow.getByRole('heading', { name: /Review terminay-e2e-uploaded-extension@1\.0\.0/u })).toBeVisible()
  await expect(settingsWindow.getByText(/Uploaded package.*Unverified/u)).toBeVisible()
  await settingsWindow.getByRole('button', { name: /Install on/u }).click()
  await expect(settingsWindow.getByRole('article').filter({ hasText: 'terminay-e2e-uploaded-extension' })).toContainText('1.0.0', { timeout: 30_000 })
  await expect(settingsWindow.getByRole('heading', { name: /Review terminay-e2e-uploaded-extension/u })).toHaveCount(0)
  await expect(settingsWindow.getByRole('status').filter({ hasText: /was installed/u })).toBeVisible()
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
