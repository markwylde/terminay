import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { setProjectRoot } from './support/ui'

const script = (page: Page) => page.getByLabel('Text to type')
const libraryItem = (page: Page, title: string) => page.locator('.macro-nav-item', { hasText: title })
const saveState = (page: Page) => page.locator('.macro-save-state')
const preview = (page: Page) => page.getByTestId('macro-preview')
const sequence = (page: Page) => preview(page).locator('.macro-preview-sequence li')
const inputRow = (page: Page, name: string) => page.locator(`[data-input-name="${name}"]`)
const token = (page: Page, type: string) => page.locator(`.macro-token[data-step-type="${type}"]`)
const categoryHeader = (page: Page, category: string) =>
  page.locator(`[data-macro-category="${category}"] .macro-library-category`)

async function newMacro(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New macro', exact: true }).click()
  await page.getByLabel('Macro name').fill(title)
}

async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(saveState(page)).toHaveText('Saved')
}

/** Reload the window so what is shown is what the server stored. */
async function reopen(page: Page, title: string): Promise<void> {
  await page.reload()
  await libraryItem(page, title).getByRole('button').click()
  await expect(page.getByLabel('Macro name')).toHaveValue(title)
}

/** Deliver a paste or drop carrying the given data, as the browser would. */
async function deliver(target: Locator, type: 'paste' | 'drop', data: Record<string, string>): Promise<void> {
  await target.evaluate(
    (element, { type, data }) => {
      const transfer = new DataTransfer()
      for (const [format, value] of Object.entries(data)) transfer.setData(format, value)
      const event =
        type === 'paste'
          ? new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
          : new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
      element.dispatchEvent(event)
    },
    { type, data },
  )
}

test('creates a prompt macro by typing and saving', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await newMacro(macros, 'E2E Prompt')
  await macros.getByLabel('Description').fill('Created by the macros e2e coverage pass.')
  await script(macros).first().fill('Create a pull request and get it green.')

  // One text block and nothing else: the macro is a single typed step.
  await expect(sequence(macros)).toHaveCount(1)
  await expect(sequence(macros).first()).toHaveText('Create a pull request and get it green.')
  await expect(saveState(macros)).toHaveText('Unsaved changes in 1 macro')
  await expect(libraryItem(macros, 'E2E Prompt').locator('.macro-nav-item-unsaved')).toBeVisible()

  await save(macros)
  await expect(libraryItem(macros, 'E2E Prompt').locator('.macro-nav-item-unsaved')).toHaveCount(0)

  await reopen(macros, 'E2E Prompt')
  await expect(script(macros).first()).toHaveValue('Create a pull request and get it green.')
  await expect(macros.getByLabel('Description')).toHaveValue('Created by the macros e2e coverage pass.')
})

test('shows a starter macro as text, inputs and a preview', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await libraryItem(macros, 'Say hello to person').getByRole('button').click()
  await expect(macros.getByLabel('Macro name')).toHaveValue('Say hello to person')
  await expect(script(macros).first()).toHaveValue('Say hello to {{Name of person}} with a {{Emoji}} emoji')
  await expect(inputRow(macros, 'Name of person').getByLabel('Label for Name of person')).toHaveValue('Name of person')
  await expect(inputRow(macros, 'Emoji').getByLabel('Type for Emoji')).toHaveValue('emoji')
  // The input with no default shows as its label; the one with a default shows the value.
  await expect(sequence(macros).first()).toHaveText('Say hello to Name of person with a 👋 emoji')

  // A multi-step starter macro is the same document, with tokens between the text.
  await libraryItem(macros, 'Update OS').getByRole('button').click()
  await expect(token(macros, 'key')).toHaveCount(2)
  await expect(token(macros, 'wait_inactivity')).toHaveCount(1)
  await expect(sequence(macros)).toHaveText([
    'sudo apt-get update',
    'presses Enter',
    'waits for 3s of quiet',
    'sudo apt-get upgrade -y',
    'presses Enter',
  ])
})

