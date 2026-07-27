import { useEffect, useMemo, useState } from 'react'
import { defaultTerminalSettings } from '../terminalSettings'
import type { TerminalSettings } from '../types/settings'
import { createLegacySettingsClient } from '../services/settings/legacySettingsClient'

export function useTerminalSettings() {
  const settingsClient = useMemo(() => createLegacySettingsClient(), [])
  const [settings, setSettings] = useState<TerminalSettings>(defaultTerminalSettings)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    void settingsClient.get<TerminalSettings>().then((nextSettings) => {
      if (!isMounted) {
        return
      }

      setSettings(nextSettings)
      setIsLoading(false)
    })

    const unsubscribe = settingsClient.onChanged((nextSettings) => {
      setSettings(nextSettings as unknown as TerminalSettings)
      setIsLoading(false)
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [settingsClient])

  return { settings, isLoading, setSettings }
}
