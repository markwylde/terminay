import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * An exposed server with no workspace UI pairs a device, opens every lane, and
 * serves one sentence of unstyled text. From the device that is
 * indistinguishable from a broken network; this process is the only party that
 * knows the difference, so it is the party that has to say so.
 */

const CLI = new URL('../src/cli.ts', import.meta.url);

test('an exposed server with no renderer directory refuses to start', async () => {
	const source = await readFile(CLI, 'utf8');
	assert.match(
		source,
		/options\.exposeModes\.length > 0 && rendererDirectory === undefined/u,
		'exposure without a workspace UI must be refused',
	);
	// The message has to name the variable, because the remedy is setting it and
	// nothing else in the failure points there.
	assert.match(source, /TERMINAY_UI_RENDERER_DIRECTORY to the ui directory/u);
});

test('a server that is not exposed may still have no workspace UI', async () => {
	const source = await readFile(CLI, 'utf8');
	// A protocol-only deployment is a legitimate configuration: it serves no
	// workspace because nobody can reach it. The guard is scoped to exposure so
	// that case keeps working.
	const guard = source.slice(source.indexOf('const rendererDirectory'));
	assert.match(guard.slice(0, 900), /exposeModes\.length > 0/u);
	assert.doesNotMatch(
		guard.slice(0, 900),
		/if \(rendererDirectory === undefined\) \{\s*throw/u,
		'the refusal must not apply to an unexposed server',
	);
});

test('the placeholder archive is still what an unexposed server would serve', async () => {
	const host = await readFile(
		new URL('../src/remote/hostedPairingHost.ts', import.meta.url),
		'utf8',
	);
	// Kept deliberately: removing it would turn a legitimate configuration into
	// a crash. What changed is that an exposed server never reaches it.
	assert.match(host, /createMinimalUiArchive\(\)/u);
});
