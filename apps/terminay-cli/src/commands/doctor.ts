import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { promisify } from 'node:util';

import { isRefusingShell, shellOf } from '../account.js';
import {
	type CommandContext,
	sendToInstalledServer,
	serviceNode,
} from '../context.js';
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
