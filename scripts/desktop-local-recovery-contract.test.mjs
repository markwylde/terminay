import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Desktop transport recovery and terminal Retry connection share one replacement operation', async () => {
	const source = await readFile('src/web/main.tsx', 'utf8');
	assert.match(
		source,
		/const recoverConnection = useCallback\([\s\S]*connectRef\s*\.current\(\{ replaceDesktopEndpoint: true \}\)/u,
		'Desktop recovery must replace the failed byte endpoint',
	);
	assert.match(
		source,
		/retryConnection:\s*\(\) => recoverConnection\(\)/u,
		'Terminal Retry connection must use the guarded Desktop recovery operation instead of directly closing and reconnecting the current client',
	);
	assert.match(
		source,
		/onClick=\{recoverConnection\}/u,
		'The unavailable-connection Retry action must use the guarded recovery operation too',
	);
});

test('a replacement renderer client publishes its already-connected state', async () => {
	const source = await readFile('src/shared/rendererServerClient.ts', 'utf8');
	assert.match(
		source,
		/publishClientState\(client\.snapshot\);\s*const removeStateListener = client\.onStateChange/u,
		'a replacement that connected before listener registration must clear stale diagnostics',
	);
});
