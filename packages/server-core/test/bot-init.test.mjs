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

test('engine proxy readiness gates desktop startup and a missing proxy fails the container', () => {
	python(`
with tempfile.TemporaryDirectory() as d:
    m.prepare_dirs=lambda: None
    m.read_bootstrap=lambda: {'botId':'abc123def456','serverId':'server-test','vncPassword':'fake-password'}
    m.bot_ids=lambda: (1000,1000)
    m.write_vnc_password=lambda p: '/private/password'
    calls=[]
    class Proxy:
        pid=777
        def poll(self): return None
    m.spawn=lambda args: (calls.append(args) or Proxy())
    m.start_desktop=lambda *args: calls.append('desktop')
    m.os.killpg=lambda pid,sig: calls.append(('kill',pid))
    def absent(*args): raise TimeoutError('missing')
    m.wait_path=absent
    try:
        m.main_init()
        raise AssertionError('startup succeeded without proxy')
    except SystemExit as e:
        assert e.code==78
    assert calls[0]==['node','/usr/local/bin/terminay-engine-proxy.mjs','abc123def456','server-test','1000','1000']
    assert 'desktop' not in calls
    assert ('kill',777) in calls
`);
});

test('unexpected engine proxy exit is fatal after startup and never silently respawns', () => {
	python(`
with tempfile.TemporaryDirectory() as d:
    m.READY=d+'/ready'
    m.prepare_dirs=lambda: None
    m.read_bootstrap=lambda: {'botId':'abc123def456','serverId':'server-test','vncPassword':'fake-password'}
    m.bot_ids=lambda: (1000,1000)
    m.write_vnc_password=lambda p: '/private/password'
    order=[]
    class Proxy:
        pid=777
        def poll(self): return None
    m.spawn=lambda args: (order.append('proxy') or m.children.append(Proxy()) or m.children[-1])
    m.wait_path=lambda *args: order.append('proxy-ready')
    m.start_desktop=lambda *args: order.append('desktop')
    m.os.waitpid=lambda *args: (777,0)
    m.os.killpg=lambda *args: None
    try:
        m.main_init()
        raise AssertionError('kept running without proxy')
    except SystemExit as e:
        assert e.code==78
    assert order==['proxy','proxy-ready','desktop']
`);
});

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

