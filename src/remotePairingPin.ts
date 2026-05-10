export const PAIRING_PIN_PATTERN = /^\d{6}$/

export async function isRemoteAccessPairingPinConfigured(pairingMode: 'lan' | 'webrtc'): Promise<boolean> {
  if (pairingMode !== 'webrtc') {
    return true
  }

  const settings = await window.terminay.getTerminalSettings()
  return settings.remoteAccess.pairingPinHash.trim().length > 0
}

export async function saveRemoteAccessPairingPin(pin: string): Promise<void> {
  await window.terminay.setRemoteAccessPairingPin(pin)
}
