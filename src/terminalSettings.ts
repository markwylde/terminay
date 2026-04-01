import type { FontWeight, ITerminalOptions } from '@xterm/xterm'
import type { TerminalSettings } from './types/settings'

type SettingsInputKind = 'boolean' | 'number' | 'text' | 'select' | 'color'

type SettingsCategoryId =
  | 'remote'
  | 'shell'
  | 'appearance'
  | 'cursor'
  | 'interaction'
  | 'scrolling'
  | 'accessibility'
  | 'theme'

export type SettingsFieldDefinition = {
  key: string
  label: string
  description: string
  sectionId: string
  categoryId: SettingsCategoryId
  input: SettingsInputKind
  min?: number
  max?: number
  step?: number
  options?: Array<{ label: string; value: string }>
  placeholder?: string
  keywords?: string[]
}

export type SettingsSectionDefinition = {
  id: string
  categoryId: SettingsCategoryId
  title: string
  description: string
  fields: SettingsFieldDefinition[]
}

export type SettingsCategoryDefinition = {
  id: SettingsCategoryId
  label: string
  description: string
}

export const terminalSettingsCategories: SettingsCategoryDefinition[] = [
  { id: 'remote', label: 'Remote Access', description: 'Remote host, local binding, and optional custom TLS files.' },
  { id: 'shell', label: 'Shell', description: 'Shell program, startup mode, and launch arguments.' },
  { id: 'appearance', label: 'Appearance', description: 'Typography, rendering, and visual density.' },
  { id: 'cursor', label: 'Cursor', description: 'Cursor style, width, and focus behavior.' },
  { id: 'interaction', label: 'Interaction', description: 'Input, selection, and keyboard behavior.' },
  { id: 'scrolling', label: 'Scrolling', description: 'Scrollback depth and scroll feel.' },
  { id: 'accessibility', label: 'Accessibility', description: 'Contrast, assistive tech, and readability.' },
  { id: 'theme', label: 'Theme', description: 'Base colors, selection, and ANSI palette.' },
]

export const defaultTerminalSettings: TerminalSettings = {
  allowTransparency: false,
  altClickMovesCursor: true,
  convertEol: true,
  cursorBlink: true,
  cursorStyle: 'block',
  cursorWidth: 1,
  cursorInactiveStyle: 'outline',
  customGlyphs: true,
  disableStdin: false,
  drawBoldTextInBrightColors: true,
  fastScrollSensitivity: 5,
  fontFamily: 'Menlo, Monaco, Consolas, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Liberation Mono", "Courier New", monospace',
  fontSize: 13,
  fontWeight: '400',
  fontWeightBold: '700',
  ignoreBracketedPasteMode: false,
  letterSpacing: 0,
  lineHeight: 1.25,
  macOptionIsMeta: false,
  macOptionClickForcesSelection: false,
  minimumContrastRatio: 1,
  rescaleOverlappingGlyphs: false,
  rightClickSelectsWord: false,
  screenReaderMode: false,
  scrollback: 5000,
  scrollOnEraseInDisplay: false,
  scrollOnUserInput: true,
  scrollSensitivity: 1,
  smoothScrollDuration: 0,
  tabStopWidth: 8,
  wordSeparator: ' ()[]{}\',"`',
  remoteAccess: {
    bindAddress: '0.0.0.0',
    origin: 'https://localhost:9443',
    tlsCertPath: '',
    tlsKeyPath: '',
  },
  shell: {
    program: '',
    startupMode: 'auto',
    extraArgs: '',
  },
  theme: {
    foreground: '#dce2f0',
    background: '#111316',
    cursor: '#6ac1ff',
    cursorAccent: '#111316',
    selectionBackground: '#32536b80',
    selectionInactiveBackground: '#2b3d4b66',
    selectionForeground: '#f8fbff',
    scrollbarSliderBackground: '#dce2f033',
    scrollbarSliderHoverBackground: '#dce2f066',
    scrollbarSliderActiveBackground: '#dce2f080',
    black: '#1b1e24',
    red: '#ff6a7a',
    green: '#66d28c',
    yellow: '#ffd166',
    blue: '#6ac1ff',
    magenta: '#d690ff',
    cyan: '#62e0d9',
    white: '#d8dee9',
    brightBlack: '#5a6576',
    brightRed: '#ff8a97',
    brightGreen: '#8df0a8',
    brightYellow: '#ffe39b',
    brightBlue: '#8ed6ff',
    brightMagenta: '#e4acff',
    brightCyan: '#87f2ec',
    brightWhite: '#f5f7fb',
  },
}

