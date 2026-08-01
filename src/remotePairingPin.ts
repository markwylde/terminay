import type { TerminalSettings } from './types/settings';

export type RemotePairingPinClient = Readonly<{
	getTerminalSettings: () => Promise<TerminalSettings>;
	setRemoteAccessPairingPin: (pin: string) => Promise<TerminalSettings>;
}>;

export const PAIRING_PIN_PATTERN = /^\d{6}$/;

export async function isRemoteAccessPairingPinConfigured(
	client: RemotePairingPinClient,
	_pairingMode: 'lan' | 'webrtc',
): Promise<boolean> {
	const settings = await client.getTerminalSettings();
	return settings.remoteAccess.pairingPinHash.trim().length > 0;
}

export async function saveRemoteAccessPairingPin(
	client: RemotePairingPinClient,
	pin: string,
): Promise<void> {
	await client.setRemoteAccessPairingPin(pin);
}
