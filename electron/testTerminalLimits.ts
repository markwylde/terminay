/**
 * Resolve the E2E-only terminal replay window for the embedded server.
 *
 * The end-to-end suite needs a shell to outrun the retained replay window
 * during a real Local transport loss, and Local recovery completes in well
 * under a second: a production-sized window cannot be outrun deterministically
 * in that gap. Like the embedded persistence fault, merely setting the variable
 * in a production process has no effect; it is honoured only alongside the E2E
 * marker, and only as a positive safe integer.
 */
export function embeddedTerminalReplayBytesOverride(
	environment: Readonly<Record<string, string | undefined>>,
): number | undefined {
	if (environment.TERMINAY_TEST !== '1') return undefined;
	const value = environment.TERMINAY_TEST_TERMINAL_REPLAY_BYTES;
	if (value === undefined || !/^\d{1,15}$/u.test(value)) return undefined;
	const bytes = Number(value);
	return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined;
}

/**
 * Resolve the E2E-only notification settle period for the embedded server.
 *
 * A notification is published five seconds after it arises. The end-to-end
 * suite asserts on the header count many times, and waiting out the production
 * period each time would cost it minutes, so it runs with a shorter one and
 * lengthens it only where the period itself is under test. Inert without the
 * E2E marker, and only a whole number of milliseconds up to a minute is
 * honoured.
 */
export function embeddedNotificationSettleMsOverride(
	environment: Readonly<Record<string, string | undefined>>,
): number | undefined {
	if (environment.TERMINAY_TEST !== '1') return undefined;
	const value = environment.TERMINAY_TEST_NOTIFICATION_SETTLE_MS;
	if (value === undefined || !/^\d{1,5}$/u.test(value)) return undefined;
	const milliseconds = Number(value);
	return milliseconds <= 60_000 ? milliseconds : undefined;
}
