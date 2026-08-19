import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [webWorkspace, webWorkspaceCss, sharedEditTab, sharedWorkspace, app, projectEditor, serverHtml] = await Promise.all([
	readFile('src/web/ConnectedWebRendererWorkspace.tsx', 'utf8'),
	readFile('src/web/connectedRendererWorkspace.css', 'utf8'),
	readFile('src/shared/SharedEditTabRouteBody.tsx', 'utf8'),
	readFile('src/shared/ConnectedRendererWorkspace.tsx', 'utf8'),
	readFile('src/App.tsx', 'utf8'),
	readFile('src/workspace/useProjectEditor.ts', 'utf8'),
	readFile('server.html', 'utf8'),
]);

test('connected browser workspace owns an in-page auxiliary presenter and menu bar', () => {
	assert.match(webWorkspace, /className="connected-web-menubar"/u);
	assert.match(webWorkspace, /role="menubar"/u);
	assert.match(webWorkspaceCss, /padding-top:\s*env\(safe-area-inset-top, 0px\)/u);
	assert.match(webWorkspaceCss, /html\.is-framed \.connected-web-menubar \{\n\tmin-height: 30px;\n\tpadding-top: 0;/u);
	assert.match(webWorkspaceCss, /html\.is-framed \.connected-web-renderer-workspace/u);
	assert.match(webWorkspaceCss, /height: 100%;/u);
	assert.doesNotMatch(webWorkspaceCss, /html\.is-framed[^{]*\{[^}]*safe-area-inset-top/u);
	assert.match(serverHtml, /viewport-fit=cover/);
	assert.match(serverHtml, /documentElement\.classList\.add\('is-framed'\)/);
	for (const label of ['File', 'Edit', 'View', 'Help']) {
		assert.match(webWorkspace, new RegExp(`${label}`, 'u'));
	}
	assert.match(webWorkspace, /data-connected-web-auxiliary-route=\{route\.kind\}/u);
	assert.match(webWorkspace, /route\.kind === 'edit-tab' \? null : \(/u);
	assert.match(webWorkspace, /<SettingsWindow/u);
	assert.match(webWorkspace, /<ProjectEnvironmentsWindow/u);
	assert.match(webWorkspace, /initialSectionId=\{route\.sectionId\}/u);
	assert.match(webWorkspace, /remoteAccessStatusClient=\{remoteAccessStatusClient\}/u);
	assert.match(webWorkspace, /settingsClient=\{serverSettingsClient\}/u);
	assert.match(webWorkspace, /<SharedEditTabRouteBody/u);
	assert.match(webWorkspace, /<RecordingsWindow/u);
	assert.match(webWorkspace, /client=\{recordingsClient\}/u);
	assert.match(webWorkspace, /auxiliaryFocusReturnRef/u);
	assert.match(webWorkspace, /target\?\.isConnected/u);
	assert.doesNotMatch(webWorkspace, /getWindow:/u);
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
