import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A shell in a real PTY, in a disposable working directory. A conformance test
 * owns one of these for its whole run and must always end up in `close()`:
 * leaking it would leave a real agent CLI running on the machine, spending the
 * developer's tokens.
 */
export interface ConformancePty {
	readonly cwd: string;
	readonly shellPid: number;
	/** Everything the PTY has produced, for diagnosing a failed expectation. */
	output(): string;
	write(text: string): void;
	/** Types a line and submits it. */
	send(line: string): void;
	/** Resolves once the PTY output matches, or rejects on timeout. */
	waitForOutput(pattern: RegExp, timeoutMs?: number): Promise<void>;
	close(): Promise<void>;
}

interface PtyProcess {
	readonly pid: number;
	onData(listener: (data: string) => void): void;
	write(data: string): void;
	kill(signal?: string): void;
}

/** Loaded lazily so a machine without a built node-pty can still skip cleanly. */
async function loadPty(): Promise<{
	spawn(
		file: string,
		args: string[],
		options: Record<string, unknown>,
	): PtyProcess;
}> {
	return (await import('node-pty')) as unknown as {
		spawn(
			file: string,
			args: string[],
			options: Record<string, unknown>,
		): PtyProcess;
	};
}

export interface ConformancePtyOptions {
	/** Extra environment for the shell; provider homes are set through this. */
	readonly environment?: Record<string, string>;
	readonly shell?: string;
}

export async function openConformancePty(
	options: ConformancePtyOptions = {},
): Promise<ConformancePty> {
	const pty = await loadPty();
	const cwd = mkdtempSync(join(tmpdir(), 'terminay-conformance-'));
	let buffer = '';
	const listeners = new Set<() => void>();
	const child = pty.spawn(
		options.shell ?? '/bin/bash',
		['--norc', '--noprofile'],
		{
			name: 'xterm-256color',
			cols: 120,
			rows: 40,
			cwd,
			env: { ...process.env, ...options.environment, TERM: 'xterm-256color' },
		},
	);
	child.onData((data) => {
		buffer += data;
		for (const listener of [...listeners]) listener();
	});

	let closed = false;
	return {
		cwd,
		shellPid: child.pid,
		output: () => buffer,
		write: (text) => child.write(text),
		send: (line) => child.write(`${line}\r`),
		waitForOutput(pattern, timeoutMs = 60_000) {
			if (pattern.test(buffer)) return Promise.resolve();
			return new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					listeners.delete(check);
					reject(
						new Error(
							`timed out waiting for ${pattern}. Last output:\n${buffer.slice(-2_000)}`,
						),
					);
				}, timeoutMs);
				function check(): void {
					if (!pattern.test(buffer)) return;
					clearTimeout(timer);
					listeners.delete(check);
					resolve();
				}
				listeners.add(check);
			});
		},
		async close() {
			if (closed) return;
			closed = true;
			listeners.clear();
			try {
				child.kill('SIGKILL');
			} catch {
				// Already gone; nothing further to terminate.
			}
			rmSync(cwd, { recursive: true, force: true });
		},
	};
}
