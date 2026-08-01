#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
	assertElfArchitecture,
	assertSha256,
	createDeterministicTarGz,
	describeArtifactFiles,
	normalizeArtifactModes,
	sha256File,
	walkRegularTree,
} from './artifact-determinism.mjs';
import {
	getPtyRuntimePlatform,
	PTY_RUNTIME_NODE_VERSION,
} from './pty-runtime-platforms.mjs';
import { stageProductionDependencyClosure } from './standalone-runtime-dependencies.mjs';

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const target = required(args, 'target');
const platform = getPtyRuntimePlatform(target);
const nodeArchive = resolve(required(args, 'node-archive'));
const runtimeModules = resolve(required(args, 'runtime-modules'));
const outputDirectory = resolve(required(args, 'output-dir'));
const serverRoot = resolve(args['server-root'] ?? 'apps/terminay-server');
const uiBundle = resolve(args['ui-bundle'] ?? 'dist');
const serverCoreRoot = resolve(
	args['server-core-root'] ?? 'packages/server-core',
);
const protocolRoot = resolve(args['protocol-root'] ?? 'packages/protocol');
const webrtcRuntime = resolve(required(args, 'webrtc-runtime'));

if (process.platform !== 'linux')
	throw new Error(
		'Standalone server archives must be assembled on native Linux release runners.',
	);
if (process.arch !== platform.architecture)
	throw new Error(
		`${target} requires native ${platform.architecture}; this runner is ${process.arch}.`,
	);

