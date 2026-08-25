import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(
	join(tmpdir(), 'terminay-workspace-persistence-'),
);
const output = join(directory, 'workspacePersistence.mjs');
await build({
	bundle: true,
	entryPoints: ['electron/workspacePersistence.ts'],
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
});
const {
	createEmbeddedWorkspaceStateBackend,
	embeddedBuiltInExtensionArtifactRoot,
	embeddedWorkspacePersistenceFault,
	isEmbeddedWorkspacePersistenceError,
	WorkspacePersistenceError,
} = await import(pathToFileURL(output).href);
test.after(async () => rm(directory, { recursive: true, force: true }));

test('development and packaged runtimes resolve their distinct built-in artifact roots', () => {
	assert.equal(
		embeddedBuiltInExtensionArtifactRoot({
			appRoot: '/checkout',
			isPackaged: false,
			resourcesPath: '/Electron.app/Contents/Resources',
		}),
		join('/checkout', 'build', 'built-in-extensions'),
	);
	assert.equal(
		embeddedBuiltInExtensionArtifactRoot({
			appRoot: '/Applications/Terminay.app/Contents/Resources/app.asar',
			isPackaged: true,
			resourcesPath: '/Applications/Terminay.app/Contents/Resources',
		}),
		join(
			'/Applications/Terminay.app/Contents/Resources',
			'built-in-extensions',
		),
	);
});

test('only canonical persistence errors enter workspace recovery', async () => {
	const backend = createEmbeddedWorkspaceStateBackend({
		filePath: '/unused',
		testFault: 'unreadable',
	});
	const persistenceError = await backend.load().catch((error) => error);
	// The injected backend error is deliberately below the repository boundary.
	assert.equal(isEmbeddedWorkspacePersistenceError(persistenceError), false);
	assert.equal(
		isEmbeddedWorkspacePersistenceError(
			new WorkspacePersistenceError('persistence_unreadable'),
		),
		true,
	);
	assert.equal(
		isEmbeddedWorkspacePersistenceError(new ReferenceError('torn build')),
		false,
	);
});

test('the embedded persistence fault seam is inert outside an explicit test process', () => {
	assert.equal(
		embeddedWorkspacePersistenceFault({
			TERMINAY_TEST_WORKSPACE_PERSISTENCE_FAULT: 'unreadable',
		}),
		undefined,
	);
	assert.equal(
		embeddedWorkspacePersistenceFault({
			TERMINAY_TEST: '0',
			TERMINAY_TEST_WORKSPACE_PERSISTENCE_FAULT: 'uncommittable',
		}),
		undefined,
	);
});

for (const fault of ['unreadable', 'invalid', 'uncommittable']) {
	test(`the embedded persistence fault seam accepts the closed ${fault} fault in tests`, () => {
		assert.equal(
			embeddedWorkspacePersistenceFault({
				TERMINAY_TEST: '1',
				TERMINAY_TEST_WORKSPACE_PERSISTENCE_FAULT: fault,
			}),
			fault,
		);
	});
}

test('the embedded persistence fault seam rejects unknown fault names', () => {
	assert.equal(
		embeddedWorkspacePersistenceFault({
			TERMINAY_TEST: '1',
			TERMINAY_TEST_WORKSPACE_PERSISTENCE_FAULT: 'skip-validation',
		}),
		undefined,
	);
});

test('each injected repository phase fails without exposing a renderer repair backend', async () => {
	const unreadable = createEmbeddedWorkspaceStateBackend({
		filePath: '/unused',
		testFault: 'unreadable',
	});
	await assert.rejects(unreadable.load(), /injected read failure/u);
	const invalid = createEmbeddedWorkspaceStateBackend({
		filePath: '/unused',
		testFault: 'invalid',
	});
	assert.deepEqual(await invalid.load(), { schemaVersion: 'invalid' });
	const uncommittable = createEmbeddedWorkspaceStateBackend({
		filePath: '/unused',
		testFault: 'uncommittable',
	});
	await assert.rejects(uncommittable.commit({}), /injected commit failure/u);
	assert.throws(() => uncommittable.commitSync({}), /injected commit failure/u);
});
