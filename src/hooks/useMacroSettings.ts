import { createContext, createElement, type ReactNode, useContext, useEffect, useState } from 'react'
import type { MacroClient } from '@terminay/client-core'
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
 * Adapt the selected server's canonical macro client to the editor contract.
 */
export function createServerMacroSettingsClient(
  client: MacroClient,
): MacroSettingsClient {
  return {
    async getMacros() {
      return [...(await client.get()).macros] as MacroDefinition[]
    },
    async updateMacros(macros) {
      return [...(await client.replace(macros)).macros] as MacroDefinition[]
    },
    async resetMacros() {
      return [...(await client.reset()).macros] as MacroDefinition[]
    },
    onMacrosChanged: (listener) => client.onChanged((state) => {
      listener({ macros: [...state.macros] as MacroDefinition[] })
    }),
  }
}

/**
 * Subscribe to the selected authority. A failed initial query remains visible
 * to the caller; it must never be disguised as a successful default payload.
 */
export function useMacroSettings(override?: MacroSettingsClient) {
  const injectedCapability = useContext(LegacyMacroSettingsContext)
  const capability = override ?? injectedCapability
  if (capability === undefined) throw new Error('Macro settings client is unavailable')
  const [macros, setMacros] = useState<MacroDefinition[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let mounted = true
    void capability.getMacros().then((nextMacros) => {
      if (!mounted) {
        return
      }

      setMacros(nextMacros)
      setError(null)
      setIsLoading(false)
    }).catch((cause: unknown) => {
      if (!mounted) {
        return
      }
      setError(cause instanceof Error ? cause : new Error(String(cause)))
      setIsLoading(false)
    })

    const unsubscribe = capability.onMacrosChanged((message) => {
      setMacros(message.macros)
      setError(null)
      setIsLoading(false)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [capability])

  return { macros, error, isLoading, setMacros }
}
