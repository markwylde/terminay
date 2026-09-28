const BRACKETED_PASTE_START = '\u001b[200~';
const BRACKETED_PASTE_END = '\u001b[201~';

/**
 * PTY input that submits `command` as if pasted and followed by Enter. The
 * markers are added only when the program has enabled bracketed paste;
 * otherwise, as xterm.js pastes, line breaks become carriage returns so each
 * line is submitted in turn.
 */
export function commandSubmissionInput(
	command: string,
	bracketed: boolean,
): string {
	return bracketed
		? `${BRACKETED_PASTE_START}${command}${BRACKETED_PASTE_END}\r`
		: `${command.replace(/\r?\n/g, '\r')}\r`;
}
