import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
	inspectStandaloneArtifact,
	validateStandaloneArtifact,
	writeStandaloneArtifactManifest,
} from './standalone-artifact.mjs';
import { stageProductionDependencyClosure } from './standalone-runtime-dependencies.mjs';

const repositoryRoot = new URL('..', import.meta.url);

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.once('error', reject);
		child.once('close', (code) => {
			if (code === 0) resolve({ stdout, stderr });
			else
				reject(
					new Error(`${command} ${args.join(' ')} exited ${code}: ${stderr}`),
				);
		});
	});
}

async function createFixture() {
	const root = await mkdtemp(join(tmpdir(), 'terminay-standalone-artifact-'));
	await mkdir(join(root, 'dist'));
	await writeFile(
		join(root, 'package.json'),
		`${JSON.stringify({
			name: '@terminay/server',
			version: '1.2.3',
			files: ['dist'],
			engines: { node: '24.15.0' },
			dependencies: { npm: '12.0.2' },
			bin: {
				'terminay-server': 'dist/cli.js',
			},
		})}\n`,
	);
	await writeFile(
		join(root, 'dist/cli.js'),
		'#!/usr/bin/env node\nconsole.log("ready")\n',
	);
	await writeFile(
		join(root, 'dist/index.js'),
		'export const serverApplicationBoundary = "@terminay/server"\n',
	);
	await writeFile(join(root, 'dist/bundled-npm-evidence.json'), JSON.stringify({ schemaVersion: 1, version: '12.0.2', packageCount: 50, closureSha256: 'a'.repeat(64), packages: Array.from({ length: 50 }, (_, index) => ({ name: `p${index}` })) }));
	return root;
}

