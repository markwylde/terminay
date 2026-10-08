import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [webWorkspace, webWorkspaceCss, inPageWindow, inPageWindowCss, sharedEditTab, sharedWorkspace, app, projectEditor, serverHtml] = await Promise.all([
	readFile('src/web/ConnectedWebRendererWorkspace.tsx', 'utf8'),
	readFile('src/web/connectedRendererWorkspace.css', 'utf8'),
	readFile('src/shared/inPageWindow/InPageWindow.tsx', 'utf8'),
	readFile('src/shared/inPageWindow/inPageWindow.css', 'utf8'),
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
	assert.match(webWorkspace, /<InPageWindow\b[\s\S]*name=\{route\.kind\}/u);
	assert.match(inPageWindow, /data-connected-web-auxiliary-route=\{name\}/u);
	assert.match(webWorkspace, /<SettingsWindow/u);
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
	assert.match(webWorkspace, /settings: \{ width: 1480, height: 820 \}/u);
	assert.match(webWorkspaceCss, /\[data-in-page-window="settings"\] \.settings-content[\s\S]*max-width:\s*none/u);
});

test('every in-page window is drawn by the one shared frame', () => {
	// One title bar and one close control, owned by the frame.
	assert.match(inPageWindow, /role="dialog"/u);
	assert.match(inPageWindow, /aria-modal="true"/u);
	assert.match(inPageWindow, /aria-labelledby=\{titleId\}/u);
	assert.match(inPageWindow, /aria-label="Close"/u);
	assert.match(inPageWindow, /setPointerCapture/u);
	// A busy window has one close path, and it is shut.
	assert.match(inPageWindow, /if \(!busy\) onClose\(\)/u);
	assert.match(inPageWindow, /disabled=\{busy\}/u);
	// A transform or a backdrop filter on the frame would trap nested dialogs.
	const frameRule = inPageWindowCss.match(/\n\.in-page-window \{[^}]*\}/u)?.[0] ?? '';
	assert.doesNotMatch(frameRule, /transform|filter|contain/u);
	assert.match(inPageWindowCss, /prefers-reduced-motion: reduce[\s\S]*animation: none/u);
	assert.doesNotMatch(webWorkspace, /ConnectedBrowserAuxiliaryDialog|ConnectedBrowserAboutDialog/u);
	assert.doesNotMatch(webWorkspaceCss, /connected-web-auxiliary-dialog|connected-web-about-dialog/u);
	assert.match(webWorkspace, /sandbox="allow-popups allow-popups-to-escape-sandbox"/u);
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
