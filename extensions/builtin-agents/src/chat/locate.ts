import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

export type AgentExecutable = 'claude' | 'codex';

/** The absolute-path override for each agent, checked before anything else. */
export const OVERRIDE_VARIABLES: Readonly<Record<AgentExecutable, string>> =
	Object.freeze({
		claude: 'TERMINAY_CLAUDE_CODE_COMMAND',
		codex: 'TERMINAY_CODEX_COMMAND',
	});

const LOGIN_SHELL_TIMEOUT_MS = 3_000;

export type LocatorOptions = {
	env?: NodeJS.ProcessEnv;
	homeDirectory?: string;
	/** Replaces reading the login shell's PATH, for tests. */
	loginShellPath?: () => Promise<string | undefined>;
};

export type AgentLocator = {
	/** The absolute path of the agent's executable, or undefined when it is not installed. */
	locate(agent: AgentExecutable): Promise<string | undefined>;
};

/**
 * Finds the agent CLIs the user installed. A Desktop launched from the Dock
 * runs with a minimal PATH, so after the server's own PATH this asks the
 * login shell once and then tries the documented per-user locations. Results
 * last for one activation; nothing is polled.
 */
export function createAgentLocator(options: LocatorOptions = {}): AgentLocator {
	const env = options.env ?? process.env;
	const home = options.homeDirectory ?? homedir();
	const readLoginShellPath =
		options.loginShellPath ?? (() => loginShellPath(env));
	let loginPath: Promise<string | undefined> | undefined;
	const cache = new Map<AgentExecutable, Promise<string | undefined>>();

	const search = async (
		agent: AgentExecutable,
	): Promise<string | undefined> => {
		const override = env[OVERRIDE_VARIABLES[agent]];
		if (override !== undefined && override.length > 0)
			return isAbsolute(override) && (await isExecutable(override))
				? override
				: undefined;
		const found = await firstIn(directoriesOf(env.PATH), agent);
		if (found !== undefined) return found;
		loginPath ??= readLoginShellPath().catch(() => undefined);
		const fromLogin = await firstIn(directoriesOf(await loginPath), agent);
		if (fromLogin !== undefined) return fromLogin;
		return firstIn(await userDirectories(home), agent);
	};

	return {
		locate(agent) {
			let pending = cache.get(agent);
			if (pending === undefined) {
				pending = search(agent);
				cache.set(agent, pending);
			}
			return pending;
		},
	};
}

function directoriesOf(path: string | undefined): string[] {
	return (path ?? '')
		.split(delimiter)
		.filter((entry) => entry.length > 0 && isAbsolute(entry));
}

async function firstIn(
	directories: readonly string[],
	name: string,
): Promise<string | undefined> {
	for (const directory of directories) {
		const candidate = join(directory, name);
		if (await isExecutable(candidate)) return candidate;
	}
	return undefined;
}

async function isExecutable(path: string): Promise<boolean> {
	try {
		if (!(await stat(path)).isFile()) return false;
		await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** Where the agents' installers and common Node managers put executables. */
async function userDirectories(home: string): Promise<string[]> {
	const directories = [
		join(home, '.local', 'bin'),
		join(home, '.claude', 'local'),
		'/opt/homebrew/bin',
		'/usr/local/bin',
		join(home, '.npm-global', 'bin'),
		join(home, '.bun', 'bin'),
		join(home, '.volta', 'bin'),
	];
	try {
		const versions = await readdir(join(home, '.nvm', 'versions', 'node'));
		versions
			.sort((left, right) =>
				right.localeCompare(left, undefined, { numeric: true }),
			)
			.forEach((version) => {
				directories.push(
					join(home, '.nvm', 'versions', 'node', version, 'bin'),
				);
			});
	} catch {
		/* no nvm */
	}
	return directories;
}

/**
 * The PATH a login shell sets up. The shell only prints a variable; the agent
 * itself is never started through a shell.
 */
function loginShellPath(env: NodeJS.ProcessEnv): Promise<string | undefined> {
	const shell =
		env.SHELL !== undefined && isAbsolute(env.SHELL) ? env.SHELL : '/bin/sh';
	return new Promise((resolve) => {
		let output = '';
		let settled = false;
		const finish = (value: string | undefined): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};
		const child = spawn(shell, ['-lc', 'printf %s "$PATH"'], {
			env,
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			finish(undefined);
		}, LOGIN_SHELL_TIMEOUT_MS);
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			if (output.length < 64 * 1024) output += chunk;
		});
		child.on('error', () => finish(undefined));
		child.on('close', (code) =>
			finish(code === 0 && output.length > 0 ? output.trim() : undefined),
		);
	});
}
