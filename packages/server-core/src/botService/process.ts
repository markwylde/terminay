import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export interface EngineCallOptions {
	readonly onBuildEvent?: (event: Record<string, unknown>) => void;
	readonly deadlineMs?: number;
	readonly signal?: AbortSignal;
	readonly input?: string | Buffer;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly cwd?: string;
	readonly maxBytes?: number;
	readonly tail?: boolean;
	readonly onOutput?: (chunk: string, source?: 'stdout' | 'stderr') => void;
}

export class EngineCommandError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'EngineCommandError';
	}
}

type SpawnedProcess = ReturnType<typeof spawn>;
/** A child spawned with all three standard streams piped, so none is null. */
export type PipedProcess = SpawnedProcess & {
	readonly stdin: NonNullable<SpawnedProcess['stdin']>;
	readonly stdout: NonNullable<SpawnedProcess['stdout']>;
	readonly stderr: NonNullable<SpawnedProcess['stderr']>;
};

/** Where Docker, Podman and their helpers install. An app started from the
 * Dock or Finder inherits launchd's `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`),
 * which holds none of them. */
export function engineSearchPath(
	current: string | undefined,
	home: string | undefined,
	platform: NodeJS.Platform = process.platform,
): string {
	const common = [
		'/opt/podman/bin',
		'/opt/homebrew/bin',
		'/usr/local/bin',
		...(platform === 'darwin'
			? ['/Applications/Docker.app/Contents/Resources/bin']
			: []),
		...(home
			? [
					join(home, 'bin'),
					join(home, '.local', 'bin'),
					join(home, '.docker', 'bin'),
					join(home, '.rd', 'bin'),
				]
			: []),
		'/usr/bin',
		'/bin',
		'/usr/sbin',
		'/sbin',
	];
	// The inherited entries keep their precedence; the common ones only fill gaps.
	const entries = [...(current ?? '').split(delimiter), ...common].filter(
		Boolean,
	);
	return [...new Set(entries)].join(delimiter);
}

/** The server's environment, with a `PATH` that finds the engine CLIs. */
export function engineEnvironment(
	env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	return { ...env, PATH: engineSearchPath(env.PATH, env.HOME ?? homedir()) };
}

/** No shell, no argument interpolation, bounded output, and an absolute deadline.
 * Errors deliberately omit argv, environment and engine diagnostics. */
export class EngineProcess {
	/** Without `env`, each call reads the server's environment as it is then. */
	constructor(private readonly fixedEnv?: NodeJS.ProcessEnv) {}
	get env(): NodeJS.ProcessEnv {
		return this.fixedEnv ?? engineEnvironment(process.env);
	}

	stream(
		executable: string,
		args: readonly string[],
		options: EngineCallOptions = {},
	): PipedProcess {
		return spawn(executable, [...args], {
			cwd: options.cwd,
			env: { ...this.env, ...options.env },
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
			signal: options.signal,
		}) as PipedProcess;
	}

	run(
		executable: string,
		args: readonly string[],
		options: EngineCallOptions = {},
	): Promise<string> {
		const deadlineMs = options.deadlineMs ?? 30_000;
		const maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
		if (
			!Number.isSafeInteger(deadlineMs) ||
			deadlineMs <= 0 ||
			!Number.isSafeInteger(maxBytes) ||
			maxBytes <= 0
		)
			throw new RangeError('invalid engine call bounds');
		return new Promise((resolve, reject) => {
			const child = this.stream(executable, args, options);
			let output = Buffer.alloc(0);
			let stderr = '';
			const stdoutDecoder = new StringDecoder('utf8');
			const stderrDecoder = new StringDecoder('utf8');
			let failure: Error | undefined;
			const stop = (error: Error) => {
				failure ??= error;
				child.kill('SIGKILL');
			};
			const timer = setTimeout(
				() =>
					stop(
						new EngineCommandError(
							'deadline',
							'engine command deadline exceeded',
						),
					),
				deadlineMs,
			);
			child.stdout.on('data', (chunk: Buffer | string) => {
				options.onOutput?.(
					stdoutDecoder.write(
						Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
					),
					'stdout',
				);
				output = Buffer.concat([
					output,
					Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
				]);
				if (output.length > maxBytes) {
					if (options.tail) output = output.subarray(-maxBytes);
					else
						stop(
							new EngineCommandError(
								'output-limit',
								'engine output exceeded its limit',
							),
						);
				}
			});
			child.stderr.on('data', (chunk: Buffer | string) => {
				options.onOutput?.(
					stderrDecoder.write(
						Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
					),
					'stderr',
				);
				stderr = (stderr + chunk.toString()).slice(-8192);
			});
			child.stdin.on('error', () => {
				/* close supplies the engine failure */
			});
			child.once('error', (error: NodeJS.ErrnoException) => {
				clearTimeout(timer);
				reject(
					new EngineCommandError(
						error.code === 'ENOENT'
							? 'not-installed'
							: error.code === 'EACCES'
								? 'permission-denied'
								: 'not-running',
						'engine process unavailable',
					),
				);
			});
			child.once('close', (code) => {
				clearTimeout(timer);
				options.onOutput?.(stdoutDecoder.end(), 'stdout');
				options.onOutput?.(stderrDecoder.end(), 'stderr');
				if (failure) reject(failure);
				else if (code !== 0)
					reject(
						new EngineCommandError(
							/permission denied|access denied/i.test(stderr)
								? 'permission-denied'
								: /no such (object|container|volume|network|image)|not found|does not exist/i.test(
											stderr,
										)
									? 'not-found'
									: 'not-running',
							'engine command failed',
						),
					);
				else resolve(output.toString('utf8'));
			});
			child.stdin.end(options.input);
		});
	}
}
