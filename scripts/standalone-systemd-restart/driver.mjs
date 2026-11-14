// Runs inside a privileged container with systemd as PID 1. See
// scripts/standalone-systemd-restart.mjs, which starts it.
//
// Every verdict about a terminal is read from that terminal's own output: the
// driver asks a real shell, through the server's own MCP tools, to make a
// directory in /tmp and print a marker. Nothing here stands in for the server,
// the session holder, the unit, or systemd.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createInterface } from 'node:readline';

import { runInstall } from '/cli/dist/commands/install.js';
import { runUninstall } from '/cli/dist/commands/uninstall.js';
import { resolveContext } from '/cli/dist/context.js';
import { installLayout } from '/cli/dist/layout.js';

const BUILT_ARCHIVE = process.argv[2];

/**
 * The CLI installs a local archive as it installs a source build, so it
 * expects the manifest to say `source`. A copy is repacked saying so; the
 * archive is not signed either way, and every file hash still stands.
 */
function asSourceArchive(built) {
	const work = '/var/tmp/systemd-restart-archive';
	rmSync(work, { recursive: true, force: true });
	mkdirSync(work, { recursive: true });
	sh('tar', ['-xzf', built, '-C', work]);
	const [root] = readdirSync(work);
	const manifestPath = `${work}/${root}/artifact-manifest.json`;
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, channel: 'source' }, null, 2)}\n`);
	const repacked = `/var/tmp/${root}.tar.gz`;
	sh('tar', ['-czf', repacked, '-C', work, root]);
	rmSync(work, { recursive: true, force: true });
	return repacked;
}
function preparedSourceArchive(archive) {
	const expected = process.env.TERMINAY_SYSTEMD_PREPARED_SHA256;
	assert.match(expected ?? '', /^[a-f0-9]{64}$/u);
	assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), expected, 'prepared source archive changed during transfer');
	const root = process.env.TERMINAY_SYSTEMD_PREPARED_ROOT;
	assert.match(root ?? '', /^terminay-server-node24\.15\.0-linux-(?:x64|arm64)$/u);
	const manifest = JSON.parse(sh('tar', ['--occurrence=1', '-xOzf', archive, `${root}/artifact-manifest.json`]));
	assert.equal(manifest.channel, 'source');
	assert.equal(manifest.revision, process.env.TERMINAY_SYSTEMD_PREPARED_REVISION);
	assert.equal(manifest.target, process.env.TERMINAY_SYSTEMD_PREPARED_TARGET);
	return archive;
}
const ARCHIVE = process.env.TERMINAY_SYSTEMD_PREPARED_SHA256 ? preparedSourceArchive(BUILT_ARCHIVE) : asSourceArchive(BUILT_ARCHIVE);
const SCENARIOS = (process.argv[3] ?? 'A,B,C').split(',');
// The negative control: the same scenario with the helper's watch stopped, so
// nothing can act on the server's request. It must fail.
const NEGATIVE = process.env.TERMINAY_SYSTEMD_NEGATIVE === '1';
const RUN_AS = 'terminay';
const UNIT = 'terminay-server.service';
const HELPER = 'terminay-upgrade.service';
const layout = installLayout('system');
const write = (line) => process.stdout.write(`${line}\n`);
const streams = { input: { isTTY: false }, output: process.stdout };
const options = {
	allowDowngrade: false,
	purge: true,
	yes: true,
	wait: false,
	scope: 'system',
	expose: 'off',
	runAs: RUN_AS,
};

function sh(command, args, { allowFailure = false } = {}) {
	try {
		return execFileSync(command, args, { encoding: 'utf8' }).trim();
	} catch (error) {
		if (allowFailure) return (error.stdout ?? '').trim();
		throw new Error(
			`${command} ${args.join(' ')} failed: ${error.stderr ?? error.message}`,
		);
	}
}
const systemctl = (...args) => sh('systemctl', args, { allowFailure: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mainPid = () => Number(systemctl('show', UNIT, '-p', 'MainPID', '--value'));

async function until(what, check, timeoutMs = 60_000, intervalMs = 250) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await check();
		if (value) return value;
		if (Date.now() > deadline) {
			write(journal(UNIT, 80));
			throw new Error(`timed out waiting for ${what}`);
		}
		await sleep(intervalMs);
	}
}

function journal(unit, lines = 400) {
	return sh('journalctl', ['-u', unit, '--no-pager', '-o', 'cat', '-n', String(lines)], {
		allowFailure: true,
	});
}

/** Session-holder reports the server has written to its journal since `since`. */
function holderReports(since) {
	return sh('journalctl', ['-u', UNIT, '--no-pager', '-o', 'cat', '--since', since], {
		allowFailure: true,
	})
		.split('\n')
		.filter((line) => line.startsWith('[terminay-server] session holder '))
		.map((line) => JSON.parse(line.slice('[terminay-server] session holder '.length)));
}

const now = () => sh('date', ['+%Y-%m-%d %H:%M:%S']);

async function ready() {
	await until('the server to report ready', async () => {
		if (systemctl('is-active', UNIT) !== 'active') return false;
		try {
			const response = await fetch('http://127.0.0.1:8444/readyz');
			return response.ok && (await response.json()).ready === true;
		} catch {
			return false;
		}
	}, 120_000, 500);
}

// --- shells -----------------------------------------------------------------

function uidOf(user) {
	return Number(sh('id', ['-u', user]));
}

function environOf(pid) {
	try {
		return Object.fromEntries(
			readFileSync(`/proc/${pid}/environ`, 'utf8')
				.split('\0')
				.filter(Boolean)
				.map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]),
		);
	} catch {
		return undefined;
	}
}

function parentOf(pid) {
	const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
	return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
}

/** Shells the run-as account has that carry a terminal's control credentials. */
function terminalShells() {
	const uid = uidOf(RUN_AS);
	const shells = [];
	for (const name of readdirSync('/proc')) {
		if (!/^\d+$/u.test(name)) continue;
		const pid = Number(name);
		try {
			if (statSync(`/proc/${pid}`).uid !== uid) continue;
			const comm = readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
			if (!['bash', 'sh', 'dash'].includes(comm)) continue;
			const env = environOf(pid);
			if (env?.TERMINAY_CONTROL_TOKEN === undefined) continue;
			shells.push({ pid, holder: parentOf(pid), env });
		} catch {
			/* gone */
		}
	}
	return shells.sort((left, right) => left.pid - right.pid);
}

/**
 * An MCP session as the given terminal: `terminay-server mcp` with that
 * terminal's own socket and token, run as the account that owns it.
 */
function mcpAs(shell) {
	const child = spawn(
		'runuser',
		[
			'-u',
			RUN_AS,
			'--',
			'env',
			`TERMINAY_CONTROL_SOCKET=${shell.env.TERMINAY_CONTROL_SOCKET}`,
			`TERMINAY_CONTROL_TOKEN=${shell.env.TERMINAY_CONTROL_TOKEN}`,
			'/opt/terminay/current/bin/terminay-server',
			'mcp',
		],
		{ stdio: ['pipe', 'pipe', 'inherit'] },
	);
	const pending = new Map();
	let next = 1;
	createInterface({ input: child.stdout }).on('line', (line) => {
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		const waiter = pending.get(message.id);
		if (waiter === undefined) return;
		pending.delete(message.id);
		if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
		else waiter.resolve(message.result);
	});
	const request = (method, params) =>
		new Promise((resolve, reject) => {
			const id = next++;
			pending.set(id, { resolve, reject });
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
		});
	const opened = request('initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'systemd-restart-driver', version: '1' },
	}).then(() => {
		child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
	});
	const call = async (name, args = {}) => {
		await opened;
		const result = await request('tools/call', { name, arguments: args });
		const text = (result.content ?? []).map((part) => part.text ?? '').join('\n');
		if (result.isError) throw new Error(`${name}: ${text}`);
		// "<tool> ok" on the first line, then the result as JSON.
		for (const candidate of [text, text.slice(text.indexOf('\n') + 1)]) {
			try {
				return JSON.parse(candidate);
			} catch {
				/* try the next form */
			}
		}
		return text;
	};
	return { call, close: () => child.kill() };
}

/**
 * Ask a terminal to make a directory in /tmp. Returns 'ok', or the shell's
 * own complaint. The marker is assembled by the shell, so an echo of the typed
 * command cannot be mistaken for its result.
 */
async function selfHandle(mcp) {
	const listed = await mcp.call('list_terminals');
	const self = listed.terminals?.find((entry) => entry.self === true);
	assert.ok(self, `no terminal is this one: ${JSON.stringify(listed)}`);
	return self.terminal;
}

async function tmpWorks(mcp, target, label) {
	const terminal = target ?? (await selfHandle(mcp));
	const tag = `${label}-${Date.now()}`;
	const command = `if mkdir "/tmp/sr-${tag}-$$"; then echo "SR""-OK-${tag}"; else echo "SR""-FAIL-${tag}"; fi`;
	const run = await mcp.call('run_command', { terminal, command });
	let last = '';
	let verdict;
	try {
		verdict = await until(`the shell's answer to ${label}`, async () => {
			const read = await mcp.call('read_terminal', {
				terminal,
				format: 'raw',
				after: run.from,
			});
			const text =
				read?.encoding === 'base64'
					? Buffer.from(read.output, 'base64').toString('utf8')
					: typeof read === 'string'
						? read
						: JSON.stringify(read);
			last = text;
			if (text.includes(`SR-OK-${tag}`)) return 'ok';
			if (text.includes(`SR-FAIL-${tag}`)) return text.slice(0, 400);
			return false;
		}, 20_000, 250);
	} catch (error) {
		throw new Error(`${error.message}; last read: ${last.slice(-1500)}`);
	}
	write(`  ${label}: ${verdict === 'ok' ? 'mkdir /tmp ok' : `failed: ${verdict}`}`);
	return verdict;
}