function makeField(definition: Omit<SettingsFieldDefinition, 'keywords'> & { keywords?: string[] }): SettingsFieldDefinition {
  return definition
}

export const terminalSettingsSections: SettingsSectionDefinition[] = [
  {
    id: 'remote-access-host',
    categoryId: 'remote',
    title: 'Host & Origin',
    description: 'Choose the HTTPS origin browsers will pair against and the local address Termide binds.',
    fields: [
      makeField({
        key: 'remoteAccess.origin',
        label: 'Remote origin',
        description: 'Exact HTTPS origin browsers use for pairing and remote terminal access. Defaults to https://localhost:9443 for local setup.',
        sectionId: 'remote-access-host',
        categoryId: 'remote',
        input: 'text',
        placeholder: 'https://termide.example.com',
        keywords: ['https', 'origin', 'hostname', 'domain', 'pairing', 'remote'],
      }),
      makeField({
        key: 'remoteAccess.bindAddress',
        label: 'Bind address',
        description: 'Local interface address to bind the HTTPS server to. The default 0.0.0.0 listens on all interfaces.',
        sectionId: 'remote-access-host',
        categoryId: 'remote',
        input: 'text',
        placeholder: '0.0.0.0',
        keywords: ['host', 'listen', 'bind', 'network', 'interface', '0.0.0.0'],
      }),
    ],
  },
  {
    id: 'remote-access-tls',
    categoryId: 'remote',
    title: 'TLS',
    description: 'Leave these blank to let Termide generate a self-signed certificate automatically.',
    fields: [
      makeField({
        key: 'remoteAccess.tlsCertPath',
        label: 'TLS certificate path',
        description: 'Optional absolute path to a PEM certificate or full chain. Leave blank to use an auto-generated self-signed cert.',
        sectionId: 'remote-access-tls',
        categoryId: 'remote',
        input: 'text',
        placeholder: '/etc/letsencrypt/live/termide.example.com/fullchain.pem',
        keywords: ['certificate', 'cert', 'pem', 'fullchain', 'https'],
      }),
      makeField({
        key: 'remoteAccess.tlsKeyPath',
        label: 'TLS private key path',
        description: 'Optional absolute path to the PEM private key. Leave blank to use an auto-generated self-signed cert.',
        sectionId: 'remote-access-tls',
        categoryId: 'remote',
        input: 'text',
        placeholder: '/etc/letsencrypt/live/termide.example.com/privkey.pem',
        keywords: ['private key', 'key', 'pem', 'tls', 'https'],
      }),
    ],
  },
  {
    id: 'shell-launch',
    categoryId: 'shell',
    title: 'Launch',
    description: 'Choose which shell to run and how Termide starts it.',
    fields: [
      makeField({
        key: 'shell.program',
        label: 'Shell program',
        description: 'Executable path or command name. Leave blank to use your system default shell.',
        sectionId: 'shell-launch',
        categoryId: 'shell',
        input: 'text',
        placeholder: '/bin/zsh',
        keywords: ['zsh', 'bash', 'fish', 'nushell', 'default shell', 'executable'],
      }),
      makeField({
        key: 'shell.startupMode',
        label: 'Startup mode',
        description: 'Auto uses a login shell on macOS so tools from Homebrew and other login PATH setup are available.',
        sectionId: 'shell-launch',
        categoryId: 'shell',
        input: 'select',
        options: [
          { label: 'Auto', value: 'auto' },
          { label: 'Login shell', value: 'login' },
          { label: 'Non-login shell', value: 'non-login' },
        ],
        keywords: ['login shell', 'path', 'homebrew', 'gh', 'zprofile'],
      }),
      makeField({
        key: 'shell.extraArgs',
        label: 'Extra arguments',
        description: 'Optional arguments appended after Termide-managed shell flags.',
        sectionId: 'shell-launch',
        categoryId: 'shell',
        input: 'text',
        placeholder: '--no-rcs',
        keywords: ['args', 'arguments', 'flags', 'rc'],
      }),
    ],
  },
  {
    id: 'typography',
    categoryId: 'appearance',
    title: 'Typography',
    description: 'Tune the typeface and text spacing used by the terminal.',
    fields: [
      makeField({
        key: 'fontFamily',
        label: 'Font family',
        description: 'Preferred font stack used to render terminal text.',
        sectionId: 'typography',
        categoryId: 'appearance',
        input: 'text',
        placeholder: 'Menlo, Monaco, Consolas, "Apple Color Emoji", monospace',
        keywords: ['typeface', 'font', 'mono'],
      }),
      makeField({
        key: 'fontSize',
        label: 'Font size',
        description: 'Base text size in pixels.',
        sectionId: 'typography',
        categoryId: 'appearance',
        input: 'number',
        min: 8,
        max: 32,
        step: 1,
      }),
      makeField({
        key: 'fontWeight',
        label: 'Font weight',
        description: 'Weight used for standard text.',
        sectionId: 'typography',
        categoryId: 'appearance',
        input: 'select',
        options: ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold'].map((value) => ({
          label: value,
          value,
        })),
      }),
      makeField({
        key: 'fontWeightBold',
        label: 'Bold font weight',
        description: 'Weight used when ANSI bold text is emitted.',
        sectionId: 'typography',
        categoryId: 'appearance',
        input: 'select',
        options: ['400', '500', '600', '700', '800', '900', 'bold'].map((value) => ({
          label: value,
          value,
        })),
      }),
      makeField({
        key: 'lineHeight',
        label: 'Line height',
        description: 'Vertical spacing multiplier for each text row.',
        sectionId: 'typography',
        categoryId: 'appearance',
        input: 'number',
        min: 1,
        max: 2,
        step: 0.05,
      }),
      makeField({
        key: 'letterSpacing',
        label: 'Letter spacing',
        description: 'Extra spacing between characters in pixels.',
        sectionId: 'typography',
        categoryId: 'appearance',
        input: 'number',
        min: -2,
        max: 10,
        step: 0.1,
      }),
    ],
  },
  {
    id: 'rendering',
    categoryId: 'appearance',
    title: 'Rendering',
    description: 'Adjust how glyphs and emphasis are drawn.',
    fields: [
      makeField({
        key: 'drawBoldTextInBrightColors',
        label: 'Bright bold ANSI colors',
        description: 'Render bold ANSI colors using their bright palette variants.',
        sectionId: 'rendering',
        categoryId: 'appearance',
        input: 'boolean',
      }),
      makeField({
        key: 'customGlyphs',
        label: 'Custom box drawing glyphs',
        description: 'Use xterm.js custom rendering for line art and block glyphs.',
        sectionId: 'rendering',
        categoryId: 'appearance',
        input: 'boolean',
      }),
      makeField({
        key: 'rescaleOverlappingGlyphs',
        label: 'Rescale overlapping glyphs',
        description: 'Improve ambiguous-width glyph rendering for some font combinations.',
        sectionId: 'rendering',
        categoryId: 'appearance',
        input: 'boolean',
      }),
      makeField({
        key: 'allowTransparency',
        label: 'Transparent background support',
        description: 'Allow semi-transparent terminal backgrounds and overlays.',
        sectionId: 'rendering',
        categoryId: 'appearance',
        input: 'boolean',
      }),
    ],
  },
  {
    id: 'cursor-shape',
    categoryId: 'cursor',
    title: 'Cursor',
    description: 'Choose how the caret looks and behaves when focused.',
    fields: [
      makeField({
        key: 'cursorStyle',
        label: 'Cursor style',
        description: 'Visual shape of the active cursor.',
        sectionId: 'cursor-shape',
        categoryId: 'cursor',
        input: 'select',
        options: [
          { label: 'Block', value: 'block' },
          { label: 'Underline', value: 'underline' },
          { label: 'Bar', value: 'bar' },
        ],
      }),
      makeField({
        key: 'cursorInactiveStyle',
        label: 'Inactive cursor style',
        description: 'How the cursor appears when the terminal loses focus.',
        sectionId: 'cursor-shape',
        categoryId: 'cursor',
        input: 'select',
        options: [
          { label: 'Outline', value: 'outline' },
          { label: 'Block', value: 'block' },
          { label: 'Bar', value: 'bar' },
          { label: 'Underline', value: 'underline' },
          { label: 'Hidden', value: 'none' },
        ],
      }),
      makeField({
        key: 'cursorBlink',
        label: 'Blinking cursor',
        description: 'Animate the cursor when the terminal is focused.',
        sectionId: 'cursor-shape',
        categoryId: 'cursor',
        input: 'boolean',
      }),
      makeField({
        key: 'cursorWidth',
        label: 'Bar cursor width',
        description: 'Width used for the bar cursor style in CSS pixels.',
        sectionId: 'cursor-shape',
        categoryId: 'cursor',
        input: 'number',
        min: 1,
        max: 8,
        step: 1,
      }),
    ],
  },
  {
    id: 'input',
    categoryId: 'interaction',
    title: 'Input & Keyboard',
    description: 'Control how typing, paste, and modifier keys behave.',
    fields: [
      makeField({
        key: 'disableStdin',
        label: 'Read-only terminal input',
        description: 'Prevent keyboard input from being sent to the shell.',
        sectionId: 'input',
        categoryId: 'interaction',
        input: 'boolean',
      }),
      makeField({
        key: 'convertEol',
        label: 'Convert LF to CRLF',
        description: 'Translate line feeds to carriage return plus line feed on write.',
        sectionId: 'input',
        categoryId: 'interaction',
        input: 'boolean',
      }),
      makeField({
        key: 'ignoreBracketedPasteMode',
        label: 'Ignore bracketed paste mode',
        description: 'Paste plain text even when the shell requests bracketed paste.',
        sectionId: 'input',
        categoryId: 'interaction',
        input: 'boolean',
      }),
      makeField({
        key: 'tabStopWidth',
        label: 'Tab stop width',
        description: 'Spaces between tab stops.',
        sectionId: 'input',
        categoryId: 'interaction',
        input: 'number',
        min: 1,
        max: 16,
        step: 1,
      }),
    ],
  },
  {
    id: 'selection',
    categoryId: 'interaction',
    title: 'Selection & Mouse',
    description: 'Tune mouse behavior and text selection rules.',
    fields: [
      makeField({
        key: 'altClickMovesCursor',
        label: 'Alt-click moves cursor',
        description: 'Move the shell cursor to the mouse position when supported.',
        sectionId: 'selection',
        categoryId: 'interaction',
        input: 'boolean',
      }),
      makeField({
        key: 'rightClickSelectsWord',
        label: 'Right-click selects word',
        description: 'Select the word under the pointer on right click.',
        sectionId: 'selection',
        categoryId: 'interaction',
        input: 'boolean',
      }),
      makeField({
        key: 'macOptionIsMeta',
        label: 'Treat Option as Meta',
        description: 'Use the macOS Option key as the terminal Meta modifier.',
        sectionId: 'selection',
        categoryId: 'interaction',
        input: 'boolean',
      }),
      makeField({
        key: 'macOptionClickForcesSelection',
        label: 'Option-click forces selection',
        description: 'Allow regular selection while apps like tmux capture mouse events.',
        sectionId: 'selection',
        categoryId: 'interaction',
        input: 'boolean',
      }),
      makeField({
        key: 'wordSeparator',
        label: 'Word separators',
        description: 'Characters that split words during double-click selection.',
        sectionId: 'selection',
        categoryId: 'interaction',
        input: 'text',
      }),
    ],
  },
  {
    id: 'history',
    categoryId: 'scrolling',
    title: 'Scrollback',
    description: 'Decide how much history stays available and how the viewport reacts.',
    fields: [
      makeField({
        key: 'scrollback',
        label: 'Scrollback lines',
        description: 'Number of lines preserved above the viewport.',
        sectionId: 'history',
        categoryId: 'scrolling',
        input: 'number',
        min: 0,
        max: 500000,
        step: 100,
      }),
      makeField({
        key: 'scrollOnUserInput',
        label: 'Scroll to bottom on input',
        description: 'Jump back to the latest prompt whenever you type.',
        sectionId: 'history',
        categoryId: 'scrolling',
        input: 'boolean',
      }),
      makeField({
        key: 'scrollOnEraseInDisplay',
        label: 'Push clears into scrollback',
        description: 'Preserve clear-screen output in scrollback history.',
        sectionId: 'history',
        categoryId: 'scrolling',
        input: 'boolean',
      }),
    ],
  },
  {
    id: 'scroll-feel',
    categoryId: 'scrolling',
    title: 'Scroll Feel',
    description: 'Match trackpad, wheel, and animated scrolling to your preference.',
    fields: [
      makeField({
        key: 'scrollSensitivity',
        label: 'Scroll sensitivity',
        description: 'Multiplier applied to standard wheel and trackpad scrolling.',
        sectionId: 'scroll-feel',
        categoryId: 'scrolling',
        input: 'number',
        min: 0.1,
        max: 10,
        step: 0.1,
      }),
      makeField({
        key: 'fastScrollSensitivity',
        label: 'Fast scroll sensitivity',
        description: 'Multiplier used while holding Alt during scroll.',
        sectionId: 'scroll-feel',
        categoryId: 'scrolling',
        input: 'number',
        min: 0.1,
        max: 20,
        step: 0.1,
      }),
      makeField({
        key: 'smoothScrollDuration',
        label: 'Smooth scroll duration',
        description: 'Animation time in milliseconds for viewport scrolling.',
        sectionId: 'scroll-feel',
        categoryId: 'scrolling',
        input: 'number',
        min: 0,
        max: 2000,
        step: 10,
      }),
    ],
  },
  {
    id: 'readability',
    categoryId: 'accessibility',
    title: 'Readability',
    description: 'Improve contrast and assistive technology support.',
    fields: [
      makeField({
        key: 'minimumContrastRatio',
        label: 'Minimum contrast ratio',
        description: 'Adjust text colors dynamically to preserve readability.',
        sectionId: 'readability',
        categoryId: 'accessibility',
        input: 'number',
        min: 1,
        max: 21,
        step: 0.5,
      }),
      makeField({
        key: 'screenReaderMode',
        label: 'Screen reader mode',
        description: 'Expose extra accessibility affordances for assistive technology.',
        sectionId: 'readability',
        categoryId: 'accessibility',
        input: 'boolean',
      }),
    ],
  },
  {
    id: 'surface',
    categoryId: 'theme',
    title: 'Surface',
    description: 'Core canvas, selection, and scrollbar colors.',
    fields: [
      { key: 'theme.foreground', label: 'Foreground', description: 'Default text color.', sectionId: 'surface', categoryId: 'theme', input: 'color' },
      { key: 'theme.background', label: 'Background', description: 'Default terminal background color.', sectionId: 'surface', categoryId: 'theme', input: 'color' },
      { key: 'theme.cursor', label: 'Cursor', description: 'Active cursor color.', sectionId: 'surface', categoryId: 'theme', input: 'color' },
      { key: 'theme.cursorAccent', label: 'Cursor accent', description: 'Text color inside a block cursor.', sectionId: 'surface', categoryId: 'theme', input: 'color' },
      { key: 'theme.selectionBackground', label: 'Selection', description: 'Selection highlight color.', sectionId: 'surface', categoryId: 'theme', input: 'color' },
      { key: 'theme.selectionInactiveBackground', label: 'Inactive selection', description: 'Selection color when the terminal is unfocused.', sectionId: 'surface', categoryId: 'theme', input: 'color' },
      { key: 'theme.selectionForeground', label: 'Selection text', description: 'Text color while selected.', sectionId: 'surface', categoryId: 'theme', input: 'color' },
      { key: 'theme.scrollbarSliderBackground', label: 'Scrollbar', description: 'Scrollbar thumb color.', sectionId: 'surface', categoryId: 'theme', input: 'color' },
      { key: 'theme.scrollbarSliderHoverBackground', label: 'Scrollbar hover', description: 'Scrollbar thumb hover color.', sectionId: 'surface', categoryId: 'theme', input: 'color' },
      { key: 'theme.scrollbarSliderActiveBackground', label: 'Scrollbar active', description: 'Scrollbar thumb pressed color.', sectionId: 'surface', categoryId: 'theme', input: 'color' },
    ],
  },
  {
    id: 'ansi-normal',
    categoryId: 'theme',
    title: 'ANSI Colors',
    description: 'Standard 16-color ANSI palette used by terminal output.',
    fields: [
      { key: 'theme.black', label: 'Black', description: 'ANSI black.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.red', label: 'Red', description: 'ANSI red.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.green', label: 'Green', description: 'ANSI green.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.yellow', label: 'Yellow', description: 'ANSI yellow.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.blue', label: 'Blue', description: 'ANSI blue.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.magenta', label: 'Magenta', description: 'ANSI magenta.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.cyan', label: 'Cyan', description: 'ANSI cyan.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.white', label: 'White', description: 'ANSI white.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.brightBlack', label: 'Bright black', description: 'Bright ANSI black.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.brightRed', label: 'Bright red', description: 'Bright ANSI red.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.brightGreen', label: 'Bright green', description: 'Bright ANSI green.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.brightYellow', label: 'Bright yellow', description: 'Bright ANSI yellow.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.brightBlue', label: 'Bright blue', description: 'Bright ANSI blue.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.brightMagenta', label: 'Bright magenta', description: 'Bright ANSI magenta.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.brightCyan', label: 'Bright cyan', description: 'Bright ANSI cyan.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
      { key: 'theme.brightWhite', label: 'Bright white', description: 'Bright ANSI white.', sectionId: 'ansi-normal', categoryId: 'theme', input: 'color' },
    ],
  },
]

