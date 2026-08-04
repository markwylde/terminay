import { createHash } from 'node:crypto';
import {
	access,
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import {
	getPtyRuntimePlatform,
	PTY_RUNTIME_NODE_PTY_VERSION,
	PTY_RUNTIME_NODE_VERSION,
} from './pty-runtime-platforms.mjs';

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const target = requireArg(args, 'target');
const platform = getPtyRuntimePlatform(target);
const outputDirectory = resolve(args['output-dir'] ?? 'artifacts/pty-runtime');
const nodePtyRoot = resolve(args['node-pty-root'] ?? 'node_modules/node-pty');
const electronDist = resolve(args['electron-dist'] ?? 'dist-electron');

if (process.platform !== 'linux') {
	throw new Error(
		'Deterministic PTY runtime archives are assembled on Linux because the builder requires GNU tar.',
	);
}
if (process.arch !== platform.architecture) {
	throw new Error(
		`The ${target} artifact must be assembled on native ${platform.architecture}; this runner is ${process.arch}.`,
	);
}

const tempDirectory = await mkdtemp(
	join(tmpdir(), 'terminay-pty-runtime-build-'),
);
try {
	const nodeArchive =
		args['node-archive'] !== undefined
			? resolve(args['node-archive'])
			: await downloadPinnedNodeArchive(tempDirectory, platform);
	await assertSha256(
		nodeArchive,
		platform.nodeArchiveSha256,
		'pinned Node archive',
	);

	const nodeSource = join(tempDirectory, 'node-source');
	await mkdir(nodeSource);
	await execFileAsync('tar', [
		'-xJf',
		nodeArchive,
		'--strip-components=1',
		'-C',
		nodeSource,
	]);

	const nodeBinary = join(nodeSource, 'bin', 'node');
	const nativePty = join(nodePtyRoot, 'build', 'Release', 'pty.node');
	await assertElfArchitecture(nodeBinary, platform.elfMachine, 'Node runtime');
	await assertElfArchitecture(nativePty, platform.elfMachine, 'node-pty addon');

	const nodePtyPackage = JSON.parse(
		await readFile(join(nodePtyRoot, 'package.json'), 'utf8'),
	);
	if (nodePtyPackage.version !== PTY_RUNTIME_NODE_PTY_VERSION) {
		throw new Error(
			`Expected node-pty ${PTY_RUNTIME_NODE_PTY_VERSION}, received ${nodePtyPackage.version}.`,
		);
	}

	const rootName = `terminay-pty-runtime-node${PTY_RUNTIME_NODE_VERSION}-${target}`;
	const stagingParent = join(tempDirectory, 'staging');
	const artifactRoot = join(stagingParent, rootName);
	await mkdir(join(artifactRoot, 'bin'), { recursive: true });
	await mkdir(join(artifactRoot, 'lib'), { recursive: true });
	await mkdir(
		join(artifactRoot, 'node_modules', 'node-pty', 'build', 'Release'),
		{
			recursive: true,
		},
	);

	await cp(nodeBinary, join(artifactRoot, 'bin', 'node'));
	await cp(join(nodeSource, 'LICENSE'), join(artifactRoot, 'NODE-LICENSE'));
	await copyHostModuleGraph(
		join(electronDist, 'ptyHost.js'),
		electronDist,
		join(artifactRoot, 'lib'),
	);
	await cp(
		join(nodePtyRoot, 'lib'),
		join(artifactRoot, 'node_modules', 'node-pty', 'lib'),
		{ recursive: true },
	);
	await cp(
		join(nodePtyRoot, 'package.json'),
		join(artifactRoot, 'node_modules', 'node-pty', 'package.json'),
	);
	await cp(
		join(nodePtyRoot, 'LICENSE'),
		join(artifactRoot, 'node_modules', 'node-pty', 'LICENSE'),
	);
	await cp(
		nativePty,
		join(
			artifactRoot,
			'node_modules',
			'node-pty',
			'build',
			'Release',
			'pty.node',
		),
	);
	await writeFile(
		join(artifactRoot, 'package.json'),
		`${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
	);

	await normalizeModes(artifactRoot);
	await chmod(join(artifactRoot, 'bin', 'node'), 0o755);

	const manifest = {
		schemaVersion: 1,
		target,
		node: {
			version: PTY_RUNTIME_NODE_VERSION,
			archive: basename(platform.nodeArchive),
			archiveSha256: platform.nodeArchiveSha256,
		},
		nodePty: {
			version: nodePtyPackage.version,
			nativePath: 'node_modules/node-pty/build/Release/pty.node',
			spawnHelper: {
				path: null,
				required: platform.spawnHelperRequired,
				reason:
					'node-pty uses forkpty on Linux; binding.gyp builds spawn-helper only for macOS.',
			},
		},
		hostEntry: 'lib/ptyHost.js',
		knownLimitations: [
			'This slice proves a PTY runtime payload, not the complete terminay-server executable.',
			'glibc compatibility is constrained by the native build runner and requires clean-host release testing.',
		],
		files: await describeFiles(artifactRoot),
	};
	await writeFile(
		join(artifactRoot, 'manifest.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	await normalizeModes(artifactRoot);
	await chmod(join(artifactRoot, 'bin', 'node'), 0o755);

	await mkdir(outputDirectory, { recursive: true });
	const tarPath = join(outputDirectory, `${rootName}.tar`);
	const archivePath = `${tarPath}.gz`;
	await rm(tarPath, { force: true });
	await rm(archivePath, { force: true });
	await execFileAsync('tar', [
		'--format=gnu',
		'--sort=name',
		'--mtime=@0',
		'--owner=0',
		'--group=0',
		'--numeric-owner',
		'-cf',
		tarPath,
		'-C',
		stagingParent,
		rootName,
	]);
	await execFileAsync('gzip', ['-n', '-9', tarPath]);

	const archiveSha256 = await sha256File(archivePath);
	process.stdout.write(
		`${JSON.stringify(
			{
				archivePath,
				archiveSha256,
				nodeVersion: PTY_RUNTIME_NODE_VERSION,
				nodePtyVersion: nodePtyPackage.version,
				target,
			},
			null,
			2,
		)}\n`,
	);
} finally {
	await rm(tempDirectory, { force: true, recursive: true });
}

async function downloadPinnedNodeArchive(tempDirectory, platformConfig) {
	const destination = join(tempDirectory, basename(platformConfig.nodeArchive));
	const response = await fetch(platformConfig.nodeArchive);
	if (!response.ok || response.body === null) {
		throw new Error(
			`Unable to download pinned Node runtime: HTTP ${response.status}.`,
		);
	}
	await pipeline(
		Readable.fromWeb(response.body),
		await importWriteStream(destination),
	);
	return destination;
}

async function importWriteStream(path) {
	const { createWriteStream } = await import('node:fs');
	return createWriteStream(path, { flags: 'wx' });
}

async function copyHostModuleGraph(
	entryPath,
	sourceRoot,
	destinationRoot,
	seen = new Set(),
) {
	const absoluteEntry = resolve(entryPath);
	const relativeEntry = relative(sourceRoot, absoluteEntry);
	if (
		relativeEntry.startsWith(`..${sep}`) ||
		relativeEntry === '..' ||
		relativeEntry.startsWith(sep)
	) {
		throw new Error(`Host import escapes dist-electron: ${absoluteEntry}`);
	}
	if (seen.has(absoluteEntry)) {
		return;
	}
	seen.add(absoluteEntry);

	const source = await readFile(absoluteEntry, 'utf8');
	const destination = join(destinationRoot, relativeEntry);
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, source);

	const importPattern = /(?:from\s+|import\s*)["'](\.\/[^"']+)["']/g;
	for (const match of source.matchAll(importPattern)) {
		await copyHostModuleGraph(
			resolve(dirname(absoluteEntry), match[1]),
			sourceRoot,
			destinationRoot,
			seen,
		);
	}
}

async function assertElfArchitecture(path, expectedMachine, label) {
	await access(path);
	const bytes = await readFile(path);
	if (
		bytes.length < 20 ||
		bytes[0] !== 0x7f ||
		bytes[1] !== 0x45 ||
		bytes[2] !== 0x4c ||
		bytes[3] !== 0x46
	) {
		throw new Error(`${label} is not an ELF binary: ${path}`);
	}
	const littleEndian = bytes[5] === 1;
	const machine = littleEndian
		? bytes.readUInt16LE(18)
		: bytes.readUInt16BE(18);
	if (machine !== expectedMachine) {
		throw new Error(
			`${label} ELF machine is ${machine}; expected ${expectedMachine} for ${target}.`,
		);
	}
}

async function normalizeModes(root) {
	for (const path of await walk(root)) {
		const details = await stat(path);
		await chmod(path, details.isDirectory() ? 0o755 : 0o644);
	}
}

async function describeFiles(root) {
	const files = [];
	for (const path of await walk(root)) {
		const details = await stat(path);
		if (!details.isFile()) {
			continue;
		}
		files.push({
			path: relative(root, path).split(sep).join('/'),
			mode: (details.mode & 0o777).toString(8).padStart(3, '0'),
			size: details.size,
			sha256: await sha256File(path),
		});
	}
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function walk(root) {
	const paths = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		paths.push(path);
		if (entry.isDirectory()) {
			paths.push(...(await walk(path)));
		}
	}
	return paths;
}

async function assertSha256(path, expected, label) {
	const actual = await sha256File(path);
	if (actual !== expected) {
		throw new Error(`${label} SHA-256 is ${actual}; expected ${expected}.`);
	}
}

async function sha256File(path) {
	const hash = createHash('sha256');
	hash.update(await readFile(path));
	return hash.digest('hex');
}

function parseArgs(values) {
	const parsed = {};
	for (let index = 0; index < values.length; index += 2) {
		const key = values[index];
		const value = values[index + 1];
		if (!key?.startsWith('--') || value === undefined) {
			throw new Error(
				`Expected --name value arguments, received ${values.join(' ')}.`,
			);
		}
		parsed[key.slice(2)] = value;
	}
	return parsed;
}

function requireArg(parsed, name) {
	const value = parsed[name];
	if (!value) {
		throw new Error(`Missing required --${name} argument.`);
	}
	return value;
}
