import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { noBotCredentials } from '../dist/botService/credentials.js';
import {
	BOT_DONE_CHECK_INTERVAL_MS,
	BOT_DONE_SHUTDOWN_MS,
	BotNativeClient,
} from '../dist/botService/native.js';

function clock() {
	const timers = new Map();
	let next = 0;
	let now = 0;
	return {
		timers,
		setTimeout(fn, ms) {
			timers.set(++next, { fn, at: now + ms });
			return next;
		},
		clearTimeout(handle) {
			timers.delete(handle);
		},
		advance(ms) {
			const end = now + ms;
			for (;;) {
				const due = [...timers]
					.filter(([, t]) => t.at <= end)
					.sort((a, b) => a[1].at - b[1].at)[0];
				if (!due) break;
				timers.delete(due[0]);
				now = due[1].at;
				due[1].fn();
			}
			now = end;
		},
	};
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function agent({ mode = 'autonomous', credential } = {}) {
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
			sent.push(JSON.parse(input.slice(0, i)));
			input = input.slice(i + 1);
			i = input.indexOf('\n');
		}
	});
	const time = clock();
	const client = new BotNativeClient(
		process,
		credential ?? noBotCredentials(),
		'claude-code-cli',
		mode,
		undefined,
		time,
	);
	const waits = [];
	const answers = [];
	const checks = [];
	client.on('background-wait', (wait) => waits.push(wait));
	client.on('done-answer', (answer) => answers.push(answer));
	client.on('done-check', (text) => checks.push(text));
	const initialized = client.initialize();
	const send = async (event) => {
		process.stdout.write(`${JSON.stringify(event)}\n`);
		await tick();
	};
	await send({
		type: 'control_response',
		response: { request_id: 'initialize', subtype: 'success' },
	});
	await initialized;
	const turn = client.prompt('task');
	const state = { settled: undefined };
	turn.then(
		() => (state.settled = 'completed'),
		(error) => (state.settled = error),
	);
	await send({ type: 'system', subtype: 'init' });
	const f = {
		process,
		client,
		time,
		sent,
		waits,
		answers,
		checks,
		turn,
		state,
		send,
		init: () => send({ type: 'system', subtype: 'init' }),
		tasks: (...tasks) =>
			send({
				type: 'system',
				subtype: 'background_tasks_changed',
				tasks: tasks.map(
					([task_id, task_type = 'local_bash', description]) => ({
						task_id,
						task_type,
						description: description ?? task_id,
					}),
				),
			}),
		notify: (status = 'completed') =>
			send({ type: 'system', subtype: 'task_notification', status }),
		result: (text = 'ok', extra = {}) =>
			send({
				type: 'result',
				subtype: 'success',
				is_error: false,
				result: text,
				...extra,
			}),
		async wait(ms = BOT_DONE_CHECK_INTERVAL_MS) {
			time.advance(ms);
			await tick();
		},
		asked: () =>
			sent.filter(
				(m) =>
					m.type === 'user' &&
					String(m.message.content).startsWith('Terminay check'),
			),
		nonceLine: () =>
			f
				.asked()
				.at(-1)
				.message.content.split('\n')
				.find((line) => line.startsWith('TERMINAY-DONE ')),
		stops: () =>
			sent
				.filter((m) => m.request?.subtype === 'stop_task')
				.map((m) => m.request.task_id),
		async exit(code = 0) {
			process.emit('close', code);
			await tick();
		},
	};
	return f;
}
/** An agent left holding one Monitor, then asked once. */
async function asked(options) {
	const f = await agent(options);
	await f.tasks(['monitor']);
	await f.result();
	await f.wait();
	await f.init();
	return f;
}

test('a waiting execution is asked after five minutes, listing what holds it', async () => {
	const f = await agent();
	await f.tasks(['m1', 'local_bash', 'watch CI']);
	await f.result();
	await f.wait(BOT_DONE_CHECK_INTERVAL_MS - 1);
	assert.equal(f.asked().length, 0);
	await f.wait(1);
	assert.equal(f.asked().length, 1);
	assert.match(f.asked()[0].message.content, /local_bash: "watch CI"/);
	assert.match(f.nonceLine(), /^TERMINAY-DONE [0-9a-f]{16}$/);
	assert.equal(f.checks.length, 1);
	assert.deepEqual(f.waits[0], {
		waiting: true,
		items: [{ id: 'm1', kind: 'local_bash', description: 'watch CI' }],
		followUps: 0,
	});
	assert.equal(f.process.stdin.writableEnded, false);
});