export function buildTerminalOptions(settings: TerminalSettings): ITerminalOptions {
  return {
    allowTransparency: settings.allowTransparency,
    altClickMovesCursor: settings.altClickMovesCursor,
    convertEol: settings.convertEol,
    cursorBlink: settings.cursorBlink,
    cursorStyle: settings.cursorStyle,
    cursorWidth: settings.cursorWidth,
    cursorInactiveStyle: settings.cursorInactiveStyle,
    customGlyphs: settings.customGlyphs,
    disableStdin: settings.disableStdin,
    drawBoldTextInBrightColors: settings.drawBoldTextInBrightColors,
    fastScrollSensitivity: settings.fastScrollSensitivity,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    fontWeight: settings.fontWeight as FontWeight,
    fontWeightBold: settings.fontWeightBold as FontWeight,
    ignoreBracketedPasteMode: settings.ignoreBracketedPasteMode,
    letterSpacing: settings.letterSpacing,
    lineHeight: settings.lineHeight,
    macOptionIsMeta: settings.macOptionIsMeta,
    macOptionClickForcesSelection: settings.macOptionClickForcesSelection,
    minimumContrastRatio: settings.minimumContrastRatio,
    rescaleOverlappingGlyphs: settings.rescaleOverlappingGlyphs,
    rightClickSelectsWord: settings.rightClickSelectsWord,
    screenReaderMode: settings.screenReaderMode,
    scrollback: settings.scrollback,
    scrollOnEraseInDisplay: settings.scrollOnEraseInDisplay,
    scrollOnUserInput: settings.scrollOnUserInput,
    scrollSensitivity: settings.scrollSensitivity,
    smoothScrollDuration: settings.smoothScrollDuration,
    tabStopWidth: settings.tabStopWidth,
    wordSeparator: settings.wordSeparator,
    theme: settings.theme,
  }
}

