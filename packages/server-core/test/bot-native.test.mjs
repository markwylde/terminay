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
	const turn = f.client.prompt('check');
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
test('cancellation denies and rejects pending permissions', async () => {
	const f = fixture();
	const { turn } = await start(f);
	f.receive(request);
	const cancelled = f.client.cancel();
	cancelled.catch(() => {});
	assert.equal(
		f.sent.find((m) => m.type === 'control_response').response.response
			.behavior,
		'deny',
	);
	assert.equal(f.client.permissions.length, 0);
	f.process.emit('close', 0);
	await assert.rejects(cancelled);
	await assert.rejects(turn);
});
const STOPPED_LINE =
	'Background tasks still running 10m after the last turn (monitor "CI"); stopping them. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.\n';
const success = { type: 'result', subtype: 'success', is_error: false };
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('a clean exit after Claude stops background work is not a success', async () => {
	const f = fixture('autonomous');
	const { turn } = await start(f);
	f.receive(success);
	f.process.stderr.write(STOPPED_LINE);
	await tick();
	f.process.emit('close', 0);
	await assert.rejects(turn, { name: 'BotBackgroundStoppedError' });
});
test('the background-stop line is recognised across stderr chunks', async () => {
	const f = fixture('autonomous');
	const { turn } = await start(f);
	f.receive(success);
	f.process.stderr.write(STOPPED_LINE.slice(0, 30));
	await tick();
	f.process.stderr.write(STOPPED_LINE.slice(30));
	await tick();
	f.process.emit('close', 0);
	await assert.rejects(turn, { name: 'BotBackgroundStoppedError' });
});
test('the same words in a reply or inside another stderr line do not fail a turn', async () => {
	const f = fixture('autonomous');
	const { turn } = await start(f);
	f.receive({ ...success, result: STOPPED_LINE });
	f.process.stderr.write(`tool said: ${STOPPED_LINE}`);
	await tick();
	f.process.emit('close', 0);
	await turn;
});
const backgroundTasks = (...ids) => ({
	type: 'system',
	subtype: 'background_tasks_changed',
	tasks: ids.map((task_id) => ({ task_id })),
});
test('a turn survives a long quiet wait after its first result', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const f = fixture('autonomous');
	const { turn } = await start(f);
	let settled = false;
	turn.then(
		() => (settled = true),
		() => (settled = true),
	);
	f.receive(backgroundTasks('monitor'));
	f.receive(success);
	t.mock.timers.tick(6 * 60 * 60_000);
	await Promise.resolve();
	assert.equal(settled, false);
	f.receive(backgroundTasks());
	f.receive({ ...success, result: 'monitor finished' });
	f.process.emit('close', 0);
	await turn;
});
test('Autonomous approvals survive multiple background results through final exit', async () => {
	const f = fixture('autonomous');
	const { turn } = await start(f);
	f.receive(backgroundTasks('batch', 'monitor'));
	f.receive(success);
	f.receive(backgroundTasks('monitor'));
	f.receive(success);
	f.receive(backgroundTasks());
	assert.equal(f.process.stdin.writableEnded, false);
	f.receive(request);
	assert.equal(f.sent.at(-1).response.response.behavior, 'allow');

	f.receive(backgroundTasks('new-job'));
	f.receive(success);
	f.receive(backgroundTasks());
	f.receive({
		...request,
		request_id: 'report',
		request: {
			...request.request,
			tool_name: 'mcp__terminay_bot__outcome_report',
		},
	});
	assert.equal(f.sent.at(-1).response.request_id, 'report');
	assert.equal(f.sent.at(-1).response.response.behavior, 'allow');
	f.receive(success);
	assert.equal(f.process.stdin.writableEnded, true);
	f.process.emit('close', 0);
	await turn;
});
test('Claude drains each queued wake-up before closing the approval stream', async () => {
	const f = fixture('autonomous');
	const { turn } = await start(f);
	f.receive({ type: 'system', subtype: 'init' });
	f.receive(backgroundTasks('batch', 'monitor'));
	for (const status of ['completed', 'failed']) {
		f.receive({ type: 'system', subtype: 'task_notification', status });
	}
	f.receive(backgroundTasks());
	f.receive(success);
	f.receive({ type: 'system', subtype: 'init' });
	f.receive(success);
	assert.equal(f.process.stdin.writableEnded, false);
	f.receive({ type: 'system', subtype: 'init' });
	f.receive(request);
	assert.equal(f.sent.at(-1).response.response.behavior, 'allow');
	f.receive(success);
	assert.equal(f.process.stdin.writableEnded, true);
	f.process.emit('close', 0);
	await turn;
});
test('a task stopped by Claude does not reserve a wake-up', async () => {
	const f = fixture('autonomous');
	const { turn } = await start(f);
	f.receive(backgroundTasks('batch'));
	f.receive({ type: 'system', subtype: 'task_notification', status: 'stopped' });
	f.receive(backgroundTasks());
	f.receive(success);
	assert.equal(f.process.stdin.writableEnded, true);
	f.process.emit('close', 0);
	await turn;
});
test('an interim result alone cannot complete an execution', async () => {
	const f = fixture('autonomous');
	const { turn } = await start(f);
	f.receive(backgroundTasks('monitor'));
	f.receive(success);
	f.receive(backgroundTasks());
	f.process.emit('close', 0);
	await assert.rejects(turn);
});
test('Stop can interrupt Claude while background work is still active', async () => {
	const f = fixture('autonomous');
	const { turn } = await start(f);
	f.receive(backgroundTasks('monitor'));
	f.receive(success);
	const cancelled = f.client.cancel();
	cancelled.catch(() => {});
	assert.equal(f.sent.at(-1).request.subtype, 'interrupt');
	f.process.emit('close', 0);
	await assert.rejects(cancelled);
	await assert.rejects(turn);
});
test('Ask me answers a wake-up request and Stop denies another pending request', async () => {
	const f = fixture();
	const { turn } = await start(f);
	f.receive(backgroundTasks('monitor'));
	f.receive(success);
	f.receive(backgroundTasks());
	f.receive(request);
	f.client.answer(f.client.permissions[0].id, 'allow');
	assert.equal(f.sent.at(-1).response.response.behavior, 'allow');
	f.receive({ ...request, request_id: 'pending' });
	const cancelled = f.client.cancel();
	cancelled.catch(() => {});
	assert.equal(f.sent.at(-2).response.response.behavior, 'deny');
	assert.equal(f.sent.at(-1).request.subtype, 'interrupt');
	assert.deepEqual(f.client.permissions, []);
	f.process.emit('close', 0);
	await assert.rejects(cancelled);
	await assert.rejects(turn);
});
test('ordinary Claude completion closes input without a background snapshot', async () => {
	const f = fixture('autonomous');
	const { turn } = await start(f);
	f.receive({ ...backgroundTasks(), tasks: null });
	f.receive(success);
	assert.equal(f.process.stdin.writableEnded, true);
	f.process.emit('close', 0);
	await turn;
});
const closedApprovalStream =
	'Tool permission request failed: AbortError: Stream closed';
