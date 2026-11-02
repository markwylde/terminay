import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fakeModel } from './bots/model.mjs';

const exec = promisify(execFile);
test('conformance opt-in runs the pinned image offline and cleans it, with fake engines', async (t) => {
	const directory = await mkdtemp(
		path.join(tmpdir(), 'bot-conformance-engine-'),
	);
	t.after(() => rm(directory, { recursive: true, force: true }));
	const log = path.join(directory, 'calls');
	for (const engine of ['docker', 'podman']) {
		const executable = path.join(directory, engine);
		await writeFile(
			executable,
			`#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nconst args=process.argv.slice(2);\nappendFileSync(${JSON.stringify(log)},JSON.stringify({args,hasProviderKey:!!process.env.OPENAI_API_KEY})+'\\n');\nif(args[0]==='exec') console.log('credential confinement passed; device sign-in URL and code passed');\n`,
		);
		await chmod(executable, 0o755);
		const testPath = fileURLToPath(
			new URL('./bot-conformance.test.mjs', import.meta.url),
		);
		const env = {
			PATH: directory,
			TERMINAY_BOT_ENGINE: engine,
			OPENAI_API_KEY: 'must-not-be-inherited',
		};
		// No flag: not even engine detection should run.
		const disabled = await exec(process.execPath, ['--test', testPath], {
			env,
		});
		assert.match(disabled.stdout, /skipped 2/);
		await assert.rejects(readFile(log), { code: 'ENOENT' });
		await exec(process.execPath, ['--test', testPath], {
			env: { ...env, TERMINAY_BOT_CONFORMANCE: '1' },
		});
		const calls = (await readFile(log, 'utf8'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		assert.ok(calls.every((call) => !call.hasProviderKey));
		assert.equal(calls.filter((call) => call.args[0] === 'run').length, 2);
		for (const { args } of calls.filter((call) => call.args[0] === 'run')) {
			assert.ok(args.includes('--pull=never'));
			assert.equal(args[args.indexOf('--network') + 1], 'none');
			assert.ok(args.includes('terminay-bot:local'));
		}
		assert.equal(calls.filter((call) => call.args[0] === 'rm').length, 2);
		await rm(log);
	}
});

test('fake model serves streaming tool and text replies in both provider formats', async (t) => {
	const fake = await fakeModel({ listen: false });
	t.after(() => fake.close());
	const request = async (url, body) => {
		let text = '';
		let status;
		const response = {
			writeHead(code) {
				status = code;
				return this;
			},
			write(chunk) {
				text += chunk;
			},
			end() {},
			destroy(error) {
				throw error;
			},
		};
		const input = {
			url,
			async *[Symbol.asyncIterator]() {
				yield JSON.stringify(body);
			},
		};
		await fake.handle(input, response);
		return { status, text };
	};
	for (const [endpoint, tools, expected] of [
		['/v1/messages', [{ name: 'Bash' }], 'input_json_delta'],
		[
			'/v1/responses',
			[{ type: 'function', name: 'exec_command' }],
			'response.function_call_arguments.delta',
		],
	]) {
		const ask = [
			{
				role: 'user',
				content: [{ type: 'text', text: 'Perform the conformance check.' }],
			},
		];
		const side = [{ role: 'user', content: 'Suggest a title.' }];
		const turn = (messages) =>
			endpoint === '/v1/messages'
				? { model: 'test-only', tools, messages }
				: { model: 'test-only', tools, input: messages };
		fake.next('tool');
		// A side request (title, suggestion) must not use up the tool turn.
		assert.ok(
			(await request(endpoint, turn(side))).text.includes('offline-pong'),
		);
		const tool = await request(endpoint, turn(ask));
		assert.equal(tool.status, 200);
		assert.ok(tool.text.includes(expected));
		assert.ok(tool.text.includes('tool-proof.json'));
		assert.ok(
			(await request(endpoint, turn(ask))).text.includes('offline-pong'),
		);
	}
	assert.equal((await request('/unknown', {})).status, 404);
});

test('device issuer returns a public URL/code challenge and never issues a credential', async () => {
	const { fakeDeviceIssuer } = await import('./bots/device.mjs');
	const issuer = await fakeDeviceIssuer({ listen: false });
	const request = async (url) => {
		let code, body;
		await issuer.handle(
			{
				url,
				async *[Symbol.asyncIterator]() {
					yield '{}';
				},
			},
			{
				writeHead(status) {
					code = status;
					return this;
				},
				end(value) {
					body = value;
				},
			},
		);
		return { code, body };
	};
	assert.deepEqual(
		JSON.parse((await request('/api/accounts/deviceauth/usercode')).body),
		{ device_auth_id: 'test-device', user_code: 'TEST-CODE', interval: '1' },
	);
	assert.equal((await request('/api/accounts/deviceauth/token')).code, 403);
	assert.equal((await request('/unknown')).code, 404);
});
