import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from './fixtures'

test('creates and saves a new macro with synced fields', async ({ appHarness, mainWindow }) => {
  const macrosWindow = await appHarness.openMacrosWindow(mainWindow)

  await macrosWindow.getByRole('button', { name: 'New Macro' }).click()
  await macrosWindow.getByPlaceholder('Macro Title').fill('E2E Macro')
  await macrosWindow.getByPlaceholder('Describe what this macro does...').fill(
    'Created by the settings/macros e2e coverage pass.',
  )
  await macrosWindow
    .locator('select')
    .filter({ has: macrosWindow.locator('option', { hasText: '+ Add Step...' }) })
    .selectOption('type')
  await macrosWindow.getByPlaceholder('Type text... use {{Variable}} for fields.').fill('echo "Hello {{Target}}"')
  await macrosWindow.getByRole('button', { name: 'Sync from Steps' }).click()

  await expect(macrosWindow.getByText('Detected:')).toBeVisible()
  await expect(macrosWindow.getByText('Target')).toBeVisible()

  await macrosWindow.getByRole('button', { name: 'Save Changes' }).click()
  await expect(macrosWindow.getByRole('button', { name: 'E2E Macro' })).toBeVisible()
})

test('shows starter macro fields in the macros window', async ({ appHarness, mainWindow }) => {
  const macrosWindow = await appHarness.openMacrosWindow(mainWindow)

  await macrosWindow.getByRole('button', { name: 'Say hello to person' }).click()
  await expect(macrosWindow.getByPlaceholder('Macro Title')).toHaveValue('Say hello to person')
  await expect(macrosWindow.getByRole('heading', { name: 'Required Fields' })).toBeVisible()
  await expect(macrosWindow.getByText('Detected:')).toBeVisible()
  await expect(macrosWindow.locator('input[value="Name of person"]').first()).toBeVisible()
  await expect(macrosWindow.locator('input[value="Emoji"]').first()).toBeVisible()
})

test('saves select field options after raw textarea editing', async ({ appHarness, mainWindow }) => {
  const macrosWindow = await appHarness.openMacrosWindow(mainWindow)

  await macrosWindow.getByRole('button', { name: 'New Macro' }).click()
  await macrosWindow.getByPlaceholder('Macro Title').fill('Eta Select Macro')
  await macrosWindow
    .locator('select')
    .filter({ has: macrosWindow.locator('option', { hasText: '+ Add Step...' }) })
    .selectOption('type')
  await macrosWindow.getByPlaceholder('Type text... use {{Variable}} for fields.').fill(
    "This is a test message:<% if (message === 'one') { %>This is the first message<% } else { %>This is the second message<% } %>",
  )
  await macrosWindow.getByRole('button', { name: 'Add Field' }).click()
  await macrosWindow.getByPlaceholder('Variable Name').fill('message')
  await macrosWindow.getByPlaceholder('Display Label').fill('Message')
  await macrosWindow
    .locator('select')
    .filter({ has: macrosWindow.locator('option[value="select"]') })
    .selectOption('select')

  const optionsEditor = macrosWindow.locator('textarea[placeholder^="Option 1"]').first()
  await optionsEditor.fill('First|one\nSecond|two')
  await expect(optionsEditor).toHaveValue('First|one\nSecond|two')

  await macrosWindow.getByRole('button', { name: 'Save Changes' }).click()

  const savedMacro = await macrosWindow.evaluate(async () => {
    const macros = await window.terminay.getMacros()
    return macros.find((macro) => macro.title === 'Eta Select Macro') ?? null
  })

  expect(savedMacro?.fields[0]?.options).toEqual([
    { label: 'First', value: 'one' },
    { label: 'Second', value: 'two' },
  ])
})

test('clears finished macro runs from the queue', async ({ appHarness, mainWindow }) => {
  await appHarness.openMacroLauncher(mainWindow)
  await mainWindow.getByRole('button', { name: 'Create a pull request' }).click()

  const macroQueueTrigger = mainWindow.getByLabel('Show macro queue (1)')
  await expect(macroQueueTrigger).toBeVisible()
  await macroQueueTrigger.click()

  const macroQueue = mainWindow.getByRole('menu', { name: 'Macro queue' })
  await expect(macroQueue).toBeVisible()
  await macroQueue.locator('.terminal-tab-macro-popover__clear').click()

  await expect(mainWindow.getByLabel(/Show macro queue \(\d+\)/)).toHaveCount(0)
})

test('searches macro file fields relative to the project root', async ({ createWorkspace, mainWindow, tempDir }) => {
  const workspace = await createWorkspace({
    name: 'macro-files',
    seed: {
      directories: ['d1', 'd2', 'nested'],
      files: {
        'd1/alpha.md': 'alpha',
        'd2/beta.md': 'beta',
        'nested/inner.md': 'inner',
      },
    },
  })
  const siblingRoot = path.join(tempDir, 'sibling-root')
  await mkdir(siblingRoot, { recursive: true })
  await writeFile(path.join(siblingRoot, 'dist-file.md'), 'outside project root', 'utf8')

  const search = async (query: string) => {
    return mainWindow.evaluate(
      async ({ query: nextQuery, rootDir }) => {
        return window.terminay.searchFiles({ rootPath: rootDir, query: nextQuery, limit: 20 })
      },
      { query, rootDir: workspace.rootDir },
    )
  }

  await expect.poll(async () => (await search('d')).map((result) => result.relativePath)).toEqual(
    expect.arrayContaining(['d1/', 'd2/']),
  )
  expect((await search('dist')).map((result) => result.relativePath)).not.toContain('dist-file.md')

  expect((await search('nested/i')).map((result) => result.relativePath)).toContain('nested/inner.md')
  expect((await search('../sibling-root/dist')).map((result) => result.relativePath)).toContain(
    '../sibling-root/dist-file.md',
  )

  const absoluteQuery = `${siblingRoot.replace(/\\/g, '/')}/dist`
  expect((await search(absoluteQuery)).map((result) => result.relativePath)).toContain(
    `${siblingRoot.replace(/\\/g, '/')}/dist-file.md`,
  )
})
