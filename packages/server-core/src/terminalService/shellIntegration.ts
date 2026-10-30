import { lstatSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	encodeCommandDefaults,
	type TerminalCommandDefault,
} from './commandDefaults.js';
import { SHELL_INTEGRATION_SCRIPTS } from './shellIntegrationScripts.js';

/**
 * Shell integration (ADR-0082): a launch layer, added after shell-profile
 * resolution, that has a supported shell load the user's own startup files and
 * then run Terminay's fixed script. The first and only thing the script does
 * is define terminal command defaults as shell functions (ADR-0081).
 *
 * Integration is all or nothing. An unsupported shell, a WSL profile, profile
 * arguments Terminay does not recognise, or a runtime directory whose owner or
 * mode is wrong start the shell exactly as it would have started without it.
 */

export type IntegratedShell = 'zsh' | 'bash' | 'fish' | 'powershell';

export interface ShellIntegrationPlan {
	readonly shell: IntegratedShell;
	readonly login: boolean;
	/** Arguments the profile asked for that are kept as they are, such as `-NoLogo`. */
	readonly keptArgs: readonly string[];
}

/** Environment names integration sets or reads; never inherited from the server's own environment. */
export const SHELL_INTEGRATION_ENVIRONMENT_NAMES = Object.freeze([
	'TERMINAY_SHELL_INTEGRATION',
	'TERMINAY_COMMAND_DEFAULTS',
	'TERMINAY_SHELL_LOGIN',
	'TERMINAY_USER_ZDOTDIR',
] as const);

const POSIX_LOGIN_ARGS = new Set(['-l', '--login']);
const POSIX_INTERACTIVE_ARGS = new Set(['-i', '--interactive']);
const POSIX_COMBINED_ARGS = new Set(['-il', '-li']);
const POWERSHELL_LOGIN_ARGS = new Set(['-login', '-l']);
const POWERSHELL_IMPLIED_ARGS = new Set(['-nologo', '-nol']);

/**
 * Which integration a launch gets, or `undefined` when it gets none. Profile
 * arguments are accepted only when empty or exactly an interactive or login
 * form of that shell, the forms VS Code accepts.
 */
export function shellIntegrationPlan(
	shellPath: string,
	args: readonly string[],
	platform: NodeJS.Platform = process.platform,
): ShellIntegrationPlan | undefined {
	const shell = integratedShell(shellPath, platform);
	if (shell === undefined) return undefined;
	if (shell === 'powershell') {
		let login = false;
		const kept: string[] = [];
		for (const arg of args) {
			const lower = arg.toLowerCase();
			if (POWERSHELL_LOGIN_ARGS.has(lower) && !login) login = true;
			else if (POWERSHELL_IMPLIED_ARGS.has(lower) && kept.length === 0)
				kept.push(arg);
			else return undefined;
		}
		return Object.freeze({ shell, login, keptArgs: Object.freeze(kept) });
	}
	const meaningful = args.filter((arg) => !POSIX_INTERACTIVE_ARGS.has(arg));
	if (meaningful.length > 1) return undefined;
	const only = meaningful[0];
	if (only === undefined)
		return Object.freeze({ shell, login: false, keptArgs: Object.freeze([]) });
	if (
		POSIX_LOGIN_ARGS.has(only) ||
		(shell === 'zsh' && POSIX_COMBINED_ARGS.has(only))
	)
		return Object.freeze({ shell, login: true, keptArgs: Object.freeze([]) });
	return undefined;
}

function integratedShell(
	shellPath: string,
	platform: NodeJS.Platform,
): IntegratedShell | undefined {
	const name = shellPath
		.replace(/\\/gu, '/')
		.split('/')
		.at(-1)
		?.replace(/\.exe$/iu, '')
		.toLowerCase();
	if (name === 'pwsh' || name === 'powershell') return 'powershell';
	// On Windows a bash.exe may be WSL's launcher or Git Bash, whose paths
	// differ from the server's; only PowerShell is integrated there.
	if (platform === 'win32') return undefined;
	if (name === 'zsh' || name === 'bash' || name === 'fish') return name;
	return undefined;
}

export interface ShellIntegrationLaunch {
	readonly shellPath: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string | undefined>>;
}

export interface ShellIntegrationResult {
	readonly args: readonly string[];
	/** Values to set; `undefined` removes a name. */
	readonly env: Readonly<Record<string, string | undefined>>;
}

export interface ShellIntegrationOptions {
	/** The server's private directory for integration files, e.g. `<data root>/shell-integration`. */
	readonly directory: string;
	/** The Shell integration setting, read at each terminal start. */
	readonly enabled: () => boolean;
	/** The command defaults a terminal created now receives. */
	readonly commandDefaults: () => readonly TerminalCommandDefault[];
	readonly platform?: NodeJS.Platform;
}

const FILES = Object.freeze({
	bash: 'terminay.bash',
	fish: 'terminay.fish',
	powershell: 'terminay.ps1',
	zsh: 'zsh',
});

export class ShellIntegration {
	private readonly platform: NodeJS.Platform;
	private prepared: Promise<boolean> | undefined;

	constructor(private readonly options: ShellIntegrationOptions) {
		this.platform = options.platform ?? process.platform;
	}

