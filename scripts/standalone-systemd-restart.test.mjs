import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runSystemdRestart, SCENARIOS } from './standalone-systemd-restart.mjs';

/**
 * ADR-0116's gate. The real run needs a privileged systemd container and an
 * archive for the daemon's architecture, so it runs when
 * TERMINAY_SYSTEMD_ARCHIVE names one (the `standalone-systemd-restart` CI job
 * does). The contract below holds everywhere.
 */

const archive = process.env.TERMINAY_SYSTEMD_ARCHIVE;

test('a real restart under systemd keeps old and new terminals able to use /tmp', {
	skip: archive === undefined && 'set TERMINAY_SYSTEMD_ARCHIVE to an archive to run it',
	timeout: 30 * 60 * 1000,
}, () => {
	runSystemdRestart({ archive, scenarios: SCENARIOS });
});

test('the driver judges every terminal from its own shell output, through the real server', async () => {
	const driver = await readFile(new URL('standalone-systemd-restart/driver.mjs', import.meta.url), 'utf8');
	// A marker the shell assembles, so an echo of the typed command never passes.
	assert.match(driver, /echo "SR""-OK-\$\{tag\}"/u);
	assert.match(driver, /'\/opt\/terminay\/current\/bin\/terminay-server',\s*'mcp'/u);
	// The installed unit, real systemd, the real upgrade helper.
	assert.match(driver, /localArchivePath: ARCHIVE/u);
	assert.match(driver, /systemctl\('restart', UNIT\)/u);
	assert.match(driver, /'terminay-upgrade\.service'/u);
	// B waits for an older upgrader's oneshot, and the request must follow it.
	assert.match(driver, /sleep 10; rm -f/u);
	assert.match(driver, /the request was written while the helper was still running/u);
	// C repairs with the release host unreachable.
	assert.match(driver, /127\.0\.0\.1 api\.github\.com/u);
	assert.deepEqual([...SCENARIOS], ['A', 'B', 'C']);
});

test('CI runs it on every pull request against the archive this commit builds', async () => {
	const ci = await readFile(new URL('../.gitea/workflows/ci.yml', import.meta.url), 'utf8');
	const start = ci.indexOf('\n  standalone-systemd-restart:\n');
	assert.notEqual(start, -1, 'the standalone-systemd-restart job exists');
	const rest = ci.slice(start + 1);
	const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/u);
	const body = next === -1 ? rest : rest.slice(0, next + 1);
	assert.match(body, /needs: linux-glibc-floor/u);
	assert.match(body, /actions\/download-artifact@/u);
	assert.match(body, /standalone-floor-\$\{\{ github.sha \}\}/u);
	assert.match(body, /node scripts\/standalone-systemd-restart\.mjs --archive/u);
	assert.match(body, /timeout-minutes: \d+/u);
});

test('systemd package layer is cached independently of commit and copied archive inputs', async () => {
	const { buildSystemdImage } = await import('./standalone-systemd-restart.mjs');
	const { existsSync, readdirSync, readFileSync } = await import('node:fs');
	const calls = [];
	const runCommand = (command, args, options) => {
		const context = args.at(-1);
		assert.deepEqual(readdirSync(context), ['Dockerfile']);
		const source = readFileSync(`${context}/Dockerfile`, 'utf8');
		assert.match(source, /FROM \$\{SYSTEMD_BASE_IMAGE\}/u);
		for (const dependency of ['systemd', 'systemd-sysv', 'nodejs', 'procps', 'util-linux', 'sudo']) assert.ok(source.includes(dependency));
		assert.match(source, /CMD \["\/lib\/systemd\/systemd"\]/u);
		assert.equal(command, 'docker');
		assert.equal(options.timeout, 300000);
		calls.push(args);
	};
	const first = buildSystemdImage({ image: 'mirror/debian:bookworm-slim', runCommand });
	const repeated = buildSystemdImage({ image: 'mirror/debian:bookworm-slim', runCommand });
	const otherBase = buildSystemdImage({ image: 'other/debian:bookworm-slim', runCommand });
	assert.equal(first, repeated);
	assert.notEqual(first, otherBase);
	assert.deepEqual(calls[0].slice(0, 5), ['build', '--build-arg', 'SYSTEMD_BASE_IMAGE=mirror/debian:bookworm-slim', '--tag', first]);
	assert.ok(calls.every(args => !existsSync(args.at(-1))), 'temporary build contexts are removed');
});

test('failed image build cleans its context and propagates the failure', async () => {
	const { buildSystemdImage } = await import('./standalone-systemd-restart.mjs');
	const { existsSync } = await import('node:fs');
	let context;
	assert.throws(() => buildSystemdImage({ runCommand: (_command, args) => { context = args.at(-1); throw new Error('build failed'); } }), /build failed/u);
	assert.equal(existsSync(context), false);
});

test('parallel scenarios build once and use distinct containers with safe argv', async () => {
	const { runSystemdScenarios } = await import('./standalone-systemd-restart.mjs');
	const { EventEmitter } = await import('node:events');
	let builds = 0;
	const calls = [], removed = [];
	await runSystemdScenarios({ archive: '/tmp/archive with spaces.tar.gz', buildImage: () => { builds++; return 'terminay-systemd-test:0123456789abcdef0123'; }, spawnChild: (command, args) => {
		calls.push({ command, args });
		const child = new EventEmitter();
		queueMicrotask(() => child.emit('close', 0));
		return child;
	}, removeContainer: name => removed.push(name) });
	assert.equal(builds, 1);
	assert.equal(calls.length, 3);
	assert.deepEqual(calls.map(call => call.args[4]), ['A', 'B', 'C']);
	assert.ok(calls.every(call => call.args[2] === '/tmp/archive with spaces.tar.gz'));
	assert.equal(new Set(calls.map(call => call.args.at(-1))).size, 3);
	assert.equal(removed.length, 3);
});

test('a failed scenario stops siblings, removes every container and fails the run', async () => {
	const { runSystemdScenarios } = await import('./standalone-systemd-restart.mjs');
	const { EventEmitter } = await import('node:events');
	const children = [], stopped = [], removed = [];
	await assert.rejects(runSystemdScenarios({ archive: '/tmp/archive.tar.gz', buildImage: () => 'terminay-systemd-test:0123456789abcdef0123', spawnChild: () => {
		const child = new EventEmitter(); children.push(child);
		if (children.length === 1) queueMicrotask(() => child.emit('close', 1));
		return child;
	}, stopChild: child => { stopped.push(child); queueMicrotask(() => child.emit('close', null, 'SIGKILL')); }, removeContainer: name => removed.push(name) }), /scenario A exited with 1/u);
	assert.equal(stopped.length, 2);
	assert.equal(removed.length, 3);
});
