const BRACKETED_PASTE_START = '\u001b[200~';
const BRACKETED_PASTE_END = '\u001b[201~';

/** The carriage return a terminal sends for Enter. */
export const SUBMIT_INPUT = '\r';

/**
 * How long to wait between a body of text and the key presses that follow
 * it. Programs that read their own keyboard input, such as Claude Code and
 * other full-screen agents, treat a carriage return that arrives in the same
 * read as preceding text as part of a paste, so it becomes a newline instead
 * of submitting. Writing it on its own, after a pause, makes it a key press.
 */
export const SUBMIT_DELAY_MS = 50;

/**
 * Named keys an agent can press. Models cannot reliably put raw control
 * characters into tool arguments, so these are the only way to send them.
 */
export const TERMINAL_KEYS = Object.freeze({
	Enter: '\r',
	Tab: '\t',
	'Shift+Tab': '\u001b[Z',
	Escape: '\u001b',
	Backspace: '\u007f',
	Delete: '\u001b[3~',
	Up: '\u001b[A',
	Down: '\u001b[B',
	Right: '\u001b[C',
	Left: '\u001b[D',
	Home: '\u001b[H',
	End: '\u001b[F',
	PageUp: '\u001b[5~',
	PageDown: '\u001b[6~',
	Space: ' ',
	'Ctrl+A': '\u0001',
	'Ctrl+C': '\u0003',
	'Ctrl+D': '\u0004',
	'Ctrl+E': '\u0005',
	'Ctrl+K': '\u000b',
	'Ctrl+L': '\u000c',
	'Ctrl+R': '\u0012',
	'Ctrl+U': '\u0015',
	'Ctrl+W': '\u0017',
	'Ctrl+Z': '\u001a',
} as const);

export type TerminalKey = keyof typeof TERMINAL_KEYS;

/**
 * PTY input that pastes `command`: framed with bracketed-paste markers only
 * when the program has enabled bracketed paste; otherwise, as xterm.js pastes,
 * line breaks become carriage returns so each line is submitted in turn. The
 * submitting Enter is not included; send {@link SUBMIT_INPUT} separately.
 */
export function commandPasteInput(command: string, bracketed: boolean): string {
	return bracketed
		? `${BRACKETED_PASTE_START}${command}${BRACKETED_PASTE_END}`
		: command.replace(/\r?\n/g, '\r');
}

/** The full PTY input of a submitted command: its paste, then Enter. */
export function commandSubmissionInput(
	command: string,
	bracketed: boolean,
): string {
	return `${commandPasteInput(command, bracketed)}${SUBMIT_INPUT}`;
}

export interface SeparatedInput {
	/** Text written as one chunk; may be empty. */
	readonly body: string;
	/** Key presses written after the body, each on its own. */
	readonly keys: readonly string[];
}

export interface SeparatedInputOptions {
	/**
	 * Identifies the terminal. Submissions with the same key run one after
	 * another, so two submissions' text and Enter never interleave.
	 */
	readonly terminal?: string;
	/** Checked before every write; once aborted, nothing more is written. */
	readonly signal?: AbortSignal;
	readonly delayMs?: number;
	readonly sleep?: (ms: number) => Promise<void>;
}

const pendingSubmissions = new Map<string, Promise<unknown>>();

/** The queue key of one terminal session, the same on every write path. */
export function terminalInputKey(serverId: string, sessionId: string): string {
	return `${serverId}\u0000${sessionId}`;
}

/**
 * Write `body`, then each key press as its own write, pausing between writes,
 * so a program reading its keyboard sees keys rather than pasted text. Stops
 * at the first failed write, and before any write once `signal` is aborted.
 * Returns the number of UTF-8 bytes written.
 */
export function writeSeparatedInput(
	input: SeparatedInput,
	write: (data: string) => Promise<void>,
	options: SeparatedInputOptions = {},
): Promise<number> {
	const key = options.terminal;
	if (key === undefined) return writeInOrder(input, write, options);
	const previous = pendingSubmissions.get(key) ?? Promise.resolve();
	const current = previous
		.catch(() => undefined)
		.then(() => writeInOrder(input, write, options));
	const settled = current.catch(() => undefined);
	pendingSubmissions.set(key, settled);
	void settled.then(() => {
		if (pendingSubmissions.get(key) === settled) pendingSubmissions.delete(key);
	});
	return current;
}

async function writeInOrder(
	input: SeparatedInput,
	write: (data: string) => Promise<void>,
	options: SeparatedInputOptions,
): Promise<number> {
	const delayMs = options.delayMs ?? SUBMIT_DELAY_MS;
	const sleep =
		options.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const encoder = new TextEncoder();
	const writes = [
		...(input.body.length > 0 ? [input.body] : []),
		...input.keys,
	];
	let bytes = 0;
	for (const [index, data] of writes.entries()) {
		if (index > 0 && delayMs > 0) await sleep(delayMs);
		options.signal?.throwIfAborted();
		await write(data);
		bytes += encoder.encode(data).byteLength;
	}
	return bytes;
}
