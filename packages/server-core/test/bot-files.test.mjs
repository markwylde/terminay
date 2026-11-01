import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	BOT_FILE_CHUNK_BYTES,
	BotFilesImageRequired,
	BotFilesService,
} from '../dist/botService/index.js';
import { botId, fakeClock, fakeDriver } from './fixtures/bot-driver.mjs';

async function fixture(t, options = {}) {
	const driver = fakeDriver();
	driver.resources.set('image:terminay-bot:local', {});
	const calls = [];
	driver.stream = (args) => {
		calls.push(args);
		return spawn(
			process.execPath,
			[
				fileURLToPath(
					new URL('./fixtures/bot-files-helper.mjs', import.meta.url),
				),
			],
			{ stdio: ['pipe', 'pipe', 'pipe'] },
		);
	};
	const clock = fakeClock();
	const service = new BotFilesService('server', {
		engine: async () => driver,
		protectedPaths: () => ['.codex/auth.json'],
		timers: clock,
		...options,
	});
	t.after(() => service.close());
	return { service, driver, calls, clock };
}
test('4.9 shared helper references, limits, volume before first start, no image pulls and protected paths', async (t) => {
	const f = await fixture(t);
	const [a, b] = await Promise.all([
		f.service.acquire(botId),
		f.service.acquire(botId),
	]);
	assert.equal(f.calls.length, 1);
	const args = f.calls[0];
	for (const arg of [
		'--read-only',
		'--cap-drop',
		'ALL',
		'--network',
		'none',
		'--cpus',
		'0.5',
		'--memory',
		'268435456',
		'--pids-limit',
		'64',
		'--protect',
		'.codex/auth.json',
		'never',
	])
		assert.ok(args.includes(arg));
	assert.ok(f.driver.resources.has(`volume:terminay-bot-${botId}-home`));
	assert.equal((await a.list('.')).entries[0].name, 'hello');
	for (const path of [
		'../x',
		'/etc',
		'.codex',
		'.codex/auth.json',
		'.codex/auth.json/child',
	])
		assert.throws(() => a.read(path));
	a.close();
	f.clock.tick(5 * 60_000);
	assert.equal((await b.stat('hello')).size, 5);
	b.close();
	const view = await f.service.acquire(botId);
	assert.equal(f.calls.length, 1);
	view.close();
	await f.service.closeBot(botId);
	assert.ok(f.driver.calls.some((a) => a[0] === 'container' && a[1] === 'rm'));
});
test('4.9 chunked credit flow, cancelled downloads, atomic uploads bounded by declared size and watch invalidations', async (t) => {
	const f = await fixture(t),
		view = await f.service.acquire(botId);
	let bytes = 0;
	for await (const chunk of view.read('large')) {
		assert.ok(chunk.length <= BOT_FILE_CHUNK_BYTES);
		bytes += chunk.length;
	}
	assert.equal(bytes, 5 * 1024 * 1024);
	const iterator = view.read('large')[Symbol.asyncIterator]();
	assert.equal((await iterator.next()).value.length, BOT_FILE_CHUNK_BYTES);
	await iterator.return();
	async function* contents() {
		yield Buffer.from('abc');
		yield Buffer.from('def');
	}
	await view.write('upload', 6, contents());
	let text = '';
	for await (const chunk of view.read('upload'))
		text += Buffer.from(chunk).toString();
	assert.equal(text, 'abcdef');
	await assert.rejects(view.write('upload', 5, contents()), /chunk/);
	await assert.rejects(view.write('upload', 7, contents()), /incomplete/);
	await assert.rejects(view.write('upload', 1024 ** 3 + 1, contents()), /size/);
	const abort = new AbortController();
	abort.abort();
	await assert.rejects(view.stat('hello', abort.signal));
	let changed;
	const event = new Promise((resolve) => (changed = resolve));
	const stop = await view.watch(['.'], changed);
	await event;
	stop();
	view.close();
});
test('4.9 missing image offers build without touching volume or starting the bot', async (t) => {
	const f = await fixture(t);
	f.driver.resources.delete('image:terminay-bot:local');
	await assert.rejects(f.service.acquire(botId), BotFilesImageRequired);
	assert.equal(f.calls.length, 0);
	assert.ok(!f.driver.resources.has(`volume:terminay-bot-${botId}-home`));
});
test('4.9 shipped helper confinement and atomic-upload integration in a throwaway home', () => {
	const helper = fileURLToPath(
		new URL('../../../docker/terminay-bot/bin/terminay-files', import.meta.url),
	);
	const result = spawnSync(
		'python3',
		[
			'-c',
			`import importlib.machinery,importlib.util,os,tempfile,json,sys,io
sys.dont_write_bytecode=True
loader=importlib.machinery.SourceFileLoader('files',${JSON.stringify(helper)})
spec=importlib.util.spec_from_loader(loader.name,loader);m=importlib.util.module_from_spec(spec);loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 m.HOME=d;h=m.Home(['.codex/auth.json']);s=m.Server(h);messages=[];m.send=messages.append
 os.mkdir(d+'/.codex');open(d+'/.codex/auth.json','w').write('protected')
 os.symlink('/etc',d+'/escape')
 for req in [{'op':'list','path':'escape'},{'op':'read','path':'escape/passwd'},{'op':'delete','path':'.codex'},{'op':'rename','from':'.codex','to':'moved'},{'op':'read','path':'.codex/auth.json'}]:
  try:s.handle({'id':1,**req});raise AssertionError('not refused')
  except (m.Refused,OSError):pass
 s.handle({'id':2,'op':'write-begin','path':'uploaded','size':3});s.handle({'id':2,'op':'write-chunk','data':'YWJj'})
 assert not os.path.exists(d+'/uploaded')
 s.handle({'id':2,'op':'write-commit'});assert open(d+'/uploaded').read()=='abc'
 assert os.stat(d+'/uploaded').st_uid==os.getuid()
 s.handle({'id':3,'op':'list','path':'.'});assert any(e['name']=='escape' and e['kind']=='link' for e in messages[-1]['entries'])
 s.handle({'id':4,'op':'write-begin','path':'cancelled','size':3});s.handle({'id':5,'op':'cancel','target':4});assert not os.path.exists(d+'/cancelled')
`,
		],
		{ encoding: 'utf8' },
	);
	assert.equal(result.status, 0, result.stderr);
});

