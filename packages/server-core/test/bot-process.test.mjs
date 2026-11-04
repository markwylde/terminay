import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const launcher = new URL(
	'../../../docker/terminay-bot/bin/terminay-run',
	import.meta.url,
).pathname;
function python(code) {
	const result = spawnSync(
		'python3',
		[
			'-c',
			`import importlib.machinery, importlib.util, os, tempfile, json, signal, stat, sys\nsys.dont_write_bytecode=True\nloader=importlib.machinery.SourceFileLoader('runner',${JSON.stringify(launcher)})\nspec=importlib.util.spec_from_loader(loader.name,loader)\nm=importlib.util.module_from_spec(spec)\nloader.exec_module(m)\n${code}`,
		],
		{ encoding: 'utf8' },
	);
	assert.equal(result.status, 0, result.stderr);
}
test('5.3 supervisor signals a matching leader group; stale group reuse signals only nonce members, and records survive failed cleanup', () => {
	python(`
with tempfile.TemporaryDirectory() as d:
    m.SESSIONS=d
    m.write_record('owned',{'pgid':100,'start':10,'nonce':'owned'})
    assert stat.S_IMODE(os.stat(d+'/owned').st_mode)==0o600
    m.start_time=lambda pid:10
    m.pgid_of=lambda pid:100
    m.running=lambda pid:True
    groups=[]
    m.os.killpg=lambda group,sig:groups.append((group,sig))
    m.wait_empty=lambda fn,seconds:True
    assert m.kill_session('owned')==0
    assert groups==[(100,signal.SIGTERM)]
    assert not os.path.exists(d+'/owned')
    m.write_record('stale',{'pgid':100,'start':9,'nonce':'owned'})
    m.group_members=lambda group:[100,101,102]
    m.has_nonce=lambda pid,nonce:pid==101
    hits=[]
    m.signal_pids=lambda fn,sig:hits.extend((pid,sig) for pid in fn())
    assert m.kill_session('stale')==0
    assert hits==[(101,signal.SIGTERM)] # reused leader and unrelated member survive
    m.write_record('stuck',{'pgid':100,'start':9,'nonce':'owned'})
    m.wait_empty=lambda fn,seconds:False
    assert m.kill_session('stuck')==1
    assert os.path.exists(d+'/stuck')
`);
});
test('5.3 shipped supervisor has event-driven exit waits with no polling sleeps', async () => {
	const source = await readFile(launcher, 'utf8');
	assert.doesNotMatch(source, /time\.sleep|setInterval/);
	assert.match(source, /pidfd_open/);
	assert.match(source, /watcher\.select\(remaining\)/);
});
const realEngine = process.env.TERMINAY_BOT_INTEGRATION_ENGINE;
test('5.3 real engine: killing a supervised agent also removes its lingering tool child', {
	skip: !realEngine,
	timeout: 45000,
}, async (t) => {
	assert.ok(['docker', 'podman'].includes(realEngine));
	const name = `terminay-session-test-${process.pid}`;
	const run = (args, options = {}) => {
		const result = spawnSync(realEngine, args, {
			encoding: 'utf8',
			timeout: 25000,
			...options,
		});
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	t.after(() => spawnSync(realEngine, ['rm', '-f', name], { timeout: 10000 }));
	run([
		'run',
		'-d',
		// A reaper as PID 1, as terminay-init is in a real bot; otherwise a
		// killed orphan stays visible as a zombie.
		'--init',
		'--pull',
		'never',
		'--network',
		'none',
		'--name',
		name,
		'--entrypoint',
		'tail',
		'terminay-bot:local',
		'-f',
		'/dev/null',
	]);
	run(['cp', launcher, `${name}:/usr/local/bin/terminay-run`]);
	const child = spawn(realEngine, [
		'exec',
		'-i',
		'-u',
		'root',
		name,
		'terminay-run',
		'testsid',
		'--',
		'python3',
		'-u',
		'-c',
		"import os,subprocess,sys; p=subprocess.Popen(['sleep','300']); print(p.pid,flush=True);sys.stdin.read()",
	]);
	t.after(() => child.kill('SIGKILL'));
	const [output] = await once(child.stdout, 'data');
	const toolPid = output.toString().trim();
	assert.match(toolPid, /^\d+$/);
	run(['exec', '-u', 'root', name, 'terminay-run', '--kill', 'testsid']);
	assert.equal(
		run([
			'exec',
			'-u',
			'root',
			name,
			'python3',
			'-c',
			`import os; print(os.path.exists('/proc/${toolPid}'))`,
		]),
		'False',
	);
	assert.equal(
		run([
			'exec',
			'-u',
			'root',
			name,
			'python3',
			'-c',
			"import os; print(os.path.exists('/run/terminay/sessions/testsid'))",
		]),
		'False',
	);
});
test('5.3 credential lease is released exactly once and only after supervisor confirmation', async (t) => {
	const { BotAgentProcess } = await import('../dist/botService/index.js');
	const { agent, credential, until } = await import(
		'./fixtures/bot-test-runtime.mjs'
	);
	const { EventEmitter } = await import('node:events');
	let released = 0,
		confirm;
	const events = new EventEmitter();
	let child;
	const owner = new BotAgentProcess({
		botId: 'abc123def456',
		sessionId: '123456789012345678901234',
		snapshot: {
			agentId: agent.id,
			modelId: null,
			signIn: { kind: 'none' },
			approvalMode: 'autonomous',
			instructions: '',
			context: '',
			maxTurnMs: 30000,
		},
		agent,
		credential: credential('secret', () => released++),
		loadId: null,
		launch: async () => ({ args: [], env: {} }),
		onClient() {},
		driver: {
			async exec() {
				await new Promise((resolve) => {
					confirm = resolve;
					events.emit('kill');
				});
			},
		},
		spawn() {
			child = spawn(
				process.execPath,
				[new URL('./fixtures/bot-native.mjs', import.meta.url).pathname],
				{ stdio: ['pipe', 'pipe', 'pipe'] },
			);
			return child;
		},
	});
	t.after(() => child?.kill('SIGKILL'));
	await owner.open();
	const pending = until(events, 'kill', () => !!confirm);
	const closing = owner.close('end');
	await pending;
	assert.equal(released, 0);
	confirm();
	await closing;
	assert.equal(released, 1);
	await owner.close('end');
	assert.equal(released, 1);
});

test('native interrupt targets owned children and preserves the supervisor record', () => {
	python(`
with tempfile.TemporaryDirectory() as d:
    m.SESSIONS=d
    m.write_record('owned',{'pgid':100,'start':10,'nonce':'owned'})
    m.start_time=lambda pid:10
    m.pgid_of=lambda pid:100
    m.running=lambda pid:True
    m.group_members=lambda pgid,exclude=():[pid for pid in [100,101,102] if pid not in exclude]
    hits=[]
    m.signal_pids=lambda fn,sig:hits.extend((pid,sig) for pid in fn())
    assert m.interrupt_session('owned')==0
    assert hits==[(101,signal.SIGINT),(102,signal.SIGINT)]
    assert os.path.exists(d+'/owned')
    m.start_time=lambda pid:99
    m.has_nonce=lambda pid,nonce:pid==101
    hits.clear()
    assert m.interrupt_session('owned')==0
    assert hits==[(101,signal.SIGINT)]
    assert os.path.exists(d+'/owned')
`);
});
