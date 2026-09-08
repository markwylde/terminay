import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
	assertRootForSystemScope,
	DEDICATED_ACCOUNT,
	prepareDataRoot,
	ScopeError,
	selectRunAs,
	selectScope,
} from '../dist/account.js';
import { createFakeBin } from './fake-bin.mjs';

/** A stdin the prompt believes is a terminal, scripted with answers. */
function terminal(...answers) {
	const input = new PassThrough();
	input.isTTY = true;
	const written = [];
	const output = new PassThrough();
	output.on('data', (chunk) => written.push(chunk.toString()));
	queueMicrotask(() => {
		for (const answer of answers) input.write(`${answer}\n`);
	});
	return { streams: { input, output }, written };
}

function pipe() {
	const input = new PassThrough();
	input.isTTY = false;
	return { streams: { input, output: new PassThrough() } };
}

test('a terminal is asked for the scope, with system preselected', async () => {
	const { streams, written } = terminal('');
	assert.equal(await selectScope({ streams }), 'system');
	const prompt = written.join('');
	assert.match(prompt, /System-wide service/u);
	assert.match(prompt, /\[default\]/u);
	assert.ok(
		prompt.indexOf('System-wide') < prompt.indexOf('User service'),
		'system must be offered first',
	);
});

test('a terminal can choose the user scope by number or by name', async () => {
	assert.equal(await selectScope({ streams: terminal('2').streams }), 'user');
	assert.equal(
		await selectScope({ streams: terminal('user').streams }),
		'user',
	);
});

test('a flag skips the prompt entirely', async () => {
	assert.equal(
		await selectScope({ requested: 'user', streams: terminal().streams }),
		'user',
	);
	assert.equal(
		await selectScope({ requested: 'system', streams: pipe().streams }),
		'system',
	);
});

test('without a terminal the scope must be given as a flag', async () => {
	await assert.rejects(
		() => selectScope({ streams: pipe().streams }),
		(error) =>
			error instanceof ScopeError &&
			/--system/u.test(error.message) &&
			/--user/u.test(error.message),
	);
});

test('a system install by a non-root user is refused and told how to re-run', () => {
	assert.doesNotThrow(() =>
		assertRootForSystemScope('terminay daemon install', 0),
	);
	assert.throws(
		() => assertRootForSystemScope('terminay daemon install', 1000),
		(error) =>
			error instanceof ScopeError &&
			/sudo terminay daemon install/u.test(error.message),
	);
});

test('the dedicated account is preselected and created when it is absent', async () => {
	const fake = await createFakeBin();
	// `id -u terminay` fails, so the account does not exist yet.
	fake.install('id', 'exit 1');
	fake.install('useradd', '');
	fake.install('getent', '');
	const originalPath = process.env.PATH;
	process.env.PATH = `${fake.directory}:${originalPath}`;
	try {
		const { streams, written } = terminal('');
		const selection = await selectRunAs({ scope: 'system', streams });
		assert.equal(selection.runAs, DEDICATED_ACCOUNT);
		assert.equal(selection.home, '/var/lib/terminay');
		assert.match(
			written.join(''),
			/whose files, keys, and agents a paired device can reach/u,
		);
		assert.ok(
			fake
				.invocations()
				.some((line) =>
					line.startsWith('useradd --system --home-dir /var/lib/terminay'),
				),
			'expected the dedicated system account to be created',
		);
	} finally {
		process.env.PATH = originalPath;
		await fake.close();
	}
});

test('an existing dedicated account is reused rather than recreated', async () => {
	const fake = await createFakeBin();
	fake.install('id', '');
	fake.install('useradd', 'exit 9');
	const originalPath = process.env.PATH;
	process.env.PATH = `${fake.directory}:${originalPath}`;
	try {
		const selection = await selectRunAs({
			scope: 'system',
			streams: terminal('').streams,
		});
		assert.equal(selection.runAs, DEDICATED_ACCOUNT);
		assert.ok(
			!fake.invocations().some((line) => line.startsWith('useradd')),
			'useradd must not run for an existing account',
		);
	} finally {
		process.env.PATH = originalPath;
		await fake.close();
	}
});

test('--run-as names an existing login user and takes its home as the project root', async () => {
	const fake = await createFakeBin();
	fake.install('id', '');
	fake.install('getent', 'echo "ada:x:1000:1000:Ada:/home/ada:/bin/bash"');
	const originalPath = process.env.PATH;
	process.env.PATH = `${fake.directory}:${originalPath}`;
	try {
		const selection = await selectRunAs({ scope: 'system', requested: 'ada' });
		assert.equal(selection.runAs, 'ada');
		assert.equal(selection.home, '/home/ada');
	} finally {
		process.env.PATH = originalPath;
		await fake.close();
	}
});

test('--run-as naming an account that does not exist fails before anything is written', async () => {
	const fake = await createFakeBin();
	fake.install('id', 'exit 1');
	fake.install('useradd', 'exit 9');
	const originalPath = process.env.PATH;
	process.env.PATH = `${fake.directory}:${originalPath}`;
	try {
		await assert.rejects(
			() => selectRunAs({ scope: 'system', requested: 'nobody-here' }),
			(error) =>
				error instanceof ScopeError && /does not exist/u.test(error.message),
		);
		assert.ok(
			!fake.invocations().some((line) => line.startsWith('useradd')),
			'nothing may be created for an unknown user',
		);
	} finally {
		process.env.PATH = originalPath;
		await fake.close();
	}
});

test('an invalid account name is refused without shelling out', async () => {
	await assert.rejects(
		() => selectRunAs({ scope: 'system', requested: 'Ada Lovelace; rm -rf /' }),
		(error) =>
			error instanceof ScopeError &&
			/not a valid account name/u.test(error.message),
	);
});

test('a user-scope install always runs as the invoking account', async () => {
	const fake = await createFakeBin();
	fake.install('getent', 'echo "ada:x:1000:1000:Ada:/home/ada:/bin/bash"');
	const originalPath = process.env.PATH;
	process.env.PATH = `${fake.directory}:${originalPath}`;
	try {
		const selection = await selectRunAs({ scope: 'user', currentUser: 'ada' });
		assert.equal(selection.runAs, 'ada');
		await assert.rejects(
			() =>
				selectRunAs({ scope: 'user', currentUser: 'ada', requested: 'root' }),
			(error) =>
				error instanceof ScopeError &&
				/--run-as cannot be used with a user-scope install/u.test(
					error.message,
				),
		);
	} finally {
		process.env.PATH = originalPath;
		await fake.close();
	}
});

test('the data root is created owner-only', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-dataroot-'));
	try {
		const dataRoot = join(directory, 'data');
		await prepareDataRoot(dataRoot, 'ada', 'user');
		assert.equal((await stat(dataRoot)).mode & 0o777, 0o700);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('a system-scope data root is handed to the run-as account', async () => {
	const fake = await createFakeBin();
	fake.install('chown', '');
	const directory = await mkdtemp(join(tmpdir(), 'terminay-dataroot-'));
	const originalPath = process.env.PATH;
	process.env.PATH = `${fake.directory}:${originalPath}`;
	try {
		const dataRoot = join(directory, 'data');
		await prepareDataRoot(dataRoot, 'terminay', 'system');
		assert.equal((await stat(dataRoot)).mode & 0o777, 0o700);
		assert.deepEqual(fake.invocations(), [
			`chown -R terminay:terminay ${dataRoot}`,
		]);
	} finally {
		process.env.PATH = originalPath;
		await rm(directory, { recursive: true, force: true });
		await fake.close();
	}
});
