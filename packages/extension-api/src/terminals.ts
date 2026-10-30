import { EXTENSION_LIMITS } from './constants.js';
import type { Disposable, ExtensionIcon, ExtensionPlatform } from './types.js';

/**
 * Terminal launchers start an installed program, such as a coding agent, in a
 * new terminal at a user's click. The extension only says whether the program
 * is installed and where; the host creates the terminal, chooses its profile,
 * folder, and working directory, and types the path into its shell, followed
 * only by a matching command default's flags.
 */

/** The harness a launcher belongs to, declared by a session source of the same package. */
export interface TerminalLauncherHarness {
	/** A session source id this manifest declares. */
	source: string;
	/** A harness id that source declares. */
	harness: string;
}

/** Declarative metadata for one terminal launcher. */
export interface TerminalLauncherContribution {
	/** Namespaced: `<extensionId>/<local-id>`. */
	id: string;
	/** The program's name as Terminay shows it, e.g. `Claude Code`. */
	displayName: string;
	icon: ExtensionIcon;
	platforms?: ExtensionPlatform[];
	/** While this harness is switched off the launcher is not offered. */
	harness?: TerminalLauncherHarness;
}

export type TerminalLauncherUnavailableReason =
	| 'not_installed'
	| 'unsupported_platform';

export type TerminalLauncherResolution =
	| { available: true; executable: string }
	| {
			available: false;
			reason: TerminalLauncherUnavailableReason;
			detail?: string;
	  };

export interface TerminalLauncherRuntime {
	/** Where the program is installed on this server account, if it is. */
	resolve(signal: AbortSignal): Promise<TerminalLauncherResolution>;
}

export interface TerminalLauncherRegistration extends Disposable {
	readonly launcherId: string;
}

export interface TerminalLauncherRegistry {
	/**
	 * Registers a launcher this manifest contributed. An undeclared id, a
	 * second registration of the same id, or a registration after deactivation
	 * is refused.
	 */
	registerLauncher(
		launcherId: string,
		runtime: TerminalLauncherRuntime,
	): TerminalLauncherRegistration;
}

/**
 * Terminal command defaults add flags in front of the user's arguments when a
 * command runs in a Terminay terminal (ADR-0081). The manifest fixes the
 * command; the extension only says whether the default applies and which
 * flags it adds. Terminay writes every line of shell code and quoting itself.
 */
export interface TerminalCommandDefaultContribution {
	/** Namespaced: `<extensionId>/<local-id>`. */
	id: string;
	/** The command typed in a terminal, e.g. `codex`. */
	command: string;
	/** While this harness is switched off the default does not apply. */
	harness?: TerminalLauncherHarness;
}

export type TerminalCommandDefaultSkipReason =
	| 'not_installed'
	| 'unsupported'
	| 'unavailable';

export type TerminalCommandDefaultResolution =
	| { applies: true; args: string[] }
	| {
			applies: false;
			reason: TerminalCommandDefaultSkipReason;
			detail?: string;
	  };

export interface TerminalCommandDefaultRuntime {
	/** Whether the default applies on this server account now, and its flags. */
	resolve(signal: AbortSignal): Promise<TerminalCommandDefaultResolution>;
}

export interface TerminalCommandDefaultRegistration extends Disposable {
	readonly commandDefaultId: string;
}

/** What `context.terminals` offers: launchers and command defaults. */
export interface TerminalContributionRegistry extends TerminalLauncherRegistry {
	/**
	 * Registers a command default this manifest contributed. An undeclared id,
	 * a second registration of the same id, or a registration after
	 * deactivation is refused.
	 */
	registerCommandDefault(
		commandDefaultId: string,
		runtime: TerminalCommandDefaultRuntime,
	): TerminalCommandDefaultRegistration;
}

export function defineTerminalCommandDefault(
	runtime: TerminalCommandDefaultRuntime,
): TerminalCommandDefaultRuntime {
	return runtime;
}

export function defineTerminalLauncher(
	runtime: TerminalLauncherRuntime,
): TerminalLauncherRuntime {
	return runtime;
}

export type TerminalLauncherValidation<T> =
	| { ok: true; value: T }
	| { ok: false; reason: string };

const unavailableReasons: readonly string[] = [
	'not_installed',
	'unsupported_platform',
];

/**
 * Bounds a launcher's resolution before it reaches the host. An executable
 * that is not an absolute path, is too long, or holds a control character is
 * refused, so a launcher can name a file to run and nothing more.
 */
export function validateTerminalLauncherResolution(
	value: unknown,
): TerminalLauncherValidation<TerminalLauncherResolution> {
	if (!isRecord(value)) return invalid('resolution must be an object');
	if (value.available === true) {
		const executable = value.executable;
		if (!isExecutablePath(executable))
			return invalid('executable must be a bounded absolute path');
		return { ok: true, value: { available: true, executable } };
	}
	if (value.available !== false) return invalid('available must be a boolean');
	if (!unavailableReasons.includes(value.reason as string))
		return invalid('reason is invalid');
	return {
		ok: true,
		value: {
			available: false,
			reason: value.reason as TerminalLauncherUnavailableReason,
			...optionalDetail(value.detail),
		},
	};
}

