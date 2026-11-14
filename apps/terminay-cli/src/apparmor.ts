import { execFile } from 'node:child_process';
import {
	chmod,
	chown,
	mkdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

/**
 * The `terminay-bot` AppArmor profile (ADR-0120).
 *
 * On a kernel where AppArmor mediates user namespaces, Docker's
 * `docker-default` profile refuses them, and Chromium's sandbox cannot start
 * in a bot container. This profile is Moby's `docker-default` template, pinned
 * at `v28.0.0` (`profiles/apparmor/template.go`) and rendered the way Moby
 * renders it when `tunables/global` and `abstractions/base` exist, with one
 * added rule: `userns,`. Every other rule is kept.
 *
 * Only root writes it, and only for a system-scope install. The server never
 * writes policy; it asks the engine whether the profile is loaded.
 */

export const BOT_APPARMOR_PROFILE_NAME = 'terminay-bot';
export const BOT_APPARMOR_PROFILE_PATH = '/etc/apparmor.d/terminay-bot';

export const BOT_APPARMOR_PROFILE = `# Managed by Terminay. Docker's default container profile (Moby v28.0.0
# profiles/apparmor/template.go) plus \`userns,\`, so Chromium's sandbox can
# create its user namespace in a bot container. See ADR-0120.

#include <tunables/global>

profile terminay-bot flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  network,
  capability,
  file,
  umount,
  # Chromium's sandbox creates a user namespace. The only rule added to
  # Docker's default profile.
  userns,
  # Host (privileged) processes may send signals to container processes.
  signal (receive) peer=unconfined,
  # runc may send signals to container processes (for "docker stop").
  signal (receive) peer=runc,
  # crun may send signals to container processes (for "docker stop" when used with crun OCI runtime).
  signal (receive) peer=crun,
  # dockerd may send signals to container processes (for "docker kill").
  signal (receive) peer=unconfined,
  # Container processes may send signals amongst themselves.
  signal (send,receive) peer=terminay-bot,

  deny @{PROC}/* w,   # deny write for all files directly in /proc (not in a subdir)
  # deny write to files not in /proc/<number>/** or /proc/sys/**
  deny @{PROC}/{[^1-9],[^1-9][^0-9],[^1-9s][^0-9y][^0-9s],[^1-9][^0-9][^0-9][^0-9/]*}/** w,
  deny @{PROC}/sys/[^k]** w,  # deny /proc/sys except /proc/sys/k* (effectively /proc/sys/kernel)
  deny @{PROC}/sys/kernel/{?,??,[^s][^h][^m]**} w,  # deny everything except shm* in /proc/sys/kernel/
  deny @{PROC}/sysrq-trigger rwklx,
  deny @{PROC}/kcore rwklx,

  deny mount,

  deny /sys/[^f]*/** wklx,
  deny /sys/f[^s]*/** wklx,
  deny /sys/fs/[^c]*/** wklx,
  deny /sys/fs/c[^g]*/** wklx,
  deny /sys/fs/cg[^r]*/** wklx,
  deny /sys/firmware/** rwklx,
  deny /sys/devices/virtual/powercap/** rwklx,
  deny /sys/kernel/security/** rwklx,

  # suppress ptrace denials when using 'docker ps' or using 'ps' inside a container
  ptrace (trace,read,tracedby,readby) peer=terminay-bot,
}
`;

/** Everything the installer touches, so tests never touch the host. */
export interface AppArmorHost {
	/** Effective uid of this process: only root writes the profile. */
	readonly uid: number | undefined;
	readonly securityDirectory: string;
	readonly profilePath: string;
	readonly pathDirectories: readonly string[];
	readonly exists: (path: string) => Promise<boolean>;
	readonly readFile: (path: string) => Promise<string | undefined>;
	readonly stat: (
		path: string,
	) => Promise<{ uid: number; gid: number; mode: number } | undefined>;
	readonly mkdir: (path: string) => Promise<void>;
	readonly writeFile: (path: string, contents: string) => Promise<void>;
	readonly chown: (path: string, uid: number, gid: number) => Promise<void>;
	readonly chmod: (path: string, mode: number) => Promise<void>;
	readonly rename: (from: string, to: string) => Promise<void>;
	readonly remove: (path: string) => Promise<void>;
	readonly run: (file: string, args: readonly string[]) => Promise<void>;
}

const execFileAsync = promisify(execFile);
const PARSER_TIMEOUT_MS = 60_000;

export function defaultAppArmorHost(): AppArmorHost {
	return {
		uid: process.getuid?.(),
		securityDirectory: '/sys/kernel/security/apparmor',
		profilePath: BOT_APPARMOR_PROFILE_PATH,
		pathDirectories: [
			...(process.env.PATH ?? '').split(':').filter((entry) => entry !== ''),
			'/usr/sbin',
			'/sbin',
		],
		exists: async (path) =>
			(await stat(path).catch(() => undefined)) !== undefined,
		readFile: (path) => readFile(path, 'utf8').catch(() => undefined),
		stat: async (path) => {
			const found = await stat(path).catch(() => undefined);
			return found === undefined
				? undefined
				: { uid: found.uid, gid: found.gid, mode: found.mode & 0o7777 };
		},
		mkdir: async (path) => {
			await mkdir(path, { recursive: true, mode: 0o755 });
		},
		writeFile: (path, contents) => writeFile(path, contents, { mode: 0o644 }),
		chown: (path, uid, gid) => chown(path, uid, gid),
		chmod: (path, mode) => chmod(path, mode),
		rename: (from, to) => rename(from, to),
		remove: (path) => rm(path, { force: true }),
		run: async (file, args) => {
			await execFileAsync(file, [...args], { timeout: PARSER_TIMEOUT_MS });
		},
	};
}

export type AppArmorInstallResult =
	| { readonly status: 'skipped'; readonly reason: string }
	| { readonly status: 'loaded'; readonly wrote: boolean }
	| { readonly status: 'warning'; readonly warning: string };

function reasonOf(error: unknown): string {
	if (error instanceof Error) {
		const stderr = (error as { stderr?: unknown }).stderr;
		return typeof stderr === 'string' && stderr.trim() !== ''
			? (stderr.trim().split('\n')[0] ?? error.message)
			: error.message;
	}
	return String(error);
}

async function findParser(host: AppArmorHost): Promise<string | undefined> {
	for (const directory of host.pathDirectories) {
		const candidate = join(directory, 'apparmor_parser');
		if (await host.exists(candidate)) return candidate;
	}
	return undefined;
}

const warn = (step: string, error: unknown): AppArmorInstallResult => ({
	status: 'warning',
	warning: `Could not ${step} the ${BOT_APPARMOR_PROFILE_NAME} AppArmor profile (${reasonOf(error)}). Bot browsers on this host may not start their sandbox; see docs/operations/standalone-server.md.`,
});

/**
 * Write `/etc/apparmor.d/terminay-bot` (root, 0644) and load it.
 *
 * Never throws: bots still run without the profile, so a failure is a warning
 * for the command to print. A host without AppArmor, or without its parser, is
 * skipped quietly.
 */
export async function installBotAppArmorProfile(
	host: AppArmorHost = defaultAppArmorHost(),
): Promise<AppArmorInstallResult> {
	if (host.uid !== 0)
		return { status: 'skipped', reason: 'not running as root' };
	if (!(await host.exists(host.securityDirectory)))
		return { status: 'skipped', reason: 'AppArmor is not enabled' };
	const parser = await findParser(host);
	if (parser === undefined)
		return { status: 'skipped', reason: 'apparmor_parser is not installed' };

	const current = await host.readFile(host.profilePath);
	const found = await host.stat(host.profilePath);
	const right =
		current === BOT_APPARMOR_PROFILE &&
		found !== undefined &&
		found.uid === 0 &&
		found.gid === 0 &&
		found.mode === 0o644;
	let wrote = false;
	if (!right) {
		const temporary = `${host.profilePath}.terminay-${process.pid}`;
		try {
			await host.mkdir(dirname(host.profilePath));
			await host.writeFile(temporary, BOT_APPARMOR_PROFILE);
			await host.chown(temporary, 0, 0);
			await host.chmod(temporary, 0o644);
			await host.rename(temporary, host.profilePath);
			wrote = true;
		} catch (error) {
			await host.remove(temporary).catch(() => undefined);
			return warn('write', error);
		}
	}
	try {
		await host.run(parser, ['-r', '-W', host.profilePath]);
	} catch (error) {
		return warn('load', error);
	}
	return { status: 'loaded', wrote };
}

/**
 * Remove the profile's file, and leave the loaded profile alone: unloading it
 * would make running bot containers unconfined. It is gone at the next boot.
 */
export async function removeBotAppArmorProfile(
	host: AppArmorHost = defaultAppArmorHost(),
): Promise<boolean> {
	if (host.uid !== 0) return false;
	if ((await host.readFile(host.profilePath)) === undefined) return false;
	await host.remove(host.profilePath);
	return true;
}

/** Hidden: what `daemon upgrade` runs from the release it switched to. */
export const HOST_SETUP_COMMAND = 'host-setup';

/**
 * `terminay daemon host-setup`: root's per-release host setup. Not for people,
 * so not in the help. It takes no arguments and always exits 0 once it ran,
 * because a missing profile is a warning, not a failed upgrade.
 */
export async function runHostSetup(
	args: readonly string[],
	write: (line: string) => void,
	host: AppArmorHost = defaultAppArmorHost(),
): Promise<number> {
	if (args.length > 0) {
		write(`\`daemon ${HOST_SETUP_COMMAND}\` takes no arguments`);
		return 2;
	}
	if (host.uid !== 0) {
		write(`\`daemon ${HOST_SETUP_COMMAND}\` must run as root`);
		return 1;
	}
	reportAppArmorInstall(await installBotAppArmorProfile(host), write);
	return 0;
}

/** Print the outcome of an install the way every command does. */
export function reportAppArmorInstall(
	result: AppArmorInstallResult,
	write: (line: string) => void,
): void {
	if (result.status === 'warning') write(`Warning: ${result.warning}`);
	else if (result.status === 'loaded' && result.wrote)
		write(
			`Installed the ${BOT_APPARMOR_PROFILE_NAME} AppArmor profile, so bot browsers can start their sandbox.`,
		);
}
