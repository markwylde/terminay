#!/usr/bin/env node
/** Per-bot attribution proxy. Intentionally grants access to the whole engine. */
import http from 'node:http';
import net from 'node:net';
import { lstat, unlink, chmod, chown, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream';

const CREATE_BYTES = 2 * 1024 * 1024;
function creation(path, method) {
	if (method !== 'POST') return null;
	const pathname = new URL(path, 'http://engine').pathname
		.replace(/\/$/, '')
		.replace(/^\/v\d+(?:\.\d+){0,2}/, '');
	if (/^\/(containers|networks|volumes)\/create$/.test(pathname))
		return 'Labels';
	if (/^\/libpod\/(containers|networks|volumes)\/create$/.test(pathname))
		return 'labels';
	return null;
}
function headers(source) {
	const result = { ...source };
	delete result['proxy-authorization'];
	delete result['proxy-connection'];
	return result;
}
function fail(response, status, message) {
	if (response.destroyed) return;
	if (response.headersSent) return response.destroy();
	response.writeHead(status, {
		'content-type': 'application/json',
		connection: 'close',
	});
	response.end(JSON.stringify({ message }));
}
function readCreation(request) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		const clean = () => {
			request.off('data', data);
			request.off('end', end);
			request.off('aborted', aborted);
			request.off('error', error);
		};
		const error = () => {
			clean();
			reject(new Error('Creation body unavailable'));
		};
		const aborted = () => error();
		const data = (chunk) => {
			size += chunk.length;
			if (size > CREATE_BYTES) {
				clean();
				request.resume();
				const cause = new Error('Creation request exceeds 2 MiB');
				cause.status = 413;
				reject(cause);
			} else chunks.push(chunk);
		};
		const end = () => {
			clean();
			resolve(Buffer.concat(chunks));
		};
		request.on('data', data);
		request.once('end', end);
		request.once('aborted', aborted);
		request.once('error', error);
	});
}
export async function startEngineProxy({
	rawSocket,
	socketPath,
	botId,
	serverId,
	uid,
	gid,
	readyPath,
	maxConnections = 64,
}) {
	if (
		!/^[a-z0-9]{12}$/.test(botId) ||
		typeof serverId !== 'string' ||
		!serverId ||
		serverId.length > 256
	)
		throw new Error('Invalid proxy identity');
	const sockets = new Set(),
		requests = new Set();
	const agent = new http.Agent({
		keepAlive: true,
		maxSockets: maxConnections,
		maxTotalSockets: maxConnections,
		maxFreeSockets: 8,
	});
	let closed = false,
		active = 0;
	const open = (request, response, body) => {
		const requestHeaders = headers(request.headers);
		if (body) {
			delete requestHeaders['transfer-encoding'];
			delete requestHeaders.expect;
			requestHeaders['content-length'] = String(body.length);
		}
		const upstream = http.request({
			socketPath: rawSocket,
			path: request.url,
			method: request.method,
			headers: requestHeaders,
			agent,
		});
		requests.add(upstream);
		upstream.once('close', () => requests.delete(upstream));
		upstream.on('error', () =>
			fail(response, 502, 'Container engine unavailable'),
		);
		upstream.on('response', (incoming) => {
			response.writeHead(incoming.statusCode, incoming.headers);
			pipeline(incoming, response, () => {});
		});
		request.once('aborted', () => upstream.destroy());
		response.once('close', () => {
			if (!response.writableFinished) upstream.destroy();
		});
		if (body) upstream.end(body);
		else pipeline(request, upstream, () => {});
	};
	const server = http.createServer(
		{ maxHeaderSize: 64 * 1024 },
		async (request, response) => {
			if (closed) return fail(response, 503, 'Container proxy stopping');
			if (active >= maxConnections)
				return fail(response, 503, 'Container proxy busy');
			active++;
			let released = false;
			const release = () => {
				if (!released) {
					released = true;
					active--;
				}
			};
			response.once('finish', release);
			response.once('close', release);
			let field;
			try {
				field = creation(request.url, request.method);
			} catch {
				return fail(response, 400, 'Invalid engine request path');
			}
			if (!field) return open(request, response);
			if (
				request.headers['content-encoding'] &&
				request.headers['content-encoding'] !== 'identity'
			)
				return fail(
					response,
					415,
					'Creation requests must use uncompressed JSON',
				);
			if (Number(request.headers['content-length'] ?? 0) > CREATE_BYTES)
				return fail(response, 413, 'Creation request exceeds 2 MiB');
			try {
				const spec = JSON.parse(
					new TextDecoder('utf-8', { fatal: true }).decode(
						await readCreation(request),
					),
				);
				if (!spec || typeof spec !== 'object' || Array.isArray(spec))
					throw new Error('Invalid object');
				const labels = spec[field] ?? {};
				if (
					!labels ||
					typeof labels !== 'object' ||
					Array.isArray(labels) ||
					Object.values(labels).some((v) => typeof v !== 'string')
				)
					throw new Error('Invalid labels');
				spec[field] = {
					...labels,
					'terminay.server': serverId,
					'terminay.bot': botId,
					'terminay.workload': '1',
					'terminay.managed': '0',
				};
				delete spec[field]['terminay.helper'];
				open(request, response, Buffer.from(JSON.stringify(spec)));
			} catch (error) {
				fail(
					response,
					error.status === 413 ? 413 : 400,
					error.status === 413
						? 'Creation request exceeds 2 MiB'
						: 'Invalid creation request JSON or labels',
				);
			}
		},
	);
	server.maxConnections = maxConnections;
	server.maxHeadersCount = 200;
	server.headersTimeout = 15_000;
	server.requestTimeout = 300_000;
	server.keepAliveTimeout = 5_000;
	server.on('connection', (socket) => {
		sockets.add(socket);
		socket.once('close', () => sockets.delete(socket));
	});
	server.on('clientError', (_error, socket) => {
		if (socket.writable)
			socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
	});
	// Docker exec/attach use HTTP hijacking. Preserve bytes and half-close in both directions.
	server.on('upgrade', (request, client, clientHead) => {
		try {
			if (creation(request.url, request.method))
				return client.end(
					'HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n',
				);
		} catch {
			return client.destroy();
		}
		client.allowHalfOpen = true;
		client.pause();
		// Node may have parsed the HTTP body into IncomingMessage rather than head.
		// It must precede the remaining raw socket/interactive bytes upstream.
		const bufferedBody = request.read();
		const decodedChunked =
			bufferedBody && request.complete && request.headers['transfer-encoding'];
		const peer = net.createConnection({ path: rawSocket, allowHalfOpen: true });
		sockets.add(peer);
		peer.once('close', () => sockets.delete(peer));
		peer.setTimeout(5000, () => peer.destroy());
		peer.once('connect', () => {
			peer.setTimeout(0);
			const lines = [
				`${request.method} ${request.url} HTTP/${request.httpVersion}`,
			];
			for (let i = 0; i < request.rawHeaders.length; i += 2)
				if (
					!['proxy-authorization', 'proxy-connection'].includes(
						request.rawHeaders[i].toLowerCase(),
					) &&
					!(
						decodedChunked &&
						['transfer-encoding', 'content-length'].includes(
							request.rawHeaders[i].toLowerCase(),
						)
					)
				)
					lines.push(`${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}`);
			if (decodedChunked) lines.push(`Content-Length: ${bufferedBody.length}`);
			peer.write(`${lines.join('\r\n')}\r\n\r\n`);
			if (bufferedBody) peer.write(bufferedBody);
			if (clientHead.length) peer.write(clientHead);
			client.pipe(peer);
			peer.pipe(client);
			client.resume();
		});
		client.on('error', () => peer.destroy());
		peer.on('error', () => client.destroy());
		client.once('close', () => {
			if (!client.readableEnded) peer.destroy();
		});
		peer.once('close', () => {
			if (!peer.readableEnded) client.destroy();
		});
	});

	try {
		const previous = await lstat(socketPath);
		if (!previous.isSocket()) throw new Error('Proxy path is not a socket');
		await unlink(socketPath);
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(socketPath, resolve);
	});
	await chown(socketPath, uid, gid);
	await chmod(socketPath, 0o660);
	if (readyPath) await writeFile(readyPath, 'ready\n', { mode: 0o600 });
	return {
		server,
		async close() {
			closed = true;
			for (const request of requests) request.destroy();
			for (const socket of sockets) socket.destroy();
			agent.destroy();
			await new Promise((resolve) => server.close(resolve));
			await unlink(socketPath).catch(() => {});
			if (readyPath) await unlink(readyPath).catch(() => {});
		},
	};
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		const [botId, serverId, uid, gid] = process.argv.slice(2);
		// A listening client socket alone must not imply working upstream access.
		await new Promise((resolve, reject) => {
			const request = http.request(
				{
					socketPath: '/run/terminay-engine/engine.sock',
					path: '/_ping',
					agent: false,
				},
				(response) => {
					response.resume();
					response.once('end', () =>
						response.statusCode === 200
							? resolve()
							: reject(new Error('Engine unavailable')),
					);
				},
			);
			request.setTimeout(5000, () =>
				request.destroy(new Error('Engine deadline')),
			);
			request.once('error', reject);
			request.end();
		});
		const proxy = await startEngineProxy({
			rawSocket: '/run/terminay-engine/engine.sock',
			socketPath: '/var/run/docker.sock',
			readyPath: '/run/terminay-engine/ready',
			botId,
			serverId,
			uid: Number(uid),
			gid: Number(gid),
		});
		const stop = () => proxy.close().then(() => process.exit(0));
		process.once('SIGTERM', stop);
		process.once('SIGINT', stop);
	} catch {
		console.error('terminay-engine-proxy: startup failed');
		process.exit(78);
	}
}
