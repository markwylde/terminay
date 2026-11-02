import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startEngineProxy } from '../../../docker/terminay-bot/bin/terminay-engine-proxy.mjs';

const bot = 'abc123def456', other = 'abc123def457';
async function setup(t, handler) {
	const directory = await mkdtemp(join(tmpdir(), 'bot-proxy-'));
	const rawSocket = join(directory, 'engine.sock'), socketPath = join(directory, 'bot.sock');
	const calls = [];
	const engine = http.createServer(async (request, response) => {
		const chunks = []; for await (const chunk of request) chunks.push(chunk);
		const body = Buffer.concat(chunks);
		calls.push({ path: request.url, method: request.method, headers: request.headers, body });
		if (handler) return handler(request, response, body);
		response.writeHead(201, { 'content-type': 'application/json', 'x-engine': 'preserved' });
		response.end(JSON.stringify({ Id: 'created' }));
	});
	await new Promise((resolve) => engine.listen(rawSocket, resolve));
	const proxies = [];
	const createProxy = async (id, path = socketPath) => {
		const proxy = await startEngineProxy({ rawSocket, socketPath: path, botId: id, serverId: 'test-server', uid: process.getuid(), gid: process.getgid() });
		proxies.push(proxy); return proxy;
	};
	const proxy = await createProxy(bot);
	t.after(async () => { for (const p of proxies) await p.close(); engine.closeAllConnections(); await new Promise(resolve => engine.close(resolve)); await rm(directory, { recursive: true, force: true }); });
	return { directory, socketPath, rawSocket, calls, engine, proxy, createProxy };
}
function call(socketPath, path, { method = 'POST', body = '', headers = {}, chunks } = {}) {
	return new Promise((resolve, reject) => {
		const request = http.request({ socketPath, path, method, headers, agent: false }, async response => {
			const pieces = []; for await (const piece of response) pieces.push(piece);
			resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(pieces) });
		});
		request.once('error', reject);
		if (chunks) { for (const chunk of chunks) request.write(chunk); request.end(); }
		else request.end(body);
	});
}

test('proxy attributes Docker and native Podman creation, preserves Compose labels and separates bots', async t => {
	const r = await setup(t);
	const second = join(r.directory, 'second.sock'); await r.createProxy(other, second);
	for (const [path, field] of [
		['/containers/create?name=compose-service', 'Labels'],
		['/v1.47/containers/create?name=direct', 'Labels'],
		['/v1.41/networks/create', 'Labels'], ['/volumes/create', 'Labels'],
		['/v5.0.0/libpod/containers/create', 'labels'],
		['/v5.0.0/libpod/networks/create', 'labels'], ['/v5.0.0/libpod/volumes/create', 'labels'],
	]) {
		for (const [socketPath, id] of [[r.socketPath, bot], [second, other]]) {
			const labels = { 'com.docker.compose.project': 'demo', custom: 'kept', 'terminay.bot': 'forged', 'terminay.server': 'forged', 'terminay.helper': 'forged' };
			const input = { Image: 'postgres', [field]: labels };
			const response = await call(socketPath, path, { body: JSON.stringify(input), headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(JSON.stringify(input)) } });
			assert.equal(response.status, 201); assert.equal(response.headers['x-engine'], 'preserved');
			const sent = r.calls.at(-1), actual = JSON.parse(sent.body)[field];
			assert.equal(sent.path, path); assert.equal(actual['terminay.bot'], id); assert.equal(actual['terminay.server'], 'test-server');
			assert.equal(actual['terminay.workload'], '1'); assert.equal(actual['terminay.managed'], '0');
			assert.equal(actual['terminay.helper'], undefined); assert.equal(actual.custom, 'kept');
			assert.equal(actual['com.docker.compose.project'], 'demo'); assert.equal(Number(sent.headers['content-length']), sent.body.length);
		}
	}
	assert.equal((await stat(r.socketPath)).mode & 0o777, 0o660);
});

