import assert from 'node:assert/strict';
import test from 'node:test';
import { BOT_OPERATIONS as op } from '@terminay/protocol';
import { BotsClient } from '../dist/index.js';

const profile = {
	id: 'abc123def456',
	name: 'Bird',
	agentId: 'fake.agent',
	approvalMode: 'autonomous',
};
function transport(value) {
	const calls = [];
	return {
		calls,
		queryWithBody: async (operation, payload) => {
			calls.push({ operation, payload });
			const body = new TextEncoder().encode(JSON.stringify(value));
			return {
				result: {
					encoding: 'json',
					offset: 0,
					version: 'stable',
					totalBytes: body.byteLength,
				},
				body,
			};
		},
		command: async () => null,
		commandWithBody: async () => ({ botId: profile.id }),
		subscribe: () => () => {},
	};
}
test('bots facade validates fetched records and sends profiles and memory edits through binary bodies', async () => {
	const wire = transport(profile);
	const calls = [];
	wire.commandWithBody = async (...args) => {
		calls.push(args);
		return { botId: profile.id };
	};
	const client = new BotsClient(wire);
	assert.deepEqual(
		await client.save({ name: 'Bird', agentId: 'fake.agent' }),
		profile,
	);
	assert.equal(calls[0][0], op.save);
	assert.equal(JSON.parse(new TextDecoder().decode(calls[0][2])).name, 'Bird');
	await client.writeMemory(profile.id, 'note.md', 'x'.repeat(100000));
	assert.equal(calls[1][0], op.writeMemory);
	assert.equal(calls[1][2].byteLength, 100000);
});
test('bots facade rejects malformed page metadata and content-bearing invalidations', async () => {
	const wire = transport(profile);
	wire.queryWithBody = async () => ({
		result: { encoding: 'json', offset: 5, totalBytes: 5, version: 'v' },
		body: new Uint8Array([1]),
	});
	const client = new BotsClient(wire);
	await assert.rejects(client.get(profile.id), /invalid bot response page/);
	let callback;
	wire.subscribe = (_event, listener) => {
		callback = listener;
		return () => {};
	};
	client.watch(() => {});
	assert.throws(
		() => callback({ botId: profile.id, revision: 1, transcript: 'secret' }),
		/invalidation/,
	);
});

test('trigger facade rejects malformed definitions, outcomes and upcoming cursors', async () => {
	for (const [value, read] of [
		[
			{ revision: 1, triggers: [{ id: 'invalid' }] },
			(c) => c.triggers(profile.id),
		],
		[
			[
				{
					id: 'f',
					triggerId: 't',
					firedAt: 1,
					outcome: 'unknown',
					reason: null,
				},
			],
			(c) => c.triggerFirings(profile.id),
		],
		[
			{ firings: [], next: { at: 'tomorrow', triggerId: 't' } },
			(c) => c.upcomingTriggers(profile.id, 0, 100),
		],
		[
			[1, 2, 'tomorrow'],
			(c) =>
				c.previewTrigger(profile.id, { kind: 'every', intervalMs: 300000 }),
		],
	])
		await assert.rejects(read(new BotsClient(transport(value))), /invalid/);
});
test('message client sends bounded page options without undefined values and fetches binary attachments separately',async()=>{
 const {BotMessagesClient}=await import('../dist/index.js');const calls=[];const wire={query:async(op,payload)=>{calls.push({op,payload});return {items:[],nextCursor:null,eventsCursor:'events',total:0,truncated:false};},command:async()=>null,queryWithBody:async()=>({result:{mime:'image/png'},body:new Uint8Array([1,2,3])}),subscribe:()=>()=>{}};
 const client=new BotMessagesClient(wire);await client.list(profile.id,{cursor:undefined,limit:10});assert.deepEqual(calls[0].payload,{botId:profile.id,limit:10});const attachment=await client.attachment(profile.id,'a'.repeat(24));assert.equal(attachment.bytes.length,3);assert.equal(attachment.mime,'image/png');
});
test('message uploads stage images and posts carry their tokens',async()=>{
 const {BotMessagesClient}=await import('../dist/index.js');const calls=[];const token='c'.repeat(24);
 const wire={query:async()=>null,command:async(op,payload)=>{calls.push({op,payload});return {message:{id:'m'}};},commandWithBody:async(op,payload,body)=>{calls.push({op,payload,body});return {token,attachment:{name:'shot.png',mime:'image/png',size:body.length}};},queryWithBody:async()=>null,subscribe:()=>()=>{}};
 const client=new BotMessagesClient(wire);const upload=await client.upload(profile.id,'shot.png',new Uint8Array([1,2]));
 assert.equal(upload.token,token);assert.equal(calls[0].op,'bots.messages.upload');assert.deepEqual(calls[0].payload,{botId:profile.id,name:'shot.png'});
 await client.post(profile.id,'','key-1',[token]);assert.deepEqual(calls[1].payload,{botId:profile.id,text:'',key:'key-1',uploads:[token]});
 await client.post(profile.id,'hi','key-2');assert.deepEqual(calls[2].payload,{botId:profile.id,text:'hi',key:'key-2'});
 const bad=new BotMessagesClient({...wire,commandWithBody:async()=>({token:'x',attachment:{name:'a',mime:'text/plain',size:1}})});
 await assert.rejects(bad.upload(profile.id,'a',new Uint8Array([1])),/Invalid upload/);
});
