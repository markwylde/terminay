import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { BotEngine } from '../dist/botService/engine.js';
import { BotAcpClient } from '../dist/botService/acp.js';
import { openBotRuntimeBridge } from '../dist/botService/runtimeBridge.js';

const image = process.env.TERMINAY_BOT_MCP_SMOKE_IMAGE;
if (process.env.TERMINAY_BOT_MCP_REQUIRED === '1') {
	assert.ok(
		image,
		'required bot MCP CI must supply the freshly built production image',
	);
}
const options = { skip: !image, timeout: 90000 };
async function container(work) {
	const botId = randomBytes(6).toString('hex'),
		sessionId = randomBytes(12).toString('hex');
	const name = `terminay-bot-${botId}`;
	let pin;
	const engine = new BotEngine({
		load: async () => pin,
		save: async (value) => {
			pin = value;
		},
	});
	try {
		const selected = (await engine.discover()).find(
			(candidate) => candidate.available,
		);
		assert.ok(selected, 'a local Unix-socket container engine is required');
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
				'--cpus',
				'2',
				'--memory',
				'2g',
				'--pids-limit',
				'256',
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
		const driver = engine.driver;
		assert.equal(
			(await driver.exec(name, ['id', '-u'], { user: 'root' })).trim(),
			'0',
		);
		const botUid = Number(
			(await driver.exec(name, ['id', '-u'], { user: 'bot' })).trim(),
		);
		assert.ok(
			botUid > 0,
			'the adapter must genuinely execute as a non-root account',
		);
		await work({ driver, botId, sessionId, name, botUid });
	} finally {
		engine.close();
		try {
			execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
		} catch {
			/* Creation may have failed. */
		}
	}
}
function runtime(sessionId) {
	const calls = [],
		state = { requests: 0, unbound: false };
	return {
		calls,
		state,
		bindSecret: (id) => {
			assert.equal(id, sessionId);
			return () => {
				state.unbound = true;
			};
		},
		sanitizeSecrets: (_id, value) => value,
		assert: (id) => {
			assert.equal(id, sessionId);
			state.requests++;
		},
		call: async (id, tool, args) => {
			assert.equal(id, sessionId);
			calls.push({ tool, args });
			return tool === 'chat_post' ? { posted: true } : { items: [] };
		},
	};
}
const ownership = `import os,pwd,stat,sys,json
owner=pwd.getpwnam('bot');s=os.stat(sys.argv[1])
assert owner.pw_uid>0
assert (s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))==(owner.pw_uid,owner.pw_gid,0o600),(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))
uids=[]
for pid in os.listdir('/proc'):
 if not pid.isdigit():continue
 try:
  argv=open('/proc/'+pid+'/cmdline','rb').read().split(b'\\0')
  if len(argv)>2 and argv[1].endswith(b'/terminay-mcp-relay') and argv[2].decode()==sys.argv[2]:
   status=open('/proc/'+pid+'/status').read();uids.append(int(status.split('Uid:')[1].split()[0]))
 except (FileNotFoundError,ProcessLookupError):pass
assert uids==[int(sys.argv[3])],uids
print(json.dumps({'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'relayUids':uids}))
`;
const toolProbe = `import subprocess,json,os,pwd
assert os.geteuid()==pwd.getpwnam('bot').pw_uid and os.geteuid()!=0
p=subprocess.Popen(['/usr/local/bin/terminay-bot-mcp'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
for ident,name,args in [(1,'chat_list',{}),(2,'chat_post',{'text':'real socket reply','key':'ownership-test'})]:
 p.stdin.write(json.dumps({'jsonrpc':'2.0','id':ident,'method':'tools/call','params':{'name':name,'arguments':args}})+'\\n');p.stdin.flush()
 result=json.loads(p.stdout.readline());assert 'result' in result,result
p.stdin.close();p.wait(timeout=10)
`;

for (const launch of ['supervised', 'direct-root']) {
	test(
		`real bot image: ${launch} relay has a private bot-owned socket and bot-user tools can read/post`,
		options,
		async () =>
			container(async ({ driver, botId, sessionId, name, botUid }) => {
				const rpc = runtime(sessionId);
				let bridge, client;
				const transport =
					launch === 'direct-root'
						? {
								...driver,
								execStream: (name, _command, options) =>
									driver.execStream(name, ['terminay-mcp-relay', sessionId], {
										...options,
										user: 'root',
									}),
								exec: (...args) => driver.exec(...args),
							}
						: driver;
				try {
					bridge = await openBotRuntimeBridge(transport, botId, sessionId, rpc);
					const checked = JSON.parse(
						await driver.exec(
							name,
							[
								'python3',
								'-c',
								ownership,
								bridge.environment.TERMINAY_RUNTIME_SOCKET,
								sessionId,
								String(launch === 'direct-root' ? 0 : botUid),
							],
							{ user: 'root' },
						),
					);
					assert.equal(checked.uid, botUid);
					assert.equal(checked.mode, 0o600);
					await driver.exec(name, ['python3', '-c', toolProbe], {
						user: 'bot',
						env: bridge.environment,
						environmentNames: Object.keys(bridge.environment),
						deadlineMs: 15000,
					});
					assert.deepEqual(
						rpc.calls.map((call) => call.tool),
						['chat_list', 'chat_post'],
					);
					assert.equal(rpc.calls[1].args.text, 'real socket reply');
					if (launch === 'supervised') {
						const before = rpc.state.requests;
						const environment = {
							...bridge.environment,
							ANTHROPIC_API_KEY: 'invalid-offline-smoke-key',
						};
						const child = driver.execStream(
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
						const output = [];
						client.on('runner', (value) => output.push(value));
						await client.initialize();
						await client.open(null, null, bridge.servers);
						assert.ok(
							rpc.state.requests > before,
							'the real provider must connect to terminay_bot',
						);
						assert.doesNotMatch(
							output.join(''),
							/MCP server.*failed to start/i,
						);
					}
				} finally {
					client?.dispose();
					await bridge?.close().catch(() => undefined);
				}
			}),
	);
}

test(
	'real bot image: inaccessible root-only socket fails bot-user preflight and reports EACCES stderr',
	options,
	async () =>
		container(async ({ driver, botId, sessionId, name }) => {
			const rpc = runtime(sessionId),
				diagnostics = [];
			const transport = {
				execStream: (...args) => driver.execStream(...args),
				exec: async (container, command, options) => {
					if (command[0] === '/usr/local/bin/terminay-bot-mcp') {
						await driver.exec(
							name,
							[
								'python3',
								'-c',
								'import os,sys;os.chown(sys.argv[1],0,0);os.chmod(sys.argv[1],0o600)',
								options.env.TERMINAY_RUNTIME_SOCKET,
							],
							{ user: 'root' },
						);
					}
					return driver.exec(container, command, options);
				},
			};
			await assert.rejects(
				openBotRuntimeBridge(transport, botId, sessionId, rpc, (value) =>
					diagnostics.push(value),
				),
				/MCP adapter could not connect/,
			);
			assert.match(diagnostics.join('\n'), /runtime socket permission denied/);
			assert.equal(rpc.state.unbound, true);
		}),
);
