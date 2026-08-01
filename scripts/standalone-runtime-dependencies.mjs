import { cp, lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

function packagePath(root, packageName) {
	if (typeof packageName !== 'string' || !/^(?:@[-a-z0-9._]+\/)?[-a-z0-9._]+$/iu.test(packageName)) {
		throw new TypeError(`invalid package name: ${String(packageName)}`);
	}
	return join(root, ...packageName.split('/'));
}

async function regularDirectory(path, label) {
	const resolved = await realpath(path).catch(() => undefined);
	if (resolved === undefined) throw new Error(`${label} is missing: ${path}`);
	const details = await lstat(resolved);
	if (!details.isDirectory()) throw new Error(`${label} is not a directory: ${path}`);
	return resolved;
}

/**
 * Locate the exact package directory Node would resolve from a package. This
 * intentionally walks only node_modules ancestors, never the workspace root,
 * so a release payload cannot accidentally inherit a source package.
 */
async function resolveInstalledDependency(fromDirectory, runtimeModules, packageName) {
	const modulesRoot = await regularDirectory(runtimeModules, 'runtime modules');
	const modulesParent = dirname(modulesRoot);
	let cursor = await regularDirectory(fromDirectory, 'dependency parent');
	for (;;) {
		const candidate = packagePath(join(cursor, 'node_modules'), packageName);
		const resolved = await realpath(candidate).catch(() => undefined);
		if (resolved !== undefined) return regularDirectory(resolved, `dependency ${packageName}`);
		if (cursor === modulesParent) break;
		const parent = dirname(cursor);
		if (parent === cursor) break;
		cursor = parent;
	}
	const rootCandidate = packagePath(modulesRoot, packageName);
	return regularDirectory(rootCandidate, `dependency ${packageName}`);
}

async function packageManifest(directory) {
	const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
	if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
		throw new Error(`dependency package has no name: ${directory}`);
	}
	return manifest;
}

/**
 * Stage exactly the transitive production dependency closure for an artifact.
 * Workspace packages are supplied as compiled roots; external packages are
 * resolved from the installed runtime modules and copied with links
 * dereferenced. This produces an isolated node_modules tree without relying
 * on npm workspace symlinks or a host-level node_modules directory.
 */
export async function stageProductionDependencyClosure({
	destinationModules,
	runtimeModules,
	workspacePackages = {},
	rootPackages,
}) {
	if (!Array.isArray(rootPackages) || rootPackages.length === 0) {
		throw new TypeError('rootPackages must name at least one package');
	}
	const destination = resolve(destinationModules);
	const runtimeRoot = await regularDirectory(runtimeModules, 'runtime modules');
	await mkdir(destination, { recursive: true });
	const pending = [...new Set(rootPackages)]
		.sort()
		.map((name) => ({ name, fromDirectory: runtimeRoot }));
	const copied = new Set();
	while (pending.length > 0) {
		const { name: packageName, fromDirectory } = pending.shift();
		if (copied.has(packageName)) continue;
		const workspaceSource = workspacePackages[packageName];
		const source = workspaceSource === undefined
			? await resolveInstalledDependency(fromDirectory, runtimeRoot, packageName)
			: await regularDirectory(workspaceSource, `workspace dependency ${packageName}`);
		const manifest = await packageManifest(source);
		if (manifest.name !== packageName) {
			throw new Error(`dependency name mismatch: expected ${packageName}, received ${manifest.name}`);
		}
		const target = packagePath(destination, packageName);
		await cp(source, target, { recursive: true, dereference: true, force: true });
		copied.add(packageName);
		const dependencies = {
			...(manifest.dependencies ?? {}),
			...(manifest.optionalDependencies ?? {}),
		};
		for (const dependency of Object.keys(dependencies).sort()) {
			if (!copied.has(dependency)) pending.push({ name: dependency, fromDirectory: source });
		}
	}
	return Object.freeze([...copied].sort());
}

export function assertStagedPathInside(destinationModules, path) {
	const from = resolve(destinationModules);
	const relativePath = relative(from, resolve(path));
	if (relativePath === '..' || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
		throw new Error(`staged dependency escapes destination: ${path}`);
	}
}
