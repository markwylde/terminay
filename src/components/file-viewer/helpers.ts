export function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'Unknown size'
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const fractionDigits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`
}

export function formatTimestamp(timestamp: number | null | undefined) {
  if (!timestamp) {
    return 'Unknown time'
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(timestamp)
  } catch {
    return new Date(timestamp).toLocaleString()
  }
}
