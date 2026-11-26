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
	isBotAudioMime,
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
const id3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x02, 0x01]);
// MPEG-1 Layer III, 128 kbps, 44.1 kHz.
const mp3Frame = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
const wav = Buffer.concat([
	Buffer.from('RIFF'),
	Buffer.alloc(4),
	Buffer.from('WAVEfmt '),
]);
const flac = Buffer.from('fLaC\0\0\0\x22', 'latin1');
const ogg = (
	packet,
	{ segments = 1, version = 0, flags = 0x02, lacing } = {},
) => {
	const table = lacing ?? Array(segments).fill(30);
	return Buffer.concat([
		Buffer.from('OggS', 'latin1'),
		Buffer.from([version, flags]),
		Buffer.alloc(20),
		Buffer.from([table.length]),
		Buffer.from(table),
		Buffer.from(packet, 'latin1'),
	]);
};
const vorbis = ogg('\x01vorbis\0\0\0\0');
const opus = ogg('OpusHead\x01\x02');

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

test('audio types come from a bounded content check', () => {
	const opaque = 'application/octet-stream';
	const cases = [
		[id3, 'audio/mpeg'],
		[Buffer.from([0x49, 0x44, 0x33, 2, 0, 0, 0, 0, 0, 0]), 'audio/mpeg'],
		[Buffer.from([0x49, 0x44, 0x33, 3, 0, 0x80, 0, 0, 0, 0]), 'audio/mpeg'],
		[mp3Frame, 'audio/mpeg'],
		// MPEG-2 and MPEG-2.5 Layer III.
		[Buffer.from([0xff, 0xf3, 0x90, 0x64]), 'audio/mpeg'],
		[Buffer.from([0xff, 0xe3, 0x50, 0x64]), 'audio/mpeg'],
		[wav, 'audio/wav'],
		[vorbis, 'audio/ogg'],
		[opus, 'audio/ogg'],
		[ogg('OpusHead', { segments: 3 }), 'audio/ogg'],
		[ogg('OpusHead', { lacing: [255, 10] }), 'audio/ogg'],
		[ogg('OpusHead', { lacing: [19] }), 'audio/ogg'],
		[Buffer.from([0x49, 0x44, 0x33, 4, 0, 0x80, 0, 0, 0, 0]), 'audio/mpeg'],
		[flac, 'audio/flac'],
		[ftyp('M4A '), 'audio/mp4'],
	];
	for (const [content, type] of cases) {
		assert.equal(botAttachmentType(content), type, content.toString('hex'));
		assert.equal(botAttachmentType(sized(content, 4096)), type);
	}
	for (const content of [
		// Look-alikes.
		ogg('\x80theora\0\0'),
		ogg('OpusHead', { version: 1 }),
		ogg('OpusHead', { flags: 0 }),
		ogg('OpusHead', { segments: 0 }),
		Buffer.concat([
			Buffer.from('RIFF'),
			Buffer.alloc(4),
			Buffer.from('AVI LIST'),
		]),
		Buffer.from([0x49, 0x44, 0x33, 5, 0, 0, 0, 0, 0, 0]),
		Buffer.from([0x49, 0x44, 0x33, 4, 0xff, 0, 0, 0, 0, 0]),
		Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0x80, 0, 0, 0]),
		// Reserved ID3 flags, per major version.
		Buffer.from([0x49, 0x44, 0x33, 4, 0, 0xff, 0, 0, 0, 0]),
		Buffer.from([0x49, 0x44, 0x33, 4, 0, 0x08, 0, 0, 0, 0]),
		Buffer.from([0x49, 0x44, 0x33, 3, 0, 0x10, 0, 0, 0, 0]),
		Buffer.from([0x49, 0x44, 0x33, 2, 0, 0x20, 0, 0, 0, 0]),
		// A first packet too short for its header, or empty before the header.
		ogg('OpusHead', { lacing: [0, 30] }),
		ogg('OpusHead', { lacing: [10] }),
		ogg('\x01vorbis', { lacing: [20] }),
		Buffer.from([0xff, 0xeb, 0x90, 0x64]), // reserved version
		Buffer.from([0xff, 0xfd, 0x90, 0x64]), // layer II
		Buffer.from([0xff, 0xf9, 0x90, 0x64]), // reserved layer
		Buffer.from([0xff, 0xfb, 0x00, 0x64]), // free bitrate
		Buffer.from([0xff, 0xfb, 0xf0, 0x64]), // bad bitrate
		Buffer.from([0xff, 0xfb, 0x9c, 0x64]), // reserved sample rate
		ftyp('M4B '),
		// Truncated headers.
		Buffer.from([0x49, 0x44, 0x33, 4, 0]),
		Buffer.from('RIFF'),
		wav.subarray(0, 11),
		ogg('OpusHead').subarray(0, 32),
		ogg('OpusHead', { segments: 40 }).subarray(0, 60),
		Buffer.from('fLa'),
		mp3Frame.subarray(0, 2),
		mp3Frame.subarray(0, 3),
	])
		assert.equal(botAttachmentType(content), opaque, content.toString('hex'));
	// A long segment table pushes the first packet out of the window.
	assert.equal(
		botAttachmentType(sized(ogg('OpusHead', { segments: 40 }), 4096)),
		opaque,
	);
	// The video brands are not audio.
	assert.equal(botAttachmentType(ftyp('isom')), 'video/mp4');
	assert.equal(isBotAudioMime('audio/flac'), true);
	assert.equal(isBotAudioMime('audio/aac'), false);
	assert.equal(isBotVideoMime('audio/mp4'), false);
});

