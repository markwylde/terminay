import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { AppCommand } from './types/terminay'
import type { KeyboardShortcutSettings } from './types/settings'

type KeyboardLikeEvent = Pick<
  KeyboardEvent | ReactKeyboardEvent,
  'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'
>

export type AppCommandMetadata = {
  command: AppCommand
  title: string
  description: string
  keywords: string
}

export const appCommandMetadata: AppCommandMetadata[] = [
  {
    command: 'new-terminal',
    title: 'Create a new terminal tab',
    description: 'Open a fresh terminal tab in the current project.',
    keywords: 'create new terminal tab open fresh terminal shell',
  },
  {
    command: 'new-project',
    title: 'Create a new project',
    description: 'Add a new project tab and switch to it.',
    keywords: 'create new project add project tab workspace',
  },
  {
    command: 'clear-terminal',
    title: 'Clear terminal',
    description: 'Clear the active terminal viewport and scrollback.',
    keywords: 'clear terminal wipe scrollback screen reset',
  },
  {
    command: 'save-active',
    title: 'Save active tab',
    description: 'Save the active file tab when it has changes.',
    keywords: 'save active file tab write changes',
  },
  {
    command: 'open-recordings',
    title: 'Open recordings timeline',
    description: 'Browse and replay saved terminal recordings.',
    keywords: 'open recordings timeline terminal session replay asciinema cast history',
  },
  {
    command: 'split-horizontal',
    title: 'Split horizontally',
    description: 'Open a new terminal below the active tab.',
    keywords: 'split horizontal below terminal pane',
  },
  {
    command: 'split-vertical',
    title: 'Split vertically',
    description: 'Open a new terminal to the right of the active tab.',
    keywords: 'split vertical right terminal pane',
  },
  {
    command: 'popout-active',
    title: 'Pop out active tab',
    description: 'Move the active tab into its own window.',
    keywords: 'pop out active terminal tab window',
  },
  {
    command: 'close-active',
    title: 'Close active tab',
    description: 'Close the active terminal, file, or folder tab.',
    keywords: 'close active terminal file folder tab',
  },
  {
    command: 'open-command-bar',
    title: 'Open command bar',
    description: 'Search commands and macros.',
    keywords: 'open command bar launcher palette search commands macros',
  },
  {
    command: 'set-project-root-folder-to-working-directory',
    title: 'Set project root folder to working directory',
    description: 'Use the active terminal working directory as this project root folder.',
    keywords: 'set project root folder working directory cwd active terminal root folder',
  },
]

export const defaultKeyboardShortcuts: KeyboardShortcutSettings = {
  'new-terminal': 'CmdOrCtrl+T',
  'new-project': 'CmdOrCtrl+P',
  'clear-terminal': 'CmdOrCtrl+K',
  'open-recordings': '',
  'save-active': 'CmdOrCtrl+S',
  'split-horizontal': 'CmdOrCtrl+Shift+-',
  'split-vertical': 'CmdOrCtrl+Shift+\\',
  'popout-active': 'CmdOrCtrl+Shift+P',
  'close-active': 'CmdOrCtrl+W',
  'open-command-bar': 'CmdOrCtrl+L',
  'set-project-root-folder-to-working-directory': 'CmdOrCtrl+R',
}

const modifierAliases = new Map([
  ['cmd', 'CmdOrCtrl'],
  ['command', 'CmdOrCtrl'],
  ['commandorcontrol', 'CmdOrCtrl'],
  ['cmdorctrl', 'CmdOrCtrl'],
  ['ctrl', 'Ctrl'],
  ['control', 'Ctrl'],
  ['alt', 'Alt'],
  ['option', 'Alt'],
  ['shift', 'Shift'],
  ['meta', 'Meta'],
  ['super', 'Meta'],
])

const keyAliases = new Map([
  ['comma', ','],
  ['period', '.'],
  ['space', 'Space'],
  ['plus', '+'],
  ['minus', '-'],
  ['backslash', '\\'],
  ['slash', '/'],
  ['escape', 'Esc'],
  ['return', 'Enter'],
])

const displayModifierOrder = ['CmdOrCtrl', 'Ctrl', 'Alt', 'Shift', 'Meta'] as const
const ignoredCaptureKeys = new Set(['Alt', 'Control', 'Meta', 'Shift'])
const namedKeys = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Backspace',
  'Delete',
  'End',
  'Enter',
  'Esc',
  'Escape',
  'Home',
  'Insert',
  'PageDown',
  'PageUp',
  'Space',
  'Tab',
])

function splitAccelerator(accelerator: string): string[] {
  const placeholder = '\u0000'
  return accelerator
    .replace(/\+\+/g, `+${placeholder}`)
    .split('+')
    .map((part) => part.split(placeholder).join('+').trim())
    .filter(Boolean)
}

