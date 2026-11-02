import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = new URL(
	'../../../docker/terminay-bot/bin/terminay-init',
	import.meta.url,
).pathname;
function python(code) {
	const result = spawnSync(
		'python3',
		[
			'-c',
			`import importlib.machinery, importlib.util, os, tempfile, stat, json, io, sys\nloader=importlib.machinery.SourceFileLoader('init', ${JSON.stringify(script)})\nspec=importlib.util.spec_from_loader(loader.name, loader)\nm=importlib.util.module_from_spec(spec)\nsys.dont_write_bytecode=True\nloader.exec_module(m)\n${code}`,
		],
		{ encoding: 'utf8' },
	);
	assert.equal(result.status, 0, result.stderr);
}

test('4.4 bootstrap fails closed at deadline and creates a private FIFO/password; desktop is loopback-only', () => {
	python(`
with tempfile.TemporaryDirectory() as d:
    m.RUN=d
    m.FIFO=d+'/bootstrap.fifo'
    m.READY=d+'/ready'
    m.VNC_DIR=d+'/vnc'
    m.SESSIONS=d+'/sessions'
    m.BOOTSTRAP_TIMEOUT=0.02
    try:
        m.main_init()
        raise AssertionError('no exit')
    except SystemExit as e:
        assert e.code==78
    assert not os.path.exists(m.READY)
    m.prepare_dirs()
    assert stat.S_IMODE(os.stat(m.FIFO).st_mode)==0o600
    assert stat.S_IMODE(os.stat(m.VNC_DIR).st_mode)==0o700
    class Result:
        stdout=b'encrypted'
    m.subprocess.run=lambda *args, **kwargs: Result()
    passwd=m.write_vnc_password('fake-password')
    assert stat.S_IMODE(os.stat(passwd).st_mode)==0o600
    calls=[]
    m.spawn=lambda args, **kwargs: calls.append(args)
    m.wait_path=lambda *args: None
    m.start_desktop(passwd, os.getuid(), os.getgid(), 'abc123def456')
    assert calls[0][calls[0].index('-localhost')+1]=='yes'
    assert calls[0][calls[0].index('-SecurityTypes')+1]=='VncAuth'
`);
});

test('4.3 config writer atomically restores manifest files and refuses symlinked parents/targets', () => {
	python(`
with tempfile.TemporaryDirectory() as d:
    m.HOME=d
    m.bot_ids=lambda: (os.getuid(), os.getgid())
    m.os.setgroups=lambda _: None
    def write(path, content):
        m.sys.stdin=type('Input', (), {'buffer':io.BytesIO(json.dumps([{'path':path,'content':content}]).encode())})()
        m.main_config()
    write('.codex/config.toml','fixed')
    assert open(d+'/.codex/config.toml').read()=='fixed'
    write('.codex/config.toml','restored')
    assert open(d+'/.codex/config.toml').read()=='restored'
    os.symlink('/tmp',d+'/escape')
    try:
        write('escape/terminay-config-escape','no')
        raise AssertionError('followed parent link')
    except OSError:
        pass
    os.symlink('/etc/passwd',d+'/target')
    try:
        write('target','no')
        raise AssertionError('replaced target link')
    except ValueError:
        pass
`);
});

test('4.4 tunnel validates port, only connects to loopback, and preserves stdio bytes with half-close', () => {
	python(`
class Peer:
    sent=b''
    received=False
    closed=False
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def settimeout(self, value): assert value is None
    def sendall(self, chunk): self.sent+=chunk
    def shutdown(self, mode): self.closed=True
    def recv(self, size):
        assert size==65536
        if self.received: return b''
        self.received=True
        return b'reply\\x00'
peer=Peer()
def connect(address, timeout):
    assert address==('127.0.0.1',5901) and timeout==10
    return peer
m.socket.create_connection=connect
chunks=iter([b'hello\\x00',b''])
m.os.read=lambda *args: next(chunks)
class Thread:
    def __init__(self,target,daemon): self.target=target
    def start(self): self.target()
m.threading.Thread=Thread
output=io.BytesIO()
m.sys.stdout=type('Output',(),{'buffer':output,'flush':lambda self:None})()
m.main_tunnel('5901')
assert peer.sent==b'hello\\x00' and peer.closed
assert output.getvalue()==b'reply\\x00'
for port in ['0','65536','-1','127.0.0.1:5901','5901;id']:
    try:
        m.main_tunnel(port)
        raise AssertionError('bad port accepted')
    except ValueError:
        pass
`);
});

const realEngine = process.env.TERMINAY_BOT_INTEGRATION_ENGINE;
test('4.4 real container exits without bootstrap, bot cannot read password, tunnel reaches loopback VNC', {
	skip: !realEngine,
	timeout: 70_000,
}, async (t) => {
	assert.ok(
		['docker', 'podman'].includes(realEngine),
		'opt-in engine must be docker or podman',
	);
	// Opt-in uses an already built local image; never pulls or calls a provider.
	const name = `terminay-init-test-${process.pid}`;
	const run = (args, options = {}) => {
		const result = spawnSync(realEngine, args, {
			encoding: 'utf8',
			timeout: 45_000,
			...options,
		});
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	t.after(() => spawnSync(realEngine, ['rm', '-f', name], { timeout: 10000 }));
	run(['run', '-d', '--pull', 'never', '--name', name, 'terminay-bot:local']);
	assert.equal(run(['wait', name]), '78');
	run(['start', name]);
	run(['exec', '-i', '-u', 'root', name, 'terminay-init', '--bootstrap'], {
		input: JSON.stringify({
			botId: 'abc123def456',
			vncPassword: 'fake-only-password',
		}),
	});
	const denied = spawnSync(
		realEngine,
		['exec', '-u', 'bot', name, 'cat', '/run/terminay/vnc/passwd'],
		{ encoding: 'utf8', timeout: 10000 },
	);
	assert.notEqual(denied.status, 0);
	assert.match(denied.stderr, /Permission denied/i);
	assert.equal(
		run([
			'exec',
			'-u',
			'root',
			name,
			'stat',
			'-c',
			'%u:%a',
			'/run/terminay/vnc/passwd',
		]),
		'0:600',
	);
	const inspect = JSON.parse(run(['inspect', name]))[0];
	assert.deepEqual(inspect.HostConfig.PortBindings ?? {}, {});
	const child = spawn(realEngine, [
		'exec',
		'-i',
		'-u',
		'root',
		name,
		'terminay-init',
		'--tunnel',
		'5901',
	]);
	t.after(() => child.kill('SIGKILL'));
	const [banner] = await once(child.stdout, 'data');
	assert.match(banner.toString(), /^RFB 003\.008/);
	child.kill('SIGKILL');
	await once(child, 'close');
});

test('4.4 shipped init has no polling sleeps or published desktop port', async () => {
	assert.doesNotMatch(await readFile(script, 'utf8'), /time\.sleep/);
	assert.doesNotMatch(
		await readFile(
			new URL('../../../docker/terminay-bot/Dockerfile', import.meta.url),
			'utf8',
		),
		/^EXPOSE/m,
	);
});
