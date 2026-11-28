import { execFile, spawn } from 'node:child_process';
import { constants, existsSync } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import type {
	ServerDesktopSetup,
	ServerDesktopSetupOutcome,
	ServerDesktopSetupProgress,
} from '@terminay/server-core';

/**
 * How a standalone server gets what the desktop needs installed.
 *
 * The server is unprivileged and never runs a package manager. It has two
 * ways to ask root, and neither carries anything a client or the server
 * chose: the install command takes no arguments and installs a list compiled
 * into the CLI.
 *
 * 1. A system-scope install: the server changes a file, and systemd, as root,
 *    answers by starting a unit whose command line is fixed (the desktop-setup
 *    helper, beside the upgrade helper).
 * 2. The official image, whose account is root-equivalent by design: `sudo -n`
 *    on the CLI in the image's root-owned release directory, with a cleared
 *    environment.
 *
 * Anywhere else it reports the command an operator runs. Either way the run
 * records how far it has got in a root-owned file, which the server reads.
 */

/** Written by `terminay daemon desktop install`. Root-owned; read only. */
export const DESKTOP_SETUP_STATUS_FILE =
	'/run/terminay-desktop-setup/status.json';
/** Names another status file to read; see `defaultDesktopSetupHost`. */
export const DESKTOP_SETUP_STATUS_FILE_ENV = 'TERMINAY_DESKTOP_SETUP_STATUS_FILE';
/** The helper's trigger, in a separate root-owned directory. */
export const DESKTOP_SETUP_REQUEST_DIRECTORY = 'terminay-desktop-setup';
export const DESKTOP_SETUP_REQUEST_FILE = 'desktop-setup';
/** The official image's release directory. */
export const IMAGE_RELEASE_DIRECTORY = '/opt/terminay';

/** How long a triggered run is given to show itself. */
export const SETUP_START_WAIT_MS = 45_000;
/** The helper's own deadline, and a little. */
export const SETUP_DEADLINE_MS = 22 * 60 * 1000;

const STEPS = ['waiting', 'preparing', 'downloading', 'installing'] as const;
type Step = (typeof STEPS)[number];

/** A run's record, as the CLI writes it. */
export interface DesktopSetupRecord {
	readonly run: string;
	readonly pid: number;
	readonly step: Step;
	readonly fraction: number;
	readonly outcome?:
		| { readonly ok: true }
		| { readonly ok: false; readonly step?: Step; readonly reason: string };
}

export function parseDesktopSetupRecord(
	text: string | undefined,
): DesktopSetupRecord | undefined {
	if (text === undefined) return undefined;
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof value !== 'object' || value === null) return undefined;
	const record = value as Record<string, unknown>;
	if (record.version !== 1) return undefined;
	if (typeof record.run !== 'string' || record.run.length === 0)
		return undefined;
	if (typeof record.pid !== 'number' || !Number.isInteger(record.pid))
		return undefined;
	const step = STEPS.find((name) => name === record.step);
	if (step === undefined) return undefined;
	const fraction =
		typeof record.fraction === 'number' && Number.isFinite(record.fraction)
			? Math.min(1, Math.max(0, record.fraction))
			: 0;
	let outcome: DesktopSetupRecord['outcome'];
	if (typeof record.outcome === 'object' && record.outcome !== null) {
		const given = record.outcome as Record<string, unknown>;
		if (given.ok === true) outcome = { ok: true };
		else if (given.ok === false) {
			const failed = STEPS.find((name) => name === given.step);
			outcome = {
				ok: false,
				...(failed === undefined ? {} : { step: failed }),
				reason:
					typeof given.reason === 'string' && given.reason.length > 0
						? given.reason.slice(0, 2048)
						: 'Setup failed.',
			};
		}
	}
	return {
		run: record.run,
		pid: record.pid,
		step,
		fraction,
		...(outcome === undefined ? {} : { outcome }),
	};
}

