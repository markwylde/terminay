import { execFile } from 'node:child_process';
import { chmod, mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';

import type { InstallScope } from './args.js';
import { type PromptStreams, choose, defaultStreams, isInteractive } from './prompt.js';

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

export function assertRootForSystemScope(command: string, uid: number | undefined = process.getuid?.()): void {
	if (uid === 0) return;
	throw new ScopeError(`a system-wide install writes to /etc and /opt, so it needs root. Re-run it as: sudo ${command}`);
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
		const { stdout } = await execFileAsync('getent', ['passwd', name], { timeout: 30_000 });
		const home = stdout.split('\n')[0]?.split(':')[5];
		return home !== undefined && home.length > 0 ? home : undefined;
	} catch {
		return undefined;
	}
}

async function createDedicatedAccount(): Promise<void> {
	await execFileAsync(
		'useradd',
		['--system', '--home-dir', DEDICATED_HOME, '--create-home', '--shell', '/usr/sbin/nologin', DEDICATED_ACCOUNT],
		{ timeout: 60_000 },
	);
}

export async function selectRunAs(options: {
	readonly scope: InstallScope;
	readonly requested?: string;
	readonly streams?: PromptStreams;
	readonly currentUser?: string;
}): Promise<ScopeSelection> {
	if (options.scope === 'user') {
		const user = options.currentUser ?? process.env.USER ?? process.env.LOGNAME;
		if (user === undefined || user.length === 0) throw new ScopeError('the invoking user could not be determined');
		if (options.requested !== undefined && options.requested !== user) {
			throw new ScopeError('--run-as cannot be used with a user-scope install: the service always runs as you.');
		}
		const home = (await homeOf(user)) ?? process.env.HOME;
		if (home === undefined) throw new ScopeError(`the home directory of ${user} could not be determined`);
		return Object.freeze({ scope: options.scope, runAs: user, home });
	}

	if (options.requested !== undefined) {
		if (!USER_NAME.test(options.requested)) throw new ScopeError(`--run-as is not a valid account name: ${options.requested}`);
		// Checked before anything is written, so a typo does not leave a
		// half-installed service behind.
		if (!(await userExists(options.requested))) {
			throw new ScopeError(`--run-as names an account that does not exist on this machine: ${options.requested}`);
		}
		const home = (await homeOf(options.requested));
		if (home === undefined) throw new ScopeError(`the home directory of ${options.requested} could not be determined`);
		return Object.freeze({ scope: options.scope, runAs: options.requested, home });
	}

	const streams = options.streams ?? defaultStreams();
	let choice: 'dedicated' | 'login' = 'dedicated';
	if (isInteractive(streams)) {
		choice = await choose(
			'Which account should the server and its terminals run as?\nThis decides whose files, keys, and agents a paired device can reach.',
			[
				['dedicated', `A dedicated \`${DEDICATED_ACCOUNT}\` account with its own home (recommended)`],
				['login', 'An existing login user, named with --run-as'],
			],
			streams,
		);
	}
	if (choice === 'login') {
		throw new ScopeError('re-run the install with --run-as <user> to name the login account the server should run as.');
	}
	if (!(await userExists(DEDICATED_ACCOUNT))) await createDedicatedAccount();
	return Object.freeze({ scope: options.scope, runAs: DEDICATED_ACCOUNT, home: DEDICATED_HOME });
}

/** The data root is the trust boundary, so it is owner-only from the start. */
export async function prepareDataRoot(dataRoot: string, runAs: string, scope: InstallScope): Promise<void> {
	await mkdir(dataRoot, { recursive: true, mode: 0o700 });
	await chmod(dataRoot, 0o700);
	if (scope !== 'system') return;
	await execFileAsync('chown', ['-R', `${runAs}:${runAs}`, dataRoot], { timeout: 60_000 });
}
