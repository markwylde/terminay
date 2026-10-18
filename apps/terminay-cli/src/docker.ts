import { stat } from 'node:fs/promises';
import { request } from 'node:http';
import { type DeadlineTimers, GLOBAL_DEADLINE_TIMERS } from './deadlines.js';

/**
 * The Docker Engine API, over the socket an operator mounted into the
 * container.
 *
 * The image carries no `docker` binary and needs none: the engine speaks HTTP
 * on a Unix socket, and the handful of calls a recreate makes are plain JSON.
 * Everything a recreate does to a container goes through the small interface
 * below, so the whole flow runs in the tests against a stand-in engine.
 *
 * Reaching the socket is the operator's decision, not this module's: it is
 * opened as the account that runs the command and never through `sudo`. A
 * socket that account may not open is simply one that is not usable here.
 */

export const DOCKER_SOCKET_DEFAULT = '/var/run/docker.sock';
/** One answer to one question; a daemon that is there answers at once. */
export const DOCKER_PROBE_TIMEOUT_MS = 2_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** A pull is as slow as the registry and the link to it. */
const PULL_TIMEOUT_MS = 15 * 60_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Where the engine's socket is. `DOCKER_HOST` when it names a Unix socket, and
 * the conventional path otherwise: an engine reached over TCP is not something
 * mounted into this container, so it is not what this mode is offered for.
 */
export function dockerSocketPath(env: Environment = process.env): string {
	const host = env.DOCKER_HOST;
	if (host?.startsWith('unix://')) {
		const path = host.slice('unix://'.length);
		if (path.startsWith('/')) return path;
	}
	return DOCKER_SOCKET_DEFAULT;
}

export class DockerError extends Error {
	constructor(
		message: string,
		/** The HTTP status, or 0 when the engine was never reached. */
		readonly status: number,
		readonly code?: string,
	) {
		super(message);
		this.name = 'DockerError';
	}
}

export interface DockerMount {
	readonly Type?: string;
	readonly Name?: string;
	readonly Source?: string;
	readonly Destination?: string;
	readonly RW?: boolean;
}

export interface DockerEndpoint {
	readonly Aliases?: readonly string[] | null;
	readonly Links?: readonly string[] | null;
	readonly IPAMConfig?: Readonly<Record<string, unknown>> | null;
	readonly DriverOpts?: Readonly<Record<string, string>> | null;
}

export interface DockerImageConfig {
	readonly Env?: readonly string[] | null;
	readonly Labels?: Readonly<Record<string, string>> | null;
	readonly Cmd?: readonly string[] | null;
	readonly Entrypoint?: readonly string[] | null;
	readonly [key: string]: unknown;
}

export interface DockerContainerConfig extends DockerImageConfig {
	readonly Image?: string;
	readonly Hostname?: string;
}

export interface DockerHostConfig {
	readonly AutoRemove?: boolean;
	readonly NetworkMode?: string;
	readonly Binds?: readonly string[] | null;
	readonly Mounts?: readonly Readonly<Record<string, unknown>>[] | null;
	readonly Links?: readonly string[] | null;
	readonly GroupAdd?: readonly string[] | null;
	readonly SecurityOpt?: readonly string[] | null;
	readonly UsernsMode?: string;
	readonly [key: string]: unknown;
}

export interface DockerContainer {
	readonly Id: string;
	readonly Name: string;
	/** The id of the image the container was created from. */
	readonly Image: string;
	readonly Config: DockerContainerConfig;
	readonly HostConfig: DockerHostConfig;
	readonly Mounts?: readonly DockerMount[] | null;
	readonly NetworkSettings?: {
		readonly Networks?: Readonly<Record<string, DockerEndpoint>> | null;
	} | null;
	readonly State?: {
		readonly Status?: string;
		readonly Running?: boolean;
		readonly Restarting?: boolean;
		readonly ExitCode?: number;
		readonly Health?: {
			readonly Status?: string;
			readonly Log?:
				| readonly {
						readonly ExitCode?: number;
						readonly Output?: string;
				  }[]
				| null;
		} | null;
	} | null;
}

export interface DockerImage {
	readonly Id: string;
	readonly Config?: DockerImageConfig | null;
}

/** One thing the engine says happened to a container. */
export interface ContainerEvent {
	/** `health_status: healthy`, `health_status: unhealthy`, `die`, `destroy`. */
	readonly action: string;
	/** The exit status, on `die`. */
	readonly exitCode?: string;
}