test('standalone artifact manifest is deterministic and validates exact payload hashes', async () => {
	const root = await createFixture();
	try {
		const first = await inspectStandaloneArtifact(root);
		const second = await inspectStandaloneArtifact(root);
		assert.deepEqual(first, second);
		const manifestPath = join(root, 'artifact-manifest.json');
		const written = await writeStandaloneArtifactManifest(root, manifestPath);
		assert.deepEqual(written, first);
		const onDisk = JSON.parse(await readFile(manifestPath, 'utf8'));
		assert.deepEqual(onDisk, first);
		assert.deepEqual(await validateStandaloneArtifact(root, onDisk), first);
		assert.equal(
			first.provenance.generatedBy,
			'scripts/standalone-artifact.mjs',
		);
		assert.equal(first.files.length, 4);
		assert.ok(first.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256)));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('standalone artifact validation detects payload tampering', async () => {
	const root = await createFixture();
	try {
		const manifest = await writeStandaloneArtifactManifest(root);
		await writeFile(
			join(root, 'dist/cli.js'),
			'#!/usr/bin/env node\nconsole.log("changed")\n',
		);
		await assert.rejects(
			() => validateStandaloneArtifact(root, manifest),
			/hashes do not match/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('standalone artifact inspection rejects Electron imports and unpinned Node engines', async () => {
	const root = await createFixture();
	try {
		await writeFile(
			join(root, 'dist/index.js'),
			'import electron from "electron"\nexport default electron\n',
		);
		await assert.rejects(
			() => inspectStandaloneArtifact(root),
			/imports Electron/,
		);
		await writeFile(join(root, 'dist/index.js'), 'export const ok = true\n');
		const packageJson = JSON.parse(
			await readFile(join(root, 'package.json'), 'utf8'),
		);
	packageJson.engines.node = '>=24';
		await writeFile(
			join(root, 'package.json'),
			`${JSON.stringify(packageJson)}\n`,
		);
		await assert.rejects(
			() => inspectStandaloneArtifact(root),
			/Node engine must be pinned/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('the actual packed standalone artifact is byte-reproducible and its CLI starts from the extracted payload', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-packed-artifact-'));
	try {
		const first = join(root, 'first');
		const second = join(root, 'second');
		const extracted = join(root, 'extracted');
		await mkdir(first);
		await mkdir(second);
		await mkdir(extracted);

		const packArguments = [
			'pack',
			'--workspace',
			'@terminay/server',
			'--json',
			'--pack-destination',
		];
		const firstPack = normalizePackResult(JSON.parse(
			(
				await run('npm', [...packArguments, first], {
					cwd: new URL('.', repositoryRoot).pathname,
				})
			).stdout,
		));
		const secondPack = normalizePackResult(JSON.parse(
			(
				await run('npm', [...packArguments, second], {
					cwd: new URL('.', repositoryRoot).pathname,
				})
			).stdout,
		));
		assert.equal(firstPack.length, 1);
		assert.equal(secondPack.length, 1);
		assert.deepEqual(secondPack[0].files, firstPack[0].files);
		assert.equal(secondPack[0].integrity, firstPack[0].integrity);

		const archiveName = firstPack[0].filename;
		const firstArchive = join(first, archiveName);
		const secondArchive = join(second, archiveName);
		assert.deepEqual(
			await readFile(secondArchive),
			await readFile(firstArchive),
		);
		const paths = new Set(firstPack[0].files.map((entry) => entry.path));
		for (const required of [
			'package.json',
			'dist/cli.js',
			'dist/index.js',
			'dist/release-integrity.json',
		]) {
			assert.ok(
				paths.has(required),
				`packed artifact must contain ${required}`,
			);
		}
		assert.ok(
			![...paths].some(
				(path) =>
					path === 'src' ||
					path.startsWith('src/') ||
					path.includes('electron'),
			),
			'packed standalone artifact must not contain source or Electron payload',
		);

		await run('tar', ['-xzf', firstArchive, '-C', extracted]);
		const packageRoot = join(extracted, 'package');
		const repositoryPath = new URL('.', repositoryRoot).pathname;
		await stageProductionDependencyClosure({
			destinationModules: join(packageRoot, 'node_modules'),
			runtimeModules: join(repositoryPath, 'node_modules'),
			workspacePackages: {
				'@terminay/server-core': join(repositoryPath, 'packages/server-core'),
				'@terminay/protocol': join(repositoryPath, 'packages/protocol'),
			},
			rootPackages: [
				'@terminay/server-core',
				'@terminay/protocol',
				'@modelcontextprotocol/sdk',
				'node-pty',
				'ws',
				'zod',
			],
		});
		await assertNoSymlinks(packageRoot);
		const packageJson = JSON.parse(
			await readFile(join(packageRoot, 'package.json'), 'utf8'),
		);
		const cli = await run(
			process.execPath,
			[join(packageRoot, packageJson.bin['terminay-server']), '--version'],
			{ cwd: packageRoot },
		);
		assert.equal(cli.stdout, `${packageJson.version}\n`);
		assert.equal(cli.stderr, '');

		// Pairing is a distinct standalone entry point from foreground startup:
		// it must compose the packaged remote-exposure runtime, honour an exact
		// configured origin, and emit its one-time bootstrap material only in the
		// returned record. Keep the URL in-memory in this test so no credential is
		// copied into test output or the artifact's data root.
		const pairing = await run(
			process.execPath,
			[
				join(packageRoot, packageJson.bin['terminay-server']),
				'--pairing',
				'--server-id',
				'packed-pairing',
				'--remote-origin',
				'https://packed-pairing.example.test',
				'--data-root',
				join(root, 'pairing-data'),
			],
			{
				cwd: packageRoot,
				env: {
					...process.env,
					TERMINAY_SERVER_VERSION: packageJson.version,
					TERMINAY_REMOTE_PAIRING_PIN: '123456',
				},
			},
		);
		assert.equal(pairing.stderr, '');
		const pairingRecord = JSON.parse(pairing.stdout);
		assert.equal(pairingRecord.serverId, 'packed-pairing');
		assert.equal(pairingRecord.endpoint, 'loopback');
		assert.equal(pairingRecord.requiresApproval, true);
		assert.equal(pairingRecord.roomId, pairingRecord.pairingSessionId);
		assert.match(pairingRecord.expiresAt, /^\d{4}-\d{2}-\d{2}T/u);
		const pairingUrl = new URL(pairingRecord.pairingUrl);
		assert.equal(pairingUrl.origin, 'https://packed-pairing.example.test');
		assert.equal(pairingUrl.search, '');
		const bootstrap = new URLSearchParams(pairingUrl.hash.slice(1));
		assert.equal(
			bootstrap.get('pairingSessionId'),
			pairingRecord.pairingSessionId,
		);
		assert.ok(bootstrap.get('pairingToken'));
		assert.equal(bootstrap.get('pairingExpiresAt'), pairingRecord.expiresAt);

		// The packed standalone runtime must execute the same server-owned
		// provider CLI adapter as the development and Desktop layouts. Import it
		// from the extracted production closure and run a bounded child process;
		// this must not resolve a workspace adapter or Electron-owned path.
		const serverCore = await import(
			pathToFileURL(
				join(
					packageRoot,
					'node_modules',
					'@terminay',
					'server-core',
					'dist',
					'index.js',
				),
			).href
		);
		const providers = serverCore.createServerAiProviderAdapters({
			cwd: packageRoot,
			environment: { PATH: process.env.PATH ?? '' },
			commands: {
				codex: {
					command: process.execPath,
					listArgs: () => [
						'-e',
						"process.stdout.write('packed-standalone-provider-cli')",
					],
					parseModels: (stdout) => [
						{ id: stdout.trim(), label: 'Packed standalone provider CLI' },
					],
				},
			},
		});
		assert.deepEqual(
			await providers.codex.listModels({
				provider: 'codex',
				signal: new AbortController().signal,
				maxOutputBytes: 1024,
			}),
			[
				{
					id: 'packed-standalone-provider-cli',
					label: 'Packed standalone provider CLI',
				},
			],
		);

		// This starts the extracted package in foreground mode with no inherited
		// workspace node_modules. Startup creates the default terminal session,
		// exercising the packaged node-pty binding rather than merely resolving
		// the CLI module graph. Agent observation must not create or modify any
		// provider configuration in the isolated HOME.
		const dataRoot = join(root, 'data');
		const artifactHome = join(root, 'artifact-home');
		const foreground = spawn(
			process.execPath,
			[
				join(packageRoot, packageJson.bin['terminay-server']),
				'--server-id',
				'packed-artifact',
				'--data-root',
				dataRoot,
				'--project-root',
				packageRoot,
				'--endpoint',
				'disabled',
			],
			{
				cwd: packageRoot,
				env: {
					...process.env,
					HOME: artifactHome,
					TERMINAY_AGENT_INTEGRATION: 'enabled',
					TERMINAY_REMOTE_PAIRING_PIN: '123456',
					TERMINAY_SERVER_VERSION: packageJson.version,
				},
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);
		foreground.stdout.setEncoding('utf8');
		foreground.stderr.setEncoding('utf8');
		let foregroundStderr = '';
		foreground.stderr.on('data', (chunk) => {
			foregroundStderr += chunk;
		});
		try {
			const readiness = await readForegroundReadiness(foreground);
			assert.equal(readiness.ready, true, foregroundStderr);
			assert.equal(readiness.serverId, 'packed-artifact');
			assert.equal(readiness.protocolEndpoint, null);
			await assert.rejects(() => lstat(join(artifactHome, '.codex')), (error) => error?.code === 'ENOENT');
			await assert.rejects(() => lstat(join(artifactHome, '.claude')), (error) => error?.code === 'ENOENT');
			await assert.rejects(() => lstat(join(artifactHome, '.terminay')), (error) => error?.code === 'ENOENT');
		} finally {
			await stopForeground(foreground);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function normalizePackResult(value) {
	if (Array.isArray(value)) return value;
	const workspace = value?.['@terminay/server'];
	if (workspace && typeof workspace === 'object') return [workspace];
	throw new TypeError('npm pack returned an unsupported result');
}

async function assertNoSymlinks(root) {
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		const details = await lstat(path);
		assert.equal(
			details.isSymbolicLink(),
			false,
			`staged artifact must not retain symlink ${path}`,
		);
		if (details.isDirectory()) await assertNoSymlinks(path);
	}
}

function readForegroundReadiness(child) {
	return new Promise((resolve, reject) => {
		let output = '';
		let errors = '';
		const timeout = setTimeout(
			() =>
				reject(
					new Error(`packed foreground server did not become ready: ${output}`),
				),
			15_000,
		);
		const onExit = (code) => {
			clearTimeout(timeout);
			reject(
				new Error(
					`packed foreground server exited before readiness (${code}): ${output}${errors}`,
				),
			);
		};
		child.once('exit', onExit);
		child.stderr.on('data', (chunk) => {
			errors += chunk;
		});
		child.stdout.on('data', (chunk) => {
			output += chunk;
			const lineEnd = output.indexOf('\n');
			if (lineEnd === -1) return;
			clearTimeout(timeout);
			child.off('exit', onExit);
			try {
				resolve(JSON.parse(output.slice(0, lineEnd)));
			} catch (error) {
				reject(error);
			}
		});
	});
}

function stopForeground(child) {
	if (child.exitCode !== null || child.signalCode !== null)
		return Promise.resolve();
	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			child.kill('SIGKILL');
			resolve();
		}, 10_000);
		child.once('exit', () => {
			clearTimeout(timeout);
			resolve();
		});
		child.kill('SIGTERM');
	});
}
