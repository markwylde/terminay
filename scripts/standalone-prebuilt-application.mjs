// A stamp can only be produced by this wrapper after a successful synchronous
// application build. The archive consumer checks its revision, source and output
// bytes before using it. No command stamps arbitrary existing build outputs.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STAMP = 'build/standalone-application.v1.json';
const ignored = new Set(['node_modules', '.git', '.turbo', '.vite', 'dist', 'dist-web', 'dist-electron', 'build', 'release', 'test-results', 'playwright-report']);
const sourceRoots = ['src', 'electron', 'packages', 'apps', 'extensions', 'scripts', 'public', 'docker'];
const outputRoots = ['dist-web', 'dist-electron', 'dist', 'build/built-in-extensions', 'node_modules/node-pty/build/Release'];

function digestTree(root, paths, source = false) {
	const hash = createHash('sha256');
	let count = 0;
	const visit = (path) => {
		const full = join(root, path);
		const stat = lstatSync(full);
		if (stat.isSymbolicLink()) throw new Error(`build provenance refuses symlink: ${path}`);
		if (stat.isDirectory()) {
			for (const name of readdirSync(full).sort()) {
				if (source && (ignored.has(name) || name.endsWith('.tsbuildinfo'))) continue;
				visit(`${path}/${name}`);
			}
		} else if (stat.isFile()) {
			hash.update(path).update('\0').update(String(stat.mode & 0o777)).update('\0').update(readFileSync(full)).update('\0');
			count += 1;
		} else throw new Error(`unsupported build input: ${path}`);
	};
	for (const path of paths.sort()) visit(path);
	if (!count) throw new Error('empty application provenance');
	return hash.digest('hex');
}

function sourceDigest(root) {
	const roots = [...sourceRoots, ...readdirSync(root).filter((name) => /^(?:package(?:-lock)?\.json|tsconfig.*\.json|vite.*\.ts|.*\.html|turbo\.json)$/u.test(name))];
	return digestTree(root, roots, true);
}

function outputDigest(root) {
	const roots = [...outputRoots];
	for (const parent of ['apps', 'packages', 'extensions']) {
		for (const name of readdirSync(join(root, parent)).sort()) {
			try {
				if (lstatSync(join(root, parent, name, 'dist')).isDirectory()) roots.push(`${parent}/${name}/dist`);
			} catch (error) {
				if (error.code !== 'ENOENT') throw error;
			}
		}
	}
	return digestTree(root, roots);
}

function identity(revision, target) {
	if (!/^[a-f0-9]{40}$/u.test(revision)) throw new Error('prebuilt application requires a full commit SHA');
	if (!['linux-x64', 'linux-arm64'].includes(target) || target !== `linux-${process.arch}` || process.platform !== 'linux')
		throw new Error(`prebuilt application target ${target} does not match the native build host`);
	return { version: 1, revision, target, node: process.version };
}

export function buildVerifiedApplication({ root = process.cwd(), revision, target, runBuild } = {}) {
	const metadata = identity(revision, target);
	const stamp = join(root, STAMP);
	rmSync(stamp, { force: true }); // A failed build must never leave a reusable stamp.
	const sources = sourceDigest(root);
	if (runBuild) runBuild();
	else {
		const result = spawnSync('npm', ['run', 'build:app'], { cwd: root, stdio: 'inherit', timeout: 600_000 });
		if (result.status !== 0) throw new Error(`application build failed: ${result.error?.message ?? result.status ?? result.signal}`);
	}
	if (sourceDigest(root) !== sources) throw new Error('application sources changed while building');
	const outputs = outputDigest(root);
	mkdirSync(join(root, 'build'), { recursive: true });
	writeFileSync(stamp, `${JSON.stringify({ ...metadata, sources, outputs }, null, 2)}\n`);
}

export function verifyPrebuiltApplication({ root = process.cwd(), revision, target } = {}) {
	const expected = identity(revision, target);
	const stamp = JSON.parse(readFileSync(join(root, STAMP), 'utf8'));
	for (const [key, value] of Object.entries(expected)) {
		if (stamp[key] !== value) throw new Error(`prebuilt application ${key} mismatch`);
	}
	if (sourceDigest(root) !== stamp.sources) throw new Error('prebuilt application source mismatch');
	if (outputDigest(root) !== stamp.outputs) throw new Error('prebuilt application output mismatch');
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const [command, target, revision] = process.argv.slice(2);
	if (command === 'build') buildVerifiedApplication({ target, revision });
	else if (command === 'verify') verifyPrebuiltApplication({ target, revision });
	else throw new Error('usage: standalone-prebuilt-application.mjs <build|verify> <linux-x64|linux-arm64> <full-commit-sha>');
}