test('the desktop owns an unprivileged sandboxed Chromium on the VNC display', () => {
	python(`
calls=[]
m.spawn=lambda args, **kwargs: calls.append((args,kwargs))
m.wait_path=lambda *args: None
m.start_desktop('/private/password', 1000, 1000, 'abc123def456')
args, options=calls[2]
assert args==['terminay-browser']
assert calls[3][0]==['terminay-app']
assert calls[3][1]['env']==options['env']
assert '--no-sandbox' not in args
assert '--disable-dev-shm-usage' in open(os.path.join(os.path.dirname(m.__file__), 'terminay-browser')).read()
assert options['uid']==1000 and options['gid']==1000
assert options['env']['DISPLAY']==':1' and options['env']['HOME']=='/home/bot'
assert not any('API_KEY' in key for key in options['env'])
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

test('browser opens once, remains closed, and launches only on validated URL requests', () => {
	python(`
import pathlib, subprocess, select, signal, socket
with tempfile.TemporaryDirectory() as d:
    control=socket.socket(socket.AF_UNIX)
    control.bind(d+'/events.sock')
    control.listen(4)
    control.settimeout(5)
    fake=pathlib.Path(d)/'chromium'
    fake.write_text('#!/usr/bin/env python3\\nimport socket,os,sys\\ns=socket.socket(socket.AF_UNIX)\\ns.connect(os.environ["BROWSER_TEST_EVENTS"])\\ns.sendall((sys.argv[-1]+"\\\\n").encode())\\ns.recv(1)\\n')
    fake.chmod(0o755)
    profile=pathlib.Path(d)/'.config/chromium'
    profile.mkdir(parents=True)
    (profile/'Preferences').write_text('keep me')
    for name in ('SingletonLock','SingletonSocket','SingletonCookie'):
        (profile/name).symlink_to('old-container-548')
    env=dict(os.environ,PATH=d+':'+os.environ['PATH'],HOME=d,BROWSER_TEST_EVENTS=d+'/events.sock')
    launcher=os.path.join(os.path.dirname(m.__file__),'terminay-browser')
    code="import importlib.machinery; m=importlib.machinery.SourceFileLoader('browser',"+repr(launcher)+").load_module(); m.SOCKET="+repr(d+'/browser.sock')+"; m.serve()"
    p=subprocess.Popen(['python3','-c',code],env=env,start_new_session=True)
    def request(value):
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(5)
            client.connect(d+'/browser.sock')
            client.sendall((json.dumps({'url':value})+'\\n').encode())
            client.shutdown(socket.SHUT_WR)
            return client.recv(1024)
    try:
        browser,_=control.accept()
        assert browser.recv(1024)==b'about:blank\\n'
        assert not any(os.path.lexists(profile/name) for name in ('SingletonLock','SingletonSocket','SingletonCookie'))
        assert (profile/'Preferences').read_text()=='keep me'
        browser.sendall(b'x')
        browser.close()
        assert not select.select([control],[],[],0.3)[0], 'closed browser was reopened automatically'
        for bad in ['file:///etc/passwd','--no-sandbox','javascript:alert(1)','https://example.com/\\n','https://'+('a'*9000)]:
            assert request(bad)==b'refused\\n'
        assert not select.select([control],[],[],0)[0]
        assert request('https://example.com/')==b'accepted\\n'
        browser,_=control.accept()
        assert browser.recv(1024)==b'https://example.com/\\n'
        browser.sendall(b'x')
        browser.close()
        assert not select.select([control],[],[],0.3)[0]
    finally:
        os.killpg(p.pid,signal.SIGTERM)
        p.wait(timeout=5)
        control.close()
`);
});

// Runs without server build output, alongside init/browser helper tests.
test('desktop application launcher validates requests and owns app lifetimes', () => {
	const result = spawnSync(
		'python3',
		[
			new URL('../../../docker/terminay-bot/test_apps.py', import.meta.url)
				.pathname,
		],
		{ encoding: 'utf8' },
	);
	assert.equal(result.status, 0, result.stderr);
});

test('desktop apps survive supervised session closure and end with their disposable container', {
	skip: !process.env.TERMINAY_BOT_APP_TEST_IMAGE,
	timeout: 90000,
}, (t) => {
	const name = `terminay-app-lifetime-${process.pid}`;
	const run = (args, options = {}) => {
		const result = spawnSync('docker', args, {
			encoding: 'utf8',
			timeout: 45000,
			...options,
		});
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	t.after(() => spawnSync('docker', ['rm', '-f', name], { timeout: 10000 }));
	const socket = process.env.TERMINAY_BOT_APP_ENGINE_SOCKET;
	run([
		'run',
		'-d',
		'--pull',
		'never',
		'--name',
		name,
		'--network',
		'none',
		'--shm-size',
		'512m',
		'--security-opt',
		'label=disable',
		...(socket ? ['-v', `${socket}:/run/terminay-engine/engine.sock`] : []),
		process.env.TERMINAY_BOT_APP_TEST_IMAGE,
	]);
	run(['exec', '-i', '-u', 'root', name, 'terminay-init', '--bootstrap'], {
		input: JSON.stringify({
			botId: 'appverify001',
			serverId: 'app-lifetime-test',
			vncPassword: 'test-only-password',
		}),
	});
	assert.equal(
		run(['exec', name, 'stat', '-c', '%U:%a', '/tmp/terminay-app.sock']),
		'bot:600',
	);
	const inspect = JSON.parse(run(['inspect', name]))[0];
	assert.deepEqual(inspect.HostConfig.PortBindings ?? {}, {});
	const result = run(['exec', '-i', '-u', 'root', name, 'python3', '-'], {
		input: spawnSync(
			'cat',
			[
				new URL(
					'../../../docker/terminay-bot/test_app_lifetime.py',
					import.meta.url,
				).pathname,
			],
			{ encoding: 'utf8' },
		).stdout,
	});
	assert.equal(result.split('\n').length, 5);
	for (const line of result.split('\n')) {
		const event = JSON.parse(line);
		assert.equal(event.sessionCommandEnded, true);
		assert.equal(event.desktopAppSurvived, true);
	}
	// Keep an app open at shutdown, rather than merely stopping an idle service.
	run(['exec', '-u', 'bot', name, 'terminay-app', 'launch', 'xclock']);
	run(['exec', name, 'pidof', 'xclock']);
	run(['stop', '--time', '10', name]);
	assert.equal(JSON.parse(run(['inspect', name]))[0].State.Running, false);
	assert.notEqual(
		spawnSync('docker', ['top', name], { encoding: 'utf8' }).status,
		0,
	);
});
