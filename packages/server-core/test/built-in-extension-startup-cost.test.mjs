import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
	createDefaultExtensionManagement,
	DirectoryBuiltInExtensionArtifactSource,
	ExtensionInstaller,
} from '../dist/extensions/index.js';

const INTEGRITY = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function manifest(id) {
	return {
		manifestVersion: 1,
		id,
		displayName: id,
		api: '^3.0.0',
		engines: { terminay: '>=1', node: '>=22' },
		entrypoint: 'dist/extension.js',
		permissions: ['agent-observation'],
		contributes: {
			agentSessionSources: [
				{
					id: `${id}/cli`,
					displayName: id,
					harnesses: [{ id: 'fixture', displayName: 'Fixture' }],
				},
			],
		},
	};
}

/** One built-in's release tree. `source` is the extension's entrypoint. */
function artifact(packageName, id, source, version = '1.0.0') {
	const packageJson = JSON.stringify({
		name: packageName,
		version,
		type: 'module',
		exports: { '.': './dist/extension.js' },
		terminay: manifest(id),
	});
	const lock = JSON.stringify({
		lockfileVersion: 3,
		packages: {
			'': {},
			[`node_modules/${packageName}`]: {
				version,
				resolved: `file:${packageName}-${version}.tgz`,
				integrity: INTEGRITY,
			},
		},
	});
	const files = [
		['package-lock.json', lock],
		[`node_modules/${packageName}/package.json`, packageJson],
		[`node_modules/${packageName}/dist/extension.js`, source],
	];
	const inventory = files
		.map(([path, body]) => ({
			path,
			size: Buffer.byteLength(body),
			hash: sha256(body),
		}))
		.sort((a, b) => a.path.localeCompare(b.path));
	return {
		files,
		inventory,
		record: {
			extensionId: id,
			packageName,
			version,
			integrity: INTEGRITY,
			source: 'built-in',
			manifestMetadata: manifest(id),
			inventoryHash: sha256(JSON.stringify(inventory)),
			lockHash: sha256(lock),
			provenance: 'verified',
		},
	};
}

class BuiltIns {
	constructor(artifacts) {
		this.artifacts = artifacts;
		this.materialized = [];
	}
	async list() {
		return this.artifacts.map(({ record }) => record);
	}
	async materialize(record, root) {
		this.materialized.push(record.extensionId);
		const { files } = this.artifacts.find(
			(candidate) => candidate.record.extensionId === record.extensionId,
		);
		for (const [path, body] of files) {
			const target = join(root, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, body);
		}
	}
}

const quiet = (id) =>
	`export function activate(context) { context.agents.registerSessionSource("${id}/cli", { start() {} }); return { methods: {} }; }\n`;

test('a start whose built-in slot is already selected does not copy the release tree again', async () => {
	const dataRoot = await mkdtemp(join(tmpdir(), 'terminay-built-in-warm-'));
	const fixture = artifact(
		'terminay-warm-fixture',
		'com.terminay.warm-fixture',
		quiet('com.terminay.warm-fixture'),
	);
	const builtIns = new BuiltIns([fixture]);
	const probes = [];
	const installer = () =>
		new ExtensionInstaller({
			dataRoot,
			registryClient: {},
			materializer: { installerVersion: '0' },
			builtIns,
			probe: async ({ extensionId }) => {
				probes.push(extensionId);
			},
		});
	try {
		const first = await installer().initialize();
		assert.deepEqual(builtIns.materialized, ['com.terminay.warm-fixture']);
		assert.deepEqual(
			probes,
			[],
			'a fresh built-in is started by reconciliation, not probed first',
		);

		const second = await installer().initialize();
		assert.deepEqual(
			builtIns.materialized,
			['com.terminay.warm-fixture'],
			'the selected slot is reused as it is',
		);
		assert.equal(second.revision, first.revision);
		assert.deepEqual(probes, []);

		// A slot whose directory has gone is restored from the release.
		const slot = first.extensions['com.terminay.warm-fixture'].activeSlotId;
		await rm(join(dataRoot, 'extensions', 'packages', slot), {
			recursive: true,
			force: true,
		});
		await installer().initialize();
		assert.equal(builtIns.materialized.length, 2);
		assert.ok(
			JSON.parse(
				await readFile(
					join(
						dataRoot,
						'extensions',
						'packages',
						slot,
						'node_modules',
						'terminay-warm-fixture',
						'package.json',
					),
					'utf8',
				),
			),
		);

		// A newer release replacing the selected slot is still probed before the
		// pointer moves.
		probes.length = 0;
		const next = artifact(
			'terminay-warm-fixture',
			'com.terminay.warm-fixture',
			quiet('com.terminay.warm-fixture'),
			'1.0.1',
		);
		builtIns.artifacts = [next];
		const upgraded = await installer().initialize();
		assert.deepEqual(probes, ['com.terminay.warm-fixture']);
		assert.equal(
			upgraded.extensions['com.terminay.warm-fixture'].slots[
				upgraded.extensions['com.terminay.warm-fixture'].activeSlotId
			].version,
			'1.0.1',
		);
	} finally {
		await rm(dataRoot, { recursive: true, force: true });
	}
});