for (const fromProvider of [true, false]) {
	test(`approval stream closure from ${fromProvider ? 'Claude fails' : 'tool output preserves'} the execution`, async () => {
		const f = fixture('autonomous');
		const { turn } = await start(f);
		const updates = [];
		f.client.on('update', (update) => updates.push(update));
		f.receive({
			type: 'user',
			tool_result_meta: [
				{
					id: fromProvider ? 'report' : 'different-tool',
					non_execution_kind: 'permission-rule',
				},
			],
			message: {
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'report',
						is_error: true,
						content: closedApprovalStream,
					},
				],
			},
		});
		assert.equal(updates.at(-1).rawOutput, closedApprovalStream);
		f.receive(success);
		f.process.emit('close', 0);
		if (fromProvider) await assert.rejects(turn, /lost its approval channel/);
		else await turn;
	});
}
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
	const turn = client.prompt('check');
	turn.catch(() => {});
	const cancelled = client.cancel();
	cancelled.catch(() => {});
	await Promise.resolve();
	assert.equal(interrupts, 1);
	f.process.emit('close', 130);
	await assert.rejects(turn);
	await assert.rejects(cancelled);
});
test('Claude receives message images as base64 content blocks after the text', async () => {
	const f = fixture();
	const init = f.client.initialize();
	f.receive({
		type: 'control_response',
		response: { request_id: 'initialize', subtype: 'success' },
	});
	await init;
	await f.client.open(null, null);
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
	const turn = f.client.prompt('look', [
		{ mime: 'image/png', bytes: png },
		{ mime: 'image/webp', bytes: new Uint8Array([1]) },
	]);
	turn.catch(() => {});
	const user = f.sent.find((m) => m.type === 'user');
	assert.deepEqual(user.message.content[0], { type: 'text', text: 'look' });
	assert.deepEqual(user.message.content[1], {
		type: 'image',
		source: {
			type: 'base64',
			media_type: 'image/png',
			data: Buffer.from(png).toString('base64'),
		},
	});
	assert.equal(user.message.content[2].source.media_type, 'image/webp');
	f.client.dispose();
});
test('a prompt without images keeps plain string content', async () => {
	const f = fixture();
	await start(f);
	assert.equal(f.sent.find((m) => m.type === 'user').message.content, 'check');
	f.client.dispose();
});
test('Codex receives message images as --image arguments before the stdin prompt', () => {
	const none = nativeArguments('codex-cli', null, 'autonomous', [], false);
	assert.equal(none.includes('--image'), false);
	assert.equal(none.at(-1), '-');
	const one = nativeArguments('codex-cli', null, 'autonomous', [], false, [
		'/tmp/terminay-attachments/x/1.png',
	]);
	assert.deepEqual(one.slice(-3), [
		'--image',
		'/tmp/terminay-attachments/x/1.png',
		'-',
	]);
	const paths = [1, 2, 3, 4].map((n) => `/tmp/terminay-attachments/x/${n}.png`);
	const four = nativeArguments('codex-cli', 'gpt', 'autonomous', [], false, paths);
	assert.deepEqual(four.slice(-9), [...paths.flatMap((p) => ['--image', p]), '-']);
	assert.equal(
		nativeArguments('claude-code-cli', null, 'ask', [], false, paths).includes('--image'),
		false,
	);
});