	/**
	 * Arguments and environment that add integration to this launch, or
	 * `undefined` to start the shell without it.
	 */
	async inject(
		launch: ShellIntegrationLaunch,
	): Promise<ShellIntegrationResult | undefined> {
		if (!this.options.enabled()) return undefined;
		const plan = shellIntegrationPlan(
			launch.shellPath,
			launch.args,
			this.platform,
		);
		if (plan === undefined) return undefined;
		if (!(await this.ready())) return undefined;
		const directory = this.options.directory;
		const env: Record<string, string | undefined> = {
			TERMINAY_SHELL_INTEGRATION: '1',
		};
		const defaults = encodeCommandDefaults(this.options.commandDefaults());
		if (defaults.length > 0) env.TERMINAY_COMMAND_DEFAULTS = defaults;
		switch (plan.shell) {
			case 'zsh': {
				// zsh reads its startup files from ZDOTDIR; the user's value goes
				// along and is handed back once startup is over.
				const userZdotdir = launch.env.ZDOTDIR;
				if (userZdotdir !== undefined && userZdotdir.length > 0)
					env.TERMINAY_USER_ZDOTDIR = userZdotdir;
				env.ZDOTDIR = join(directory, FILES.zsh);
				return Object.freeze({
					args: Object.freeze([...launch.args]),
					env: Object.freeze(env),
				});
			}
			case 'bash':
				// --init-file cannot be combined with a login start, which the
				// script imitates instead.
				if (plan.login) env.TERMINAY_SHELL_LOGIN = '1';
				return Object.freeze({
					args: Object.freeze(['--init-file', join(directory, FILES.bash)]),
					env: Object.freeze(env),
				});
			case 'fish':
				return Object.freeze({
					args: Object.freeze([
						...(plan.login ? ['-l'] : []),
						'--init-command',
						`source ${fishQuoted(join(directory, FILES.fish))}`,
					]),
					env: Object.freeze(env),
				});
			case 'powershell':
				return Object.freeze({
					args: Object.freeze([
						...(plan.login ? ['-Login'] : []),
						...plan.keptArgs,
						'-NoExit',
						'-Command',
						`try { . ${powershellQuoted(join(directory, FILES.powershell))} } catch {}`,
					]),
					env: Object.freeze(env),
				});
		}
	}

	/** Write the scripts once, then check the directory before every use. */
	private async ready(): Promise<boolean> {
		if (!usablePath(this.options.directory)) return false;
		this.prepared ??= this.prepare().catch(() => false);
		if (!(await this.prepared)) {
			this.prepared = undefined;
			return false;
		}
		// Somebody may have loosened the directory since; then it is not used.
		if (
			!(await this.isPrivate(this.options.directory)) ||
			!(await this.isPrivate(join(this.options.directory, FILES.zsh)))
		) {
			this.prepared = undefined;
			return false;
		}
		return true;
	}

	private async prepare(): Promise<boolean> {
		const directory = this.options.directory;
		const zsh = join(directory, FILES.zsh);
		// Created owner-only; one that already exists and is not owner-only, or
		// is not ours, is never repaired or used.
		await mkdir(zsh, { recursive: true, mode: 0o700 });
		if (!(await this.isPrivate(directory)) || !(await this.isPrivate(zsh)))
			return false;
		const files: readonly [string, string][] = [
			[join(directory, FILES.bash), SHELL_INTEGRATION_SCRIPTS.bash],
			[join(directory, FILES.fish), SHELL_INTEGRATION_SCRIPTS.fish],
			[join(directory, FILES.powershell), SHELL_INTEGRATION_SCRIPTS.powershell],
			[join(zsh, '.zshenv'), SHELL_INTEGRATION_SCRIPTS.zshEnv],
			[join(zsh, '.zprofile'), SHELL_INTEGRATION_SCRIPTS.zshProfile],
			[join(zsh, '.zshrc'), SHELL_INTEGRATION_SCRIPTS.zshRc],
			[join(zsh, '.zlogin'), SHELL_INTEGRATION_SCRIPTS.zshLogin],
			[join(zsh, 'finish.zsh'), SHELL_INTEGRATION_SCRIPTS.zshFinish],
		];
		for (const [path, text] of files) {
			await writeFile(path, text, { mode: 0o600 });
			await chmod(path, 0o600);
		}
		return true;
	}

	/** A real directory (not a link), owned by this account. */
	private async owned(path: string): Promise<boolean> {
		const info = lstatSync(path);
		if (!info.isDirectory()) return false;
		if (this.platform === 'win32' || typeof process.getuid !== 'function')
			return true;
		return info.uid === process.getuid();
	}

	/** Owned by this account and writable by nobody else. */
	private async isPrivate(path: string): Promise<boolean> {
		try {
			const info = lstatSync(path);
			if (!(await this.owned(path))) return false;
			return this.platform === 'win32' || (info.mode & 0o022) === 0;
		} catch {
			return false;
		}
	}
}

/** A path a shell can be pointed at safely: absolute and free of control characters. */
function usablePath(path: string): boolean {
	return (
		path.length > 0 &&
		path.length <= 1_024 &&
		// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused
		!/[\u0000-\u001f\u007f]/u.test(path) &&
		(path.startsWith('/') || /^[A-Za-z]:\\/u.test(path))
	);
}

function fishQuoted(value: string): string {
	return `'${value.replace(/\\/gu, '\\\\').replace(/'/gu, "\\'")}'`;
}

function powershellQuoted(value: string): string {
	return `'${value.replace(/'/gu, "''")}'`;
}
