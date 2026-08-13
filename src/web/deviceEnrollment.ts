import { getSessionTransportHost, type BrowserDeviceEnrollment } from './sessionTransportHost';
export type { BrowserDeviceEnrollment } from './sessionTransportHost';

export async function enrollBrowserDevice(options: Readonly<{
	deviceName: string;
	isCurrent: () => boolean;
	origin: string;
	pairingPin: string;
	pairingUrl: string;
}>): Promise<BrowserDeviceEnrollment> {
	if (!/^\d{6}$/u.test(options.pairingPin)) {
		throw new Error('Pairing PIN must be exactly 6 digits.');
	}
	if (options.deviceName.trim().length === 0) {
		throw new Error('Enter a name for this browser.');
	}
	const host = getSessionTransportHost();
	if (host === undefined) throw new Error('Browser device enrollment is unavailable.');
	return host.enroll(options);
}
