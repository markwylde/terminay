import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('workspace settings actions use only the bounded settings-window host', async () => {
	const [
		app,
		auxiliaryRoutes,
		remoteAccessController,
		dictationController,
		settings,
		preload,
		main,
		declarations,
		compatibility,
	] = await Promise.all([
		readFile(new URL('src/App.tsx', root), 'utf8'),
		readFile(new URL('src/shared/auxiliaryRoutes.tsx', root), 'utf8'),
		readFile(
			new URL('src/workspace/useRemoteAccessController.ts', root),
			'utf8',
		),
		readFile(new URL('src/workspace/useDictationController.ts', root), 'utf8'),
		readFile(new URL('src/components/SettingsWindow.tsx', root), 'utf8'),
		readFile(new URL('electron/preload.ts', root), 'utf8'),
		readFile(new URL('electron/main.ts', root), 'utf8'),
		readFile(new URL('src/vite-env.d.ts', root), 'utf8'),
		readFile(new URL('src/types/terminay.ts', root), 'utf8'),
	]);

	assert.match(
		remoteAccessController,
		/window\.terminaySettingsWindowHost\?\.open\('remote-access-host'\)/u,
	);
	assert.match(
		dictationController,
		/window\.terminaySettingsWindowHost\?\.open\('openai-dictation'\)/u,
	);
	assert.match(
		app,
		/auxiliaryRoutes\.openSettings\('git-push-agent'\)/u,
	);
	assert.match(auxiliaryRoutes, /getWindow\(\)\?\.terminaySettingsWindowHost/u);
	assert.match(auxiliaryRoutes, /host\.open\(sectionId\)/u);
	assert.doesNotMatch(
		app,
		/window\.terminaySettingsWindowHost\?\.open\('git-push-agent'\)/u,
	);
	assert.doesNotMatch(app, /window\.terminay\.openSettingsWindow\(/u);
	assert.match(preload, /exposeInMainWorld\(\s*'terminaySettingsWindowHost'/u);
	assert.match(
		settings,
		/window\.terminaySettingsWindowHost\?\.subscribeFocusSection\(/u,
	);
	assert.doesNotMatch(settings, /window\.terminay\.onSettingsFocusSection\(/u);
	assert.match(preload, /subscribeFocusSection:/u);
	assert.doesNotMatch(preload, /onSettingsFocusSection:/u);
	assert.match(preload, /desktop:settings-window-host:open/u);
	assert.match(preload, /DESKTOP_SETTINGS_WINDOW_HOST_BRIDGE_VERSION = 1/u);
	assert.doesNotMatch(preload, /openSettingsWindow:/u);
	assert.match(
		main,
		/ipcMain\.handle\(\s*'desktop:settings-window-host:open'/u,
	);
	assert.match(
		main,
		/desktop:settings-window-host:open'[\s\S]{0,180}assertTrustedAppSender/u,
	);
	assert.match(main, /request\.version !== 1/u);
	assert.match(main, /key === 'version' \|\| key === 'sectionId'/u);
	assert.doesNotMatch(main, /ipcMain\.handle\('app:open-settings'/u);
	assert.match(declarations, /terminaySettingsWindowHost\?:/u);
	assert.match(declarations, /subscribeFocusSection\(/u);
	assert.doesNotMatch(compatibility, /onSettingsFocusSection:/u);
	assert.doesNotMatch(compatibility, /openSettingsWindow:/u);
});