export interface ContainerWatch {
	/**
	 * Resolves when the engine stops reporting: with the error that ended the
	 * stream, or with nothing when it closed, including by `close`.
	 */
	readonly ended: Promise<Error | undefined>;
	close(): void;
}

export interface DockerApi {
	/** Resolves when the engine answers within the deadline; rejects otherwise. */
	ping(timeoutMs?: number): Promise<void>;
	/** `undefined` when there is no such container. */
	inspectContainer(idOrName: string): Promise<DockerContainer | undefined>;
	/** `undefined` when the engine holds no such image. */
	inspectImage(reference: string): Promise<DockerImage | undefined>;
	pullImage(repository: string, tag: string): Promise<void>;
	/** Returns the new container's id. */
	createContainer(
		name: string,
		spec: Readonly<Record<string, unknown>>,
	): Promise<string>;
	connectNetwork(
		network: string,
		container: string,
		endpoint: Readonly<Record<string, unknown>>,
	): Promise<void>;
	startContainer(id: string): Promise<void>;
	/** Stops within the container's own stop timeout, as `docker stop` does. */
	stopContainer(id: string): Promise<void>;
	renameContainer(id: string, name: string): Promise<void>;
	/** Removes the container and never its volumes. */
	removeContainer(id: string, options?: { force?: boolean }): Promise<void>;
	/**
	 * Resolves with the container's exit status once it is no longer running.
	 * One request the engine holds open until then, bounded by the deadline.
	 */
	waitContainer(id: string, timeoutMs: number): Promise<number>;
	/**
	 * Subscribe to a container's health verdicts and to its ending. Resolves
	 * once the engine has accepted the subscription, so nothing that happens
	 * after that is missed; the listener is then called as events arrive.
	 */
	watchContainer(
		id: string,
		listener: (event: ContainerEvent) => void,
	): Promise<ContainerWatch>;
}

interface Answer {
	readonly status: number;
	readonly body: string;
}

function send(
	socketPath: string,
	method: string,
	path: string,
	body: unknown,
	timeoutMs: number,
	timers: DeadlineTimers,
): Promise<Answer> {
	return new Promise((resolve, reject) => {
		const payload = body === undefined ? undefined : JSON.stringify(body);
		let settled = false;
		const fail = (error: DockerError) => {
			if (settled) return;
			settled = true;
			timers.clearTimeout(deadline);
			reject(error);
		};
		const outgoing = request(
			{
				socketPath,
				method,
				path,
				headers: {
					host: 'docker',
					...(payload === undefined
						? {}
						: {
								'content-type': 'application/json',
								'content-length': Buffer.byteLength(payload),
							}),
				},
			},
			(response) => {
				const chunks: Buffer[] = [];
				let bytes = 0;
				response.on('data', (chunk: Buffer) => {
					bytes += chunk.byteLength;
					// A pull streams progress for as long as it runs; only its
					// tail can say how it ended.
					chunks.push(chunk);
					while (bytes > MAX_BODY_BYTES && chunks.length > 1)
						bytes -= (chunks.shift() as Buffer).byteLength;
				});
				response.on('error', (error) =>
					fail(new DockerError(error.message, 0)),
				);
				response.on('end', () => {
					if (settled) return;
					settled = true;
					timers.clearTimeout(deadline);
					resolve({
						status: response.statusCode ?? 0,
						body: Buffer.concat(chunks).toString('utf8'),
					});
				});
			},
		);
		// A one-shot deadline on one request (ADR-0028 decision 3).
		const deadline = timers.setTimeout(() => {
			outgoing.destroy();
			fail(
				new DockerError(
					'the Docker daemon did not answer in time',
					0,
					'ETIMEDOUT',
				),
			);
		}, timeoutMs);
		outgoing.on('error', (error: NodeJS.ErrnoException) =>
			fail(new DockerError(error.message, 0, error.code)),
		);
		outgoing.end(payload);
	});
}

/**
 * The engine's event stream, narrowed to one container.
 *
 * One request the engine holds open and writes a line to whenever something
 * happens, so the caller is told of a change rather than asking for it. The
 * deadline covers only the engine accepting the subscription; how long to
 * listen is the caller's to decide, by closing it.
 */
