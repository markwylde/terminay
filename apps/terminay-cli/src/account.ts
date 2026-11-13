import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { basename } from 'node:path';
import { promisify } from 'node:util';

import type { InstallScope } from './args.js';
import {
	choose,
	defaultStreams,
	isInteractive,
	type PromptStreams,
} from './prompt.js';

/**
 * Choosing the scope of an install and the account the server runs as.
 *
 * The run-as account is the security decision in this whole command: the
 * daemon's terminals run as that user, so the choice decides whose files,
 * keys, and SSH agent the server can reach. The prompt says so, the dedicated
 * account is preselected, and naming a login user is deliberate rather than
 * incidental.
 */

const execFileAsync = promisify(execFile);

export const DEDICATED_ACCOUNT = 'terminay';
export const DEDICATED_HOME = '/var/lib/terminay';

const USER_NAME = /^[a-z_][a-z0-9_-]{0,31}$/u;

export class ScopeError extends Error {}

export interface ScopeSelection {
	readonly scope: InstallScope;
	readonly runAs: string;
	readonly home: string;
}

/**
 * Who is running this. `USER` is absent more often than it looks — a systemd
 * user session, a container, a cron job, and `sudo -u` all commonly have no
 * `USER` in the environment — so the passwd database is the authority and the
 * environment is only a hint.
 */
export function invokingUser(): string | undefined {
	const named = process.env.USER ?? process.env.LOGNAME;
	if (typeof named === 'string' && named.length > 0) return named;
	try {
		const name = userInfo().username;
		return typeof name === 'string' && name.length > 0 ? name : undefined;
	} catch {
		return undefined;
	}
}

export async function selectScope(options: {
	readonly requested?: InstallScope;
	readonly streams?: PromptStreams;
}): Promise<InstallScope> {
	if (options.requested !== undefined) return options.requested;
	const streams = options.streams ?? defaultStreams();
	if (!isInteractive(streams)) {
		throw new ScopeError(
			'no terminal is attached, so the install scope cannot be asked for. Pass --system for a system service or --user for a service owned by your login.',
		);
	}
	return choose(
		'Install Terminay Server for the whole machine, or just for your login?',
		[
			['system', 'System-wide service, started at boot (needs root)'],
			['user', 'User service, running as you and started when you log in'],
		],
		streams,
	);
}

export function assertRootForSystemScope(
	command: string,
	uid: number | undefined = process.getuid?.(),
): void {
	if (uid === 0) return;
	throw new ScopeError(
		`a system-wide install writes to /etc and /opt, so it needs root. Re-run it as: sudo ${command}`,
	);
}

/** Set on a re-run through `sudo`, so it is never re-run a second time. */
export const ELEVATED_ENV = 'TERMINAY_ELEVATED';

/**
 * The command line that runs this same CLI as root.
 *
 * Absolute paths to the running Node.js and entry script, never `npx`:
 * `sudo` replaces `PATH` with its `secure_path`, so a Node.js from nvm or fnm
 * under the user's home is not found by name once elevated. The scope the
 * operator already chose is passed as `--system` so it is not asked again.
 */
export function elevatedArguments(options: {
	readonly argv: readonly string[];
	readonly execPath?: string;
	readonly script?: string;
}): readonly string[] {
	const script = options.script ?? process.argv[1];
	if (script === undefined)
		throw new ScopeError('the path of this command could not be determined');
	const argv = [...options.argv];
	if (!argv.includes('--system')) argv.push('--system');
	return [options.execPath ?? process.execPath, script, ...argv];
}

/** Quote one argument for a POSIX shell, only when it needs it. */
export function shellQuote(argument: string): string {
	return /^[A-Za-z0-9_@%+=:,./-]+$/u.test(argument)
		? argument
		: `'${argument.replaceAll("'", "'\\''")}'`;
}

export type ElevationSpawner = (
	command: string,
	args: readonly string[],
) => Promise<number>;

const spawnInherited: ElevationSpawner = (command, args) =>
	new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code, signal) =>
			resolve(code ?? (signal === null ? 1 : 128)),
		);
	});

/**
 * Re-run a system-scope command as root through `sudo`, which asks for the
 * password itself. Returns the elevated run's exit status, or `undefined`
 * when it cannot be done here — no terminal to ask on, no `sudo`, or this is
 * already the re-run — and the caller explains instead.
 */
export async function elevateThroughSudo(options: {
	readonly arguments: readonly string[];
	readonly streams?: PromptStreams;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly spawner?: ElevationSpawner;
	readonly write?: (line: string) => void;
}): Promise<number | undefined> {
	const env = options.env ?? process.env;
	if (env[ELEVATED_ENV] === '1') return undefined;
	if (!isInteractive(options.streams ?? defaultStreams())) return undefined;
	options.write?.(
		'A system-wide install needs root. Re-running through sudo, which may ask for your password.',
	);
	try {
		return await (options.spawner ?? spawnInherited)('sudo', [
			'--',
			'env',
			`${ELEVATED_ENV}=1`,
			...options.arguments,
		]);
	} catch (error) {
		if ((error as { code?: unknown }).code === 'ENOENT') return undefined;
		throw error;
	}
}

async function userExists(name: string): Promise<boolean> {
	try {
		await execFileAsync('id', ['-u', name], { timeout: 30_000 });
		return true;
	} catch {
		return false;
	}
}