export function normalizeAccelerator(accelerator: string): string {
  const parts = splitAccelerator(accelerator)
  if (parts.length === 0) {
    return ''
  }

  const modifiers = new Set<string>()
  let key = ''

  for (const part of parts) {
    const normalizedPart = part.toLowerCase().replace(/[\s-]/g, '')
    const modifier = modifierAliases.get(normalizedPart)
    if (modifier) {
      modifiers.add(modifier)
      continue
    }

    key = keyAliases.get(normalizedPart) ?? part
  }

  const isValidKey =
    namedKeys.has(key) ||
    /^[a-z0-9]+$/i.test(key) ||
    /^[\x21-\x7e]$/.test(key)

  if (!key || !isValidKey) {
    return ''
  }

  const normalizedKey = key.length === 1 && /[a-z]/i.test(key) ? key.toUpperCase() : key
  return [...displayModifierOrder.filter((modifier) => modifiers.has(modifier)), normalizedKey].join('+')
}

export function acceleratorFromKeyboardEvent(event: KeyboardLikeEvent, isMac: boolean): string {
  if (ignoredCaptureKeys.has(event.key)) {
    return ''
  }

  if (isReservedSystemKeyboardEvent(event, isMac)) {
    return ''
  }

  const parts: string[] = []
  if (isMac ? event.metaKey : event.ctrlKey) {
    parts.push('CmdOrCtrl')
  }
  if (event.ctrlKey && (isMac || !parts.includes('CmdOrCtrl'))) {
    parts.push('Ctrl')
  }
  if (event.altKey) {
    parts.push('Alt')
  }
  if (event.shiftKey) {
    parts.push('Shift')
  }
  if (event.metaKey && (!isMac || !parts.includes('CmdOrCtrl'))) {
    parts.push('Meta')
  }

  const key = event.key === ' ' ? 'Space' : keyAliases.get(event.key.toLowerCase()) ?? event.key
  return normalizeAccelerator([...parts, key].join('+'))
}

export function getCommandShortcut(
  shortcuts: Partial<KeyboardShortcutSettings> | undefined,
  command: AppCommand,
): string {
  return normalizeAccelerator(shortcuts?.[command] ?? defaultKeyboardShortcuts[command] ?? '')
}

export function getCommandShortcutLabel(
  shortcuts: Partial<KeyboardShortcutSettings> | undefined,
  command: AppCommand,
  isMac: boolean,
): string {
  const shortcut = getCommandShortcut(shortcuts, command)
  if (!shortcut) {
    return ''
  }

  return shortcut
    .split('+')
    .map((part) => {
      if (part === 'CmdOrCtrl') return isMac ? '⌘' : 'Ctrl'
      if (part === 'Ctrl') return isMac ? '⌃' : 'Ctrl'
      if (part === 'Alt') return isMac ? '⌥' : 'Alt'
      if (part === 'Shift') return isMac ? '⇧' : 'Shift'
      if (part === 'Meta') return isMac ? '⌘' : 'Meta'
      if (part === 'Space') return 'Space'
      return part
    })
    .join(isMac ? '' : '+')
}

export function eventMatchesAccelerator(event: KeyboardLikeEvent, accelerator: string, isMac: boolean): boolean {
  const shortcut = normalizeAccelerator(accelerator)
  if (!shortcut) {
    return false
  }

  if (isReservedSystemAccelerator(shortcut, isMac)) {
    return false
  }

  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]
  if (!key) {
    return false
  }

  const requiresCmdOrCtrl = parts.includes('CmdOrCtrl')
  const requiresCtrl = parts.includes('Ctrl')
  const requiresAlt = parts.includes('Alt')
  const requiresShift = parts.includes('Shift')
  const requiresMeta = parts.includes('Meta')
  const shortcutModifierPressed = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey

  if (requiresCmdOrCtrl !== shortcutModifierPressed) return false
  if (requiresCtrl !== event.ctrlKey && !(requiresCmdOrCtrl && !isMac)) return false
  if (requiresMeta !== event.metaKey && !(requiresCmdOrCtrl && isMac)) return false
  if (requiresAlt !== event.altKey) return false
  if (requiresShift !== event.shiftKey) return false

  const eventKey = event.key === ' ' ? 'Space' : event.key
  return eventKey.toLowerCase() === key.toLowerCase()
}

export function isReservedSystemAccelerator(accelerator: string, isMac: boolean): boolean {
  if (!isMac) {
    return false
  }

  return normalizeAccelerator(accelerator) === 'CmdOrCtrl+Q'
}

function isReservedSystemKeyboardEvent(event: KeyboardLikeEvent, isMac: boolean): boolean {
  return isMac && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'q'
}

export function findCommandForKeyboardEvent(
  event: KeyboardLikeEvent,
  shortcuts: Partial<KeyboardShortcutSettings> | undefined,
  isMac: boolean,
): AppCommand | null {
  for (const { command } of appCommandMetadata) {
    if (eventMatchesAccelerator(event, getCommandShortcut(shortcuts, command), isMac)) {
      return command
    }
  }

  return null
}
