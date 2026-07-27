import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const {
	AGENT_HOOK_PATH,
	AGENT_HOOK_TOKEN_HEADER,
	createAgentHookServer,
	isLoopbackAddress,
} = await importBundled('../electron/agentStatus/hookServer.ts');
const {
	TERMINAY_AGENT_HOOK_ENDPOINT_ENV,
	TERMINAY_AGENT_HOOK_TOKEN_ENV,
	TERMINAY_SESSION_ID_ENV,
	createAgentHookEnvironment,
} = await importBundled('../electron/agentStatus/environment.ts');
const { AgentStatusService } = await importBundled(
	'../electron/agentStatus/service.ts',
);

test('PTY hook environment carries exact terminal identity and receiver credentials', () => {
	assert.deepEqual(
		createAgentHookEnvironment(
			'terminal-session-uuid',
			'http://127.0.0.1:123/hook',
			'secret',
		),
		{
			[TERMINAY_SESSION_ID_ENV]: 'terminal-session-uuid',
			[TERMINAY_AGENT_HOOK_ENDPOINT_ENV]: 'http://127.0.0.1:123/hook',
			[TERMINAY_AGENT_HOOK_TOKEN_ENV]: 'secret',
		},
	);
});

test('hook receiver is loopback-only and publishes an authenticated endpoint', async () => {
	assert.equal(isLoopbackAddress('127.0.0.1'), true);
	assert.equal(isLoopbackAddress('127.250.1.9'), true);
	assert.equal(isLoopbackAddress('::1'), true);
	assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
	assert.equal(isLoopbackAddress('0.0.0.0'), false);
	assert.equal(isLoopbackAddress('192.168.1.2'), false);
	assert.throws(
		() => createAgentHookServer({ host: '0.0.0.0', handleRequest() {} }),
		/loopback/,
	);

	const server = createAgentHookServer({
		token: 'test-token',
		handleRequest() {},
	});
	await server.start();
	try {
		const endpoint = new URL(server.endpoint);
		assert.equal(endpoint.hostname, '127.0.0.1');
		assert.equal(endpoint.pathname, AGENT_HOOK_PATH);
		assert.equal(server.token, 'test-token');
		const originalEndpoint = server.endpoint;
		await server.stop();
		await server.start();
		assert.equal(server.endpoint, originalEndpoint);
	} finally {
		await server.stop();
	}
});

test('hook receiver validates method, path, token, content type and JSON body', async () => {
	let handled = 0;
	const server = createAgentHookServer({
		token: 'test-token',
		handleRequest() {
			handled += 1;
		},
	});
	await server.start();

	try {
		const wrongPath = await fetch(new URL('/wrong', server.endpoint), {
			method: 'POST',
			headers: authorizedHeaders(),
			body: '{}',
		});
		assert.equal(wrongPath.status, 404);

		const wrongMethod = await fetch(server.endpoint, {
			method: 'PUT',
			headers: authorizedHeaders(),
			body: '{}',
		});
		assert.equal(wrongMethod.status, 405);
		assert.equal(wrongMethod.headers.get('allow'), 'POST');

		const missingToken = await fetch(server.endpoint, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		});
		assert.equal(missingToken.status, 401);

		const badToken = await fetch(server.endpoint, {
			method: 'POST',
			headers: authorizedHeaders('wrong'),
			body: '{}',
		});
		assert.equal(badToken.status, 401);

		const wrongContentType = await fetch(server.endpoint, {
			method: 'POST',
			headers: {
				[AGENT_HOOK_TOKEN_HEADER]: 'test-token',
				'content-type': 'text/plain',
			},
			body: '{}',
		});
		assert.equal(wrongContentType.status, 415);

		const invalidJson = await fetch(server.endpoint, {
			method: 'POST',
			headers: authorizedHeaders(),
			body: '{',
		});
		assert.equal(invalidJson.status, 400);

		const nonObject = await fetch(server.endpoint, {
			method: 'POST',
			headers: authorizedHeaders(),
			body: '[]',
		});
		assert.equal(nonObject.status, 400);
		assert.equal(handled, 0);
	} finally {
		await server.stop();
	}
});