export interface CommandResult {
	/** `undefined` when the program could not be started at all. */
	readonly code: number | undefined;
	readonly output: string;
}

/** What the server's machine can be asked. Tests supply their own. */
export interface DesktopSetupHost {
	readonly env: Readonly<Record<string, string | undefined>>;
	/** The upgrade helper's request file, when this install has one. */
	readonly upgradeRequestFile: () => Promise<string | undefined>;
	/** Owner and kind of a path; `undefined` when it is not there. */
	readonly stat: (path: string) => Promise<
		| {
				readonly uid: number;
				readonly mode: number;
				readonly directory: boolean;
				readonly regular: boolean;
		  }
		| undefined
	>;
	/** Change the trigger file. */
	readonly touch: (path: string) => Promise<void>;
	readonly readStatus: () => Promise<string | undefined>;
	readonly processAlive: (pid: number) => boolean;
	/** Run to completion. The environment given is the whole environment. */
	readonly exec: (
		file: string,
		args: readonly string[],
		env: Readonly<Record<string, string>>,
	) => Promise<CommandResult>;
	readonly hostname: () => string;
	readonly sleep: (ms: number) => Promise<void>;
	readonly now: () => number;
}

export function defaultDesktopSetupHost(options: {
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly upgradeRequestFile: () => Promise<string | undefined>;
}): DesktopSetupHost {
	// Where root's run records itself. Fixed, except that a server's own
	// environment may name another file, as a test with a stand-in for the
	// root side does. The file only ever says how far setup has got: whatever
	// it claims, the desktop starts only once the programs are really there.
	const named = options.env[DESKTOP_SETUP_STATUS_FILE_ENV]?.trim();
	const statusFile =
		named !== undefined && isAbsolute(named) ? named : DESKTOP_SETUP_STATUS_FILE;
	return {
		env: options.env,
		upgradeRequestFile: options.upgradeRequestFile,
		stat: (path) =>
			lstat(path).then(
				(found) => ({
					uid: found.uid,
					mode: found.mode & 0o7777,
					directory: found.isDirectory(),
					regular: found.isFile() && found.nlink === 1,
				}),
				() => undefined,
			),
		touch: async (path) => {
			const file = await open(path, constants.O_WRONLY | constants.O_NOFOLLOW);
			try {
				await file.truncate(0);
			} finally {
				await file.close();
			}
		},
		readStatus: () =>
			readFile(statusFile, 'utf8').then(
				(text) => text,
				() => undefined,
			),
		processAlive: (pid) => existsSync(`/proc/${pid}`),
		exec: (file, args, env) =>
			new Promise<CommandResult>((resolve) => {
				if (args.at(-1) !== 'install') {
					execFile(
						file,
						[...args],
						{ env: { ...env }, timeout: 30_000, cwd: '/' },
						(error, stdout, stderr) => {
							const code = (error as { code?: unknown } | null)?.code;
							resolve({
								code:
									error === null
										? 0
										: typeof code === 'number'
											? code
											: undefined,
								output: `${stdout}${stderr}`,
							});
						},
					);
					return;
				}
				// The install outlives a request, and its output is in the status
				// file: nothing of it is kept here but the end of what it printed.
				const child = spawn(file, [...args], {
					env: { ...env },
					cwd: '/',
					stdio: ['ignore', 'pipe', 'pipe'],
				});
				let output = '';
				const keep = (chunk: Buffer) => {
					output = (output + chunk.toString('utf8')).slice(-2048);
				};
				child.stdout?.on('data', keep);
				child.stderr?.on('data', keep);
				child.once('error', (error) =>
					resolve({ code: undefined, output: error.message }),
				);
				child.once('close', (code) =>
					resolve({ code: code ?? undefined, output }),
				);
			}),
		hostname,
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		now: () => Date.now(),
	};
}

/** The environment root's command is given: nothing of the server's own. */
const ROOT_ENVIRONMENT = Object.freeze({
	PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
});
const SUDO = '/usr/bin/sudo';
const ENV = '/usr/bin/env';

