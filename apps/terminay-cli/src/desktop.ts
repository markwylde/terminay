import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	access,
	chmod,
	constants,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import { connect, createServer, type Server } from 'node:net';
import { join } from 'node:path';

/**
 * `terminay daemon desktop install`: root installs what the server desktop
 * needs, from the host's own package manager.
 *
 * The command line is fixed. It takes no package, source, option, or path:
 * the list below is compiled in, and the one thing a caller decides is
 * whether to run it. The unprivileged server reaches it through a root
 * helper that runs exactly this (see `desktopHelper.ts`), so everything
 * here assumes the caller may be anything running as the run-as account.
 */

/** The Debian packages setup installs: the desktop session, then the browsers
 * people expect to find on a desktop. The same list the server names; a test
 * keeps the two in step. */
export const DESKTOP_PACKAGES: readonly string[] = Object.freeze([
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

/** Each program the desktop runs, with the names Debian ships it under. */
export const DESKTOP_PROGRAMS: readonly (readonly string[])[] = Object.freeze([
	['Xtigervnc'],
	['tigervncpasswd', 'vncpasswd'],
	['xfwm4'],
	['xfce4-panel'],
	['xfsettingsd'],
	['xfdesktop'],
	['dbus-run-session'],
	['xset'],
	['bash'],
	['python3'],
]);

/**
 * The browsers setup installs, with the names Debian ships each under. The
 * desktop runs without them, so they are checked apart from its programs: a
 * host that lacks one is still set up, and setup run again adds it.
 */
export const DESKTOP_BROWSERS: readonly (readonly string[])[] = Object.freeze([
	['chromium'],
	['firefox-esr', 'firefox'],
]);

const PROGRAM_DIRECTORIES = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'] as const;
const SECCOMP_MODULE_DIRECTORY = '/usr/lib/python3/dist-packages';

export const DESKTOP_COMMAND = 'desktop';
export const DESKTOP_INSTALL_SUBCOMMAND = 'install';
/** Hidden: prints what this CLI's desktop setup can do, for a server deciding
 * whether the CLI it would run as root has the install command at all. */
export const DESKTOP_CHECK_SUBCOMMAND = 'check';

/** Where a run records how far it has got. Root-owned and world-readable:
 * the server reads it and cannot write it. */
export const DESKTOP_SETUP_STATUS_DIRECTORY = '/run/terminay-desktop-setup';
export const DESKTOP_SETUP_STATUS_FILE = 'status.json';
export const DESKTOP_SETUP_STATUS_VERSION = 1;

/** Set on the helper's oneshot. A helper run lasts at least
 * `HELPER_MINIMUM_RUN_MS`, so however often its trigger is touched, root
 * starts it a bounded number of times a minute. */
export const DESKTOP_SETUP_HELPER_ENVIRONMENT = 'TERMINAY_DESKTOP_SETUP_HELPER';
export const HELPER_MINIMUM_RUN_MS = 10_000;

/** How long to wait for another package manager to let go of its lock. */
export const PACKAGE_LOCK_WAIT_SECONDS = 120;

export type DesktopSetupStep =
	| 'waiting'
	| 'preparing'
	| 'downloading'
	| 'installing';

export interface DesktopSetupStatus {
	readonly version: typeof DESKTOP_SETUP_STATUS_VERSION;
	/** Names this run, so a reader never takes an old run's outcome for it. */
	readonly run: string;
	readonly pid: number;
	readonly startedAt: number;
	readonly step: DesktopSetupStep;
	/** Completed part of the whole, 0 to 1. */
	readonly fraction: number;
	readonly outcome?:
		| { readonly ok: true }
		| {
				readonly ok: false;
				readonly step: DesktopSetupStep;
				readonly reason: string;
		  };
}

/** Exit statuses. */
export const DESKTOP_INSTALL_EXIT = Object.freeze({
	ok: 0,
	failed: 1,
	usage: 2,
	/** Not Debian: nothing was attempted. */
	unsupported: 3,
	/** Another run holds the lock; its status file says how it is going. */
	busy: 75,
});

export interface DesktopInstallHost {
	readonly uid: number | undefined;
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly platform: string;
	readonly osRelease: () => Promise<string | undefined>;
	readonly executable: (path: string) => Promise<boolean>;
	readonly list: (directory: string) => Promise<readonly string[]>;
	readonly statusDirectory: string;
	/** The package manager's programs. Absolute: `PATH` does not choose what
	 * root runs. */
	readonly aptGet: string;
	readonly dpkg: string;
	readonly now: () => number;
	readonly sleep: (ms: number) => Promise<void>;
	readonly pid: number;
}

export function defaultDesktopInstallHost(): DesktopInstallHost {
	return {
		uid: process.getuid?.(),
		env: process.env,
		platform: process.platform,
		osRelease: () =>
			readFile('/etc/os-release', 'utf8').then(
				(text) => text,
				() => undefined,
			),
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
		statusDirectory: DESKTOP_SETUP_STATUS_DIRECTORY,
		aptGet: '/usr/bin/apt-get',
		dpkg: '/usr/bin/dpkg',
		now: () => Date.now(),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		pid: process.pid,
	};
}

/** The `ID` of an `os-release` file, unquoted. */
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

/** Which of `programs` are not there, each by its first name. */
async function missingPrograms(
	host: Pick<DesktopInstallHost, 'executable'>,
	programs: readonly (readonly string[])[],
): Promise<string[]> {
	const missing: string[] = [];
	for (const names of programs) {
		let found = false;
		for (const name of names) {
			for (const directory of PROGRAM_DIRECTORIES)
				if (await host.executable(join(directory, name))) {
					found = true;
					break;
				}
			if (found) break;
		}
		if (!found) missing.push(names[0] as string);
	}
	return missing;
}

/** What the desktop needs that is not there. */
export async function missingDesktopPrograms(
	host: Pick<DesktopInstallHost, 'executable' | 'list'>,
): Promise<readonly string[]> {
	const missing = await missingPrograms(host, DESKTOP_PROGRAMS);
	const modules = await host.list(SECCOMP_MODULE_DIRECTORY);
	if (!modules.some((name) => /^seccomp(\.|$)/u.test(name)))
		missing.push('python3-seccomp');
	return missing;
}

/** The browsers setup installs that are not there. */
export function missingDesktopBrowsers(
	host: Pick<DesktopInstallHost, 'executable'>,
): Promise<readonly string[]> {
	return missingPrograms(host, DESKTOP_BROWSERS);
}

/** Everything setup installs that is not there: what decides whether a run
 * has anything to do. */
export async function missingDesktopInstall(
	host: Pick<DesktopInstallHost, 'executable' | 'list'>,
): Promise<readonly string[]> {
	return [
		...(await missingDesktopPrograms(host)),
		...(await missingDesktopBrowsers(host)),
	];
}

/**
 * The environment the package manager runs in: built here, never inherited.
 * Nothing the caller's environment says reaches apt or a maintainer script.
 */
export function packageManagerEnvironment(): Record<string, string> {
	return {
		PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
		HOME: '/root',
		LANG: 'C.UTF-8',
		LC_ALL: 'C.UTF-8',
		DEBIAN_FRONTEND: 'noninteractive',
		APT_LISTCHANGES_FRONTEND: 'none',
		NEEDRESTART_MODE: 'l',
		NEEDRESTART_SUSPEND: '1',
	};
}

/** One line of apt's status descriptor, as progress of that phase. */
export function parseAptStatusLine(
	line: string,
):
	| { readonly phase: 'download' | 'install'; readonly percent: number }
	| undefined {
	const [kind, , percent] = line.split(':');
	const value = Number(percent);
	if (!Number.isFinite(value)) return undefined;
	const bounded = Math.min(100, Math.max(0, value));
	if (kind === 'dlstatus') return { phase: 'download', percent: bounded };
	if (kind === 'pmstatus') return { phase: 'install', percent: bounded };
	return undefined;
}

const STEP_WORDS: Readonly<Record<DesktopSetupStep, string>> = Object.freeze({
	waiting: 'Waiting for the package manager',
	preparing: 'Reading the package lists',
	downloading: 'Downloading packages',
	installing: 'Installing packages',
});

/** Where each phase sits in the whole. */
const FRACTIONS: Readonly<
	Record<'preparing' | 'downloading' | 'installing', readonly [number, number]>
> = Object.freeze({
	preparing: [0.02, 0.1],
	downloading: [0.1, 0.5],
	installing: [0.5, 1],
});

interface RunResult {
	readonly code: number;
	readonly output: string;
}

function run(
	file: string,
	args: readonly string[],
	onStatus?: (line: string) => void,
): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn(file, [...args], {
			env: packageManagerEnvironment(),
			cwd: '/',
			stdio: [
				'ignore',
				'pipe',
				'pipe',
				onStatus === undefined ? 'ignore' : 'pipe',
			],
		});
		let output = '';
		const keep = (chunk: Buffer) => {
			output = (output + chunk.toString('utf8')).slice(-8192);
		};
		child.stdout?.on('data', keep);
		child.stderr?.on('data', keep);
		if (onStatus !== undefined) {
			let pending = '';
			(child.stdio[3] as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
				pending += chunk.toString('utf8');
				let end = pending.indexOf('\n');
				while (end >= 0) {
					onStatus(pending.slice(0, end));
					pending = pending.slice(end + 1);
					end = pending.indexOf('\n');
				}
			});
		}
		child.once('error', (error) =>
			resolve({ code: 127, output: error.message }),
		);
		child.once('close', (code, signal) =>
			resolve({
				code: code ?? 128,
				output: signal === null ? output : `${output}\nended by ${signal}`,
			}),
		);
	});
}