test('hook receiver rejects declared and streamed oversize payloads', async () => {
	const server = createAgentHookServer({
		token: 'test-token',
		maxBodyBytes: 16,
		handleRequest() {
			assert.fail('oversize payload reached handler');
		},
	});
	await server.start();

	try {
		const response = await fetch(server.endpoint, {
			method: 'POST',
			headers: authorizedHeaders(),
			body: JSON.stringify({ value: 'too large' }),
		});
		assert.equal(response.status, 413);

		const streamed = await rawHttpRequest(
			server.endpoint,
			[
				'POST /v1/agent-events HTTP/1.1',
				`Host: ${new URL(server.endpoint).host}`,
				'Transfer-Encoding: chunked',
				'Content-Type: application/json',
				`${AGENT_HOOK_TOKEN_HEADER}: test-token`,
				'Connection: close',
				'',
				'11',
				'{"value":"12345"}',
				'0',
				'',
				'',
			].join('\r\n'),
		);
		assert.match(streamed, /^HTTP\/1\.1 413 /);
	} finally {
		await server.stop();
	}
});

test('valid requests are processed serially and handler errors are isolated', async () => {
	const order = [];
	const releases = [];
	const server = createAgentHookServer({
		token: 'test-token',
		async handleRequest({ body }) {
			order.push(`start:${body.sequence}`);
			if (body.fail) {
				throw new Error('private failure');
			}
			await new Promise((resolve) => releases.push(resolve));
			order.push(`end:${body.sequence}`);
		},
	});
	await server.start();

	try {
		const first = post(server.endpoint, { sequence: 1 });
		await waitFor(() => order.length === 1);
		const second = post(server.endpoint, { sequence: 2 });
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.deepEqual(order, ['start:1']);

		releases.shift()();
		assert.equal((await first).status, 202);
		await waitFor(() => order.includes('start:2'));
		releases.shift()();
		assert.equal((await second).status, 202);
		assert.deepEqual(order, ['start:1', 'end:1', 'start:2', 'end:2']);

		const failed = await post(server.endpoint, { fail: true, sequence: 3 });
		assert.equal(failed.status, 500);
		assert.deepEqual(await failed.json(), {
			accepted: false,
			error: 'The hook payload could not be processed.',
		});

		const afterFailure = post(server.endpoint, { sequence: 4 });
		await waitFor(() => order.includes('start:4'));
		releases.shift()();
		assert.equal((await afterFailure).status, 202);
	} finally {
		await server.stop();
	}
});

test('status service binds normalized events to an active terminal and publishes ordered snapshots', async () => {
	const seenContexts = [];
	const service = new AgentStatusService({
		token: 'service-token',
		now: () => 100,
		normalizeHookPayload(provider, payload, context) {
			seenContexts.push({ provider, payload, context });
			return {
				kind: payload.kind,
				provider,
				sessionId: 'provider-session',
				activationTerminalSessionId: context.activationTerminalSessionId,
				sequence: context.sequence,
				occurredAt: context.occurredAt,
			};
		},
	});
	const revisions = [];
	const unsubscribe = service.subscribe((snapshot) =>
		revisions.push(snapshot.revision),
	);
	await service.start();

	try {
		const env = service.prepareTerminalSession('terminal-uuid');
		assert.equal(env[TERMINAY_SESSION_ID_ENV], 'terminal-uuid');
		assert.equal(env[TERMINAY_AGENT_HOOK_TOKEN_ENV], 'service-token');

		const first = await fetch(env[TERMINAY_AGENT_HOOK_ENDPOINT_ENV], {
			method: 'POST',
			headers: serviceHeaders(env, 'codex'),
			body: JSON.stringify({
				kind: 'session.started',
				sequence: 1,
				occurredAt: 10,
			}),
		});
		assert.equal(first.status, 202);

		const second = await fetch(env[TERMINAY_AGENT_HOOK_ENDPOINT_ENV], {
			method: 'POST',
			headers: serviceHeaders(env, 'codex'),
			body: JSON.stringify({
				kind: 'turn.started',
				sequence: 2,
				occurredAt: 20,
			}),
		});
		assert.equal(second.status, 202);
		assert.deepEqual(revisions, [1, 2]);
		assert.deepEqual(
			seenContexts.map(({ context }) => context.sequence),
			[1, 2],
		);
		assert.equal(
			seenContexts[0].context.activationTerminalSessionId,
			'terminal-uuid',
		);

		const [entry] = Object.values(service.getSnapshot().entries);
		assert.equal(entry.activationTerminalSessionId, 'terminal-uuid');
		assert.equal(entry.terminalSessionId, 'terminal-uuid');
		assert.equal(entry.state, 'working');
	} finally {
		unsubscribe();
		await service.stop();
	}
});