type Means =
	| {
			readonly kind: 'helper';
			readonly trigger: string;
			readonly command: string;
	  }
	| { readonly kind: 'image'; readonly cli: string; readonly command: string }
	| { readonly kind: 'command'; readonly command: string };

function progressOf(record: DesktopSetupRecord): ServerDesktopSetupProgress {
	return { step: record.step, fraction: record.fraction };
}

export function createServerDesktopSetup(
	host: DesktopSetupHost,
): ServerDesktopSetup {
	const inContainer = host.env.TERMINAY_MANAGED_BY === 'container';
	const cliName = (() => {
		const upgrader = host.env.TERMINAY_UPGRADER?.trim();
		return upgrader !== undefined && isAbsolute(upgrader)
			? upgrader
			: 'terminay';
	})();

	const record = async () => parseDesktopSetupRecord(await host.readStatus());
	const live = (found: DesktopSetupRecord | undefined) =>
		found !== undefined &&
		found.outcome === undefined &&
		host.processAlive(found.pid);

	/** `sudo -n env -i PATH=… <cli> daemon desktop <subcommand>`. */
	const asRoot = (cli: string, subcommand: string) =>
		host.exec(
			SUDO,
			[
				'-n',
				ENV,
				'-i',
				`PATH=${ROOT_ENVIRONMENT.PATH}`,
				cli,
				'daemon',
				'desktop',
				subcommand,
			],
			ROOT_ENVIRONMENT,
		);

	let known: { readonly means: Means; readonly at: number } | undefined;
	const means = async (): Promise<Means> => {
		// Asked on every status; what it answers changes only when an operator
		// changes the install.
		if (known !== undefined && host.now() - known.at < 30_000)
			return known.means;
		const found = await resolve();
		known = { means: found, at: host.now() };
		return found;
	};

	const resolve = async (): Promise<Means> => {
		if (inContainer) {
			// Through the wrapper: an operator at the container's host chooses to
			// run the release the server is running, which has this command even
			// when the image's own CLI is older.
			const command = `docker exec -u root ${host.hostname()} terminay daemon desktop install`;
			// The image's own release directory, never the `terminay` wrapper:
			// the wrapper follows `releases/running`, a file the account writes.
			const cli = join(IMAGE_RELEASE_DIRECTORY, 'bin', 'terminay');
			const directory = await host.stat(IMAGE_RELEASE_DIRECTORY);
			const program = await host.stat(cli);
			const rootOwned = (
				entry: { uid: number; mode: number } | undefined,
			): boolean =>
				entry !== undefined && entry.uid === 0 && (entry.mode & 0o022) === 0;
			if (
				directory?.directory !== true ||
				!rootOwned(directory) ||
				!rootOwned(program)
			)
				return { kind: 'command', command };
			// No sudo, sudo that wants a password, and a CLI that predates the
			// command all end here the same way: not a zero status and this answer.
			const check = await asRoot(cli, 'check');
			if (check.code !== 0) return { kind: 'command', command };
			try {
				const answer = JSON.parse(check.output.trim()) as { install?: unknown };
				if (answer.install !== 1) return { kind: 'command', command };
			} catch {
				return { kind: 'command', command };
			}
			return { kind: 'image', cli, command };
		}
		const command = `sudo ${cliName} daemon desktop install`;
		const upgrade = await host.upgradeRequestFile().catch(() => undefined);
		if (upgrade === undefined) return { kind: 'command', command };
		const directory = join(dirname(dirname(upgrade)), DESKTOP_SETUP_REQUEST_DIRECTORY);
		const trigger = join(directory, DESKTOP_SETUP_REQUEST_FILE);
		// An install made before the helper existed has no trigger until root
		// next upgrades it.
		const parent = await host.stat(directory);
		if (
			parent?.directory !== true ||
			parent.uid !== 0 ||
			(parent.mode & 0o022) !== 0 ||
			(await host.stat(trigger))?.regular !== true
		)
			return { kind: 'command', command };
		return { kind: 'helper', trigger, command };
	};

	/** Follow a run to its outcome. */
	const follow = async (
		run: string,
		onProgress: (progress: ServerDesktopSetupProgress) => void,
		ended?: () => CommandResult | undefined,
	): Promise<ServerDesktopSetupOutcome> => {
		const deadline = host.now() + SETUP_DEADLINE_MS;
		let last = '';
		while (true) {
			const found = await record();
			if (found === undefined || found.run !== run) {
				// A newer run replaced the one being followed: follow that.
				if (found !== undefined) run = found.run;
				else if (host.now() >= deadline)
					return { ok: false, reason: 'Setup stopped reporting.' };
			}
			if (found !== undefined && found.run === run) {
				if (found.outcome !== undefined)
					return found.outcome.ok
						? { ok: true }
						: {
								ok: false,
								step: found.outcome.step ?? found.step,
								reason: found.outcome.reason,
							};
				const text = `${found.step}:${found.fraction}`;
				if (text !== last) {
					last = text;
					onProgress(progressOf(found));
				}
				const gone = !host.processAlive(found.pid) || ended?.() !== undefined;
				if (gone) {
					// The outcome is written before the run ends: read once more.
					const final = await record();
					if (final?.run === run && final.outcome !== undefined) continue;
					return {
						ok: false,
						step: found.step,
						reason:
							'Setup stopped before it finished. Nothing reported why; run it again.',
					};
				}
				if (host.now() >= deadline)
					return {
						ok: false,
						step: found.step,
						reason: 'Setup took too long and was given up on.',
					};
			}
			await host.sleep(500);
		}
	};

	return {
		describe: async () => {
			const how = await means();
			return {
				means: how.kind === 'command' ? 'command' : 'server',
				command: how.command,
			};
		},
		running: async () => {
			const found = await record();
			return live(found) ? progressOf(found as DesktopSetupRecord) : undefined;
		},
		run: async (onProgress) => {
			// Join a run already going, whoever started it.
			const before = await record();
			if (live(before))
				return follow((before as DesktopSetupRecord).run, onProgress);

			known = undefined;
			const how = await means();
			if (how.kind === 'command')
				return {
					ok: false,
					reason: 'Setup has to be run by an operator on this host.',
				};

			let ended: CommandResult | undefined;
			if (how.kind === 'image')
				void asRoot(how.cli, 'install').then((result) => {
					ended = result;
				});

			// Wait for a run that is not the one seen before. A trigger that lands
			// while the helper's last run is still ending is lost, so it is
			// repeated until a run shows.
			const startBy = host.now() + SETUP_START_WAIT_MS;
			let touched = Number.NEGATIVE_INFINITY;
			while (true) {
				if (how.kind === 'helper' && host.now() - touched >= 5_000) {
					touched = host.now();
					try {
						await host.touch(how.trigger);
					} catch (error) {
						return {
							ok: false,
							step: 'waiting',
							reason: `The setup helper could not be asked (${error instanceof Error ? error.message : String(error)}).`,
						};
					}
				}
				const found = await record();
				if (found !== undefined && found.run !== before?.run)
					return follow(found.run, onProgress, () => ended);
				if (ended !== undefined) {
					// It ended without ever recording a run of its own.
					const final = await record();
					if (final !== undefined && final.run !== before?.run)
						return follow(final.run, onProgress, () => ended);
					return {
						ok: false,
						step: 'waiting',
						reason:
							ended.output.trim().split('\n').at(-1)?.slice(0, 1024) ||
							'Setup could not be started.',
					};
				}
				if (host.now() >= startBy)
					return {
						ok: false,
						step: 'waiting',
						reason:
							'The setup helper did not start. Run the command on the server instead.',
					};
				await host.sleep(500);
			}
		},
	};
}
