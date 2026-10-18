import assert from 'node:assert/strict';
import test from 'node:test';

import {
	armWatchdog,
	containersNamedIn,
	descendantsOf,
	dumpDiagnostics,
	exitStatus,
	leadMs,
	nodeOptionsFromEnviron,
	nodeOptionsFromPsEnvironment,
	parseElapsed,
	parseProcessTable,
	REPORT_SIGNAL,
	reportFilesFor,
	reportsOnSignal,
	runningTestFiles,
	summarizeReport,
	watchdogPlan,
	withReportOptions,
} from './ci-watchdog.mjs';

test('the dump is planned from the job start and timeout, ahead of the timeout', () => {
	assert.equal(leadMs(10 * 60_000), 90_000);
	assert.equal(leadMs(2 * 60_000), 60_000, 'never less than a minute ahead');
	assert.equal(leadMs(40 * 60_000), 180_000, 'never more than three minutes ahead');

	const startedAt = 1_000_000;
	const env = { TERMINAY_CI_JOB_STARTED_AT: String(startedAt), TERMINAY_CI_JOB_TIMEOUT_MINUTES: '10' };
	assert.deepEqual(watchdogPlan(env, startedAt * 1000 + 30_000), {
		deadlineMs: startedAt * 1000 + 600_000,
		fireAtMs: startedAt * 1000 + 510_000,
		delayMs: 480_000,
	});
	// A step that starts after the moment has passed dumps at once.
	assert.equal(watchdogPlan(env, startedAt * 1000 + 590_000).delayMs, 0);
	// Outside CI there is no budget and so no timer.
	assert.equal(watchdogPlan({}, 0), undefined);
	assert.equal(watchdogPlan({ TERMINAY_CI_JOB_STARTED_AT: '5' }, 0), undefined);
	assert.equal(watchdogPlan({ TERMINAY_CI_JOB_STARTED_AT: 'x', TERMINAY_CI_JOB_TIMEOUT_MINUTES: '5' }, 0), undefined);
});

function fakeClock() {
	const timers = new Map();
	let next = 1;
	return {
		timers,
		setTimer(callback, delay) {
			const id = next++;
			timers.set(id, { callback, delay });
			return id;
		},
		clearTimer(id) {
			timers.delete(id);
		},
		fireAll() {
			for (const [id, { callback }] of [...timers]) {
				timers.delete(id);
				callback();
			}
		},
	};
}

test('the watchdog fires once, through the injected timer, unless disarmed first', () => {
	const clock = fakeClock();
	let expired = 0;
	const watchdog = armWatchdog({ delayMs: 1234, onExpire: () => expired++, ...clock });
	assert.deepEqual([...clock.timers.values()].map(({ delay }) => delay), [1234]);
	assert.equal(watchdog.fired, false);
	clock.fireAll();
	assert.equal(expired, 1);
	assert.equal(watchdog.fired, true);
	watchdog.disarm();
	clock.fireAll();
	assert.equal(expired, 1);

	const early = fakeClock();
	const disarmed = armWatchdog({ delayMs: 5, onExpire: () => expired++, ...early });
	disarmed.disarm();
	assert.equal(early.timers.size, 0, 'a step that ends first cancels its timer');
	assert.equal(disarmed.fired, false);
	assert.equal(expired, 1);
});

test('the child is given the report flags in NODE_OPTIONS, once', () => {
	const env = withReportOptions({ PATH: '/bin', NODE_OPTIONS: '--max-old-space-size=4096' }, '/runner/temp/reports');
	assert.equal(
		env.NODE_OPTIONS,
		'--report-on-signal --report-signal=SIGUSR2 --report-exclude-env --report-exclude-network --report-directory=/runner/temp/reports --max-old-space-size=4096',
	);
	assert.equal(env.PATH, '/bin');
	assert.deepEqual(withReportOptions(env, '/elsewhere'), env, 'a nested wrapper adds nothing');
	assert.match(withReportOptions({}, '/a b/c').NODE_OPTIONS, / --report-directory="\/a b\/c"$/u);
	assert.ok(reportsOnSignal(withReportOptions({}, '/r').NODE_OPTIONS));
});

test('only a process whose NODE_OPTIONS asks for a SIGUSR2 report is signalled', () => {
	assert.equal(reportsOnSignal(undefined), false);
	assert.equal(reportsOnSignal(''), false);
	assert.equal(reportsOnSignal('--report-on-signal'), true, 'SIGUSR2 is the default report signal');
	assert.equal(reportsOnSignal('--report-on-signal --report-signal=SIGUSR2'), true);
	assert.equal(reportsOnSignal('--report-on-signal --report-signal=SIGUSR2 --report-signal=SIGQUIT'), false);
	assert.equal(reportsOnSignal('--report-signal=SIGUSR2'), false);

	assert.equal(
		nodeOptionsFromEnviron('PATH=/bin\0NODE_OPTIONS=--report-on-signal --x\0HOME=/h\0'),
		'--report-on-signal --x',
	);
	assert.equal(nodeOptionsFromEnviron('PATH=/bin\0'), undefined);
	assert.equal(
		nodeOptionsFromPsEnvironment(
			'node --test a.test.mjs TERM=xterm NODE_OPTIONS=--report-on-signal --report-signal=SIGUSR2 HOME=/Users/x',
		),
		'--report-on-signal --report-signal=SIGUSR2',
	);
	assert.equal(nodeOptionsFromPsEnvironment('node script.mjs HOME=/x'), undefined);
});