/** The last lines of a package manager's output, as a reason. */
function reasonFrom(output: string, fallback: string): string {
	const lines = output
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const errors = lines.filter((line) => /^(E:|dpkg: error|Err:)/u.test(line));
	return (
		(errors.length > 0 ? errors : lines.slice(-3)).join(' ').slice(0, 1024) ||
		fallback
	);
}

/**
 * A lock the kernel holds: a listening socket in the root-owned status
 * directory. It is gone the moment the process is, however it ends.
 */
async function acquireLock(path: string): Promise<Server | undefined> {
	for (let attempt = 0; attempt < 2; attempt++) {
		const server = createServer();
		const bound = await new Promise<boolean>((resolve) => {
			server.once('error', () => resolve(false));
			server.listen(path, () => resolve(true));
		});
		if (bound) return server;
		// Something is at the path: a live run, or what a killed one left.
		const live = await new Promise<boolean>((resolve) => {
			const probe = connect(path);
			probe.once('connect', () => {
				probe.destroy();
				resolve(true);
			});
			probe.once('error', () => resolve(false));
		});
		if (live) return undefined;
		await rm(path, { force: true });
	}
	return undefined;
}

export async function readDesktopSetupStatus(
	directory: string = DESKTOP_SETUP_STATUS_DIRECTORY,
): Promise<DesktopSetupStatus | undefined> {
	try {
		const value = JSON.parse(
			await readFile(join(directory, DESKTOP_SETUP_STATUS_FILE), 'utf8'),
		) as DesktopSetupStatus;
		return value?.version === DESKTOP_SETUP_STATUS_VERSION &&
			typeof value.run === 'string'
			? value
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * `terminay daemon desktop install`.
 *
 * Anything after `install` is refused: there is nothing to choose.
 */
export async function runDesktopInstall(
	args: readonly string[],
	write: (line: string) => void,
	host: DesktopInstallHost = defaultDesktopInstallHost(),
): Promise<number> {
	if (args.length > 0) {
		write('`daemon desktop install` takes no arguments');
		return DESKTOP_INSTALL_EXIT.usage;
	}
	if (
		host.platform !== 'linux' ||
		osReleaseId(await host.osRelease()) !== 'debian'
	) {
		write(
			'The server desktop is set up on Debian Linux only. Nothing was installed.',
		);
		return DESKTOP_INSTALL_EXIT.unsupported;
	}
	if (host.uid !== 0) {
		write('`daemon desktop install` must run as root');
		return DESKTOP_INSTALL_EXIT.failed;
	}

	await mkdir(host.statusDirectory, { recursive: true, mode: 0o755 });
	await chmod(host.statusDirectory, 0o755);
	const lock = await acquireLock(join(host.statusDirectory, 'lock'));
	if (lock === undefined) {
		write('Desktop setup is already running.');
		return DESKTOP_INSTALL_EXIT.busy;
	}

	const started = host.now();
	const identity = randomUUID();
	let current: DesktopSetupStatus = {
		version: DESKTOP_SETUP_STATUS_VERSION,
		run: identity,
		pid: host.pid,
		startedAt: started,
		step: 'waiting',
		fraction: 0,
	};
	const statusPath = join(host.statusDirectory, DESKTOP_SETUP_STATUS_FILE);
	let writing: Promise<void> = Promise.resolve();
	/** Written whole to a second file and renamed, so a reader never sees
	 * half a status. */
	const record = (change: Partial<DesktopSetupStatus>): Promise<void> => {
		current = { ...current, ...change };
		say();
		const snapshot = `${JSON.stringify(current)}\n`;
		writing = writing.then(async () => {
			const temporary = `${statusPath}.${host.pid}.tmp`;
			await writeFile(temporary, snapshot, { mode: 0o644 });
			await chmod(temporary, 0o644);
			await rename(temporary, statusPath);
		});
		return writing;
	};
	// The terminal is told each step, and each tenth of the whole.
	let said = '';
	const say = () => {
		if (current.outcome !== undefined) return;
		const line = `${STEP_WORDS[current.step]} (${Math.floor(current.fraction * 10) * 10}%)`;
		if (line === said) return;
		said = line;
		write(line);
	};
	const progress = (step: keyof typeof FRACTIONS, percent: number) => {
		const [from, to] = FRACTIONS[step];
		const fraction = from + ((to - from) * percent) / 100;
		// Progress never runs backwards, whatever order apt reports in.
		if (step === current.step && fraction <= current.fraction) return;
		void record({ step, fraction: Math.max(current.fraction, fraction) });
	};
	const finish = async (
		outcome: NonNullable<DesktopSetupStatus['outcome']>,
	): Promise<number> => {
		await record(outcome.ok ? { fraction: 1, outcome } : { outcome });
		write(
			outcome.ok
				? 'The server desktop is set up.'
				: `Desktop setup failed: ${outcome.reason}`,
		);
		// See `HELPER_MINIMUM_RUN_MS`. The outcome is already recorded.
		if (host.env[DESKTOP_SETUP_HELPER_ENVIRONMENT] === '1') {
			const remaining = HELPER_MINIMUM_RUN_MS - (host.now() - started);
			if (remaining > 0) await host.sleep(remaining);
		}
		await new Promise<void>((resolve) => lock.close(() => resolve()));
		return outcome.ok ? DESKTOP_INSTALL_EXIT.ok : DESKTOP_INSTALL_EXIT.failed;
	};

	try {
		await record({});
		// Already there: nothing is downloaded and the network is not touched.
		if ((await missingDesktopInstall(host)).length === 0) {
			write('Everything the server desktop needs is already installed.');
			return await finish({ ok: true });
		}

		// An install that was interrupted, this one's or anyone's, is finished
		// first: apt refuses to do anything else until it is.
		await record({ step: 'preparing', fraction: FRACTIONS.preparing[0] });
		const waitUntil = host.now() + PACKAGE_LOCK_WAIT_SECONDS * 1000;
		while (true) {
			const configured = await run(host.dpkg, ['--configure', '-a']);
			if (configured.code === 0) break;
			if (!/lock/iu.test(configured.output) || host.now() >= waitUntil)
				return await finish({
					ok: false,
					step: 'preparing',
					reason: reasonFrom(
						configured.output,
						'The package database could not be put right.',
					),
				});
			await host.sleep(2000);
		}

		const lockWait = ['-o', `DPkg::Lock::Timeout=${PACKAGE_LOCK_WAIT_SECONDS}`];
		const updated = await run(
			host.aptGet,
			['update', ...lockWait, '-o', 'APT::Status-Fd=3'],
			(line) => {
				const status = parseAptStatusLine(line);
				if (status?.phase === 'download') progress('preparing', status.percent);
			},
		);
		if (updated.code !== 0)
			return await finish({
				ok: false,
				step: 'preparing',
				reason: reasonFrom(
					updated.output,
					'The package lists could not be read.',
				),
			});

		await record({ step: 'downloading', fraction: FRACTIONS.downloading[0] });
		const installed = await run(
			host.aptGet,
			[
				'install',
				'--yes',
				'--no-install-recommends',
				...lockWait,
				'-o',
				'APT::Status-Fd=3',
				'-o',
				'Dpkg::Options::=--force-confdef',
				'-o',
				'Dpkg::Options::=--force-confold',
				'--',
				...DESKTOP_PACKAGES,
			],
			(line) => {
				const status = parseAptStatusLine(line);
				if (status === undefined) return;
				progress(
					status.phase === 'download' ? 'downloading' : 'installing',
					status.percent,
				);
			},
		);
		if (installed.code !== 0)
			return await finish({
				ok: false,
				step: current.step === 'installing' ? 'installing' : 'downloading',
				reason: reasonFrom(
					installed.output,
					'The packages could not be installed.',
				),
			});

		const missing = await missingDesktopInstall(host);
		if (missing.length > 0)
			return await finish({
				ok: false,
				step: 'installing',
				reason: `The packages installed, but these are still missing: ${missing.join(', ')}.`,
			});
		return await finish({ ok: true });
	} catch (error) {
		return await finish({
			ok: false,
			step: current.step,
			reason: error instanceof Error ? error.message : String(error),
		});
	}
}

/** `terminay daemon desktop check`: what this CLI's desktop setup offers. */
export function runDesktopCheck(
	args: readonly string[],
	write: (line: string) => void,
): number {
	if (args.length > 0) {
		write('`daemon desktop check` takes no arguments');
		return DESKTOP_INSTALL_EXIT.usage;
	}
	write(
		JSON.stringify({
			install: 1,
			statusFile: join(
				DESKTOP_SETUP_STATUS_DIRECTORY,
				DESKTOP_SETUP_STATUS_FILE,
			),
		}),
	);
	return 0;
}

/** `terminay daemon desktop <subcommand>`. */
export async function runDesktopCommand(
	args: readonly string[],
	write: (line: string) => void,
	host?: DesktopInstallHost,
): Promise<number> {
	if (args[0] === DESKTOP_INSTALL_SUBCOMMAND)
		return runDesktopInstall(args.slice(1), write, host);
	if (args[0] === DESKTOP_CHECK_SUBCOMMAND)
		return runDesktopCheck(args.slice(1), write);
	write('usage: terminay daemon desktop install');
	return DESKTOP_INSTALL_EXIT.usage;
}
