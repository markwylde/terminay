import { expect, test } from './fixtures'
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
})
