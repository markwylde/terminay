#!/usr/bin/env node
// A stand-in for `claude` in streaming-JSON print mode, for the Pixel specs.
// It answers from a tiny script and reaches Terminay through the chat's own
// control socket and capability, taken from the MCP entry Terminay passed.
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const configIndex = args.indexOf('--mcp-config');
const config = configIndex >= 0 ? JSON.parse(args[configIndex + 1]) : { mcpServers: {} };
const server = config.mcpServers?.terminay_chat;
const env = server?.env ?? {};
const sessionId = randomUUID();

const out = (message) => process.stdout.write(`${JSON.stringify({ ...message, session_id: sessionId })}\n`);
out({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: [], mcp_servers: server ? [{ name: 'terminay_chat', status: 'connected' }] : [] });

let nextId = 0;
function control(op, params) {
	return new Promise((resolve, reject) => {
		if (!env.TERMINAY_CONTROL_SOCKET) return reject(new Error('no Terminay MCP entry'));
		const socket = connect(env.TERMINAY_CONTROL_SOCKET);
		let buffer = '';
		socket.on('connect', () => {
			socket.write(`${JSON.stringify({ id: `fake-${++nextId}`, token: env.TERMINAY_CONTROL_TOKEN, version: 1, op, params })}\n`);
		});
		socket.on('data', (chunk) => {
			buffer += chunk;
			const end = buffer.indexOf('\n');
			if (end < 0) return;
			socket.end();
			resolve(JSON.parse(buffer.slice(0, end)));
		});
		socket.on('error', reject);
	});
}

function say(text) {
	for (const word of text.split(/(?<= )/))
		out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: word } } });
}

async function tool(name, params) {
	const id = `toolu_${++nextId}`;
	out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: `mcp__terminay_chat__${name}`, input: params }] } });
	const response = await control(name, params);
	out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: !response.ok, content: '' }] } });
	return response;
}

async function turn(text) {
	if (text === 'hello') say('Hi from fake Claude.');
	else if (text === 'count') {
		const listed = await tool('list_terminals', {});
		say(listed.ok ? `I can see ${listed.result.terminals.length} terminal(s).` : `I could not list terminals: ${listed.error.code}.`);
	} else if (text.startsWith('type ')) {
		const listed = await tool('list_terminals', {});
		const terminal = listed.ok ? listed.result.terminals[0]?.terminal : undefined;
		if (terminal === undefined) say('There is no terminal to type into.');
		else {
			const written = await tool('run_command', { terminal, command: text.slice(5) });
			say(written.ok ? 'Done, I ran it.' : `I could not run it: ${written.error.code}.`);
		}
	} else say(`You said: ${text}`);
	out({ type: 'result', subtype: 'success', is_error: false, result: '' });
}

const lines = createInterface({ input: process.stdin });
let queue = Promise.resolve();
lines.on('line', (line) => {
	const message = JSON.parse(line);
	if (message.type === 'control_request') {
		out({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: {} } });
		return;
	}
	if (message.type !== 'user') return;
	const content = message.message?.content;
	const text = typeof content === 'string' ? content : (content ?? []).map((part) => part.text ?? '').join('');
	queue = queue.then(() => turn(text.trim())).catch((error) => {
		out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: String(error?.message ?? error) });
	});
});
lines.on('close', () => process.exit(0));
