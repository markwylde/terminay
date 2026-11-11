import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const args = (mirror) =>
	execFileSync('sh', ['scripts/docker-hub-build-args.sh'], {
		cwd: root,
		encoding: 'utf8',
		env: { PATH: process.env.PATH, ...(mirror === undefined ? {} : { TERMINAY_DOCKER_HUB_MIRROR: mirror }) },
	});

test('without a mirror, builds keep pulling from Docker Hub', () => {
	assert.equal(args(undefined), '');
	assert.equal(args(''), '');
});

test('a mirror replaces the library namespace and the Dockerfile frontend', () => {
	assert.deepEqual(args('git.i.wylde.net/docker').trim().split('\n'), [
		'--build-arg',
		'DOCKER_HUB=git.i.wylde.net/docker',
		'--build-arg',
		'BUILDKIT_SYNTAX=git.i.wylde.net/docker/dockerfile:1.7',
	]);
});

test('a mirror that is not a plain registry path is refused', () => {
	for (const mirror of ['git.i.wylde.net/docker --push', '$(id)'])
		assert.throws(() => args(mirror), (error) => error.status === 64, mirror);
});

test('every Docker Hub base image in a CI-built Dockerfile goes through DOCKER_HUB', async () => {
	for (const file of [
		'Dockerfile',
		'Dockerfile.e2e-base',
		'Dockerfile.mcp-cli-compat',
		'Dockerfile.linux-floor',
		'Dockerfile.linux-floor-runtime',
	]) {
		const text = await read(file);
		assert.match(text, /^ARG DOCKER_HUB=docker\.io\/library$/mu, file);
		const from = [...text.matchAll(/^FROM (\S+)/gmu)].map(([, image]) => image);
		assert.ok(from.length > 0, file);
		for (const image of from)
			assert.match(image, /^\$\{DOCKER_HUB\}\//u, `${file}: ${image}`);
		// The frontend the mirror holds is the one these files ask for.
		const syntax = /^# syntax=(\S+)$/mu.exec(text)?.[1];
		if (syntax) assert.equal(syntax, 'docker/dockerfile:1.7', file);
	}
});

test('the bot image keeps pulling from Docker Hub except in the CI runner', async () => {
	assert.match(await read('docker/terminay-bot/Dockerfile'), /^FROM docker\.io\/library\/node:/mu);
	assert.match(
		await read('scripts/run-bot-mcp-real-tests.mjs'),
		/process\.env\.TERMINAY_DOCKER_HUB_MIRROR[\s\S]*replace\(\/\^FROM docker\\\.io\\\/library\\\/\/gmu/u,
	);
});

test('every script that builds a Docker Hub based image passes the mirror arguments', async () => {
	for (const file of [
		'scripts/run-in-linux-floor.sh',
		'scripts/probe-linux-glibc-floor.sh',
		'scripts/run-mcp-cli-real-tests.sh',
	])
		assert.match(
			await read(file),
			/\$\(sh "\$repo_dir\/scripts\/docker-hub-build-args\.sh"\)/u,
			file,
		);
});
