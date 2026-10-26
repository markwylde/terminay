import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { openMacroLauncher, sendAppCommand } from './support/app'
import {
  closeFrontHomeTab,
  expectHomeSection,
  frontHomeTab,
  homeTabChip,
  homeTabChips,
} from './support/home-tabs'
import { contextMenuItem } from './support/ui'
import { TerminalRecordingService } from '../electron/recording/service'
import {
  defaultTerminalSettings,
  normalizeTerminalSettings,
  resolveTerminalTheme,
  TAB_THEME_HUE_COLOR_VALUE,
} from '../src/terminalSettings'
import type { TerminalSettings } from '../src/types/settings'

async function readTextEventually(filePath: string): Promise<string> {
  const deadline = Date.now() + 5_000
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const fileStats = await stat(filePath)
      if (fileStats.size > 0) {
        return await readFile(filePath, 'utf8')
      }
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${filePath}`)
}

async function findRecordingFiles(root: string, recordingId: string): Promise<{ cast: string; metadata: string }> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const base = path.join(root, entry.name, recordingId)
      try {
        await stat(`${base}.cast`)
        return { cast: `${base}.cast`, metadata: `${base}.json` }
      } catch {
        // Continue searching retained date directories.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Recording files not found for ${recordingId}`)
}

test.describe('recording settings and service', () => {
  test('normalizes recording defaults and resolves tab hue theme colours', () => {
    const normalized = normalizeTerminalSettings({
      recording: {
        captureInput: 'yes',
        directory: '  ',
        openTimelineAfterSaving: 'no',
        recordNewTerminals: 'no',
        sensitiveInputPolicy: 'show',
      },
      theme: {
        cursor: '#6ac1ff',
        selectionBackground: '#32536b80',
        selectionForeground: '#f8fbff',
      },
    })

    expect(normalized.recording).toEqual(defaultTerminalSettings.recording)
    expect(normalized.theme.cursor).toBe(TAB_THEME_HUE_COLOR_VALUE)
    expect(normalized.theme.selectionBackground).toBe(TAB_THEME_HUE_COLOR_VALUE)
    expect(normalized.theme.selectionForeground).toBe('#000000')
    expect(resolveTerminalTheme(normalized, '#22cc88').cursor).toBe('#22cc88')
    expect(resolveTerminalTheme(normalized).cursor).toBe('#6ac1ff')

    expect(
      normalizeTerminalSettings({
        recording: {
          captureInput: false,
          directory: '~/CustomSessions',
          openTimelineAfterSaving: true,
          recordNewTerminals: true,
          sensitiveInputPolicy: 'mask',
        },
      }).recording,
    ).toEqual({
      captureInput: false,
      directory: '~/CustomSessions',
      openTimelineAfterSaving: true,
      recordNewTerminals: true,
      sensitiveInputPolicy: 'mask',
    })
  })

  test('writes asciicast metadata, masks sensitive input, lists, reads, and deletes recordings', async ({ tempDir }) => {
    const recordingDir = path.join(tempDir, 'recordings')
    const settings: TerminalSettings = {
      ...defaultTerminalSettings,
      recording: {
        ...defaultTerminalSettings.recording,
        captureInput: true,
        directory: recordingDir,
        sensitiveInputPolicy: 'mask',
      },
    }
    const changedStates: string[] = []
    const service = new TerminalRecordingService({
      getHomePath: () => tempDir,
      getSettings: () => settings,
      onStateChanged: (state) => changedStates.push(state.status),
    })

    const started = service.start('session-one', {
      color: '#22cc88',
      cols: 88,
      cwd: tempDir,
      projectColor: '#4477ff',
      projectTitle: 'Project One',
      rows: 26,
      shell: '/bin/zsh',
      title: 'Deploy Shell',
    })

    expect(started.status).toBe('recording')
    expect(started).not.toHaveProperty('castPath')
    expect(started).not.toHaveProperty('metadataPath')

    service.appendOutput('session-one', 'Password: ')
    service.appendInput('session-one', 'secret\n')
    service.appendOutput('session-one', 'done\n')
    service.appendResize('session-one', 100, 30)
    const stopped = service.finalize('session-one', 0)

    expect(stopped.status).toBe('idle')
    expect(changedStates).toContain('recording')
    expect(changedStates).toContain('idle')

    const files = await findRecordingFiles(recordingDir, started.recordingId ?? '')
    const castText = await readTextEventually(files.cast)
    const metadataText = await readTextEventually(files.metadata)
    const header = JSON.parse(castText.split(/\r?\n/, 1)[0] ?? '{}') as { title?: string; term?: { cols?: number; rows?: number } }
    const metadata = JSON.parse(metadataText) as { recordingState?: string; title?: string; eventCount?: number; theme?: { cursor?: string } }

    expect(header.title).toBe('Project One > Deploy Shell')
    expect(header.term).toMatchObject({ cols: 88, rows: 26 })
    expect(castText).not.toContain('secret')
    expect(castText).toContain('******\\n')
    expect(castText).toContain('"r","100x30"')
    expect(castText).toContain('"x","0"')
    expect(metadata).toMatchObject({
      recordingState: 'completed',
      title: 'Deploy Shell',
    })
    expect(metadata.eventCount).toBeGreaterThanOrEqual(4)
    expect(metadata.theme?.cursor).toBe('#22cc88')

    const recordings = await service.listRecordings()
    expect(recordings).toHaveLength(1)
    expect(recordings[0]).toMatchObject({
      projectTitle: 'Project One',
      recordingState: 'completed',
      title: 'Deploy Shell',
    })

    let loadedContent = ''
    let chunkStart = 0
    for (;;) {
      const chunk = await service.readRecordingChunk({
        recordingId: recordings[0].recordingId,
        start: chunkStart,
      })
      loadedContent += chunk.content
      chunkStart = chunk.nextOffset
      if (chunk.eof) {
        break
      }
    }
    expect(loadedContent).toBe(castText)
    await expect(service.readRecordingChunk({ recordingId: '../outside' })).rejects.toThrow(/invalid/)

    await service.deleteRecordingById(recordings[0].recordingId)
    await expect(service.listRecordings()).resolves.toEqual([])
  })

  test('drops sensitive typed text while preserving submit keys when configured', async ({ tempDir }) => {
    const recordingDir = path.join(tempDir, 'drop-recordings')
    const settings: TerminalSettings = {
      ...defaultTerminalSettings,
      recording: {
        ...defaultTerminalSettings.recording,
        captureInput: true,
        directory: recordingDir,
        sensitiveInputPolicy: 'drop',
      },
    }
    const service = new TerminalRecordingService({
      getHomePath: () => tempDir,
      getSettings: () => settings,
    })

    const started = service.start('session-two', { title: 'Secrets Shell' })
    service.appendOutput('session-two', 'token: ')
    service.appendInput('session-two', 'abc123\r')
    service.finalize('session-two')

    const files = await findRecordingFiles(recordingDir, started.recordingId ?? '')
    const castText = await readTextEventually(files.cast)
    expect(castText).not.toContain('abc123')
    expect(castText).toContain('"i","\\r"')
  })
})

