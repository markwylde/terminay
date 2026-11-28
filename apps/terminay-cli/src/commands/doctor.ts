import { execFile } from 'node:child_process';
import { access, constants, readdir, readFile, stat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { promisify } from 'node:util';

import { isRefusingShell, shellOf } from '../account.js';
import {
	type CommandContext,
	sendToInstalledServer,
	serviceNode,
} from '../context.js';
import {
	defaultDesktopInstallHost,
	missingDesktopBrowsers,
	missingDesktopPrograms,
	osReleaseId,
} from '../desktop.js';
import { desktopSetupHelperInstalled } from '../desktopHelper.js';
import { probeHealth } from '../health.js';
import {
	type ApprovalRequest,
	type ApprovalResponse,
	explainPrivilegeLaunchError,
} from '../socket.js';
import { type CheckResult, verifyUsable } from '../usable.js';

/**
 * `daemon doctor` — every check that decides whether an install works, one
 * line each, with the command that fixes a failure.
 *
 * It reads and asks; it never writes, restarts, or changes an account. The
 * same health, socket, and terminal checks decide readiness for `install`,
 * `start`, and `upgrade`, so what doctor says is what those commands meant.
 */

const execFileAsync = promisify(execFile);

export interface DoctorDependencies {
	/** Runs a program; overridden by tests. Read-only programs only. */
	readonly exec?: (
		file: string,
		args: readonly string[],
	) => Promise<{ stdout: string }>;
	readonly stat?: (path: string) => Promise<{ uid: number; mode: number }>;
	readonly shellOf?: (account: string) => Promise<string | undefined>;
	readonly portOpen?: (port: number) => Promise<boolean>;
	readonly send?: (request: ApprovalRequest) => Promise<ApprovalResponse>;
	readonly uid?: number;
	readonly serviceNode?: string;
	/** What the server desktop check reads; overridden by tests. */
	readonly desktop?: DesktopFacts;
}

/** A running process, as `/proc` shows it to anyone. */
export interface DesktopProcess {
	readonly pid: number;
	readonly argv: readonly string[];
	/** The `Seccomp:` line of its status: `2` is a filter. */
	readonly seccomp: string | undefined;
}

export interface DesktopFacts {
	/** Whether this host is one the desktop is set up on at all. */
	readonly debian: () => Promise<boolean>;
	/** What the desktop needs that is not installed. */
	readonly missing: () => Promise<readonly string[]>;
	/** The browsers setup installs that are not installed. */
	readonly missingBrowsers?: () => Promise<readonly string[]>;
	readonly processes: () => Promise<readonly DesktopProcess[]>;
	/** Whether this process may read a file. */
	readonly readable: (path: string) => Promise<boolean>;
	/** Whether the setup helper is installed; read from the layout by default. */
	readonly helperInstalled?: () => Promise<boolean | undefined>;
}

function defaultDesktopFacts(): DesktopFacts {
	const host = defaultDesktopInstallHost();
	return {
		debian: async () =>
			host.platform === 'linux' &&
			osReleaseId(await host.osRelease()) === 'debian',
		missing: () => missingDesktopPrograms(host),
		missingBrowsers: () => missingDesktopBrowsers(host),
		readable: (path) =>
			access(path, constants.R_OK).then(
				() => true,
				() => false,
			),
		processes: async () => {
			const found: DesktopProcess[] = [];
			for (const name of await readdir('/proc').catch(() => [])) {
				if (!/^\d+$/u.test(name)) continue;
				const argv = await readFile(`/proc/${name}/cmdline`, 'utf8').then(
					(text) => text.split('\0').filter((part) => part.length > 0),
					() => [],
				);
				if (argv.length === 0) continue;
				const status = await readFile(`/proc/${name}/status`, 'utf8').catch(
					() => '',
				);
				found.push({
					pid: Number(name),
					argv,
					seccomp: /^Seccomp:\s*(\d+)/mu.exec(status)?.[1],
				});
			}
			return found;
		},
	};
}

/**
 * Terminay's own display server: the one given no RFB port and Terminay's
 * socket. A display server the operator runs for themselves is not looked
 * at, whatever it listens on.
 */
export function isTerminayDisplayServer(argv: readonly string[]): boolean {
	if (!argv.some((part) => /(^|\/)Xtigervnc$/u.test(part))) return false;
	const socket = argv[argv.indexOf('-rfbunixpath') + 1];
	return (
		argv.includes('-rfbunixpath') &&
		socket !== undefined &&
		/\/desktop\/rfb\.sock$/u.test(socket)
	);
}

/**
 * The server desktop: informational until it is set up, then a check that
 * what runs is closed to the network. It reads `/proc`, asks `ss`, and asks
 * the display one question with the server's cookie.
 */
async function desktopCheck(
	facts: DesktopFacts,
	exec: (file: string, args: readonly string[]) => Promise<{ stdout: string }>,
	sudo: string,
	helperInstalled: boolean | undefined,
): Promise<CheckResult> {
	const name = 'desktop';
	if (!(await facts.debian()))
		return {
			name,
			ok: true,
			skipped: true,
			detail: 'not offered on this host (Debian Linux only)',
		};
	// A user-scope install has no helper; a system-scope one should.
	const helper =
		helperInstalled === undefined
			? ''
			: helperInstalled
				? '; setup helper installed'
				: `; setup helper not installed (${sudo}terminay daemon upgrade adds it)`;
	const missing = await facts.missing();
	if (missing.length > 0)
		return {
			name,
			ok: true,
			skipped: true,
			detail: `not set up: missing ${missing.join(', ')}${helper}; to set it up: sudo terminay daemon desktop install`,
		};
	// The desktop runs without a browser, so a missing one is said and is not
	// a failure.
	const browsers = (await facts.missingBrowsers?.()) ?? [];
	const present =
		browsers.length === 0
			? 'set up, every program present'
			: `set up, without ${browsers.join(' and ')} (sudo terminay daemon desktop install adds ${browsers.length === 1 ? 'it' : 'them'})`;
	const servers = (await facts.processes()).filter((process) =>
		isTerminayDisplayServer(process.argv),
	);
	if (servers.length === 0)
		return {
			name,
			ok: true,
			detail: `${present}${helper}; no desktop is running`,
		};
	const pids = (list: readonly DesktopProcess[]) =>
		list.map((process) => process.pid).join(', ');
	const fix = `turn the desktop off and on from its window; if this stays, stop it: ${sudo}terminay daemon stop, then report it`;
	// A display server that could open a connection could dial out for
	// anyone who reaches its control channel.
	const open = servers.filter((process) => process.seccomp !== '2');
	if (open.length > 0)
		return {
			name,
			ok: false,
			detail: `the display server (pid ${pids(open)}) runs without its network filter and can open network connections`,
			fix,
		};
	// Without `ss` the listeners cannot be read, and that is said: an unread
	// list is not an empty one.
	const sockets = await exec('ss', ['-H', '-lntup']).then(
		(result) => result.stdout,
		() => undefined,
	);
	const listeners = (sockets ?? '')
		.split('\n')
		.filter((line) =>
			servers.some((process) =>
				new RegExp(`\\bpid=${process.pid},`, 'u').test(line),
			),
		)
		.map((line) => {
			const fields = line.trim().split(/\s+/u);
			return `${fields[0] ?? '?'} ${fields[4] ?? '?'}`;
		});
	if (listeners.length > 0)
		return {
			name,
			ok: false,
			detail: `the display server (pid ${pids(servers)}) is listening on the network: ${listeners.join(', ')}`,
			fix,
		};
	// The display answers the server's cookie. Only someone who can read the
	// cookie can ask: root, or the server's own account.
	let cookies = '';
	for (const process of servers) {
		const display = process.argv.find((part) => /^:\d+$/u.test(part));
		const cookie = process.argv[process.argv.indexOf('-auth') + 1];
		if (
			display === undefined ||
			cookie === undefined ||
			!process.argv.includes('-auth')
		)
			continue;
		if (!(await facts.readable(cookie))) {
			cookies = '; cookie not checked (run as root)';
			continue;
		}
		const answered = await exec('env', [
			`DISPLAY=${display}`,
			`XAUTHORITY=${cookie}`,
			'xset',
			'q',
		]).then(
			() => true,
			() => false,
		);
		if (!answered)
			return {
				name,
				ok: false,
				detail: `display ${display} does not accept the server's cookie`,
				fix,
			};
		cookies = "; its display accepts the server's cookie";
	}
	return {
		name,
		ok: true,
		detail:
			sockets === undefined
				? `running, with no network access; listeners not checked (ss is not installed)${cookies}${helper}`
				: `running, with no network listener and no network access${cookies}${helper}`,
	};
}

export interface DoctorReport {
	readonly ok: boolean;
	readonly checks: readonly CheckResult[];
}

function portOpen(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host: '127.0.0.1', port });
		socket.setTimeout(2_000, () => {
			socket.destroy();
			resolve(false);
		});
		socket.once('connect', () => {
			socket.end();
			resolve(true);
		});
		socket.once('error', () => resolve(false));
	});
}

