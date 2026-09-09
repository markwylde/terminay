import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * The container flow is documented in two places an operator copies from. A
 * loopback advertised address in either one is a command the CLI now refuses,
 * and before it refused it was worse: a server that paired from Chromium and
 * hung, undiagnosably, everywhere else.
 */

const DOCUMENTS = [
	new URL('../docs/operations/standalone-server.md', import.meta.url),
	new URL('../apps/terminay-cli/README.md', import.meta.url),
];

const LOOPBACK =
	/--advertise-address[= ]+(?:\[?::1\]?|127(?:\.[0-9]{1,3}){3})/u;

test('no document tells an operator to advertise a loopback address', async () => {
	for (const document of DOCUMENTS) {
		const text = await readFile(document, 'utf8');
		assert.doesNotMatch(
			text,
			LOOPBACK,
			`${document.pathname} advertises a loopback address`,
		);
	}
});

test('both documents say why the address has to be routable', async () => {
	for (const document of DOCUMENTS) {
		const text = await readFile(document, 'utf8');
		assert.match(text, /--advertise-address/u);
		assert.match(
			text,
			/loopback/u,
			`${document.pathname} must say a loopback address will not do`,
		);
		// The published port and the advertised address are the same statement
		// made twice; an operator who reads one without the other forwards
		// nothing.
		assert.match(text, /-p 51000-51003:51000-51003\/udp/u);
	}
});
