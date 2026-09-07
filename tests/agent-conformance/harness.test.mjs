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
				matchesForeground: (foreground) => foreground.executableName === 'sleep',
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
		await harness.await('the root to retire once its process exits', (p) => !p.active, 5_000);
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
	const secondLaunch = () => {};
	assertRowIsComplete({ name: 'Example', row, secondLaunch });
	const { resume, ...missing } = row;
	assert.throws(() => assertRowIsComplete({ name: 'Example', row: missing, secondLaunch }), /no verdict for resume/u);
	assert.throws(
		() => assertRowIsComplete({ name: 'Example', row: { ...row, invented: 'Y' }, secondLaunch }),
		/does not match the matrix columns/u,
	);
	assert.throws(
		() => assertRowIsComplete({ name: 'Example', row: { ...row, done: 'maybe' }, secondLaunch }),
		/no verdict for done/u,
	);
	// Two concurrent sessions of one provider is the case every other step is
	// blind to, so a descriptor cannot opt out of proving it.
	assert.throws(
		() => assertRowIsComplete({ name: 'Example', row }),
		/must supply secondLaunch/u,
	);
});
