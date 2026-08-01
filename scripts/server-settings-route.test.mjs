import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [runtime, source] = await Promise.all([
	readFile('src/rendererRuntime.tsx', 'utf8'),
	readFile('src/components/SettingsWindow.tsx', 'utf8'),
]);

test('production server workspace settings route uses the canonical client', () => {
	assert.match(
		runtime,
		/new SettingsClient\(\s*new TerminayClientFacade\(/u,
	);
	assert.match(runtime, /<SettingsWindow[\s\S]*settingsClient=\{serverSettingsClient\}/u);
	assert.match(source, /<SharedSettingsRouteBody/u);
	assert.doesNotMatch(runtime, /ServerSettingsRoute|ServerWorkspaceSurface/u);
});