// --- installs ---------------------------------------------------------------

async function freshInstall() {
	if (existsSync(layout.recordPath)) {
		await runUninstall(options, await resolveContext({ options, write }), streams);
	}
	await runInstall(undefined, options, {
		write,
		streams,
		localArchivePath: ARCHIVE,
		readinessTimeoutMs: 120_000,
	});
	await ready();
	assert.doesNotMatch(readFileSync(layout.unitPath, 'utf8'), /^PrivateTmp=/mu, 'a current release shares /tmp');
	return until('the seeded terminal', () => terminalShells()[0], 30_000);
}

/** What the unit of an older release looked like. */
function giveUnitPrivateTmp() {
	const unit = readFileSync(layout.unitPath, 'utf8');
	writeFileSync(layout.unitPath, unit.replace('NoNewPrivileges=true\n', 'NoNewPrivileges=true\nPrivateTmp=true\n'));
	systemctl('daemon-reload');
}

// --- scenarios --------------------------------------------------------------

async function scenarioA() {
	write('--- A: restarts keep every terminal able to use /tmp ---');
	const s1 = await freshInstall();
	const mcp = mcpAs(s1);
	try {
		assert.equal(await tmpWorks(mcp, undefined, 'A-S1-before'), 'ok');
		for (const round of [1, 2]) {
			const before = mainPid();
			systemctl('restart', UNIT);
			await until('a new server process', () => mainPid() !== before && mainPid() !== 0);
			await ready();
			write(`  restart ${round} done`);
		}
		assert.ok(existsSync(`/proc/${s1.pid}`), 'S1 survived both restarts');
		assert.equal(await tmpWorks(mcp, undefined, 'A-S1-after'), 'ok');
		const opened = await mcp.call('open_terminal', { name: 'S2' });
		assert.equal(await tmpWorks(mcp, opened.terminal, 'A-S2'), 'ok');
	} finally {
		mcp.close();
	}
}