export async function runDoctor(
	context: CommandContext,
	dependencies: DoctorDependencies = {},
): Promise<DoctorReport> {
	const { record, layout, systemd } = context;
	const exec =
		dependencies.exec ??
		((file: string, args: readonly string[]) =>
			execFileAsync(file, [...args], { timeout: 15_000 }));
	const uid = dependencies.uid ?? process.getuid?.();
	const system = layout.scope === 'system';
	const sudo = system ? 'sudo ' : '';
	const scopeFlag = system ? '' : ' --user';
	const checks: CheckResult[] = [];

	// The unit.
	const [state, enabled] = await Promise.all([
		systemd.state(),
		systemd.isEnabled(),
	]);
	checks.push(
		state === 'active' && enabled
			? { name: 'unit', ok: true }
			: {
					name: 'unit',
					ok: false,
					detail: `terminay-server is ${state}${enabled ? '' : ' and not enabled'}`,
					fix: `${sudo}systemctl${scopeFlag} enable --now terminay-server`,
				},
	);

	// The runtime everything run as the account uses.
	const node = dependencies.serviceNode ?? serviceNode(layout);
	const drop = system && uid === 0 && record.runAs !== 'root';
	try {
		await (drop
			? exec('sudo', ['-n', '-u', record.runAs, node, '-e', '0'])
			: exec(node, ['-e', '0']));
		checks.push({ name: 'runtime', ok: true });
	} catch (error) {
		checks.push({
			name: 'runtime',
			ok: false,
			detail:
				explainPrivilegeLaunchError(error, node) ??
				`${record.runAs} cannot run ${node}`,
			fix: `${sudo}terminay daemon upgrade${scopeFlag} to reinstall the release`,
		});
	}

	// The account's login shell.
	const shell = await (dependencies.shellOf ?? shellOf)(record.runAs);
	checks.push(
		isRefusingShell(shell)
			? {
					name: 'shell',
					ok: false,
					detail: `${record.runAs} has the login shell ${shell}, which refuses to run`,
					fix: `sudo usermod -s /bin/bash ${record.runAs}`,
				}
			: { name: 'shell', ok: true },
	);

	// The data root, which is the trust boundary.
	try {
		const info = await (dependencies.stat ?? stat)(record.dataRoot);
		const { stdout } = await exec('id', ['-u', record.runAs]);
		const owner = Number(stdout.trim());
		const mode = info.mode & 0o777;
		const problems = [
			...(info.uid === owner ? [] : [`owned by uid ${info.uid}`]),
			...(mode === 0o700 ? [] : [`mode ${mode.toString(8)}`]),
		];
		checks.push(
			problems.length === 0
				? { name: 'data root', ok: true }
				: {
						name: 'data root',
						ok: false,
						detail: `${record.dataRoot} is ${problems.join(' and ')}, not ${record.runAs}'s with mode 700`,
						fix: `${sudo}chown -R ${record.runAs}: ${record.dataRoot} && ${sudo}chmod 700 ${record.dataRoot}`,
					},
		);
	} catch (error) {
		checks.push({
			name: 'data root',
			ok: false,
			detail: `${record.dataRoot} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
			fix: `${sudo}terminay daemon install${scopeFlag} to recreate it`,
		});
	}

	// Health, socket, and terminal, asked once each.
	const usable = await verifyUsable(record, {
		send:
			dependencies.send ??
			((request) => sendToInstalledServer(context, request)),
		waitForHealth: async (port) => {
			const snapshot = await probeHealth(port);
			return snapshot?.ready === true ? snapshot : undefined;
		},
		timeoutMs: 0,
	});
	checks.push(...usable.checks);

	// The port devices connect to.
	checks.push(
		(await (dependencies.portOpen ?? portOpen)(record.port))
			? { name: 'port', ok: true }
			: {
					name: 'port',
					ok: false,
					detail: `nothing accepts connections on port ${record.port}`,
					fix: `check the log: ${sudo}journalctl${scopeFlag} -u terminay-server -n 50`,
				},
	);

	// The server desktop. Not being set up is not a problem.
	const desktopFacts = dependencies.desktop ?? defaultDesktopFacts();
	checks.push(
		await desktopCheck(
			desktopFacts,
			exec,
			sudo,
			desktopFacts.helperInstalled === undefined
				? layout.upgradeHelper === undefined
					? undefined
					: await desktopSetupHelperInstalled(layout)
				: await desktopFacts.helperInstalled(),
		),
	);

	for (const check of checks) {
		const mark = check.skipped ? 'skip' : check.ok ? ' ok ' : 'FAIL';
		context.write(
			`[${mark}] ${check.name.padEnd(9)}${check.detail === undefined ? '' : ` ${check.detail}`}`,
		);
		if (!check.ok && !check.skipped && check.fix !== undefined)
			context.write(`       ${''.padEnd(9)} fix: ${check.fix}`);
	}
	const ok = checks.every((check) => check.ok || check.skipped === true);
	context.write(ok ? 'Everything checks out.' : 'Some checks failed.');
	return Object.freeze({ ok, checks });
}
