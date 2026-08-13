import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { defaultTerminalSettings, normalizeTerminalSettings } from '../src/terminalSettings'
import { gzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

function remoteOriginInput(page: Page) {
  return page.locator('#section-remote-access-host .settings-row').filter({ hasText: 'Remote origin' }).locator('input')
}

function bindAddressInput(page: Page) {
  return page.locator('#section-remote-access-host .settings-row').filter({ hasText: 'Bind address' }).locator('input')
}

function customExtensionRows(page: Page) {
  return page.locator('#section-file-viewer-refresh .settings-custom-extensions__item')
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
  await page.evaluate(async ({ nextData, nextSessionId }) => {
    await window.terminayTest!.writeServerTerminal(nextSessionId, nextData)
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

test('shows selected-server extensions and saves a secret-backed connection profile', async ({ appHarness, mainWindow, userDataDir }, testInfo) => {
  const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'extensions' })

  await expect(settingsWindow.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(settingsWindow.getByRole('button', { name: 'Extensions' })).toHaveAttribute('aria-current', 'true')
  await expect(settingsWindow.locator('#section-extensions')).toBeVisible()
  await expect(settingsWindow.getByText('Third-party extensions are trusted code')).toBeVisible()
  await expect(settingsWindow.getByRole('button', { name: 'Reset to defaults' })).toHaveCount(0)
  await expect(settingsWindow.getByRole('article').filter({ hasText: 'terminay-plugin-ssh' })).toBeVisible()
  await expect(settingsWindow.getByRole('article').filter({ hasText: 'terminay-plugin-puzed' })).toBeVisible()

  const profileForm = { id: 'fixture-profile', title: 'Fixture connection', description: 'Stored by the selected Terminay Server.', submitLabel: 'Save', sections: [{ id: 'connection', title: 'Connection', fields: [{ id: 'display-name', type: 'text', label: 'Name', description: 'Shown in the project environment chooser.', required: true }, { id: 'api-key', type: 'secret', label: 'API key', description: 'Stored in the selected Terminay Server vault.', required: true }] }, { id: 'advanced', title: 'Advanced', description: 'Optional connection behavior.', disclosure: 'collapsed', fields: [{ id: 'default-root', type: 'text', label: 'Default root' }] }] }
  const packageJson = JSON.stringify({ name: 'terminay-e2e-uploaded-extension', version: '1.0.0', type: 'module', exports: { '.': './dist/extension.js' }, terminay: { manifestVersion: 1, id: 'dev.terminay.e2e-uploaded', displayName: 'E2E uploaded provider', api: '^1.0.0', engines: { terminay: '>=1', node: '>=22' }, entrypoint: 'dist/extension.js', permissions: [], contributes: { projectEnvironments: [{ id: 'dev.terminay.e2e-uploaded/main', displayName: 'E2E uploaded', capabilities: ['terminal', 'filesystem'] }] } } })
  const archive = npmPackArchive({ 'package/package.json': packageJson, 'package/dist/extension.js': `export async function activate(context) { context.registerProjectEnvironmentProvider({ definition: { providerId: "dev.terminay.e2e-uploaded/main", displayName: "E2E uploaded", capabilities: ["terminal", "filesystem"], profileForm: ${JSON.stringify(profileForm)} }, runtime: { testProfile: async () => [], resolveOptions: async () => ({ options: [] }), createEnvironment: async () => ({ state: "ready", providerState: {}, status: { state: "available", revision: 1 } }), resumeOperation: async () => ({ state: "ready", providerState: {}, status: { state: "available", revision: 1 } }), getStatus: async () => ({ state: "available", revision: 1 }), invokeAction: async () => ({ state: "complete", providerState: {}, status: { state: "available", revision: 1 } }) } }); }\n` })
  await settingsWindow.locator('input[type="file"][accept*=".tgz"]').setInputFiles({ name: 'terminay-e2e-uploaded-extension-1.0.0.tgz', mimeType: 'application/gzip', buffer: archive })
  await expect(settingsWindow.getByRole('heading', { name: /Review terminay-e2e-uploaded-extension@1\.0\.0/u })).toBeVisible()
  await expect(settingsWindow.getByText(/Uploaded package.*Unverified/u)).toBeVisible()
  await settingsWindow.getByRole('button', { name: /Install on/u }).click()
  await expect(settingsWindow.getByRole('article').filter({ hasText: 'terminay-e2e-uploaded-extension' })).toContainText('1.0.0', { timeout: 30_000 })
  await expect(settingsWindow.getByRole('heading', { name: /Review terminay-e2e-uploaded-extension/u })).toHaveCount(0)
  await expect(settingsWindow.getByRole('status').filter({ hasText: /was installed/u })).toBeVisible()
  const environmentsWindow = await appHarness.openChildWindow(async () => { await mainWindow.evaluate(async () => { await window.terminayProjectEnvironmentsHost?.open() }) })
  await environmentsWindow.getByText('Add connection', { exact: true }).click()
  await environmentsWindow.getByRole('button', { name: 'New E2E uploaded' }).click()
  await expect(environmentsWindow.getByRole('heading', { name: 'Fixture connection' })).toBeVisible()
  await expect(environmentsWindow.getByRole('heading', { name: 'Project Environments' })).toBeVisible()
  await expect(environmentsWindow.getByPlaceholder('Search environments...')).toBeVisible()
  await expect(environmentsWindow.getByRole('button', { name: 'This server' })).toBeVisible()
  await expect(environmentsWindow.locator('.declarative-provider-form .settings-group')).toHaveCount(2)
  await expect(environmentsWindow.locator('.declarative-provider-form .settings-row').filter({ hasText: 'Name' })).toBeVisible()
  const advanced = environmentsWindow.locator('details').filter({ hasText: 'Advanced' })
  await expect(advanced).not.toHaveAttribute('open', '')
  await expect(advanced.locator('summary')).toBeVisible()
  await expect(environmentsWindow.locator('.declarative-provider-form__fields')).toHaveCount(0)
  const secretSentinel = 'terminay-e2e-secret-profile-sentinel'
  await environmentsWindow.getByLabel('Name').fill('Secret-backed E2E connection')
  await environmentsWindow.getByLabel('API key').fill(secretSentinel)
  await environmentsWindow.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(environmentsWindow.getByRole('button', { name: 'Secret-backed E2E connection' })).toBeVisible()
  await expect(environmentsWindow.getByRole('status').filter({ hasText: 'Connection saved.' })).toBeVisible()

  const persistedVault = await readFile(path.join(userDataDir, 'vault', 'safe-storage.v1.json'), 'utf8')
  expect(persistedVault).not.toContain(secretSentinel)
  await testInfo.attach('declarative-provider-form', { body: await environmentsWindow.screenshot(), contentType: 'image/png' })
})

function npmPackArchive(files: Readonly<Record<string, string>>): Buffer {
  const blocks: Buffer[] = []
  for (const [path, contents] of Object.entries(files)) {
    const body = Buffer.from(contents); const header = Buffer.alloc(512); header.write(path, 0, 100, 'utf8'); writeOctal(header, 100, 8, 0o644); writeOctal(header, 108, 8, 0); writeOctal(header, 116, 8, 0); writeOctal(header, 124, 12, body.length); writeOctal(header, 136, 12, 0); header.fill(0x20, 148, 156); header[156] = 0x30; header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii'); writeOctal(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0)); blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(blocks))
}

function writeOctal(target: Buffer, offset: number, length: number, value: number): void { const text = value.toString(8).padStart(length - 2, '0'); target.write(`${text}\0 `, offset, length, 'ascii') }

test('opens Project Environments as a full auxiliary window', async ({ appHarness, mainWindow }) => {
  const environmentsWindow = await appHarness.openChildWindow(async () => {
    await mainWindow.evaluate(async () => {
      await window.terminayProjectEnvironmentsHost?.open()
    })
  })

  await expect(environmentsWindow.getByRole('heading', { name: 'Project Environments' })).toBeVisible()
  await expect(environmentsWindow.locator('.project-environments-window')).toBeVisible()
  await expect(environmentsWindow.locator('[role="dialog"]')).toHaveCount(0)
  await expect(environmentsWindow.locator('.project-environment-surface-backdrop')).toHaveCount(0)
  expect(new URL(environmentsWindow.url()).searchParams.get('view')).toBe('project-environments')
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
    return (await window.terminayTerminalSettingsCompatibilityHost.getTerminalSettings()).recording
  })

  expect(savedRecordingSettings).toMatchObject({
    captureInput: true,
    directory: recordingDir,
    openTimelineAfterSaving: true,
    recordNewTerminals: true,
    sensitiveInputPolicy: 'mask',
  })
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

  const savedFileViewerSettings = await mainWindow.evaluate(async () => {
    return (await window.terminayTerminalSettingsCompatibilityHost.getTerminalSettings()).fileViewer
  })

  expect(savedFileViewerSettings.customFileExtensions).toContainEqual({
    defaultMode: 'text',
    extension: '.e2eunknown',
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
