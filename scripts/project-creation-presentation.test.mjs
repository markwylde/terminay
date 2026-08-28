import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const projectTabs = await readFile(
	new URL('../src/workspace/ProjectTabList.tsx', import.meta.url),
	'utf8',
);
const projectCollection = await readFile(
	new URL('../src/workspace/useProjectCollection.ts', import.meta.url),
	'utf8',
);
const styles = await readFile(
	new URL('../src/App.css', import.meta.url),
	'utf8',
);
const terminalPanel = await readFile(
	new URL('../src/components/TerminalPanel.tsx', import.meta.url),
	'utf8',
);
const terminalTab = await readFile(
	new URL('../src/components/TerminalTab.tsx', import.meta.url),
	'utf8',
);
const controller = await readFile(
	new URL('../src/workspace/useFileExplorerController.ts', import.meta.url),
	'utf8',
);

test('project creation stays in a background pending tab until its terminal is ready', () => {
	assert.match(app, /creationStatus: 'loading'/u);
	assert.match(
		app,
		/heldActiveProjectIdRef\.current = initialActiveProjectId/u,
	);
	assert.match(app, /createInitialTerminalForProject/u);
	assert.match(app, /desiredProjectId === initialActiveProjectId/u);
	assert.match(app, /setActiveProjectId\(operation\.projectId\)/u);
	assert.match(app, /else if \(desiredProjectId !== null\)/u);
	assert.doesNotMatch(app, /Validating This server/u);
	assert.match(projectCollection, /heldActiveProjectId/u);
});

test('pending project tabs use a spinner and failures activate their error surface', () => {
	assert.match(projectTabs, /project-tab-creation-spinner/u);
	assert.match(projectTabs, /projectTabIsBusy\(project\)/u);
	assert.match(projectTabs, /project\.creationStatus !== 'loading'/u);
	assert.match(projectTabs, /Connecting project/u);
	assert.match(styles, /@keyframes project-tab-creation-spin/u);
	assert.match(app, /creationStatus: 'failed'/u);
	assert.match(app, /displayedActiveProjectId = isPendingProjectFailure/u);
	assert.match(app, /Project creation failed\./u);
	assert.match(app, /hydrating:/u);
	assert.match(controller, /explorerMayLoad\(project\)/u);
	assert.match(controller, /project\.hydrating === false/u);
});

test('terminal hydration stays in tab chrome and leaves a blank xterm surface', () => {
	assert.match(terminalTab, /terminal-tab-loading-icon/u);
	assert.match(terminalTab, /terminalHydrationStatus/u);
	assert.doesNotMatch(terminalPanel, /Loading terminal…/u);
	assert.doesNotMatch(terminalPanel, /terminal-panel-loading__logo/u);
});