test('inserts a wait with the slash menu', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await newMacro(macros, 'Slash Macro')
  await script(macros).first().click()
  await macros.keyboard.type('npm test')
  await macros.keyboard.press('Enter')
  await macros.keyboard.type('/')
  const menu = macros.getByRole('listbox', { name: 'Insert a step' })
  await expect(menu.getByRole('option')).toHaveCount(4)
  await macros.keyboard.type('wa')
  await expect(menu.getByRole('option')).toHaveText([/Wait until quiet/, /^Wait/])
  await macros.keyboard.press('Enter')

  await expect(menu).toHaveCount(0)
  await expect(token(macros, 'wait_inactivity')).toHaveCount(1)
  // The cursor continues on the line after the token.
  await macros.keyboard.type('npm run build')
  await macros.getByRole('button', { name: 'Press key' }).click()
  await expect(sequence(macros)).toHaveText(['npm test', 'waits for 3s of quiet', 'npm run build', 'presses Enter'])

  await save(macros)
  await reopen(macros, 'Slash Macro')
  await expect(script(macros).first()).toHaveValue('npm test')
  await expect(token(macros, 'wait_inactivity').getByLabel('Seconds of quiet')).toHaveValue('3')
  await expect(sequence(macros)).toHaveText(['npm test', 'waits for 3s of quiet', 'npm run build', 'presses Enter'])

  // Backspace at the start of the text after a token removes the token and keeps the text.
  await script(macros).nth(1).click()
  await macros.keyboard.press('Home')
  await macros.keyboard.press('Backspace')
  await expect(token(macros, 'wait_inactivity')).toHaveCount(0)
  await expect(script(macros).first()).toHaveValue('npm test\nnpm run build')
})

test('a slash command stays text', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await newMacro(macros, 'Agent Command')
  await script(macros).first().click()
  await macros.keyboard.type('/')
  await expect(macros.getByRole('listbox', { name: 'Insert a step' })).toBeVisible()
  await macros.keyboard.type('opsx:apply')
  // Nothing matched, so the menu let go of the line and Enter is a line break.
  await expect(macros.getByRole('listbox', { name: 'Insert a step' })).toHaveCount(0)
  await macros.keyboard.press('Enter')
  await macros.keyboard.type('/w')
  await macros.keyboard.press('Escape')
  await expect(macros.getByRole('listbox', { name: 'Insert a step' })).toHaveCount(0)

  await expect(script(macros).first()).toHaveValue('/opsx:apply\n/w')
  await expect(macros.locator('.macro-token')).toHaveCount(0)
  await save(macros)
  await reopen(macros, 'Agent Command')
  await expect(script(macros).first()).toHaveValue('/opsx:apply\n/w')
})

test('typing a placeholder adds an input', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await newMacro(macros, 'Placeholder Macro')
  await expect(macros.getByText('No inputs, so this macro runs straight away.')).toBeVisible()
  await expect(preview(macros).getByText('Nothing. It runs without asking anything.')).toBeVisible()

  await script(macros).first().fill('echo "Hello {{target_name}}"')
  await expect(inputRow(macros, 'target_name').getByLabel('Label for target_name')).toHaveValue('Target name')
  await expect(inputRow(macros, 'target_name').getByLabel('Type for target_name')).toHaveValue('text')
  await expect(inputRow(macros, 'target_name').getByLabel('target_name is required')).toBeChecked()
  await expect(preview(macros).getByLabel(/Target name/)).toBeVisible()

  // Untouched, the input follows the text: remove the reference and it goes.
  await script(macros).first().fill('echo "Hello"')
  await expect(inputRow(macros, 'target_name')).toHaveCount(0)

  // The insert control drops a placeholder with its name selected.
  await script(macros).first().click()
  await macros.keyboard.press('End')
  await macros.getByRole('button', { name: '{{ input }}' }).click()
  await macros.keyboard.type('who')
  await expect(script(macros).first()).toHaveValue('echo "Hello"{{who}}')
  await expect(inputRow(macros, 'who')).toHaveCount(1)
  await expect(inputRow(macros, 'name')).toHaveCount(0)

  await save(macros)
  await reopen(macros, 'Placeholder Macro')
  await expect(inputRow(macros, 'who')).toHaveCount(1)
})

test('an edited input that is no longer referenced is kept as unused', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await newMacro(macros, 'Unused Input Macro')
  await script(macros).first().fill('deploy {{env}}')
  await inputRow(macros, 'env').getByLabel('Label for env').fill('Environment')
  await script(macros).first().fill('deploy')

  await expect(inputRow(macros, 'env')).toHaveCount(1)
  await expect(inputRow(macros, 'env').getByText('Not used in the text any more.')).toBeVisible()
  await save(macros)
  await reopen(macros, 'Unused Input Macro')
  await expect(inputRow(macros, 'env').getByLabel('Label for env')).toHaveValue('Environment')

  await inputRow(macros, 'env').getByRole('button', { name: 'Remove input env' }).click()
  await expect(inputRow(macros, 'env')).toHaveCount(0)
})

