import assert from 'node:assert/strict';
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stageProductionDependencyClosure } from './standalone-runtime-dependencies.mjs';

async function writePackage(root, name, manifest) {
	const directory = join(root, 'node_modules', ...name.split('/'));
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, 'package.json'),
		`${JSON.stringify({ name, ...manifest })}\n`,
	);
	await writeFile(
		join(directory, 'index.js'),
		`export const name = ${JSON.stringify(name)}\n`,
	);
	return directory;
}

test('standalone dependency staging closes production dependencies without workspace links', async () => {
	const root = await mkdtemp(
		join(tmpdir(), 'terminay-standalone-runtime-deps-'),
	);
	try {
		const runtime = join(root, 'runtime');
		const workspace = join(root, 'workspace-core');
		await writePackage(runtime, 'external-root', {
			dependencies: { 'nested.value': '1.0.0' },
		});
		await writePackage(runtime, 'nested.value', {});
		await mkdir(workspace, { recursive: true });
		await writeFile(
			join(workspace, 'package.json'),
			JSON.stringify({
				name: '@terminay/server-core',
				dependencies: { 'external-root': '1.0.0' },
			}),
		);
		await writeFile(join(workspace, 'index.js'), 'export const core = true\n');
		const staged = await stageProductionDependencyClosure({
			destinationModules: join(root, 'artifact', 'node_modules'),
			runtimeModules: join(runtime, 'node_modules'),
			workspacePackages: { '@terminay/server-core': workspace },
			rootPackages: ['@terminay/server-core'],
		});
		assert.deepEqual(staged, [
			'@terminay/server-core',
			'external-root',
			'nested.value',
		]);
		assert.equal(
			(
				await readFile(
					join(root, 'artifact/node_modules/external-root/index.js'),
					'utf8',
				)
			).includes('external-root'),
			true,
		);
		assert.equal(
			(
				await readFile(
					join(root, 'artifact/node_modules/nested.value/index.js'),
					'utf8',
				)
			).includes('nested.value'),
			true,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('standalone dependency staging dereferences a workspace package source', async () => {
	const root = await mkdtemp(
		join(tmpdir(), 'terminay-standalone-runtime-link-'),
	);
	try {
		const runtime = join(root, 'runtime');
		const actual = join(root, 'actual-linked-package');
		await mkdir(actual, { recursive: true });
		await writeFile(
			join(actual, 'package.json'),
			JSON.stringify({ name: 'linked' }),
		);
		await writeFile(join(actual, 'index.js'), 'export const linked = true\n');
		await mkdir(join(runtime, 'node_modules'), { recursive: true });
		await symlink(actual, join(runtime, 'node_modules', 'linked'), 'dir');
		const staged = await stageProductionDependencyClosure({
			destinationModules: join(root, 'artifact', 'node_modules'),
			runtimeModules: join(runtime, 'node_modules'),
			rootPackages: ['linked'],
		});
		assert.deepEqual(staged, ['linked']);
		const info = await (await import('node:fs/promises')).lstat(
			join(root, 'artifact/node_modules/linked'),
		);
		assert.equal(info.isSymbolicLink(), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('standalone dependency staging skips optional packages absent on this platform', async () => {
	const root = await mkdtemp(
		join(tmpdir(), 'terminay-standalone-runtime-optional-'),
	);
	try {
		const runtime = join(root, 'runtime');
		await writePackage(runtime, 'portable-root', {
			dependencies: { 'required-value': '1.0.0' },
			optionalDependencies: { 'another-platform-binary': '1.0.0' },
		});
		await writePackage(runtime, 'required-value', {});
		const staged = await stageProductionDependencyClosure({
			destinationModules: join(root, 'artifact', 'node_modules'),
			runtimeModules: join(runtime, 'node_modules'),
			rootPackages: ['portable-root'],
		});
		assert.deepEqual(staged, ['portable-root', 'required-value']);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
