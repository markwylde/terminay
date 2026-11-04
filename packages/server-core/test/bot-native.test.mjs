import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { noBotCredentials } from '../dist/botService/credentials.js';
import { BotNativeClient, nativeArguments } from '../dist/botService/native.js';

function fixture(
	mode = 'ask',
	driver = 'claude-code-cli',
	credential = noBotCredentials(),
) {
	const process = new EventEmitter();
	Object.assign(process, {
		stdin: new PassThrough(),
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: () => true,
	});
	const sent = [];
	let input = '';
	process.stdin.on('data', (chunk) => {
		input += chunk;
		let i = input.indexOf('\n');
		while (i >= 0) {
			const line = input.slice(0, i);
			input = input.slice(i + 1);
			if (driver === 'claude-code-cli') sent.push(JSON.parse(line));
			i = input.indexOf('\n');
		}
	});
	const client = new BotNativeClient(process, credential, driver, mode);
	const receive = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
	return { process, sent, client, receive };
}
async function start(f) {
	const init = f.client.initialize();
	if (f.sent.length)
		f.receive({
			type: 'control_response',
			response: { request_id: 'initialize', subtype: 'success' },
		});
	await init;
	await f.client.open(null, null);
	const turn = f.client.prompt('check', 1000);
	turn.catch(() => {});
	return { turn };
}
const request = {
	type: 'control_request',
	request_id: 'tool-1',
	request: {
		subtype: 'can_use_tool',
		tool_name: 'Bash',
		input: { command: 'echo hello' },
	},
};
for (const answer of ['allow', 'deny'])
	test(`Claude native ${answer}, first answer wins`, async () => {
		const f = fixture();
		const { turn } = await start(f);
		f.receive(request);
		const p = f.client.permissions[0];
		assert.equal(p.toolCall.title, 'Bash');
		f.client.answer(p.id, answer);
		assert.equal(f.sent.at(-1).response.response.behavior, answer);
		assert.throws(() => f.client.answer(p.id, answer), /already answered/);
		f.receive({
			type: 'result',
			subtype: 'success',
			is_error: false,
			result: 'done',
		});
		f.process.emit('close', 0);
		await turn;
	});
test('expired approval denies and cancellation rejects pending permissions', async () => {
	const f = fixture();
	const { turn } = await start(f);
	f.receive(request);
	f.client.timeout();
	assert.equal(f.sent.at(-1).response.response.behavior, 'deny');
	assert.equal(f.client.permissions.length, 0);
	const cancelled = f.client.cancel();
	cancelled.catch(() => {});
	f.process.emit('close', 0);
	await assert.rejects(cancelled);
	await assert.rejects(turn);
});
test('native success waits for zero exit and valid terminal event', async () => {
	for (const [terminal, code] of [
		[false, 0],
		[true, 1],
		[true, 0],
	]) {
		const f = fixture('autonomous', 'codex-cli');
		const { turn } = await start(f);
		if (terminal) f.receive({ type: 'turn.completed' });
		let done = false;
		turn.then(
			() => (done = true),
			() => {},
		);
		await Promise.resolve();
		assert.equal(done, false);
		f.process.emit('close', code);
		if (terminal && code === 0) await turn;
		else await assert.rejects(turn);
	}
});
test('fragmented, malformed and oversized records stay bounded', async () => {
	const f = fixture();
	const { turn } = await start(f);
	const events = [];
	f.client.on('update', (v) => events.push(v));
	const line = `${JSON.stringify({
		type: 'stream_event',
		event: { type: 'content_block_delta', delta: { text: 'hello' } },
	})}\n`;
	f.process.stdout.write(line.slice(0, 17));
	f.process.stdout.write(line.slice(17));
	assert.equal(events[0].content.text, 'hello');
	f.process.stdout.write('{bad}\n');
	await assert.rejects(turn);
	f.client.dispose();
	const large = fixture();
	const t = await start(large);
	large.process.stdout.write('a'.repeat(16 * 1024 * 1024 + 1));
	await assert.rejects(t.turn);
	large.client.dispose();
});
test('Ask me uses native host permission channel, never a bypass flag', () => {
	const args = nativeArguments('claude-code-cli', null, 'ask', [], false);
	assert.ok(args.includes('--permission-prompt-tool'));
	assert.ok(args.includes('stdio'));
	assert.equal(
		args.some(
			(a) => a.includes('skip-permissions') || a === 'bypassPermissions',
		),
		false,
	);
	assert.throws(
		() => nativeArguments('codex-cli', null, 'ask', [], false),
		/Autonomous/,
	);
});

test('large screenshot results keep bounded metadata in diagnostics', async () => {
	const f = fixture();
	const { turn } = await start(f);
	const updates = [];
	f.client.on('update', (v) => updates.push(v));
	f.receive({
		type: 'user',
		message: {
			content: [
				{
					type: 'tool_result',
					tool_use_id: 'shot',
					content: [
						{
							type: 'image',
							source: {
								type: 'base64',
								media_type: 'image/png',
								data: 'a'.repeat(3 * 1024 * 1024),
							},
						},
					],
				},
			],
		},
	});
	assert.match(updates[0].rawOutput, /binary result omitted/);
	assert.ok(updates[0].rawOutput.length < 1024);
	f.receive({ type: 'result', subtype: 'success', is_error: false });
	f.process.emit('close', 0);
	await turn;
});

test('Codex cancellation asks the owned supervisor to interrupt before awaiting exit', async () => {
	const f = fixture('autonomous', 'codex-cli');
	let interrupts = 0;
	// Driver contract: the privileged host provides this callback, never the renderer.
	const client = new BotNativeClient(
		f.process,
		noBotCredentials(),
		'codex-cli',
		'autonomous',
		async () => {
			interrupts++;
		},
	);
	await client.initialize();
	const turn = client.prompt('check', 1000);
	turn.catch(() => {});
	const cancelled = client.cancel();
	cancelled.catch(() => {});
	await Promise.resolve();
	assert.equal(interrupts, 1);
	f.process.emit('close', 130);
	await assert.rejects(turn);
	await assert.rejects(cancelled);
});
