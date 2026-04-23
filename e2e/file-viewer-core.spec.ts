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
