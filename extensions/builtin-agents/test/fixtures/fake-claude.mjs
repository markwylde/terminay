#!/usr/bin/env node
// A stand-in for `claude --print` streaming JSON. It records its argv and every
// stdin line to FAKE_AGENT_LOG and replays a scripted reply per prompt.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const log = (entry) =>
	appendFileSync(process.env.FAKE_AGENT_LOG, `${JSON.stringify(entry)}\n`);
const out = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
log({ argv: process.argv.slice(2), cwd: process.cwd() });
out({ type: 'system', subtype: 'init', tools: [], mcp_servers: [] });
let slow = false;
const delta = (text) =>
	out({
		type: 'stream_event',
		parent_tool_use_id: null,
		event: {
			type: 'content_block_delta',
			index: 0,
			delta: { type: 'text_delta', text },
		},
	});
createInterface({ input: process.stdin }).on('line', (line) => {
	const message = JSON.parse(line);
	log({ stdin: message });
	if (message.type === 'control_request') {
		out({
			type: 'control_response',
			response: {
				subtype: 'success',
				request_id: message.request_id,
				response: {},
			},
		});
		if (slow) {
			slow = false;
			out({
				type: 'result',
				subtype: 'error_during_execution',
				is_error: true,
			});
		}
		return;
	}
	const text = message.message.content;
	if (text === 'auth') {
		out({
			type: 'assistant',
			message: {
				content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
			},
		});
		out({
			type: 'result',
			subtype: 'success',
			is_error: true,
			result: 'Not logged in · Please run /login',
		});
		return;
	}
	if (text === 'slow') {
		slow = true;
		delta('thinking about it');
		return;
	}
	if (text === 'die') process.exit(3);
	out({
		type: 'assistant',
		message: {
			content: [
				{
					type: 'tool_use',
					id: 'toolu_1',
					name: 'mcp__terminay_chat__read_terminal',
					input: { terminal: 'h1' },
				},
			],
		},
	});
	out({
		type: 'user',
		message: {
			content: [
				{
					type: 'tool_result',
					tool_use_id: 'toolu_1',
					is_error: false,
					content: 'secret output',
				},
			],
		},
	});
	delta('you said ');
	delta(text);
	out({
		type: 'assistant',
		message: { content: [{ type: 'text', text: `you said ${text}` }] },
	});
	out({
		type: 'result',
		subtype: 'success',
		is_error: false,
		result: `you said ${text}`,
	});
});
