import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
// Docker-compatible API fixture. Container-side programs are simulated by the
// existing composed engine fixture; production never spawns an engine CLI.
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extract } from 'tar';

export async function startBotSocketServer(root, options = {}) {
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(path.join(tmpdir(), 'bot-api-'));
	const socketPath = path.join(directory, 'engine.sock');
	const execs = new Map(),
		children = new Set(),
		sockets = new Set();
	const eventResponses = new Set();
	const emitEvent = event => { for (const response of eventResponses) response.write(JSON.stringify(event) + '\n'); };
	const lifecycleEvent = (action, name, resource) => {
		if (!options.emitLifecycleEvents) return;
		const event = { Type: 'container', Action: action, Actor: { ID: name, Attributes: { ...(resource?.Config?.Labels ?? resource?.Labels ?? {}), name } } };
		appendFileSync(path.join(root, 'events.jsonl'), JSON.stringify(event) + '\n');
		emitEvent(event);
	};
	const config = { kind: 'docker', ...options };
	const terminals = new Set();
	const calls = [],
		closed = new EventEmitter();
	const script = new URL('./bot-composed-engine.mjs', import.meta.url).pathname;
	const env = () => ({ ...process.env, TERMINAY_FAKE_BOT_ROOT: root });
	const file = (kind, name) =>
		path.join(root, `${kind}-${encodeURIComponent(name)}.json`);
	const read = async (kind, name) => {
		try {
			return JSON.parse(await readFile(file(kind, name), 'utf8'));
		} catch {
			return undefined;
		}
	};
	const put = (kind, name, value) =>
		writeFile(file(kind, name), JSON.stringify(value));
	const invoke = (args, input = '', extra = {}) =>
		new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [script, ...args], {
				env: { ...env(), ...extra },
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			children.add(child);
			closed.emit('changed');
			const chunks = [];
			let stderr = '';
			child.stdout.on('data', (c) => chunks.push(c));
			child.stderr.on('data', (c) => (stderr += c));
			child.on('error', reject);
			child.once('close', (code) => {
				children.delete(child);
				closed.emit('changed');
				resolve({ code, text: Buffer.concat(chunks).toString(), stderr });
			});
			child.stdin.end(input);
		});
	const frame = (bytes, stderr = false) => {
		const header = Buffer.alloc(8);
		header[0] = stderr ? 2 : 1;
		header.writeUInt32BE(bytes.length, 4);
		return Buffer.concat([header, bytes]);
	};
	const route = (req) => {
		const url = new URL(req.url, 'http://local');
		return {
			url,
			parts: url.pathname
				.replace(/^\/v[\d.]+/, '')
				.split('/')
				.filter(Boolean)
				.map(decodeURIComponent),
		};
	};
	const body = async (req) => {
		const chunks = [];
		for await (const c of req) chunks.push(c);
		return Buffer.concat(chunks);
	};
	const server = createServer(async (req, res) => {
		try {
			const { url, parts: p } = route(req);
			const bytes = await body(req);
			const b = bytes.length && p[0] !== 'build' ? JSON.parse(bytes) : {};
			calls.push({
				method: req.method,
				path: url.pathname,
				query: Object.fromEntries(url.searchParams),
				body: b,
			});
			const send = (v, status = 200) => {
				res.writeHead(status, { 'Content-Type': 'application/json' });
				res.end(v === undefined ? '' : JSON.stringify(v));
			};
			if (config.down || (await read('engine-state', 'down')))
				return send({}, 503);
			if (p[0] === 'version')
				return send({
					ApiVersion: config.apiVersion ?? '1.44',
					MinAPIVersion: '1.24',
					Components: [
						{ Name: config.kind === 'podman' ? 'Podman Engine' : 'Engine' },
					],
				});
			if (p[0] === 'info') {
				try {
					await readFile(path.join(root, 'engine-down'));
					return send({}, 503);
				} catch {}
				return send({
					ID: config.randomID ? randomUUID() : 'fake-bot-engine',
					SecurityOptions:
						config.rootless && config.kind === 'docker' ? ['rootless'] : [],
				});
			}
			if (p[0] === 'libpod' && p[1] === 'info')
				return send({
					host: {
						security: { rootless: config.rootless ?? false },
						hostname: 'localhost.localdomain',
						cgroupVersion: 'v2',
						cgroupControllers: config.controllers ?? ['cpu', 'memory', 'pids'],
						remoteSocket: { path: 'unix:///run/podman/podman.sock' },
					},
				});
			if (p[0] === 'events') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.flushHeaders();
				eventResponses.add(res);
				res.once('close', () => eventResponses.delete(res));
				return;
			}
			if (p[0] === 'build') {
				const build = await mkdtemp(path.join(directory, 'build-'));
				const archive = path.join(build, 'context.tar');
				await writeFile(archive, bytes);
				await extract({ file: archive, cwd: build });
				const args = ['build', '--tag', url.searchParams.get('t'), build];
				const result = await invoke(args);
				res.setHeader('Content-Type', 'application/json');
				res.end(
					JSON.stringify(
						result.code
							? { errorDetail: { message: 'fixture build failed' } }
							: { stream: result.text },
					) + '\n',
				);
				await rm(build, { recursive: true, force: true });
				return;
			}
			if (p[0] === 'containers' && p[1] === 'create') {
				const name = url.searchParams.get('name') || `helper-${randomUUID()}`;
				const resource = {
					Id: name,
					Name: name,
					Labels: b.Labels ?? {},
					Config: { ...b, Labels: b.Labels ?? {} },
					HostConfig: b.HostConfig,
					State: { Running: false, Status: 'created', ExitCode: 0 },
				};
				await put('container', name, resource);
				lifecycleEvent('create', name, resource);
				await writeFile(
					path.join(root, 'calls.jsonl'),
					JSON.stringify({
						args: [
							'container',
							'create',
							'--name',
							name,
							...Object.entries(b.Labels ?? {}).flatMap(([k, v]) => [
								'--label',
								`${k}=${v}`,
							]),
						],
					}) + '\n',
					{ flag: 'a' },
				);
				return send({ Id: name }, 201);
			}
			if (p[0] === 'exec' && p[2] === 'json')
				return send({
					ExitCode: execs.get(p[1])?.exitCode ?? 0,
					Running: execs.get(p[1])?.running ?? false,
				});
			if (p[0] === 'exec' && p[2] === 'resize') return send(undefined);
			if (p[0] === 'containers' && p[2] === 'exec') {
				const id = randomUUID();
				execs.set(id, { ...b, container: p[1], exitCode: 0, running: false });
				return send({ Id: id }, 201);
			}
			if (p[0] === 'containers' && p[1] === 'json') {
				const filters = JSON.parse(url.searchParams.get('filters') ?? '{}');
				const args = [
					'container',
					'ls',
					url.searchParams.get('all') === 'true' ? '-aq' : '-q',
					...Object.entries(filters).flatMap(([key, values]) =>
						values.flatMap((value) => ['--filter', `${key}=${value}`]),
					),
				];
				const result = await invoke(args);
				return send(
					result.text
						.trim()
						.split(/\s+/)
						.filter(Boolean)
						.map((Id) => ({ Id })),
				);
			}
			if (
				p[0] === 'containers' &&
				['start', 'stop', 'restart'].includes(p[2])
			) {
				await invoke(['container', p[2], p[1]]);
				lifecycleEvent(p[2], p[1], await read('container', p[1]));
				return send(undefined, 204);
			}
			if (p[0] === 'containers' && p[2] === 'wait') {
				const running = execs.get(`attach:${p[1]}`);
				if (running?.done) await running.done;
				return send({ StatusCode: running?.exitCode ?? 0 });
			}
			if (p[0] === 'containers' && p[2] === 'stats')
				return send({ cpu_stats: {}, memory_stats: { usage: 0 } });
			if (p[0] === 'containers' && p[2] === 'logs') {
				const result = await invoke(['logs', p[1]]);
				res.setHeader('Content-Type', 'application/vnd.docker.raw-stream');
				return res.end(frame(Buffer.from(result.text)));
			}
			if (p[0] === 'images' && p[2] === 'tag') {
				await invoke([
					'image',
					'tag',
					p[1],
					`${url.searchParams.get('repo')}:${url.searchParams.get('tag')}`,
				]);
				return send(undefined, 201);
			}
			const kind = {
				containers: 'container',
				volumes: 'volume',
				networks: 'network',
				images: 'image',
			}[p[0]];
			if (kind && p[1] === 'create') {
				let resource = await read(kind, b.Name);
				if (!resource) {
					resource = { Id: b.Name, Name: b.Name, Labels: b.Labels ?? {} };
					await put(kind, b.Name, resource);
				}
				return send(resource, 201);
			}
			if (kind && req.method === 'GET') {
				if (kind === 'image' && config.imageError) return send({}, 500);
				const resource = await read(kind, p[1]);
				return send(
					resource ?? { message: 'image not known' },
					resource ? 200 : 404,
				);
			}
			if (kind && req.method === 'DELETE') {
				const resource = kind === 'container' ? await read(kind, p[1]) : undefined;
				await invoke([kind, 'rm', '-f', p[1]]);
				if (kind === 'container') lifecycleEvent('destroy', p[1], resource);
				return send(undefined, 204);
			}
			send({ message: 'unsupported fixture route' }, 404);
		} catch (e) {
			res.writeHead(500);
			res.end(JSON.stringify({ message: String(e) }));
		}
	});
	server.on('connection', (s) => {
		sockets.add(s);
		s.once('close', () => sockets.delete(s));
	});
	server.on('upgrade', async (req, socket, head) => {
		try {
			const { parts: p } = route(req);
			let bytes = head;
			const length = Number(req.headers['content-length'] ?? 0);
			while (bytes.length < length) {
				const [c] = await new Promise((resolve) =>
					socket.once('data', (...a) => resolve(a)),
				);
				bytes = Buffer.concat([bytes, c]);
			}
			const spec =
				p[0] === 'exec' ? execs.get(p[1]) : await read('container', p[1]);
			if (!spec) {
				socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
				return;
			}
			socket.write(
				'HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n',
			);
			if (p[0] === 'exec' && spec.Cmd?.[0] === '/usr/local/bin/terminay-bot-mcp' && spec.Cmd?.[1] === '--check-runtime' && await read('mcp-state', 'denied')) {
				spec.running = false;
				spec.exitCode = 1;
				socket.end(frame(Buffer.from('terminay-bot-mcp: runtime socket permission denied\n'), true));
				return;
			}
			const tty = spec.Tty ?? false;
			let args,
				extra = {};
			if (p[0] === 'exec') {
				extra = Object.fromEntries(
					(spec.Env ?? []).map((e) => {
						const n = e.indexOf('=');
						return [e.slice(0, n), e.slice(n + 1)];
					}),
				);
				args = ['exec', spec.container, ...spec.Cmd];
			} else {
				const config = spec.Config;
				lifecycleEvent('init', p[1], spec);
				lifecycleEvent('attach', p[1], spec);
				args = [
					'run',
					'--entrypoint',
					...(config.Entrypoint ?? []),
					config.Image,
					...(config.Cmd ?? []),
				];
			}
			const child = spawn(process.execPath, [script, ...args], {
				env: { ...env(), ...extra },
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			children.add(child);
			closed.emit('changed');
			if (p[0] === 'exec' && /^(shell|signin)-/.test(spec.Cmd?.[1] ?? '')) {
				terminals.add(child);
				closed.emit('changed');
				child.once('close', () => {
					terminals.delete(child);
					closed.emit('changed');
				});
			}
			const record = p[0] === 'exec' ? spec : { exitCode: 0 };
			record.running = true;
			record.done = new Promise((resolve) =>
				child.once('close', (code) => {
					record.running = false;
					record.exitCode = code ?? 1;
					resolve();
				}),
			);
			if (p[0] !== 'exec') execs.set(`attach:${p[1]}`, record);
			socket.pipe(child.stdin);
			child.stdin.on('error', () => {});
			child.stdout.on('data', (c) => socket.write(tty ? c : frame(c)));
			child.stderr.on('data', (c) => socket.write(tty ? c : frame(c, true)));
			child.once('close', () => {
				if (p[0] !== 'exec') lifecycleEvent('die', p[1], spec);
				children.delete(child);
				closed.emit('changed');
				socket.end();
			});
			socket.on('error', () => {});
			socket.once('close', () => child.kill('SIGKILL'));
		} catch {
			socket.destroy();
		}
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(socketPath, resolve);
	});
	return {
		socketPath,
		emitEvent,
		config,
		calls,
		root,
		read,
		put,
		children,
		closed,
		terminals,
		async close() {
			for (const s of sockets) s.destroy();
			for (const c of children) c.kill('SIGKILL');
			await new Promise((r) => server.close(r));
			await rm(directory, { recursive: true, force: true });
		},
	};
}
