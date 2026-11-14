#!/usr/bin/env node
// Independent preparation: the Docker fixture never reads npm's mutable tree.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSystemdImage } from './standalone-systemd-restart.mjs';

export async function prepareSystemdCi({ commands, timeoutMs = 420000, graceMs = 1000 } = {}) {
	const stage = mkdtempSync(join(tmpdir(), 'terminay-systemd-preparation-'));
	const active = new Set();
	const groups = new Set();
	const started = Date.now();
	let failure;
	let escalation;
	const kill = (signal) => {
		for (const pid of groups) {
			try { process.kill(-pid, signal); } catch { /* already gone */ }
		}
	};
	const fail = (error) => {
		failure ??= error;
		kill('SIGTERM');
		escalation ??= setTimeout(() => kill('SIGKILL'), graceMs);
	};
	const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
	const handlers = signals.map(signal => {
		const handler = () => fail(new Error(`Systemd preparation interrupted by ${signal}`));
		process.on(signal, handler);
		return handler;
	});
	const deadline = setTimeout(() => fail(new Error(`Systemd preparation exceeded ${timeoutMs}ms`)), timeoutMs);
	try {
		const tasks = commands ?? [
			{ name: 'systemd fixture image', command: process.execPath, args: [new URL(import.meta.url).pathname, '--image'] },
			{ name: 'dependencies and CLI', command: process.execPath, args: [new URL(import.meta.url).pathname, '--dependencies'] },
		];
		await Promise.all(tasks.map(task => new Promise(done => {
			const child = spawn(task.command, task.args, { detached: true, stdio: 'inherit', env: { ...process.env, TMPDIR: stage } });
			active.add(child);
			if (child.pid) groups.add(child.pid);
			child.once('error', error => fail(error));
			child.once('close', (code, signal) => {
				active.delete(child);
				console.log(`Systemd preparation ${task.name}: ${Date.now() - started}ms (${signal ?? code})`);
				if (code !== 0) fail(new Error(`${task.name} exited with ${code ?? signal}`));
				done();
			});
		})));
		if (failure) {
			// A shell can exit before a descendant that ignores SIGTERM. End all
			// original groups before resolving, even if their leaders have closed.
			kill('SIGKILL');
			throw failure;
		}
	} finally {
		clearTimeout(deadline);
		clearTimeout(escalation);
		signals.forEach((signal, index) => { process.removeListener(signal, handlers[index]); });
		for (const child of active) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }
		rmSync(stage, { recursive: true, force: true });
	}
}

function dependencies() {
	for (const [command, args, timeout] of [
		['sh', ['scripts/install-ci-dependencies.sh'], 250000],
		['npm', ['run', 'build', '--workspace', 'apps/terminay-cli'], 120000],
	]) {
		const result = spawnSync(command, args, { stdio: 'inherit', timeout });
		if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} exited with ${result.status ?? result.signal}`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		if (process.argv[2] === '--image') buildSystemdImage();
		else if (process.argv[2] === '--dependencies') dependencies();
		else await prepareSystemdCi();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