/**
 * Records one terminal session that prints `marker`, into a directory of the
 * test's own, and leaves the project in front.
 */
async function recordTerminalOutput(
  appHarness: { openSettingsWindow: (options: { page: Page; sectionId: string }) => Promise<Page> },
  page: Page,
  recordingDir: string,
  marker: string,
): Promise<void> {
  await mkdir(recordingDir, { recursive: true })
  const settings = await appHarness.openSettingsWindow({ page, sectionId: 'recording-defaults' })
  await settings.locator('#section-recording-defaults .settings-row').filter({ hasText: 'Recording directory' }).locator('input').fill(recordingDir)
  await settings.getByLabel('Open timeline after saving').uncheck()
  await expect(settings.locator('.settings-status')).toContainText('Saved')
  await settings.close()

  const terminalTab = page.locator('.project-workspace--active .terminal-tab-content').first()
  await terminalTab.click({ button: 'right' })
  await contextMenuItem(page, 'Start Recording').click()
  await expect(terminalTab.getByRole('img', { name: 'Recording terminal session' })).toBeVisible()
  await page.locator('.project-workspace--active .xterm').first().click()
  const [first, rest] = [marker.slice(0, 3), marker.slice(3)]
  // Typed in two halves so the echoed command line never matches the marker.
  await page.keyboard.type(`printf '${first}%s\\n' ${rest}`)
  await page.keyboard.press('Enter')
  await expect(page.locator('.project-workspace--active .terminal-panel:visible .xterm-rows')).toContainText(marker)
  await terminalTab.click({ button: 'right' })
  await contextMenuItem(page, 'Stop Recording').click()
  await expect(terminalTab.getByRole('img', { name: 'Recording terminal session' })).toHaveCount(0)
}

