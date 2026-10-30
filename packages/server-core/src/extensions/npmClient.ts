import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type {
	ExtensionMaterializer,
	ExtensionRegistryClient,
	RegistryPackageResolution,
} from './installerTypes.js';
import type {
	InstallerWorkerRequest,
	InstallerWorkerResult,
} from './installerWorker.js';
import { validateNpmLockfile } from './packageValidation.js';

const executeFile = promisify(execFile);
const WORKER_DEADLINE_MS = 120_000;
const PACKAGE =
	/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;
const SELECTOR =
	/^(?:latest|next|beta|\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?|[~^><= *|.\dA-Za-z-]+)$/u;

export function parsePublicNpmSpec(input: string): {
	packageName: string;
	selector: string;
} {
	const value = input.trim();
	if (
		value.length === 0 ||
		value.length > 300 ||
		/^(?:git|https?|file|link|npm):/iu.test(value) ||
		value.includes('\\')
	)
		throw new TypeError('only public npmjs package names are supported');
	const separator = value.startsWith('@')
		? value.indexOf('@', 1)
		: value.indexOf('@');
	const packageName = separator < 0 ? value : value.slice(0, separator);
	const selector = separator < 0 ? 'latest' : value.slice(separator + 1);
	if (
		!PACKAGE.test(packageName) ||
		!SELECTOR.test(selector) ||
		selector.length === 0
	)
		throw new TypeError('invalid public npm package specification');
	return { packageName, selector };
}

export type InstallerWorkerRunner = (
	request: InstallerWorkerRequest,
	options: {
		readonly cwd: string;
		readonly signal?: AbortSignal;
		readonly env: NodeJS.ProcessEnv;
	},
) => Promise<InstallerWorkerResult>;
export interface NpmRegistryClientOptions {
	readonly workRoot: string;
	/** The installer worker script. Desktop passes its bundled entry. */
	readonly workerEntrypoint?: string;
	readonly installerVersion?: string;
	readonly runner?: InstallerWorkerRunner;
	/** Injected only so tests need not wait for the production deadline. */
	readonly workerDeadlineMs?: number;
}

export class NpmRegistryUnavailableError extends Error {
	readonly code = 'registry_unavailable';
	readonly retryable = true;
	readonly action = 'Check the Terminay Server network connection and retry.';
	constructor() {
		super('npmjs registry is unavailable');
		this.name = 'NpmRegistryUnavailableError';
	}
}

const NETWORK_FAILURES = new Set([
	'ENETUNREACH',
	'ENOTFOUND',
	'ECONNREFUSED',
	'ECONNRESET',
	'ETIMEDOUT',
	'EAI_AGAIN',
]);

/** The npm library versions the installer runs, recorded in every receipt. */
export function bundledInstallerVersion(): string {
	const load = createRequire(import.meta.url);
	const version = (id: string): string => {
		const value = (load(`${id}/package.json`) as { version?: unknown })
			.version;
		if (typeof value !== 'string')
			throw new Error(`installer library ${id} has no version`);
		return value;
	};
	return `arborist@${version('@npmcli/arborist')} pacote@${version('pacote')}`;
}

/** npmjs-only adapter. npm's package libraries run in a bounded child process
 * with a sterile home, cache, and environment, and never see registry
 * credentials, proxies, or user npm configuration. */
