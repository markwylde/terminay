import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Stand-ins for the two things a running server offers the CLI: the owner-only
 * approval socket inside the data root, and the loopback health endpoint.
 */

export async function startFakeApprovalSocket(dataRoot, script) {
	await mkdir(dataRoot, { recursive: true, mode: 0o700 });
	const socketPath = join(dataRoot, 'approval.sock');
	const requests = [];
	const server = createServer((socket) => {
		let buffered = '';
		socket.setEncoding('utf8');
		socket.on('data', (chunk) => {
			buffered += chunk;
			const newline = buffered.indexOf('\n');
			if (newline < 0) return;
			const request = JSON.parse(buffered.slice(0, newline));
			requests.push(request);
			socket.end(`${JSON.stringify(script(request, requests.length))}\n`);
		});
		socket.on('error', () => {});
	});
	await new Promise((resolve) => server.listen(socketPath, resolve));
	return {
		socketPath,
		requests,
		async close() {
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

export async function startFakeHealthServer(snapshots) {
	let index = 0;
	const server = createHttpServer((request, response) => {
		const snapshot = snapshots[Math.min(index, snapshots.length - 1)];
		index += 1;
		const body = JSON.stringify(snapshot);
		response.writeHead(snapshot.ready ? 200 : 503, {
			'content-type': 'application/json',
			'content-length': Buffer.byteLength(body),
		});
		response.end(body);
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	return {
		port: server.address().port,
		async close() {
			await new Promise((resolve) => server.close(resolve));
		},
	};
}
