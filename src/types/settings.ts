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
  tlsCertPath: string
  tlsKeyPath: string
}

export type TerminalSettings = {
  allowTransparency: boolean
  altClickMovesCursor: boolean
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
  remoteAccess: RemoteAccessSettings
  shell: ShellSettings
  theme: TerminalThemeSettings
}
