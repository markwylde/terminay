export type DesktopConnectionIntent =
	| Readonly<{ kind: 'application-handoff' }>
	| Readonly<{ kind: 'device-pairing'; pairingPin: string }>;

/**
 * Pairing is selected by the presence of the privileged PIN field, not by its
 * trimmed truthiness. Otherwise whitespace could silently downgrade an
 * explicit device-pairing attempt into the direct application-token path.
 */
export function resolveDesktopConnectionIntent(
	pairingPin: string | undefined,
): DesktopConnectionIntent {
	if (pairingPin === undefined) {
		return Object.freeze({ kind: 'application-handoff' });
	}
	const normalized = pairingPin.trim();
	if (!/^\d{6}$/u.test(normalized)) {
		throw new Error('Enter the six-digit Remote Access pairing PIN.');
	}
	return Object.freeze({ kind: 'device-pairing', pairingPin: normalized });
}
