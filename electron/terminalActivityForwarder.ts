export interface TerminalSignalWriter {
	write(data: string, callback?: () => void): void;
}

/**
 * Deliver terminal bytes only after the signal parser has consumed the same
 * chunk. This queues semantic activity IPC before raw-output IPC and removes
 * the single-frame fallback-status flash.
 */
export function forwardTerminalDataAfterSignals(
	signalWriter: TerminalSignalWriter | null,
	data: string,
	forwardData: (data: string) => void,
): void {
	if (!signalWriter) {
		forwardData(data);
		return;
	}
	signalWriter.write(data, () => forwardData(data));
}