test('a user upload records audio from its content', (t) => {
	const dir = workspace(t);
	const store = new BotMessageStore(join(dir, 'messages'));
	const { attachment } = store.stage(bot, 'song.dat', sized(id3, 4 * MiB));
	assert.deepEqual(attachment, {
		name: 'song.dat',
		mime: 'audio/mpeg',
		size: 4 * MiB,
	});
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
	writeFileSync(join(root, 'take.flac'), sized(flac, 7 * MiB));
	await assert.rejects(
		read(driver, 'take.flac'),
		/^Error: take\.flac is 7\.0 MiB \(audio\/flac\); non-image attachments are limited to 5 MiB$/,
	);
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
	assert.match(
		tool.description,
		/MP3, WAV, Ogg, FLAC and M4A play inline as audio/,
	);
	const r = runtimeSetup(t, containerDriver('/unused'));
	const briefing = r.runtime.briefing(r.create().id);
	assert.match(
		briefing,
		/screenshots, videos, audio and other files with chat_post/,
	);
	assert.match(briefing, /MP3, WAV, Ogg, FLAC and M4A play inline as audio/);
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

test('audio reaches an execution as a file with an opaque snapshot', async (t) => {
	const r = runtimeSetup(t, containerDriver('/unused'));
	const song = r.messages.putAttachment(bot, 'song.mp3', sized(id3, 2048));
	const misnamed = r.messages.putAttachment(
		bot,
		'song.dat',
		sized(mp3Frame, 2048),
	);
	assert.equal(song.mime, 'audio/mpeg');
	assert.equal(misnamed.mime, 'audio/mpeg');
	const run = r.create([song, misnamed]);
	const snapshots = r.sessions.get(run.id).runtime.triggerAttachments;
	assert.deepEqual(
		snapshots.map((a) => a.mime),
		['application/octet-stream', 'application/octet-stream'],
	);
	const reloaded = new BotSessionStore(join(r.root, 'sessions'));
	t.after(() => reloaded.close());
	assert.equal(reloaded.get(run.id).runtime.triggerAttachments.length, 2);
	const briefing = r.runtime.briefing(run.id);
	assert.match(briefing, /"name":"song\.mp3","mime":"audio\/mpeg"/);
	assert.match(briefing, /"name":"song\.dat","mime":"audio\/mpeg"/);
	assert.match(briefing, /terminay-attachments\/[a-z0-9]{24}\/1\.mp3/);
	assert.match(briefing, /terminay-attachments\/[a-z0-9]{24}\/2\.dat/);
});