async function scenarioB() {
	write('--- B: a unit an older upgrader left with PrivateTmp repairs itself ---');
	await freshInstall();
	// Start over under the older unit, so the holder and S1 are born under a
	// private /tmp, exactly as on a host an older release installed.
	systemctl('stop', UNIT);
	sh('/opt/terminay/current/bin/terminay-server', ['end-sessions', '--data-root', '/var/lib/terminay'], {
		allowFailure: true,
	});
	rmSync('/var/lib/terminay/workspace.v3.json', { force: true });
	giveUnitPrivateTmp();
	if (NEGATIVE) systemctl('stop', 'terminay-upgrade.path');

	// An older upgrader's oneshot still running its readiness wait: the
	// server must not write its request until this has finished.
	const dropIn = `/etc/systemd/system/${HELPER}.d`;
	mkdirSync(dropIn, { recursive: true });
	writeFileSync(
		`${dropIn}/zz-hold.conf`,
		`[Service]\nExecStart=\nExecStart=/bin/sh -c 'sleep 10; rm -f ${dropIn}/zz-hold.conf; systemctl daemon-reload'\n`,
	);
	systemctl('daemon-reload');
	systemctl('start', '--no-block', HELPER);
	await until('the held helper to be active', () => systemctl('is-active', HELPER) === 'activating' || systemctl('is-active', HELPER) === 'active');

	const since = now();
	const requestBefore = existsSync(layout.upgradeHelper.requestFile)
		? statSync(layout.upgradeHelper.requestFile).mtimeMs
		: 0;
	systemctl('start', UNIT);
	await ready();
	const firstServer = mainPid();
	const s1 = await until('S1 under the private /tmp', () => terminalShells()[0], 30_000);
	assert.match(readFileSync(`/proc/${firstServer}/mountinfo`, 'utf8'), /systemd-private-/u);

	// The helper finishes; only then may the request appear.
	await until('the held helper to finish', () => systemctl('is-active', HELPER) !== 'activating' && systemctl('is-active', HELPER) !== 'active', 60_000);
	const helperDoneAt = Date.now();
	const requested = await until(
		'the server to request the repair',
		() => existsSync(layout.upgradeHelper.requestFile) && statSync(layout.upgradeHelper.requestFile).mtimeMs > requestBefore && statSync(layout.upgradeHelper.requestFile).mtimeMs,
		90_000,
	);
	assert.ok(requested >= helperDoneAt - 1500, 'the request was written while the helper was still running');
	write('  the request came after the helper finished');

	// systemd runs the helper, whose CLI repairs the unit and restarts once.
	await until('the unit to be repaired', () => !/^PrivateTmp=/mu.test(readFileSync(layout.unitPath, 'utf8')), 120_000, 500);
	await until('the repaired server', () => mainPid() !== firstServer && mainPid() !== 0, 120_000);
	await ready();
	assert.doesNotMatch(readFileSync(`/proc/${mainPid()}/mountinfo`, 'utf8'), /systemd-private-/u);
	write('  the unit was repaired and the server restarted onto the host /tmp');

	// The old holder was born in the deleted /tmp: drained, its session marked.
	const drained = await until('the drained report', () =>
		holderReports(since).find((report) => report.kind === 'drained' && report.holder.pid === s1.holder),
	);
	assert.equal(drained.cause, 'unhealthy');
	assert.equal(drained.degraded, true);
	assert.equal(drained.facts.tmp, 'missing');
	write(`  S1's holder drained: ${JSON.stringify(drained.facts)}`);

	const mcp = mcpAs(s1);
	try {
		assert.notEqual(await tmpWorks(mcp, undefined, 'B-S1'), 'ok', 'S1 really did lose its /tmp');
		const opened = await mcp.call('open_terminal', { name: 'S2' });
		assert.equal(await tmpWorks(mcp, opened.terminal, 'B-S2'), 'ok');
		const s2 = terminalShells().find((shell) => shell.pid !== s1.pid);
		assert.notEqual(s2.holder, s1.holder, 'S2 runs in a new holder');
		// Close S1: its drained holder has nothing left and exits.
		await mcp.call('run_command', { terminal: await selfHandle(mcp), command: 'exit' }).catch(() => undefined);
	} finally {
		mcp.close();
	}
	await until('the drained holder to exit', () => !existsSync(`/proc/${s1.holder}`), 30_000);
	write('  the drained holder exited once S1 closed');
}

