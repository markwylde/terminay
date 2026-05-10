import path from 'node:path'
import type { RemoteAccessSettings } from '../../src/types/settings'

export type RemoteAccessConfig = RemoteAccessSettings

export type ResolvedRemoteAccessConfig = RemoteAccessConfig & {
  host: string
  port: number
  remoteAppOrigin: string
}

const DEFAULT_REMOTE_ORIGIN = 'https://localhost:9443'

export function readRemoteAccessConfig(settings: RemoteAccessSettings): RemoteAccessConfig {
  return {
    bindAddress: settings.bindAddress,
    origin: settings.origin,
    pairingMode: settings.pairingMode,
    tlsCertPath: settings.tlsCertPath,
    tlsKeyPath: settings.tlsKeyPath,
    webRtcConnectUrl: settings.webRtcConnectUrl,
  }
}

export function resolveRemoteAccessConfig(config: RemoteAccessConfig): ResolvedRemoteAccessConfig {
  const origin = config.origin.trim() || DEFAULT_REMOTE_ORIGIN

  const url = new URL(origin)
  if (url.protocol !== 'https:') {
    throw new Error('Remote access origin must use https://')
  }

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Remote access origin must be a clean origin with no path, query, or hash.')
  }

  return {
    bindAddress: config.bindAddress.trim() || '0.0.0.0',
    host: url.hostname,
    origin: url.origin,
    pairingMode: config.pairingMode,
    port: url.port ? Number.parseInt(url.port, 10) : 443,
    remoteAppOrigin: url.origin,
    tlsCertPath: config.tlsCertPath.trim() ? path.resolve(config.tlsCertPath) : '',
    tlsKeyPath: config.tlsKeyPath.trim() ? path.resolve(config.tlsKeyPath) : '',
    webRtcConnectUrl: config.webRtcConnectUrl,
  }
}