async function homeOf(name: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync('getent', ['passwd', name], {
			timeout: 30_000,
		});
		const home = stdout.split('\n')[0]?.split(':')[5];
		return home !== undefined && home.length > 0 ? home : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Shells that exist to refuse a login. The server starts the run-as account's
 * shell for every terminal, so with one of these every terminal exits the
 * moment it opens.
 */
const REFUSING_SHELLS = new Set(['nologin', 'false']);

export function isRefusingShell(shell: string | undefined): boolean {
	return shell === undefined || shell.length === 0
		? false
		: REFUSING_SHELLS.has(basename(shell));
}

/** The login shell the dedicated account is given. */
export function dedicatedLoginShell(
	exists: (path: string) => boolean = existsSync,
): string {
	return exists('/bin/bash') ? '/bin/bash' : '/bin/sh';
}

/** The account's login shell from the passwd database. */
export async function shellOf(name: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync('getent', ['passwd', name], {
			timeout: 30_000,
		});
		const shell = stdout.split('\n')[0]?.split(':')[6]?.trim();
		return shell !== undefined && shell.length > 0 ? shell : undefined;
	} catch {
		return undefined;
	}
}

async function createDedicatedAccount(): Promise<void> {
	await execFileAsync(
		'useradd',
		[
			'--system',
			'--home-dir',
			DEDICATED_HOME,
			'--create-home',
			'--shell',
			dedicatedLoginShell(),
			DEDICATED_ACCOUNT,
		],
		{ timeout: 60_000 },
	);
}

/**
 * Make sure the run-as account's terminals can start a shell.
 *
 * The dedicated account is ours, so a shell that refuses logins is replaced
 * and the operator is told. An account named with `--run-as` is a person's,
 * so it is only warned about.
 */
export async function ensureLoginShell(options: {
	readonly scope: InstallScope;
	readonly runAs: string;
	readonly write: (line: string) => void;
}): Promise<void> {
	if (options.scope !== 'system') return;
	const shell = await shellOf(options.runAs);
	if (!isRefusingShell(shell)) return;
	if (options.runAs === DEDICATED_ACCOUNT) {
		const replacement = dedicatedLoginShell();
		await execFileAsync('usermod', ['-s', replacement, DEDICATED_ACCOUNT], {
			timeout: 60_000,
		});
		options.write(
			`Set the login shell of \`${DEDICATED_ACCOUNT}\` from ${shell} to ${replacement}, so its terminals can start.`,
		);
		return;
	}
	options.write(
		`WARNING: the login shell of \`${options.runAs}\` is ${shell}, so its terminals cannot start a shell. Fix it with: sudo usermod -s /bin/bash ${options.runAs}`,
	);
}

export async function selectRunAs(options: {
	readonly scope: InstallScope;
	readonly requested?: string;
	readonly streams?: PromptStreams;
	readonly currentUser?: string;
}): Promise<ScopeSelection> {
	if (options.scope === 'user') {
		const user = options.currentUser ?? invokingUser();
		if (user === undefined || user.length === 0)
			throw new ScopeError('the invoking user could not be determined');
		if (options.requested !== undefined && options.requested !== user) {
			throw new ScopeError(
				'--run-as cannot be used with a user-scope install: the service always runs as you.',
			);
		}
		const home = (await homeOf(user)) ?? process.env.HOME;
		if (home === undefined)
			throw new ScopeError(
				`the home directory of ${user} could not be determined`,
			);
		return Object.freeze({ scope: options.scope, runAs: user, home });
	}

	if (options.requested !== undefined) {
		if (!USER_NAME.test(options.requested))
			throw new ScopeError(
				`--run-as is not a valid account name: ${options.requested}`,
			);
		// Checked before anything is written, so a typo does not leave a
		// half-installed service behind.
		if (!(await userExists(options.requested))) {
			throw new ScopeError(
				`--run-as names an account that does not exist on this machine: ${options.requested}`,
			);
		}
		const home = await homeOf(options.requested);
		if (home === undefined)
			throw new ScopeError(
				`the home directory of ${options.requested} could not be determined`,
			);
		return Object.freeze({
			scope: options.scope,
			runAs: options.requested,
			home,
		});
	}

	const streams = options.streams ?? defaultStreams();
	let choice: 'dedicated' | 'login' = 'dedicated';
	if (isInteractive(streams)) {
		choice = await choose(
			'Which account should the server and its terminals run as?\nThis decides whose files, keys, and agents a paired device can reach.',
			[
				[
					'dedicated',
					`A dedicated \`${DEDICATED_ACCOUNT}\` account with its own home (recommended)`,
				],
				['login', 'An existing login user, named with --run-as'],
			],
			streams,
		);
	}
	if (choice === 'login') {
		throw new ScopeError(
			're-run the install with --run-as <user> to name the login account the server should run as.',
		);
	}
	if (!(await userExists(DEDICATED_ACCOUNT))) await createDedicatedAccount();
	return Object.freeze({
		scope: options.scope,
		runAs: DEDICATED_ACCOUNT,
		home: DEDICATED_HOME,
	});
}

/** The data root is the trust boundary, so it is owner-only from the start. */
export async function prepareDataRoot(
	dataRoot: string,
	runAs: string,
	scope: InstallScope,
): Promise<void> {
	await mkdir(dataRoot, { recursive: true, mode: 0o700 });
	await chmod(dataRoot, 0o700);
	if (scope !== 'system') return;
	await execFileAsync('chown', ['-R', `${runAs}:${runAs}`, dataRoot], {
		timeout: 60_000,
	});
}
