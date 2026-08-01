export type BrowserDeviceEnrollment = Readonly<{
	deviceId: string;
	deviceName: string;
	origin: string;
}>;

export type BrowserDeviceEnrollmentBridge = Readonly<{
	connect(options: Readonly<{
		onStateChange: (state: 'closed' | 'connecting' | 'live') => void;
		origin: string;
		pairingPin?: string;
	}>): Promise<ByteTransport>;
	enroll(options: Readonly<{
		deviceName: string;
		isCurrent: () => boolean;
		origin: string;
		pairingPin: string;
		pairingUrl: string;
	}>): Promise<BrowserDeviceEnrollment>;
	validatePairingUrl(pairingUrl: string): void;
}>;

declare global {
	interface Window {
		__TERMINAY_BROWSER_ENROLLMENT__?: BrowserDeviceEnrollmentBridge;
	}
}

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
	const bridge = window.__TERMINAY_BROWSER_ENROLLMENT__;
	if (bridge === undefined) throw new Error('Browser device enrollment is unavailable.');
	return bridge.enroll(options);
}
import type { ByteTransport } from '@terminay/protocol';
