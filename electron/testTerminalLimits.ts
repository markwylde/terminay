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
