import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [preload, endpoint, recovery, declarations] = await Promise.all([
	readFile('electron/serverUiPreload.ts', 'utf8'),
	readFile('electron/serverUiDocumentEndpoint.ts', 'utf8'),
	readFile('e2e/local-application-connection-recovery.spec.ts', 'utf8'),
	readFile('src/vite-env.d.ts', 'utf8'),
]);

test('Local connection fault injection is one narrow test-only generation seam', () => {
	assert.match(preload, /process\.env\.TERMINAY_TEST === '1'/u);
	assert.match(preload, /byteListeners\.size !== 1/u);
	assert.match(preload, /for \(const listener of \[\.\.\.byteListeners\]\) listener\(null\)/u);
	assert.match(preload, /await bytes\.replaceEndpoint\(\)/u);
	assert.match(preload, /bytePort\?\.close\(\);[\s\S]*bytePort = port/u);
	assert.match(endpoint, /ipcMain\.on\(REPLACE_BYTE_ENDPOINT, onReplace\)/u);
	assert.match(endpoint, /if \(event\.sender === sender\) attach\(\)/u);
	assert.match(recovery, /terminayLocalConnectionFaultTest\.failActiveConnection\(\)/u);
	assert.match(declarations, /terminayLocalConnectionFaultTest\?:/u);
	assert.doesNotMatch(preload, /terminayTest['"]/u);
});
