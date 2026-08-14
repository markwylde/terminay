import { appendFile, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from './fixtures'
import { activateDockTab, fileExplorerItem, openFileExplorer, setMonacoValue, setProjectRoot } from './support/ui'

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

        return monacoApi?.editor?.getModels()?.at(-1)?.getValue().slice(0, 128) ?? ''
      }),
    )
    .toContain('local draft')

  const conflict = mainWindow.locator('.file-conflict-banner')
  await expect(conflict).toContainText('changed on disk')
  await conflict.getByRole('button', { name: 'Keep local edits' }).click()
  await expect(conflict).toHaveCount(0)

  await activateDockTab(mainWindow, 'conflict.txt')
  await appHarness.sendAppCommand('save-active')
  await expect(mainWindow.locator('.file-status-bar')).toContainText('Synced')
  await expect.poll(() => workspace.readText('conflict.txt')).toBe('local draft\n')
})

test('large text files use bounded ranged editing in performant mode', async ({
  createWorkspace,
  mainWindow,
}) => {
  test.setTimeout(180_000)

  const workspace = await createWorkspace({
    name: 'large-file',
    seed: {
      files: {
        'large.txt': '',
      },
    },
  })
  const chunk = '0123456789abcdef\n'.repeat(8192)
  // Keep the fixture just above the product's 100 MiB large-file boundary.
  // 100 MiB plus one complete source chunk deterministically exercises the
  // performant path without manufacturing nearly another MiB of duplicate
  // content that adds no boundary coverage under constrained CI renderers.
  const targetSize = 100 * 1024 * 1024 + Buffer.byteLength(chunk)
	while ((await stat(workspace.path('large.txt'))).size < targetSize) {
    await appendFile(workspace.path('large.txt'), chunk, 'utf8')
  }
	const readDiskPrefix = async () =>
		(await readFile(workspace.path('large.txt'))).subarray(0, 128).toString('utf8')

  await setProjectRoot(mainWindow, workspace.rootDir)
  await openFileExplorer(mainWindow)

  await fileExplorerItem(mainWindow, 'large.txt').dblclick()
  const chooser = mainWindow.locator('.large-file-open-chooser')
  await expect(chooser).toBeVisible()
  await chooser.getByRole('button', { name: 'Performant' }).click()
  await mainWindow.getByRole('tab', { name: 'Text' }).click()

  const performant = mainWindow.locator('.file-performant-text-viewer')
  await expect(performant).toBeVisible()
  await expect(mainWindow.locator('.file-status-bar')).toContainText('Performant')
  await expect(mainWindow.locator('.file-performant-text-viewer__viewport')).toHaveAttribute(
    'data-line-count',
    /[1-9]\d{5,}/,
  )
  await expect.poll(() => mainWindow.locator('.file-performant-text-page').count()).toBeLessThan(5)

  await mainWindow.getByRole('tab', { name: 'HEX' }).click()
  const preexistingHexByte = mainWindow.getByLabel('Byte 00000027')
  await expect(preexistingHexByte).toHaveValue('35')
  await preexistingHexByte.fill('41')
  await expect(mainWindow.locator('.file-status-bar')).toContainText('Unsaved changes')
  await expect.poll(readDiskPrefix).toMatch(/^0123456789abcdef\n/)

  await mainWindow.getByRole('tab', { name: 'Text' }).click()
  const firstPage = mainWindow.getByLabel('Lines 1–128')
  await expect(firstPage).toHaveValue(/^0123456789abcdef\n0123456789abcdef\n/)
  const originalPage = await firstPage.inputValue()
  expect(originalPage).toContain('01234A6789abcdef')
  const changedPage = originalPage.replace(
    /^0123456789abcdef\n0123456789abcdef\n/,
    'changed first line\ninserted snow 雪\njoined second line\n',
  )
  await firstPage.fill(changedPage)
  const editedFirstPage = mainWindow.getByLabel('Lines 1–129')
  const crossLineSelectionEnd = changedPage.indexOf('\n') + 9
  await editedFirstPage.evaluate((element, end) => {
    const textarea = element as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(8, end)
  }, crossLineSelectionEnd)
  await expect
    .poll(() =>
      editedFirstPage.evaluate((element) => ({
        end: (element as HTMLTextAreaElement).selectionEnd,
        start: (element as HTMLTextAreaElement).selectionStart,
      })),
    )
    .toEqual({ end: crossLineSelectionEnd, start: 8 })
  await expect(mainWindow.locator('.file-status-bar')).toContainText('Unsaved changes')
  await expect.poll(readDiskPrefix).toMatch(/^0123456789abcdef\n/)

  await mainWindow.getByRole('tab', { name: 'HEX' }).click()
  await expect(mainWindow.locator('.file-status-bar')).toContainText('Unsaved changes')
  const firstByte = mainWindow.getByLabel('Byte 00000000')
  await expect(firstByte).toHaveValue('63')
  await firstByte.fill('58')
  const replacementNewline = mainWindow.getByLabel('Byte 00000012')
  await expect(replacementNewline).toHaveValue('0A')
  await replacementNewline.fill('20')
  await expect(mainWindow.locator('.file-status-bar')).toContainText('Unsaved changes')
  await expect.poll(readDiskPrefix).toMatch(/^0123456789abcdef\n/)

  await mainWindow.getByRole('tab', { name: 'Text' }).click()
  const joinedFirstPage = mainWindow.getByLabel('Lines 1–128')
  await expect(joinedFirstPage).toHaveValue(/^Xhanged first line inserted snow 雪\njoined second line\n/)
  expect(await joinedFirstPage.inputValue()).toContain('01234A6789abcdef')
  await expect(mainWindow.locator('.file-status-bar')).toContainText('Unsaved changes')

  await mainWindow.locator('.file-performant-text-viewer__viewport').evaluate((element) => {
    element.scrollTop = 3_700
    element.dispatchEvent(new Event('scroll'))
  })
  await expect(mainWindow.getByLabel('Lines 129–256')).toBeVisible()
  await expect.poll(() => mainWindow.locator('.file-performant-text-page').count()).toBeLessThan(5)
})
