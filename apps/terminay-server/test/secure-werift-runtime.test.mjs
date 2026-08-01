import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	loadSelectedSecureWeriftRuntime,
	verifySelectedSecureWeriftRuntime,
} from '../dist/remote/secureWeriftRuntime.js';

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'terminay-selected-werift-'));
	await cp(
		fileURLToPath(
			new URL('../../../build/webrtc-runtime/selection.json', import.meta.url),
		),
		join(root, 'selection.json'),
	);
	const artifact = join(root, 'artifact');
	await mkdir(join(artifact, 'lib'), { recursive: true });
	const files = {
		'lib/index.mjs': 'export class RTCPeerConnection {}\n',
		'package.json': `${JSON.stringify({
			name: '@terminay/werift-runtime-proof',
			version: '0.24.1-candidate.1',
			type: 'module',
		})}\n`,
	};
	for (const [path, content] of Object.entries(files)) {
		await writeFile(join(artifact, path), content);
	}
	await writeFile(
		join(artifact, 'SHA256SUMS'),
		`${Object.entries(files)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(
				([path, content]) =>
					`${createHash('sha256').update(content).digest('hex')}  ${path}`,
			)
			.join('\n')}\n`,
	);
	return { artifact, root };
}

test('verifies and imports the exact selected self-contained runtime', async (context) => {
	const { root } = await fixture();
	context.after(() => rm(root, { force: true, recursive: true }));
	const verified = await verifySelectedSecureWeriftRuntime(root);
	assert.equal(verified.selection.runtime, 'secure-werift');
	const runtime = await loadSelectedSecureWeriftRuntime(root);
	assert.equal(typeof runtime.RTCPeerConnection, 'function');
	assert.deepEqual(Object.keys(runtime), ['RTCPeerConnection']);
	assert.equal(Object.isFrozen(runtime), true);
});

test('fails closed for changed, extra, and symlinked runtime payloads', async (context) => {
	const changed = await fixture();
	const extra = await fixture();
	const linked = await fixture();
	context.after(() =>
		Promise.all(
			[changed.root, extra.root, linked.root].map((root) =>
				rm(root, { force: true, recursive: true }),
			),
		),
	);

	await writeFile(join(changed.artifact, 'lib', 'index.mjs'), 'changed');
	await assert.rejects(
		verifySelectedSecureWeriftRuntime(changed.root),
		/integrity mismatch/u,
	);

	await writeFile(join(extra.artifact, 'extra.js'), 'injected');
	await assert.rejects(
		verifySelectedSecureWeriftRuntime(extra.root),
		/payload inventory/u,
	);

	await rm(join(linked.artifact, 'lib', 'index.mjs'));
	await symlink(
		join(linked.artifact, 'package.json'),
		join(linked.artifact, 'lib', 'index.mjs'),
	);
	await assert.rejects(
		verifySelectedSecureWeriftRuntime(linked.root),
		/symlink|regular/u,
	);
});
