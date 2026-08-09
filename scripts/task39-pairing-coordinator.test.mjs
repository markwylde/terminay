import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Connections pairing entry points use the web host pairing transaction', async () => {
	const source = await readFile('src/web/main.tsx', 'utf8');
	assert.equal(
		(source.match(/onPairingHandoff(?::|=\{)\s*async \(rawUrl\)/gu) ?? [])
			.length,
		2,
	);
	assert.equal(
		(source.match(/await connectServer\(undefined, rawUrl, true\)/gu) ?? [])
			.length,
		2,
	);
	assert.doesNotMatch(
		source,
		/onPairingHandoff[\s\S]{0,500}consumePairingUrl/u,
	);
	assert.doesNotMatch(source, /paired and saved/u);
});

test('shared Connections UI makes authenticated pairing primary and metadata import advanced', async () => {
	const source = await readFile(
		'src/shared/SharedConnectionsRouteBody.tsx',
		'utf8',
	);

	assert.match(source, />\s*Add connection…\s*</u);
	assert.match(source, />\s*Advanced: import profile metadata\s*</u);
	assert.match(source, /imports non-secret connection metadata only/u);
	assert.doesNotMatch(source, />\s*Add server\s*</u);
	assert.doesNotMatch(source, /Pairing handoff accepted|paired and saved/u);
	assert.match(
		source,
		/const profileActions =[\s\S]*state === 'empty'[\s\S]*\{profileActions\}[\s\S]*state === 'ready'[\s\S]*\{profileActions\}/u,
	);
});

test('the primary web transaction refuses to save an unauthenticated origin', async () => {
	const source = await readFile('src/web/main.tsx', 'utf8');

	assert.match(
		source,
		/if \(parsed\.token === undefined\) \{[\s\S]*needs a pairing URL before it can be connected and saved/u,
	);
	assert.doesNotMatch(source, /\$\{parsed\.displayOrigin\} saved\./u);
});
