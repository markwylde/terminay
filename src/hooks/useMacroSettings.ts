import { useEffect, useState } from 'react'
import type { MacroClient } from '@terminay/client-core'
import type { MacroDefinition, SecretDefinition } from '../types/macros'

export type MacroDefinitionsClient = {
  getMacros(): Promise<MacroDefinition[]>
  updateMacros(macros: MacroDefinition[]): Promise<MacroDefinition[]>
  resetMacros(): Promise<MacroDefinition[]>
  onMacrosChanged(listener: (message: { macros: MacroDefinition[] }) => void): () => void
}

export type MacroSettingsClient = MacroDefinitionsClient & {
  getSecrets(): Promise<SecretDefinition[]>
  getDecryptedSecret(id: string): Promise<string>
  saveSecret(name: string, value: string): Promise<SecretDefinition>
  deleteSecret(id: string): Promise<void>
}

export class MacroSettingsUnavailableError extends Error {
  readonly code = 'unavailable'

  constructor(message = 'The selected server macro settings client is unavailable.') {
    super(message)
    this.name = 'MacroSettingsUnavailableError'
  }
}

/**
 * Adapt the selected server's canonical macro client to the editor contract.
 */
export function createServerMacroSettingsClient(
  client: MacroClient,
): MacroDefinitionsClient {
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
export function useMacroSettings(client?: MacroDefinitionsClient) {
  if (client === undefined) throw new MacroSettingsUnavailableError()
  const [macros, setMacros] = useState<MacroDefinition[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let mounted = true
    void client.getMacros().then((nextMacros) => {
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

    const unsubscribe = client.onMacrosChanged((message) => {
      setMacros(message.macros)
      setError(null)
      setIsLoading(false)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [client])

  return { macros, error, isLoading, setMacros }
}
