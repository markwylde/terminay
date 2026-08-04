import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(
	'src/workspace/terminalTransferOrchestration.ts',
	'utf8',
);
const { code } = await transform(source, {
	format: 'esm',
	loader: 'ts',
	target: 'es2022',
});
const orchestration = await import(
	`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

function createPanel({
	id,
	projectId,
	sessionId,
	title,
}) {
	let closeCount = 0;
	const panel = {
		api: {
			close() {
				closeCount += 1;
			},
		},
		id,
		params: {
			color: '#123456',
			emoji: '>',
			sessionId,
			terminalClientIdentity: projectId ? { projectId } : undefined,
			terminalNote: 'Retained note',
		},
		title,
	};
	return { panel, getCloseCount: () => closeCount };
}

test('a terminal export snapshots server ownership before closing its panel', () => {
	const first = createPanel({
		id: 'panel-1',
		projectId: 'server-project',
		sessionId: 'session-1',
		title: 'Shell',
	});
	const movingSessionIds = new Set();
	const result = orchestration.exportTerminalPresentationForMove({
		api: {
			getPanel: (panelId) => (panelId === 'panel-1' ? first.panel : undefined),
		},
		context: {
			defaultServerProjectId: 'fallback-project',
			runningMacroRunsBySession: { 'session-1': [{ id: 'run-1' }] },
		},
		movingSessionIds,
		panelId: 'panel-1',
	});

	assert.equal(result.sessionId, 'session-1');
	assert.equal(result.serverProjectId, 'server-project');
	assert.deepEqual(result.macroRuns, [{ id: 'run-1' }]);
	assert.deepEqual([...movingSessionIds], ['session-1']);
	assert.equal(first.getCloseCount(), 1);
});

test('project export retains every terminal and does not close presentations', () => {
	const first = createPanel({
		id: 'panel-1',
		projectId: undefined,
		sessionId: 'session-1',
		title: 'One',
	});
	const second = createPanel({
		id: 'panel-2',
		projectId: 'owner-2',
		sessionId: 'session-2',
		title: 'Two',
	});
	const movingSessionIds = new Set();
	const result = orchestration.exportProjectPresentationsForMove({
		api: {
			activePanel: second.panel,
			panels: [first.panel, second.panel],
		},
		context: {
			defaultServerProjectId: 'fallback-project',
			runningMacroRunsBySession: {},
		},
		movingSessionIds,
	});

	assert.equal(result.activeSessionId, 'session-2');
	assert.deepEqual(
		result.terminals.map(({ serverProjectId, sessionId }) => ({
			serverProjectId,
			sessionId,
		})),
		[
			{ serverProjectId: 'fallback-project', sessionId: 'session-1' },
			{ serverProjectId: 'owner-2', sessionId: 'session-2' },
		],
	);
	assert.deepEqual([...movingSessionIds], ['session-1', 'session-2']);
	assert.equal(first.getCloseCount(), 0);
	assert.equal(second.getCloseCount(), 0);
});

test('non-terminal and missing panels cannot enter move bookkeeping', () => {
	const movingSessionIds = new Set();
	const nonTerminal = createPanel({
		id: 'file-panel',
		projectId: undefined,
		sessionId: undefined,
		title: 'README.md',
	});
	const result = orchestration.exportTerminalPresentationForMove({
		api: { getPanel: () => nonTerminal.panel },
		context: { runningMacroRunsBySession: {} },
		movingSessionIds,
		panelId: 'file-panel',
	});

	assert.equal(result, null);
	assert.equal(movingSessionIds.size, 0);
	assert.equal(nonTerminal.getCloseCount(), 0);
});

test('server terminal adoption preserves explicit titles and numbers fallbacks', () => {
	assert.equal(
		orchestration.getServerTerminalPresentationTitle('  Build logs  ', 2),
		'Build logs',
	);
	assert.equal(
		orchestration.getServerTerminalPresentationTitle(undefined, 1),
		'Terminal 1',
	);
	assert.equal(
		orchestration.getServerTerminalPresentationTitle('', 2),
		'Terminal 2',
	);
});