function watch(
	socketPath: string,
	id: string,
	listener: (event: ContainerEvent) => void,
	timers: DeadlineTimers,
): Promise<ContainerWatch> {
	const filters = JSON.stringify({
		type: ['container'],
		container: [id],
		event: ['health_status', 'die', 'destroy'],
	});
	return new Promise((resolve, reject) => {
		let opened = false;
		let finish: (error: Error | undefined) => void = () => undefined;
		const ended = new Promise<Error | undefined>((settle) => {
			finish = settle;
		});
		const outgoing = request(
			{
				socketPath,
				method: 'GET',
				path: `/events?filters=${encodeURIComponent(filters)}`,
				headers: { host: 'docker' },
			},
			(response) => {
				timers.clearTimeout(deadline);
				if (response.statusCode !== 200) {
					response.resume();
					reject(
						new DockerError(
							`watching the container failed (${response.statusCode})`,
							response.statusCode ?? 0,
						),
					);
					return;
				}
				opened = true;
				let buffered = '';
				response.setEncoding('utf8');
				response.on('data', (chunk: string) => {
					buffered += chunk;
					for (;;) {
						const newline = buffered.indexOf('\n');
						if (newline < 0) break;
						const line = buffered.slice(0, newline);
						buffered = buffered.slice(newline + 1);
						if (line.trim().length === 0) continue;
						try {
							const entry = JSON.parse(line) as {
								Action?: unknown;
								status?: unknown;
								Actor?: { Attributes?: Record<string, unknown> };
							};
							const action = entry.Action ?? entry.status;
							if (typeof action !== 'string') continue;
							const exitCode = entry.Actor?.Attributes?.exitCode;
							listener({
								action,
								...(typeof exitCode === 'string' ? { exitCode } : {}),
							});
						} catch {
							// A line that is not an event is not one to act on.
						}
					}
					if (buffered.length > MAX_BODY_BYTES) buffered = '';
				});
				response.on('error', (error) => finish(error));
				response.on('close', () => finish(undefined));
				resolve({ ended, close: () => outgoing.destroy() });
			},
		);
		// A one-shot deadline on the subscription being accepted.
		const deadline = timers.setTimeout(() => {
			outgoing.destroy();
			reject(
				new DockerError(
					'the Docker daemon did not answer in time',
					0,
					'ETIMEDOUT',
				),
			);
		}, REQUEST_TIMEOUT_MS);
		outgoing.on('error', (error: NodeJS.ErrnoException) => {
			timers.clearTimeout(deadline);
			if (opened) finish(error);
			else reject(new DockerError(error.message, 0, error.code));
		});
		outgoing.end();
	});
}

function failure(answer: Answer, what: string): DockerError {
	let detail = answer.body.trim().slice(0, 512);
	try {
		const parsed = JSON.parse(answer.body) as { message?: unknown };
		if (typeof parsed.message === 'string') detail = parsed.message;
	} catch {
		// Not JSON: the text is the detail.
	}
	return new DockerError(
		`${what} failed (${answer.status})${detail.length > 0 ? `: ${detail}` : ''}`,
		answer.status,
	);
}

const segment = (value: string) => encodeURIComponent(value);

