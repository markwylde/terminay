import type { RemoteAccessSettings } from '../../src/types/settings';
import { verifyPairingPin } from './pin';

const PIN_FAILURE_WINDOW_MS = 60_000;
const MAX_PIN_FAILURES_PER_WINDOW = 5;
const PAIRING_PIN_FAILURE_MESSAGE =
	'Pairing failed. Check the PIN and try a fresh QR code.';

type PinFailureBucket = {
	count: number;
	startedAt: number;
};

const pinFailureBuckets = new Map<string, PinFailureBucket>();

export function assertPairingPin(
	settings: RemoteAccessSettings,
	pin: string | undefined,
	options: { failureMessage?: string; requireConfigured?: boolean; now?: number } = {},
): void {
	const pinHash = settings.pairingPinHash.trim();
	const failureMessage = options.failureMessage ?? PAIRING_PIN_FAILURE_MESSAGE;
	if (!pinHash) {
		if (options.requireConfigured) {
			throw new Error(failureMessage);
		}
		return;
	}

	const now = options.now ?? Date.now();
	enforcePinFailureLimit(pinHash, now);
	if (!verifyPairingPin(pinHash, String(pin ?? ''))) {
		recordPinFailure(pinHash, now);
		throw new Error(failureMessage);
	}
	pinFailureBuckets.delete(pinHash);
}

export function resetPairingPinFailuresForTests(): void {
	pinFailureBuckets.clear();
}

function enforcePinFailureLimit(pinHash: string, now: number): void {
	const bucket = pinFailureBuckets.get(pinHash);
	if (!bucket || now - bucket.startedAt > PIN_FAILURE_WINDOW_MS) return;
	if (bucket.count >= MAX_PIN_FAILURES_PER_WINDOW) {
		throw new Error(PAIRING_PIN_FAILURE_MESSAGE);
	}
}

function recordPinFailure(pinHash: string, now: number): void {
	const current = pinFailureBuckets.get(pinHash);
	const bucket =
		current && now - current.startedAt <= PIN_FAILURE_WINDOW_MS
			? current
			: { count: 0, startedAt: now };
	bucket.count += 1;
	pinFailureBuckets.set(pinHash, bucket);
}