test('preview follows the script and the form', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)
  const terminalBefore = await mainWindow.locator('.terminal-tab-content').first().innerText()

  await newMacro(macros, 'Preview Macro')
  await script(macros).first().fill('git switch {{branch}}')
  await expect(sequence(macros).first()).toHaveText('git switch Branch')
  await expect(sequence(macros).first().locator('.macro-preview-missing')).toHaveText('Branch')

  await preview(macros).getByLabel(/Branch/).fill('main')
  await expect(sequence(macros).first()).toHaveText('git switch main')

  // A default typed in the inputs table shows wherever the form has not been touched.
  await inputRow(macros, 'branch').getByLabel('Label for branch').fill('Target branch')
  await expect(preview(macros).getByLabel(/Target branch/)).toHaveValue('main')

  await macros.getByRole('button', { name: 'Wait', exact: true }).click()
  await token(macros, 'wait_time').getByLabel('Seconds to wait').fill('{Delay}')
  await expect(sequence(macros)).toHaveText(['git switch main', 'waits {Delay}s'])
  await preview(macros).getByLabel(/Delay/).fill('2.5')
  await expect(sequence(macros).nth(1)).toHaveText('waits 2.5s')

  // The preview is drawn in the window; nothing reached the terminal.
  expect(await mainWindow.locator('.terminal-tab-content').first().innerText()).toBe(terminalBefore)
})

test('saves choice options after raw text editing', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await newMacro(macros, 'Eta Select Macro')
  await script(macros).first().fill(
    "This is a test message:<% if (message === 'one') { %>This is the first message<% } else { %>This is the second message<% } %>",
  )
  await inputRow(macros, 'message').getByLabel('Type for message').selectOption('select')

  const optionsEditor = inputRow(macros, 'message').locator('textarea')
  // Incomplete text is left exactly as typed.
  await optionsEditor.fill('First|')
  await expect(optionsEditor).toHaveValue('First|')
  await optionsEditor.fill('First|one\nSecond|two')

  await preview(macros).getByLabel(/Message/).selectOption('two')
  await expect(sequence(macros).first()).toHaveText('This is a test message:This is the second message')

  await save(macros)
  await reopen(macros, 'Eta Select Macro')
  await expect(inputRow(macros, 'message').locator('textarea')).toHaveValue('First|one\nSecond|two')
  await expect(inputRow(macros, 'message').getByLabel('Default for message')).toHaveValue('one')
})

test('saves parameterized wait steps in seconds', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await newMacro(macros, 'Parameterized Wait Macro')
  await macros.getByRole('button', { name: 'Wait', exact: true }).click()
  await token(macros, 'wait_time').getByLabel('Seconds to wait').fill('{Delay}')
  await expect(inputRow(macros, 'Delay')).toHaveCount(1)

  await save(macros)
  await reopen(macros, 'Parameterized Wait Macro')
  await expect(token(macros, 'wait_time').getByLabel('Seconds to wait')).toHaveValue('{Delay}')
  await expect(inputRow(macros, 'Delay')).toHaveCount(1)
})

test('saves two edited macros with one save', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await libraryItem(macros, 'Update OS').getByRole('button').click()
  await macros.getByLabel('Description').fill('Edited first.')
  await libraryItem(macros, 'Create a pull request').getByRole('button').click()
  await macros.getByLabel('Description').fill('Edited second.')

  // Selecting another macro kept the first one's edits and marked it.
  await expect(saveState(macros)).toHaveText('Unsaved changes in 2 macros')
  await expect(macros.locator('.macro-nav-item-unsaved')).toHaveCount(2)

  await macros.keyboard.press('ControlOrMeta+s')
  await expect(saveState(macros)).toHaveText('Saved')
  await expect(macros.locator('.macro-nav-item-unsaved')).toHaveCount(0)

  await macros.reload()
  await libraryItem(macros, 'Update OS').getByRole('button').click()
  await expect(macros.getByLabel('Description')).toHaveValue('Edited first.')
  await libraryItem(macros, 'Create a pull request').getByRole('button').click()
  await expect(macros.getByLabel('Description')).toHaveValue('Edited second.')
})

