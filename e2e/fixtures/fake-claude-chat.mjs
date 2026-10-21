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

function focusedTerminal(layout) {
	const tabs = [];
	const visit = (node) => {
		if (node === undefined) return;
		if (Array.isArray(node.children)) for (const child of node.children) visit(child);
		if (Array.isArray(node.tabs)) tabs.push(...node.tabs);
	};
	visit(layout.root);
	return (tabs.find((tab) => tab.tab === layout.focused_tab) ?? tabs.find((tab) => tab.terminal))?.terminal;
}

/** "2x2 grid", "3 panes", from a layout's pane tree. */
function gridShape(root) {
	if (root === undefined) return 'nothing';
	if (Array.isArray(root.tabs)) return '1 pane';
	const columns = root.split === 'row' ? root.children : [root];
	const heights = columns.map((column) => (column.split === 'column' ? column.children.length : 1));
	if (heights.every((height) => height === heights[0])) return `a ${columns.length}x${heights[0]} grid`;
	return `${heights.reduce((sum, height) => sum + height, 0)} panes`;
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
	} else if (text === 'open a background terminal') {
		const opened = await tool('open_terminal', { name: 'Background job' });
		say(opened.ok ? `Opened it in ${opened.result.project_title ?? 'your project'}.` : `I could not open it: ${opened.error.code} (${opened.error.message}).`);
	} else if (text === 'pop this project out') {
		// A workspace window of its own for the project in front (ADR-0072).
		const layout = await tool('get_layout', {});
		if (!layout.ok || layout.result.project === undefined) say(`I cannot see your project (${layout.ok ? 'no handle' : layout.error.code}).`);
		else {
			const opened = await tool('open_workspace_window', { name: 'Popped out', projects: [layout.result.project] });
			say(
				!opened.ok
					? `I could not open a window: ${opened.error.code} (${opened.error.message}).`
					: opened.result.presented
						? `Opened a window for ${layout.result.project_title}.`
						: `Made a window but could not show it: ${opened.result.reason}.`,
			);
		}
	} else if (text === 'show my automations') {
		// Home, with its Automations section in front, on this client (ADR-0072).
		const shown = await tool('focus_home', { section: 'automations' });
		say(shown.ok ? `Showing Home: ${shown.result.section}.` : `I could not show Home: ${shown.error.code} (${shown.error.message}).`);
	} else if (text === 'bring it back') {
		const listed = await tool('list_workspace_windows', {});
		const [first, second] = listed.ok ? listed.result.windows : [];
		if (first === undefined || second === undefined) say('There is no second window.');
		else {
			for (const project of second.projects) await tool('move_project', { project, window: first.window });
			const closed = await tool('close_workspace_window', { window: second.window });
			say(closed.ok ? 'Moved it back and closed the window.' : `I could not close it: ${closed.error.code} (${closed.error.message}).`);
		}
	} else if (text === 'make a project in my home folder') {
		// A project at ~ with its first terminal, shown here (ADR-0072).
		const created = await tool('create_project', { root: '~', name: 'Home from Pixel' });
		say(
			created.ok
				? `Created ${created.result.name} with terminal ${created.result.terminal ?? 'none'}${created.result.shown ? ', on screen.' : '.'}`
				: `I could not create it: ${created.error.code} (${created.error.message}).`,
		);
	} else if (text === 'set scrollback to 4321') {
		// Change Settings is Ask by default, so this waits on the user.
		const updated = await tool('update_settings', { settings: { scrollback: 4321 } });
		say(updated.ok ? 'Scrollback is now 4321.' : `I could not change it: ${updated.error.code} (${updated.error.message}).`);
	} else if (text.includes('2x2')) {
		// What a careful agent does with "open three more and make a 2x2 grid":
		// look, split three times, then look again and report what it saw.
		const before = await tool('get_layout', {});
		const first = before.ok ? focusedTerminal(before.result) : undefined;
		if (first === undefined) {
			say(`I cannot see your window (${before.ok ? 'no terminal in front' : before.error.code}).`);
		} else {
			const right = await tool('split_terminal', { terminal: first, direction: 'right' });
			const belowLeft = await tool('split_terminal', { terminal: first, direction: 'below' });
			const belowRight = right.ok ? await tool('split_terminal', { terminal: right.result.terminal, direction: 'below' }) : right;
			const opened = [right, belowLeft, belowRight].filter((result) => result.ok).length;
			const placed = [right, belowLeft, belowRight].filter((result) => result.ok && result.result.placed === true).length;
			const after = await tool('get_layout', {});
			const shape = after.ok ? gridShape(after.result.root) : 'unknown';
			say(`Opened ${opened}, placed ${placed}. Your window shows ${shape}.`);
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
