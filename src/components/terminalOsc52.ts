/**
 * OSC 52 lets a program running in the terminal ask the terminal emulator to
 * put text on the clipboard: `ESC ] 52 ; <targets> ; <base64> BEL`. It is how
 * a program on a remote server (Claude Code, tmux, Neovim over SSH) copies to
 * the clipboard of the machine the user is sitting at.
 *
 * Terminay honours the write form only. The `?` query form, which would let a
 * program read the user's clipboard, is never answered.
 */

/** Matches the Desktop bridge's `clipboard.write` text bound. */
export const TERMINAL_OSC52_MAX_TEXT_BYTES = 1024 * 1024;

const MAX_ENCODED_LENGTH = Math.ceil(TERMINAL_OSC52_MAX_TEXT_BYTES / 3) * 4;
// `c` clipboard, `p` primary, `q` secondary, `s` select, `0`–`7` cut buffers.
// An empty target list is valid and means the terminal's default selection.
const TARGETS = /^[cpqs0-7]*$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type TerminalOsc52Request =
	| Readonly<{ kind: 'write'; text: string }>
	| Readonly<{
			kind: 'ignore';
			reason: 'query' | 'malformed' | 'empty' | 'too-large' | 'unsafe';
	  }>;

/**
 * Parse the data of an OSC 52 sequence (everything after `52;`).
 *
 * Every target selects the one system clipboard: the hosts Terminay runs on
 * have no separate primary selection a remote program could expect. An empty
 * payload, which xterm treats as "clear the selection", is ignored rather than
 * clearing the user's clipboard.
 */
export function parseTerminalOsc52(data: string): TerminalOsc52Request {
	const separator = data.indexOf(';');
	if (separator < 0) return { kind: 'ignore', reason: 'malformed' };
	const targets = data.slice(0, separator);
	const payload = data.slice(separator + 1);
	if (!TARGETS.test(targets)) return { kind: 'ignore', reason: 'malformed' };
	if (payload === '?') return { kind: 'ignore', reason: 'query' };
	if (payload.length === 0) return { kind: 'ignore', reason: 'empty' };
	if (payload.length > MAX_ENCODED_LENGTH)
		return { kind: 'ignore', reason: 'too-large' };
	if (!BASE64.test(payload) || payload.length % 4 === 1)
		return { kind: 'ignore', reason: 'malformed' };

	let bytes: Uint8Array;
	try {
		const binary = atob(payload);
		bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
	} catch {
		return { kind: 'ignore', reason: 'malformed' };
	}
	if (bytes.byteLength > TERMINAL_OSC52_MAX_TEXT_BYTES)
		return { kind: 'ignore', reason: 'too-large' };

	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return { kind: 'ignore', reason: 'malformed' };
	}
	if (text.length === 0) return { kind: 'ignore', reason: 'empty' };
	// Clipboard text may carry tabs and line breaks, never terminal control
	// sequences that a later paste would replay into a shell.
	if (hasUnsafeControlCharacter(text))
		return { kind: 'ignore', reason: 'unsafe' };
	return { kind: 'write', text };
}

function hasUnsafeControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (
			(code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
			code === 0x7f
		)
			return true;
	}
	return false;
}

export type TerminalOsc52HandlerOptions = Readonly<{
	/** The device setting that lets programs write the clipboard. */
	isEnabled: () => boolean;
	/**
	 * True only while the terminal is parsing live program output. Replayed
	 * history and restored checkpoints re-run old sequences and must never
	 * write the clipboard again.
	 */
	isLiveOutput: () => boolean;
	writeClipboardText: (text: string) => Promise<unknown> | unknown;
}>;

/**
 * Build the xterm OSC 52 handler. It always reports the sequence handled, so
 * xterm never acts on it, and it never writes anything back to the PTY.
 */
export function createTerminalOsc52Handler(
	options: TerminalOsc52HandlerOptions,
): (data: string) => boolean {
	return (data) => {
		if (!options.isEnabled() || !options.isLiveOutput()) return true;
		const request = parseTerminalOsc52(data);
		if (request.kind !== 'write') return true;
		try {
			void Promise.resolve(options.writeClipboardText(request.text)).catch(
				() => {
					// A refused clipboard (no focus, no gesture, platform denial) is
					// independent of the terminal and must not disturb its output.
				},
			);
		} catch {
			// Same as above for a synchronous refusal.
		}
		return true;
	};
}
