import { EXTENSION_LIMITS } from './constants.js';
import type { Disposable, ExtensionIcon, ExtensionPlatform } from './types.js';

/**
 * Terminal launchers start an installed program, such as a coding agent, in a
 * new terminal at a user's click. The extension only says whether the program
 * is installed and where; the host creates the terminal, chooses its profile,
 * folder, and working directory, and types the path into its shell with no
 * arguments.
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

function optionalDetail(value: unknown): { detail?: string } {
	if (typeof value !== 'string') return {};
	const trimmed = value.replace(/\0/g, '').trim();
	if (trimmed.length === 0) return {};
	return {
		detail:
			trimmed.length > EXTENSION_LIMITS.launcherDetailLength
				? `${trimmed.slice(0, EXTENSION_LIMITS.launcherDetailLength - 1)}…`
				: trimmed,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(reason: string): { ok: false; reason: string } {
	return { ok: false, reason };
}
