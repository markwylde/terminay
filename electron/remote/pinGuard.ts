import type { RemoteAccessSettings } from '../../src/types/settings';
import { verifyPairingPin } from './pin';

const PAIRING_PIN_FAILURE_MESSAGE =
	'Pairing failed. Check the PIN and try a fresh QR code.';
const DEFAULT_PIN_FAILURE_LIMIT = 3;

type PinFailureBucket = {
	count: number;
};

const pinFailureBuckets = new Map<string, PinFailureBucket>();

export class PairingPinFailureLimitError extends Error {
	constructor(message = PAIRING_PIN_FAILURE_MESSAGE) {
		super(message);
		this.name = 'PairingPinFailureLimitError';
	}
}

export function assertPairingPin(
	settings: RemoteAccessSettings,
	pin: string | undefined,
	options: {
		contextKey?: string;
		failureLimit?: number;
		failureMessage?: string;
		requireConfigured?: boolean;
	} = {},
): void {
	const pinHash = settings.pairingPinHash.trim();
	const failureMessage = options.failureMessage ?? PAIRING_PIN_FAILURE_MESSAGE;
	if (!pinHash) {
		if (options.requireConfigured) {
			throw new Error(failureMessage);
		}
		return;
	}

	const contextKey = options.contextKey ?? pinHash;
	const failureLimit = resolveFailureLimit(
		options.failureLimit ?? settings.pinFailureLimit,
	);
	enforcePinFailureLimit(contextKey, failureLimit, failureMessage);
	if (!verifyPairingPin(pinHash, String(pin ?? ''))) {
		recordPinFailure(contextKey);
		enforcePinFailureLimit(contextKey, failureLimit, failureMessage);
		throw new Error(failureMessage);
	}
	pinFailureBuckets.delete(contextKey);
}

export function resetPairingPinFailuresForTests(): void {
	pinFailureBuckets.clear();
}

function resolveFailureLimit(value: number | undefined): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return DEFAULT_PIN_FAILURE_LIMIT;
	}
	return Math.min(10, Math.max(1, Math.floor(value)));
}

function enforcePinFailureLimit(
	contextKey: string,
	failureLimit: number,
	failureMessage: string,
): void {
	const bucket = pinFailureBuckets.get(contextKey);
	if (!bucket) return;
	if (bucket.count >= failureLimit) {
		throw new PairingPinFailureLimitError(failureMessage);
	}
}

function recordPinFailure(contextKey: string): void {
	const bucket = pinFailureBuckets.get(contextKey) ?? { count: 0 };
	bucket.count += 1;
	pinFailureBuckets.set(contextKey, bucket);
}