test('discard restores macros and categories', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await libraryItem(macros, 'Update OS').getByRole('button').click()
  await macros.getByLabel('Macro name').fill('Renamed')
  await macros.getByRole('button', { name: 'New category' }).click()
  await macros.getByLabel('Category name').fill('Scratch')
  await macros.getByLabel('Category name').press('Enter')
  await expect(categoryHeader(macros, 'Scratch')).toBeVisible()
  await expect(macros.getByRole('button', { name: 'Discard' })).toBeEnabled()

  await macros.getByRole('button', { name: 'Discard' }).click()
  await expect(saveState(macros)).toHaveText('All changes saved')
  await expect(libraryItem(macros, 'Update OS')).toHaveCount(1)
  await expect(libraryItem(macros, 'Renamed')).toHaveCount(0)
  await expect(categoryHeader(macros, 'Scratch')).toHaveCount(0)
  await expect(macros.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

test('a rejected save keeps the edits and says why', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await newMacro(macros, 'Broken Choice')
  await script(macros).first().fill('deploy {{env}}')
  await inputRow(macros, 'env').getByLabel('Type for env').selectOption('select')

  await macros.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(macros.getByRole('alert')).toContainText('"Broken Choice: Env" needs at least one choice.')
  await expect(saveState(macros)).toHaveText('Unsaved changes in 1 macro')
  await expect(script(macros).first()).toHaveValue('deploy {{env}}')

  await inputRow(macros, 'env').locator('textarea').fill('Staging|staging\nProduction|prod')
  await save(macros)
  await expect(macros.getByRole('alert')).toHaveCount(0)
})

test('creates, renames and removes a category', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await macros.getByRole('button', { name: 'New category' }).click()
  await macros.getByLabel('Category name').fill('Release')
  await macros.getByLabel('Category name').press('Enter')
  await expect(categoryHeader(macros, 'Release')).toBeVisible()
  await expect(macros.locator('[data-macro-category="Release"]').getByText('Empty. Drag a macro here.')).toBeVisible()

  // Add a macro to it from the category, then rename the category under it.
  await categoryHeader(macros, 'Release').hover()
  await macros.getByRole('button', { name: 'New macro in Release' }).click()
  await macros.getByLabel('Macro name').fill('Tag a release')
  await expect(macros.locator('#macro-category')).toHaveValue('Release')

  await categoryHeader(macros, 'Release').hover()
  await macros.getByRole('button', { name: 'Rename category Release' }).click()
  await macros.getByLabel('Category name').fill('Shipping')
  await macros.getByLabel('Category name').press('Enter')
  await expect(macros.locator('[data-macro-category="Shipping"] .macro-nav-item')).toHaveText(['Tag a release'])
  await expect(macros.locator('#macro-category')).toHaveValue('Shipping')

  await save(macros)
  await macros.reload()
  await expect(macros.locator('[data-macro-category="Shipping"] .macro-nav-item')).toHaveText(['Tag a release'])

  // Removing a category keeps its macros, without a category.
  await categoryHeader(macros, 'Shipping').hover()
  await macros.getByRole('button', { name: 'Remove category Shipping' }).click()
  await expect(categoryHeader(macros, 'Shipping')).toHaveCount(0)
  await expect(macros.locator('[data-macro-category=""] .macro-nav-item', { hasText: 'Tag a release' })).toHaveCount(1)
})

test('assigns a macro from the editor', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await libraryItem(macros, 'Update OS').getByRole('button').click()
  await macros.locator('#macro-category').selectOption({ label: 'New category…' })
  await macros.locator('#macro-category').fill('Maintenance')
  await macros.locator('#macro-category').press('Enter')

  await expect(macros.locator('[data-macro-category="Maintenance"] .macro-nav-item')).toHaveText(['Update OS'])
  await expect(macros.locator('#macro-category')).toHaveValue('Maintenance')

  await save(macros)
  await reopen(macros, 'Update OS')
  await expect(macros.locator('#macro-category')).toHaveValue('Maintenance')

  await macros.locator('#macro-category').selectOption({ label: 'No category' })
  await expect(macros.locator('[data-macro-category="Maintenance"]').getByText('Empty. Drag a macro here.')).toBeVisible()
})

