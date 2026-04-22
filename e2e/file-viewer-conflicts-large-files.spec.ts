import { appendFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from './fixtures'
import { fileExplorerItem, openFileExplorer, setMonacoValue, setProjectRoot } from './support/ui'

async function replaceFileAtomically(filePath: string, contents: string): Promise<void> {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.swap`)
  await writeFile(tempPath, contents, 'utf8')
  await rename(tempPath, filePath)
}

test('file viewer reloads clean files after external changes', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'file-reload',
    seed: {
      files: {
        'watched.txt': 'from disk v1\n',
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'watched.txt').dblclick()
  await expect(mainWindow.locator('.file-preview-text')).toContainText('from disk v1')

  await workspace.writeText('watched.txt', 'from disk v2\n')
  await expect(mainWindow.locator('.file-preview-text')).toContainText('from disk v2')
})

test('file viewer keeps reloading after repeated atomic saves', async ({ createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'file-atomic-reload',
    seed: {
      files: {
        'README.md': '# version 1\n',
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'README.md').dblclick()
  await expect(mainWindow.locator('.file-preview-markdown')).toContainText('version 1')

  await replaceFileAtomically(workspace.path('README.md'), '# version 2\n')
  await expect(mainWindow.locator('.file-preview-markdown')).toContainText('version 2')

  await replaceFileAtomically(workspace.path('README.md'), '# version 3\n')
  await expect(mainWindow.locator('.file-preview-markdown')).toContainText('version 3')
})

test('dirty file edits stay local until saved even after an external write', async ({ appHarness, createWorkspace, mainWindow }) => {
  const workspace = await createWorkspace({
    name: 'file-conflict',
    seed: {
      files: {
        'conflict.txt': 'original\n',
      },
    },
  })

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'conflict.txt').dblclick()
  await mainWindow.getByRole('tab', { name: 'Text' }).click()
  await expect(mainWindow.locator('.monaco-editor')).toBeVisible()
  await setMonacoValue(mainWindow, 'local draft\n')
  await expect(mainWindow.locator('.file-status-bar')).toContainText('Unsaved changes')

  await workspace.writeText('conflict.txt', 'external revision\n')
  await expect
    .poll(async () =>
      mainWindow.evaluate(() => {
        const monacoApi = (window as Window & {
          monaco?: {
            editor?: {
              getModels: () => Array<{ getValue: () => string }>
            }
          }
        }).monaco

        return monacoApi?.editor?.getModels()?.at(-1)?.getValue() ?? ''
      }),
    )
    .toContain('local draft')

  await mainWindow.locator('.terminal-tab-title').filter({ hasText: 'conflict.txt' }).click()
  await appHarness.sendAppCommand('save-active')
  await expect(mainWindow.locator('.file-status-bar')).toContainText('Synced')
  await expect.poll(() => workspace.readText('conflict.txt')).toBe('local draft\n')
})

test('large text files prompt for engine choice, truncate in performant mode, and block saving', async ({
  appHarness,
  createWorkspace,
  mainWindow,
}) => {
  test.setTimeout(120_000)

  const workspace = await createWorkspace({
    name: 'large-file',
    seed: {
      files: {
        'large.txt': '',
      },
    },
  })
  const chunk = '0123456789abcdef\n'.repeat(8192)
  while ((await mainWindow.evaluate((filePath) => window.termide.getFileInfo(filePath).then((info) => info.size), workspace.path('large.txt'))) < 101 * 1024 * 1024) {
    await appendFile(workspace.path('large.txt'), chunk, 'utf8')
  }

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'large.txt').dblclick()
  const chooser = mainWindow.locator('.large-file-open-chooser')
  await expect(chooser).toBeVisible()
  await chooser.getByRole('button', { name: 'Performant' }).click()
  await mainWindow.getByRole('tab', { name: 'Text' }).click()

  await expect(mainWindow.locator('.file-text-viewer__textarea')).toBeVisible()
  await expect(mainWindow.locator('.file-panel')).toContainText('Showing a truncated window in Performant mode')
  await expect(mainWindow.locator('.file-status-bar')).toContainText('Performant')
  await expect(mainWindow.locator('.file-text-viewer__textarea')).toHaveValue(/Large file truncated in Performant mode/)

  await mainWindow.locator('.terminal-tab-title').filter({ hasText: 'large.txt' }).click()
  await appHarness.sendAppCommand('save-active')
  await expect(mainWindow.locator('.error-banner')).toContainText(
    'Switch to Monaco before saving this large file so the full file contents are loaded.',
  )
})
