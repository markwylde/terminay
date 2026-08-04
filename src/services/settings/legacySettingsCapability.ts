import type { TerminalSettings } from '../../types/settings'

/**
 * The settings migration path is allowed to use these four host operations,
 * and nothing else. Capture the functions immediately so the compatibility
 * client never retains the broad preload object that supplied them.
 */
export type LegacySettingsApi = Readonly<{
  getTerminalSettings: () => Promise<TerminalSettings>
  updateTerminalSettings: (settings: TerminalSettings) => Promise<TerminalSettings>
  resetTerminalSettings: () => Promise<TerminalSettings>
  onTerminalSettingsChanged: (listener: (message: import('../../types/terminay').SettingsChangeMessage) => void) => () => void
}>

export function captureLegacySettingsCapability(api: LegacySettingsApi): LegacySettingsApi {
  const {
    getTerminalSettings,
    onTerminalSettingsChanged,
    resetTerminalSettings,
    updateTerminalSettings,
  } = api

  for (const [name, value] of Object.entries({
    getTerminalSettings,
    onTerminalSettingsChanged,
    resetTerminalSettings,
    updateTerminalSettings,
  })) {
    if (typeof value !== 'function') throw new TypeError(`legacy settings capability ${name} is unavailable`)
  }

  // Do not bind these functions to `api`: doing so would retain the complete
  // preload object. Electron's exposed functions are standalone capabilities,
  // and this explicit snapshot intentionally has no reference back to `api`.
  return Object.freeze({
    getTerminalSettings: () => getTerminalSettings(),
    onTerminalSettingsChanged: (listener) => onTerminalSettingsChanged(listener),
    resetTerminalSettings: () => resetTerminalSettings(),
    updateTerminalSettings: (settings) => updateTerminalSettings(settings),
  })
}
