import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(
	'src/workspace/terminalDockviewCommands.ts',
	'utf8',
);
const { code } = await transform(source, {
	format: 'esm',
	loader: 'ts',
	target: 'es2022',
});
const commands = await import(
	`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

function panel(id, sessionId) {
	let active = 0;
	let closed = 0;
	return {
		id,
		params: sessionId ? { sessionId } : {},
		api: {
			close: () => {
				closed += 1;
			},
			setActive: () => {
				active += 1;
			},
		},
		counts: () => ({ active, closed }),
	};
}

test('focus target selection preserves an active non-terminal panel', () => {
	const terminal = panel('terminal', 'session-1');
	const file = panel('file');
	const api = {
		activePanel: file,
		getPanel: (id) => (id === terminal.id ? terminal : file),
		groups: [{ activePanel: terminal, panels: [terminal] }],
	};
	assert.equal(
		commands.findTerminalFocusTarget({
			api,
			focusedSessionId: 'session-1',
			panelSessions: new Map([['terminal', 'session-1']]),
		}),
		null,
	);
});

test('activation requires an exact panel and immutable session match', () => {
	const terminal = panel('terminal', 'session-1');
	const api = { getPanel: () => terminal };
	assert.equal(
		commands.activateTerminalPanel({
			api,
			panelId: 'terminal',
			sessionId: 'wrong-session',
		}),
		null,
	);
	assert.deepEqual(terminal.counts(), { active: 0, closed: 0 });
	assert.equal(
		commands.activateTerminalPanel({
			api,
			panelId: 'terminal',
			sessionId: 'session-1',
		}),
		terminal,
	);
	assert.deepEqual(terminal.counts(), { active: 1, closed: 0 });
});

test('closing the final panel delegates to project ownership', () => {
	const terminal = panel('terminal', 'session-1');
	let closeProjectCount = 0;
	commands.closeActiveDockviewPanel({
		api: { activePanel: terminal, panels: [terminal] },
		onCloseLastPanel: () => {
			closeProjectCount += 1;
		},
	});
	assert.equal(closeProjectCount, 1);
	assert.deepEqual(terminal.counts(), { active: 0, closed: 0 });
});

test('active panel save reports errors and refreshes only after success', async () => {
	let refreshCount = 0;
	const errors = [];
	await commands.saveActiveDockviewPanel({
		api: { activePanel: { params: { onSave: async () => true } } },
		onError: (message) => errors.push(message),
		onSaved: () => {
			refreshCount += 1;
		},
	});
	assert.equal(refreshCount, 1);
	assert.deepEqual(errors, []);

	await commands.saveActiveDockviewPanel({
		api: {
			activePanel: {
				params: {
					onSave: async () => {
						throw new Error('save failed');
					},
				},
			},
		},
		onError: (message) => errors.push(message),
		onSaved: () => {
			refreshCount += 1;
		},
	});
	assert.deepEqual(errors, ['save failed']);
	assert.equal(refreshCount, 1);
});