test('drags a macro into a category and before another macro', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await macros.getByRole('button', { name: 'New category' }).click()
  await macros.getByLabel('Category name').fill('Agents')
  await macros.getByLabel('Category name').press('Enter')

  await libraryItem(macros, 'Create a pull request').dragTo(categoryHeader(macros, 'Agents'))
  await expect(macros.locator('[data-macro-category="Agents"] .macro-nav-item')).toHaveText(['Create a pull request'])

  // Dropped on a macro, it lands just before that macro and joins its category.
  await libraryItem(macros, 'Say hello to person').dragTo(libraryItem(macros, 'Create a pull request'))
  await expect(macros.locator('[data-macro-category="Agents"] .macro-nav-item')).toHaveText([
    'Say hello to person',
    'Create a pull request',
  ])

  // Alt+Arrow reorders within the category from the keyboard.
  await libraryItem(macros, 'Say hello to person').getByRole('button').focus()
  await macros.keyboard.press('Alt+ArrowDown')
  await expect(macros.locator('[data-macro-category="Agents"] .macro-nav-item')).toHaveText([
    'Create a pull request',
    'Say hello to person',
  ])

  await save(macros)
  await macros.reload()
  await expect(macros.locator('[data-macro-category="Agents"] .macro-nav-item')).toHaveText([
    'Create a pull request',
    'Say hello to person',
  ])
})

test('an empty category survives reopening the window', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await macros.getByRole('button', { name: 'New category' }).click()
  await macros.getByLabel('Category name').fill('Later')
  await macros.getByLabel('Category name').press('Enter')
  await expect(saveState(macros)).toHaveText('Unsaved category changes')
  await save(macros)

  await macros.reload()
  await expect(categoryHeader(macros, 'Later')).toBeVisible()
  await expect(macros.locator('[data-macro-category="Later"] .macro-nav-item')).toHaveCount(0)
})

test('the library filter matches names, categories and script text', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await macros.getByLabel('Filter macros').fill('apt-get upgrade')
  await expect(macros.locator('.macro-nav-item')).toHaveText(['Update OS'])
  await macros.getByLabel('Filter macros').fill('nothing matches this')
  await expect(macros.locator('.macro-nav-item')).toHaveCount(0)
  await expect(macros.getByText('No macro matches')).toBeVisible()
  await macros.getByLabel('Filter macros').fill('')
  await expect(macros.locator('.macro-nav-item')).toHaveCount(3)
})

test('a file field takes a typed path, a pasted file URL, and a dropped path', async ({ appHarness, mainWindow }) => {
  const macros = await appHarness.openMacrosWindow(mainWindow)

  await newMacro(macros, 'File Macro')
  await script(macros).first().fill('cat {{file}}')
  await inputRow(macros, 'file').getByLabel('Type for file').selectOption('file')
  const field = preview(macros).getByLabel(/File/)

  await field.fill('/tmp/typed.txt')
  await expect(sequence(macros).first()).toHaveText('cat /tmp/typed.txt')

  await deliver(field, 'paste', { 'text/plain': 'file:///Users/sam/notes%20a.md' })
  await expect(field).toHaveValue('/Users/sam/notes a.md')
  await expect(sequence(macros).first()).toHaveText('cat /Users/sam/notes a.md')

  await deliver(field, 'drop', { 'terminay/path': '/work/dropped file.md' })
  await expect(field).toHaveValue('/work/dropped file.md')

  // The run form's field accepts the same.
  await save(macros)
  await appHarness.openMacroLauncher(mainWindow)
  await mainWindow.getByRole('button', { name: 'File Macro' }).click()
  const runField = mainWindow.locator('.macro-file-field input')
  await deliver(runField, 'paste', { 'text/plain': 'file:///Users/sam/notes%20a.md' })
  await expect(runField).toHaveValue('/Users/sam/notes a.md')
  await deliver(runField, 'drop', { 'text/uri-list': 'file:///tmp/from%20drop.txt' })
  await expect(runField).toHaveValue('/tmp/from drop.txt')
  await runField.fill('/tmp/typed.txt')
  await expect(runField).toHaveValue('/tmp/typed.txt')
})

/**
 * A library written before categories existed: two macros share a name prefix,
 * and one still holds a step Terminay does not execute.
 */