const temporary = await mkdtemp(join(tmpdir(), 'terminay-standalone-server-'));
try {
	await assertSha256(
		nodeArchive,
		platform.nodeArchiveSha256,
		'pinned Node archive',
	);
	await assertSafeTree(serverRoot, 'server runtime');
	await assertSafeTree(serverCoreRoot, 'server core runtime');
	await assertSafeTree(protocolRoot, 'protocol runtime');
	await assertSafeTree(uiBundle, 'web UI bundle');
	await assertSafeTree(webrtcRuntime, 'selected WebRTC runtime');

	const nodeSource = join(temporary, 'node-source');
	await mkdir(nodeSource);
	await execFileAsync('tar', [
		'-xJf',
		nodeArchive,
		'--strip-components=1',
		'-C',
		nodeSource,
	]);
	const nodeBinary = join(nodeSource, 'bin', 'node');
	const nativePty = join(
		runtimeModules,
		'node-pty',
		'build',
		'Release',
		'pty.node',
	);
	await assertElfArchitecture(nodeBinary, platform.elfMachine, 'bundled Node');
	await assertElfArchitecture(
		nativePty,
		platform.elfMachine,
		'bundled node-pty',
	);

	const serverPackage = JSON.parse(
		await readFile(join(serverRoot, 'package.json'), 'utf8'),
	);
	if (
		serverPackage.name !== '@terminay/server' ||
		serverPackage.engines?.node !== PTY_RUNTIME_NODE_VERSION
	)
		throw new Error('server package metadata is not release-compatible');
	const nodePtyPackage = JSON.parse(
		await readFile(join(runtimeModules, 'node-pty', 'package.json'), 'utf8'),
	);
	if (nodePtyPackage.version !== '1.1.0')
		throw new Error(
			`expected node-pty 1.1.0, received ${nodePtyPackage.version}`,
		);

	const rootName = `terminay-server-node${PTY_RUNTIME_NODE_VERSION}-${target}`;
	const stagingParent = join(temporary, 'staging');
	const root = join(stagingParent, rootName);
	await mkdir(join(root, 'bin'), { recursive: true });
	await cp(nodeBinary, join(root, 'bin', 'node'));
	await cp(join(nodeSource, 'LICENSE'), join(root, 'NODE-LICENSE'));
	await stageCompiledWorkspacePackage(serverRoot, join(root, 'server'));
	const compiledWorkspaceRoot = join(temporary, 'compiled-workspaces');
	const compiledServerCore = join(compiledWorkspaceRoot, 'server-core');
	const compiledProtocol = join(compiledWorkspaceRoot, 'protocol');
	await stageCompiledWorkspacePackage(serverCoreRoot, compiledServerCore);
	await stageCompiledWorkspacePackage(protocolRoot, compiledProtocol);
	const productionDependencies = await stageProductionDependencyClosure({
		destinationModules: join(root, 'node_modules'),
		runtimeModules,
		workspacePackages: {
			'@terminay/server-core': compiledServerCore,
			'@terminay/protocol': compiledProtocol,
		},
		rootPackages: Object.keys(serverPackage.dependencies ?? {}),
	});
	await cp(uiBundle, join(root, 'ui'), { recursive: true, dereference: false });
	await cp(webrtcRuntime, join(root, 'webrtc-runtime'), {
		recursive: true,
		dereference: false,
	});
	await writeLaunchers(root);
	await assertSafeTree(root, 'staged artifact');
	await assertNoElectron(root);
	await normalizeArtifactModes(
		root,
		new Set([
			join(root, 'bin', 'node'),
			join(root, 'bin', 'terminay-server'),
			join(root, 'bin', 'terminay-mcp'),
		]),
	);

	const manifest = {
		schemaVersion: 1,
		artifact: 'terminay-server',
		target,
		node: {
			version: PTY_RUNTIME_NODE_VERSION,
			archive: basename(nodeArchive),
			archiveSha256: platform.nodeArchiveSha256,
		},
		nodePty: {
			version: nodePtyPackage.version,
			nativePath: 'node_modules/node-pty/build/Release/pty.node',
		},
		entrypoints: { mcp: 'bin/terminay-mcp', server: 'bin/terminay-server' },
		webrtcRuntime: {
			root: 'webrtc-runtime',
			selection: JSON.parse(
				await readFile(join(webrtcRuntime, 'selection.json'), 'utf8'),
			),
		},
		dependencies: productionDependencies,
		files: await describeArtifactFiles(root),
	};
	await writeFile(
		join(root, 'artifact-manifest.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	await normalizeArtifactModes(
		root,
		new Set([
			join(root, 'bin', 'node'),
			join(root, 'bin', 'terminay-server'),
			join(root, 'bin', 'terminay-mcp'),
		]),
	);
	await mkdir(outputDirectory, { recursive: true });
	const archivePath = await createDeterministicTarGz({
		archivePath: join(outputDirectory, `${rootName}.tar.gz`),
		rootName,
		stagingDirectory: stagingParent,
	});
	process.stdout.write(
		`${JSON.stringify({ archivePath, archiveSha256: await sha256File(archivePath), target }, null, 2)}\n`,
	);
} finally {
	await rm(temporary, { force: true, recursive: true });
}

async function writeLaunchers(root) {
	const server =
		'#!/bin/sh\nset -eu\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\n' +
		': "$' +
		'{TERMINAY_UI_BUNDLE:=$ROOT/ui}"\n: "$' +
		'{TERMINAY_WEBRTC_RUNTIME_ROOT:=$ROOT/webrtc-runtime}"\n' +
		'export TERMINAY_UI_BUNDLE TERMINAY_WEBRTC_RUNTIME_ROOT\nexec "$ROOT/bin/node" "$ROOT/server/dist/cli.js" "$@"\n';
	const mcp =
		'#!/bin/sh\nset -eu\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexec "$ROOT/bin/node" "$ROOT/server/dist/mcpEntry.js" "$@"\n';
	await writeFile(join(root, 'bin', 'terminay-server'), server, {
		mode: 0o755,
	});
	await writeFile(join(root, 'bin', 'terminay-mcp'), mcp, { mode: 0o755 });
}

async function stageCompiledWorkspacePackage(sourceRoot, destination) {
	const packageJson = join(sourceRoot, 'package.json');
	const dist = join(sourceRoot, 'dist');
	await mkdir(destination, { recursive: true });
	await cp(packageJson, join(destination, 'package.json'));
	await cp(dist, join(destination, 'dist'), {
		recursive: true,
		dereference: true,
	});
}

async function assertSafeTree(root, label) {
	try {
		await walkRegularTree(root);
	} catch (error) {
		throw new Error(
			`${label} is unsafe: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function assertNoElectron(root) {
	for (const entry of await walkRegularTree(root)) {
		if (entry.kind !== 'file' || !/\.(?:[cm]?js|json)$/u.test(entry.path))
			continue;
		const content = await readFile(entry.path, 'utf8').catch(() => '');
		if (
			/(?:from\s+|import\s*\()["']electron["']|require\(["']electron["']\)/u.test(
				content,
			)
		)
			throw new Error(`staged artifact imports Electron: ${entry.path}`);
	}
}

function parseArgs(values) {
	const parsed = {};
	for (let index = 0; index < values.length; index += 2) {
		const key = values[index];
		const value = values[index + 1];
		if (!key?.startsWith('--') || value === undefined)
			throw new Error('expected --name value arguments');
		parsed[key.slice(2)] = value;
	}
	return parsed;
}
function required(args, name) {
	if (!args[name]) throw new Error(`missing required --${name}`);
	return args[name];
}
