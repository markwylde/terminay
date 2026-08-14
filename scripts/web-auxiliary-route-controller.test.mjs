import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('auxiliary route controller keeps settings and environments in the canonical presenter', async () => {
	const [
		app,
		controller,
		projectEditor,
		sharedWorkspace,
		webWorkspace,
	] = await Promise.all([
		readFile(new URL('src/App.tsx', root), 'utf8'),
		readFile(new URL('src/shared/auxiliaryRoutes.tsx', root), 'utf8'),
		readFile(new URL('src/workspace/useProjectEditor.ts', root), 'utf8'),
		readFile(new URL('src/shared/ConnectedRendererWorkspace.tsx', root), 'utf8'),
		readFile(new URL('src/web/ConnectedWebRendererWorkspace.tsx', root), 'utf8'),
	]);

	assert.match(controller, /export type AuxiliaryRouteController/u);
	assert.match(controller, /openSettings/u);
	assert.match(controller, /openProjectEnvironments/u);
	assert.match(controller, /openMacros/u);
	assert.match(controller, /openRecordings/u);
	assert.match(controller, /editProjectTab/u);
	assert.match(controller, /editTerminalTab/u);
	assert.doesNotMatch(controller, /terminaySettingsWindowHost/u);
	assert.doesNotMatch(controller, /terminayProjectEnvironmentsHost/u);
	assert.doesNotMatch(controller, /window\.|terminay(?:Recordings|ProjectEdit|TerminalEdit)Host/u);

	assert.match(app, /createAuxiliaryRouteController\(\)/u);
	assert.match(app, /auxiliaryRoutes\.openRecordings\(\)/u);
	assert.match(app, /auxiliaryRoutes\.openSettings\('git-push-agent'\)/u);
	assert.match(app, /auxiliaryRouteController\.openSettings\('extensions'\)/u);
	assert.match(app, /auxiliaryRouteController\.openProjectEnvironments\(\)/u);
	assert.match(app, /auxiliaryRoutes\.editTerminalTab\(/u);
	assert.match(projectEditor, /auxiliaryRoutes\.editProjectTab\(/u);

	assert.doesNotMatch(app, /window\.terminayRecordingsHost\?\.open\(/u);
	assert.doesNotMatch(app, /window\.terminayTerminalEditHost\?\.open\(/u);
	assert.doesNotMatch(app, /ProjectEnvironmentSurfaceDialog/u);
	assert.doesNotMatch(projectEditor, /window\.terminayProjectEditHost\?\.open\(/u);

	assert.match(sharedWorkspace, /auxiliaryRoutes\?: AuxiliaryRouteController/u);
	assert.match(webWorkspace, /createAuxiliaryRouteController\(/u);
	assert.doesNotMatch(webWorkspace, /getWindow:/u);
	assert.match(webWorkspace, /data-connected-web-auxiliary-route/u);
	assert.doesNotMatch(webWorkspace, /nativeWindows:\s*true/u);
	assert.doesNotMatch(webWorkspace, /window\.terminay(?:SettingsWindowHost|RecordingsHost|ProjectEditHost|TerminalEditHost)/u);
	assert.match(webWorkspace, /SharedEditTabRouteBody/u);
	assert.match(webWorkspace, /SettingsWindow/u);
	assert.match(webWorkspace, /ProjectEnvironmentsWindow/u);
	assert.match(webWorkspace, /RecordingsWindow/u);
});
