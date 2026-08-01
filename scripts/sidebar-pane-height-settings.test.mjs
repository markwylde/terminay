import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('sidebar pane heights are configurable and committed for every pane', async () => {
	const [types, settings, projectModel, app] = await Promise.all([
		readFile('src/types/settings.ts', 'utf8'),
		readFile('src/terminalSettings.ts', 'utf8'),
		readFile('src/workspace/projectTabModel.ts', 'utf8'),
		readFile('src/App.tsx', 'utf8'),
	]);

	for (const key of [
		'defaultExplorerPaneHeight',
		'defaultAgentsPaneHeight',
		'defaultGitPaneHeight',
	]) {
		assert.match(types, new RegExp(`${key}: number;`, 'u'));
		assert.match(settings, new RegExp(`${key}: clampNumber`, 'u'));
		assert.match(settings, new RegExp(`key: 'sidebar\\\\.${key}'`, 'u'));
	}

	assert.match(
		projectModel,
		/sidebarExplorerHeight: sidebarDefaults\.defaultExplorerPaneHeight/u,
	);
	assert.match(
		projectModel,
		/sidebarAgentsHeight: sidebarDefaults\.defaultAgentsPaneHeight/u,
	);
	assert.match(
		projectModel,
		/sidebarGitHeight: sidebarDefaults\.defaultGitPaneHeight/u,
	);
	assert.match(
		app,
		/id === 'explorer'[\s\S]*defaultExplorerPaneHeight: height[\s\S]*id === 'agents'[\s\S]*defaultAgentsPaneHeight: height[\s\S]*defaultGitPaneHeight: height/u,
	);
});
