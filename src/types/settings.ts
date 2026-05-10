import type { AppCommand } from './terminay'

export type KeyboardShortcutSettings = Record<AppCommand, string>

export type TerminalThemeSettings = {
  foreground: string
  background: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  selectionInactiveBackground: string
  selectionForeground: string
  scrollbarSliderBackground: string
  scrollbarSliderHoverBackground: string
  scrollbarSliderActiveBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export type ShellSettings = {
  program: string
  startupMode: 'auto' | 'login' | 'non-login'
  extraArgs: string
}

export type RemoteAccessSettings = {
  bindAddress: string
  origin: string
  pairingMode: 'lan' | 'webrtc'
  pairingPinHash: string
  tlsCertPath: string
  tlsKeyPath: string
  webRtcConnectUrl: string
}

export type AiTabMetadataProvider = 'disabled' | 'codex' | 'claudeCode'

export type AiTabMetadataTargetSettings = {
  provider: AiTabMetadataProvider
  claudeCodeModel: string
  codexModel: string
}

export type AiTabMetadataSettings = {
  title: AiTabMetadataTargetSettings
  note: AiTabMetadataTargetSettings
}

export type TerminalSettings = {
  aiTabMetadata: AiTabMetadataSettings
  allowTransparency: boolean
  altClickMovesCursor: boolean
  autoCloseTerminalOnExitZero: boolean
  convertEol: boolean
  cursorBlink: boolean
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorWidth: number
  cursorInactiveStyle: 'outline' | 'block' | 'bar' | 'underline' | 'none'
  customGlyphs: boolean
  disableStdin: boolean
  drawBoldTextInBrightColors: boolean
  fastScrollSensitivity: number
  fontFamily: string
  fontSize: number
  fontWeight: string
  fontWeightBold: string
  ignoreBracketedPasteMode: boolean
  letterSpacing: number
  lineHeight: number
  macOptionIsMeta: boolean
  macOptionClickForcesSelection: boolean
  minimumContrastRatio: number
  rescaleOverlappingGlyphs: boolean
  rightClickSelectsWord: boolean
  screenReaderMode: boolean
  scrollback: number
  scrollOnEraseInDisplay: boolean
  scrollOnUserInput: boolean
  scrollSensitivity: number
  smoothScrollDuration: number
  tabStopWidth: number
  wordSeparator: string
  keyboardShortcuts: KeyboardShortcutSettings
  remoteAccess: RemoteAccessSettings
  shell: ShellSettings
  theme: TerminalThemeSettings
}
