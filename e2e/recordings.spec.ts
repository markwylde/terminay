import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from './fixtures'
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

test.describe('recordings UI', () => {
  test('starts and stops a terminal recording from the tab context menu and opens the timeline', async ({
    appHarness,
    mainWindow,
    tempDir,
  }) => {
    const recordingDir = path.join(tempDir, 'ui-recordings')
    const existingRecordingIds = new Set(
      await mainWindow.evaluate(() => window.terminay.listTerminalRecordings().then((items) => items.map((item) => item.recordingId))),
    )
    await mkdir(recordingDir, { recursive: true })
    await mainWindow.evaluate(async (nextRecordingDir) => {
      const settings = await window.terminay.getTerminalSettings()
      await window.terminay.updateTerminalSettings({
        ...settings,
        recording: {
          ...settings.recording,
          directory: nextRecordingDir,
          openTimelineAfterSaving: false,
        },
      })
    }, recordingDir)

    const terminalTab = mainWindow.locator('.project-workspace--active .terminal-tab-content').first()
    await terminalTab.click({ button: 'right' })
    await contextMenuItem(mainWindow, 'Start Recording').click()

    await expect(terminalTab.getByRole('img', { name: 'Recording terminal session' })).toBeVisible()
    await mainWindow.keyboard.type('printf recording-ui-hit')
    await mainWindow.keyboard.press('Enter')

    await terminalTab.click({ button: 'right' })
    await expect(contextMenuItem(mainWindow, 'Reveal Current Recording')).toBeVisible()
    await contextMenuItem(mainWindow, 'Stop Recording').click()
    await expect(terminalTab.getByRole('img', { name: 'Recording terminal session' })).toHaveCount(0)
    await terminalTab.click({ button: 'right' })
    await expect(contextMenuItem(mainWindow, 'Reveal Last Recording')).toBeVisible()
    await mainWindow.keyboard.press('Escape')

    await expect
      .poll(async () => mainWindow.evaluate(
        (knownIds) => window.terminay.listTerminalRecordings()
          .then((items) => items.filter((item) => !knownIds.includes(item.recordingId)).length),
        [...existingRecordingIds],
      ))
      .toBe(1)

    const recordingsWindow = await appHarness.openChildWindow(async () => {
      await mainWindow.evaluate(async () => {
        await window.terminay.openRecordingsWindow()
      })
    })

    await expect(recordingsWindow.getByRole('heading', { name: 'Recordings' })).toBeVisible()
    expect(
      await recordingsWindow.evaluate(async () => {
        const serializedRecordings = JSON.stringify(await window.terminay.listTerminalRecordings())
        return {
          boundedRead: typeof window.terminay.readTerminalRecordingChunk === 'function',
          hasCastPath: serializedRecordings.includes('"castPath"'),
          hasMetadataPath: serializedRecordings.includes('"metadataPath"'),
          legacyDelete: 'deleteTerminalRecording' in window.terminay,
          legacyRead: 'readTerminalRecording' in window.terminay,
          legacyReveal: 'revealTerminalRecording' in window.terminay,
        }
      }),
    ).toEqual({
      boundedRead: true,
      hasCastPath: false,
      hasMetadataPath: false,
      legacyDelete: false,
      legacyRead: false,
      legacyReveal: false,
    })
    await expect(recordingsWindow.getByPlaceholder('Search recordings')).toBeVisible()
    await expect(recordingsWindow.locator('.recordings-list-item').first()).toBeVisible()
    await recordingsWindow.getByPlaceholder('Search recordings').fill('Terminal')
    await expect(recordingsWindow.locator('.recordings-list-item').first()).toBeVisible()
    await expect(recordingsWindow.getByRole('button', { name: 'Play replay' })).toBeEnabled()
    await expect(recordingsWindow.getByLabel('Replay zoom')).toBeVisible()
    await expect(recordingsWindow.getByLabel('Replay zoom')).toHaveValue('Fit')

    await recordingsWindow.getByLabel('Zoom presets').click()
    await expect(recordingsWindow.getByRole('option', { name: '125%' })).toBeVisible()
    await recordingsWindow.getByRole('option', { name: '125%' }).click()
    await expect(recordingsWindow.getByLabel('Replay zoom')).toHaveValue('125%')
    await recordingsWindow.getByLabel('Replay zoom').fill('10')
    await recordingsWindow.getByLabel('Replay zoom').press('Enter')
    await expect(recordingsWindow.getByLabel('Replay zoom')).toHaveValue('10%')
    await recordingsWindow.getByLabel('Replay zoom').fill('5')
    await recordingsWindow.getByLabel('Replay zoom').press('Enter')
    await expect(recordingsWindow.getByLabel('Replay zoom')).toHaveValue('5%')
    await recordingsWindow.getByLabel('Replay zoom').fill('6%')
    await recordingsWindow.getByLabel('Replay zoom').press('Enter')
    await expect(recordingsWindow.getByLabel('Replay zoom')).toHaveValue('6%')

    await recordingsWindow.getByLabel('Replay palette').click()
    await expect(recordingsWindow.getByRole('option', { name: 'Current' })).toBeVisible()
    await recordingsWindow.getByRole('option', { name: 'Current' }).click()
    await expect(recordingsWindow.getByLabel('Replay palette')).toContainText('Current')

    await recordingsWindow.getByLabel('Playback speed').click()
    await expect(recordingsWindow.getByRole('option', { name: '2x' })).toBeVisible()
    await recordingsWindow.getByRole('option', { name: '2x' }).click()
    await expect(recordingsWindow.getByLabel('Playback speed')).toContainText('2x')
  })
})