export function createDockerClient(
	socketPath: string,
	timers: DeadlineTimers = GLOBAL_DEADLINE_TIMERS,
): DockerApi {
	const call = async (
		method: string,
		path: string,
		what: string,
		body?: unknown,
		timeoutMs: number = REQUEST_TIMEOUT_MS,
	): Promise<Answer> => {
		const answer = await send(
			socketPath,
			method,
			path,
			body,
			timeoutMs,
			timers,
		);
		// 304 is how the engine says a container was already started or stopped.
		if ((answer.status >= 200 && answer.status < 300) || answer.status === 304)
			return answer;
		throw failure(answer, what);
	};
	const inspect = async <T>(
		path: string,
		what: string,
	): Promise<T | undefined> => {
		const answer = await send(
			socketPath,
			'GET',
			path,
			undefined,
			REQUEST_TIMEOUT_MS,
			timers,
		);
		if (answer.status === 404) return undefined;
		if (answer.status !== 200) throw failure(answer, what);
		return JSON.parse(answer.body) as T;
	};

	const api: DockerApi = {
		async ping(timeoutMs = DOCKER_PROBE_TIMEOUT_MS) {
			await call(
				'GET',
				'/_ping',
				'reaching the Docker daemon',
				undefined,
				timeoutMs,
			);
		},
		inspectContainer(idOrName) {
			return inspect<DockerContainer>(
				`/containers/${segment(idOrName)}/json`,
				`inspecting the container ${idOrName}`,
			);
		},
		inspectImage(reference) {
			// An image name keeps its slashes in the path; the engine routes on
			// the `/json` at its end.
			return inspect<DockerImage>(
				`/images/${reference.split('/').map(segment).join('/')}/json`,
				`inspecting the image ${reference}`,
			);
		},
		async pullImage(repository, tag) {
			const what = `pulling ${repository}:${tag}`;
			const answer = await call(
				'POST',
				`/images/create?fromImage=${segment(repository)}&tag=${segment(tag)}`,
				what,
				undefined,
				PULL_TIMEOUT_MS,
			);
			// The status line is sent before the pull runs, so a failure arrives
			// as an entry in the stream of an answer that began with 200.
			for (const line of answer.body.split('\n')) {
				if (line.trim().length === 0) continue;
				let entry: { error?: unknown };
				try {
					entry = JSON.parse(line) as { error?: unknown };
				} catch {
					continue;
				}
				if (typeof entry.error === 'string')
					throw new DockerError(`${what} failed: ${entry.error}`, 200);
			}
		},
		async createContainer(name, spec) {
			const answer = await call(
				'POST',
				`/containers/create?name=${segment(name)}`,
				`creating the container ${name}`,
				spec,
			);
			const id = (JSON.parse(answer.body) as { Id?: unknown }).Id;
			if (typeof id !== 'string' || id.length === 0)
				throw new DockerError(
					`creating the container ${name} returned no id`,
					answer.status,
				);
			return id;
		},
		async connectNetwork(network, container, endpoint) {
			await call(
				'POST',
				`/networks/${segment(network)}/connect`,
				`connecting to the network ${network}`,
				{ Container: container, EndpointConfig: endpoint },
			);
		},
		async startContainer(id) {
			await call(
				'POST',
				`/containers/${segment(id)}/start`,
				'starting the container',
			);
		},
		async stopContainer(id) {
			// No `t`: the engine then applies the container's own stop timeout.
			// The request outlasts any timeout an operator is likely to have set.
			await call(
				'POST',
				`/containers/${segment(id)}/stop`,
				'stopping the container',
				undefined,
				10 * 60_000,
			);
		},
		async renameContainer(id, name) {
			await call(
				'POST',
				`/containers/${segment(id)}/rename?name=${segment(name)}`,
				`renaming the container to ${name}`,
			);
		},
		async removeContainer(id, options = {}) {
			// Never `v=1`: a volume the engine counts as anonymous may be the
			// one holding the server's identity.
			await call(
				'DELETE',
				`/containers/${segment(id)}${options.force === true ? '?force=1' : ''}`,
				'removing the container',
			);
		},
		async waitContainer(id, timeoutMs) {
			const answer = await call(
				'POST',
				`/containers/${segment(id)}/wait`,
				'waiting for the container',
				undefined,
				timeoutMs,
			);
			const status = (JSON.parse(answer.body) as { StatusCode?: unknown })
				.StatusCode;
			return typeof status === 'number' ? status : 0;
		},
		watchContainer(id, listener) {
			return watch(socketPath, id, listener, timers);
		},
	};
	return Object.freeze(api);
}

export type SocketProbe =
	| { readonly usable: true }
	| {
			readonly usable: false;
			readonly cause: 'absent' | 'not-a-socket' | 'denied' | 'unresponsive';
	  };

/**
 * Is there an engine behind this socket that this account can talk to?
 *
 * A file at the path is not an answer: a socket left by a stopped engine, one
 * owned by a group this account is not in, or a directory an engine created
 * for a mount whose source was missing all look present. So the socket is
 * asked one question, once, and anything but a prompt answer is "no".
 */
export async function probeDockerSocket(
	socketPath: string,
	timeoutMs: number = DOCKER_PROBE_TIMEOUT_MS,
	timers: DeadlineTimers = GLOBAL_DEADLINE_TIMERS,
): Promise<SocketProbe> {
	let info: Awaited<ReturnType<typeof stat>>;
	try {
		info = await stat(socketPath);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return {
			usable: false,
			cause: code === 'EACCES' || code === 'EPERM' ? 'denied' : 'absent',
		};
	}
	if (!info.isSocket()) return { usable: false, cause: 'not-a-socket' };
	try {
		await createDockerClient(socketPath, timers).ping(timeoutMs);
		return { usable: true };
	} catch (error) {
		const code = error instanceof DockerError ? error.code : undefined;
		return {
			usable: false,
			cause: code === 'EACCES' || code === 'EPERM' ? 'denied' : 'unresponsive',
		};
	}
}