test('a new turn before five minutes restarts the wait', async () => {
	const f = await agent();
	await f.tasks(['m1']);
	await f.result();
	await f.wait(4 * 60_000);
	await f.init();
	assert.equal(f.waits.at(-1).waiting, false);
	await f.wait(2 * 60_000);
	assert.equal(f.asked().length, 0);
	await f.result();
	await f.wait(BOT_DONE_CHECK_INTERVAL_MS - 1);
	assert.equal(f.asked().length, 0);
	await f.wait(1);
	assert.equal(f.asked().length, 1);
});

test('no check is sent while a permission request is unanswered', async () => {
	const f = await agent({ mode: 'ask' });
	await f.tasks(['a1', 'local_agent']);
	await f.result();
	await f.send({
		type: 'control_request',
		request_id: 'tool',
		request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} },
	});
	await f.wait();
	assert.equal(f.asked().length, 0);
	f.client.answer(f.client.permissions[0].id, 'allow');
	await f.wait();
	assert.equal(f.asked().length, 1);
});

test('nothing pending completes without a check', async () => {
	const f = await agent();
	await f.result();
	assert.equal(f.process.stdin.writableEnded, true);
	await f.wait(60 * 60_000);
	assert.equal(f.asked().length, 0);
	await f.exit();
	assert.equal(f.state.settled, 'completed');
});

test('not done keeps running and is asked again with a new line, for hours', async () => {
	const f = await asked();
	const first = f.nonceLine();
	await f.result('Still waiting for the build.');
	assert.deepEqual(f.answers, ['waiting']);
	await f.wait();
	assert.equal(f.asked().length, 2);
	assert.notEqual(f.nonceLine(), first);
	for (let i = 0; i < 48; i++) {
		await f.init();
		await f.result('Still waiting.');
		await f.wait();
	}
	assert.equal(f.asked().length, 50);
	assert.deepEqual(f.stops(), []);
	assert.equal(f.process.stdin.writableEnded, false);
	assert.equal(f.state.settled, undefined);
});

test('a check that gets no turn is sent again', async () => {
	const f = await agent();
	await f.tasks(['m1']);
	await f.result();
	await f.wait();
	await f.wait();
	assert.equal(f.asked().length, 2);
	assert.equal(f.state.settled, undefined);
});

test('done stops subagents first, then late tasks, then closes input and completes', async () => {
	const f = await agent();
	const all = [['shell'], ['monitor'], ['agent', 'local_agent']];
	await f.tasks(...all);
	await f.result();
	await f.wait();
	await f.init();
	await f.result(`All finished.\n\`${f.nonceLine()}\``);
	assert.deepEqual(f.answers, ['done']);
	assert.deepEqual(f.stops(), ['agent', 'shell', 'monitor']);
	assert.equal(f.process.stdin.writableEnded, false);
	await f.tasks(['resumed', 'local_agent']);
	assert.deepEqual(f.stops(), ['agent', 'shell', 'monitor', 'resumed']);
	await f.tasks();
	assert.equal(f.process.stdin.writableEnded, true);
	await f.exit();
	assert.equal(f.state.settled, 'completed');
	assert.equal(f.time.timers.size, 0);
});

test('an old line, a quoted line, tool output and an errored turn do not count', async () => {
	const f = await asked();
	const old = f.nonceLine();
	await f.result(`I will not write ${old} yet.`);
	await f.wait();
	await f.init();
	await f.result(old);
	await f.wait();
	await f.init();
	const latest = f.nonceLine();
	await f.send({
		type: 'user',
		message: {
			content: [{ type: 'tool_result', tool_use_id: 't', content: latest }],
		},
	});
	await f.result('Waiting.');
	assert.deepEqual(f.stops(), []);
	await f.wait();
	await f.init();
	await f.result(f.nonceLine(), { is_error: true });
	assert.deepEqual(f.stops(), []);
	assert.ok(!f.answers.includes('done'));
});

for (const order of ['before', 'during'])
	test(`a notification arriving ${order} a check keeps input open until both turns run`, async () => {
		const f = await agent();
		await f.tasks(['t1']);
		await f.result();
		if (order === 'before') {
			await f.tasks();
			await f.notify();
		}
		await f.wait();
		if (order === 'during') {
			await f.tasks();
			await f.notify();
		}
		await f.init();
		await f.result('First of the two turns.');
		assert.equal(f.process.stdin.writableEnded, false);
		await f.init();
		await f.result('Second.');
		assert.equal(f.process.stdin.writableEnded, true);
		await f.exit();
		assert.equal(f.state.settled, 'completed');
	});

test('work that ends by itself after a not-done answer needs no line', async () => {
	const f = await asked();
	await f.result('Waiting.');
	await f.tasks();
	await f.notify();
	await f.init();
	await f.result('Handled.');
	await f.exit();
	assert.equal(f.state.settled, 'completed');
});

