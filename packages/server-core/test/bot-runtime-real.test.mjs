import './bot-sources-real.test.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
	BotService,
	BotStore,
	BotSessionStore,
	BotMemories,
} from '../dist/botService/index.js';
import {
	modelServer,
	preFixToolShell,
} from './fixtures/bot-anthropic-model.mjs';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { BotEngine } from '../dist/botService/engine.js';
import { BotAgentProcess } from '../dist/botService/agentProcess.js';
import agentsPackage from '../../../extensions/builtin-agents/package.json' with {
	type: 'json',
};
const claude = agentsPackage.terminay.contributes.botAgents.find(
	(agent) => agent.acpCommand.executable === 'claude-agent-acp',
);
import { openBotRuntimeBridge } from '../dist/botService/runtimeBridge.js';

const image = process.env.TERMINAY_BOT_MCP_SMOKE_IMAGE;
if (process.env.TERMINAY_BOT_MCP_REQUIRED === '1') {
	assert.ok(
		image,
		'required bot MCP CI must supply the freshly built production image',
	);
}
const options = { skip: !image, timeout: 180000 };
async function deadline(promise, ms) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(Error('MCP catalog handshake deadline')),
					ms,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
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
		state = { requests: 0, unbound: false, ownsWork: false };
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
		assertWork: () => {
			if (!state.ownsWork)
				throw Error(
					'Acquire shared work with work_acquire before shell/desktop actions',
				);
		},
		call: async (id, tool, args) => {
			assert.equal(id, sessionId);
			calls.push({ tool, args });
			if (tool === 'work_acquire') state.ownsWork = true;
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
				let resolveConnected;
				const connected = new Promise((resolve) => {
					resolveConnected = resolve;
				});
				let bridge, runner;
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
					bridge = await openBotRuntimeBridge(
						transport,
						botId,
						sessionId,
						rpc,
						(value) => {
							if (value.includes('connected to terminay_bot'))
								resolveConnected();
						},
					);
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
						const output = [];
						const credential = {
							environment: { ANTHROPIC_API_KEY: 'invalid-offline-smoke-key' },
							redact: (value) => value,
							stream: () => ({ push: (value) => value, finish: () => '' }),
							release() {},
						};
						runner = new BotAgentProcess({
							driver,
							botId,
							sessionId,
							agent: claude,
							snapshot: { modelId: null, approvalMode: 'autonomous' },
							loadId: null,
							credential: bridge.wrapCredential(credential),
							sessionEnvironment: bridge.environment,
							mcpServers: bridge.servers,
							launch: async () => ({ args: [], env: {} }),
							onClient: (client) =>
								client.on('runner', (value) => output.push(value)),
						});
						await runner.open();
						await deadline(connected, 10000);
						bridge.assertConnected();
						assert.doesNotMatch(
							output.join(''),
							/MCP server.*failed to start/i,
						);
					}
				} finally {
					await runner?.close('end');
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

test(
	'real shell prefix bootstraps only the exact adapter, strips credentials and preserves the work gate',
	options,
	async () =>
		container(async ({ driver, botId, sessionId, name }) => {
			const rpc = runtime(sessionId),
				diagnostics = [];
			const bridge = await openBotRuntimeBridge(
				driver,
				botId,
				sessionId,
				rpc,
				(value) => diagnostics.push(value),
			);
			const env = {
				...bridge.environment,
				ANTHROPIC_API_KEY: 'provider-secret',
				TERMINAY_CREDENTIAL_VARIABLES: 'ANTHROPIC_API_KEY',
			};
			const exec = (args) =>
				driver.exec(name, args, {
					user: 'bot',
					env,
					environmentNames: Object.keys(env),
					deadlineMs: 15000,
				});
			try {
				assert.throws(
					() => bridge.assertConnected(),
					/did not connect/,
					'a direct preflight is not provider startup',
				);
				for (const command of [
					'printf should-not-run',
					'/usr/local/bin/terminay-bot-mcp --help',
					'/usr/local/bin/terminay-bot-mcp; printf bypass',
					'"/usr/local/bin/terminay-bot-mcp" && printf bypass',
					'env /usr/local/bin/terminay-bot-mcp',
				]) {
					await assert.rejects(
						exec(['/usr/local/bin/terminay-tool-shell', command]),
					);
				}
				await assert.rejects(
					exec([
						'/usr/local/bin/terminay-tool-shell',
						'/usr/local/bin/terminay-bot-mcp',
						'extra-argument',
					]),
				);
				const probe = `import subprocess,json,os,sys
p=subprocess.Popen(['/usr/local/bin/terminay-tool-shell',sys.argv[1]],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
for ident,method,params in [(1,'initialize',{'protocolVersion':'2025-03-26','clientInfo':{'name':'prefix-test','version':'1'},'capabilities':{}}),(2,'tools/list',{}),(3,'tools/call',{'name':'chat_list','arguments':{}}),(4,'tools/call',{'name':'chat_post','arguments':{'text':'prefixed reply','key':'prefix'}})]:
 p.stdin.write(json.dumps({'jsonrpc':'2.0','id':ident,'method':method,'params':params})+'\\n');p.stdin.flush()
 line=p.stdout.readline();assert line,'adapter closed before response'
 response=json.loads(line);assert 'result' in response,response
 if method=='tools/list':assert any(t['name']=='work_acquire' for t in response['result']['tools'])
 if ident==1:
  environment=open('/proc/'+str(p.pid)+'/environ','rb').read().split(b'\\0')
  assert not any(e.startswith(b'ANTHROPIC_API_KEY=') or e.startswith(b'BASH_ENV=') for e in environment),environment
  assert any(e.startswith(b'TERMINAY_RUNTIME_TOKEN=') for e in environment)
p.stdin.close();assert p.wait(timeout=10)==0
`;
				for (const command of [
					'/usr/local/bin/terminay-bot-mcp',
					"'/usr/local/bin/terminay-bot-mcp'",
					'"/usr/local/bin/terminay-bot-mcp"',
				]) {
					await exec(['python3', '-c', probe, command]);
				}
				bridge.assertConnected();
				assert.equal(
					rpc.state.ownsWork,
					false,
					'MCP bootstrap must not acquire work implicitly',
				);
				await assert.rejects(
					exec(['/usr/local/bin/terminay-tool-shell', 'printf still-refused']),
				);
				await rpc.call(sessionId, 'work_acquire', {});
				assert.equal(
					await exec([
						'/usr/local/bin/terminay-tool-shell',
						`printf '%s|%s|%s' "\${ANTHROPIC_API_KEY-unset}" "\${TERMINAY_RUNTIME_TOKEN-unset}" "\${BASH_ENV-unset}"`,
					]),
					'unset|unset|unset',
				);
				assert.match(
					diagnostics.join('\n'),
					/connected to terminay_bot and loaded its tools/,
				);
			} finally {
				await bridge.close();
			}
		}),
);

for (const brokenPrefix of [false, true]) {
	test(
		`real Claude chat: ${brokenPrefix ? 'failed MCP launch is visible and cannot complete' : 'hi posts a durable reply through MCP and gated shell'}`,
		options,
		async () =>
			container(async ({ driver, name }) => {
				const root = await mkdtemp(join(tmpdir(), 'bot-claude-chat-'));
				let service, model;
				try {
					if (brokenPrefix)
						await driver.exec(
							name,
							['/bin/sh', '-c', 'cat > /usr/local/bin/terminay-tool-shell'],
							{ user: 'root', input: preFixToolShell },
						);
					model = driver.execStream(
						name,
						['python3', '-u', '-c', modelServer],
						{ user: 'bot' },
					);
					const lines = createInterface({ input: model.stdout }),
						iterator = lines[Symbol.asyncIterator]();
					const ready = JSON.parse((await iterator.next()).value);
					const modelCalls = [];
					const collect = (async () => {
						for await (const line of iterator)
							modelCalls.push(JSON.parse(line));
					})();
					collect.catch(() => {});
					const bots = new BotStore(join(root, 'bots.json')),
						sessions = new BotSessionStore(join(root, 'sessions'));
					const memories = new BotMemories(
						{
							acquire: async () => ({
								list: async () => [],
								readText: async () => '',
								release() {},
								watch: () => () => {},
							}),
						},
						bots,
					);
					const transport = {
						...driver,
						exec: (_name, ...args) => driver.exec(name, ...args),
						execStream: (_name, ...args) => driver.execStream(name, ...args),
					};
					service = new BotService(bots, sessions, memories, {
						driver: async () => transport,
						agents: {
							botAgentContributions: () => [
								{ extensionId: 'builtin', contribution: claude },
							],
							botAgentModels: async () => ({ available: true, value: [] }),
							botAgentStatus: async () => ({
								available: true,
								value: { state: 'ready' },
							}),
							botAgentLaunch: async () => ({
								available: true,
								value: {
									args: [],
									env: {
										ANTHROPIC_BASE_URL: `http://127.0.0.1:${ready.port}`,
										CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
									},
								},
							}),
						},
						environment: {
							register() {},
							prepareSession: async () => ({}),
							remove: async () => {},
							stop: async () => {},
							reconcileAll: async () => {},
							state: () => 'running',
						},
						credentials: {
							acquire: async () => ({
								environment: { ANTHROPIC_API_KEY: 'local-fixture-key' },
								redact: (v) => v.replaceAll('local-fixture-key', '[redacted]'),
								stream: () => ({ push: (v) => v, finish: () => '' }),
								release() {},
							}),
						},
						removeHelpers: async () => {},
						activity() {},
					});
					let workChecks = 0;
					const assertWork = service.runtime.assertWork.bind(service.runtime);
					service.runtime.assertWork = (id) => {
						workChecks++;
						return assertWork(id);
					};
					await service.reconcile();
					const bot = await service.save({
						name: 'Real Claude Chat',
						agentId: claude.id,
						approvalMode: 'autonomous',
						signIn: { kind: 'token', environmentVariable: 'ANTHROPIC_API_KEY' },
					});
					const { sessionId } = await service.send(bot.id, 'hi');
					await new Promise((resolve, reject) => {
						const timer = setTimeout(() => {
							service.off('changed', check);
							reject(
								Error(
									'Claude chat deadline: ' +
										JSON.stringify(sessions.get(sessionId)),
								),
							);
						}, 100000);
						function check() {
							if (
								['completed', 'failed'].includes(sessions.get(sessionId).state)
							) {
								clearTimeout(timer);
								service.off('changed', check);
								resolve();
							}
						}
						service.on('changed', check);
						check();
					});
					const session = sessions.get(sessionId);
					if (brokenPrefix) {
						assert.ok(
							workChecks > 0,
							'the original work gate must actually reject MCP bootstrap',
						);
						assert.equal(session.state, 'failed', session.runnerOutput);
						assert.match(session.reason, /did not connect to terminay_bot/);
						assert.match(session.runnerOutput, /MCP startup details/);
					} else {
						assert.equal(session.state, 'completed', session.runnerOutput);
						assert.match(
							session.runnerOutput,
							/connected to terminay_bot and loaded its tools/,
						);
						const messages = service.messages.list(bot.id).items;
						assert.ok(
							messages.some(
								(m) =>
									m.author === 'bot' &&
									m.excerpt === 'Hello from the real Claude MCP path',
							),
							JSON.stringify({
								messages,
								modelCalls,
								updates: session.updates.filter(
									(u) => u.sessionUpdate !== 'available_commands_update',
								),
								runner: session.runnerOutput,
							}),
						);
						const calls = JSON.stringify(modelCalls.flatMap((c) => c.results));
						assert.ok(
							modelCalls.some((c) =>
								c.tools.includes('mcp__terminay_bot__chat_post'),
							),
						);
						assert.match(calls, /shell-token=unset provider-key=unset/);
						assert.doesNotMatch(
							JSON.stringify(session.updates),
							/MCP server.*failed to start|CONNECTION_CLOSED/,
						);
					}
				} finally {
					await service?.shutdown();
					model?.kill();
					await rm(root, { recursive: true, force: true });
				}
			}),
	);
}
