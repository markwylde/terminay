import { createContext, createElement, type ReactNode, useContext, useEffect, useState } from 'react'
import type { MacroClient } from '@terminay/client-core'
import { defaultMacros } from '../macroSettings'
import type { LegacyMacroSettingsCapability } from '../services/macros/legacyMacroSettingsCapability'
import type { MacroDefinition } from '../types/macros'

export type MacroSettingsClient = {
  getMacros(): Promise<MacroDefinition[]>
  updateMacros(macros: MacroDefinition[]): Promise<MacroDefinition[]>
  resetMacros(): Promise<MacroDefinition[]>
  onMacrosChanged(listener: (message: { macros: MacroDefinition[] }) => void): () => void
}

const LegacyMacroSettingsContext = createContext<LegacyMacroSettingsCapability | undefined>(undefined)

export function LegacyMacroSettingsProvider({
  capability,
  children,
}: Readonly<{ capability: LegacyMacroSettingsCapability; children: ReactNode }>) {
  return createElement(LegacyMacroSettingsContext.Provider, { value: capability }, children)
}

export function useLegacyMacroSettingsCapability(): LegacyMacroSettingsCapability {
  const capability = useContext(LegacyMacroSettingsContext)
  if (capability === undefined) throw new Error('Legacy macro settings capability is unavailable')
  return capability
}

/**
 * Desktop keeps presentation-only macro fields in the host store while the
 * executable definition and revision are committed to the server authority.
 * The host event remains the single UI projection so the two awaited writes
 * cannot race a stale partial definition into the editor.
 */
export function createServerMacroSettingsClient(
  client: MacroClient,
  legacy: LegacyMacroSettingsCapability,
): MacroSettingsClient {
  return {
    async getMacros() {
      const macros = await legacy.getMacros()
      await client.replace(macros)
      return macros
    },
    async updateMacros(macros) {
      // Queue the compatibility commit first. Existing Desktop callers that
      // read macros.json immediately after the click then observe the complete
      // presentation definition (including select options) while this method
      // still acknowledges only after the server mirror also commits.
      const saved = await legacy.updateMacros(macros)
      await client.replace(saved)
      return saved
    },
    async resetMacros() {
      const macros = await legacy.resetMacros()
      await client.replace(macros)
      return macros
    },
    onMacrosChanged: (listener) => legacy.onMacrosChanged(listener),
  }
}

/**
 * The named Desktop compatibility caller for legacy macro settings. The
 * capability is frozen before the effect subscribes, so no hook state keeps
 * the broad preload API alive.
 */
export function useMacroSettings(override?: MacroSettingsClient) {
  const injectedCapability = useContext(LegacyMacroSettingsContext)
  const capability = override ?? injectedCapability
  if (capability === undefined) throw new Error('Macro settings client is unavailable')
  const [macros, setMacros] = useState<MacroDefinition[]>(defaultMacros)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    void capability.getMacros().then((nextMacros) => {
      if (!mounted) {
        return
      }

      setMacros(nextMacros)
      setIsLoading(false)
    }).catch(() => {
      if (!mounted) {
        return
      }
      setMacros(defaultMacros)
      setIsLoading(false)
    })

    const unsubscribe = capability.onMacrosChanged((message) => {
      setMacros(message.macros)
      setIsLoading(false)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [capability])

  return { macros, isLoading, setMacros }
}
