import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { InstallScope } from './args.js';
import { UNIT_NAME } from './layout.js';

/**
 * A thin wrapper over `systemctl`, `loginctl`, and `journalctl`.
 *
 * Nothing here reimplements systemd or talks to its bus: the CLI shells out to
 * the tools already on the box. That is also what makes the rest of the CLI
 * testable off a systemd host, because a stub earlier on PATH answers instead.
 */

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 120_000;

export interface SystemdOptions {
	readonly scope: InstallScope;
	readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface CommandResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

function scopeArguments(scope: InstallScope): readonly string[] {
	return scope === 'user' ? ['--user'] : [];
}

async function run(
	command: string,
	args: readonly string[],
	options: SystemdOptions,
): Promise<CommandResult> {
	try {
		const { stdout, stderr } = await execFileAsync(command, [...args], {
			timeout: TIMEOUT_MS,
			maxBuffer: 4 * 1024 * 1024,
			...(options.env === undefined
				? {}
				: { env: options.env as NodeJS.ProcessEnv }),
		});
		return Object.freeze({ code: 0, stdout, stderr });
	} catch (error) {
		const failure = error as {
			code?: number | string;
			stdout?: string;
			stderr?: string;
			message?: string;
		};
		// `systemctl is-active` exits non-zero to answer the question, so the
		// exit status is returned rather than thrown for every caller to handle.
		return Object.freeze({
			code: typeof failure.code === 'number' ? failure.code : 1,
			stdout: failure.stdout ?? '',
			stderr: failure.stderr ?? failure.message ?? '',
		});
	}
}

export function createSystemd(options: SystemdOptions) {
	const systemctl = (args: readonly string[]) =>
		run('systemctl', [...scopeArguments(options.scope), ...args], options);
	const expect = async (args: readonly string[]) => {
		const result = await systemctl(args);
		if (result.code !== 0) {
			throw new Error(
				`systemctl ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`,
			);
		}
		return result;
	};
	return {
		daemonReload: () => expect(['daemon-reload']),
		enableNow: () => expect(['enable', '--now', UNIT_NAME]),
		enable: () => expect(['enable', UNIT_NAME]),
		disable: () => systemctl(['disable', UNIT_NAME]),
		start: () => expect(['start', UNIT_NAME]),
		restart: () => expect(['restart', UNIT_NAME]),
		stop: () => expect(['stop', UNIT_NAME]),
		resetFailed: () => systemctl(['reset-failed', UNIT_NAME]),
		async isActive(): Promise<boolean> {
			return (await systemctl(['is-active', UNIT_NAME])).code === 0;
		},
		async isEnabled(): Promise<boolean> {
			return (await systemctl(['is-enabled', UNIT_NAME])).code === 0;
		},
		async state(): Promise<string> {
			const result = await systemctl(['is-active', UNIT_NAME]);
			return (result.stdout || result.stderr).trim() || 'unknown';
		},
		/** The last few journal lines, for a failure the operator has to read. */
		async journal(lines = 20): Promise<string> {
			const result = await run(
				'journalctl',
				[
					...scopeArguments(options.scope),
					'-u',
					UNIT_NAME,
					'--no-pager',
					'-n',
					String(lines),
				],
				options,
			);
			return (result.stdout || result.stderr).trim();
		},
		/**
		 * A user unit stops when its owner logs out unless lingering is on, so a
		 * user-scope server would die the moment the operator disconnected.
		 */
		async enableLinger(user: string): Promise<CommandResult> {
			return run('loginctl', ['enable-linger', user], options);
		},
	};
}

export type Systemd = ReturnType<typeof createSystemd>;
