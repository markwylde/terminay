import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { BotEngine } from '../dist/botService/engine.js';
import { containerSourceRunner } from '../dist/botService/sourceRunner.js';
const image = process.env.TERMINAY_BOT_MCP_SMOKE_IMAGE;
const fixture = `import http.server,json,time
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  if self.path=='/events':
   self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
   self.wfile.write(b': keepalive\\nid: 42\\nevent: item\\ndata: {"id":\\ndata: "one"}\\n\\n');self.wfile.flush();time.sleep(30)
  else:
   self.send_response(200);self.end_headers();self.wfile.write(json.dumps({'status':'ready','auth':self.headers.get('Authorization')}).encode())
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
print(server.server_port,flush=True)
server.serve_forever()
`;
test('real container sources use bot uid, bounded commands, loopback HTTP/SSE and event-driven files without ports', {
	skip: !image,
	timeout: 120000,
}, async () => {
	const botId = randomBytes(6).toString('hex'),
		name = `terminay-bot-${botId}`;
	let pin;
	let fixtureProcess;
	const engine = new BotEngine({
		load: async () => pin,
		save: async (v) => {
			pin = v;
		},
	});
	let runner;
	const activities = [];
	try {
		const candidate = (await engine.discover()).find((c) => c.available);
		assert.ok(candidate);
		assert.equal(
			(await engine.check(candidate.details.pin.kind)).available,
			true,
		);
		execFileSync(
			'docker',
			[
				'run',
				'-d',
				'--network',
				'none',
				'--cpus',
				'2',
				'--memory',
				'512m',
				'--pids-limit',
				'256',
				'--name',
				name,
				'--entrypoint',
				'/bin/sleep',
				image,
				'infinity',
			],
			{ stdio: 'ignore' },
		);
		const driver = engine.driver;
		const vault = { status: () => ({ entries: [] }) };
		runner = containerSourceRunner({
			driver: async () => driver,
			start: async () => {},
			activity: (_, delta) => activities.push(delta),
			vault,
		});
		const check = async (source) => {
			const observations = [];
			await runner.run(
				botId,
				source,
				{ signal: new AbortController().signal },
				async (o) => observations.push(o),
			);
			return observations;
		};
		const user = await check({
			kind: 'command',
			command: 'id -un; pwd',
			intervalMs: 60000,
			timeoutMs: 30000,
			match: { kind: 'changed' },
		});
		assert.equal(user[0].stdout.trim(), 'bot\n/home/bot');
		assert.equal(user[0].exitCode, 0);
		await assert.rejects(
			check({
				kind: 'command',
				command: 'sleep 60 & wait',
				intervalMs: 60000,
				timeoutMs: 1000,
				match: { kind: 'changed' },
			}),
			/timed out/,
		);
		assert.equal(
			(await driver.exec(name, ['pgrep', '-x', 'sleep'], { user: 'root' }))
				.trim()
				.split('\n')
				.filter(Boolean).length,
			1,
			'only PID 1 sleep remains',
		);
		const regex = {
			kind: 'command',
			command: "python3 -c \"print('a'*100000+'!')\"",
			intervalMs: 60000,
			match: { kind: 'regex', text: '(a+)+$' },
		};
		await assert.rejects(check(regex), /expression evaluation/);
		fixtureProcess = driver.execStream(name, ['python3', '-u', '-c', fixture], {
			user: 'bot',
		});
		fixtureProcess.stdin.end();
		fixtureProcess.stderr.on('data', () => {});
		const port = await new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error('HTTP fixture startup deadline')),
				10000,
			);
			fixtureProcess.once('error', reject);
			fixtureProcess.stdout.once('data', (data) => {
				clearTimeout(timer);
				resolve(Number(String(data).trim()));
			});
		});
		const url = `http://127.0.0.1:${port}`;
		const http = await check({
			kind: 'http',
			url,
			headers: { Authorization: 'worker-test-secret' },
			intervalMs: 60000,
		});
		assert.match(http[0].body, /ready/);
		assert.match(http[0].body, /\[redacted\]/);
		const sse = [];
		const abortSSE = new AbortController();
		await runner
			.run(
				botId,
				{ kind: 'sse', url: `${url}/events`, eventName: 'item' },
				{ signal: abortSSE.signal },
				async (o) => {
					sse.push(o);
					if (o.eventId) abortSSE.abort();
				},
			)
			.catch((error) => {
				if (!abortSSE.signal.aborted) throw error;
			});
		const item = sse.find((o) => o.eventId);
		assert.equal(item.eventId, '42');
		assert.deepEqual(item.data, { id: 'one' });
		const files = [];
		const abortFiles = new AbortController();
		let created = false;
		await runner
			.run(
				botId,
				{
					kind: 'files',
					path: '/home/bot/watch',
					debounceMs: 0,
					recursive: true,
				},
				{ signal: abortFiles.signal },
				async (o) => {
					files.push(o);
					if (o.snapshot && !created) {
						created = true;
						await driver.exec(
							name,
							[
								'/bin/bash',
								'-c',
								'mkdir -p /home/bot/watch; echo ready > /home/bot/watch/new.txt',
							],
							{ user: 'bot' },
						);
					} else if (o.changes?.length) abortFiles.abort();
				},
			)
			.catch((error) => {
				if (!abortFiles.signal.aborted) throw error;
			});
		assert.ok(files.some((o) => o.changes?.includes('new.txt')));
		const resource = await driver.inspect('container', name);
		assert.deepEqual(resource.HostConfig.PortBindings ?? {}, {});
		assert.equal(
			activities.reduce((a, b) => a + b, 0),
			0,
		);
	} finally {
		fixtureProcess?.kill();
		engine.close?.();
		try {
			execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
		} catch {}
	}
});