const table = `
    1     0       05:00  0.0 /sbin/init
   10     1       04:00  0.0 node scripts/ci-watchdog.mjs bash --noprofile --norc -eo pipefail /tmp/step.sh
   11    10       03:59  0.0 bash --noprofile --norc -eo pipefail /tmp/step.sh
   12    11       03:58  1.5 node /usr/bin/npm run smoke
   13    12       03:00  0.2 node --test scripts/a.test.mjs scripts/b.test.mjs
   14    13       02:30 99.0 /usr/local/bin/node --experimental-strip-types scripts/b.test.mjs
   20     1    1-02:03:04  0.0 unrelated --process
   21    11       01:00  0.0 docker start --attach terminay-e2e-20261018T000000Z-7
`;

test('ps output becomes the step’s process tree, with elapsed seconds', () => {
	assert.equal(parseElapsed('05'), undefined);
	assert.equal(parseElapsed('00:07'), 7);
	assert.equal(parseElapsed('03:59'), 239);
	assert.equal(parseElapsed('02:03:04'), 7384);
	assert.equal(parseElapsed('1-02:03:04'), 93_784);

	const rows = parseProcessTable(table);
	assert.equal(rows.length, 8);
	assert.deepEqual(rows[5], {
		pid: 14,
		ppid: 13,
		elapsedSeconds: 150,
		cpuPercent: 99,
		args: '/usr/local/bin/node --experimental-strip-types scripts/b.test.mjs',
	});
	assert.deepEqual(
		descendantsOf(rows, 11).map(({ pid, depth }) => [pid, depth]),
		[
			[11, 0],
			[12, 1],
			[13, 2],
			[14, 3],
			[21, 1],
		],
	);
	assert.deepEqual(descendantsOf(rows, 999), []);
});

test('the test files still running are the ones a process runs alone', () => {
	const tree = descendantsOf(parseProcessTable(table), 11);
	assert.deepEqual(runningTestFiles(tree), [
		{ pid: 14, elapsedSeconds: 150, file: 'scripts/b.test.mjs' },
	]);
	assert.deepEqual(
		runningTestFiles([
			{ pid: 1, elapsedSeconds: 3, args: 'node --test e2e/app.spec.ts' },
			{ pid: 2, elapsedSeconds: 2, args: 'node --test --test-reporter=spec src/x.test.ts' },
			{ pid: 3, elapsedSeconds: 1, args: 'node scripts/not-a-test.mjs' },
		]).map(({ file }) => file),
		['e2e/app.spec.ts', 'src/x.test.ts'],
	);
});

test('containers the step attached to are found on its command lines', () => {
	assert.deepEqual(containersNamedIn(parseProcessTable(table)), ['terminay-e2e-20261018T000000Z-7']);
	assert.deepEqual(
		containersNamedIn([
			{ args: 'docker run --rm --name smoke-a image:tag' },
			{ args: '/usr/bin/docker run --name=smoke-b image' },
			{ args: 'docker run image' },
			{ args: 'docker build .' },
		]),
		['smoke-a', 'smoke-b'],
	);
});

test('report files are matched to the process that wrote them', () => {
	const files = [
		'report.20261018.174058.8030.0.001.json',
		'report.20261018.174059.8030.0.002.json',
		'report.20261018.174058.80300.0.001.json',
		'unrelated.json',
	];
	assert.deepEqual(reportFilesFor(files, 8030), [
		'report.20261018.174058.8030.0.001.json',
		'report.20261018.174059.8030.0.002.json',
	]);
	assert.deepEqual(reportFilesFor(files, 1), []);
});

const report = {
	header: { processId: 14, commandLine: ['/usr/local/bin/node', 'scripts/b.test.mjs'] },
	javascriptStack: { message: '', stack: [] },
	libuv: [
		{ type: 'async', is_active: true, is_referenced: false, address: '0x1' },
		{ type: 'timer', is_active: true, is_referenced: true, address: '0x2', repeat: 0, firesInMsFromNow: 3232, expired: false },
		{ type: 'signal', is_active: true, is_referenced: false, address: '0x3', signum: 31, signal: 'SIGUSR2' },
		{
			type: 'tcp',
			is_active: true,
			is_referenced: true,
			address: '0x4',
			localEndpoint: { ip6: '::', port: 64967 },
			remoteEndpoint: null,
			fd: 14,
		},
		{ type: 'idle', is_active: false, is_referenced: true, address: '0x5' },
		{ type: 'loop', is_active: true, address: '0x6', loopIdleTimeSeconds: 1 },
	],
	workers: [],
};

