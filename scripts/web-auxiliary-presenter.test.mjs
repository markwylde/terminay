import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [webWorkspace, webWorkspaceCss, sharedEditTab, sharedWorkspace, app, projectEditor] = await Promise.all([
	readFile('src/web/ConnectedWebRendererWorkspace.tsx', 'utf8'),
	readFile('src/web/connectedRendererWorkspace.css', 'utf8'),
	readFile('src/shared/SharedEditTabRouteBody.tsx', 'utf8'),
	readFile('src/shared/ConnectedRendererWorkspace.tsx', 'utf8'),
	readFile('src/App.tsx', 'utf8'),
	readFile('src/workspace/useProjectEditor.ts', 'utf8'),
]);

test('connected browser workspace owns an in-page auxiliary presenter and menu bar', () => {
	assert.match(webWorkspace, /className="connected-web-menubar"/u);
	assert.match(webWorkspace, /role="menubar"/u);
	for (const label of ['File', 'Edit', 'View', 'Help']) {
		assert.match(webWorkspace, new RegExp(`${label}`, 'u'));
	}
	assert.match(webWorkspace, /data-connected-web-auxiliary-route=\{route\.kind\}/u);
	assert.match(webWorkspace, /<SettingsWindow/u);
	assert.match(webWorkspace, /<ProjectEnvironmentsWindow/u);
	assert.match(webWorkspace, /initialSectionId=\{auxiliaryRoute\.sectionId\}/u);
	assert.match(webWorkspace, /remoteAccessStatusClient=\{remoteAccessStatusClient\}/u);
	assert.match(webWorkspace, /settingsClient=\{serverSettingsClient\}/u);
	assert.match(webWorkspace, /<SharedEditTabRouteBody/u);
	assert.match(webWorkspace, /<RecordingsWindow/u);
	assert.match(webWorkspace, /client=\{recordingsClient\}/u);
	assert.match(webWorkspace, /auxiliaryFocusReturnRef/u);
	assert.match(webWorkspace, /target\?\.isConnected/u);
	assert.match(webWorkspace, /getWindow:\s*\(\)\s*=>\s*undefined/u);
	assert.match(sharedEditTab, /components\/editTabWindow\.css/u);
	assert.match(webWorkspaceCss, /connected-web-auxiliary-dialog--edit-tab/u);
	assert.match(webWorkspaceCss, /connected-web-auxiliary-dialog--settings[\s\S]*width:\s*min\(1480px,\s*100%\)/u);
	assert.match(webWorkspaceCss, /connected-web-auxiliary-dialog--settings \.settings-content[\s\S]*max-width:\s*none/u);
});

test('browser auxiliary presenter does not fabricate Electron preload globals', () => {
	assert.doesNotMatch(webWorkspace, /nativeWindows\s*:\s*true/u);
	assert.doesNotMatch(webWorkspace, /window\.terminay\w+\s*=/u);
	assert.doesNotMatch(webWorkspace, /Object\.defineProperty\(\s*window\s*,\s*['"]terminay/u);
});

test('shared renderer accepts auxiliary route controller for tab edit fallbacks', () => {
	assert.match(sharedWorkspace, /auxiliaryRoutes\?:\s*AuxiliaryRouteController/u);
	assert.match(sharedWorkspace, /auxiliaryRoutes=\{host\.auxiliaryRoutes\}/u);
	assert.match(app, /auxiliaryRoutes\?:\s*AuxiliaryRouteController/u);
	assert.match(app, /auxiliaryRoutes\s*\?\?\s*createAuxiliaryRouteController\(\)/u);
	assert.match(app, /auxiliaryRoutes\.editTerminalTab/u);
	assert.match(app, /auxiliaryRoutes\.openRecordings/u);
	assert.match(projectEditor, /auxiliaryRoutes\.editProjectTab/u);
	assert.doesNotMatch(projectEditor, /terminayProjectEditHost/u);
});