test('4.9 folder download streams a PAX tar through confined file operations and refuses links', async () => {
	const { botFolderArchive } = await import('../dist/botService/index.js');
	const unicode = `${'é'.repeat(60)}.txt`;
	const files = {
		stat: async () => ({ kind: 'dir', mtime: 1 }),
		list: async () => ({
			entries: [{ name: unicode, kind: 'file', size: 5, mtime: 1 }],
			truncated: false,
		}),
		read: async function* () {
			yield Buffer.from('he');
			yield Buffer.from('llo');
		},
	};
	const chunks = [];
	for await (const bytes of botFolderArchive(files, 'folder'))
		chunks.push(bytes);
	const archive = Buffer.concat(chunks);
	const content = spawnSync(
		'python3',
		[
			'-c',
			`import io,sys,tarfile
archive=tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()))
name=${JSON.stringify('folder/')}+${JSON.stringify('é')}*60+'.txt'
assert name in archive.getnames()
sys.stdout.buffer.write(archive.extractfile(name).read())`,
		],
		{ input: archive, encoding: 'utf8' },
	);
	assert.equal(content.status, 0, content.stderr);
	assert.equal(content.stdout, 'hello');
	files.list = async () => ({
		entries: [{ name: 'escape', kind: 'link', size: 0, mtime: 1 }],
		truncated: false,
	});
	await assert.rejects(async () => {
		for await (const _chunk of botFolderArchive(files, 'folder')) {
		}
	}, /refuses links/);
	files.list = async () => ({ entries: [], truncated: true });
	await assert.rejects(async () => {
		for await (const _chunk of botFolderArchive(files, 'folder')) {
		}
	}, /listing bound/);
});

const integrationEngine = process.env.TERMINAY_BOT_INTEGRATION_ENGINE;
test('4.9 opt-in stopped-volume helper ownership, limits, watch and symlink confinement', {
	skip: !integrationEngine,
	timeout: 60_000,
}, async (t) => {
	assert.ok(['docker', 'podman'].includes(integrationEngine));
	const { randomUUID } = await import('node:crypto');
	const { BotEngine } = await import('../dist/botService/index.js');
	const id = randomUUID().replaceAll('-', '').slice(0, 12),
		server = `files-integration-${id}`;
	const engine = new BotEngine({
		load: async () => undefined,
		save: async () => {},
	});
	assert.equal((await engine.check(integrationEngine)).available, true);
	const driver = engine.driver,
		service = new BotFilesService(server, {
			engine: async () => driver,
			protectedPaths: () => ['.codex/auth.json'],
		});
	const volume = `terminay-bot-${id}-home`;
	t.after(async () => {
		try {
			await service.close();
			await driver.run(['volume', 'rm', volume]);
		} finally {
			engine.close();
		}
	});
	const view = await service.acquire(id);
	assert.equal(
		await driver.inspect('container', `terminay-bot-${id}`),
		undefined,
	);
	async function* data() {
		yield Buffer.from('hello');
	}
	await view.write('uploaded', 5, data());
	let content = '';
	for await (const chunk of view.read('uploaded'))
		content += Buffer.from(chunk).toString();
	assert.equal(content, 'hello');
	const probe = (command) =>
		driver.run([
			'run',
			'--rm',
			'--pull',
			'never',
			'--network',
			'none',
			'--read-only',
			'--cap-drop',
			'ALL',
			'--cpus',
			'0.5',
			'--memory',
			'268435456',
			'--pids-limit',
			'64',
			'--user',
			'bot',
			'--mount',
			`type=volume,source=${volume},target=/home/bot`,
			'--entrypoint',
			command[0],
			'terminay-bot:local',
			...command.slice(1),
		]);
	assert.equal(
		(await probe(['stat', '-c', '%U', '/home/bot/uploaded'])).trim(),
		'bot',
	);
	await probe(['ln', '-s', '/etc', '/home/bot/escape']);
	await assert.rejects(async () => {
		for await (const _chunk of view.read('escape/passwd')) {
		}
	}, /refused/);
	assert.throws(() => view.read('.codex/auth.json'), /protected/);
	const ids = (
		await driver.run([
			'container',
			'ls',
			'-q',
			'--filter',
			`label=terminay.helper=${id}`,
		])
	)
		.trim()
		.split(/\s+/);
	assert.equal(ids.length, 1);
	const inspect = await driver.inspect('container', ids[0]);
	assert.equal(inspect.HostConfig.NetworkMode, 'none');
	assert.equal(inspect.HostConfig.ReadonlyRootfs, true);
	assert.equal(inspect.HostConfig.Memory, 268435456);
	assert.equal(inspect.HostConfig.PidsLimit, 64);
	let changed;
	const event = new Promise((resolve) => (changed = resolve));
	const stop = await view.watch(['.'], changed);
	await view.mkdir('watched');
	await event;
	stop();
	view.close();
});
