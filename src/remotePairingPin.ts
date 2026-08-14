import type { TerminalSettings } from './types/settings';

export type RemotePairingPinClient = Readonly<{
	getTerminalSettings: () => Promise<TerminalSettings>;
	isRemoteAccessPairingPinConfigured: () => Promise<boolean>;
	setRemoteAccessPairingPin: (pin: string) => Promise<TerminalSettings>;
}>;

export const PAIRING_PIN_PATTERN = /^\d{6}$/;

export async function isRemoteAccessPairingPinConfigured(
	client: RemotePairingPinClient,
	_pairingMode: 'lan' | 'webrtc',
): Promise<boolean> {
	return client.isRemoteAccessPairingPinConfigured();
}

export async function saveRemoteAccessPairingPin(
	client: RemotePairingPinClient,
	pin: string,
): Promise<void> {
	await client.setRemoteAccessPairingPin(pin);
}