test('proxy passes other-container control, lists, credentials and binary uploads through without relabelling', async t => {
	const r = await setup(t, (_request, response, body) => { response.writeHead(202, { 'content-type': 'application/octet-stream' }); response.end(body); });
	const bytes = Buffer.from([0, 255, 1, 128, 9]);
	for (const [method, path] of [['GET', '/v1.47/containers/json?all=1'], ['POST', '/containers/someone-elses/stop'], ['POST', '/build?tag=demo'], ['PUT', '/containers/another/archive?path=/tmp']]) {
		const result = await call(r.socketPath, path, { method, body: bytes, headers: { 'content-length': bytes.length, 'x-registry-auth': 'private-test-auth' } });
		assert.equal(result.status, 202); assert.deepEqual(result.body, bytes);
		assert.equal(r.calls.at(-1).path, path); assert.equal(r.calls.at(-1).headers['x-registry-auth'], 'private-test-auth');
		assert.deepEqual(r.calls.at(-1).body, bytes);
	}
});

test('invalid, compressed and oversized creation requests never reach the engine', async t => {
	const r = await setup(t);
	for (const body of ['{', 'null', '[]', '{"Labels":[]}', '{"Labels":{"bad":1}}'])
		assert.equal((await call(r.socketPath, '/containers/create', { body })).status, 400);
	assert.equal((await call(r.socketPath, '/containers/create', { body: '{}', headers: { 'content-encoding': 'gzip' } })).status, 415);
	assert.equal((await call(r.socketPath, '/containers/create', { headers: {'content-length': 2 * 1024 * 1024 + 1} })).status, 413);
	assert.equal((await call(r.socketPath, '/containers/create', { chunks: [Buffer.alloc(1024 * 1024), Buffer.alloc(1024 * 1024 + 1)] })).status, 413);
	assert.equal(r.calls.length, 0);
});

test('streamed build uploads and log bytes pass through with backpressure', async t => {
	const r = await setup(t, (_request, response, body) => {
		response.writeHead(200, { 'content-type': 'application/octet-stream' });
		response.write(body.subarray(0, 13)); setImmediate(() => response.end(body.subarray(13)));
	});
	const chunks = Array.from({ length: 40 }, (_, n) => Buffer.alloc(64 * 1024, n));
	const result = await call(r.socketPath, '/v1.47/build?dockerfile=Dockerfile', { chunks });
	assert.deepEqual(result.body, Buffer.concat(chunks));
	assert.equal(result.status, 200);
});

test('interactive exec preserves HTTP upgrade bytes and output after stdin half-close', { timeout: 10000 }, async t => {
	const r = await setup(t);
	const body = JSON.stringify({Detach:false,Tty:false});
	r.engine.on('upgrade', (request, socket, head) => {
		socket.allowHalfOpen = true;
		let pending=Buffer.alloc(0), upgraded=false;
		const input=bytes=>{
			if(upgraded)return socket.write(bytes);
			pending=Buffer.concat([pending,bytes]);
			if(pending.length<Number(request.headers['content-length']))return;
			assert.equal(pending.subarray(0,body.length).toString(),body);
			upgraded=true;socket.write('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');
			if(pending.length>body.length)socket.write(pending.subarray(body.length));
		};
		socket.on('data',input);if(request.readableLength)input(request.read());if(head.length)input(head);
		socket.on('end', () => socket.end(Buffer.from([255, 0, 128])));
	});
	const request = http.request({ socketPath: r.socketPath, path: '/v1.47/exec/an-exec/start', method: 'POST', headers: { connection: 'Upgrade', upgrade: 'tcp', 'content-length': Buffer.byteLength(body) }, agent: false });
	request.write(body.slice(0,5));setImmediate(()=>request.end(body.slice(5)));
	const [, socket, head] = await once(request, 'upgrade'); socket.allowHalfOpen = true;
	const chunks = [head]; socket.on('data', bytes => chunks.push(bytes));
	socket.end(Buffer.from([0, 1, 2, 3])); await once(socket, 'end');
	assert.deepEqual(Buffer.concat(chunks), Buffer.from([0, 1, 2, 3, 255, 0, 128]));
});

