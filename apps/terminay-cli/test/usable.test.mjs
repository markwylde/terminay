import assert from 'node:assert/strict';
import test from 'node:test';

import { SocketError, SocketLaunchError } from '../dist/socket.js';
import { describeFailures, verifyUsable } from '../dist/usable.js';

const record = { healthPort: 8444, runAs: 'terminay' };
const healthy = async () => ({ status: 'ok', ready: true, version: '6.9.0' });
const clock = () => {
	let t = 0;
	return { now: () => t, sleep: async (ms) => { t += ms; } };
};

function sender(answers) {
	const asked = [];
	return {
		asked,
		send: async (request) => {
			asked.push(request.op);
			const answer = answers[request.op];
			const next = Array.isArray(answer) ? answer.shift() : answer;
			if (next instanceof Error) throw next;
			return next;
		},
	};
}

test('a usable server passes health, socket, and terminal', async () => {
	const { send, asked } = sender({
		status: { ok: true, status: { ready: true } },
		'probe-terminal': { ok: true, terminal: { ok: true, shell: '/bin/bash' } },
	});
	const report = await verifyUsable(record, { send, waitForHealth: healthy, ...clock() });
	assert.equal(report.usable, true);
	assert.deepEqual(report.checks.map((c) => [c.name, c.ok]), [['health', true], ['socket', true], ['terminal', true]]);
	assert.deepEqual(asked, ['status', 'probe-terminal']);
});

test('health ready but every terminal exits is not ready, and says why', async () => {
	const { send } = sender({
		status: { ok: true, status: { ready: true } },
		'probe-terminal': {
			ok: true,
			terminal: { ok: false, shell: '/usr/sbin/nologin', reason: 'exit', exitCode: 1, output: 'This account is currently not available.' },
		},
	});
	const report = await verifyUsable(record, { send, waitForHealth: healthy, ...clock() });
	assert.equal(report.usable, false);
	const lines = describeFailures(report).join('\n');
	assert.match(lines, /terminal\s+\/usr\/sbin\/nologin exited with status 1: This account is currently not available\./u);
	assert.match(lines, /fix: give terminay a login shell: sudo usermod -s \/bin\/bash terminay/u);
});

test('the socket is retried while it starts, then reported by name', async () => {
	const starting = sender({
		status: [new SocketError('no running server accepts commands at this data root.'), { ok: true, status: { ready: true } }],
		'probe-terminal': { ok: true, terminal: { ok: true } },
	});
	assert.equal((await verifyUsable(record, { send: starting.send, waitForHealth: healthy, ...clock() })).usable, true);

	const never = sender({ status: new SocketError('no running server accepts commands at this data root.') });
	const report = await verifyUsable(record, { send: never.send, waitForHealth: healthy, timeoutMs: 2_000, ...clock() });
	assert.equal(report.usable, false);
	assert.deepEqual(report.checks.map((c) => [c.name, c.ok, c.skipped === true]), [
		['health', true, false],
		['socket', false, false],
		['terminal', false, true],
	]);
});

test('a launch failure on this side is not retried and is marked local', async () => {
	const { send, asked } = sender({ status: new SocketLaunchError('the service account cannot run Node.js at /root/.nvm/bin/node.') });
	const report = await verifyUsable(record, { send, waitForHealth: healthy, ...clock() });
	assert.equal(asked.length, 1);
	assert.equal(report.checks[1].local, true);
	assert.match(describeFailures(report).join('\n'), /cannot run Node\.js/u);
});

test('unready health skips the other checks', async () => {
	const { send, asked } = sender({});
	const report = await verifyUsable(record, { send, waitForHealth: async () => undefined, ...clock() });
	assert.equal(report.usable, false);
	assert.deepEqual(asked, []);
	assert.match(describeFailures(report).join('\n'), /health endpoint on 127\.0\.0\.1:8444 did not report ready/u);
});

test('a server too old to probe terminals is not failed for it', async () => {
	const { send } = sender({
		status: { ok: true, status: { ready: true } },
		'probe-terminal': { ok: false, error: 'approval request is invalid' },
	});
	const report = await verifyUsable(record, { send, waitForHealth: healthy, ...clock() });
	assert.equal(report.usable, true);
	assert.equal(report.checks[2].skipped, true);
});
