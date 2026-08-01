export type LegacyServerConnectionLifecycleCapability = Readonly<{
  onServerConnection: (listener: (message: { serverId: string; label?: string; replacement?: boolean }) => void) => () => void
  requestServerConnection: (serverId: string) => Promise<void>
}>
type LegacyServerConnectionLifecycleApi = LegacyServerConnectionLifecycleCapability

/**
 * The renderer's temporary server-lifecycle recovery needs only subscription
 * and rehydration. Capture them so it cannot retain the broad preload API.
 */
export function captureLegacyServerConnectionLifecycleCapability(
  api: LegacyServerConnectionLifecycleApi,
): LegacyServerConnectionLifecycleCapability {
  const { onServerConnection, requestServerConnection } = api
  for (const [name, value] of Object.entries({ onServerConnection, requestServerConnection })) {
    if (typeof value !== 'function') {
      throw new TypeError(`legacy server-connection lifecycle capability ${name} is unavailable`)
    }
  }
  return Object.freeze({
    onServerConnection: (listener) => onServerConnection(listener),
    requestServerConnection: (serverId) => requestServerConnection(serverId),
  })
}
