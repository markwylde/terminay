import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A stand-in for the Docker Engine API on a Unix socket.
 *
 * It keeps containers and images the way an engine reports them — a created
 * container's configuration is its image's with the request merged over it —
 * and answers the handful of calls a recreate makes. A test decides what a
 * registry holds, how a started container's health turns out, and what a
 * started container does.
 *
 * Health is reported the way an engine reports it: as events on `/events`, a
 * moment after the container starts. `health(container)` names what happens —
 * `healthy`, `unhealthy`, `die` (the container exits), `drop` (the engine
 * hangs up on its event streams), or `starting` (nothing, ever). With
 * `healthAtStart` the verdict is already in the container's state when the
 * start returns and no event is sent, as for a subscriber that came late.
 */

export const newId = () => randomBytes(32).toString('hex');

export async function startFakeDocker(options = {}) {
	// Short, because a Unix socket path has a small fixed limit.
	const directory = await mkdtemp(join(tmpdir(), 'td-'));
	const socketPath = join(directory, 'd.sock');
	const containers = new Map();
	const images = new Map();
	/** What a pull of `repository:tag` brings in. */
	const registry = new Map(Object.entries(options.registry ?? {}));
	const calls = [];
	const waiters = new Map();
	const streams = new Set();
	const emit = (container, action, attributes = {}) => {
		const line = `${JSON.stringify({
			Type: 'container',
			Action: action,
			status: action,
			id: container.Id,
			Actor: { ID: container.Id, Attributes: attributes },
		})}\n`;
		for (const stream of streams) {
			const wanted =
				stream.filters.container.includes(container.Id) &&
				stream.filters.event.includes(action.split(':')[0]);
			if (wanted) stream.response.write(line);
		}
	};
	const state = {
		pullError: options.pullError,
		/** `(container) => status` for a started container's health. */
		health: options.health ?? (() => 'healthy'),
		healthAtStart: options.healthAtStart === true,
		healthDelayMs: options.healthDelayMs ?? 20,
		/** Called, not awaited, when a container starts. */
		onStart: options.onStart,
		silent: false,
	};

	const findContainer = (reference) => {
		for (const container of containers.values()) {
			if (
				container.Id === reference ||
				(reference.length >= 12 && container.Id.startsWith(reference)) ||
				container.Name === `/${reference}`
			)
				return container;
		}
		return undefined;
	};
	const findImage = (reference) => {
		if (images.has(reference)) return images.get(reference);
		for (const image of images.values())
			if (image.Id === reference) return image;
		return undefined;
	};
	const exited = (container, status) => {
		if (container.State?.Running !== true) return;
		container.State = { ...container.State, Running: false, ExitCode: status };
		emit(container, 'die', { exitCode: String(status) });
		for (const finish of waiters.get(container.Id) ?? []) finish(status);
		waiters.delete(container.Id);
		if (container.HostConfig?.AutoRemove === true)
			containers.delete(container.Id);
	};

	const handle = async (method, url, body) => {
		const path = url.pathname;
		const inspected = /^\/containers\/([^/]+)\/json$/u.exec(path);
		const imaged = /^\/images\/(.+)\/json$/u.exec(path);
		const connected = /^\/networks\/([^/]+)\/connect$/u.exec(path);
		const acted = /^\/containers\/([^/]+)\/(start|stop|rename|wait)$/u.exec(
			path,
		);
		const removed = /^\/containers\/([^/]+)$/u.exec(path);
		if (method === 'GET' && path === '/_ping') return [200, 'OK'];
		if (method === 'GET' && inspected !== null) {
			const container = findContainer(decodeURIComponent(inspected[1]));
			if (container === undefined)
				return [404, { message: 'No such container' }];
			return [200, container];
		}
		if (method === 'GET' && imaged !== null) {
			const image = findImage(decodeURIComponent(imaged[1]));
			return image === undefined
				? [404, { message: 'No such image' }]
				: [200, image];
		}
		if (method === 'POST' && path === '/images/create') {
			const reference = `${url.searchParams.get('fromImage')}:${url.searchParams.get('tag')}`;
			if (state.pullError !== undefined)
				return [
					200,
					`{"status":"Pulling"}\n${JSON.stringify({ error: state.pullError })}\n`,
				];
			const image = registry.get(reference);
			if (image === undefined)
				return [
					200,
					`${JSON.stringify({ error: `manifest for ${reference} not found` })}\n`,
				];
			images.set(reference, image);
			images.set(image.Id, image);
			return [
				200,
				'{"status":"Pulling"}\n{"status":"Downloaded newer image"}\n',
			];
		}
		if (method === 'POST' && path === '/containers/create') {
			const name = url.searchParams.get('name');
			if (findContainer(name) !== undefined)
				return [
					409,
					{
						message: `Conflict. The container name "/${name}" is already in use`,
					},
				];
			const image = findImage(body.Image);
			if (image === undefined)
				return [404, { message: `No such image: ${body.Image}` }];
			const config = image.Config ?? {};
			const id = newId();
			const binds = body.HostConfig?.Binds ?? [];
			const container = {
				Id: id,
				Name: `/${name}`,
				Image: image.Id,
				Config: {
					...config,
					...body,
					HostConfig: undefined,
					NetworkingConfig: undefined,
					Hostname: body.Hostname ?? id.slice(0, 12),
					Env: [...(config.Env ?? []), ...(body.Env ?? [])],
					Labels: { ...(config.Labels ?? {}), ...(body.Labels ?? {}) },
				},
				HostConfig: body.HostConfig ?? {},
				Mounts: binds.map((bind) => {
					const [source, destination, mode] = bind.split(':');
					return source.startsWith('/')
						? {
								Type: 'bind',
								Source: source,
								Destination: destination,
								RW: mode !== 'ro',
							}
						: {
								Type: 'volume',
								Name: source,
								Source: `/var/lib/docker/volumes/${source}/_data`,
								Destination: destination,
								RW: mode !== 'ro',
							};
				}),
				NetworkSettings: {
					Networks: { ...(body.NetworkingConfig?.EndpointsConfig ?? {}) },
				},
				State: { Running: false, Status: 'created' },
				created: body,
			};
			containers.set(id, container);
			return [201, { Id: id, Warnings: [] }];
		}
		if (method === 'POST' && connected !== null) {
			const container = findContainer(body.Container);
			if (container === undefined)
				return [404, { message: 'No such container' }];
			container.NetworkSettings.Networks[decodeURIComponent(connected[1])] =
				body.EndpointConfig;
			return [200, ''];
		}
		if (acted !== null && method === 'POST') {
			const container = findContainer(decodeURIComponent(acted[1]));
			if (container === undefined)
				return [404, { message: 'No such container' }];
			if (acted[2] === 'start') {
				if (options.startError?.(container) === true)
					return [
						500,
						{ message: 'driver failed programming external connectivity' },
					];
				const hasHealth =
					findImage(container.Image)?.Config?.Healthcheck !== undefined;
				container.State = {
					Running: true,
					Status: 'running',
					...(hasHealth
						? {
								Health: {
									Status: 'starting',
									Log: [{ ExitCode: 1, Output: 'not ready' }],
								},
							}
						: {}),
				};
				const fate = state.health(container);
				const settleHealth = () => {
					if (container.State?.Running !== true) return;
					if (fate === 'die') exited(container, 1);
					else if (fate === 'drop') {
						for (const stream of streams) stream.response.end();
					} else if (
						hasHealth &&
						(fate === 'healthy' || fate === 'unhealthy')
					) {
						container.State.Health.Status = fate;
						if (!state.healthAtStart) emit(container, `health_status: ${fate}`);
					}
				};
				if (state.healthAtStart) settleHealth();
				else setTimeout(settleHealth, state.healthDelayMs);
				if (state.onStart !== undefined)
					queueMicrotask(() => {
						Promise.resolve(state.onStart(container, exited)).catch(
							() => undefined,
						);
					});
				return [204, ''];
			}
			if (acted[2] === 'stop') {
				if (container.State?.Running !== true) return [304, ''];
				exited(container, 143);
				return [204, ''];
			}
			if (acted[2] === 'rename') {
				const name = url.searchParams.get('name');
				if (findContainer(name) !== undefined)
					return [409, { message: 'name is already in use' }];
				container.Name = `/${name}`;
				return [204, ''];
			}
			if (container.State?.Running !== true)
				return [200, { StatusCode: container.State?.ExitCode ?? 0 }];
			const status = await new Promise((finish) => {
				waiters.set(container.Id, [
					...(waiters.get(container.Id) ?? []),
					finish,
				]);
			});
			return [200, { StatusCode: status }];
		}
		if (method === 'DELETE' && removed !== null) {
			const container = findContainer(decodeURIComponent(removed[1]));
			if (container === undefined)
				return [404, { message: 'No such container' }];
			if (
				container.State?.Running === true &&
				url.searchParams.get('force') !== '1'
			)
				return [409, { message: 'container is running' }];
			if (url.searchParams.has('v')) calls.push('VOLUMES REMOVED');
			containers.delete(container.Id);
			return [204, ''];
		}
		return [404, { message: `page not found: ${method} ${path}` }];
	};

	const server = createServer((request, response) => {
		if (state.silent) return;
		const chunks = [];
		request.on('data', (chunk) => chunks.push(chunk));
		request.on('end', async () => {
			const url = new URL(request.url, 'http://docker');
			const raw = Buffer.concat(chunks).toString('utf8');
			const body = raw.length > 0 ? JSON.parse(raw) : undefined;
			if (request.method === 'GET' && url.pathname === '/events') {
				calls.push('GET /events');
				const filters = JSON.parse(url.searchParams.get('filters') ?? '{}');
				const stream = {
					response,
					filters: { container: [], event: [], ...filters },
				};
				streams.add(stream);
				response.on('close', () => streams.delete(stream));
				response.writeHead(200, { 'content-type': 'application/json' });
				response.flushHeaders();
				return;
			}
			calls.push(`${request.method} ${url.pathname}${url.search}`);
			let answer;
			try {
				answer = await handle(request.method, url, body);
			} catch (error) {
				answer = [500, { message: String(error) }];
			}
			const [status, payload] = answer;
			const text =
				typeof payload === 'string' ? payload : JSON.stringify(payload);
			response.writeHead(status, { 'content-type': 'application/json' });
			response.end(text);
		});
	});
	await new Promise((resolve) => server.listen(socketPath, resolve));

	return {
		socketPath,
		containers,
		images,
		registry,
		calls,
		state,
		findContainer,
		exited,
		streams,
		/** Put a container in the engine as though `docker run` had made it. */
		addContainer(container) {
			containers.set(container.Id, container);
			return container;
		},
		addImage(reference, image) {
			images.set(reference, image);
			// An image outlives the tag that named it for as long as a
			// container uses it.
			images.set(image.Id, image);
			return image;
		},
		async close() {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
			await rm(directory, { recursive: true, force: true });
		},
	};
}