export class NpmRegistryClient
	implements ExtensionRegistryClient, ExtensionMaterializer
{
	private version: string | undefined;
	constructor(private readonly options: NpmRegistryClientOptions) {
		this.version = options.installerVersion;
	}

	get installerVersion(): string {
		this.version ??= bundledInstallerVersion();
		return this.version;
	}

	async resolve(
		packageName: string,
		selector: string,
		signal?: AbortSignal,
	): Promise<RegistryPackageResolution> {
		const cwd = join(this.options.workRoot, 'resolve');
		const result = await this.run(
			{ op: 'resolve', spec: `${packageName}@${selector}`, cache: this.cache },
			cwd,
			signal,
		);
		const metadata = result.manifest;
		const dist =
			typeof metadata?.dist === 'object' && metadata.dist !== null
				? (metadata.dist as Record<string, unknown>)
				: {};
		if (
			metadata === undefined ||
			metadata.name !== packageName ||
			typeof metadata.version !== 'string' ||
			typeof dist.integrity !== 'string'
		)
			throw new Error(
				'npm registry response is missing exact integrity metadata',
			);
		const repository = metadata.repository;
		return Object.freeze({
			packageName,
			version: metadata.version,
			integrity: dist.integrity,
			...(typeof dist.tarball === 'string'
				? { tarballUrl: dist.tarball }
				: {}),
			...(typeof repository === 'string'
				? { repository }
				: typeof repository === 'object' &&
						repository !== null &&
						typeof (repository as { url?: unknown }).url === 'string'
					? { repository: (repository as { url: string }).url }
					: {}),
			maintainers: Array.isArray(metadata.maintainers)
				? metadata.maintainers
						.map((value) =>
							typeof value === 'string'
								? value
								: String((value as { name?: unknown }).name ?? ''),
						)
						.filter(Boolean)
						.slice(0, 20)
				: [],
			dependencyCount:
				typeof metadata.dependencies === 'object' &&
				metadata.dependencies !== null
					? Object.keys(metadata.dependencies).length
					: 0,
			manifestMetadata: metadata.terminay,
			provenance: 'unavailable' as const,
		});
	}

	async materialize(
		resolution: RegistryPackageResolution,
		stagingRoot: string,
		signal?: AbortSignal,
	): Promise<void> {
		await mkdir(stagingRoot, { recursive: false });
		const uploaded = resolution.source === 'uploaded';
		const dependency = uploaded
			? requiredArchivePath(resolution)
			: resolution.version;
		await writeFile(
			join(stagingRoot, 'package.json'),
			`${JSON.stringify({ private: true, dependencies: { [resolution.packageName]: dependency } }, null, 2)}\n`,
			{ flag: 'wx' },
		);
		await this.run(
			{
				op: 'lock',
				root: stagingRoot,
				spec: uploaded
					? dependency
					: `${resolution.packageName}@${resolution.version}`,
				uploaded,
				cache: this.cache,
			},
			stagingRoot,
			signal,
		);
		let lockText: string;
		let lock: unknown;
		try {
			lockText = await readFile(join(stagingRoot, 'package-lock.json'), 'utf8');
			lock = JSON.parse(lockText);
		} catch {
			throw new Error('npm did not produce a valid exact lockfile');
		}
		validateNpmLockfile(lock, resolution);
		await this.run(
			{ op: 'install', root: stagingRoot, uploaded, cache: this.cache },
			stagingRoot,
			signal,
		);
		// The install materializes the validated lock; it must not re-resolve.
		const installed = await readFile(
			join(stagingRoot, 'package-lock.json'),
			'utf8',
		).catch(() => undefined);
		if (installed !== lockText)
			throw new Error('npm install changed the validated lockfile');
	}

	private get cache(): string {
		return join(this.options.workRoot, 'npm-runtime', 'cache');
	}

	private async run(
		request: InstallerWorkerRequest,
		cwd: string,
		signal?: AbortSignal,
	): Promise<Extract<InstallerWorkerResult, { ok: true }>> {
		await mkdir(cwd, { recursive: true });
		const sterile = join(this.options.workRoot, 'npm-runtime');
		for (const directory of ['home', 'cache', 'tmp'])
			await mkdir(join(sterile, directory), { recursive: true });
		// Nothing from the server's environment: no npm_config_*, proxy,
		// NODE_OPTIONS, or credentials reach the libraries.
		const env = {
			ELECTRON_RUN_AS_NODE: '1',
			NODE_ENV: 'production',
			HOME: join(sterile, 'home'),
			TMPDIR: join(sterile, 'tmp'),
			TERMINAY_INSTALLER_WORKER: '1',
		} as unknown as NodeJS.ProcessEnv;
		let result: InstallerWorkerResult;
		try {
			result =
				this.options.runner === undefined
					? await runWorker(
							this.options.workerEntrypoint ?? defaultWorkerEntrypoint(),
							request,
							{ cwd, env, ...(signal === undefined ? {} : { signal }) },
							this.options.workerDeadlineMs ?? WORKER_DEADLINE_MS,
						)
					: await this.options.runner(request, { cwd, signal, env });
		} catch (error) {
			result = { ok: false, code: errorCode(error) };
		}
		if (result.ok) return result;
		if (NETWORK_FAILURES.has(result.code))
			throw new NpmRegistryUnavailableError();
		throw new Error(`extension installer failed (${result.code})`);
	}
}

function defaultWorkerEntrypoint(): string {
	return fileURLToPath(new URL('./installerWorker.js', import.meta.url));
}

async function runWorker(
	entrypoint: string,
	request: InstallerWorkerRequest,
	options: {
		readonly cwd: string;
		readonly env: NodeJS.ProcessEnv;
		readonly signal?: AbortSignal;
	},
	deadlineMs: number,
): Promise<InstallerWorkerResult> {
	let stdout: string;
	try {
		({ stdout } = await executeFile(
			process.execPath,
			[entrypoint, JSON.stringify(request)],
			{
				...options,
				timeout: deadlineMs,
				killSignal: 'SIGKILL',
				maxBuffer: 2 * 1024 * 1024,
			},
		));
	} catch (error) {
		// A failed request still reports its code on stdout.
		const output =
			typeof error === 'object' && error !== null && 'stdout' in error
				? String((error as { stdout: unknown }).stdout)
				: '';
		const parsed = parseWorkerResult(output);
		if (parsed !== undefined && !parsed.ok) return parsed;
		throw error;
	}
	const parsed = parseWorkerResult(stdout);
	if (parsed === undefined)
		throw new Error('extension installer returned an invalid result');
	return parsed;
}

function parseWorkerResult(output: string): InstallerWorkerResult | undefined {
	try {
		const value = JSON.parse(output) as unknown;
		if (typeof value !== 'object' || value === null) return undefined;
		const result = value as { ok?: unknown; code?: unknown };
		if (result.ok === true) return value as InstallerWorkerResult;
		if (result.ok === false && typeof result.code === 'string')
			return value as InstallerWorkerResult;
	} catch {
		/* invalid output is reported by the caller */
	}
	return undefined;
}

function errorCode(error: unknown): string {
	if (typeof error !== 'object' || error === null) return 'unknown';
	if ('killed' in error && error.killed === true) return 'ETIMEDOUT_WORKER';
	return 'code' in error ? String(error.code) : 'unknown';
}

function requiredArchivePath(resolution: RegistryPackageResolution): string {
	if (
		typeof resolution.archivePath !== 'string' ||
		resolution.archivePath.length === 0
	)
		throw new Error('uploaded extension archive is unavailable');
	return resolution.archivePath;
}
