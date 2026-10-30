/** Extension installer child process (ADR-0080). It runs npm's own package
 * libraries, never the npm program, so every package beneath them is an
 * ordinary repository dependency that overrides and the audit can reach. The
 * parent passes one JSON request as the only argument and validates the one
 * JSON result this writes to stdout. Sterility comes from the literal options
 * below: no npm config is loaded, so no `.npmrc`, token, or proxy applies. */
import { realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';

export type InstallerWorkerRequest =
	| { readonly op: 'resolve'; readonly spec: string; readonly cache: string }
	| {
			readonly op: 'lock';
			readonly root: string;
			readonly spec: string;
			readonly uploaded: boolean;
			readonly cache: string;
	  }
	| {
			readonly op: 'install';
			readonly root: string;
			readonly uploaded: boolean;
			readonly cache: string;
	  };

export type InstallerWorkerResult =
	| { readonly ok: true; readonly manifest?: Record<string, unknown> }
	| { readonly ok: false; readonly code: string };

interface Pacote {
	manifest(spec: string, options: object): Promise<Record<string, unknown>>;
}
interface ArboristTree {
	reify(options: object): Promise<unknown>;
}
type ArboristConstructor = new (options: object) => ArboristTree;

/** Every option the installer passes to npm's libraries. Anything absent
 * keeps the library default; nothing is read from config files or `npm_config_*`. */
export function installerLibraryOptions(
	cache: string,
	uploaded: boolean,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		registry: PUBLIC_REGISTRY,
		cache,
		userAgent: 'terminay-extension-installer',
		ignoreScripts: true,
		binLinks: false,
		omit: ['dev'],
		workspacesEnabled: false,
		audit: false,
		fund: false,
		allowGit: 'none',
		allowRemote: 'none',
		allowDirectory: 'none',
		// An uploaded archive is the root file dependency; nothing below it may
		// be a file.
		allowFile: uploaded ? 'root' : 'none',
	});
}

export async function runInstallerRequest(
	request: InstallerWorkerRequest,
	load: (id: string) => unknown = createRequire(import.meta.url),
): Promise<InstallerWorkerResult> {
	if (request.op === 'resolve') {
		const pacote = load('pacote') as Pacote;
		const manifest = await pacote.manifest(request.spec, {
			...installerLibraryOptions(request.cache, false),
			fullMetadata: true,
		});
		return { ok: true, manifest };
	}
	const Arborist = load('@npmcli/arborist') as ArboristConstructor;
	// Arborist compares the root against real paths; a root reached through a
	// symlink (macOS `/var`) otherwise locks itself as a link to elsewhere.
	const root = await realpath(request.root);
	const options = {
		...installerLibraryOptions(request.cache, request.uploaded),
		path: root,
	};
	if (request.op === 'lock') {
		await new Arborist(options).reify({
			...options,
			packageLockOnly: true,
			add: [request.uploaded ? await realpath(request.spec) : request.spec],
			save: true,
			saveType: 'prod',
			saveExact: true,
		});
		return { ok: true };
	}
	// Clean install from the validated lock, as `npm ci` does.
	await rm(join(root, 'node_modules'), {
		recursive: true,
		force: true,
	});
	await new Arborist(options).reify({ ...options, save: false });
	return { ok: true };
}

function errorCode(error: unknown): string {
	const code =
		typeof error === 'object' && error !== null && 'code' in error
			? String((error as { code: unknown }).code)
			: 'unknown';
	return /^[A-Za-z0-9_]{1,64}$/u.test(code) ? code : 'unknown';
}

async function main(): Promise<void> {
	let result: InstallerWorkerResult;
	try {
		result = await runInstallerRequest(
			JSON.parse(process.argv[2] ?? '') as InstallerWorkerRequest,
		);
	} catch (error) {
		result = { ok: false, code: errorCode(error) };
	}
	process.stdout.write(JSON.stringify(result));
	process.exitCode = result.ok ? 0 : 1;
}

if (process.env.TERMINAY_INSTALLER_WORKER === '1') void main();
