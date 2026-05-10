import { useEffect, useState } from 'react'
import { defaultTerminalSettings } from '../terminalSettings'
import type { TerminalSettings } from '../types/settings'

export function useTerminalSettings() {
  const [settings, setSettings] = useState<TerminalSettings>(defaultTerminalSettings)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    void window.terminay.getTerminalSettings().then((nextSettings) => {
      if (!isMounted) {
        return
      }

      setSettings(nextSettings)
      setIsLoading(false)
    })

    const unsubscribe = window.terminay.onTerminalSettingsChanged((message) => {
      setSettings(message.settings)
      setIsLoading(false)
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  return { settings, isLoading, setSettings }
}
