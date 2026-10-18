#!/usr/bin/env node
// A stand-in for `codex app-server`. It records argv and every message it
// receives to FAKE_AGENT_LOG and plays a scripted turn per prompt.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const log = (entry) =>
	appendFileSync(process.env.FAKE_AGENT_LOG, `${JSON.stringify(entry)}\n`);
const out = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
log({ argv: process.argv.slice(2), cwd: process.cwd() });
let turn = 0;
let pendingTurn;
// Server requests still awaiting an answer, and what to do once none are.
const unanswered = new Set();
let afterAnswers;
const threadId = 'thread-1';
createInterface({ input: process.stdin }).on('line', (line) => {
	const message = JSON.parse(line);
	log({ stdin: message });
	if (message.method === undefined && unanswered.delete(message.id)) {
		if (unanswered.size === 0) {
			const next = afterAnswers;
			afterAnswers = undefined;
			next?.();
		}
		return;
	}
	const reply = (result) => out({ jsonrpc: '2.0', id: message.id, result });
	switch (message.method) {
		case 'initialize':
			return reply({
				userAgent: 'fake',
				codexHome: '/x',
				platformFamily: 'unix',
				platformOs: 'macos',
			});
		case 'config/read':
			return reply({
				config: {
					mcp_servers: {
						terminay: { command: 'x' },
						'chrome-devtools': { command: 'y' },
					},
				},
				origins: {},
				layers: null,
			});
		case 'thread/start':
			return reply({ thread: { id: threadId } });
		case 'turn/interrupt':
			reply({});
			if (pendingTurn) {
				out({
					jsonrpc: '2.0',
					method: 'turn/completed',
					params: {
						threadId,
						turn: { id: pendingTurn, status: 'interrupted', error: null },
					},
				});
				pendingTurn = undefined;
			}
			return;
		case 'turn/start': {
			const id = `turn-${++turn}`;
			reply({ turn: { id, status: 'inProgress', items: [] } });
			const text = message.params.input[0].text;
			const note = (method, params) =>
				out({
					jsonrpc: '2.0',
					method,
					params: { threadId, turnId: id, ...params },
				});
			if (text === 'auth') {
				note('error', {
					error: {
						message: 'unexpected status 401',
						codexErrorInfo: 'unauthorized',
					},
					willRetry: false,
				});
				note('turn/completed', {
					turn: {
						id,
						status: 'failed',
						error: {
							message: 'unexpected status 401',
							codexErrorInfo: 'unauthorized',
						},
					},
				});
				return;
			}
			if (text === 'slow') {
				pendingTurn = id;
				note('item/agentMessage/delta', { itemId: 'm1', delta: 'hmm' });
				return;
			}
			// Like Codex, the turn goes on only once every question is answered.
			for (const id of [900 + turn, 950 + turn, 990 + turn]) unanswered.add(id);
			out({
				jsonrpc: '2.0',
				id: 900 + turn,
				method: 'item/commandExecution/requestApproval',
				params: { threadId, turnId: id, itemId: 'c1', command: 'rm -rf /' },
			});
			out({
				jsonrpc: '2.0',
				id: 950 + turn,
				method: 'item/permissions/requestApproval',
				params: { threadId, turnId: id, itemId: 'c1' },
			});
			out({
				jsonrpc: '2.0',
				id: 990 + turn,
				method: 'mcpServer/elicitation/request',
				params: {},
			});
			afterAnswers = finishTurn;
			return;
			function finishTurn() {
				note('item/started', {
					item: {
						type: 'mcpToolCall',
						id: 'call-1',
						server: 'terminay_chat',
						tool: 'list_terminals',
						status: 'inProgress',
						arguments: {},
					},
				});
				note('item/completed', {
					item: {
						type: 'mcpToolCall',
						id: 'call-1',
						server: 'terminay_chat',
						tool: 'list_terminals',
						status: 'completed',
						arguments: {},
					},
				});
				note('item/started', {
					item: { type: 'commandExecution', id: 'cmd-1', status: 'inProgress' },
				});
				note('item/completed', {
					item: { type: 'commandExecution', id: 'cmd-1', status: 'declined' },
				});
				note('item/agentMessage/delta', { itemId: 'm0', delta: 'On it.' });
				note('item/agentMessage/delta', { itemId: 'm1', delta: 'you said ' });
				note('item/agentMessage/delta', { itemId: 'm1', delta: text });
				note('turn/completed', {
					turn: { id, status: 'completed', error: null },
				});
			}
		}
		default:
			if (message.method === undefined) return; // responses to our server requests are logged above
	}
});
