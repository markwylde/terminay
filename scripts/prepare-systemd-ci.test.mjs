import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { prepareSystemdCi } from './prepare-systemd-ci.mjs';

const command = (name, source) => ({ name, command: process.execPath, args: ['--input-type=module', '-e', source] });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('fixture image and dependency preparation really overlap and clean their temporary files', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-systemd-overlap-'));
	try {
		const commands = ['image', 'dependencies'].map((name, index) => command(name, `
			import {writeFileSync,existsSync} from 'node:fs';
			writeFileSync(${JSON.stringify(join(root, name))},process.env.TMPDIR);
			const other=${JSON.stringify(join(root, index ? 'image' : 'dependencies'))};
			const interval=setInterval(()=>{if(existsSync(other)){clearInterval(interval);}},10);
		`));
		await prepareSystemdCi({ commands, timeoutMs: 3000, graceMs: 50 });
		const stage = await readFile(join(root, 'image'), 'utf8');
		assert.equal(stage, await readFile(join(root, 'dependencies'), 'utf8'));
		await assert.rejects(readFile(join(stage, 'anything')), /ENOENT/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});

for (const failingName of ['image', 'dependencies']) {
	test(`${failingName} failure stops and reaps a sibling that ignores SIGTERM`, async () => {
		const root = await mkdtemp(join(tmpdir(), 'terminay-systemd-failure-'));
		const pidFile = join(root, 'pid');
		try {
			const sibling = command('sibling', `import {writeFileSync} from 'node:fs';process.on('SIGTERM',()=>{});writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`);
			const failure = command(failingName, `import {existsSync} from 'node:fs';setInterval(()=>{if(existsSync(${JSON.stringify(pidFile)}))process.exit(7)},10);`);
			await assert.rejects(prepareSystemdCi({ commands: [sibling, failure], timeoutMs: 3000, graceMs: 50 }), new RegExp(`${failingName} exited with 7`, 'u'));
			assert.equal(alive(Number(await readFile(pidFile, 'utf8'))), false);
		} finally { await rm(root, { recursive: true, force: true }); }
	});
}

test('preparation deadline kills an unresponsive child and reports the timeout', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-systemd-timeout-'));
	const pidFile = join(root, 'pid');
	try {
		await assert.rejects(prepareSystemdCi({ commands: [command('stalled', `import {writeFileSync} from 'node:fs';process.on('SIGTERM',()=>{});writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`)], timeoutMs: 300, graceMs: 50 }), /exceeded 300ms/u);
		assert.equal(alive(Number(await readFile(pidFile, 'utf8'))), false);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('spawn failure propagates instead of reporting successful preparation', async () => {
	await assert.rejects(prepareSystemdCi({ commands: [{ name: 'missing', command: '/terminay/nonexistent-preparation-command', args: [] }], timeoutMs: 1000, graceMs: 50 }), /ENOENT/u);
});

test('SIGTERM cancels preparation and removes its temporary stage', async () => {
	const { execFileSync } = await import('node:child_process');
	const root = await mkdtemp(join(tmpdir(), 'terminay-systemd-signal-'));
	const marker = join(root, 'stage');
	try {
		const source = `
			import {prepareSystemdCi} from ${JSON.stringify(new URL('./prepare-systemd-ci.mjs', import.meta.url).href)};
			import {existsSync} from 'node:fs';
			const watcher=setInterval(()=>{if(existsSync(${JSON.stringify(marker)})){clearInterval(watcher);process.kill(process.pid,'SIGTERM')}},10);
			try {await prepareSystemdCi({commands:[${JSON.stringify(command('canceled', `import {writeFileSync} from 'node:fs';process.on('SIGTERM',()=>{});writeFileSync(${JSON.stringify(marker)},process.env.TMPDIR);setInterval(()=>{},1000);`))}],timeoutMs:3000,graceMs:50});process.exitCode=2;} catch(error) {if(!error.message.includes('interrupted by SIGTERM'))throw error;}
		`;
		execFileSync(process.execPath, ['--input-type=module', '-e', source], { timeout: 5000 });
		const stage = await readFile(marker, 'utf8');
		await assert.rejects(readFile(join(stage, 'anything')), /ENOENT/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('prune diagnostics retain every cleanup phase and report elapsed time', async () => {
	const { chmod } = await import('node:fs/promises');
	const { execFileSync } = await import('node:child_process');
	const root = await mkdtemp(join(tmpdir(), 'terminay-prune-phases-'));
	try {
		const docker = join(root, 'docker');
		const log = join(root, 'calls');
		await import('node:fs/promises').then(({ writeFile }) => writeFile(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PRUNE_TEST_LOG"\nexit 0\n'));
		await chmod(docker, 0o755);
		const output = execFileSync('sh', [new URL('./prune-ci-docker-images.sh', import.meta.url).pathname], { encoding: 'utf8', timeout: 5000, env: { ...process.env, PATH: `${root}:${process.env.PATH}`, PRUNE_TEST_LOG: log } });
		for (const phase of ['containers', 'e2e-images', 'dependency-images', 'dangling-images', 'build-cache', 'anonymous-volumes']) assert.match(output, new RegExp(`CI Docker cleanup ${phase}: \\d+s`, 'u'));
		const calls = await readFile(log, 'utf8');
		for (const call of ['container prune --force', 'image prune --force', 'builder prune --force --keep-storage 10GB', 'volume prune --force']) assert.ok(calls.includes(call), call);
	} finally { await rm(root, { recursive: true, force: true }); }
});
