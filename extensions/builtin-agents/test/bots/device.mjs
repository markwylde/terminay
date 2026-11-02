import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';

/** Loopback issuer for the pinned CLI's device-code prompt. Never issues credentials. */
export async function fakeDeviceIssuer({ listen = true } = {}) {
	const requests = [];
	const handle = async (request, response) => {
		requests.push(request.url);
		for await (const _chunk of request) {
			/* discard the public client id */
		}
		if (request.url === '/api/accounts/deviceauth/usercode') {
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(
				JSON.stringify({
					device_auth_id: 'test-device',
					user_code: 'TEST-CODE',
					interval: '1',
				}),
			);
		} else if (request.url === '/api/accounts/deviceauth/token') {
			// The prompt is the conformance target; the user never approves this code.
			response.writeHead(403).end();
		} else response.writeHead(404).end();
	};
	const server = createServer(handle);
	if (listen) {
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
	}
	return {
		handle,
		requests,
		url: listen ? `http://127.0.0.1:${server.address().port}` : null,
		close: () =>
			new Promise((resolve) => {
				server.close(resolve);
				server.closeAllConnections();
			}),
	};
}

export async function checkDevicePrompt(device, env) {
	const issuer = await fakeDeviceIssuer();
	let child;
	try {
		// The CLI's test issuer override keeps the declared login command offline.
		// See openai/codex: codex-rs/login/src/device_code_auth.rs and cli/src/main.rs.
		child = spawn(
			device.command.executable,
			[...device.command.args, '--experimental_issuer', issuer.url],
			{
				env,
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);
		const exited = once(child, 'exit');
		let output = '';
		await new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error('device sign-in prompt deadline')),
				15000,
			);
			const data = (bytes) => {
				output += bytes.toString();
				if (
					output.includes(`${issuer.url}/codex/device`) &&
					output.includes('TEST-CODE')
				) {
					clearTimeout(timer);
					resolve();
				}
			};
			child.stdout.on('data', data);
			child.stderr.on('data', data);
			exited.then(
				() => {
					clearTimeout(timer);
					reject(new Error(`device command exited before URL/code: ${output}`));
				},
				(error) => {
					clearTimeout(timer);
					reject(error);
				},
			);
		});
		assert.ok(issuer.requests.includes('/api/accounts/deviceauth/usercode'));
		child.kill('SIGKILL');
		await exited;
	} finally {
		child?.kill('SIGKILL');
		await issuer.close();
	}
}
