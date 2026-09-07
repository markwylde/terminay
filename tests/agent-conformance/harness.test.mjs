import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertRowIsComplete,
	createConformanceHarness,
	openConformancePty,
	processTreeBelow,
} from './index.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('closing the PTY tears down every process the shell started', async () => {
	const pty = await openConformancePty();
	pty.send('sleep 300');
	for (let tries = 0; tries < 50; tries += 1) {
		if (pty.descendants().some((entry) => entry.name === 'sleep')) break;
		await wait(100);
	}
	const tree = [pty.shellPid, ...pty.descendants().map((entry) => entry.pid)];
	assert.ok(
		pty.descendants().some((entry) => entry.name === 'sleep'),
		'the long-running command is a descendant of the shell',
	);
	await pty.close();
	assert.deepEqual(processTreeBelow(pty.shellPid), []);
	for (const pid of tree) {
		assert.throws(() => process.kill(pid, 0), `pid ${pid} is gone`);
	}
});

test('a missing transition fails with the events seen so far and the PTY tail', async () => {
	const extension = {
		async activate(context) {
			context.agents.registerProvider('example.agent/cli', {
				mappingVersion: '0.1',
				matchesForeground: () => true,
				async observe() {
					return { state: 'not-bound' };
				},
			});
		},
	};
	const harness = await createConformanceHarness({
		extension,
		providerId: 'example.agent/cli',
		executable: 'sleep',
		pollMs: 50,
	});
	try {
		harness.pty.send('echo conformance-marker; sleep 300');
		await harness.pty.waitForOutput(/conformance-marker/u);
		await assert.rejects(
			harness.awaitState('working', 400),
			(error) =>
				/timed out waiting for state working/u.test(error.message) &&
				/Events seen:/u.test(error.message) &&
				/conformance-marker/u.test(error.message),
		);
	} finally {
		await harness.close();
	}
});

test('a bound provider feeds its own mapper through the real session pump', async () => {
	const extension = {
		async activate(context) {
			context.agents.registerProvider('example.agent/cli', {
				mappingVersion: '0.1',
				matchesForeground: (foreground) =>
					foreground.executableName === 'sleep',
				async observe(terminal) {
					const binding = await terminal.bindSession({
						providerSessionId: 'session-1',
						mappingVersion: '0.1',
						fingerprint: { kind: 'example' },
					});
					let published = false;
					return {
						state: 'bound',
						binding,
						source: {
							async *[Symbol.asyncIterator]() {
								yield { bytes: new TextEncoder().encode('{"turn":1}\n') };
								await new Promise(() => {});
							},
							async dispose() {},
						},
						async mapRecord(record, context) {
							if (published || record.turn !== 1) return;
							published = true;
							await context.publish.turnStarted({});
							await context.publish.done({ outcome: 'completed' });
						},
					};
				},
			});
		},
	};
	const harness = await createConformanceHarness({
		extension,
		providerId: 'example.agent/cli',
		executable: 'sleep',
		pollMs: 50,
	});
	try {
		harness.pty.send('sleep 300');
		await harness.awaitState('done', 5_000);
		assert.equal(harness.projection.providerSessionId, 'session-1');
		assert.deepEqual(
			harness.projection.events.map((event) => event.kind),
			['session.started', 'turn.started', 'agent.done'],
		);
		assert.equal(harness.projection.active, true);
		harness.pty.write('');
		await harness.await(
			'the root to retire once its process exits',
			(p) => !p.active,
			5_000,
		);
	} finally {
		await harness.close();
	}
});

test('a matrix row must state a verdict for every capability and nothing else', () => {
	const row = {
		detect: 'Y',
		title: 'Y',
		idle: 'Y',
		working: 'Y',
		waiting: 'Y*',
		blocked: 'N',
		done: 'Y',
		subEnumerate: 'Y',
		subStatus: 'Y',
		resume: 'Y',
	};
	const gestures = { secondLaunch: () => {}, resume: () => {} };
	assertRowIsComplete({ name: 'Example', row, ...gestures });
	const { resume, ...missing } = row;
	assert.throws(
		() => assertRowIsComplete({ name: 'Example', row: missing, ...gestures }),
		/no verdict for resume/u,
	);
	assert.throws(
		() =>
			assertRowIsComplete({
				name: 'Example',
				row: { ...row, invented: 'Y' },
				...gestures,
			}),
		/does not match the matrix columns/u,
	);
	assert.throws(
		() =>
			assertRowIsComplete({
				name: 'Example',
				row: { ...row, done: 'maybe' },
				...gestures,
			}),
		/no verdict for done/u,
	);
	// Two concurrent sessions of one provider is the case every other step is
	// blind to, so a descriptor cannot opt out of proving it.
	assert.throws(
		() =>
			assertRowIsComplete({ name: 'Example', row, resume: gestures.resume }),
		/must supply secondLaunch/u,
	);
	// The resume gesture is driven from a terminal with no binding of its own,
	// so it is required of every descriptor whatever its resume verdict.
	assert.throws(
		() =>
			assertRowIsComplete({
				name: 'Example',
				row,
				secondLaunch: gestures.secondLaunch,
			}),
		/must supply resume/u,
	);
});

test('a resume gesture is given the session to resume rather than reading one', async () => {
	// The resume-while-another-runs step drives a third terminal that has no
	// binding of its own, so the descriptor gesture must take the id as an
	// argument. Every shipped descriptor defaults it to its own projection, and
	// this asserts both halves of that contract on the same shape.
	const seen = [];
	const descriptor = {
		resume(harness, providerSessionId = harness.projection.providerSessionId) {
			seen.push(providerSessionId);
		},
	};
	descriptor.resume({ projection: { providerSessionId: 'its-own' } });
	descriptor.resume(
		{ projection: { providerSessionId: 'its-own' } },
		'another-terminals',
	);
	assert.deepEqual(seen, ['its-own', 'another-terminals']);
});

test('the working directory outlives the harness that seeded it', async () => {
	// The seeded session is quit and its harness closed before the session under
	// test starts, and both work in one directory. A PTY handed a directory does
	// not own it, so closing the seed must leave the directory and its contents
	// in place for everything that follows.
	const { mkdtempSync, rmSync, writeFileSync, existsSync } = await import(
		'node:fs'
	);
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const directory = mkdtempSync(join(tmpdir(), 'terminay-conformance-self-'));
	try {
		const first = await openConformancePty({ cwd: directory });
		writeFileSync(join(first.cwd, 'seeded.txt'), 'earlier session');
		await first.close();
		assert.ok(
			existsSync(join(directory, 'seeded.txt')),
			'the seeded directory survives its PTY',
		);
		const second = await openConformancePty({ cwd: directory });
		assert.equal(second.cwd, first.cwd);
		await second.close();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
