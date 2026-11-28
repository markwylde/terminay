// Deterministic native Claude control stream for host lifecycle tests.

import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import { MessageChannel } from 'node:worker_threads';

if (process.env.FAKE_IGNORE_EOF === '1') {
	const { port1 } = new MessageChannel();
	port1.on('message', () => {});
}
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
/** `threadId`: answer in the thread the briefing names, as a real agent is told to.
 * `attachment`: a file name to attach from the fixture's attachment directory. */
async function postReply(
	needsHuman = false,
	threadId = undefined,
	attachment = undefined,
) {
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
			needsHuman
				? {
						method: 'tools/call',
						params: { name: 'triggers_list', arguments: {} },
					}
				: {
						method: 'tools/call',
						params: {
							name: 'chat_post',
							arguments: {
								text: 'secret',
								key: 'fixture-reply',
								...(threadId ? { threadId } : {}),
								...(attachment
									? {
											attachments: [
												{
													path: `/tmp/fixture-attachments/${attachment}`,
													name: attachment,
												},
											],
										}
									: {}),
							},
						},
					},
		];
		// A trigger execution that needs a human reports it with the revision it read.
		if (needsHuman)
			requests.push((listed) => ({
				method: 'tools/call',
				params: {
					name: 'outcome_report',
					arguments: {
						disposition: 'needs-human',
						reason: 'The support portal refused the login.',
						action: 'Add the support portal password to the bot’s secrets',
						revision: listed.revision,
						key: 'fixture-needs-human',
					},
				},
			}));
		let previous = null;
		let index = 0,
			buffer = '';
		const next = () =>
			socket.write(
				`${JSON.stringify({
					token: env.TERMINAY_RUNTIME_TOKEN,
					message: {
						jsonrpc: '2.0',
						id: index + 1,
						...(typeof requests[index] === 'function'
							? requests[index](previous)
							: requests[index]),
					},
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
				const text = result.result?.content?.[0]?.text;
				try {
					previous = text ? JSON.parse(text) : null;
				} catch {
					previous = null;
				}
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
/**
 * Terminay MCP calls through the bot's own relay (ADR-0134): a project, a
 * terminal in it, the same keystrokes twice (one folded row) and a refused
 * close. Each later request may read the previous result.
 */
/** What the Terminay MCP calls saw, for a test to explain a failure. */
function traceActions(line) {
	if (process.env.TERMINAY_FAKE_BOT_ROOT)
		appendFileSync(
			`${process.env.TERMINAY_FAKE_BOT_ROOT}/terminay-actions.log`,
			`${line}\n`,
		);
}
async function terminayActions() {
	const env = process.env;
	traceActions(`socket=${env.TERMINAY_MCP_SOCKET ?? 'unset'}`);
	if (!env.TERMINAY_MCP_SOCKET) return;
	const call = (name, args) => ({
		method: 'tools/call',
		params: { name, arguments: args },
	});
	const steps = [
		{
			method: 'initialize',
			params: {
				protocolVersion: '2025-03-26',
				clientInfo: { name: 'fixture', version: '1' },
				capabilities: {},
			},
		},
		() => call('create_project', { root: '~', name: 'fixture-api' }),
		(state) => call('open_terminal', { project: state.project, name: 'build' }),
		(state) =>
			call('write_terminal', { terminal: state.terminal, text: 'echo ready' }),
		(state) =>
			call('write_terminal', { terminal: state.terminal, text: 'echo ready' }),
		() => call('close_terminal', { terminal: 'missing-terminal' }),
	];
	const state = {};
	await new Promise((resolve, reject) => {
		const socket = connect(env.TERMINAY_MCP_SOCKET);
		let index = 0,
			buffer = '';
		const next = () => {
			const step = steps[index];
			socket.write(
				`${JSON.stringify({
					token: env.TERMINAY_MCP_TOKEN,
					message: {
						jsonrpc: '2.0',
						id: index + 1,
						...(typeof step === 'function' ? step(state) : step),
					},
				})}\n`,
			);
		};
		socket.on('error', reject);
		socket.on('connect', next);
		socket.on('data', (chunk) => {
			buffer += chunk;
			let at = buffer.indexOf('\n');
			while (at >= 0) {
				const reply = JSON.parse(buffer.slice(0, at));
				buffer = buffer.slice(at + 1);
				traceActions(JSON.stringify(reply).slice(0, 600));
				// A long result may be cut short of valid JSON, so read the
				// handles by pattern.
				const text = reply.result?.content?.[0]?.text ?? '';
				const project = /"project":"([^"]+)"/.exec(text)?.[1];
				const terminal = /"terminal":"([^"]+)"/.exec(text)?.[1];
				if (project) state.project = project;
				if (terminal) state.terminal = terminal;
				if (++index === steps.length) {
					socket.end();
					resolve();
				} else next();
				at = buffer.indexOf('\n');
			}
		});
	});
}
let ignoreCancel = false;
/** Set while the fixture is held open by background work. */
let held;
/** An agent left waiting on a Monitor, with a command still running. */
async function holdOnBackgroundWork(prompt) {
	await postReply();
	held = {
		stillWaiting: prompt.includes('still-waiting'),
		ignoreStop: prompt.includes('ignore-stop'),
	};
	const child = spawn(
		process.execPath,
		[
			'-e',
			"const {MessageChannel}=require('node:worker_threads');const {port1}=new MessageChannel();port1.on('message',()=>{});",
		],
		{ stdio: 'ignore' },
	);
	child.unref();
	if (process.env.FAKE_CHILD_PID_FILE)
		writeFileSync(process.env.FAKE_CHILD_PID_FILE, String(child.pid));
	if (prompt.includes('ignore-eof')) {
		const { port1 } = new MessageChannel();
		port1.on('message', () => {});
	}
	send({ type: 'system', subtype: 'init' });
	send({
		type: 'system',
		subtype: 'background_tasks_changed',
		tasks: [
			{
				task_id: 'monitor-1',
				task_type: 'local_bash',
				description:
					process.env.FAKE_HOLD_DESCRIPTION ?? 'Watch the CI build',
			},
		],
	});
	result();
}
function answerDoneCheck(prompt) {
	send({ type: 'system', subtype: 'init' });
	const line = prompt
		.split('\n')
		.find((candidate) => candidate.startsWith('TERMINAY-DONE '));
	send({
		type: 'result',
		subtype: 'success',
		is_error: false,
		result: held.stillWaiting ? 'Still waiting for the build.' : line,
	});
}
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
		else if (e.request.subtype === 'stop_task' && !held?.ignoreStop)
			send({ type: 'system', subtype: 'background_tasks_changed', tasks: [] });
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
		const context = briefing ? JSON.parse(briefing) : undefined;
		if (context) prompt = context.triggerMessage?.text ?? prompt;
		ignoreCancel = prompt.includes('ignore-cancel');
		if (prompt.startsWith('Terminay check')) {
			answerDoneCheck(prompt);
			return;
		}
		if (prompt.includes('hold-background')) {
			// Only the task's own words: a briefing may quote another execution's.
			await holdOnBackgroundWork(prompt.trim().split('\n').at(-1));
			return;
		}
		if (prompt === 'closed-approval-stream') {
			send({
				type: 'assistant',
				message: {
					content: [
						{
							type: 'tool_use',
							id: 'report',
							name: 'mcp__terminay_bot__outcome_report',
							input: { reason: 'fixture secret' },
						},
					],
				},
			});
			send({
				type: 'user',
				tool_result_meta: [
					{ id: 'report', non_execution_kind: 'permission-rule' },
				],
				message: {
					content: [
						{
							type: 'tool_result',
							tool_use_id: 'report',
							content:
								'Tool permission request failed: AbortError: Stream closed',
							is_error: true,
						},
					],
				},
			});
			result();
			return;
		}
		if (prompt.includes('eagain')) {
			// What Node prints when the container has no processes left.
			process.stderr.write(
				'node[12855]: pthread_create: Resource temporarily unavailable\n' +
					'Error: spawn /usr/local/bin/codex EAGAIN\n',
				() => process.exit(1),
			);
			return;
		}
		if (prompt.includes('background-stopped')) {
			// Claude Code's report when its print-mode ceiling ends a monitor.
			process.stderr.write(
				'Background tasks still running 10m after the last turn (monitor "CI"); stopping them. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.\n',
				() => result(),
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
		if (prompt.includes('terminay-actions'))
			await terminayActions().catch((error) =>
				traceActions(`error=${error?.message ?? error}`),
			);
		await postReply(
			prompt.includes('fixture-portal-refused'),
			context?.thread?.rootId,
			/post-file:([\w.-]+)/.exec(prompt)?.[1],
		);
		result();
	}
});
lines.on('close', () => {
	if (process.env.FAKE_IGNORE_EOF !== '1') process.exit(0);
});
