import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorTextEchoes } from './editorTextEcho.ts';

test('text the editor never reported is not an echo', () => {
	const echoes = createEditorTextEchoes();
	assert.equal(echoes.acknowledge('from disk'), false);
	echoes.emitted('typed');
	assert.equal(echoes.acknowledge('from disk'), false);
});

test('an echo that lags behind typing is still an echo', () => {
	const echoes = createEditorTextEchoes();
	// Five keystrokes land before the owner renders the first of them.
	for (const text of ['u', 'ut', 'uti', 'util', 'util.']) echoes.emitted(text);
	// The stale render must not be written back over `util.`.
	assert.equal(echoes.acknowledge('u'), true);
	// Batched renders skip the intermediate edits and deliver the latest.
	assert.equal(echoes.acknowledge('util.'), true);
});

test('an echo settles every edit reported before it', () => {
	const echoes = createEditorTextEchoes();
	for (const text of ['a', 'ab', 'abc']) echoes.emitted(text);
	assert.equal(echoes.acknowledge('abc'), true);
	// Reverting to an earlier text is now an outside change, not an echo.
	assert.equal(echoes.acknowledge('a'), false);
	assert.equal(echoes.acknowledge('abc'), false);
});

test('repeated text is matched at its latest report', () => {
	const echoes = createEditorTextEchoes();
	for (const text of ['a', 'ab', 'a']) echoes.emitted(text);
	assert.equal(echoes.acknowledge('a'), true);
	assert.equal(echoes.acknowledge('ab'), false);
});

test('reset forgets edits whose echo will never arrive', () => {
	const echoes = createEditorTextEchoes();
	echoes.emitted('typed');
	echoes.reset();
	assert.equal(echoes.acknowledge('typed'), false);
});
