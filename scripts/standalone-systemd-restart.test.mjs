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
	assert.match(body, /needs: linux-artifacts/u);
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
	let prepared = 0, closed = 0;
	await runSystemdScenarios({ prepareArchive: () => { prepared++; return { archivePath: '/tmp/prepared.tar.gz', provenancePath: '/tmp/provenance.json', close: () => { closed++; } }; }, archive: '/tmp/archive with spaces.tar.gz', buildImage: () => { builds++; return 'terminay-systemd-test:0123456789abcdef0123'; }, spawnChild: (command, args) => {
		calls.push({ command, args });
		const child = new EventEmitter();
		queueMicrotask(() => child.emit('close', 0));
		return child;
	}, removeContainer: name => removed.push(name) });
	assert.equal(builds, 1);
	assert.equal(prepared, 1);
	assert.equal(closed, 1);
	assert.ok(calls.every(call => call.args.includes('/tmp/prepared.tar.gz') && call.args.includes('/tmp/provenance.json')));
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
	let cleaned = false;
	await assert.rejects(runSystemdScenarios({ prepareArchive: () => ({ archivePath: '/tmp/prepared.tar.gz', provenancePath: '/tmp/provenance.json', close: () => { cleaned = true; } }), archive: '/tmp/archive.tar.gz', buildImage: () => 'terminay-systemd-test:0123456789abcdef0123', spawnChild: () => {
		const child = new EventEmitter(); children.push(child);
		if (children.length === 1) queueMicrotask(() => child.emit('close', 1));
		return child;
	}, stopChild: child => { stopped.push(child); queueMicrotask(() => child.emit('close', null, 'SIGKILL')); }, removeContainer: name => removed.push(name) }), /scenario A exited with 1/u);
	assert.equal(cleaned, true);
	assert.equal(stopped.length, 2);
	assert.equal(removed.length, 3);
});