async function scenarioC() {
	write('--- C: an offline upgrade still repairs the unit, restarts once, and reports the failure ---');
	await freshInstall();
	giveUnitPrivateTmp();
	// Followed like a tagged install, with the release host unreachable.
	const record = JSON.parse(readFileSync(layout.recordPath, 'utf8'));
	writeFileSync(layout.recordPath, `${JSON.stringify({ ...record, channel: 'tag' }, null, 2)}\n`);
	const hosts = readFileSync('/etc/hosts', 'utf8');
	writeFileSync('/etc/hosts', `${hosts}\n127.0.0.1 api.github.com github.com objects.githubusercontent.com\n`);
	const before = mainPid();
	const starts = () => Number(systemctl('show', UNIT, '-p', 'ExecMainStartTimestampMonotonic', '--value'));
	const firstStart = starts();
	let failure = '';
	try {
		execFileSync('/opt/terminay/current/bin/terminay', ['daemon', 'upgrade', '--system'], { encoding: 'utf8', stdio: 'pipe' });
	} catch (error) {
		failure = `${error.stdout ?? ''}${error.stderr ?? ''}`;
	} finally {
		writeFileSync('/etc/hosts', hosts);
	}
	assert.notEqual(failure, '', 'the network failure is still reported');
	write(`  reported: ${failure.trim().split('\n').at(-1)}`);
	assert.doesNotMatch(readFileSync(layout.unitPath, 'utf8'), /^PrivateTmp=/mu);
	assert.notEqual(mainPid(), before);
	assert.notEqual(starts(), firstStart);
	// Exactly once: the process it restarted onto is the one still running.
	const restarted = mainPid();
	await sleep(5_000);
	assert.equal(mainPid(), restarted, 'the server was restarted more than once');
	await ready();
	write('  repaired and restarted once');
}

sh('id', [RUN_AS], { allowFailure: true }) ||
	sh('useradd', ['--system', '--create-home', '--shell', '/bin/bash', RUN_AS]);
for (const scenario of SCENARIOS) {
	if (scenario === 'A') await scenarioA();
	else if (scenario === 'B') await scenarioB();
	else if (scenario === 'C') await scenarioC();
	else throw new Error(`unknown scenario ${scenario}`);
}
write('SYSTEMD RESTART OK');
process.exit(0);
