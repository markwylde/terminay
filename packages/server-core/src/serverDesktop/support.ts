import { execFile } from 'node:child_process';
import { access, constants, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServerDesktopUnsupportedReason } from '@terminay/protocol';

/**
 * Whether this host can offer a desktop, and whether what the desktop needs
 * is installed. Nothing here starts a desktop process or changes the host.
 */

/** The Debian packages setup installs: the desktop session, then the browsers
 * people expect to find on a desktop. Compiled in: nothing a client or a file
 * says can add to or change this list. The desktop runs without the browsers,
 * so `REQUIRED_PROGRAMS` below does not name them. */
export const SERVER_DESKTOP_PACKAGES: readonly string[] = Object.freeze([
	'tigervnc-standalone-server',
	'tigervnc-tools',
	'xfwm4',
	'xfce4-panel',
	'xfce4-settings',
	'xfce4-terminal',
	'xfdesktop4',
	'x11-xserver-utils',
	'dbus-x11',
	'xauth',
	'fonts-dejavu-core',
	'fonts-noto-color-emoji',
	'adwaita-icon-theme',
	'python3',
	'python3-seccomp',
	'chromium',
	'firefox-esr',
]);

/** Where Debian installs programs. `PATH` is not consulted: the server's own
 * environment does not decide which display server Terminay runs. */
const PROGRAM_DIRECTORIES = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'] as const;

/** Each program the desktop runs, with the names Debian ships it under. */
const REQUIRED_PROGRAMS: Readonly<Record<string, readonly string[]>> = {
	displayServer: ['Xtigervnc'],
	passwordTool: ['tigervncpasswd', 'vncpasswd'],
	windowManager: ['xfwm4'],
	panel: ['xfce4-panel'],
	settings: ['xfsettingsd'],
	desktop: ['xfdesktop'],
	sessionBus: ['dbus-run-session'],
	screenSettings: ['xset'],
	shell: ['bash'],
	python: ['python3'],
};

export type ServerDesktopProgram = keyof typeof REQUIRED_PROGRAMS;

/** Where Debian's `python3-seccomp` puts its module. */
const SECCOMP_MODULE_DIRECTORY = '/usr/lib/python3/dist-packages';

export interface ServerDesktopHostFacts {
	readonly platform: string;
	/** The text of `/etc/os-release`, or undefined when there is none. */
	readonly osRelease: () => Promise<string | undefined>;
	/** The text of `/proc/self/mountinfo`, or undefined when unreadable. */
	readonly mountinfo: () => Promise<string | undefined>;
	/** Whether a file exists and may be executed. */
	readonly executable: (path: string) => Promise<boolean>;
	/** The names in a directory; empty when it cannot be read. */
	readonly list: (directory: string) => Promise<readonly string[]>;
	/** Whether the display server can be started without network access:
	 * the launcher's own probe, run with the installed programs. */
	readonly networkDenialWorks: (python: string) => Promise<boolean>;
}

export type ServerDesktopSupport =
	| {
			readonly supported: false;
			readonly reason: ServerDesktopUnsupportedReason;
			readonly message: string;
	  }
	| {
			readonly supported: true;
			/** Programs that are absent; empty when the desktop is set up. */
			readonly missing: readonly string[];
			/** Where each present program is. */
			readonly programs: Readonly<
				Partial<Record<ServerDesktopProgram, string>>
			>;
	  };

const MESSAGES: Readonly<Record<ServerDesktopUnsupportedReason, string>> = {
	'not-linux':
		'The server desktop needs a standalone server on Debian Linux, or the Terminay Docker image.',
	'not-debian':
		'The server desktop needs a standalone server on Debian Linux, or the Terminay Docker image. This host runs another distribution.',
	'private-temporary-directory':
		"The server's temporary directory is private to its service, so programs started in terminals could not reach the desktop. Reinstall or upgrade the service so it shares the host's /tmp.",
	'network-cannot-be-denied':
		'The display server cannot be started without network access on this host, so the desktop is not offered here.',
};

export function unsupported(
	reason: ServerDesktopUnsupportedReason,
): ServerDesktopSupport {
	return { supported: false, reason, message: MESSAGES[reason] };
}

