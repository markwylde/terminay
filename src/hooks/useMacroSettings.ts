import { useEffect, useState } from 'react'
import { defaultMacros } from '../macroSettings'
import type { MacroDefinition } from '../types/macros'

export function useMacroSettings() {
  const [macros, setMacros] = useState<MacroDefinition[]>(defaultMacros)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    void window.terminay.getMacros().then((nextMacros) => {
      if (!mounted) {
        return
      }

      setMacros(nextMacros)
      setIsLoading(false)
    })

    const unsubscribe = window.terminay.onMacrosChanged((message) => {
      setMacros(message.macros)
      setIsLoading(false)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  return { macros, isLoading, setMacros }
}
