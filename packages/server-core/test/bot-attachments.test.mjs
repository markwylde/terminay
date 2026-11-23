import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	BOT_ATTACHMENT_TYPE_BYTES,
	botAttachmentType,
	isBotVideoMime,
} from '@terminay/protocol';
import { readBotAttachment } from '../dist/botService/images.js';
import { BotMessageStore } from '../dist/botService/messages.js';
import { BotExecutionRuntime } from '../dist/botService/runtime.js';
import { BotSessionStore } from '../dist/botService/sessions.js';

const bot = 'abc123def456';
const MiB = 1024 * 1024;
const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD0kAAAAASUVORK5CYII=',
	'base64',
);
const ftyp = (brand) =>
	Buffer.concat([
		Buffer.from([0, 0, 0, 24]),
		Buffer.from(`ftyp${brand}`, 'latin1'),
		Buffer.alloc(12),
	]);
const ebml = (doc) =>
	Buffer.concat([
		Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x83 + doc.length]),
		Buffer.from([0x42, 0x82, 0x80 + doc.length]),
		Buffer.from(doc),
	]);
const sized = (head, size) => {
	const bytes = Buffer.alloc(size, 7);
	head.copy(bytes);
	return bytes;
};
const mp4 = ftyp('isom');
const webm = ebml('webm');

function containerDriver(root, options = {}) {
	const state = { owned: true, running: true, calls: 0 };
	return {
		state,
		inspect: async () => ({
			State: { Running: state.running },
			Config: {
				Labels: {
					'terminay.server': state.owned ? 'server' : 'other',
					'terminay.bot': bot,
					'terminay.managed': '1',
				},
			},
		}),
		exec: async (_name, args, run) => {
			state.calls++;
			assert.equal(run.user, 'bot');
			if (options.exec) return options.exec(args, run);
			const source = (options.source ?? ((s) => s))(args[2]).replace(
				"root='/tmp' if path.startswith('/tmp/') else '/home/bot'",
				`root=${JSON.stringify(root)}`,
			);
			return execFileSync(
				'python3',
				['-c', source, join(root, args[3].slice('/tmp/'.length))],
				{
					encoding: 'utf8',
					maxBuffer: run.maxBytes,
					stdio: ['ignore', 'pipe', 'pipe'],
				},
			);
		},
	};
}
function workspace(t) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'bot-attachments-')));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}
const read = (driver, path, name = path) =>
	readBotAttachment(driver, 'server', bot, `/tmp/${path}`, name);

test('video types come from a bounded content check', () => {
	for (const brand of [
		'isom',
		'iso2',
		'iso3',
		'iso4',
		'iso5',
		'iso6',
		'mp41',
		'mp42',
		'avc1',
		'M4V ',
	])
		assert.equal(botAttachmentType(ftyp(brand)), 'video/mp4');
	assert.equal(botAttachmentType(webm), 'video/webm');
	// The bounded window can end between complete children of a larger header.
	const longHeader = Buffer.concat([
		Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0xe4]),
		webm.subarray(5),
		Buffer.from([0xec, 0xb2]),
		Buffer.alloc(50),
	]);
	assert.equal(longHeader.length, BOT_ATTACHMENT_TYPE_BYTES);
	assert.equal(botAttachmentType(longHeader), 'video/webm');
	const opaque = 'application/octet-stream';
	for (const brand of ['heic', 'mif1', 'avif', 'msf1', 'qt  '])
		assert.equal(botAttachmentType(ftyp(brand)), opaque);
	for (const content of [
		ebml('matroska'),
		mp4.subarray(0, 10),
		mp4.subarray(0, 16),
		// A valid DocType must not hide a truncated or malformed header tail.
		Buffer.concat([
			Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x89]),
			webm.subarray(5),
			Buffer.from([0x42]),
		]),
		Buffer.concat([
			Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x88]),
			webm.subarray(5),
			Buffer.from([0]),
		]),
		webm.subarray(0, webm.length - 1),
		Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
		Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0xff, 0x42, 0x82, 0x84]),
		Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x85, 0x00, 0x82, 0x84, 1, 2]),
		Buffer.from('not a video'),
		Buffer.alloc(0),
	])
		assert.equal(botAttachmentType(content), opaque);
	for (const content of [sized(mp4, 4096), sized(webm, 4096)])
		assert.equal(
			botAttachmentType(content.subarray(0, BOT_ATTACHMENT_TYPE_BYTES)),
			botAttachmentType(content),
		);
	assert.equal(isBotVideoMime('video/mp4'), true);
	assert.equal(isBotVideoMime('video/x-matroska'), false);
});