/** An absolute POSIX or Windows path with no control characters. */
export function isExecutablePath(value: unknown): value is string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > EXTENSION_LIMITS.launcherExecutablePathLength
	)
		return false;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused
	if (/[\u0000-\u001f\u007f]/.test(value)) return false;
	return value.startsWith('/') || /^[A-Za-z]:\\/.test(value);
}

/**
 * Words no command default may claim: builtins and reserved words of the
 * shells Terminay integrates (zsh, bash, fish, PowerShell). Compared without
 * case, because PowerShell ignores it.
 */
// biome-ignore format: a compact word list reads better than one word per line
export const RESERVED_TERMINAL_COMMAND_NAMES: ReadonlySet<string> = new Set(
	[
		// POSIX and bash
		'alias', 'bg', 'bind', 'break', 'builtin', 'caller', 'case', 'cd',
		'command', 'compgen', 'complete', 'compopt', 'continue', 'coproc',
		'declare', 'dirs', 'disown', 'do', 'done', 'echo', 'elif', 'else',
		'enable', 'esac', 'eval', 'exec', 'exit', 'export', 'false', 'fc',
		'fg', 'fi', 'for', 'function', 'getopts', 'hash', 'help', 'history',
		'if', 'in', 'jobs', 'kill', 'let', 'local', 'logout', 'mapfile',
		'popd', 'printf', 'pushd', 'pwd', 'read', 'readarray', 'readonly',
		'return', 'select', 'set', 'shift', 'shopt', 'source', 'suspend',
		'test', 'then', 'time', 'times', 'trap', 'true', 'type', 'typeset',
		'ulimit', 'umask', 'unalias', 'unset', 'until', 'wait', 'while',
		// zsh
		'autoload', 'bindkey', 'bye', 'chdir', 'disable', 'emulate', 'float',
		'foreach', 'functions', 'integer', 'limit', 'nocorrect', 'noglob',
		'print', 'pushln', 'r', 'rehash', 'repeat', 'sched', 'setopt',
		'unfunction', 'unhash', 'unlimit', 'unsetopt', 'vared', 'whence',
		'where', 'which', 'zcompile', 'zformat', 'zle', 'zmodload',
		'zparseopts', 'zstyle',
		// fish
		'abbr', 'and', 'argparse', 'begin', 'block', 'commandline', 'contains',
		'count', 'emit', 'end', 'math', 'not', 'or', 'path', 'random',
		'realpath', 'set_color', 'status', 'string', 'switch',
		// PowerShell
		'catch', 'class', 'data', 'define', 'dynamicparam', 'elseif', 'filter',
		'finally', 'from', 'param', 'process', 'throw', 'try', 'using', 'var',
		'workflow',
	].map((name) => name.toLowerCase()),
);

/** A single plain word, starting with a letter, digit, or underscore. */
const COMMAND_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * Whether a command default may claim this name: one plain word, bounded, and
 * not a builtin or reserved word of a supported shell.
 */
export function isTerminalCommandName(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length <= EXTENSION_LIMITS.commandNameLength &&
		COMMAND_NAME_PATTERN.test(value) &&
		!RESERVED_TERMINAL_COMMAND_NAMES.has(value.toLowerCase())
	);
}

/**
 * Whether a list is a valid set of command default arguments: one or more,
 * bounded, each a flag (starting with `-`) with no control characters. A
 * default can add options but can never turn a command into a subcommand.
 */
export function isTerminalCommandDefaultArgs(
	value: unknown,
): value is string[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.length <= EXTENSION_LIMITS.commandDefaultArgs &&
		value.every(
			(arg) =>
				typeof arg === 'string' &&
				arg.startsWith('-') &&
				arg.length <= EXTENSION_LIMITS.commandDefaultArgLength &&
				// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused
				!/[\u0000-\u001f\u007f-\u009f]/.test(arg),
		)
	);
}

const skipReasons: readonly string[] = [
	'not_installed',
	'unsupported',
	'unavailable',
];

/** Bounds a command default's resolution before it reaches the host. */
export function validateTerminalCommandDefaultResolution(
	value: unknown,
): TerminalLauncherValidation<TerminalCommandDefaultResolution> {
	if (!isRecord(value)) return invalid('resolution must be an object');
	if (value.applies === true) {
		if (!isTerminalCommandDefaultArgs(value.args))
			return invalid('args must be bounded flags');
		return { ok: true, value: { applies: true, args: [...value.args] } };
	}
	if (value.applies !== false) return invalid('applies must be a boolean');
	if (!skipReasons.includes(value.reason as string))
		return invalid('reason is invalid');
	return {
		ok: true,
		value: {
			applies: false,
			reason: value.reason as TerminalCommandDefaultSkipReason,
			...optionalDetail(
				value.detail,
				EXTENSION_LIMITS.commandDefaultDetailLength,
			),
		},
	};
}

function optionalDetail(
	value: unknown,
	limit: number = EXTENSION_LIMITS.launcherDetailLength,
): { detail?: string } {
	if (typeof value !== 'string') return {};
	const trimmed = value.replace(/\0/g, '').trim();
	if (trimmed.length === 0) return {};
	return {
		detail:
			trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(reason: string): { ok: false; reason: string } {
	return { ok: false, reason };
}
