import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
	inspectRuntimeDependencyResolution,
	inspectRuntimeLayout,
	inspectRuntimeLayoutMetadata,
	RUNTIME_LAYOUTS,
	resolveRuntimeLayout,
} from './task6-runtime-layout.mjs';

async function createFixture() {
	const root = await mkdtemp(join(tmpdir(), 'terminay-task6-runtime-layout-'));
	for (const paths of Object.values(RUNTIME_LAYOUTS)) {
		for (const path of Object.values(paths)) {
			await mkdir(join(root, path, '..'), { recursive: true });
			await writeFile(join(root, path), `fixture:${path}\n`);
		}
	}
	return root;
}

test('development, standalone, and packaged Desktop layouts resolve deterministic regular-file entrypoints', async () => {
	const root = await createFixture();
	try {
		const first = await Promise.all(
			Object.keys(RUNTIME_LAYOUTS).map((layout) =>
				inspectRuntimeLayout(root, layout),
			),
		);
		const second = await Promise.all(
			Object.keys(RUNTIME_LAYOUTS).map((layout) =>
				inspectRuntimeLayout(root, layout),
			),
		);
		assert.deepEqual(second, first);
		assert.deepEqual(
			first.map(({ layout }) => layout),
			['development', 'standalone', 'desktop'],
		);
		assert.equal(
			first.reduce((count, evidence) => count + evidence.files.length, 0),
			10,
		);
		assert.deepEqual(
			resolveRuntimeLayout(root, 'desktop').desktopMcp,
			join(root, 'resources/app.asar.unpacked/dist-electron/serverMcpEntry.js'),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('runtime layout resolution fails closed for missing files, unknown layouts, and unsafe paths', async () => {
	const root = await createFixture();
	try {
		await rm(
			join(root, 'resources/app.asar.unpacked/dist-electron/serverMcpEntry.js'),
		);
		await assert.rejects(
			() => inspectRuntimeLayout(root, 'desktop'),
			/missing a regular file/,
		);
		assert.throws(
			() => resolveRuntimeLayout(root, 'unknown'),
			/unknown runtime layout/,
		);
		assert.throws(
			() => resolveRuntimeLayout(root, 'standalone/../desktop'),
			/unknown runtime layout/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('repository build metadata agrees with the standalone and Desktop layout contract', async () => {
	const evidence = await inspectRuntimeLayoutMetadata(
		resolve(new URL('..', import.meta.url).pathname),
	);
	assert.deepEqual(evidence, {
		buildsServerWorkspace: true,
		standaloneDist: true,
		serverBin: 'dist/cli.js',
		mcpBin: 'dist/mcpEntry.js',
		desktopUnpacked: 'dist-electron/**',
	});
});

test('packaging-sensitive runtime dependencies have deterministic resolution declarations', async () => {
	const evidence = await inspectRuntimeDependencyResolution(
		resolve(new URL('..', import.meta.url).pathname),
	);
	assert.deepEqual(evidence, {
		nodePty: {
			desktopDependency: '^1.1.0',
			standaloneDependency: '^1.1.0',
			standaloneImport: 'apps/terminay-server/src/cli.ts',
		},
		providerCli: {
			codex: 'TERMINAY_CODEX_COMMAND || codex',
			claudeCode: 'TERMINAY_CLAUDE_CODE_COMMAND || claude',
			resolution: 'server PATH/env',
		},
		agentJournals: {
			provider: 'codex',
			ownership: 'pty-process-tree',
			delivery: 'rollout-jsonl',
		},
		mcp: {
			command: 'terminay-mcp',
			standaloneArtifact: 'dist/mcpEntry.js',
			requiredEnvironment: [
				'TERMINAY_CONTROL_SOCKET',
				'TERMINAY_CONTROL_TOKEN',
			],
		},
		unpackedAssets: {
			desktop: 'dist-electron/**',
			desktopMcp:
				'resources/app.asar.unpacked/dist-electron/serverMcpEntry.js',
		},
	});
});