test('a bot can read any regular file under the upload limits', async (t) => {
	const root = workspace(t);
	const driver = containerDriver(root);
	const zip = sized(Buffer.from('PK\x03\x04'), 3 * MiB);
	writeFileSync(join(root, 'clip.mp4'), sized(mp4, 833 * 1024));
	writeFileSync(join(root, 'logs.zip'), zip);
	writeFileSync(join(root, 'max.webm'), sized(webm, 5 * MiB));
	writeFileSync(join(root, 'screen.png'), png);
	assert.equal((await read(driver, 'clip.mp4')).mime, 'video/mp4');
	const archive = await read(driver, 'logs.zip');
	assert.equal(archive.mime, 'application/octet-stream');
	assert.deepEqual(Buffer.from(archive.bytes), zip);
	assert.equal((await read(driver, 'max.webm')).bytes.length, 5 * MiB);
	assert.equal((await read(driver, 'screen.png')).mime, 'image/png');
});

test('size refusals state the file, size, type and limit', async (t) => {
	const root = workspace(t);
	const driver = containerDriver(root);
	writeFileSync(join(root, 'video.mp4'), sized(mp4, 6.1 * MiB));
	writeFileSync(join(root, 'big.webm'), sized(webm, 6 * MiB));
	writeFileSync(join(root, 'anim.gif'), sized(Buffer.from('GIF89a'), 3 * MiB));
	writeFileSync(join(root, 'empty.bin'), '');
	await assert.rejects(
		read(driver, 'video.mp4'),
		/^Error: video\.mp4 is 6\.1 MiB \(video\/mp4\); non-image attachments are limited to 5 MiB$/,
	);
	await assert.rejects(read(driver, 'big.webm'), /\(video\/webm\)/);
	await assert.rejects(
		read(driver, 'anim.gif'),
		/anim\.gif is 3\.0 MiB \(image\/gif\); images are limited to 2 MiB\. Convert an animation to MP4 or WebM/,
	);
	await assert.rejects(read(driver, 'empty.bin'), /empty\.bin is empty/);
});

test('reads refuse unsafe paths and report only the cause', async (t) => {
	const root = workspace(t);
	const driver = containerDriver(root);
	writeFileSync(join(root, 'real.mp4'), mp4);
	mkdirSync(join(root, 'folder'));
	symlinkSync(join(root, 'real.mp4'), join(root, 'link.mp4'));
	symlinkSync(root, join(root, 'alias'));
	execFileSync('mkfifo', [join(root, 'pipe')]);
	await assert.rejects(read(driver, 'link.mp4'), /through a symlink/);
	await assert.rejects(read(driver, 'alias/real.mp4'), /through a symlink/);
	await assert.rejects(read(driver, 'folder'), /not a regular file/);
	await assert.rejects(read(driver, 'pipe'), /not a regular file/);
	await assert.rejects(read(driver, 'gone.mp4'), /does not exist/);
	const before = driver.state.calls;
	for (const path of [
		'/etc/passwd',
		'/tmp/../secret',
		'/tmp//real.mp4',
		'/tmp/a\0.mp4',
		7,
	])
		await assert.rejects(
			readBotAttachment(driver, 'server', bot, path, 'x'),
			/Attachment|attachment/,
		);
	driver.state.owned = false;
	await assert.rejects(read(driver, 'real.mp4'), /must be running/);
	driver.state.owned = true;
	driver.state.running = false;
	await assert.rejects(read(driver, 'real.mp4'), /must be running/);
	assert.equal(driver.state.calls, before);
});

