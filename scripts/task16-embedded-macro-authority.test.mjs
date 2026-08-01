import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile('electron/main.ts', 'utf8');
const renderer = await readFile('src/rendererRuntime.tsx', 'utf8');
const controller = await readFile('src/workspace/useMacroRunController.ts', 'utf8');

test('embedded macros persist atomically and execute only at the server terminal boundary', () => {
	assert.match(main, /new MacroRepository\(\{/u);
	assert.match(main, /server-macros\.v1\.json/u);
	assert.match(main, /flag: 'wx'/u);
	assert.match(main, /await rename\(temporary, embeddedMacroPath\)/u);
	assert.match(main, /authority\.service\.input\(target, bytes, authorization\)/u);
	assert.match(main, /authority\.service\.waitForInactivity\(target, milliseconds/u);
	assert.match(main, /resolveSecret:/u);
});

test('Desktop macro editing and execution use shared server clients', () => {
	assert.doesNotMatch(renderer, /<MacrosWindow\b/u);
	assert.match(renderer, /<ServerMacrosRoute[\s\S]*macroSettingsClient=/u);
	assert.match(controller, /serverMacroClient\.run\(/u);
	assert.match(controller, /serverMacroClient[\s\S]*\.cancel\(/u);
	assert.match(controller, /onRunChanged\(applyServerSnapshot\)/u);
});
