import { expect, test } from './fixtures'
import { openChildWindow, openMacroLauncher } from './support/app'
import {
  acceleratorFromKeyboardEvent,
  eventMatchesAccelerator,
  findCommandForKeyboardEvent,
  getCommandShortcut,
  getCommandShortcutLabel,
  normalizeAccelerator,
} from '../src/keyboardShortcuts'

test.describe('keyboard shortcut utilities', () => {
  test('normalizes accelerator aliases and key names', () => {
    expect(normalizeAccelerator('cmd + shift + minus')).toBe('CmdOrCtrl+Shift+-')
    expect(normalizeAccelerator('control + option + space')).toBe('Ctrl+Alt+Space')
    expect(normalizeAccelerator('CmdOrCtrl++')).toBe('CmdOrCtrl++')
    expect(normalizeAccelerator('return')).toBe('Enter')
    expect(normalizeAccelerator('CmdOrCtrl')).toBe('')
    expect(normalizeAccelerator('CmdOrCtrl+☃')).toBe('')
  })

  test('captures accelerators from keyboard events with platform-aware command modifiers', () => {
    expect(
      acceleratorFromKeyboardEvent(
        { altKey: false, ctrlKey: false, key: 'k', metaKey: true, shiftKey: true },
        true,
      ),
    ).toBe('CmdOrCtrl+Shift+K')

    expect(
      acceleratorFromKeyboardEvent(
        { altKey: true, ctrlKey: true, key: ' ', metaKey: false, shiftKey: false },
        false,
      ),
    ).toBe('CmdOrCtrl+Alt+Space')

    expect(
      acceleratorFromKeyboardEvent(
        { altKey: false, ctrlKey: false, key: 'Shift', metaKey: false, shiftKey: true },
        false,
      ),
    ).toBe('')
  })

  test('formats shortcut labels for mac and non-mac platforms', () => {
    expect(getCommandShortcutLabel(undefined, 'new-terminal', true)).toBe('⌘T')
    expect(getCommandShortcutLabel(undefined, 'new-terminal', false)).toBe('Ctrl+T')
    expect(getCommandShortcutLabel(undefined, 'start-dictation', true)).toBe('⌘⇧D')
    expect(getCommandShortcutLabel(undefined, 'start-dictation', false)).toBe('Ctrl+Shift+D')
    expect(getCommandShortcutLabel(undefined, 'toggle-file-explorer-sidebar', true)).toBe('⌘O')
    expect(getCommandShortcutLabel({ 'new-terminal': 'Ctrl+Alt+Space' }, 'new-terminal', true)).toBe('⌃⌥Space')
    expect(getCommandShortcutLabel({ 'new-terminal': '' }, 'new-terminal', false)).toBe('')
  })

  test('matches keyboard events against accelerators exactly', () => {
    expect(
      eventMatchesAccelerator(
        { altKey: false, ctrlKey: false, key: 't', metaKey: true, shiftKey: false },
        'CmdOrCtrl+T',
        true,
      ),
    ).toBe(true)

    expect(
      eventMatchesAccelerator(
        { altKey: false, ctrlKey: true, key: 't', metaKey: false, shiftKey: false },
        'CmdOrCtrl+T',
        false,
      ),
    ).toBe(true)

    expect(
      eventMatchesAccelerator(
        { altKey: false, ctrlKey: true, key: 't', metaKey: false, shiftKey: true },
        'CmdOrCtrl+T',
        false,
      ),
    ).toBe(false)
  })

  test('finds commands from customized shortcuts and respects disabled shortcuts', () => {
    expect(getCommandShortcut({ 'new-terminal': 'cmd+y' }, 'new-terminal')).toBe('CmdOrCtrl+Y')
    expect(getCommandShortcut({ 'new-terminal': '' }, 'new-terminal')).toBe('')

    expect(
      findCommandForKeyboardEvent(
        { altKey: false, ctrlKey: true, key: 'y', metaKey: false, shiftKey: false },
        { 'new-terminal': 'CmdOrCtrl+Y' },
        false,
      ),
    ).toBe('new-terminal')

    expect(
      findCommandForKeyboardEvent(
        { altKey: false, ctrlKey: true, key: 't', metaKey: false, shiftKey: false },
        { 'new-terminal': '' },
        false,
      ),
    ).toBeNull()
  })

  test('finds the default dictation shortcut', () => {
    expect(
      findCommandForKeyboardEvent(
        { altKey: false, ctrlKey: true, key: 'd', metaKey: false, shiftKey: true },
        undefined,
        false,
      ),
    ).toBe('start-dictation')
  })

  test('opens Macros with CmdOrCtrl+; by default', () => {
    expect(getCommandShortcut(undefined, 'open-macros')).toBe('CmdOrCtrl+;')
    expect(
      findCommandForKeyboardEvent(
        { altKey: false, ctrlKey: true, key: ';', metaKey: false, shiftKey: false },
        undefined,
        false,
      ),
    ).toBe('open-macros')
  })
})

test('the Macros shortcut opens Settings at Macros', async ({ electronApp, mainWindow }) => {
  const isMac = await mainWindow.evaluate(() => navigator.userAgent.includes('Mac'))
  await mainWindow.locator('.project-workspace--active .terminal-panel').first().click()
  const settings = await openChildWindow(electronApp, () =>
    mainWindow.keyboard.press(isMac ? 'Meta+;' : 'Control+;'),
  )
  await expect(settings.locator('.settings-nav-item--active')).toContainText('Macros')
  await expect(settings.getByRole('button', { name: 'New macro', exact: true })).toBeVisible()
})

test('the Command Bar finds each Settings entry', async ({ mainWindow }) => {
  await openMacroLauncher(mainWindow)
  const commandBar = mainWindow.getByRole('dialog', { name: 'Command bar' })
  const search = mainWindow.getByPlaceholder('Search commands...')
  for (const [query, title] of [
    ['settings', 'Settings'],
    ['remote access', 'Remote Access'],
    ['macros', 'Macros'],
    ['extensions', 'Extensions'],
  ] as const) {
    await search.fill(query)
    await expect(
      commandBar.locator('.macro-launcher-item-title', { hasText: new RegExp(`^${title}$`) }).first(),
    ).toBeVisible()
  }
})
