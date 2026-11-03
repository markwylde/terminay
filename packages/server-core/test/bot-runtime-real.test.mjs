import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { BotEngine } from '../dist/botService/engine.js';
import { BotAcpClient } from '../dist/botService/acp.js';
import { openBotRuntimeBridge } from '../dist/botService/runtimeBridge.js';

/** An explicit local image, with current shipped scripts and Claude ACP installed.
 * No network, personal credential or model prompt is used. */
const image = process.env.TERMINAY_BOT_MCP_SMOKE_IMAGE;
test('fresh real container: shipped MCP adapter tools and real Claude ACP session startup', {
	skip: !image,
	timeout: 60000,
}, async () => {
	const botId = randomBytes(6).toString('hex');
	const sessionId = randomBytes(12).toString('hex');
	const name = `terminay-bot-${botId}`;
	let pin, bridge, client;
	const engine = new BotEngine({
		load: async () => pin,
		save: async (value) => {
			pin = value;
		},
	});
	try {
		const selected = (await engine.discover()).find((c) => c.available);
		assert.ok(selected, 'a local container engine is required');
		assert.equal(
			(await engine.check(selected.details.pin.kind)).available,
			true,
		);
		execFileSync(
			'docker',
			[
				'run',
				'-d',
				'--network',
				'none',
				'--name',
				name,
				'--label',
				'terminay.role=helper',
				'--entrypoint',
				'/bin/sleep',
				image,
				'infinity',
			],
			{ stdio: 'ignore' },
		);
		let requests = 0;
		const calls = [];
		const runtime = {
			bindSecret: () => () => {},
			sanitizeSecrets: (_id, value) => value,
			assert: () => {
				requests++;
			},
			call: async (id, tool) => {
				assert.equal(id, sessionId);
				calls.push(tool);
				return { items: [] };
			},
		};
		bridge = await openBotRuntimeBridge(
			engine.driver,
			botId,
			sessionId,
			runtime,
		);
		const probe = `import subprocess,json
p=subprocess.Popen(['/usr/local/bin/terminay-bot-mcp'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
p.stdin.write(json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'chat_list','arguments':{}}})+'\\n');p.stdin.flush()
r=json.loads(p.stdout.readline());assert 'result' in r,r
p.stdin.close();p.wait(timeout=10)
`;
		await engine.driver.exec(name, ['python3', '-c', probe], {
			user: 'bot',
			env: bridge.environment,
			environmentNames: Object.keys(bridge.environment),
			deadlineMs: 15000,
		});
		assert.deepEqual(calls, ['chat_list']);
		const before = requests;
		const environment = {
			...bridge.environment,
			ANTHROPIC_API_KEY: 'invalid-offline-smoke-key',
		};
		const child = engine.driver.execStream(
			name,
			['terminay-run', sessionId, '--', 'claude-agent-acp'],
			{
				user: 'root',
				env: environment,
				environmentNames: Object.keys(environment),
			},
		);
		const credential = {
			redact: (value) => value,
			stream: () => ({ push: (value) => value, finish: () => '' }),
			release() {},
			environment: {},
		};
		client = new BotAcpClient(child, credential, 'autonomous');
		await client.initialize();
		await client.open(null, null, bridge.servers);
		assert.ok(
			requests > before,
			'the real provider must connect to terminay_bot during session creation',
		);
	} finally {
		client?.dispose();
		await bridge?.close().catch(() => undefined);
		engine.close();
		try {
			execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
		} catch {
			/* Creation may have failed. */
		}
	}
});