/** The `ID` of an `os-release` file, unquoted, or undefined. */
export function osReleaseId(text: string | undefined): string | undefined {
	if (text === undefined) return undefined;
	for (const line of text.split('\n')) {
		const match = /^ID=(.*)$/u.exec(line.trim());
		if (match === null) continue;
		const value = (match[1] as string).trim();
		const quoted = /^(["'])(.*)\1$/u.exec(value);
		return (quoted === null ? value : (quoted[2] as string)).trim();
	}
	return undefined;
}

/**
 * Whether `/proc/self/mountinfo` shows `/tmp` as a systemd private temporary
 * directory: the mount at `/tmp` whose root lies under `/systemd-private-`.
 * The last mount at a point is the visible one.
 */
export function temporaryDirectoryIsPrivate(mountinfo: string): boolean {
	let isPrivate = false;
	for (const line of mountinfo.split('\n')) {
		// id parent major:minor root mount-point options ... - type source super
		const fields = line.split(' ');
		if (fields.length < 5) continue;
		const decode = (field: string) =>
			field.replace(/\\([0-7]{3})/gu, (_match, octal: string) =>
				String.fromCharCode(Number.parseInt(octal, 8)),
			);
		if (decode(fields[4] as string) !== '/tmp') continue;
		isPrivate = decode(fields[3] as string).includes('/systemd-private-');
	}
	return isPrivate;
}

/**
 * Examine the host. The checks run in the order a person would fix them: the
 * platform, the distribution, the temporary directory, then the programs, and
 * last whether the display server can be denied the network, which can only
 * be tried once the programs it needs are there.
 */
export async function examineServerDesktopHost(
	facts: ServerDesktopHostFacts,
): Promise<ServerDesktopSupport> {
	if (facts.platform !== 'linux') return unsupported('not-linux');
	if (osReleaseId(await facts.osRelease()) !== 'debian')
		return unsupported('not-debian');
	const mountinfo = await facts.mountinfo();
	if (mountinfo !== undefined && temporaryDirectoryIsPrivate(mountinfo))
		return unsupported('private-temporary-directory');

	const programs: Partial<Record<ServerDesktopProgram, string>> = {};
	const missing: string[] = [];
	for (const [program, names] of Object.entries(REQUIRED_PROGRAMS)) {
		let found: string | undefined;
		for (const name of names) {
			for (const directory of PROGRAM_DIRECTORIES) {
				const candidate = join(directory, name);
				if (await facts.executable(candidate)) {
					found = candidate;
					break;
				}
			}
			if (found !== undefined) break;
		}
		if (found === undefined) missing.push(names[0] as string);
		else programs[program] = found;
	}
	const modules = await facts.list(SECCOMP_MODULE_DIRECTORY);
	if (!modules.some((name) => /^seccomp(\.|$)/u.test(name)))
		missing.push('python3-seccomp');
	if (missing.length > 0) return { supported: true, missing, programs };

	if (!(await facts.networkDenialWorks(programs.python as string)))
		return unsupported('network-cannot-be-denied');
	return { supported: true, missing: [], programs };
}

/** The facts of the machine this process runs on. */
export function hostFacts(launcher: string): ServerDesktopHostFacts {
	const read = (path: string) =>
		readFile(path, 'utf8').then(
			(text) => text,
			() => undefined,
		);
	return {
		platform: process.platform,
		osRelease: () => read('/etc/os-release'),
		mountinfo: () => read('/proc/self/mountinfo'),
		executable: (path) =>
			access(path, constants.X_OK).then(
				() => true,
				() => false,
			),
		list: (directory) =>
			readdir(directory).then(
				(names) => names,
				() => [],
			),
		networkDenialWorks: (python) =>
			new Promise<boolean>((resolve) => {
				// The launcher installs its filter and then tries the very thing
				// the filter forbids. Exit 0 means it was refused.
				execFile(
					python,
					['-I', launcher, '--probe'],
					{ timeout: 10_000, env: {} as NodeJS.ProcessEnv },
					(error) => resolve(error === null),
				);
			}),
	};
}