test('status service correlates driver-identified launch metadata with the next subagent', async () => {
	const service = new AgentStatusService({
		token: 'service-token',
		now: () => 100,
		normalizeHookPayload(provider, payload, context) {
			return {
				...payload,
				provider,
				sessionId: 'provider-session',
				activationTerminalSessionId: context.activationTerminalSessionId,
				sequence: context.sequence,
				occurredAt: context.occurredAt,
			};
		},
	});
	await service.start();
	try {
		service.prepareTerminalSession('terminal-uuid');
		await service.ingestHookPayload('codex', 'terminal-uuid', {
			kind: 'session.started',
		});
		await service.ingestHookPayload('codex', 'terminal-uuid', {
			kind: 'tool.started',
			tool: {
				id: 'spawn-1',
				name: 'Agent',
				subagentLaunch: {
					displayName: 'math_one',
					promptText: 'What is 2 + 2?',
				},
			},
		});
		await service.ingestHookPayload('codex', 'terminal-uuid', {
			kind: 'subagent.started',
			subagentId: 'child-1',
			displayName: 'default',
		});

		const child = Object.values(service.getSnapshot().entries).find(
			(entry) => entry.kind === 'subagent',
		);
		assert.equal(child.displayName, 'math_one');
		assert.equal(child.promptText, 'What is 2 + 2?');
	} finally {
		await service.stop();
	}
});

test('status service rejects unknown sessions and identity changes from drivers', async () => {
	const service = new AgentStatusService({
		token: 'service-token',
		normalizeHookPayload(provider, payload, context) {
			return {
				kind: 'session.started',
				provider,
				sessionId: 'provider-session',
				activationTerminalSessionId:
					payload.changeIdentity === true
						? 'other-terminal'
						: context.activationTerminalSessionId,
				sequence: 1,
				occurredAt: 1,
			};
		},
	});
	await service.start();

	try {
		const endpoint =
			service.prepareTerminalSession('known')[TERMINAY_AGENT_HOOK_ENDPOINT_ENV];
		const unknown = await fetch(endpoint, {
			method: 'POST',
			headers: {
				...authorizedHeaders('service-token'),
				'x-terminay-session-id': 'unknown',
				'x-terminay-agent-provider': 'codex',
			},
			body: '{}',
		});
		assert.equal(unknown.status, 409);

		const changed = await fetch(endpoint, {
			method: 'POST',
			headers: {
				...authorizedHeaders('service-token'),
				'x-terminay-session-id': 'known',
				'x-terminay-agent-provider': 'codex',
			},
			body: JSON.stringify({ changeIdentity: true }),
		});
		assert.equal(changed.status, 422);
		assert.equal(service.getSnapshot().revision, 0);
	} finally {
		await service.stop();
	}
});