test('a report is summarized as its stack and the handles holding the process open', () => {
	assert.deepEqual(summarizeReport(report), [
		'pid 14: /usr/local/bin/node scripts/b.test.mjs',
		'  JavaScript stack: none (the event loop is idle, waiting on the handles below)',
		'  Active handles keeping it alive: 2',
		'    timer repeat=0 firesInMsFromNow=3232 expired=false',
		'    tcp local=[::]:64967 fd=14',
		'  Other handles: async×1, signal×1, idle×1',
	]);
	const busy = summarizeReport({
		header: { processId: 2, commandLine: ['node'] },
		javascriptStack: { message: 'Error [report]', stack: ['at spin (file:///a.mjs:1:1)', 'at file:///a.mjs:2:1'] },
		libuv: [],
		workers: [{}],
	});
	assert.deepEqual(busy.slice(1, 4), [
		'  JavaScript stack: Error [report]',
		'    at spin (file:///a.mjs:1:1)',
		'    at file:///a.mjs:2:1',
	]);
	assert.equal(busy.at(-1), '  Worker threads: 1');
});

test('the step’s exit status is the child’s', () => {
	const signals = { SIGTERM: 15, SIGPIPE: 13 };
	assert.equal(exitStatus(0, null, signals), 0);
	assert.equal(exitStatus(3, null, signals), 3);
	assert.equal(exitStatus(null, 'SIGTERM', signals), 143);
	assert.equal(exitStatus(null, 'SIGUNKNOWN', signals), 1);
});

test('the dump signals only Node processes that asked for reports, and stops nothing', async () => {
	const lines = [];
	const killed = [];
	let now = 0;
	const reportDirectory = '/reports';
	const written = [];
	await dumpDiagnostics({
		rootPid: 11,
		selfPid: 10,
		reportDirectory,
		deadlineMs: 90_000,
		dependencies: {
			log: (line) => lines.push(line),
			now: () => now,
			sleep: async (ms) => {
				now += ms;
				// Node writes a report a moment after its signal.
				if (killed.includes(14) && !written.includes(14)) written.push(14);
			},
			run: async (file, args) => {
				if (file === 'ps') return { ok: true, stdout: table, stderr: '' };
				if (file === 'docker') {
					assert.deepEqual(args.slice(0, 2), ['top', 'terminay-e2e-20261018T000000Z-7']);
					return { ok: true, stdout: 'PID PPID ELAPSED %CPU COMMAND\n900 1 00:30 50.0 electron .\n', stderr: '' };
				}
				throw new Error(`unexpected ${file}`);
			},
			executableName: (pid) => ({ 12: 'node', 13: 'node', 14: 'node', 21: 'docker' })[pid] ?? 'bash',
			// The npm process was started without the flags; it must not be signalled.
			nodeOptionsOf: async (pid) => (pid === 12 ? undefined : '--report-on-signal --report-signal=SIGUSR2'),
			kill: (pid, signal) => {
				assert.equal(signal, REPORT_SIGNAL);
				killed.push(pid);
			},
			listReports: () => written.map((pid) => `report.20261018.000000.${pid}.0.001.json`),
			readReport: (path) => {
				assert.equal(path, '/reports/report.20261018.000000.14.0.001.json');
				return report;
			},
		},
	});
	assert.deepEqual(killed, [13, 14]);
	const text = lines.join('\n');
	assert.match(text, /This job times out in about 1m30s/u);
	assert.match(text, /Processes this step started \(5\)/u);
	assert.match(text, /\n\[ci-watchdog\] {7}14 13 2m30s 99% \/usr\/local\/bin\/node/u);
	assert.match(text, /Test files still running:\n\[ci-watchdog\] {3}scripts\/b\.test\.mjs \(pid 14, running 2m30s\)/u);
	assert.match(text, /tcp local=\[::\]:64967/u);
	assert.match(text, /pid 13: no report within 20s; its JavaScript thread is busy/u);
	assert.match(text, /Processes in container terminay-e2e-20261018T000000Z-7:\n\[ci-watchdog\] {3}PID PPID/u);
	assert.match(text, /Diagnostics complete; the step continues/u);
	assert.doesNotMatch(text, /unrelated --process/u, 'processes outside the step are not listed');
});

test('a failing diagnostic is reported, never thrown', async () => {
	const lines = [];
	await dumpDiagnostics({
		rootPid: 1,
		reportDirectory: '/r',
		deadlineMs: 0,
		dependencies: {
			log: (line) => lines.push(line),
			now: () => 0,
			run: async () => {
				throw new Error('no ps here');
			},
		},
	});
	assert.match(lines.at(-1), /Diagnostics failed: Error: no ps here/u);
});