test('shutdown cancels outstanding streams and releases the owned socket', { timeout: 10000 }, async t => {
	const r = await setup(t, (_request, response) => { response.writeHead(200); response.write('streaming'); });
	const request = http.request({ socketPath: r.socketPath, path: '/events', method: 'GET', agent: false }); request.end();
	const [response] = await once(request, 'response'); response.resume();
	response.on('error', () => {});
	const closed = new Promise(resolve => response.once('close', resolve)); await r.proxy.close(); await closed;
	await assert.rejects(stat(r.socketPath), { code: 'ENOENT' });
	// Idempotent close is used by signal/shutdown paths.
	await r.proxy.close();
});

test('legacy HTTP 200 hijacked exec also preserves bidirectional input and half-close', { timeout: 10000 }, async t => {
	const r = await setup(t);
	r.engine.on('upgrade', (_request, socket) => {
		socket.allowHalfOpen = true;
		socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/vnd.docker.raw-stream\r\nConnection: close\r\n\r\n');
		socket.on('data', bytes => socket.write(bytes));
		socket.on('end', () => socket.end('after-eof'));
	});
	const client = net.createConnection({ path: r.socketPath, allowHalfOpen: true });
	let wire = Buffer.alloc(0), sent = false;
	client.on('data', bytes => {
		wire = Buffer.concat([wire, bytes]);
		if (!sent && wire.includes('\r\n\r\n')) { sent = true; client.end('input'); }
	});
	client.write('POST /exec/id/start HTTP/1.1\r\nHost: engine\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');
	await once(client, 'end');
	assert.equal(wire.subarray(wire.indexOf('\r\n\r\n') + 4).toString(), 'inputafter-eof');
});

test('upgrade forwards an HTTP body already buffered by the server parser before raw bytes', { timeout: 10000 }, async t => {
	const r=await setup(t), body='{"Detach":false,"Tty":false}';
	const handler=r.proxy.server.listeners('upgrade')[0];
	r.proxy.server.removeAllListeners('upgrade');
	r.proxy.server.on('upgrade',(request,client,head)=>{
		// Simulate the parser boundary without changing the live HTTP parser's state.
		const parsed=Object.create(request);
		Object.defineProperty(parsed,'headers',{value:{...request.headers,'content-length':String(body.length)}});
		Object.defineProperty(parsed,'rawHeaders',{value:request.rawHeaders.map((value,index)=>index>0 && request.rawHeaders[index-1].toLowerCase()==='content-length'?String(body.length):value)});
		parsed.read=()=>Buffer.from(body);parsed.complete=true;
		handler(parsed,client,head);
	});
	r.engine.on('upgrade',(request,socket,head)=>{
		let pending=Buffer.alloc(0);
		const read=bytes=>{pending=Buffer.concat([pending,bytes]);if(pending.length<body.length)return;
			assert.equal(pending.toString(),body);
			socket.end('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\nconfirmed');
		};
		socket.on('data',read);if(request.readableLength)read(request.read());if(head.length)read(head);
	});
	const client=net.createConnection({path:r.socketPath});let output='';client.on('data',bytes=>output+=bytes.toString());
	client.write(`POST /exec/id/start HTTP/1.1\r\nHost: engine\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Length: 0\r\n\r\n`);
	await once(client,'end');assert.ok(output.endsWith('confirmed'));
});

test('cancelled creation and upstream failure produce no unlabelled side effects', async t => {
	const r = await setup(t);
	const client = net.createConnection({ path: r.socketPath }); await once(client, 'connect');
	client.write('POST /containers/create HTTP/1.1\r\nHost: engine\r\nContent-Length: 9999\r\n\r\n{"Image":');
	client.destroy(); await new Promise(resolve => setImmediate(resolve));
	assert.equal(r.calls.length, 0);
	const result = await call(r.socketPath, '/containers/create', { body: '{}' }); assert.equal(result.status, 201);
	r.engine.closeAllConnections(); await new Promise(resolve => r.engine.close(resolve));
	const unavailable = await call(r.socketPath, '/_ping', {method:'GET'});
	assert.equal(unavailable.status,502); assert.equal(unavailable.body.toString(), '{"message":"Container engine unavailable"}');
});
