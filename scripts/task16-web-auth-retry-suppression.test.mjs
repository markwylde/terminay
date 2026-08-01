import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const web = await readFile(
	new URL('../src/web/main.tsx', import.meta.url),
	'utf8',
);

test('failed initial pairing invalidates its attempt and clears recovery state', () => {
	const failure = web.match(
		/\} catch \(cause\) \{\s*if \(\s*attempt === undefined[\s\S]*?setError\([\s\S]*?\n\t\t\}/,
	)?.[0];
	assert.ok(failure);
	assert.match(failure, /invalidateConnectionAttempt\(profile\.id\)/);
	assert.match(failure, /window\.clearTimeout\(reconnectTimer\)/);
	assert.match(failure, /reconnectAttempts\.current\.delete\(profile\.id\)/);
	assert.doesNotMatch(failure, /scheduleRecovery/);
});

test('authenticated reconnect handshake rejection requires fresh pairing without retry', () => {
	assert.match(
		web,
		/throw new Error\(\s*'Saved reconnect credentials were rejected during protocol handshake\.'/,
	);
	const terminalFailure = web.match(
		/if \(reconnectNeedsFreshPairing\(cause\)\) \{[\s\S]*?\n\t\t\t\treturn;\s*\}/,
	)?.[0];
	assert.ok(terminalFailure);
	assert.match(terminalFailure, /invalidateConnectionAttempt\(profile\.id\)/);
	assert.match(terminalFailure, /reconnectVault\.forget\(profile\.origin\)/);
	assert.doesNotMatch(terminalFailure, /scheduleRecovery/);
});

test('initial pairing enrolls reconnect credentials under the saved profile origin', () => {
	const enrollBlock = web.match(
		/await reconnectVault\.enroll\(\{[\s\S]*?\}\);/,
	)?.[0];
	assert.ok(enrollBlock);
	assert.match(enrollBlock, /origin: profile\.origin/);
	assert.doesNotMatch(enrollBlock, /origin: parsed\.displayOrigin/);
});
