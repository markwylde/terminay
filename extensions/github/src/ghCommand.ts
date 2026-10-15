import { execFile } from 'node:child_process';
import type { GhTokenCommand } from './ghConfig.js';

const GH_TIMEOUT_MS = 5_000;
/** What `gh` needs to find its config and the keychain, and nothing else. */
const PASSED_ENV = [
	'PATH',
	'HOME',
	'USER',
	'LOGNAME',
	'USERPROFILE',
	'AppData',
	'LocalAppData',
	'SystemRoot',
	'TMPDIR',
	'XDG_CONFIG_HOME',
	'XDG_RUNTIME_DIR',
	'DBUS_SESSION_BUS_ADDRESS',
	'GH_CONFIG_DIR',
];
/** A desktop app's PATH often lacks where package managers put `gh`. */
const FALLBACK_BINARIES = [
	'/opt/homebrew/bin/gh',
	'/usr/local/bin/gh',
	'/usr/bin/gh',
];

/**
 * `gh auth token --hostname <host>`, run without a shell, with fixed
 * arguments, a timeout, and stderr discarded (ADR-0063). Tries `gh` on PATH,
 * then the usual install locations.
 */
export function createGhTokenCommand(options: {
	env: NodeJS.ProcessEnv;
	platform: NodeJS.Platform;
}): GhTokenCommand {
	const env: NodeJS.ProcessEnv = {};
	for (const name of PASSED_ENV)
		if (options.env[name] !== undefined) env[name] = options.env[name];
	const binaries =
		options.platform === 'win32' ? ['gh'] : ['gh', ...FALLBACK_BINARIES];
	return async (host) => {
		for (const binary of binaries) {
			const result = await run(binary, host, env);
			if (result === 'missing') continue;
			return result;
		}
		return undefined;
	};
}

function run(
	binary: string,
	host: string,
	env: NodeJS.ProcessEnv,
): Promise<string | undefined | 'missing'> {
	return new Promise((resolve) => {
		execFile(
			binary,
			['auth', 'token', '--hostname', host],
			{ env, timeout: GH_TIMEOUT_MS, windowsHide: true, maxBuffer: 16_384 },
			(error, stdout) => {
				if (error !== null) {
					resolve(
						(error as NodeJS.ErrnoException).code === 'ENOENT'
							? 'missing'
							: undefined,
					);
					return;
				}
				const token = String(stdout).trim();
				resolve(/^[\x21-\x7e]{1,1024}$/.test(token) ? token : undefined);
			},
		);
	});
}
