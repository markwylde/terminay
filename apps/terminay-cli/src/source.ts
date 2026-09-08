import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import { downloadAsset } from './download.js';
import { hostArchitecture } from './platform.js';
import { DEFAULT_REPOSITORY } from './resolve.js';

/**
 * Building a server archive on the target when the reference is a branch or a
 * commit rather than a release.
 *
 * There is no publisher for such a build, so there is no signature to check —
 * the operator asked for this exact commit and the machine built it locally,
 * which is a different trust story from a downloaded artifact rather than a
 * weaker one. The manifest is still verified when it is installed, so a build
 * that produced a broken tree is caught before it is activated.
 *
 * The toolchain is checked before anything is downloaded, because finding out
 * a compiler is missing after a shallow clone and a Node download wastes the
 * operator's time and bandwidth.
 */

const execFileAsync = promisify(execFile);

export const REQUIRED_TOOLS: readonly string[] = [
	'git',
	'python3',
	'make',
	'c++',
];
const BUILD_TIMEOUT_MS = 45 * 60 * 1000;

export class ToolchainError extends Error {}
export class SourceBuildError extends Error {}

async function which(tool: string, env?: NodeJS.ProcessEnv): Promise<boolean> {
	try {
		await execFileAsync('command', ['-v', tool], {
			timeout: 30_000,
			shell: '/bin/sh',
			...(env === undefined ? {} : { env }),
		});
		return true;
	} catch {
		return false;
	}
}

export async function preflightToolchain(
	tools: readonly string[] = REQUIRED_TOOLS,
	env?: NodeJS.ProcessEnv,
): Promise<void> {
	const missing: string[] = [];
	for (const tool of tools) {
		if (!(await which(tool, env))) missing.push(tool);
	}
	if (missing.length > 0) {
		throw new ToolchainError(
			`building from source needs ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not installed. Install ${missing.length === 1 ? 'it' : 'them'} (on Debian: apt install build-essential python3 git) or install a released version instead.`,
		);
	}
}

export interface SourceBuildOptions {
	readonly ref: string;
	readonly revision?: string;
	readonly repository?: string;
	readonly write?: (line: string) => void;
	readonly workingDirectory?: string;
	/** Where the finished archive is placed before the build tree is removed. */
	readonly destination?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly architecture?: 'x64' | 'arm64';
	readonly keepOnFailure?: boolean;
}

export interface SourceBuildResult {
	readonly archivePath: string;
	readonly revision: string;
	readonly buildDirectory: string;
}

async function run(
	command: string,
	args: readonly string[],
	cwd: string,
	env?: NodeJS.ProcessEnv,
): Promise<string> {
	const { stdout } = await execFileAsync(command, [...args], {
		cwd,
		timeout: BUILD_TIMEOUT_MS,
		maxBuffer: 64 * 1024 * 1024,
		...(env === undefined ? {} : { env }),
	});
	return stdout;
}

export async function buildFromSource(
	options: SourceBuildOptions,
): Promise<SourceBuildResult> {
	const write = options.write ?? (() => undefined);
	const env = options.env as NodeJS.ProcessEnv | undefined;
	const architecture = options.architecture ?? hostArchitecture();
	const target = `linux-${architecture}`;

	// Before any download: a missing compiler must not cost a clone.
	await preflightToolchain(REQUIRED_TOOLS, env);

	const parent = options.workingDirectory ?? tmpdir();
	const build = await mkdtemp(join(parent, 'terminay-source-build-'));
	let succeeded = false;
	try {
		const remote = `https://github.com/${options.repository ?? DEFAULT_REPOSITORY}.git`;
		write(`Cloning ${options.ref} …`);
		const checkout = join(build, 'source');
		// A commit cannot be cloned by branch, so it is fetched and checked out.
		if (options.revision !== undefined && /^[0-9a-f]{40}$/u.test(options.ref)) {
			await run('git', ['init', checkout], build, env);
			await run('git', ['remote', 'add', 'origin', remote], checkout, env);
			await run(
				'git',
				['fetch', '--depth', '1', 'origin', options.ref],
				checkout,
				env,
			);
			await run('git', ['checkout', '--detach', 'FETCH_HEAD'], checkout, env);
		} else {
			await run(
				'git',
				['clone', '--depth', '1', '--branch', options.ref, remote, checkout],
				build,
				env,
			);
		}
		const revision = (
			await run('git', ['rev-parse', 'HEAD'], checkout, env)
		).trim();

		write('Installing dependencies …');
		await run('npm', ['ci'], checkout, env);

		write('Compiling …');
		await run('npm', ['run', 'build:application-graph'], checkout, env);
		await run('npm', ['run', 'build:server-postcompile'], checkout, env);
		await run(
			'node',
			['scripts/stage-selected-secure-werift-runtime.mjs'],
			checkout,
			env,
		);

		write('Fetching the pinned Node runtime …');
		const nodeArchiveUrl = (
			await run(
				'node',
				[
					'-e',
					'import("./scripts/pty-runtime-platforms.mjs").then((m) => process.stdout.write(m.getPtyRuntimePlatform(process.argv[1]).nodeArchive))',
					target,
				],
				checkout,
				env,
			)
		).trim();
		// The builder re-verifies this archive's pinned digest, so a wrong or
		// tampered download fails there rather than being baked in.
		const nodeArchive = await downloadAsset(
			nodeArchiveUrl,
			build,
			'node-runtime.tar.xz',
		);

		write('Building the standalone archive …');
		const output = join(build, 'artifact');
		const built = await run(
			'node',
			[
				'scripts/build-standalone-server-artifact.mjs',
				'--target',
				target,
				'--channel',
				'source',
				'--revision',
				revision,
				'--node-archive',
				nodeArchive.path,
				'--runtime-modules',
				'node_modules',
				'--webrtc-runtime',
				'build/webrtc-runtime',
				'--output-dir',
				output,
			],
			checkout,
			env,
		);
		const archivePath = JSON.parse(built).archivePath as string;
		const produced = await readdir(output).catch(() => []);
		if (typeof archivePath !== 'string' || produced.length === 0) {
			throw new SourceBuildError('the source build produced no archive');
		}
		// Moved out of the build tree before that tree is removed, so the
		// caller has something to install from.
		const kept = join(options.destination ?? parent, basename(archivePath));
		await rm(kept, { force: true });
		await cp(archivePath, kept);
		succeeded = true;
		return Object.freeze({
			archivePath: kept,
			revision,
			buildDirectory: build,
		});
	} catch (error) {
		throw new SourceBuildError(
			`building ${options.ref} from source failed: ${error instanceof Error ? error.message : String(error)}. The build directory was kept at ${build}.`,
		);
	} finally {
		// Kept on failure so the operator can read the compiler's output.
		if (succeeded && options.keepOnFailure !== true)
			await rm(build, { recursive: true, force: true }).catch(() => undefined);
	}
}
