/**
 * A terminal panel whose session has already ended has nothing to attach to
 * for input, but the server still holds the output it ended with. This reads
 * that output once, read-only, so the panel shows what was last on screen
 * under the notice that the session is over.
 */

export type EndedTerminalStatus = 'exited' | 'interrupted';

export interface EndedTerminalReplayEvent {
	readonly type: 'output' | 'skip' | 'exit' | string;
	readonly bytes?: Uint8Array;
	readonly exitCode?: number;
	readonly signal?: number | null;
}

export interface EndedTerminalAttachment {
	readonly initialEvents: readonly EndedTerminalReplayEvent[];
	readonly detach: () => Promise<unknown>;
}

export interface EndedTerminalReplayOptions {
	/** Open a read-only attachment to the ended session. */
	readonly attach: () => Promise<EndedTerminalAttachment>;
	readonly write: (bytes: Uint8Array | string) => void;
	/** False once the panel that asked has unmounted or rebound. */
	readonly isCurrent: () => boolean;
}

export interface EndedTerminalReplayResult {
	/** Whether the server still had output for this session. */
	readonly available: boolean;
	readonly exitCode?: number;
	readonly signal?: number | null;
}

const EARLIER_OUTPUT_NOTICE =
	'\x1b[2m[Earlier output is no longer kept.]\x1b[0m\r\n';

export async function replayEndedTerminal(
	options: EndedTerminalReplayOptions,
): Promise<EndedTerminalReplayResult> {
	let attachment: EndedTerminalAttachment;
	try {
		attachment = await options.attach();
	} catch {
		// Nothing was saved for it, or it was closed elsewhere. The notice alone
		// is the whole truth in that case.
		return { available: false };
	}
	// The replay is all this panel will ever read from the session.
	void attachment.detach().catch(() => undefined);
	if (!options.isCurrent()) return { available: false };
	let exitCode: number | undefined;
	let signal: number | null | undefined;
	for (const event of attachment.initialEvents) {
		if (event.type === 'output' && event.bytes !== undefined)
			options.write(event.bytes);
		else if (event.type === 'skip') options.write(EARLIER_OUTPUT_NOTICE);
		else if (event.type === 'exit') {
			exitCode = event.exitCode;
			signal = event.signal;
		}
	}
	return {
		available: true,
		...(exitCode === undefined ? {} : { exitCode }),
		...(signal === undefined ? {} : { signal }),
	};
}

/**
 * The notice a panel shows for an ended session. An interrupted session did
 * not exit on its own terms, so the code the server recorded for it is not one
 * the shell chose and is not shown.
 */
export function endedTerminalNotice(
	status: EndedTerminalStatus,
	result?: Pick<EndedTerminalReplayResult, 'exitCode' | 'signal'>,
): string {
	const base = "This session has ended and can't be resumed.";
	if (status !== 'exited' || result === undefined) return base;
	if (typeof result.signal === 'number' && result.signal > 0)
		return `${base} It was stopped by signal ${result.signal}.`;
	if (typeof result.exitCode === 'number')
		return `${base} It exited with code ${result.exitCode}.`;
	return base;
}