test('enabled built-ins start together, and one that fails holds up none of the others', async () => {
	const dataRoot = await mkdtemp(join(tmpdir(), 'terminay-built-in-together-'));
	const marker = join(dataRoot, 'late-started');
	// The first extension in start order finishes activating only once the
	// last one has started, so a serial start fails it.
	const waiting = `
    import { existsSync } from "node:fs";
    export async function activate(context) {
      for (let attempt = 0; attempt < 300 && !existsSync(${JSON.stringify(marker)}); attempt += 1)
        await new Promise((resolve) => setTimeout(resolve, 10));
      if (!existsSync(${JSON.stringify(marker)})) throw new Error("started alone");
      context.agents.registerSessionSource("com.terminay.a-waiting/cli", { start() {} });
      return { methods: {} };
    }
  `;
	const late = `
    import { writeFileSync } from "node:fs";
    export function activate(context) {
      writeFileSync(${JSON.stringify(marker)}, "1");
      context.agents.registerSessionSource("com.terminay.c-late/cli", { start() {} });
      return { methods: {} };
    }
  `;
	const broken = `export function activate() { throw new Error("broken on purpose"); }\n`;
	const builtIns = new BuiltIns([
		artifact('terminay-a-waiting', 'com.terminay.a-waiting', waiting),
		artifact('terminay-b-broken', 'com.terminay.b-broken', broken),
		artifact('terminay-c-late', 'com.terminay.c-late', late),
	]);
	const management = createDefaultExtensionManagement({
		dataRoot,
		authorityLabel: 'Test server',
		builtIns,
		schedule: () => ({}),
		cancelSchedule: () => undefined,
	});
	try {
		const state = await management.initialize();
		assert.deepEqual(
			management.hosts
				.sessionSourceContributions()
				.map(({ contribution }) => contribution.id)
				.sort(),
			['com.terminay.a-waiting/cli', 'com.terminay.c-late/cli'],
		);
		assert.equal(state.extensions['com.terminay.b-broken'].state, 'failed');
		assert.equal(state.extensions['com.terminay.a-waiting'].state, 'installed');
	} finally {
		management.stopSupervision();
		await management.hosts.shutdown().catch(() => undefined);
		await rm(dataRoot, { recursive: true, force: true });
	}
});

test("a release inventory whose tree hash is not its file list's is refused", async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-built-in-inventory-'));
	const fixture = artifact(
		'terminay-inventory-fixture',
		'com.terminay.inventory-fixture',
		quiet('com.terminay.inventory-fixture'),
	);
	const files = fixture.inventory.map(({ path, size, hash }) => ({
		path,
		size,
		sha256: hash,
	}));
	const write = (inventoryHash) =>
		writeFile(
			join(root, 'inventory.v1.json'),
			JSON.stringify({
				schemaVersion: 1,
				artifacts: [
					{
						...fixture.record,
						directory: 'artifacts/fixture',
						inventoryHash,
						files,
					},
				],
			}),
		);
	try {
		await write(fixture.record.inventoryHash);
		assert.equal(
			(await new DirectoryBuiltInExtensionArtifactSource(root).list()).length,
			1,
		);
		await write(sha256('something else'));
		await assert.rejects(
			new DirectoryBuiltInExtensionArtifactSource(root).list(),
			/differs from its file list/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