test('shared source preparation preserves every payload byte and mode and binds original provenance', async () => {
	const { prepareSystemdSourceArchive, verifyPreparedSystemdSourceArchive } = await import('./systemd-source-archive.mjs');
	const { mkdir, mkdtemp, writeFile, rm, readFile: readText } = await import('node:fs/promises');
	const { existsSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');
	const { join, dirname } = await import('node:path');
	const { execFileSync } = await import('node:child_process');
	const { describeArtifactFiles, normalizeArtifactModes, createDeterministicTarGz } = await import('./artifact-determinism.mjs');
	const root = await mkdtemp(join(tmpdir(), 'terminay-source-archive-test-'));
	let prepared;
	try {
		const name = 'terminay-server-node24.15.0-linux-x64';
		const payload = join(root, name);
		for (const path of ['bin', 'cli', 'node_modules/node-pty/build/Release']) await mkdir(join(payload, path), { recursive: true });
		const elf = Buffer.alloc(64); elf.writeUInt32BE(0x7f454c46); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(62, 18);
		await writeFile(join(payload, 'bin/node'), elf);
		await writeFile(join(payload, 'node_modules/node-pty/build/Release/pty.node'), elf);
		await writeFile(join(payload, 'bin/terminay-server'), '#!/bin/sh\n');
		await writeFile(join(payload, 'bin/terminay'), '#!/bin/sh\n');
		await writeFile(join(payload, 'cli/terminay.mjs'), 'export const cli = true;');
		await normalizeArtifactModes(payload, new Set(['bin/node', 'bin/terminay-server', 'bin/terminay'].map(path => join(payload, path))));
		const files = await describeArtifactFiles(payload);
		const manifest = { schemaVersion: 1, artifact: 'terminay-server', target: 'linux-x64', architecture: 'x64', channel: 'main', revision: 'a'.repeat(40), node: { version: '24.15.0' }, nodePty: { nativePath: 'node_modules/node-pty/build/Release/pty.node' }, entrypoints: { server: 'bin/terminay-server', cli: 'bin/terminay' }, files };
		await writeFile(join(payload, 'artifact-manifest.json'), `${JSON.stringify(manifest)}\n`);
		await normalizeArtifactModes(payload, new Set(['bin/node', 'bin/terminay-server', 'bin/terminay'].map(path => join(payload, path))));
		const original = await createDeterministicTarGz({ archivePath: join(root, 'original.tar.gz'), rootName: name, stagingDirectory: root });
		prepared = await prepareSystemdSourceArchive(original);
		const provenance = verifyPreparedSystemdSourceArchive(original, prepared.archivePath, prepared.provenancePath);
		assert.equal(provenance.revision, manifest.revision);
		assert.equal(JSON.parse(execFileSync('tar', ['--occurrence=1', '-xOzf', original, `${name}/artifact-manifest.json`], { encoding: 'utf8', timeout: 5000 })).channel, 'main', 'preparation never changes the input archive');
		const extracted = join(root, 'extracted'); await mkdir(extracted);
		execFileSync('tar', ['--same-permissions', '-xzf', prepared.archivePath, '-C', extracted], { timeout: 5000 });
		assert.deepEqual((await describeArtifactFiles(join(extracted, name))).filter(file => file.path !== 'artifact-manifest.json'), files);
		assert.deepEqual(JSON.parse(await readText(join(extracted, name, 'artifact-manifest.json'), 'utf8')), { ...manifest, channel: 'source' });
		await writeFile(join(root, 'wrong-original.tar.gz'), 'different input');
		assert.throws(() => verifyPreparedSystemdSourceArchive(join(root, 'wrong-original.tar.gz'), prepared.archivePath, prepared.provenancePath), /digest mismatch/u);
		await writeFile(prepared.provenancePath, JSON.stringify({ ...provenance, revision: 'b'.repeat(40) }));
		assert.throws(() => verifyPreparedSystemdSourceArchive(original, prepared.archivePath, prepared.provenancePath), /provenance mismatch/u);
		await writeFile(prepared.archivePath, 'changed prepared bytes');
		assert.throws(() => verifyPreparedSystemdSourceArchive(original, prepared.archivePath, prepared.provenancePath), /digest mismatch/u);
		const parent = dirname(prepared.archivePath); prepared.close(); prepared = undefined;
		assert.equal(existsSync(parent), false);
	} finally { prepared?.close(); await rm(root, { recursive: true, force: true }); }
});

test('shared preparation rejects archive links before host extraction', async () => {
	const { prepareSystemdSourceArchive } = await import('./systemd-source-archive.mjs');
	const { mkdir, mkdtemp, symlink, writeFile, readFile: readText, rm } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const { execFileSync } = await import('node:child_process');
	const root = await mkdtemp(join(tmpdir(), 'terminay-systemd-unsafe-archive-'));
	try {
		const name = 'terminay-server-node24.15.0-linux-x64';
		await mkdir(join(root, name));
		await writeFile(join(root, 'outside'), 'preserved');
		await symlink(join(root, 'outside'), join(root, name, 'link'));
		const archive = join(root, 'linked.tar.gz');
		execFileSync('tar', ['-czf', archive, '-C', root, name], { timeout: 5000 });
		await assert.rejects(prepareSystemdSourceArchive(archive), /link, special file or special permission/u);
		assert.equal(await readText(join(root, 'outside'), 'utf8'), 'preserved');
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('container prepared-source validation reads manifests larger than one MiB', async () => {
	const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
	const { readFileSync } = await import('node:fs');
	const { execFileSync } = await import('node:child_process');
	const { createHash } = await import('node:crypto');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const directory = await mkdtemp(join(tmpdir(), 'terminay-systemd-large-manifest-'));
	try {
		const root = 'terminay-server-node24.15.0-linux-x64';
		await mkdir(join(directory, root));
		await writeFile(join(directory, root, 'artifact-manifest.json'), JSON.stringify({ channel: 'source', revision: 'revision', target: 'linux-x64', files: { large: 'x'.repeat(2 * 1024 * 1024) } }));
		const archive = join(directory, 'source.tar.gz');
		execFileSync('tar', ['-czf', archive, '-C', directory, root], { timeout: 5000 });
		const driver = await readFile(new URL('standalone-systemd-restart/driver.mjs', import.meta.url), 'utf8');
		const source = driver.slice(driver.indexOf('function preparedSourceArchive('), driver.indexOf('\nconst ARCHIVE ='));
		const validate = new Function('assert', 'createHash', 'readFileSync', 'execFileSync', 'process', `${source}; return preparedSourceArchive;`)(assert, createHash, readFileSync, execFileSync, { env: {
			TERMINAY_SYSTEMD_PREPARED_SHA256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
			TERMINAY_SYSTEMD_PREPARED_ROOT: root,
			TERMINAY_SYSTEMD_PREPARED_REVISION: 'revision',
			TERMINAY_SYSTEMD_PREPARED_TARGET: 'linux-x64',
		} });
		assert.equal(validate(archive), archive);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
