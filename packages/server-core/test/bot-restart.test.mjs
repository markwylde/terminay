import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { processEnded } from './fixtures/process-ended.mjs';

test('5.6 kill the server mid-turn, restart: kill-all, interrupted approvals, not-sent messages, skipped firings, helper cleanup and idle arming', {
	timeout: 15000,
}, async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bots-restart-'));
	let first, second, pid;
	t.after(() => {
		first?.kill('SIGKILL');
		second?.kill('SIGKILL');
		if (pid) {
			try {
				process.kill(-pid, 'SIGKILL');
			} catch {}
		}
		rmSync(root, { recursive: true, force: true });
	});
	const file = new URL('./fixtures/bot-restart-server.mjs', import.meta.url);
	first = fork(file, [root, 'first'], {
		stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
	});
	let stderr = '';
	first.stderr.on('data', (c) => {
		stderr += c;
	});
	const [ready] = await once(first, 'message');
	assert.equal(ready.kind, 'ready', stderr);
	pid = ready.pid;
	const exited = once(first, 'exit');
	first.kill('SIGKILL');
	await exited;
	// The adapter deliberately keeps its event loop alive after exec loses stdin.
	process.kill(pid, 0);
	second = fork(file, [root, 'second'], {
		stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
	});
	second.stderr.on('data', (c) => {
		stderr += c;
	});
	const [restored] = await once(second, 'message');
	const exit = await once(second, 'exit');
	assert.equal(exit[0], 0, stderr);
	assert.ok(
		restored.calls.some(
			(c) => c[0] === 'terminay-run' && c[1] === '--kill-all',
		),
	);
	const active = restored.sessions.find((s) => s.id === ready.active);
	assert.equal(active.state, 'interrupted');
	assert.equal(active.permission, null);
	assert.equal(active.queuedMessage,null);
    assert.equal(active.open,false);
	const trigger = restored.sessions.find((s) => s.origin.kind === 'trigger');
	assert.equal(trigger.firing, 'skipped');
	assert.equal(trigger.reason, 'server restarted');
	assert.ok(restored.calls.some((c) => c[0] === 'remove-helpers'));
	assert.deepEqual(restored.activity.at(-1), [ready.botId, 0, 0]);
	assert.equal(await processEnded(pid), true);
	pid = undefined;
});
