// No provider, network or credentials. The parent owns this fake process.

import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { MessageChannel } from 'node:worker_threads';

if (process.env.FAKE_IGNORE_EOF === '1') {
	const { port1 } = new MessageChannel();
	port1.on('message', () => {});
}
const lines = createInterface({ input: process.stdin });
const send = (value) =>
	process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
let sid = 'fake-session';
let mcp;
async function postReply(){
 if(!mcp)return;
 const env=Object.fromEntries(mcp.env.map(e=>[e.name,e.value]));
 await new Promise((resolve,reject)=>{const socket=connect(env.TERMINAY_RUNTIME_SOCKET);socket.on('error',reject);socket.on('connect',()=>socket.write(JSON.stringify({token:env.TERMINAY_RUNTIME_TOKEN,message:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'chat_post',arguments:{text:'secret',key:'fixture-reply'}}}})+'\n'));socket.once('data',()=>{socket.end();resolve();});});
}
let turn;
let permission;
let late = false;
let ignoreCancel = false;
const config = [
	{
		id: 'model',
		category: 'model',
		type: 'select',
		currentValue: 'default',
		options: [
			{ value: 'selected', name: 'Selected' },
			{ value: 'default', name: 'Default' },
		],
	},
];
const update = (value) =>
	send({ method: 'session/update', params: { sessionId: sid, update: value } });
lines.on('line', async (line) => {
	const message = JSON.parse(line);
	const { method, id, params } = message;
	if (!method) {
		if (id === permission) {
			send({ id: turn, result: { stopReason: 'end_turn' } });
			turn = undefined;
			permission = undefined;
			if (late) {
				late = false;
				send({
					id: 'late-permission',
					method: 'session/request_permission',
					params: {
						sessionId: sid,
						toolCall: { toolCallId: 'late' },
						options: process.env.FAKE_PERMISSION_OPTIONS
							? JSON.parse(process.env.FAKE_PERMISSION_OPTIONS)
							: [{ optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
					},
				});
			}
		}
		return;
	}
	switch (method) {
		case 'initialize':
			send({
				id,
				result: {
					protocolVersion: 1,
					agentCapabilities: { loadSession: process.env.FAKE_NO_LOAD !== '1' },
					authMethods:
						process.env.FAKE_AUTH_METHOD_MISSING === '1'
							? []
							: [{ id: 'api-key', name: 'API key' }],
				},
			});
			break;
		case 'authenticate':
			send({ id, result: {} });
			break;
		case 'session/new':
		case 'session/load':
			mcp=params.mcpServers?.find(server=>server.name==='terminay_bot');
            if(mcp)sid=randomUUID();
            if (method === 'session/load') sid = params.sessionId;
			send({
				id,
				result: {
					sessionId: sid,
					configOptions: process.env.FAKE_NO_CONFIG === '1' ? [] : config,
					modes: {
						availableModes: [{ id: 'agent-full-access', name: 'Full access' }],
					},
				},
			});
			break;
		case 'session/set_config_option':
		case 'session/set_mode':
			send({ id, result: {} });
			break;
		case 'session/prompt': {
			turn = id;
			let prompt = params.prompt.map((p) => p.text).join('');
            if(mcp){const briefing=prompt.split('\n').find(line=>line.startsWith('{"executionId":'));if(briefing)prompt=JSON.parse(briefing).triggerMessage?.text??prompt;}
			ignoreCancel = prompt.includes('ignore-cancel');
			if (prompt.includes('permission')) {
				late = prompt.includes('late');
				permission = `permission-${id}`;
				send({
					id: permission,
					method: 'session/request_permission',
					params: {
						sessionId: sid,
						toolCall: { toolCallId: 't', title: 'Shell' },
						options: process.env.FAKE_PERMISSION_OPTIONS
							? JSON.parse(process.env.FAKE_PERMISSION_OPTIONS)
							: [
									{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
									{ optionId: 'always', name: 'Always', kind: 'allow_always' },
									{ optionId: 'reject', name: 'Reject', kind: 'reject_once' },
								],
					},
				});
				break;
			}
			for (const sessionUpdate of [
				'user_message_chunk',
				'agent_message_chunk',
				'agent_thought_chunk',
			]) {
				update({ sessionUpdate, content: { type: 'text', text: 'sec' } });
				update({ sessionUpdate, content: { type: 'text', text: 'ret' } });
			}
			for (const part of ['sec', 'ret'])
				update({
					sessionUpdate: 'tool_call_update',
					toolCallId: 'split-tool',
					content: [{ type: 'content', content: { type: 'text', text: part } }],
				});
			if (prompt.includes('client-request'))
				send({
					id: 'forbidden-fs',
					method: 'fs/read_text_file',
					params: { path: '/etc/passwd' },
				});
			for (const sessionUpdate of [
				'tool_call',
				'tool_call_update',
				'plan',
				'available_commands_update',
				'current_mode_update',
				'config_option_update',
				'session_info_update',
				'usage_update',
			])
				update({ sessionUpdate, toolCallId: 'tool', content: [], entries: [] });
			process.stderr.write('runner: sec');
			process.stderr.write('ret\n');
			if (prompt.includes('leave-child')) {
				const child = spawn(
					process.execPath,
					[
						'-e',
						"const {MessageChannel}=require('node:worker_threads');const {port1}=new MessageChannel();port1.on('message',()=>{});",
					],
					{ stdio: 'ignore' },
				);
				update({
					sessionUpdate: 'tool_call',
					toolCallId: 'child',
					rawOutput: { pid: child.pid },
				});
			}
			if (prompt.includes('hold')) break;
            await postReply();
			send({ id, result: { stopReason: 'end_turn' } });
			turn = undefined;
			break;
		}
		case 'session/cancel':
			if (
				process.env.FAKE_IGNORE_CANCEL !== '1' &&
				!ignoreCancel &&
				turn !== undefined
			) {
				send({ id: turn, result: { stopReason: 'cancelled' } });
				turn = undefined;
			}
			break;
		default:
			send({ id, error: { code: -32601, message: 'unknown' } });
	}
});
lines.on('close', () => {
	if (process.env.FAKE_IGNORE_EOF !== '1') process.exit(0);
});
