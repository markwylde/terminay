// Runs only inside the bot image against a loopback fake model. No real credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir, readFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fakeModel } from './model.mjs';

assert.equal(process.env.HOME, '/home/bot');
const fake = await fakeModel();
const mcpScript = new URL('./native-mcp.mjs', import.meta.url).pathname;
const key = 'terminay-native-gate-synthetic-key';
async function checkClaude(allow, action = 'tool') {
	await rm('/home/bot/tool-proof.json', { force: true });
	await rm('/home/bot/mcp-proof.json', { force: true });
	fake.next(action);
	const child = spawn(
		'claude',
		[
			'-p',
			'--input-format',
			'stream-json',
			'--output-format',
			'stream-json',
			'--verbose',
			'--include-partial-messages',
			'--bare',
			'--no-session-persistence',
			'--permission-mode',
			'manual',
			'--permission-prompts',
			'host',
			'--permission-prompt-tool',
			'stdio',
			'--model',
			'fake/conformance',
			'--strict-mcp-config',
			'--mcp-config',
			JSON.stringify({
				mcpServers: { terminay_bot: { command: 'node', args: [mcpScript] } },
			}),
		],
		{
			cwd: '/home/bot',
			env: {
				PATH: process.env.PATH,
				HOME: '/home/bot',
				LANG: 'C.UTF-8',
				ANTHROPIC_API_KEY: key,
				ANTHROPIC_BASE_URL: fake.url,
				CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
				CLAUDE_CODE_MAX_RETRIES: '0',
				CLAUDE_CODE_SHELL_PREFIX: '/usr/local/bin/terminay-tool-shell',
				TERMINAY_CREDENTIAL_VARIABLES: 'ANTHROPIC_API_KEY',
			},
			stdio: ['pipe', 'pipe', 'pipe'],
		},
	);
	const events = [];
	let stderr = '';
	let permissions = 0;
	child.stderr.on('data', (c) => {
		stderr = (stderr + c).slice(-8192);
	});
	const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
	const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
	const closed = new Promise((resolve) =>
		child.once('close', (code) => resolve(code)),
	);
	send({
		type: 'control_request',
		request_id: 'init',
		request: { subtype: 'initialize' },
	});
	for await (const line of createInterface({ input: child.stdout })) {
		const e = JSON.parse(line);
		events.push(e);
		if (e.type === 'control_response' && e.response.request_id === 'init')
			send({
				type: 'user',
				message: { role: 'user', content: 'Perform the conformance check.' },
				parent_tool_use_id: null,
				session_id: '',
			});
		if (e.type === 'control_request' && e.request.subtype === 'can_use_tool') {
			permissions++;
			assert.ok(
				action === 'mcp'
					? e.request.tool_name.includes('chat_post')
					: e.request.tool_name === 'Bash',
			);
			send({
				type: 'control_response',
				response: {
					subtype: 'success',
					request_id: e.request_id,
					response: allow
						? { behavior: 'allow', updatedInput: e.request.input }
						: { behavior: 'deny', message: 'Denied by conformance test' },
				},
			});
		}
		if (e.type === 'result') child.stdin.end();
	}
	clearTimeout(timer);
	const exit = await closed;
	if (fake.state.rejectAuth) {
		assert.notEqual(exit, 0);
		console.log('claude native authentication rejection passed');
		return;
	}
	assert.equal(exit, 0, `${stderr}\n${JSON.stringify(events)}`);
	assert.equal(permissions, 1, JSON.stringify(events));
	assert.ok(
		events.some((e) => e.type === 'result' && !e.is_error),
		JSON.stringify(events),
	);
	if (allow && action === 'mcp')
		assert.equal(
			JSON.parse(await readFile('/home/bot/mcp-proof.json', 'utf8')).arguments
				.text,
			'native-mcp-proof',
		);
	else if (allow) {
		const proof = JSON.parse(
			await readFile('/home/bot/tool-proof.json', 'utf8'),
		);
		assert.deepEqual(proof.credentials, []);
	} else
		await assert.rejects(readFile('/home/bot/tool-proof.json'), {
			code: 'ENOENT',
		});
	console.log(`claude native permission ${allow ? 'allow' : 'deny'} passed`);
}
async function checkCodex(action = 'tool') {
	await rm('/home/bot/mcp-proof.json', { force: true });
	await rm('/home/bot/tool-proof.json', { force: true });
	fake.next(action);
	const args = [
		'exec',
		'--json',
		'--skip-git-repo-check',
		'--dangerously-bypass-approvals-and-sandbox',
		'--model',
		'fake/conformance',
		'-c',
		'model_provider="fake"',
		'-c',
		'model_providers.fake.name="Fake"',
		'-c',
		`model_providers.fake.base_url="${fake.url}/v1"`,
		'-c',
		'model_providers.fake.wire_api="responses"',
		'-c',
		'model_providers.fake.env_key="CODEX_API_KEY"',
		'-c',
		'mcp_servers.terminay_bot.command="node"',
		'-c',
		`mcp_servers.terminay_bot.args=${JSON.stringify([mcpScript])}`,
		'-c',
		'cli_auth_credentials_store="ephemeral"',
		'-c',
		'shell_environment_policy.exclude=["CODEX_API_KEY","OPENAI_API_KEY"]',
		'Perform the conformance check.',
	];
	const child = spawn('codex', args, {
		cwd: '/home/bot',
		env: { PATH: process.env.PATH, HOME: '/home/bot', CODEX_API_KEY: key },
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	child.stdin.end();
	let stdout = '';
	let stderr = '';
	child.stdout.on('data', (c) => (stdout += c));
	child.stderr.on('data', (c) => (stderr = (stderr + c).slice(-8192)));
	const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
	const code = await new Promise((resolve) => child.once('close', resolve));
	clearTimeout(timer);
	if (fake.state.rejectAuth) {
		assert.notEqual(code, 0);
		console.log('codex native authentication rejection passed');
		return;
	}
	assert.equal(code, 0, `${stderr}\n${stdout}`);
	assert.ok(
		stdout
			.split('\n')
			.filter(Boolean)
			.map((l) => JSON.parse(l))
			.some((e) => e.type === 'turn.completed'),
		stdout,
	);
	if (action === 'mcp')
		assert.equal(
			JSON.parse(await readFile('/home/bot/mcp-proof.json', 'utf8')).arguments
				.text,
			'native-mcp-proof',
		);
	else {
		const proof = JSON.parse(
			await readFile('/home/bot/tool-proof.json', 'utf8'),
		);
		assert.deepEqual(proof.credentials, []);
	}
	assert.ok(
		fake.state.requests.some((r) => r.authorization === `Bearer ${key}`),
	);
	console.log('codex native streaming/model/tool/environment passed');
}
async function scan(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = `${directory}/${entry.name}`;
		if (entry.isDirectory()) await scan(path);
		else if (entry.isFile())
			assert.equal(
				(await readFile(path)).includes(Buffer.from(key)),
				false,
				`Injected key reached disk: ${entry.name}`,
			);
	}
}
const selected = process.argv[2];
try {
	if (selected !== 'codex') {
		await checkClaude(true);
		await checkClaude(false);
		await checkClaude(true, 'mcp');
	}
	if (selected !== 'claude-code') {
		await checkCodex();
		await checkCodex('mcp');
	}
	fake.state.rejectAuth = true;
	if (selected !== 'codex') await checkClaude(true, 'text');
	if (selected !== 'claude-code') await checkCodex('text');
	await scan('/home/bot');
	console.log('native credentials never persisted');
} finally {
	await fake.close();
}
