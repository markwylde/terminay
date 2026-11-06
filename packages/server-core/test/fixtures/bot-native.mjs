// Deterministic native Claude control stream for host lifecycle tests.

import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import { MessageChannel } from 'node:worker_threads';

if (process.env.FAKE_IGNORE_EOF === '1') {
	const { port1 } = new MessageChannel();
	port1.on('message', () => {});
}
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
async function postReply() {
	if (
		!process.env.TERMINAY_RUNTIME_SOCKET ||
		process.env.FAKE_MCP_DISCONNECTED === '1'
	)
		return;
	const env = process.env;
	await new Promise((resolve, reject) => {
		const socket = connect(env.TERMINAY_RUNTIME_SOCKET);
		const requests = [
			{
				method: 'initialize',
				params: {
					protocolVersion: '2025-03-26',
					clientInfo: { name: 'fixture', version: '1' },
					capabilities: {},
				},
			},
			{ method: 'tools/list' },
			{
				method: 'tools/call',
				params: {
					name: 'chat_post',
					arguments: { text: 'secret', key: 'fixture-reply' },
				},
			},
		];
		let index = 0,
			buffer = '';
		const next = () =>
			socket.write(
				`${JSON.stringify({
					token: env.TERMINAY_RUNTIME_TOKEN,
					message: { jsonrpc: '2.0', id: index + 1, ...requests[index] },
				})}\n`,
			);
		socket.on('error', reject);
		socket.on('connect', next);
		socket.on('data', (chunk) => {
			buffer += chunk;
			let at = buffer.indexOf('\n');
			while (at >= 0) {
				const result = JSON.parse(buffer.slice(0, at));
				buffer = buffer.slice(at + 1);
				if (result.error) {
					socket.destroy();
					reject(Error(result.error.message));
					return;
				}
				if (++index === requests.length) {
					socket.end();
					resolve();
				} else next();
				at = buffer.indexOf('\n');
			}
		});
	});
}
let ignoreCancel = false;
const result = () =>
	send({ type: 'result', subtype: 'success', is_error: false });
const lines = createInterface({ input: process.stdin });
lines.on('line', async (line) => {
	const e = JSON.parse(line);
	if (e.type === 'control_request') {
		if (e.request.subtype === 'initialize')
			send({
				type: 'control_response',
				response: { subtype: 'success', request_id: e.request_id },
			});
		else if (
			e.request.subtype === 'interrupt' &&
			process.env.FAKE_IGNORE_CANCEL !== '1' &&
			!ignoreCancel
		)
			result();
	} else if (e.type === 'control_response') result();
	else if (e.type === 'user') {
		if (process.env.FAKE_RECORD_INPUT)
			appendFileSync(process.env.FAKE_RECORD_INPUT, `${line}\n`);
		let prompt = Array.isArray(e.message.content)
			? e.message.content
					.filter((block) => block.type === 'text')
					.map((block) => block.text)
					.join('\n')
			: e.message.content;
		const briefing = prompt
			.split('\n')
			.find((line) => line.startsWith('{"executionId":'));
		if (briefing) prompt = JSON.parse(briefing).triggerMessage?.text ?? prompt;
		ignoreCancel = prompt.includes('ignore-cancel');
		if (prompt.includes('eagain')) {
			// What Node prints when the container has no processes left.
			process.stderr.write(
				'node[12855]: pthread_create: Resource temporarily unavailable\n' +
					'Error: spawn /usr/local/bin/codex EAGAIN\n',
				() => process.exit(1),
			);
			return;
		}
		if (prompt.includes('permission')) {
			send({
				type: 'control_request',
				request_id: 'permission',
				request: { subtype: 'can_use_tool', tool_name: 'Shell', input: {} },
			});
			return;
		}
		for (const part of ['sec', 'ret'])
			send({
				type: 'stream_event',
				event: {
					type: 'content_block_delta',
					delta: { type: 'text_delta', text: part },
				},
			});
		send({
			type: 'assistant',
			message: {
				content: [{ type: 'tool_use', id: 'tool', name: 'Task', input: {} }],
			},
		});
		send({ type: 'system', subtype: 'task_progress', description: 'Working' });
		process.stderr.write('runner: secret\n');
		if (prompt.includes('leave-child')) {
			const child = spawn(
				process.execPath,
				[
					'-e',
					"const {MessageChannel}=require('node:worker_threads');const {port1}=new MessageChannel();port1.on('message',()=>{});",
				],
				{ stdio: 'ignore' },
			);
			child.unref();
			send({
				type: 'assistant',
				message: {
					content: [
						{
							type: 'tool_use',
							id: 'child',
							name: 'child',
							input: { pid: child.pid },
						},
					],
				},
			});
		}
		if (prompt.includes('hold')) return;
		await postReply();
		result();
	}
});
lines.on('close', () => {
	if (process.env.FAKE_IGNORE_EOF !== '1') process.exit(0);
});
