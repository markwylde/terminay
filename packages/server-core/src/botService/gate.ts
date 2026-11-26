/** Script time limit of a trigger gate (change `add-bot-trigger-gate`). */
export const GATE_TIMEOUT_MS = 30000;
/** Bytes of gate output kept in a skipped firing's reason, after `gate: `. */
export const GATE_REASON_BYTES = 512;
/** Bytes of a broken gate's stderr tail handed to the bot. */
export const GATE_STDERR_BYTES = 1024;
/** Fixed wording placed after the prompt when a gate gave no verdict. The
 * gate's own path and output travel only inside the untrusted context. */
export const GATE_FAILED_NOTE =
	"Terminay note: this trigger's gate gave no verdict, so this run started anyway. Check and repair the gate; details are in the context below.";

/** What a session is told about a gate that gave no verdict. */
export interface GateFailure {
	path: string;
	status: 'failed';
	/** The script's exit status, or null when it did not run to completion. */
	exitCode: number | null;
	error: string;
	stderr?: string;
}

/**
 * The shell command that runs a gate. The path is the only caller-supplied
 * text and is a single-quoted word, so it is data and never shell syntax. A
 * relative path resolves against the working directory. An executable file is
 * executed directly; anything else is handed to bash, which reports a missing
 * file with a non-zero status.
 */
export function gateCommand(path: string): string {
	const quoted = `'${path.replace(/'/g, "'\\''")}'`;
	return [
		`g=${quoted}`,
		'case "$g" in /*) ;; *) g="./$g" ;; esac',
		'if [ -f "$g" ] && [ -x "$g" ]; then exec "$g" </dev/null; else exec bash -- "$g" </dev/null; fi',
	].join('; ');
}

/** The first `max` bytes of `value`, cut on a character boundary. */
export function utf8Head(value: string, max: number): string {
	const bytes = Buffer.from(value);
	if (bytes.length <= max) return value;
	let end = max;
	while (end > 0 && ((bytes[end] as number) & 0xc0) === 0x80) end--;
	return bytes.subarray(0, end).toString('utf8');
}

/** The last `max` bytes of `value`, cut on a character boundary, without the
 * partial first line a cut leaves behind. */
export function utf8Tail(value: string, max: number): string {
	const bytes = Buffer.from(value);
	if (bytes.length <= max) return value;
	let start = bytes.length - max;
	while (start < bytes.length && ((bytes[start] as number) & 0xc0) === 0x80)
		start++;
	const tail = bytes.subarray(start);
	if (bytes[start - 1] === 10) return tail.toString('utf8');
	const newline = tail.indexOf(10);
	return (newline < 0 ? Buffer.alloc(0) : tail.subarray(newline + 1)).toString(
		'utf8',
	);
}