const recordingsTab = (page: Page) =>
  page.locator('[data-terminay-home-tab-panel="section:recordings"]')
const timelineItems = (page: Page) =>
  recordingsTab(page).locator('.recordings-list-item')

/** The timeline, once it lists at least one recording. */
async function expectListedRecording(page: Page): Promise<void> {
  await expect(async () => {
    await recordingsTab(page).getByRole('button', { name: 'Refresh recordings' }).click()
    await expect(timelineItems(page).first()).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 10_000 })
}

test.describe('recordings in Home', () => {
  test('the Recordings command selects Home and brings the timeline to the front', async ({
    appHarness,
    mainWindow,
    tempDir,
  }) => {
    await recordTerminalOutput(appHarness, mainWindow, path.join(tempDir, 'open-recordings'), 'rec-open-output')
    await expect(mainWindow.locator('.app-shell')).not.toHaveAttribute('data-terminay-selected-view', 'home')

    // Through the Command Bar.
    await openMacroLauncher(mainWindow)
    await mainWindow.getByLabel('Search commands').fill('recordings')
    await mainWindow.locator('[data-terminay-command-bar-item="open-recordings"]').click()
    await expect(mainWindow.locator('.app-shell')).toHaveAttribute('data-terminay-selected-view', 'home')
    await expectHomeSection(mainWindow, 'recordings')
    await expect(frontHomeTab(mainWindow)).toHaveAttribute('data-terminay-home-section', 'recordings')
    await expect(recordingsTab(mainWindow).getByRole('heading', { name: 'Recordings' })).toBeVisible()
    await expect(recordingsTab(mainWindow).getByPlaceholder('Search recordings')).toBeVisible()
    await expectListedRecording(mainWindow)
    await expect(homeTabChip(mainWindow, 'section:recordings')).toHaveCount(1)

    // Through the menu command, from a project: the open tab comes to the front.
    await mainWindow.locator('.project-tab').first().click()
    await expect(mainWindow.locator('.app-shell')).not.toHaveAttribute('data-terminay-selected-view', 'home')
    // The Command Bar closed when it sent the person to Home.
    await expect(mainWindow.getByRole('dialog', { name: 'Command bar' })).toHaveCount(0)
    await sendAppCommand(mainWindow, 'open-recordings')
    await expectHomeSection(mainWindow, 'recordings')
    await expect(homeTabChip(mainWindow, 'section:recordings')).toHaveCount(1)

    // Through its configurable shortcut.
    const isMac = await mainWindow.evaluate(() => navigator.userAgent.includes('Mac'))
    const shortcuts = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'keyboard-shortcuts' })
    const row = shortcuts.locator('.settings-row').filter({ hasText: 'Open recordings timeline' })
    await row.getByRole('button', { name: 'Listen' }).click()
    await shortcuts.keyboard.press(isMac ? 'Meta+Shift+Y' : 'Control+Shift+Y')
    await expect(row.locator('input')).toHaveValue('CmdOrCtrl+Shift+Y')
    await expect(shortcuts.getByText('Saved', { exact: true })).toBeVisible()
    await shortcuts.close()
    await closeFrontHomeTab(mainWindow)
    await expect(homeTabChip(mainWindow, 'section:recordings')).toHaveCount(0)
    await mainWindow.locator('.project-tab').first().click()
    await mainWindow.locator('.project-workspace--active .terminal-panel').first().click()
    await mainWindow.keyboard.press(isMac ? 'Meta+Shift+Y' : 'Control+Shift+Y')
    await expectHomeSection(mainWindow, 'recordings')
    await expect(timelineItems(mainWindow).first()).toBeVisible()
  })

  test('a replay opens as its own Home tab, once, and closing it deletes nothing', async ({
    appHarness,
    mainWindow,
    tempDir,
  }) => {
    await recordTerminalOutput(appHarness, mainWindow, path.join(tempDir, 'replay-recordings'), 'replay-visible-output')
    await sendAppCommand(mainWindow, 'open-recordings')
    await expectHomeSection(mainWindow, 'recordings')
    await expectListedRecording(mainWindow)
    const chipsBefore = await homeTabChips(mainWindow).count()

    // Replaying from the timeline: a new tab in front, titled for the
    // recording, with the timeline still open behind it.
    await recordingsTab(mainWindow).getByPlaceholder('Search recordings').fill('Terminal')
    await timelineItems(mainWindow).first().click()
    const replayChip = homeTabChip(mainWindow, 'recording:')
    await expect(replayChip).toHaveCount(1)
    await expect(replayChip).not.toHaveAttribute('title', 'Recording')
    await expect(homeTabChips(mainWindow)).toHaveCount(chipsBefore + 1)
    await expect(homeTabChip(mainWindow, 'section:recordings')).toHaveCount(1)
    const replay = frontHomeTab(mainWindow)
    await expect(replay).toHaveAttribute('data-terminay-home-tab-panel', /^recording:/)
    // Replay belongs to Recordings: the sidebar keeps Recordings current.
    await expectHomeSection(mainWindow, 'recordings')
    await expect(mainWindow.locator('[data-terminay-home-section-tab="recordings"]')).toHaveAttribute('aria-selected', 'true')

    // The replay player, as it was in its own window.
    await expect(replay.getByRole('button', { name: 'Play replay' })).toBeEnabled()
    await expect(replay.getByLabel('Replay zoom')).toHaveValue('Fit')
    await replay.getByLabel('Zoom presets').click()
    await mainWindow.getByRole('option', { name: '125%' }).click()
    await expect(replay.getByLabel('Replay zoom')).toHaveValue('125%')
    await replay.getByLabel('Replay zoom').fill('6%')
    await replay.getByLabel('Replay zoom').press('Enter')
    await expect(replay.getByLabel('Replay zoom')).toHaveValue('6%')
    await replay.getByLabel('Replay zoom').fill('Fit')
    await replay.getByLabel('Replay zoom').press('Enter')
    await replay.getByLabel('Replay palette').click()
    await mainWindow.getByRole('option', { name: 'Current' }).click()
    await expect(replay.getByLabel('Replay palette')).toContainText('Current')
    await replay.getByLabel('Playback speed').click()
    await mainWindow.getByRole('option', { name: '2x' }).click()
    await expect(replay.getByLabel('Playback speed')).toContainText('2x')
    await expect(replay.locator('.recordings-terminal .xterm-screen')).toBeVisible()
    await replay.getByRole('button', { name: 'Play replay' }).click()
    await expect(replay.locator('.recordings-terminal .xterm-rows')).toContainText('replay-visible-output', {
      timeout: 15_000,
    })
    const stage = await replay.locator('.recordings-terminal-stage').boundingBox()
    expect(stage?.width ?? 0).toBeGreaterThan(200)
    expect(stage?.height ?? 0).toBeGreaterThan(100)

    // Replaying the same recording twice brings the one tab back.
    await homeTabChip(mainWindow, 'section:recordings').click()
    await expect(frontHomeTab(mainWindow)).toHaveAttribute('data-terminay-home-tab-panel', 'section:recordings')
    await timelineItems(mainWindow).first().click()
    await expect(frontHomeTab(mainWindow)).toHaveAttribute('data-terminay-home-tab-panel', /^recording:/)
    await expect(replayChip).toHaveCount(1)

    // Closing a replay leaves the recording in the timeline.
    await closeFrontHomeTab(mainWindow)
    await expect(replayChip).toHaveCount(0)
    await expect(frontHomeTab(mainWindow)).toHaveAttribute('data-terminay-home-tab-panel', 'section:recordings')
    await recordingsTab(mainWindow).getByRole('button', { name: 'Refresh recordings' }).click()
    await expect(timelineItems(mainWindow).first()).toBeVisible()
  })
})
