import { useEffect, useState } from 'react'

function readValue<T>(key: string, fallbackValue: T) {
  if (typeof window === 'undefined') {
    return fallbackValue
  }

  try {
    const storedValue = window.localStorage.getItem(key)
    if (storedValue === null) {
      return fallbackValue
    }

    return JSON.parse(storedValue) as T
  } catch {
    return fallbackValue
  }
}

export function usePersistentState<T>(key: string, fallbackValue: T) {
  const [value, setValue] = useState<T>(() => readValue(key, fallbackValue))

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Ignore storage failures so the UI keeps working in restricted contexts.
    }
  }, [key, value])

  return [value, setValue] as const
}
