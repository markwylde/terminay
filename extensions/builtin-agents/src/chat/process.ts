import type { ChildProcessWithoutNullStreams } from 'node:child_process';

const MAX_LINE_BYTES = 8 * 1024 * 1024;
const STDERR_TAIL = 4 * 1024;

/** Calls `onLine` with each newline-terminated line of a stream. */
export function readLines(
	stream: NodeJS.ReadableStream,
	onLine: (line: string) => void,
): void {
	let buffer = '';
	stream.setEncoding('utf8');
	stream.on('data', (chunk: string) => {
		buffer += chunk;
		let end = buffer.indexOf('\n');
		while (end >= 0) {
			const line = buffer.slice(0, end).trim();
			buffer = buffer.slice(end + 1);
			if (line.length > 0) onLine(line);
			end = buffer.indexOf('\n');
		}
		// A runaway line is dropped rather than held forever.
		if (buffer.length > MAX_LINE_BYTES) buffer = '';
	});
}

/** Keeps the last few KiB of stderr, for a failure's detail. */
export function stderrTail(
	child: ChildProcessWithoutNullStreams,
): () => string {
	let tail = '';
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk: string) => {
		tail = (tail + chunk).slice(-STDERR_TAIL);
	});
	return () => tail.trim();
}

/** Parses a line as a JSON object, or undefined. */
export function jsonObject(line: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(line);
		return typeof value === 'object' && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

export function objectOf(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * Ends a process: close stdin, then SIGTERM, then SIGKILL. Resolves when it
 * has exited or the last signal has been sent.
 */
export function endProcess(
	child: ChildProcessWithoutNullStreams,
	graceMs = 1_000,
): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null)
		return Promise.resolve();
	return new Promise((resolve) => {
		const timers: ReturnType<typeof setTimeout>[] = [];
		const done = (): void => {
			for (const timer of timers) clearTimeout(timer);
			resolve();
		};
		child.once('exit', done);
		child.stdin.end();
		timers.push(
			setTimeout(() => child.kill('SIGTERM'), graceMs),
			setTimeout(() => {
				child.kill('SIGKILL');
				done();
			}, graceMs * 4),
		);
	});
}
