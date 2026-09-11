import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Which TypeScript a session ended up using, and where it came from. */
export interface ResolvedTypeScript {
	source: 'project' | 'bundled';
	/** Absolute path to `tsserver.js`. */
	tsserverPath: string;
	version: string;
	/** Bounded, safe text for Settings, e.g. `project typescript 5.6.2`. */
	description: string;
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function readVersion(packageJsonPath: string): string {
	try {
		const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			typeof (parsed as { version?: unknown }).version === 'string'
		)
			return (parsed as { version: string }).version;
	} catch {
		// A TypeScript whose package.json cannot be read still has a tsserver.
	}
	return 'unknown';
}

/**
 * The TypeScript bundled with this extension: its own production dependency,
 * resolved from this package's `node_modules`, never from the project or from
 * an ambient global install.
 */
export function bundledTypeScript(): ResolvedTypeScript {
	const packageJsonPath = require.resolve('typescript/package.json');
	const tsserverPath = join(packageJsonPath, '..', 'lib', 'tsserver.js');
	const version = readVersion(packageJsonPath);
	return {
		source: 'bundled',
		tsserverPath,
		version,
		description: `bundled typescript ${version}`,
	};
}

/**
 * The project's own TypeScript when it has one — `node_modules/typescript` in
 * the project root — and the bundled one otherwise. A project's TypeScript is
 * what its `tsconfig`, its build, and its editors already agree on, so it is
 * the one whose diagnostics are true for that project.
 */
export function resolveTypeScript(projectRoot: string): ResolvedTypeScript {
	if (!isAbsolute(projectRoot))
		throw new Error('projectRoot must be an absolute path');
	const projectTsserver = join(
		projectRoot,
		'node_modules',
		'typescript',
		'lib',
		'tsserver.js',
	);
	if (!isFile(projectTsserver)) return bundledTypeScript();
	const version = readVersion(
		join(projectRoot, 'node_modules', 'typescript', 'package.json'),
	);
	return {
		source: 'project',
		tsserverPath: projectTsserver,
		version,
		description: `project typescript ${version}`,
	};
}

/**
 * The `typescript-language-server` CLI shipped with this extension. It is
 * resolved from this package's own `node_modules`: the release closure packs
 * it, so a server never depends on one being installed on the machine.
 */
export function languageServerCliPath(): string {
	const packageJsonPath = require.resolve(
		'typescript-language-server/package.json',
	);
	const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	const bin = (parsed as { bin?: unknown }).bin;
	const relative =
		typeof bin === 'string'
			? bin
			: typeof bin === 'object' && bin !== null
				? (bin as Record<string, unknown>)['typescript-language-server']
				: undefined;
	if (typeof relative !== 'string')
		throw new Error('typescript-language-server declares no bin');
	const cliPath = join(packageJsonPath, '..', relative);
	if (!isFile(cliPath))
		throw new Error(`typescript-language-server bin is missing: ${cliPath}`);
	return cliPath;
}
