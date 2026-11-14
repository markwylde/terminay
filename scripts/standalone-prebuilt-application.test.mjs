import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildVerifiedApplication, verifyPrebuiltApplication } from './standalone-prebuilt-application.mjs';

const revision = 'a'.repeat(40);
const target = `linux-${process.arch}`;
function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), 'terminay-prebuilt-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const path of ['src', 'electron', 'packages', 'apps', 'extensions', 'scripts', 'public', 'docker', 'dist-web', 'dist-electron', 'dist', 'build/built-in-extensions', 'node_modules/node-pty/build/Release']) mkdirSync(join(root, path), { recursive: true });
	writeFileSync(join(root, 'src/app.ts'), 'source');
	writeFileSync(join(root, 'package-lock.json'), '{}');
	const options = { root, target, revision, runBuild: () => writeFileSync(join(root, 'dist-web/server.html'), 'compiled') };
	return options;
}

test('only a completed synchronous build supplies matching revision/source/output provenance', (t) => {
	const options = fixture(t);
	assert.throws(() => verifyPrebuiltApplication(options), /ENOENT/u);
	buildVerifiedApplication(options);
	verifyPrebuiltApplication(options);
	assert.throws(() => verifyPrebuiltApplication({ ...options, revision: 'b'.repeat(40) }), /revision mismatch/u);
	writeFileSync(join(options.root, 'dist-web/server.html'), 'changed');
	assert.throws(() => verifyPrebuiltApplication(options), /output mismatch/u);
});

test('changed sources and failed builds cannot reuse a previous stamp', (t) => {
	const options = fixture(t);
	buildVerifiedApplication(options);
	writeFileSync(join(options.root, 'src/app.ts'), 'changed');
	assert.throws(() => verifyPrebuiltApplication(options), /source mismatch/u);
	assert.throws(() => buildVerifiedApplication({ ...options, runBuild: () => { throw new Error('build failed'); } }), /build failed/u);
	assert.equal(existsSync(join(options.root, 'build/standalone-application.v1.json')), false);
	assert.throws(() => buildVerifiedApplication({ ...options, runBuild: () => writeFileSync(join(options.root, 'src/app.ts'), 'changed during build') }), /sources changed/u);
	assert.equal(existsSync(join(options.root, 'build/standalone-application.v1.json')), false);
});

test('target architecture and full revision are checked before building', (t) => {
	const options = fixture(t);
	assert.throws(() => buildVerifiedApplication({ ...options, revision: 'abc123' }), /full commit SHA/u);
	assert.throws(() => buildVerifiedApplication({ ...options, target: 'windows-x64' }), /native build host/u);
});