function clampNumber(value: number, fallback: number, min?: number, max?: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }

  const minApplied = min === undefined ? value : Math.max(min, value)
  return max === undefined ? minApplied : Math.min(max, minApplied)
}

export function normalizeTerminalSettings(candidate: unknown): TerminalSettings {
  const input = typeof candidate === 'object' && candidate !== null ? (candidate as Partial<TerminalSettings>) : {}
  const remoteAccessInput =
    typeof input.remoteAccess === 'object' && input.remoteAccess !== null
      ? input.remoteAccess
      : defaultTerminalSettings.remoteAccess
  const themeInput =
    typeof input.theme === 'object' && input.theme !== null
      ? (input.theme as Partial<TerminalSettings['theme']>)
      : {}

  return {
    allowTransparency: typeof input.allowTransparency === 'boolean' ? input.allowTransparency : defaultTerminalSettings.allowTransparency,
    altClickMovesCursor: typeof input.altClickMovesCursor === 'boolean' ? input.altClickMovesCursor : defaultTerminalSettings.altClickMovesCursor,
    convertEol: typeof input.convertEol === 'boolean' ? input.convertEol : defaultTerminalSettings.convertEol,
    cursorBlink: typeof input.cursorBlink === 'boolean' ? input.cursorBlink : defaultTerminalSettings.cursorBlink,
    cursorStyle: input.cursorStyle === 'underline' || input.cursorStyle === 'bar' ? input.cursorStyle : defaultTerminalSettings.cursorStyle,
    cursorWidth: clampNumber(Number(input.cursorWidth), defaultTerminalSettings.cursorWidth, 1, 8),
    cursorInactiveStyle:
      input.cursorInactiveStyle === 'block' ||
      input.cursorInactiveStyle === 'bar' ||
      input.cursorInactiveStyle === 'underline' ||
      input.cursorInactiveStyle === 'none'
        ? input.cursorInactiveStyle
        : defaultTerminalSettings.cursorInactiveStyle,
    customGlyphs: typeof input.customGlyphs === 'boolean' ? input.customGlyphs : defaultTerminalSettings.customGlyphs,
    disableStdin: typeof input.disableStdin === 'boolean' ? input.disableStdin : defaultTerminalSettings.disableStdin,
    drawBoldTextInBrightColors:
      typeof input.drawBoldTextInBrightColors === 'boolean'
        ? input.drawBoldTextInBrightColors
        : defaultTerminalSettings.drawBoldTextInBrightColors,
    fastScrollSensitivity: clampNumber(Number(input.fastScrollSensitivity), defaultTerminalSettings.fastScrollSensitivity, 0.1, 20),
    fontFamily: typeof input.fontFamily === 'string' && input.fontFamily.trim().length > 0 ? input.fontFamily : defaultTerminalSettings.fontFamily,
    fontSize: clampNumber(Number(input.fontSize), defaultTerminalSettings.fontSize, 8, 32),
    fontWeight: typeof input.fontWeight === 'string' && input.fontWeight.trim().length > 0 ? input.fontWeight : defaultTerminalSettings.fontWeight,
    fontWeightBold:
      typeof input.fontWeightBold === 'string' && input.fontWeightBold.trim().length > 0
        ? input.fontWeightBold
        : defaultTerminalSettings.fontWeightBold,
    ignoreBracketedPasteMode:
      typeof input.ignoreBracketedPasteMode === 'boolean'
        ? input.ignoreBracketedPasteMode
        : defaultTerminalSettings.ignoreBracketedPasteMode,
    letterSpacing: clampNumber(Number(input.letterSpacing), defaultTerminalSettings.letterSpacing, -2, 10),
    lineHeight: clampNumber(Number(input.lineHeight), defaultTerminalSettings.lineHeight, 1, 2),
    macOptionIsMeta: typeof input.macOptionIsMeta === 'boolean' ? input.macOptionIsMeta : defaultTerminalSettings.macOptionIsMeta,
    macOptionClickForcesSelection:
      typeof input.macOptionClickForcesSelection === 'boolean'
        ? input.macOptionClickForcesSelection
        : defaultTerminalSettings.macOptionClickForcesSelection,
    minimumContrastRatio: clampNumber(Number(input.minimumContrastRatio), defaultTerminalSettings.minimumContrastRatio, 1, 21),
    rescaleOverlappingGlyphs:
      typeof input.rescaleOverlappingGlyphs === 'boolean'
        ? input.rescaleOverlappingGlyphs
        : defaultTerminalSettings.rescaleOverlappingGlyphs,
    rightClickSelectsWord:
      typeof input.rightClickSelectsWord === 'boolean'
        ? input.rightClickSelectsWord
        : defaultTerminalSettings.rightClickSelectsWord,
    screenReaderMode: typeof input.screenReaderMode === 'boolean' ? input.screenReaderMode : defaultTerminalSettings.screenReaderMode,
    scrollback: clampNumber(Number(input.scrollback), defaultTerminalSettings.scrollback, 0, 500000),
    scrollOnEraseInDisplay:
      typeof input.scrollOnEraseInDisplay === 'boolean'
        ? input.scrollOnEraseInDisplay
        : defaultTerminalSettings.scrollOnEraseInDisplay,
    scrollOnUserInput:
      typeof input.scrollOnUserInput === 'boolean' ? input.scrollOnUserInput : defaultTerminalSettings.scrollOnUserInput,
    scrollSensitivity: clampNumber(Number(input.scrollSensitivity), defaultTerminalSettings.scrollSensitivity, 0.1, 10),
    smoothScrollDuration: clampNumber(Number(input.smoothScrollDuration), defaultTerminalSettings.smoothScrollDuration, 0, 2000),
    tabStopWidth: clampNumber(Number(input.tabStopWidth), defaultTerminalSettings.tabStopWidth, 1, 16),
    wordSeparator: typeof input.wordSeparator === 'string' ? input.wordSeparator : defaultTerminalSettings.wordSeparator,
    remoteAccess: {
      bindAddress:
        typeof remoteAccessInput.bindAddress === 'string' && remoteAccessInput.bindAddress.trim().length > 0
          ? remoteAccessInput.bindAddress
          : defaultTerminalSettings.remoteAccess.bindAddress,
      origin: typeof remoteAccessInput.origin === 'string' ? remoteAccessInput.origin : defaultTerminalSettings.remoteAccess.origin,
      tlsCertPath:
        typeof remoteAccessInput.tlsCertPath === 'string'
          ? remoteAccessInput.tlsCertPath
          : defaultTerminalSettings.remoteAccess.tlsCertPath,
      tlsKeyPath:
        typeof remoteAccessInput.tlsKeyPath === 'string'
          ? remoteAccessInput.tlsKeyPath
          : defaultTerminalSettings.remoteAccess.tlsKeyPath,
    },
    shell: {
      program:
        typeof input.shell === 'object' &&
        input.shell !== null &&
        typeof input.shell.program === 'string'
          ? input.shell.program.trim()
          : defaultTerminalSettings.shell.program,
      startupMode:
        typeof input.shell === 'object' &&
        input.shell !== null &&
        (input.shell.startupMode === 'auto' || input.shell.startupMode === 'login' || input.shell.startupMode === 'non-login')
          ? input.shell.startupMode
          : defaultTerminalSettings.shell.startupMode,
      extraArgs:
        typeof input.shell === 'object' &&
        input.shell !== null &&
        typeof input.shell.extraArgs === 'string'
          ? input.shell.extraArgs
          : defaultTerminalSettings.shell.extraArgs,
    },
    theme: {
      foreground: typeof themeInput.foreground === 'string' ? themeInput.foreground : defaultTerminalSettings.theme.foreground,
      background: typeof themeInput.background === 'string' ? themeInput.background : defaultTerminalSettings.theme.background,
      cursor: typeof themeInput.cursor === 'string' ? themeInput.cursor : defaultTerminalSettings.theme.cursor,
      cursorAccent: typeof themeInput.cursorAccent === 'string' ? themeInput.cursorAccent : defaultTerminalSettings.theme.cursorAccent,
      selectionBackground:
        typeof themeInput.selectionBackground === 'string'
          ? themeInput.selectionBackground
          : defaultTerminalSettings.theme.selectionBackground,
      selectionInactiveBackground:
        typeof themeInput.selectionInactiveBackground === 'string'
          ? themeInput.selectionInactiveBackground
          : defaultTerminalSettings.theme.selectionInactiveBackground,
      selectionForeground:
        typeof themeInput.selectionForeground === 'string'
          ? themeInput.selectionForeground
          : defaultTerminalSettings.theme.selectionForeground,
      scrollbarSliderBackground:
        typeof themeInput.scrollbarSliderBackground === 'string'
          ? themeInput.scrollbarSliderBackground
          : defaultTerminalSettings.theme.scrollbarSliderBackground,
      scrollbarSliderHoverBackground:
        typeof themeInput.scrollbarSliderHoverBackground === 'string'
          ? themeInput.scrollbarSliderHoverBackground
          : defaultTerminalSettings.theme.scrollbarSliderHoverBackground,
      scrollbarSliderActiveBackground:
        typeof themeInput.scrollbarSliderActiveBackground === 'string'
          ? themeInput.scrollbarSliderActiveBackground
          : defaultTerminalSettings.theme.scrollbarSliderActiveBackground,
      black: typeof themeInput.black === 'string' ? themeInput.black : defaultTerminalSettings.theme.black,
      red: typeof themeInput.red === 'string' ? themeInput.red : defaultTerminalSettings.theme.red,
      green: typeof themeInput.green === 'string' ? themeInput.green : defaultTerminalSettings.theme.green,
      yellow: typeof themeInput.yellow === 'string' ? themeInput.yellow : defaultTerminalSettings.theme.yellow,
      blue: typeof themeInput.blue === 'string' ? themeInput.blue : defaultTerminalSettings.theme.blue,
      magenta: typeof themeInput.magenta === 'string' ? themeInput.magenta : defaultTerminalSettings.theme.magenta,
      cyan: typeof themeInput.cyan === 'string' ? themeInput.cyan : defaultTerminalSettings.theme.cyan,
      white: typeof themeInput.white === 'string' ? themeInput.white : defaultTerminalSettings.theme.white,
      brightBlack:
        typeof themeInput.brightBlack === 'string' ? themeInput.brightBlack : defaultTerminalSettings.theme.brightBlack,
      brightRed: typeof themeInput.brightRed === 'string' ? themeInput.brightRed : defaultTerminalSettings.theme.brightRed,
      brightGreen:
        typeof themeInput.brightGreen === 'string' ? themeInput.brightGreen : defaultTerminalSettings.theme.brightGreen,
      brightYellow:
        typeof themeInput.brightYellow === 'string' ? themeInput.brightYellow : defaultTerminalSettings.theme.brightYellow,
      brightBlue:
        typeof themeInput.brightBlue === 'string' ? themeInput.brightBlue : defaultTerminalSettings.theme.brightBlue,
      brightMagenta:
        typeof themeInput.brightMagenta === 'string'
          ? themeInput.brightMagenta
          : defaultTerminalSettings.theme.brightMagenta,
      brightCyan:
        typeof themeInput.brightCyan === 'string' ? themeInput.brightCyan : defaultTerminalSettings.theme.brightCyan,
      brightWhite:
        typeof themeInput.brightWhite === 'string' ? themeInput.brightWhite : defaultTerminalSettings.theme.brightWhite,
    },
  }
}