test('a file growing during the read stays bounded', async (t) => {
	const root = workspace(t);
	// The size check passes as if the file was small when it was opened.
	const driver = containerDriver(root, {
		source: (s) => s.replace('if info.st_size>limit:', 'if False:'),
	});
	writeFileSync(join(root, 'grown.mp4'), sized(mp4, 6 * MiB));
	await assert.rejects(
		read(driver, 'grown.mp4'),
		/grown\.mp4 is 5\.0 MiB \(video\/mp4\); non-image attachments/,
	);
});

test('malformed reader output and cancellation are refusals', async () => {
	for (const output of [
		'',
		'not json\n',
		'null\n',
		'[]\n',
		'{"size":3,"over":"yes"}\nAAAA',
		`{"size":6291456,"over":true,"head":"${Buffer.alloc(65).toString('base64')}"}\n`,
		'{"size":3}\n!!!!',
		'{"size":9}\nAAAA',
		'{"size":-1}\n',
		'{"error":"other"}\n',
		'{"size":10,"over":true,"head":"AAAA"}\n',
		`${'x'.repeat(2000)}\n`,
	]) {
		const driver = containerDriver('/unused', { exec: async () => output });
		await assert.rejects(
			read(driver, 'x.mp4', 'x.mp4'),
			/x\.mp4 could not be read/,
		);
	}
	const controller = new AbortController();
	const driver = containerDriver('/unused', {
		exec: async (_args, run) => {
			controller.abort();
			run.signal.throwIfAborted();
		},
	});
	await assert.rejects(
		readBotAttachment(
			driver,
			'server',
			bot,
			'/tmp/x.mp4',
			'x.mp4',
			controller.signal,
		),
		/abort/i,
	);
});

function runtimeSetup(t, driver) {
	const root = workspace(t);
	const messages = new BotMessageStore(join(root, 'messages'));
	const sessions = new BotSessionStore(join(root, 'sessions'));
	t.after(() => sessions.close());
	let runtime;
	const service = {
		messages,
		sessions,
		now: () => Date.now(),
		triggers: { list: () => ({ revision: 1, triggers: [] }) },
		queue: { promote: () => true, active: () => [] },
		redactMessage: async (_bot, value) => value,
		postBotMessage: async (id, text, key, captured, threadId) => {
			runtime.assert(id);
			const attachments = captured.map((file) =>
				messages.putAttachment(bot, file.name, file.bytes),
			);
			return messages.post(
				bot,
				'bot',
				text,
				id,
				key,
				attachments,
				[],
				threadId,
			);
		},
		stop: async () => undefined,
	};
	runtime = new BotExecutionRuntime(service, async () => driver, 'server');
	const create = (attachments = []) => {
		const message = messages.post(
			bot,
			'user',
			'Go',
			null,
			Math.random().toString(),
			attachments,
		);
		const record = sessions.create(
			bot,
			{ kind: 'chat', messageId: message.id },
			{
				agentId: 'fake',
				modelId: null,
				signIn: { kind: 'none' },
				approvalMode: 'autonomous',
				instructions: '',
				context: '',
				maxTurnMs: 10000,
			},
		);
		runtime.register(record.id);
		sessions.patch(record.id, { state: 'running' });
		return sessions.get(record.id);
	};
	const botPosts = () =>
		messages.list(bot).items.filter((m) => m.author === 'bot');
	return { root, messages, sessions, runtime, create, botPosts };
}

