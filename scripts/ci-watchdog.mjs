#!/usr/bin/env node
// Runs one CI step's command and, shortly before the job's timeout, explains
// what that command is still doing.
//
// A CI job that reaches `timeout-minutes` is killed with nothing said about
// why. Each long step in .gitea/workflows/ci.yml runs its script through this
// wrapper as its shell:
//
//   shell: node scripts/ci-watchdog.mjs bash --noprofile --norc -eo pipefail {0}
//
// The command runs as a child with this process's stdio, so its output and
// exit status are exactly what they would have been without the wrapper. A
// timer runs beside it, set from the job's own budget: the job's first step
// records when it started (TERMINAY_CI_JOB_STARTED_AT, epoch seconds) and the
// job declares its timeout (TERMINAY_CI_JOB_TIMEOUT_MINUTES). When the timer
// expires, the wrapper prints, into the same step log:
//
//   - every process the step started, with its elapsed time and CPU;
//   - the test files still running (node:test runs each in its own process);
//   - for each Node process, a diagnostic report — its JavaScript stack and
//     the libuv handles keeping it alive — requested with SIGUSR2;
//   - the processes inside any container the step attached to.
//
// Then it lets the step carry on to its end or to the job's timeout. It never
// stops, kills, or fails anything: SIGUSR2 goes only to a `node` executable
// whose environment carries the --report-on-signal this wrapper gave it, so
// no process receives a signal it would die of. Without the two environment
// variables there is no timer, and the wrapper is only a pass-through.
import { execFile, spawn } from 'node:child_process';
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	writeSync,
} from 'node:fs';
import { constants as osConstants, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPORT_SIGNAL = 'SIGUSR2';
// The environment is left out of each report: a CI job's environment holds its
// secrets, and the report is a file on the runner.
export const REPORT_FLAGS = Object.freeze([
	'--report-on-signal',
	`--report-signal=${REPORT_SIGNAL}`,
	'--report-exclude-env',
	'--report-exclude-network',
]);
export const REPORT_WAIT_MS = 20_000;
const REPORT_POLL_MS = 500;
const COMMAND_WIDTH = 400;

/** How long before the job's timeout the diagnostics are taken. */
export function leadMs(timeoutMs) {
	return Math.min(180_000, Math.max(60_000, Math.round(timeoutMs * 0.15)));
}

/**
 * When to dump, from the job's recorded start and declared timeout. Returns
 * undefined when either is missing, which disables the timer.
 */
export function watchdogPlan(env, nowMs) {
	const startedAtSeconds = Number(env.TERMINAY_CI_JOB_STARTED_AT);
	const timeoutMinutes = Number(env.TERMINAY_CI_JOB_TIMEOUT_MINUTES);
	if (!(startedAtSeconds > 0) || !(timeoutMinutes > 0)) return undefined;
	const timeoutMs = timeoutMinutes * 60_000;
	const deadlineMs = startedAtSeconds * 1000 + timeoutMs;
	const fireAtMs = deadlineMs - leadMs(timeoutMs);
	return { deadlineMs, fireAtMs, delayMs: Math.max(0, fireAtMs - nowMs) };
}

/**
 * Starts the timer through the injected clock. `disarm` cancels it if it has
 * not fired; it fires at most once.
 */
export function armWatchdog({
	delayMs,
	onExpire,
	setTimer = setTimeout,
	clearTimer = clearTimeout,
}) {
	let fired = false;
	let disarmed = false;
	const handle = setTimer(() => {
		if (disarmed) return;
		fired = true;
		onExpire();
	}, delayMs);
	handle?.unref?.();
	return {
		get fired() {
			return fired;
		},
		disarm() {
			if (fired || disarmed) return;
			disarmed = true;
			clearTimer(handle);
		},
	};
}

/** The child's environment: NODE_OPTIONS gains the report-on-signal flags. */
export function withReportOptions(env, reportDirectory) {
	const existing = env.NODE_OPTIONS ?? '';
	if (reportsOnSignal(existing)) return { ...env };
	const directory = /\s|"/u.test(reportDirectory)
		? `"${reportDirectory.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
		: reportDirectory;
	const flags = [...REPORT_FLAGS, `--report-directory=${directory}`].join(' ');
	return {
		...env,
		NODE_OPTIONS: existing.trim() ? `${flags} ${existing.trim()}` : flags,
	};
}

/** Whether a NODE_OPTIONS value makes Node write a report on SIGUSR2. */
export function reportsOnSignal(nodeOptions) {
	if (typeof nodeOptions !== 'string') return false;
	const tokens = nodeOptions.split(/\s+/u);
	if (!tokens.includes('--report-on-signal')) return false;
	const signal = tokens
		.filter((token) => token.startsWith('--report-signal='))
		.at(-1)
		?.slice('--report-signal='.length);
	return signal === undefined || signal === REPORT_SIGNAL;
}

/** NODE_OPTIONS from a Linux /proc/<pid>/environ. */
export function nodeOptionsFromEnviron(environ) {
	for (const entry of String(environ).split('\0')) {
		if (entry.startsWith('NODE_OPTIONS=')) return entry.slice(13);
	}
	return undefined;
}

/**
 * NODE_OPTIONS from macOS `ps -E -ww -o command=`, which prints the command
 * line followed by the environment, space separated. The value runs up to the
 * next NAME= token.
 */
export function nodeOptionsFromPsEnvironment(line) {
	const match = /(?:^|\s)NODE_OPTIONS=(.*?)(?=\s[A-Za-z_][A-Za-z0-9_]*=|$)/u.exec(
		String(line).trim(),
	);
	return match?.[1];
}

/** `ps` elapsed time, `[[dd-]hh:]mm:ss`, in seconds. */
export function parseElapsed(etime) {
	const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/u.exec(String(etime).trim());
	if (!match) return undefined;
	const [, days = '0', hours = '0', minutes, seconds] = match;
	return (
		Number(days) * 86_400 +
		Number(hours) * 3600 +
		Number(minutes) * 60 +
		Number(seconds)
	);
}

export function formatElapsed(seconds) {
	if (seconds === undefined) return '?';
	const minutes = Math.floor(seconds / 60);
	return minutes > 0 ? `${minutes}m${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}

/** Rows of `ps -A -ww -o pid=,ppid=,etime=,pcpu=,args=`. */
export function parseProcessTable(text) {
	const rows = [];
	for (const line of String(text).split('\n')) {
		const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(.*)$/u.exec(line);
		if (!match) continue;
		rows.push({
			pid: Number(match[1]),
			ppid: Number(match[2]),
			elapsedSeconds: parseElapsed(match[3]),
			cpuPercent: Number(match[4]),
			args: match[5].trim(),
		});
	}
	return rows;
}

/** The root and everything under it, depth first, each with its depth. */
export function descendantsOf(rows, rootPid) {
	const children = new Map();
	for (const row of rows) {
		if (row.pid === row.ppid) continue;
		if (!children.has(row.ppid)) children.set(row.ppid, []);
		children.get(row.ppid).push(row);
	}
	const root = rows.find((row) => row.pid === rootPid);
	if (!root) return [];
	const ordered = [];
	const seen = new Set();
	const visit = (row, depth) => {
		if (seen.has(row.pid)) return;
		seen.add(row.pid);
		ordered.push({ ...row, depth });
		for (const child of (children.get(row.pid) ?? []).sort((a, b) => a.pid - b.pid))
			visit(child, depth + 1);
	};
	visit(root, 0);
	return ordered;
}

const TEST_FILE = /(?:^|[\s=])([^\s=]*\.(?:test|spec)\.(?:[cm]?[jt]s|tsx?))(?=\s|$)/gu;

/**
 * Test files still running. node:test runs each file in a process of its own
 * that names only that file; a runner naming many files is not one of them.
 * A file named by a runner and by its child is reported once, at the child.
 */
export function runningTestFiles(rows) {
	const running = new Map();
	for (const row of rows) {
		const files = [...row.args.matchAll(TEST_FILE)].map((match) => match[1]);
		if (files.length !== 1) continue;
		running.delete(files[0]);
		running.set(files[0], { pid: row.pid, elapsedSeconds: row.elapsedSeconds, file: files[0] });
	}
	return [...running.values()];
}

/** Containers a process attached to, as named on its command line. */
export function containersNamedIn(rows) {
	const names = new Set();
	for (const row of rows) {
		const tokens = row.args.split(/\s+/u);
		const docker = tokens.findIndex((token) => basename(token) === 'docker');
		if (docker === -1) continue;
		const [command, ...rest] = tokens.slice(docker + 1);
		if (command === 'start' || command === 'attach') {
			const name = rest.filter((token) => !token.startsWith('-')).at(-1);
			if (name) names.add(name);
		} else if (command === 'run' || command === 'create') {
			const flag = rest.findIndex((token) => token === '--name' || token.startsWith('--name='));
			if (flag === -1) continue;
			const name = rest[flag].includes('=') ? rest[flag].split('=')[1] : rest[flag + 1];
			if (name) names.add(name);
		}
	}
	return [...names];
}

const REPORT_FILE = /^report\.\d{8}\.\d{6}\.(\d+)\.\d+\.\d+\.json$/u;

/** The report files in a directory listing that belong to a process. */
export function reportFilesFor(files, pid) {
	return files.filter((file) => Number(REPORT_FILE.exec(file)?.[1]) === pid).sort();
}

function formatEndpoint(endpoint) {
	if (!endpoint) return '-';
	const host = endpoint.ip4 ?? endpoint.ip6 ?? endpoint.host ?? '?';
	return `${host.includes(':') ? `[${host}]` : host}:${endpoint.port}`;
}

const HANDLE_NOISE = new Set(['sendBufferSize', 'recvBufferSize', 'writeQueueSize']);

function describeHandle(handle) {
	const {
		type,
		is_active: _active,
		is_referenced: _referenced,
		address: _address,
		localEndpoint,
		remoteEndpoint,
		...details
	} = handle;
	const parts = [type];
	if (localEndpoint) parts.push(`local=${formatEndpoint(localEndpoint)}`);
	if (remoteEndpoint) parts.push(`remote=${formatEndpoint(remoteEndpoint)}`);
	for (const [key, value] of Object.entries(details)) {
		if (value === undefined || value === null || HANDLE_NOISE.has(key)) continue;
		parts.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`);
	}
	return parts.join(' ');
}

/** The lines of a Node diagnostic report worth reading in a CI log. */
export function summarizeReport(report) {
	const lines = [];
	const header = report.header ?? {};
	const commandLine = (header.commandLine ?? []).join(' ');
	lines.push(`pid ${header.processId}: ${truncate(commandLine)}`);
	const stack = report.javascriptStack ?? {};
	const frames = (Array.isArray(stack.stack) ? stack.stack : [])
		.map((frame) => String(frame).trim())
		.filter((frame) => frame && frame !== 'No stack.');
	if (frames.length === 0) {
		lines.push('  JavaScript stack: none (the event loop is idle, waiting on the handles below)');
	} else {
		lines.push(`  JavaScript stack: ${stack.message ?? ''}`.trimEnd());
		for (const frame of frames.slice(0, 40)) lines.push(`    ${frame}`);
	}
	const handles = (report.libuv ?? []).filter((handle) => handle.type !== 'loop');
	// What keeps a process alive: active, referenced handles.
	const holding = handles.filter((handle) => handle.is_active && handle.is_referenced);
	lines.push(`  Active handles keeping it alive: ${holding.length}`);
	for (const handle of holding) lines.push(`    ${describeHandle(handle)}`);
	const others = new Map();
	for (const handle of handles) {
		if (holding.includes(handle)) continue;
		others.set(handle.type, (others.get(handle.type) ?? 0) + 1);
	}
	if (others.size > 0) {
		lines.push(
			`  Other handles: ${[...others].map(([type, count]) => `${type}×${count}`).join(', ')}`,
		);
	}
	const workers = report.workers ?? [];
	if (workers.length > 0) lines.push(`  Worker threads: ${workers.length}`);
	return lines;
}

/** The status this process exits with to repeat the child's. */
export function exitStatus(code, signal, signals = {}) {
	if (typeof code === 'number') return code;
	if (signal && typeof signals[signal] === 'number') return 128 + signals[signal];
	return 1;
}

// Node's test runner starts each file with every default execArgv spelled
// out, and names the file last, so a long command line keeps both ends.
function truncate(text, width = COMMAND_WIDTH) {
	if (text.length <= width) return text;
	const head = Math.floor(width * 0.4);
	return `${text.slice(0, head)} … ${text.slice(text.length - (width - head - 3))}`;
}

function run(file, args, { timeout = 10_000 } = {}) {
	return new Promise((resolve) => {
		execFile(file, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout }, (error, stdout, stderr) =>
			resolve({ ok: !error, stdout: stdout ?? '', stderr: stderr ?? '', error }),
		);
	});
}

function executableName(pid, row) {
	try {
		return basename(readlinkSync(`/proc/${pid}/exe`));
	} catch {
		return basename(row.args.split(/\s+/u)[0] ?? '');
	}
}

async function nodeOptionsOf(pid) {
	try {
		return nodeOptionsFromEnviron(readFileSync(`/proc/${pid}/environ`, 'latin1'));
	} catch {}
	const ps = await run('ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)]);
	return ps.ok ? nodeOptionsFromPsEnvironment(ps.stdout) : undefined;
}

export const defaultDependencies = {
	run,
	executableName,
	nodeOptionsOf,
	kill: (pid, signal) => process.kill(pid, signal),
	listReports: (directory) => {
		try {
			return readdirSync(directory);
		} catch {
			return [];
		}
	},
	readReport: (path) => JSON.parse(readFileSync(path, 'utf8')),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	now: () => Date.now(),
	log: (line) => {
		try {
			writeSync(2, `${line}\n`);
		} catch {}
	},
};

/** Prints what the step is still doing. Never throws. */
export async function dumpDiagnostics({
	rootPid,
	selfPid = process.pid,
	reportDirectory,
	deadlineMs,
	dependencies = defaultDependencies,
}) {
	const deps = { ...defaultDependencies, ...dependencies };
	const say = (line = '') => deps.log(line ? `[ci-watchdog] ${line}` : '[ci-watchdog]');
	try {
		const remaining = Math.max(0, Math.round((deadlineMs - deps.now()) / 1000));
		say('='.repeat(72));
		say(
			`This job times out in about ${formatElapsed(remaining)} (${new Date(deadlineMs).toISOString()}) and this step is still running.`,
		);
		say('What it is doing follows. Nothing is stopped; the step continues.');

		const ps = await deps.run('ps', ['-A', '-ww', '-o', 'pid=,ppid=,etime=,pcpu=,args=']);
		if (!ps.ok) say(`ps failed: ${ps.error?.message ?? ps.stderr}`);
		const tree = descendantsOf(parseProcessTable(ps.stdout), rootPid).filter(
			(row) => row.pid !== selfPid,
		);
		say('');
		say(`Processes this step started (${tree.length}): pid ppid elapsed cpu% command`);
		for (const row of tree) {
			say(
				`${'  '.repeat(row.depth)}${row.pid} ${row.ppid} ${formatElapsed(row.elapsedSeconds)} ${row.cpuPercent}% ${truncate(row.args)}`,
			);
		}

		const tests = runningTestFiles(tree);
		say('');
		if (tests.length === 0) say('Test files still running: none named on a command line');
		else {
			say('Test files still running:');
			for (const test of tests)
				say(`  ${test.file} (pid ${test.pid}, running ${formatElapsed(test.elapsedSeconds)})`);
		}

		const candidates = [];
		for (const row of tree) {
			if (deps.executableName(row.pid, row) !== 'node') continue;
			if (!reportsOnSignal(await deps.nodeOptionsOf(row.pid))) continue;
			candidates.push(row);
		}
		const before = new Set(deps.listReports(reportDirectory));
		const signalled = [];
		for (const row of candidates) {
			try {
				deps.kill(row.pid, REPORT_SIGNAL);
				signalled.push(row);
			} catch (error) {
				say(`Could not signal ${row.pid}: ${error.message}`);
			}
		}
		say('');
		say(`Diagnostic reports requested from ${signalled.length} Node process(es) into ${reportDirectory}`);
		const pending = new Map(signalled.map((row) => [row.pid, row]));
		const reports = new Map();
		const giveUpAt = deps.now() + REPORT_WAIT_MS;
		while (pending.size > 0) {
			const files = deps.listReports(reportDirectory).filter((file) => !before.has(file));
			for (const pid of [...pending.keys()]) {
				const file = reportFilesFor(files, pid).at(-1);
				if (!file) continue;
				try {
					reports.set(pid, deps.readReport(join(reportDirectory, file)));
					pending.delete(pid);
				} catch {
					// Still being written.
				}
			}
			if (pending.size === 0 || deps.now() >= giveUpAt) break;
			await deps.sleep(REPORT_POLL_MS);
		}
		for (const row of signalled) {
			say('');
			const report = reports.get(row.pid);
			if (!report) {
				say(
					`pid ${row.pid}: no report within ${REPORT_WAIT_MS / 1000}s; its JavaScript thread is busy and never returned to the event loop (cpu ${row.cpuPercent}%): ${truncate(row.args)}`,
				);
				continue;
			}
			for (const line of summarizeReport(report)) say(line);
		}

		for (const name of containersNamedIn(tree)) {
			say('');
			say(`Processes in container ${name}:`);
			const top = await deps.run('docker', ['top', name, '-eo', 'pid,ppid,etime,pcpu,args']);
			if (!top.ok) say(`  docker top failed: ${top.error?.message ?? top.stderr}`);
			for (const line of top.stdout.split('\n').filter(Boolean)) say(`  ${truncate(line)}`);
		}
		say('');
		say('Diagnostics complete; the step continues until it ends or the job times out.');
		say('='.repeat(72));
	} catch (error) {
		say(`Diagnostics failed: ${error instanceof Error ? error.stack : String(error)}`);
	}
}

async function main(argv) {
	const command = argv[0] === '--' ? argv.slice(1) : argv;
	if (command.length === 0) {
		process.stderr.write('usage: ci-watchdog.mjs [--] <command> [args...]\n');
		process.exit(64);
	}
	const reportDirectory = join(
		process.env.RUNNER_TEMP || tmpdir(),
		'terminay-ci-watchdog',
		String(process.pid),
	);
	let env = process.env;
	try {
		mkdirSync(reportDirectory, { recursive: true });
		env = withReportOptions(process.env, reportDirectory);
	} catch {}

	const child = spawn(command[0], command.slice(1), { env, stdio: 'inherit' });
	const forwarded = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'];
	const forward = (signal) => {
		try {
			child.kill(signal);
		} catch {}
	};
	for (const signal of forwarded) process.on(signal, forward);

	const plan = watchdogPlan(process.env, Date.now());
	const watchdog = plan
		? armWatchdog({
				delayMs: plan.delayMs,
				onExpire: () => {
					void dumpDiagnostics({
						rootPid: child.pid,
						reportDirectory,
						deadlineMs: plan.deadlineMs,
					});
				},
			})
		: undefined;

	child.on('error', (error) => {
		watchdog?.disarm();
		process.stderr.write(`ci-watchdog: ${error.message}\n`);
		process.exit(127);
	});
	child.on('exit', (code, signal) => {
		watchdog?.disarm();
		const status = exitStatus(code, signal, osConstants.signals);
		if (!signal) process.exit(status);
		// Die of the same signal, so the runner sees what it would have seen.
		// A signal Node ignores, such as SIGPIPE, ends in the shell's 128+n.
		for (const name of forwarded) process.removeListener(name, forward);
		try {
			process.kill(process.pid, signal);
		} catch {}
		setTimeout(() => process.exit(status), 1000);
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main(process.argv.slice(2));
}
