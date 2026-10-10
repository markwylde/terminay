import { useEffect, useState } from 'react'
import { MACRO_CATEGORIES_SCHEMA_VERSION, type MacroClient, type MacroState } from '@terminay/client-core'
import type { MacroDefinition } from '../types/macros'

/** The server's macros as the editor works with them. */
export type MacroLibrary = {
  macros: MacroDefinition[]
  /** Ordered category names. A category may hold no macro. */
  categories: string[]
  revision: number
  /** False against a server that predates categories; the editor then hides them. */
  supportsCategories: boolean
}

export type MacroDefinitionsClient = {
  getMacroLibrary(): Promise<MacroLibrary>
  /** Replace every macro and the category list in one revisioned command. */
  saveMacroLibrary(
    library: Pick<MacroLibrary, 'macros' | 'categories'>,
    expectedRevision?: number,
  ): Promise<MacroLibrary>
  resetMacros(): Promise<MacroLibrary>
  onMacrosChanged(listener: (library: MacroLibrary) => void): () => void
}

/** Macros carry no secrets, so this is the whole macro settings surface. */
export type MacroSettingsClient = MacroDefinitionsClient

export class MacroSettingsUnavailableError extends Error {
  readonly code = 'unavailable'

  constructor(message = 'The selected server macro settings client is unavailable.') {
    super(message)
    this.name = 'MacroSettingsUnavailableError'
  }
}

function toLibrary(state: MacroState): MacroLibrary {
  return {
    macros: [...state.macros] as MacroDefinition[],
    categories: [...state.categories],
    revision: state.revision,
    supportsCategories: state.schemaVersion >= MACRO_CATEGORIES_SCHEMA_VERSION,
  }
}

/**
 * Adapt the selected server's canonical macro client to the editor contract.
 */
export function createServerMacroSettingsClient(
  client: MacroClient,
): MacroDefinitionsClient {
  return {
    async getMacroLibrary() {
      return toLibrary(await client.get())
    },
    async saveMacroLibrary(library, expectedRevision) {
      return toLibrary(await client.replace(library.macros, {
        categories: library.categories,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      }))
    },
    async resetMacros() {
      return toLibrary(await client.reset())
    },
    onMacrosChanged: (listener) => client.onChanged((state) => {
      listener(toLibrary(state))
    }),
  }
}

/**
 * Subscribe to the selected authority. A failed initial query remains visible
 * to the caller; it must never be disguised as a successful default payload.
 */
export function useMacroSettings(client?: MacroDefinitionsClient) {
  if (client === undefined) throw new MacroSettingsUnavailableError()
  const [library, setLibrary] = useState<MacroLibrary>({
    macros: [],
    categories: [],
    revision: 0,
    supportsCategories: false,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let mounted = true
    void client.getMacroLibrary().then((next) => {
      if (!mounted) {
        return
      }

      setLibrary(next)
      setError(null)
      setIsLoading(false)
    }).catch((cause: unknown) => {
      if (!mounted) {
        return
      }
      setError(cause instanceof Error ? cause : new Error(String(cause)))
      setIsLoading(false)
    })

    const unsubscribe = client.onMacrosChanged((next) => {
      setLibrary(next)
      setError(null)
      setIsLoading(false)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [client])

  return { ...library, library, error, isLoading }
}
