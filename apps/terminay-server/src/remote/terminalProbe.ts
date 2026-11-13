import { spawn } from 'node:child_process';

/**
 * Whether this server can start a terminal, asked by its operator.
 *
 * It runs the shell a new terminal would start, non-interactively, with a
 * command that exits at once. No PTY, no session holder, no workspace state:
 * what it catches is a shell that cannot run for this account at all, such as
 * a service account whose login shell is `nologin`.
 */

export const TERMINAL_PROBE_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 1024;

export interface TerminalProbeResult {
	readonly ok: boolean;
	/** The shell that was tried, or absent when none could be found. */
	readonly shell?: string;
	readonly exitCode?: number;
	/** The last of what it printed, when it failed. */
	readonly output?: string;
	readonly reason?: 'no-shell' | 'exit' | 'timeout' | 'spawn';
}

export function probeShell(
	shell: string | null,
	options: {
		readonly timeoutMs?: number;
		readonly env?: NodeJS.ProcessEnv;
		readonly cwd?: string;
	} = {},
): Promise<TerminalProbeResult> {
	if (shell === null)
		return Promise.resolve(Object.freeze({ ok: false, reason: 'no-shell' }));
	return new Promise((resolve) => {
		let output = '';
		let settled = false;
		const finish = (result: TerminalProbeResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(Object.freeze(result));
		};
		const child = spawn(shell, ['-c', 'exit 0'], {
			stdio: ['ignore', 'pipe', 'pipe'],
			env: options.env ?? process.env,
			...(options.cwd === undefined ? {} : { cwd: options.cwd }),
		});
		const collect = (chunk: Buffer) => {
			output = (output + chunk.toString('utf8')).slice(-MAX_OUTPUT_BYTES);
		};
		child.stdout.on('data', collect);
		child.stderr.on('data', collect);
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			finish({ ok: false, shell, reason: 'timeout' });
		}, options.timeoutMs ?? TERMINAL_PROBE_TIMEOUT_MS);
		timer.unref?.();
		child.once('error', (error) =>
			finish({ ok: false, shell, reason: 'spawn', output: error.message }),
		);
		child.once('close', (code) => {
			if (code === 0) finish({ ok: true, shell });
			else
				finish({
					ok: false,
					shell,
					reason: 'exit',
					exitCode: code ?? -1,
					...(output.trim().length > 0 ? { output: output.trim() } : {}),
				});
		});
	});
}
