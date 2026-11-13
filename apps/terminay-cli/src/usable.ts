import { isRefusingShell } from './account.js';
import {
	type HealthSnapshot,
	READINESS_TIMEOUT_MS,
	waitForReady,
} from './health.js';
import type { InstallRecord } from './layout.js';
import {
	type ApprovalRequest,
	type ApprovalResponse,
	SocketLaunchError,
	type TerminalProbe,
} from './socket.js';

/**
 * Whether an installed server is usable, not merely up.
 *
 * Health is the server's own view of its startup. An operator also needs the
 * socket every pairing command goes through, reached the way those commands
 * reach it, and a terminal that can start. Each is a named check with the
 * detail behind a failure and the command that fixes it, so `install`,
 * `start`, `upgrade`, `status`, and `doctor` all say the same thing.
 */

export type UsableCheckName = 'health' | 'socket' | 'terminal';

export interface CheckResult {
	readonly name: string;
	readonly ok: boolean;
	/** Not run, because an earlier check it depends on failed, or the server
	 * is too old to answer it. Never counts as a failure. */
	readonly skipped?: boolean;
	readonly detail?: string;
	readonly fix?: string;
	/** The failure is on the CLI's side of the socket; the server may be fine. */
	readonly local?: boolean;
}

export interface UsableReport {
	readonly usable: boolean;
	readonly checks: readonly CheckResult[];
	readonly health?: HealthSnapshot;
}

export interface UsableDependencies {
	readonly send: (request: ApprovalRequest) => Promise<ApprovalResponse>;
	readonly waitForHealth?: (
		port: number,
		timeoutMs?: number,
	) => Promise<HealthSnapshot | undefined>;
	readonly timeoutMs?: number;
	readonly now?: () => number;
	readonly sleep?: (ms: number) => Promise<void>;
}

const RETRY_MS = 500;

/** An older server that predates an operation answers this way. */
function unknownOperation(response: ApprovalResponse): boolean {
	return (
		response.ok === false && response.error === 'approval request is invalid'
	);
}

export async function verifyUsable(
	record: Pick<InstallRecord, 'healthPort' | 'runAs'>,
	dependencies: UsableDependencies,
): Promise<UsableReport> {
	const timeoutMs = dependencies.timeoutMs ?? READINESS_TIMEOUT_MS;
	const now = dependencies.now ?? Date.now;
	const sleep =
		dependencies.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const deadline = now() + timeoutMs;
	const checks: CheckResult[] = [];

	const health = await (dependencies.waitForHealth ?? waitForReady)(
		record.healthPort,
		timeoutMs,
	);
	if (health === undefined) {
		checks.push({
			name: 'health',
			ok: false,
			detail: `the health endpoint on 127.0.0.1:${record.healthPort} did not report ready`,
			fix: 'read the log with: journalctl -u terminay-server -n 50',
		});
		checks.push({ name: 'socket', ok: false, skipped: true });
		checks.push({ name: 'terminal', ok: false, skipped: true });
		return Object.freeze({ usable: false, checks });
	}
	checks.push({ name: 'health', ok: true });

	// The socket starts a moment after health turns ready, so it is retried
	// until the same deadline rather than asked once.
	let socketError: unknown;
	for (;;) {
		try {
			const response = await dependencies.send({ op: 'status' });
			if (response.ok) {
				socketError = undefined;
				break;
			}
			socketError = new Error(response.error);
		} catch (error) {
			socketError = error;
			if (error instanceof SocketLaunchError) break;
		}
		if (now() >= deadline) break;
		await sleep(RETRY_MS);
	}
	if (socketError !== undefined) {
		const local = socketError instanceof SocketLaunchError;
		checks.push({
			name: 'socket',
			ok: false,
			detail:
				socketError instanceof Error
					? socketError.message
					: String(socketError),
			fix: local
				? 'run the installed `terminay` command as root, or install Node.js system-wide'
				: 'run `terminay daemon doctor` for the full picture',
			...(local ? { local: true } : {}),
		});
		checks.push({ name: 'terminal', ok: false, skipped: true });
		return Object.freeze({ usable: false, checks, health });
	}
	checks.push({ name: 'socket', ok: true });

	const response = await dependencies.send({ op: 'probe-terminal' });
	if (unknownOperation(response)) {
		checks.push({ name: 'terminal', ok: true, skipped: true });
	} else if (!response.ok || !('terminal' in response)) {
		checks.push({
			name: 'terminal',
			ok: false,
			detail: response.ok ? 'no answer' : response.error,
		});
	} else {
		checks.push(terminalCheck(response.terminal, record.runAs));
	}
	return Object.freeze({
		usable: checks.every((check) => check.ok),
		checks,
		health,
	});
}

export function terminalCheck(
	probe: TerminalProbe,
	runAs: string,
): CheckResult {
	if (probe.ok) return { name: 'terminal', ok: true };
	if (probe.reason === 'no-shell')
		return {
			name: 'terminal',
			ok: false,
			detail: 'the server found no shell to start',
			fix: `give ${runAs} a login shell: sudo usermod -s /bin/bash ${runAs}`,
		};
	const what =
		probe.reason === 'timeout'
			? 'did not exit within 5 seconds'
			: probe.reason === 'spawn'
				? `could not be started${probe.output === undefined ? '' : `: ${probe.output}`}`
				: `exited with status ${probe.exitCode}${probe.output === undefined ? '' : `: ${probe.output}`}`;
	return {
		name: 'terminal',
		ok: false,
		detail: `${probe.shell ?? 'the shell'} ${what}`,
		fix: isRefusingShell(probe.shell)
			? `give ${runAs} a login shell: sudo usermod -s /bin/bash ${runAs}`
			: `check that it runs: sudo -u ${runAs} ${probe.shell ?? '/bin/sh'} -c 'exit 0'`,
	};
}

/** One line per failed check, then its fix, for any command to print. */
export function describeFailures(report: UsableReport): readonly string[] {
	const lines: string[] = [];
	for (const check of report.checks) {
		if (check.ok || check.skipped) continue;
		lines.push(`  ${check.name.padEnd(9)} ${check.detail ?? 'failed'}`);
		if (check.fix !== undefined)
			lines.push(`  ${''.padEnd(9)} fix: ${check.fix}`);
	}
	return lines;
}

/**
 * Whether a report shows the server itself is broken. A failure on this side
 * of the socket — no `sudo`, a runtime the account cannot execute — says
 * nothing about the server, so it is no reason to roll an upgrade back.
 */
export function serverFailed(report: UsableReport): boolean {
	return report.checks.some(
		(check) => !check.ok && check.skipped !== true && check.local !== true,
	);
}