const stored = test.extend({
  userDataDir: async ({ userDataDir }, use) => {
    const step = (id: string, content: string) => ({ id, type: 'type', content })
    await writeFile(
      path.join(userDataDir, 'server-macros.v1.json'),
      JSON.stringify({
        schemaVersion: 1,
        revision: 3,
        cursor: '3',
        macros: [
          { id: 'pr-create', title: 'pr:create', description: '', fields: [], steps: [step('a', 'Create a pull request.')] },
          { id: 'say', title: 'Say thing', description: '', fields: [], steps: [step('b', 'echo hi')] },
          { id: 'pr-green', title: 'pr:green', description: '', fields: [], steps: [step('c', 'Get the pull request green.')] },
          {
            id: 'sudo-deploy',
            title: 'Sudo deploy',
            description: '',
            fields: [],
            steps: [
              step('d', 'sudo deploy'),
              { id: 'e', type: 'key', key: 'Enter' },
              { id: 'f', type: 'secret', secretId: 'deploy-password' },
              { id: 'g', type: 'key', key: 'Enter' },
            ],
          },
        ],
      }),
    )
    await use(userDataDir)
  },
})

stored('a macro with an unsupported step is shown, cannot run, and runs once the step is removed', async ({ appHarness, mainWindow }) => {
  // The library loaded, and launching the macro is refused by name before anything is typed.
  await appHarness.openMacroLauncher(mainWindow)
  await mainWindow.getByRole('button', { name: 'Sudo deploy' }).click()
  await expect(mainWindow.locator('.error-banner__message')).toContainText('"Sudo deploy" contains a step Terminay cannot run')
  await expect(mainWindow.getByLabel(/Show macro queue/)).toHaveCount(0)

  const macros = await appHarness.openMacrosWindow(mainWindow)
  await libraryItem(macros, 'Sudo deploy').getByRole('button').click()
  await expect(token(macros, 'unsupported')).toHaveText(/This step \(secret\) cannot run\. Remove it to use the macro\./)
  await expect(preview(macros).getByRole('status')).toContainText('will not run until the step marked as unable to run is removed')
  await expect(macros.getByText('deploy-password')).toHaveCount(0)

  await token(macros, 'unsupported').getByRole('button', { name: 'Remove step' }).click()
  await expect(token(macros, 'unsupported')).toHaveCount(0)
  await save(macros)

  await appHarness.openMacroLauncher(mainWindow)
  await mainWindow.getByRole('button', { name: 'Sudo deploy' }).click()
  await expect(mainWindow.getByLabel(/Show macro queue \(1\)/)).toBeVisible()
})

stored('the Command Bar groups macros by category', async ({ appHarness, mainWindow }) => {
  // A shared name prefix became a category when the older library was read.
  await appHarness.openMacroLauncher(mainWindow)
  const launcher = mainWindow.getByRole('dialog', { name: 'Command bar' })
  const groupOf = (title: string) =>
    launcher.locator('[data-terminay-command-bar-group]', { has: mainWindow.getByRole('button', { name: title }) })

  await expect(groupOf('pr:create')).toHaveAttribute('data-terminay-command-bar-group', 'pr')
  await expect(groupOf('pr:green')).toHaveAttribute('data-terminay-command-bar-group', 'pr')
  await expect(groupOf('Say thing')).toHaveAttribute('data-terminay-command-bar-group', 'Macros')
  const headings = await launcher.locator('[data-terminay-command-bar-group]').evaluateAll((groups) =>
    groups.map((group) => group.getAttribute('data-terminay-command-bar-group')),
  )
  expect(headings.indexOf('pr')).toBeLessThan(headings.indexOf('Macros'))

  // While searching, a category with no match is not shown.
  await launcher.locator('.macro-launcher-input').fill('say thing')
  await expect(launcher.locator('[data-terminay-command-bar-group="pr"]')).toHaveCount(0)
  await expect(launcher.locator('[data-terminay-command-bar-group="Macros"]')).toHaveCount(1)
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

test('does not expose a host-local file search authority', async ({ createWorkspace, mainWindow }) => {
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
	await setProjectRoot(mainWindow, workspace.rootDir)
	await expect.poll(() => mainWindow.evaluate(() => 'terminayFileExplorerHost' in window)).toBe(false)
})
