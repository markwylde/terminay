import type { MacroDefinition, SecretDefinition } from '../../types/macros'

/**
 * The Desktop macro-settings compatibility hook needs only this bounded read
 * and change-notification surface. Snapshot it before React retains anything
 * so the hook cannot keep the broad preload object as a second authority.
 */
export type LegacyMacroSettingsApi = Readonly<{
  deleteSecret: (id: string) => Promise<void>
  getDecryptedSecret: (id: string) => Promise<string>
  getMacros: () => Promise<MacroDefinition[]>
  getSecrets: () => Promise<SecretDefinition[]>
  resetMacros: () => Promise<MacroDefinition[]>
  saveSecret: (name: string, value: string) => Promise<SecretDefinition>
  updateMacros: (macros: MacroDefinition[]) => Promise<MacroDefinition[]>
  onMacrosChanged: (listener: (message: { readonly macros: MacroDefinition[] }) => void) => () => void
}>

export type LegacyMacroSettingsCapability = Readonly<{
  getMacros: () => Promise<MacroDefinition[]>
  getSecrets: () => Promise<SecretDefinition[]>
  getDecryptedSecret: (id: string) => Promise<string>
  saveSecret: (name: string, value: string) => Promise<SecretDefinition>
  deleteSecret: (id: string) => Promise<void>
  updateMacros: (macros: MacroDefinition[]) => Promise<MacroDefinition[]>
  resetMacros: () => Promise<MacroDefinition[]>
  onMacrosChanged: (listener: (message: { readonly macros: MacroDefinition[] }) => void) => () => void
}>

export function captureLegacyMacroSettingsCapability(
  api: LegacyMacroSettingsApi,
): LegacyMacroSettingsCapability {
  const { deleteSecret, getDecryptedSecret, getMacros, getSecrets, onMacrosChanged, resetMacros, saveSecret, updateMacros } = api

  for (const [name, value] of Object.entries({ deleteSecret, getDecryptedSecret, getMacros, getSecrets, onMacrosChanged, resetMacros, saveSecret, updateMacros })) {
    if (typeof value !== 'function') {
      throw new TypeError(`legacy macro settings capability ${name} is unavailable`)
    }
  }

  // Do not bind these to `api`: that would retain the complete preload object.
  return Object.freeze({
    deleteSecret: (id) => deleteSecret(id),
    getDecryptedSecret: (id) => getDecryptedSecret(id),
    getMacros: () => getMacros(),
    getSecrets: () => getSecrets(),
    onMacrosChanged: (listener) => onMacrosChanged(listener),
    resetMacros: () => resetMacros(),
    saveSecret: (name, value) => saveSecret(name, value),
    updateMacros: (macros) => updateMacros(macros),
  })
}
