import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const {
	confirmLimitedTerminalClose,
	confirmTerminalClose,
	getRunningTerminalSessionIds,
	observeTerminalClosePreflight,
} = await importCloseProtection();

const session = (sessionId, projectId, foregroundBusy) => ({
	sessionId,
	projectId,
	foregroundBusy,
	foregroundObservation: 'available',
	status: foregroundBusy ? 'working' : 'idle',
	attention: false,
	acknowledged: true,
	claimed: false,
	authority: 'structured',
	source: 'structured:foreground',
	updatedAt: 1,
});

test('close protection selects only real foreground work and scopes projects', () => {
	const snapshot = {
		revision: 1,
		cursor: '1',
		sessions: {
			busyA: session('busyA', 'project-a', true),
			idleA: session('idleA', 'project-a', false),
			busyB: session('busyB', 'project-b', true),
		},
	};
	assert.deepEqual(getRunningTerminalSessionIds(snapshot), ['busyA', 'busyB']);
	assert.deepEqual(getRunningTerminalSessionIds(snapshot, 'project-a'), [
		'busyA',
	]);
});

test('presentation working state cannot create a close warning', () => {
	const snapshot = {
		revision: 1,
		cursor: '1',
		sessions: {
			outputOnly: {
				...session('outputOnly', 'project-a', false),
				status: 'working',
			},
		},
	};
	assert.deepEqual(getRunningTerminalSessionIds(snapshot), []);
});

test('destructive close uses an exact-session preflight rather than a global refresh', async () => {
	const queries = [];
	const client = {
		async closePreflight(scope) {
			queries.push(scope);
			return {
				observation: 'available',
				runningSessionIds: ['busyA'],
				sessions: [
					{
						sessionId: 'busyA',
						projectId: 'project-a',
						observation: 'available',
						foregroundBusy: true,
					},
				],
			};
		},
	};

	assert.deepEqual(
		await observeTerminalClosePreflight(client, {
			projectId: 'project-a',
			sessionId: 'busyA',
		}),
		{
			observation: 'available',
			runningSessionIds: ['busyA'],
			sessions: [
				{
					sessionId: 'busyA',
					projectId: 'project-a',
					observation: 'available',
					foregroundBusy: true,
				},
			],
		},
	);
	assert.deepEqual(queries, [{ projectId: 'project-a', sessionId: 'busyA' }]);
});

test("missing close authority is a limited observation, never proof of idle", async () => {
	const preflight = await observeTerminalClosePreflight(undefined, {
		projectId: 'project-a',
		sessionId: 'session-a',
	});
	assert.equal(preflight.observation, 'limited');
	assert.deepEqual(preflight.runningSessionIds, []);
});

test('a failed close preflight query is limited, never an invisible hang', async () => {
	const preflight = await observeTerminalClosePreflight(
		{
			store: {
				snapshot: {
					revision: 1,
					cursor: '1',
					sessions: {
						'session-a': session('session-a', 'project-a', true),
					},
				},
			},
			async closePreflight() {
				throw new Error('unknown operation activity.closePreflight');
			},
		},
		{ projectId: 'project-a', sessionId: 'session-a' },
	);
	assert.equal(preflight.observation, 'limited');
	assert.deepEqual(preflight.runningSessionIds, ['session-a']);
	assert.equal(preflight.sessions[0].foregroundBusy, true);
});

test('limited-state close confirmation names the unavailable observation', async () => {
	const messages = [];
	const originalConfirm = globalThis.window?.confirm;
	globalThis.window = {
		confirm(message) {
			messages.push(message);
			return false;
		},
	};
	try {
		assert.equal(
			await confirmLimitedTerminalClose('terminal'),
			false,
		);
		assert.equal(await confirmTerminalClose('project', {
			observation: 'limited',
			runningSessionIds: [],
			sessions: [],
		}), false);
		assert.match(messages[0], /could not confirm whether a process is still running in this terminal/u);
		assert.match(messages[1], /could not confirm whether a process is still running in this project/u);
	} finally {
		if (originalConfirm === undefined) delete globalThis.window;
		else globalThis.window.confirm = originalConfirm;
	}
});

async function importCloseProtection() {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-close-protection-'));
	const outputPath = join(directory, 'close-protection.mjs');
	try {
		await build({
			bundle: true,
			format: 'esm',
			outfile: outputPath,
			platform: 'node',
			stdin: {
				contents: `export { confirmLimitedTerminalClose, confirmTerminalClose, getRunningTerminalSessionIds, observeTerminalClosePreflight } from ${JSON.stringify(new URL('../src/workspace/closeProtection.ts', import.meta.url).pathname)}`,
				loader: 'ts',
				resolveDir: process.cwd(),
			},
			target: 'node24',
		});
		return await import(outputPath);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
