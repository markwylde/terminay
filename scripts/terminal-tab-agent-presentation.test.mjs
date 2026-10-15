import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const { visibleTerminalTabAgentState } = await importPresentation();

test('acknowledged done and attention glyphs are hidden; working stays', () => {
	assert.equal(visibleTerminalTabAgentState('done', false), undefined);
	assert.equal(visibleTerminalTabAgentState('waiting', false), undefined);
	assert.equal(visibleTerminalTabAgentState('blocked', false), undefined);
	assert.equal(visibleTerminalTabAgentState('working', false), 'working');
	assert.equal(visibleTerminalTabAgentState('working', true), 'working');
});

test('unacknowledged done and attention glyphs remain', () => {
	assert.equal(visibleTerminalTabAgentState('done', true), 'done');
	assert.equal(visibleTerminalTabAgentState('waiting', true), 'waiting');
	assert.equal(visibleTerminalTabAgentState('blocked', true), 'blocked');
});

test('agent glyphs follow the tab indicator settings', () => {
	const active = { showActiveTabActivityIndicator: true };
	// Active-tab indicators are opt-in, for an agent as for a shell.
	assert.equal(visibleTerminalTabAgentState('working', false, {}), undefined);
	assert.equal(visibleTerminalTabAgentState('working', false, active), 'working');
	assert.equal(
		visibleTerminalTabAgentState('done', true, {
			showFinishedTabActivityIndicator: false,
		}),
		undefined,
	);
	assert.equal(visibleTerminalTabAgentState('done', true, {}), 'done');
	assert.equal(visibleTerminalTabAgentState('waiting', true, {}), 'waiting');
	for (const state of ['working', 'waiting', 'blocked', 'done'])
		assert.equal(
			visibleTerminalTabAgentState(state, true, {
				...active,
				activityIndicatorsEnabled: false,
			}),
			undefined,
		);
});

async function importPresentation() {
	const tempDir = await mkdtemp(
		join(tmpdir(), 'terminay-tab-agent-presentation-'),
	);
	const outputPath = join(tempDir, 'presentation.mjs');
	await build({
		bundle: true,
		entryPoints: [
			new URL(
				'../src/components/terminalTabAgentPresentation.ts',
				import.meta.url,
			).pathname,
		],
		format: 'esm',
		outfile: outputPath,
		platform: 'neutral',
		target: 'es2022',
	});
	return import(outputPath);
}