test('after done, later permissions are refused and later errors and exit status are ignored', async () => {
	const f = await asked({ mode: 'ask' });
	let prompted = 0;
	f.client.on('permission', () => prompted++);
	await f.result(f.nonceLine());
	await f.send({
		type: 'control_request',
		request_id: 'late',
		request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} },
	});
	assert.equal(prompted, 0);
	assert.equal(f.sent.at(-1).response.response.behavior, 'deny');
	await f.send({ type: 'assistant', error: 'boom', message: { content: [] } });
	await f.result('failed', {
		is_error: true,
		subtype: 'error_during_execution',
	});
	await f.exit(143);
	assert.equal(f.state.settled, 'completed');
});

test('an error recorded before the done answer still fails, after stopping tasks', async () => {
	const f = await agent();
	await f.tasks(['m1']);
	await f.result('x', { is_error: true });
	await f.wait();
	await f.init();
	await f.result(f.nonceLine());
	assert.deepEqual(f.stops(), ['m1']);
	await f.tasks();
	await f.exit();
	assert.match(f.state.settled?.message, /could not complete/);
});

test('a background-ceiling report still fails an execution that said done', async () => {
	const f = await asked();
	await f.result(f.nonceLine());
	f.process.stderr.write(
		'Background tasks still running 10m after the last turn (monitor "CI"); stopping them. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.\n',
	);
	await tick();
	await f.exit();
	assert.equal(f.state.settled?.name, 'BotBackgroundStoppedError');
});

test('an agent that does not exit is released after the shutdown bound', async () => {
	const f = await asked();
	await f.result(f.nonceLine());
	await f.wait(BOT_DONE_SHUTDOWN_MS - 1);
	assert.equal(f.state.settled, undefined);
	await f.wait(1);
	assert.equal(f.state.settled, 'completed');
});

test('cancel and failure end the wait and send nothing more', async () => {
	for (const end of ['cancel', 'exit']) {
		const f = await agent();
		await f.tasks(['m1']);
		await f.result();
		if (end === 'cancel') f.client.cancel().catch(() => {});
		else await f.exit(1);
		await f.wait(60 * 60_000);
		assert.equal(f.asked().length, 0);
		assert.equal(f.waits.at(-1).waiting, false);
		if (end === 'cancel') await f.exit();
		assert.notEqual(f.state.settled, 'completed');
	}
});

test('the recorded items and the transcript check are redacted', async () => {
	const credential = {
		...noBotCredentials(),
		redact: (value) => value.split('hunter2').join('[redacted]'),
	};
	const f = await agent({ credential });
	await f.tasks(['m1', 'local_bash', 'curl -u hunter2']);
	await f.result();
	await f.wait();
	assert.equal(f.waits[0].items[0].description, 'curl -u [redacted]');
	assert.doesNotMatch(f.checks[0], /hunter2/);
});

test('checks redact secrets before truncation and redact every diagnostic field', async () => {
	const secret = 'hunter2';
	const credential = {
		...noBotCredentials(),
		redact: (value) => value.split(secret).join('[redacted]'),
	};
	const f = await agent({ credential });
	await f.tasks([secret, secret, `${'x'.repeat(125)}${secret}`]);
	await f.result();
	await f.wait();
	assert.doesNotMatch(f.checks[0], /hun/);
	assert.doesNotMatch(JSON.stringify(f.waits), /hun/);
	assert.doesNotMatch(f.asked()[0].message.content, /hun/);
});

test('queued unanswered checks must start before natural completion', async () => {
	const f = await agent();
	await f.tasks(['m1']);
	await f.result();
	await f.wait();
	await f.wait();
	await f.tasks();
	await f.init();
	await f.result('First queued check.');
	assert.equal(f.process.stdin.writableEnded, false);
	await f.init();
	await f.result('Second queued check.');
	assert.equal(f.process.stdin.writableEnded, true);
	await f.exit();
	assert.equal(f.state.settled, 'completed');
});

test('every listed task is counted and stopped, including beyond 256', async () => {
	const f = await agent();
	await f.tasks(...Array.from({ length: 257 }, (_, i) => [`task-${i}`]));
	await f.result();
	assert.equal(f.waits.at(-1).items.length, 257);
	await f.wait();
	await f.init();
	await f.result(f.nonceLine());
	assert.equal(f.stops().length, 257);
	assert.equal(f.stops().at(-1), 'task-256');
	await f.tasks();
	await f.exit();
	assert.equal(f.state.settled, 'completed');
});

test('a notification during a wait refreshes the recorded follow-up count', async () => {
	const f = await agent();
	await f.tasks(['m1']);
	await f.result();
	await f.tasks();
	await f.notify();
	assert.equal(f.waits.at(-1).followUps, 1);
	await f.init();
	await f.result();
	await f.exit();
});