test('terminal exit closes active root agents without inventing output-derived status', async () => {
	let now = 50;
	const service = new AgentStatusService({
		token: 'service-token',
		now: () => now,
		normalizeHookPayload(provider, _payload, context) {
			return {
				kind: 'session.started',
				provider,
				sessionId: 'provider-session',
				activationTerminalSessionId: context.activationTerminalSessionId,
				sequence: context.sequence,
				occurredAt: context.occurredAt,
			};
		},
	});
	await service.start();
	try {
		const env = service.prepareTerminalSession('terminal-uuid');
		const response = await fetch(env[TERMINAY_AGENT_HOOK_ENDPOINT_ENV], {
			method: 'POST',
			headers: serviceHeaders(env, 'claude-code'),
			body: JSON.stringify({ sequence: 4, occurredAt: 40 }),
		});
		assert.equal(response.status, 202);

		now = 60;
		service.terminalExited('terminal-uuid', { exitCode: 9, signal: 'SIGKILL' });
		const [entry] = Object.values(service.getSnapshot().entries);
		assert.equal(entry.active, false);
		assert.equal(entry.state, 'done');
		assert.equal(entry.exitCode, 9);
		assert.equal(entry.exitSignal, 'SIGKILL');
		assert.equal(entry.lastEventSequence, 2);

		const late = await fetch(env[TERMINAY_AGENT_HOOK_ENDPOINT_ENV], {
			method: 'POST',
			headers: serviceHeaders(env, 'claude-code'),
			body: JSON.stringify({ sequence: 6, occurredAt: 70 }),
		});
		assert.equal(late.status, 409);
	} finally {
		await service.stop();
	}
});

test('confirmed provider-to-shell return retires a live session', async () => {
	const service = new AgentStatusService({
		token: 'service-token',
		foregroundExitConfirmationMs: 10,
		normalizeHookPayload(provider, _payload, context) {
			return {
				kind: 'session.started', provider, sessionId: 'provider-session',
				activationTerminalSessionId: context.activationTerminalSessionId,
				sequence: context.sequence, occurredAt: context.occurredAt,
			};
		},
	});
	await service.start();
	try {
		service.prepareTerminalSession('terminal-uuid');
		await service.ingestHookPayload('codex', 'terminal-uuid', {});
		service.foregroundProcessChanged('terminal-uuid', 'codex', false);
		service.foregroundProcessChanged('terminal-uuid', 'zsh', true);
		await new Promise((resolve) => setTimeout(resolve, 25));
		const [entry] = Object.values(service.getSnapshot().entries);
		assert.equal(entry.active, false);
		assert.equal(entry.lastEventKind, 'session.stopped');
	} finally {
		await service.stop();
	}
});

function authorizedHeaders(token = 'test-token') {
	return {
		[AGENT_HOOK_TOKEN_HEADER]: token,
		'content-type': 'application/json',
	};
}

function post(endpoint, body) {
	return fetch(endpoint, {
		method: 'POST',
		headers: authorizedHeaders(),
		body: JSON.stringify(body),
	});
}

function serviceHeaders(env, provider) {
	return {
		'content-type': 'application/json',
		'x-terminay-agent-hook-token': env[TERMINAY_AGENT_HOOK_TOKEN_ENV],
		'x-terminay-session-id': env[TERMINAY_SESSION_ID_ENV],
		'x-terminay-agent-provider': provider,
	};
}

async function waitFor(predicate) {
	const timeoutAt = Date.now() + 2_000;
	while (!predicate()) {
		if (Date.now() > timeoutAt) {
			throw new Error('Timed out waiting for condition');
		}
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
}

async function rawHttpRequest(endpoint, request) {
	const { connect } = await import('node:net');
	const url = new URL(endpoint);
	return new Promise((resolve, reject) => {
		const socket = connect(Number(url.port), url.hostname);
		let response = '';
		socket.setEncoding('utf8');
		socket.on('connect', () => socket.end(request));
		socket.on('data', (chunk) => {
			response += chunk;
		});
		socket.on('end', () => resolve(response));
		socket.on('error', reject);
	});
}

async function importBundled(relativePath) {
	const tempDir = await mkdtemp(join(tmpdir(), 'terminay-agent-hook-test-'));
	const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`);
	await build({
		bundle: true,
		entryPoints: [new URL(relativePath, import.meta.url).pathname],
		format: 'esm',
		outfile: outputPath,
		platform: 'node',
		target: 'node20',
	});
	return import(outputPath);
}
