import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Desktop transport recovery and terminal Retry connection share one replacement operation', async () => {
	const source = await readFile('src/web/main.tsx', 'utf8');
	const registry = await readFile(
		'src/shared/connections/connectionRegistry.ts',
		'utf8',
	);
	// Recovery is per connection now: one guarded retry per server, each
	// asking its host for a fresh byte endpoint.
	assert.match(
		registry,
		/retry: \(\) => this\.start\(true\)/u,
		'every connection must expose one guarded retry',
	);
	assert.match(
		registry,
		/start\(replaceEndpoint = false\)[\s\S]*replaceDesktopEndpoint: replaceEndpoint/u,
		'Desktop recovery must replace the failed byte endpoint',
	);
	assert.match(
		source,
		/const recoverConnection = useCallback\([\s\S]*primary\?\.retry\(\)/u,
		'the shell retries through the primary connection',
	);
	assert.match(
		source,
		/retryConnection:\s*\(\) => primary\.retry\(\)/u,
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