test('chat_post captures an MP4 and returns metadata only', async (t) => {
	const dir = workspace(t);
	writeFileSync(join(dir, 'clip.mp4'), sized(mp4, 833 * 1024));
	const r = runtimeSetup(t, containerDriver(dir));
	const run = r.create();
	const result = await r.runtime.call(run.id, 'chat_post', {
		text: 'Here it is',
		key: 'k',
		attachments: [{ path: '/tmp/clip.mp4', name: 'clip.mp4' }],
	});
	assert.equal(result.attachments.length, 1);
	assert.equal(result.attachments[0].mime, 'video/mp4');
	assert.equal(result.attachments[0].size, 833 * 1024);
	assert.equal('bytes' in result.attachments[0], false);
	assert.equal(
		r.messages.attachment(bot, result.attachments[0].id).mime,
		'video/mp4',
	);
});

test('one refused attachment refuses the whole post', async (t) => {
	const dir = workspace(t);
	writeFileSync(join(dir, 'screen.png'), png);
	writeFileSync(join(dir, 'empty.bin'), '');
	const r = runtimeSetup(t, containerDriver(dir));
	const run = r.create();
	await assert.rejects(
		r.runtime.call(run.id, 'chat_post', {
			text: 'Both',
			key: 'k',
			attachments: [
				{ path: '/tmp/screen.png', name: 'screen.png' },
				{ path: '/tmp/empty.bin', name: 'empty.bin' },
			],
		}),
		/empty\.bin is empty/,
	);
	assert.equal(r.botPosts().length, 0);
});

test('revocation during capture creates no message', async (t) => {
	const dir = workspace(t);
	writeFileSync(join(dir, 'clip.mp4'), mp4);
	let r;
	let run;
	const inner = containerDriver(dir);
	const driver = {
		...inner,
		exec: async (...args) => {
			const output = await inner.exec(...args);
			r.sessions.patch(run.id, {
				runtime: { ...r.sessions.get(run.id).runtime, revoked: true },
			});
			return output;
		},
	};
	r = runtimeSetup(t, driver);
	run = r.create();
	await assert.rejects(
		r.runtime.call(run.id, 'chat_post', {
			text: 'Late',
			key: 'k',
			attachments: [{ path: '/tmp/clip.mp4', name: 'clip.mp4' }],
		}),
		/active/,
	);
	assert.equal(r.botPosts().length, 0);
});

test('the tool and briefing state what bots can attach', async (t) => {
	const { BOT_RUNTIME_TOOLS } = await import('../dist/botService/runtime.js');
	const tool = BOT_RUNTIME_TOOLS.find((x) => x.name === 'chat_post');
	assert.match(
		tool.description,
		/images .* up to 2 MiB, any other file up to 5 MiB/,
	);
	assert.match(tool.description, /MP4 and WebM play inline/);
	const r = runtimeSetup(t, containerDriver('/unused'));
	const briefing = r.runtime.briefing(r.create().id);
	assert.match(briefing, /screenshots, videos and other files with chat_post/);
	assert.match(
		briefing,
		/up to 4 per message, images up to 2 MiB, any other file up to 5 MiB/,
	);
});

test('a video reaches an execution as a file with an opaque snapshot', async (t) => {
	const r = runtimeSetup(t, containerDriver('/unused'));
	const clip = r.messages.putAttachment(bot, 'clip.mp4', sized(mp4, 2048));
	assert.equal(clip.mime, 'video/mp4');
	const run = r.create([clip]);
	const [snapshot] = r.sessions.get(run.id).runtime.triggerAttachments;
	assert.equal(snapshot.mime, 'application/octet-stream');
	const reloaded = new BotSessionStore(join(r.root, 'sessions'));
	t.after(() => reloaded.close());
	assert.equal(
		reloaded.get(run.id).runtime.triggerAttachments[0].mime,
		'application/octet-stream',
	);
	const briefing = r.runtime.briefing(run.id);
	assert.match(briefing, /"mime":"video\/mp4"/);
	assert.match(briefing, /terminay-attachments\/[a-z0-9]{24}\/1\.mp4/);
});
