import { SettingsClient, SETTINGS_EVENTS, SETTINGS_OPERATIONS, type SettingsEventTransport } from '@terminay/client-core'
import type { JsonValue } from '@terminay/protocol'
import type { TerminayApi } from '../../types/terminay'
import type { TerminalSettings } from '../../types/settings'

/** Compatibility-only bridge for the settings hook. Shared UI calls
 * SettingsClient; preload methods and event payloads stay in this adapter. */
export type LegacySettingsApi = Pick<
  TerminayApi,
  'getTerminalSettings' | 'updateTerminalSettings' | 'resetTerminalSettings' | 'onTerminalSettingsChanged'
>

export function createLegacySettingsClient(api: LegacySettingsApi = window.terminay): SettingsClient {
  return new SettingsClient(createLegacySettingsTransport(api))
}

export function createLegacySettingsTransport(api: LegacySettingsApi): SettingsEventTransport {
  return {
    async query<T extends JsonValue = JsonValue>(operation: string): Promise<T> {
      if (operation !== SETTINGS_OPERATIONS.get) throw new Error(`legacy settings query is unsupported: ${operation}`)
      return (await api.getTerminalSettings()) as unknown as T
    },
    async command<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}): Promise<T> {
      if (operation === SETTINGS_OPERATIONS.reset) return (await api.resetTerminalSettings()) as unknown as T
      if (operation === SETTINGS_OPERATIONS.update) {
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || payload.settings === undefined) throw new TypeError('settings update payload is invalid')
        return (await api.updateTerminalSettings(payload.settings as unknown as TerminalSettings)) as unknown as T
      }
      throw new Error(`legacy settings command is unsupported: ${operation}`)
    },
    subscribe(event: string, listener: (payload: JsonValue) => void): () => void {
      if (event !== SETTINGS_EVENTS.changed) throw new Error(`legacy settings event is unsupported: ${event}`)
      return api.onTerminalSettingsChanged((message) => listener(message.settings as unknown as JsonValue))
    },
  }
}
