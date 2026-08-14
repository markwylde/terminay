import { expect, test } from './fixtures'
import { activateDockTab, fileExplorerItem, openFileExplorer, setMonacoValue, setProjectRoot } from './support/ui'

test('file viewer edits and saves text files without duplicating tabs', async ({
  appHarness,
  createWorkspace,
  mainWindow,
}) => {
  const workspace = await createWorkspace({
    name: 'file-viewer-core',
    seed: {
      files: {
        'notes.txt': 'hello from preview\n',
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'notes.txt').dblclick()
  await expect(mainWindow.locator('.file-preview-text')).toContainText('hello from preview')

  await mainWindow.getByRole('tab', { name: 'Text' }).click()
  await expect(mainWindow.locator('.monaco-editor')).toBeVisible()
  await setMonacoValue(mainWindow, 'saved through viewer\n')
  await expect(mainWindow.locator('.file-status-bar')).toContainText('Unsaved changes')

  await activateDockTab(mainWindow, 'notes.txt')
  await appHarness.sendAppCommand('save-active')
  await expect.poll(() => workspace.readText('notes.txt')).toBe('saved through viewer\n')

  await fileExplorerItem(mainWindow, 'notes.txt').dblclick()
  await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(1)
})

test('file viewer replaces an out-of-scope loading failure with a retryable error', async ({
  createWorkspace,
  mainWindow,
}) => {
  const workspace = await createWorkspace({
    name: 'file-viewer-load-error',
    seed: { files: { 'inside.txt': 'inside project\n' } },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await mainWindow.evaluate(() => {
    window.dispatchEvent(new CustomEvent('terminay-open-file', {
      detail: { path: '/terminay-e2e-outside-project/missing.txt' },
    }))
  })

  const alert = mainWindow.getByRole('alert').filter({ hasText: 'Unable to load file' })
  await expect(alert).toContainText('file path is outside the project root')
  await alert.getByRole('button', { name: 'Retry' }).click()
  await expect(alert).toContainText('file path is outside the project root')
  await expect(mainWindow.locator('.file-panel--loading')).toHaveCount(0)
})

test('HEX edits share dirty state and survive Text mode switches', async ({
  appHarness,
  createWorkspace,
  mainWindow,
}) => {
  const workspace = await createWorkspace({
    name: 'file-viewer-hex-draft',
    seed: {
      files: {
        'bytes.txt': 'hello world\n',
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)
  await fileExplorerItem(mainWindow, 'bytes.txt').dblclick()
  await mainWindow.getByRole('tab', { name: 'HEX' }).click()

  const firstByte = mainWindow.getByLabel('Byte 00000000')
  const fourthByte = mainWindow.getByLabel('Byte 00000003')
  await firstByte.fill('48')
  await expect(mainWindow.locator('.file-status-bar')).toContainText('Unsaved changes')

  await firstByte.click()
  await fourthByte.click({ modifiers: ['Shift'] })
  await expect(mainWindow.locator('.file-hex-row__byte--selected')).toHaveCount(4)
  await expect(mainWindow.locator('.file-hex-viewer__header')).toContainText('Selected 0x0–0x3')

  await mainWindow.getByLabel('Bytes per row').selectOption('8')
  await expect(mainWindow.locator('.file-hex-row__bytes').first().locator('input')).toHaveCount(8)

  await mainWindow.getByRole('tab', { name: 'Text' }).click()
  await expect
    .poll(() =>
      mainWindow.evaluate(() => {
        const monacoApi = (window as Window & {
          monaco?: { editor?: { getModels: () => Array<{ getValue: () => string }> } }
        }).monaco
        return monacoApi?.editor?.getModels()?.at(-1)?.getValue() ?? ''
      }),
    )
    .toBe('Hello world\n')
  await expect(mainWindow.locator('.file-status-bar')).toContainText('Unsaved changes')

  await mainWindow.getByRole('tab', { name: 'HEX' }).click()
  await expect(mainWindow.getByLabel('Byte 00000000')).toHaveValue('48')
  await activateDockTab(mainWindow, 'bytes.txt')
  await appHarness.sendAppCommand('save-active')
  await expect.poll(() => workspace.readText('bytes.txt')).toBe('Hello world\n')
  await expect(mainWindow.locator('.file-status-bar')).toContainText('Synced')
})

test('preview syntax highlights tsx files', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'file-viewer-preview-highlight',
    seed: {
      files: {
        'component.tsx': 'export function Example() {\n  return <div className="demo">hello</div>\n}\n',
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'component.tsx').dblclick()
  await expect(mainWindow.locator('.file-preview-text')).toContainText('export function Example()')
  await expect(mainWindow.locator('.file-code-block__line-number').first()).toHaveText('1')
  await expect(mainWindow.locator('.file-preview-text .file-token--keyword', { hasText: 'export' }).first()).toBeVisible()
  await expect(mainWindow.locator('.file-preview-text .file-token--tag-name', { hasText: 'div' }).first()).toBeVisible()
  await expect(mainWindow.locator('.file-preview-text .file-token--attribute-name', { hasText: 'className' }).first()).toBeVisible()
})

test('yaml and yml files are highlighted in preview and text modes', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'file-viewer-yaml-highlight',
    seed: {
      files: {
        'compose.yml': 'services:\n  app:\n    image: node:22\n    environment:\n      ENABLED: true\n',
        'settings.yaml': 'name: terminay\nretries: 3\n# deploy settings\n',
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'compose.yml').dblclick()
  await expect(mainWindow.locator('.file-preview-text')).toContainText('services:')
  await expect(mainWindow.locator('.file-preview-text .file-token--property', { hasText: 'services' }).first()).toBeVisible()
  await expect(mainWindow.locator('.file-preview-text .file-token--keyword', { hasText: 'true' }).first()).toBeVisible()

  await mainWindow.getByRole('tab', { name: 'Text' }).click()
  await expect(mainWindow.locator('.monaco-editor')).toBeVisible()
  await expect.poll(() => getActiveMonacoLanguage(mainWindow)).toBe('yaml')
  await expect.poll(() => getActiveMonacoText(mainWindow)).toContain('services:')

  await fileExplorerItem(mainWindow, 'settings.yaml').dblclick()
  await mainWindow.getByRole('tab', { name: 'Text' }).click()
  await expect.poll(() => getActiveMonacoLanguage(mainWindow)).toBe('yaml')
})

test('binary files fall back to hex when preview is unavailable', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'file-viewer-binary',
    seed: {
      files: {
        'payload.bin': Buffer.from([0x00, 0x41, 0xff, 0x42]),
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'payload.bin').dblclick()
  await expect(mainWindow.locator('.file-hex-viewer')).toBeVisible()
  await expect(mainWindow.locator('.file-hex-viewer__header')).toContainText('Offset')
})

test('unknown extensions keep the default mode but allow preview text and hex tabs', async ({
  createWorkspace,
  mainWindow,
}) => {
  const workspace = await createWorkspace({
    name: 'file-viewer-unknown-extension',
    seed: {
      files: {
        'notes.customunknown': 'this extension is still text\n',
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'notes.customunknown').dblclick()
  await expect(mainWindow.locator('.file-hex-viewer')).toBeVisible()

  await expect(mainWindow.getByRole('tab', { name: 'Preview' })).toBeEnabled()
  await expect(mainWindow.getByRole('tab', { name: 'Text' })).toBeEnabled()
  await expect(mainWindow.getByRole('tab', { name: 'HEX' })).toBeEnabled()

  await mainWindow.getByRole('tab', { name: 'Text' }).click()
  await expect(mainWindow.locator('.monaco-editor')).toBeVisible()
  await expect.poll(() => getActiveMonacoText(mainWindow)).toContain('this extension is still text')

  await mainWindow.getByRole('tab', { name: 'Preview' }).click()
  await expect(mainWindow.locator('.file-preview-unsupported')).toContainText('Preview is not available')

  await mainWindow.getByRole('tab', { name: 'HEX' }).click()
  await expect(mainWindow.locator('.file-hex-viewer')).toBeVisible()
})

test('custom extension defaults choose the first file viewer tab', async ({ appHarness, createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'file-viewer-custom-extension-default',
    seed: {
      files: {
        'notes.e2etext': 'open me in text mode\n',
      },
    },
  })

  const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'file-viewer-refresh' })
  await settingsWindow.getByRole('button', { name: 'Add Extension' }).click()
  const row = settingsWindow.locator('.settings-custom-extensions__item').last()
  await row.getByLabel('File extension').fill('.e2etext')
  await row.getByLabel('File extension').press('Enter')
  await expect(settingsWindow.locator('.settings-status')).toContainText('Saved')
  await settingsWindow.close()

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'notes.e2etext').dblclick()
  await expect(mainWindow.locator('.monaco-editor')).toBeVisible()
  await expect.poll(() => getActiveMonacoText(mainWindow)).toContain('open me in text mode')
  await expect(mainWindow.getByRole('tab', { name: 'Preview' })).toBeEnabled()
  await expect(mainWindow.getByRole('tab', { name: 'HEX' })).toBeEnabled()
})

async function getActiveMonacoLanguage(page: Parameters<typeof setProjectRoot>[0]) {
  return page.evaluate(() => {
    const monacoApi = (window as Window & {
      monaco?: {
        editor?: {
          getModels: () => Array<{ getLanguageId: () => string }>
        }
      }
    }).monaco

    return monacoApi?.editor?.getModels()?.at(-1)?.getLanguageId() ?? ''
  })
}

async function getActiveMonacoText(page: Parameters<typeof setProjectRoot>[0]) {
  return page.evaluate(() => {
    const monacoApi = (window as Window & {
      monaco?: {
        editor?: {
          getModels: () => Array<{ getValue: () => string }>
        }
      }
    }).monaco

    return monacoApi?.editor?.getModels()?.at(-1)?.getValue() ?? ''
  })
}
