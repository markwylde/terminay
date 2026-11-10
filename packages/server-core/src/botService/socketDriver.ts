import { type Duplex, type Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { create as tar } from 'tar';
import type { EngineDetails, EngineDriver, EngineResource } from './engine.js';
import { type EngineCallOptions, EngineCommandError } from './process.js';
import {
	demultiplex,
	type EngineStream,
	SocketProcess,
	SocketTransport,
} from './socketTransport.js';

const enc = encodeURIComponent;
const query = (values: Record<string, unknown>) =>
	new URLSearchParams(
		Object.entries(values)
			.filter(([, v]) => v !== undefined)
			.map(([k, v]) => [
				k,
				typeof v === 'object' ? JSON.stringify(v) : String(v),
			]),
	).toString();

/** Parses only Terminay's private operation vocabulary. No text is ever passed
 * to a shell or executable. Unknown options fail closed. */
function createSpec(args: readonly string[]): {
	name?: string;
	body: Record<string, unknown>;
	remove: boolean;
} {
	const body: Record<string, unknown> = {
		AttachStdin: true,
		AttachStdout: true,
		AttachStderr: true,
		OpenStdin: true,
		StdinOnce: true,
	};
	const host: Record<string, unknown> = {};
	const labels: Record<string, string> = {};
	const env: string[] = [],
		mounts: unknown[] = [],
		groups: string[] = [],
		capDrop: string[] = [],
		extraHosts: string[] = [];
	let name: string | undefined,
		remove = false;
	for (let i = 0; i < args.length; i++) {
		const flag = args[i]!;
		if (!flag.startsWith('-')) {
			body.Image = flag;
			body.Cmd = args.slice(i + 1);
			break;
		}
		if (flag === '--rm') {
			remove = true;
			continue;
		}
		if (flag === '-i') continue;
		if (flag === '--read-only') {
			host.ReadonlyRootfs = true;
			continue;
		}
		const value = args[++i];
		if (value === undefined) throw new TypeError('engine option missing value');
		switch (flag) {
			case '--name':
				name = value;
				break;
			case '--label': {
				const n = value.indexOf('=');
				labels[value.slice(0, n)] = value.slice(n + 1);
				break;
			}
			case '--env':
				env.push(value);
				break;
			case '--entrypoint':
				body.Entrypoint = [value];
				break;
			case '--user':
				body.User = value;
				break;
			case '--network':
				host.NetworkMode = value;
				break;
			case '--cpus':
				host.NanoCpus = Number(value) * 1e9;
				break;
			case '--memory':
				host.Memory = Number(value);
				break;
			case '--pids-limit':
				host.PidsLimit = Number(value);
				break;
			case '--group-add':
				groups.push(value);
				break;
			case '--cap-drop':
				capDrop.push(value);
				break;
			case '--add-host':
				extraHosts.push(value);
				break;
			case '--userns':
				host.UsernsMode = value;
				break;
			case '--security-opt':
				host.SecurityOpt = [
					...((host.SecurityOpt as string[] | undefined) ?? []),
					value,
				];
				break;
			case '--pull':
				if (value !== 'never') throw new TypeError('unsupported pull policy');
				break;
			case '--mount': {
				const fields = Object.fromEntries(
					value.split(',').map((s) => {
						const n = s.indexOf('=');
						return n < 0 ? [s, true] : [s.slice(0, n), s.slice(n + 1)];
					}),
				);
				mounts.push({
					Type: fields.type,
					Source: fields.source,
					Target: fields.target,
					ReadOnly: fields.readonly === true,
				});
				break;
			}
			default:
				throw new TypeError('unsupported engine create option');
		}
	}
	if (!body.Image) throw new TypeError('engine image required');
	body.Env = env;
	body.Labels = labels;
	host.Mounts = mounts;
	host.GroupAdd = groups;
	host.CapDrop = capDrop;
	host.ExtraHosts = extraHosts;
	body.HostConfig = host;
	return { name, body, remove };
}

export class SocketDriver implements EngineDriver {
	constructor(
		public details: EngineDetails,
		readonly transport: SocketTransport,
	) {
		transport.expectedIdentity = details.pin.identity;
	}
	async leftover(name: string): Promise<string | undefined> {
		if (this.details.pin.kind !== 'podman') return undefined;
		// Podman lists storage with no container behind it only on request. The
		// name filter matches substrings, so the exact name is checked here.
		const listed = await this.transport.json<
			{ Id?: string; Names?: string[]; State?: string }[] | undefined
		>(
			'GET',
			`/v4.0.0/libpod/containers/json?${query({ all: true, external: true, filters: { name: [name] } })}`,
			undefined,
			// Listing storage can be slow where many build leftovers remain.
			{ deadlineMs: 20_000 },
		);
		const held = (listed ?? []).filter((entry) => entry.Names?.includes(name));
		const [only] = held;
		return held.length === 1 &&
			only?.State === 'storage' &&
			/^[0-9a-f]{64}$/.test(only.Id ?? '')
			? only.Id
			: undefined;
	}
	async inspect(
		kind: 'container' | 'volume' | 'network' | 'image',
		name: string,
	): Promise<EngineResource | undefined> {
		try {
			return await this.transport.json(
				'GET',
				`/${kind}s/${enc(name)}${kind === 'image' || kind === 'container' ? '/json' : ''}`,
			);
		} catch (error) {
			if (error instanceof EngineCommandError && error.code === 'not-found')
				return undefined;
			throw error;
		}
	}
	async json<T>(
		args: readonly string[],
		options?: EngineCallOptions,
	): Promise<T> {
		return JSON.parse(await this.run(args, options)) as T;
	}
	async run(
		args: readonly string[],
		options: EngineCallOptions = {},
	): Promise<string> {
		const [kind, action, ...rest] = args;
		if (kind === 'run') return this.collect(this.stream(args), options);
		if (kind === 'build') {
			let tag = '',
				directory = '';
			const buildargs: Record<string, string> = {};
			for (let i = 1; i < args.length; i++) {
				if (args[i] === '--tag') tag = args[++i]!;
				else if (args[i] === '--build-arg') {
					const value = args[++i]!;
					const n = value.indexOf('=');
					buildargs[value.slice(0, n)] = value.slice(n + 1);
				} else directory = args[i]!;
			}
			const archive = tar({ cwd: directory, portable: true, follow: false }, [
				'.',
			]);
			const response = await this.transport.open(
				'POST',
				`/build?${query({ t: tag, buildargs, rm: true })}`,
				undefined,
				{ ...options, deadlineMs: options.deadlineMs ?? 900_000 },
				false,
				archive as unknown as Readable,
			);
			const decoder = new StringDecoder('utf8');
			let buffer = '',
				tail = '';
			for await (const chunk of response) {
				buffer += decoder.write(
					Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
				);
				if (buffer.length > 1024 * 1024) {
					response.destroy();
					throw new EngineCommandError('output-limit', 'build frame too large');
				}
				let end = buffer.indexOf('\n');
				while (end >= 0) {
					const line = buffer.slice(0, end).trim();
					buffer = buffer.slice(end + 1);
					if (!line) {
						end = buffer.indexOf('\n');
						continue;
					}
					const event = JSON.parse(line) as {
						stream?: string;
						error?: string;
						errorDetail?: unknown;
					};
					options.onBuildEvent?.(event);
					if (event.error || event.errorDetail) {
						const detail = event.errorDetail as
							| { message?: unknown }
							| undefined;
						const message =
							event.error ??
							(typeof detail?.message === 'string'
								? detail.message
								: 'image build failed');
						options.onOutput?.(`${message}\n`, 'stderr');
						throw new EngineCommandError('build-failed', 'image build failed');
					}
					const text = event.stream ?? '';
					options.onOutput?.(text, 'stdout');
					tail = (tail + text).slice(-(options.maxBytes ?? 256 * 1024));
					end = buffer.indexOf('\n');
				}
			}
			if (buffer.trim())
				throw new EngineCommandError(
					'not-running',
					'incomplete build response',
				);
			return tail;
		}
		if (kind === 'logs') {
			const source = await this.transport.open(
				'GET',
				`/containers/${enc(action!)}/logs?stdout=1&stderr=1&tail=2000`,
				undefined,
				options,
			);
			const process = new SocketProcess();
			void demultiplex(source, process.stdout, process.stderr).then(
				() => process.finish(0),
				(e) => process.finish(null, e),
			);
			return this.collect(process, options);
		}
		if (kind === 'stats') {
			const name = args.at(-1)!;
			const stats = await this.transport.json<{
				cpu_stats?: {
					cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
					system_cpu_usage?: number;
					online_cpus?: number;
				};
				precpu_stats?: {
					cpu_usage?: { total_usage?: number };
					system_cpu_usage?: number;
				};
				memory_stats?: { usage?: number };
				pids_stats?: { current?: number; limit?: number };
			}>(
				'GET',
				`/containers/${enc(name)}/stats?stream=false`,
				undefined,
				options,
			);
			const cpu = stats.cpu_stats ?? {},
				previous = stats.precpu_stats ?? {};
			const delta =
					(cpu.cpu_usage?.total_usage ?? 0) -
					(previous.cpu_usage?.total_usage ?? 0),
				system = (cpu.system_cpu_usage ?? 0) - (previous.system_cpu_usage ?? 0);
			return JSON.stringify({
				CPU:
					system > 0
						? (delta / system) *
							(cpu.online_cpus ?? cpu.cpu_usage?.percpu_usage?.length ?? 1) *
							100
						: 0,
				MemUsageBytes: stats.memory_stats?.usage ?? 0,
				// Read by the engine, never by exec: exec needs a free process.
				PIDs: stats.pids_stats?.current ?? null,
				PidsLimit: stats.pids_stats?.limit ?? null,
			});
		}
		if (kind === 'container' && action === 'ls') {
			const filters: Record<string, string[]> = {};
			for (let i = 0; i < rest.length; i++)
				if (rest[i] === '--filter') {
					const value = rest[++i]!;
					const n = value.indexOf('=');
					const key = value.slice(0, n);
					filters[key] ??= [];
					filters[key].push(value.slice(n + 1));
				}
			const list = await this.transport.json<{ Id: string }[]>(
				'GET',
				`/containers/json?${query({ all: rest.some((v) => /^-[a-z]*a/.test(v)), filters })}`,
				undefined,
				options,
			);
			return list.map((c) => c.Id).join('\n');
		}
		if (kind === 'container' && action === 'create') {
			const spec = createSpec(rest);
			const result = await this.transport.json<{ Id: string }>(
				'POST',
				`/containers/create?${query({ name: spec.name })}`,
				spec.body,
				options,
			);
			return result.Id;
		}
		if (
			kind === 'container' &&
			['start', 'stop', 'restart', 'rm'].includes(action!)
		) {
			await this.transport.json(
				action === 'rm' ? 'DELETE' : 'POST',
				`/containers/${enc(rest.at(-1)!)}${action === 'rm' ? `?force=${rest.includes('-f')}` : `/${action}`}`,
				undefined,
				options,
			);
			return '';
		}
		if ((kind === 'volume' || kind === 'network') && action === 'create') {
			const labels: Record<string, string> = {};
			for (let i = 0; i < rest.length - 1; i++)
				if (rest[i] === '--label') {
					const value = rest[++i]!;
					const n = value.indexOf('=');
					labels[value.slice(0, n)] = value.slice(n + 1);
				}
			const result = await this.transport.json<{ Id?: string; Name?: string }>(
				'POST',
				`/${kind}s/create`,
				{ Name: rest.at(-1), Labels: labels },
				options,
			);
			return result.Id ?? result.Name ?? '';
		}
		if (
			(kind === 'volume' || kind === 'network' || kind === 'image') &&
			action === 'rm'
		) {
			await this.transport.json(
				'DELETE',
				`/${kind}s/${enc(rest.at(-1)!)}`,
				undefined,
				options,
			);
			return '';
		}
		if (kind === 'image' && action === 'tag') {
			const tag = rest[1]!,
				n = tag.lastIndexOf(':');
			await this.transport.json(
				'POST',
				`/images/${enc(rest[0]!)}/tag?${query({ repo: tag.slice(0, n), tag: tag.slice(n + 1) })}`,
				undefined,
				options,
			);
			return '';
		}
		throw new TypeError('unsupported internal engine operation');
	}
	private collect(
		child: EngineStream,
		options: EngineCallOptions,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			const stdoutDecoder = new StringDecoder('utf8');
			const stderrDecoder = new StringDecoder('utf8');
			let output = Buffer.alloc(0),
				failure: Error | undefined;
			const limit = options.maxBytes ?? 4 * 1024 * 1024;
			const timer = setTimeout(() => {
				failure = new EngineCommandError(
					'deadline',
					'engine operation deadline exceeded',
				);
				child.kill();
			}, options.deadlineMs ?? 30_000);
			const abort = () => {
				failure = new EngineCommandError(
					'not-running',
					'engine operation cancelled',
				);
				child.kill();
			};
			options.signal?.addEventListener('abort', abort, { once: true });
			child.stdout.on('data', (chunk: Buffer) => {
				options.onOutput?.(stdoutDecoder.write(chunk), 'stdout');
				output = Buffer.concat([output, chunk]);
				if (output.length > limit) {
					if (options.tail) output = output.subarray(-limit);
					else {
						failure = new EngineCommandError(
							'output-limit',
							'engine output exceeded limit',
						);
						child.kill();
					}
				}
			});
			child.stderr.on('data', (chunk: Buffer) =>
				options.onOutput?.(stderrDecoder.write(chunk), 'stderr'),
			);
			child.once('error', (e: Error) => {
				failure = e;
			});
			child.once('close', (code: number | null) => {
				clearTimeout(timer);
				options.onOutput?.(stdoutDecoder.end(), 'stdout');
				options.onOutput?.(stderrDecoder.end(), 'stderr');
				options.signal?.removeEventListener('abort', abort);
				if (failure) reject(failure);
				else if (code !== 0)
					reject(
						new EngineCommandError('not-running', 'container process failed'),
					);
				else resolve(output.toString('utf8'));
			});
			child.stdin.end(options.input);
			if (options.signal?.aborted) abort();
		});
	}
	exec(
		container: string,
		command: readonly string[],
		options: EngineCallOptions & {
			user?: string;
			tty?: boolean;
			environmentNames?: readonly string[];
		} = {},
	): Promise<string> {
		return this.collect(this.execStream(container, command, options), options);
	}
	execStream(
		container: string,
		command: readonly string[],
		options: {
			user?: string;
			tty?: boolean;
			env?: Readonly<Record<string, string | undefined>>;
			environmentNames?: readonly string[];
			signal?: AbortSignal;
		} = {},
	): SocketProcess {
		const child = new SocketProcess();
		const abort = () => child.kill();
		options.signal?.addEventListener('abort', abort, { once: true });
		child.once('close', () =>
			options.signal?.removeEventListener('abort', abort),
		);
		void (async () => {
			try {
				if (options.signal?.aborted) {
					child.kill();
					return;
				}
				const result = await this.transport.json<{ Id: string }>(
					'POST',
					`/containers/${enc(container)}/exec`,
					{
						AttachStdin: true,
						AttachStdout: true,
						AttachStderr: true,
						Tty: options.tty ?? false,
						User: options.user ?? 'bot',
						WorkingDir: '/home/bot',
						Cmd: command,
						Env: (options.environmentNames ?? Object.keys(options.env ?? {}))
							.filter((k) => options.env?.[k] !== undefined)
							.map((k) => `${k}=${options.env![k]}`),
					},
					{ signal: child.signal },
				);
				const source = await this.transport.subscribe(
					'POST',
					`/exec/${enc(result.Id)}/start`,
					{ Detach: false, Tty: options.tty ?? false },
					child.signal,
					true,
				);
				if (!('write' in source))
					throw new EngineCommandError(
						'not-running',
						'engine did not provide exec duplex',
					);
				child.resizeHandler = async (cols, rows) => {
					await this.transport.json(
						'POST',
						`/exec/${enc(result.Id)}/resize?${query({ w: cols, h: rows })}`,
						undefined,
						{ signal: child.signal },
					);
				};
				child.stdin.pipe(source as Duplex);
				child.emit('ready');
				await demultiplex(source, child.stdout, child.stderr, options.tty);
				const status = await this.transport.json<{ ExitCode: number }>(
					'GET',
					`/exec/${enc(result.Id)}/json`,
					undefined,
					{ signal: child.signal },
				);
				child.finish(status.ExitCode);
			} catch (e) {
				if (!child.signal.aborted) child.finish(null, e);
			}
		})();
		return child;
	}
	stream(args: readonly string[]): SocketProcess {
		const child = new SocketProcess();
		void (async () => {
			let id: string | undefined;
			try {
				if (args[0] !== 'run')
					throw new TypeError('unsupported internal streaming operation');
				const spec = createSpec(args.slice(1));
				const created = await this.transport.json<{ Id: string }>(
					'POST',
					`/containers/create?${query({ name: spec.name })}`,
					spec.body,
					{ signal: child.signal },
				);
				id = created.Id;
				const source = await this.transport.subscribe(
					'POST',
					`/containers/${enc(id)}/attach?stream=1&stdin=1&stdout=1&stderr=1`,
					undefined,
					child.signal,
					true,
				);
				if (!('write' in source))
					throw new EngineCommandError(
						'not-running',
						'engine did not provide attach duplex',
					);
				child.stdin.pipe(source as Duplex);
				const output = demultiplex(source, child.stdout, child.stderr);
				// Install a rejection handler before start can fail.
				void output.catch(() => {});
				await this.transport.json(
					'POST',
					`/containers/${enc(id)}/start`,
					undefined,
					{ signal: child.signal },
				);
				const status = await this.transport.json<{ StatusCode: number }>(
					'POST',
					`/containers/${enc(id)}/wait`,
					undefined,
					{ signal: child.signal, deadlineMs: 24 * 60 * 60_000 },
				);
				await output;
				if (spec.remove)
					await this.transport.json(
						'DELETE',
						`/containers/${enc(id)}?force=true`,
					);
				child.finish(status.StatusCode);
			} catch (e) {
				if (!child.signal.aborted) child.finish(null, e);
			} finally {
				if (id && child.signal.aborted)
					await this.transport
						.json('DELETE', `/containers/${enc(id)}?force=true`)
						.catch(() => {});
			}
		})();
		return child;
	}
	events(
		onEvent: (event: Record<string, unknown>) => void,
		onEnd: () => void,
	): () => void {
		const controller = new AbortController();
		void (async () => {
			try {
				const source = await this.transport.subscribe(
					'GET',
					`/events?${query({ filters: { type: ['container'] } })}`,
					undefined,
					controller.signal,
				);
				let buffer = '';
				const decoder = new StringDecoder('utf8');
				for await (const chunk of source) {
					buffer += decoder.write(
						Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
					);
					if (buffer.length > 1024 * 1024)
						throw new EngineCommandError(
							'output-limit',
							'engine event frame exceeded limit',
						);
					let end = buffer.indexOf('\n');
					while (end >= 0) {
						const line = buffer.slice(0, end);
						buffer = buffer.slice(end + 1);
						if (line.trim()) onEvent(JSON.parse(line));
						end = buffer.indexOf('\n');
					}
				}
			} catch {
				/* Owner gets a single availability event. */
			}
			if (!controller.signal.aborted) onEnd();
		})();
		return () => controller.abort();
	}
}
