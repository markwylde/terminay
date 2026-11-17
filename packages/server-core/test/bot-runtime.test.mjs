import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {BOT_RUNTIME_TOOLS,BotExecutionRuntime} from '../dist/botService/runtime.js';
import {BotMessageStore} from '../dist/botService/messages.js';
import {BotSessionStore} from '../dist/botService/sessions.js';
const bot='abc123def456',other='abc123def457';
function setup(t){const root=mkdtempSync(join(tmpdir(),'bot-runtime-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const messages=new BotMessageStore(join(root,'messages')),sessions=new BotSessionStore(join(root,'sessions'));t.after(()=>sessions.close());let runtime;
 const triggers=[];const service={messages,sessions,now:()=>Date.now(),triggers:{list:()=>({revision:1,triggers})},queue:{promote:()=>true,active:()=>[]},redactMessage:async(_bot,text)=>runtime.sanitizeSecrets(_bot,text).replaceAll('secret','[redacted]'),postBotMessage:async(id,text,key,_captured,threadId)=>{runtime.assert(id);const record=sessions.get(id);return messages.post(record.botId,'bot',text,id,key,[],[],threadId);},stop:async(_bot,id)=>{sessions.patch(id,{state:'stopped',open:false,endedAt:Date.now()});}};
 runtime=new BotExecutionRuntime(service,async()=>{throw Error('no engine access');},'server');
 const create=(botId=bot,text='Open BBC')=>{const message=messages.post(botId,'user',text,null,Math.random().toString());const record=sessions.create(botId,{kind:'chat',messageId:message.id},{agentId:'fake',modelId:null,signIn:{kind:'none'},approvalMode:'autonomous',instructions:'',context:'',maxTurnMs:10000});runtime.register(record.id);sessions.patch(record.id,{state:'running'});return sessions.get(record.id);};return {runtime,messages,sessions,service,create,triggers};}
test('fresh execution context is bounded and provider output is not communication',async t=>{const r=setup(t);for(let i=0;i<50;i++)r.messages.post(bot,'user','Context '+i+'x'.repeat(2000),null,'history-'+i);const current=r.create();assert.ok(Buffer.byteLength(r.runtime.briefing(current.id))<12000);r.sessions.append(current.id,{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Private output'}});assert.ok(!r.messages.list(bot).items.some(i=>i.excerpt.includes('Private output')));const page=await r.runtime.call(current.id,'chat_list',{});assert.equal(page.items.length,10);assert.ok(Buffer.byteLength(JSON.stringify(page))<=8192);await assert.rejects(r.runtime.call(current.id,'chat_list',{limit:100}));});
test('live executions pass the shell/desktop gate side by side; revoked, ended and stale ones do not',async t=>{const r=setup(t),a=r.create(),b=r.create(bot,'Unrelated task');r.runtime.assert(a.id);r.runtime.assert(b.id);assert.equal(BOT_RUNTIME_TOOLS.some(x=>/^work_/.test(x.name)),false);await assert.rejects(r.runtime.call(a.id,'work_acquire',{}),/Unknown bot runtime tool/);const ended=r.create(bot,'Done');r.sessions.patch(ended.id,{state:'completed',open:false,endedAt:Date.now()});assert.throws(()=>r.runtime.assert(ended.id),/no longer active/);const stale=r.create(bot,'Old epoch');r.sessions.patch(stale.id,{runtime:{...r.sessions.get(stale.id).runtime,epoch:'stale'}});assert.throws(()=>r.runtime.assert(stale.id),/no longer active/);r.runtime.assert(a.id);r.runtime.assert(b.id);});
test('replacement revokes late posts and shell access before cleanup',async t=>{const r=setup(t),a=r.create(),b=r.create(bot,'Sports instead');let finish,started;const began=new Promise(resolve=>started=resolve);r.service.stop=async(_bot,id)=>{started();await new Promise(resolve=>finish=resolve);r.sessions.patch(id,{state:'stopped',open:false});};const replace=r.runtime.call(b.id,'sessions_replace',{sessionId:a.id,revision:a.runtime.revision,key:'correction'});await began;await assert.rejects(r.runtime.call(a.id,'chat_post',{text:'Late BBC confirmation',key:'late'}),/active/);assert.throws(()=>r.runtime.assert(a.id),/no longer active/,'the replaced execution loses its shell gate while cleanup is pending');r.runtime.assert(b.id);finish();const receipt=await replace;assert.equal(receipt.status,'replaced');assert.equal('ownsWork' in receipt,false);assert.equal((await r.runtime.call(b.id,'sessions_replace',{sessionId:a.id,revision:a.runtime.revision,key:'correction'})).status,'replaced');assert.equal(r.messages.list(bot).items.filter(m=>m.author==='bot').length,0);});
test('inbox delivery is accepted then consumed, idempotent and scoped',async t=>{const r=setup(t),a=r.create(),b=r.create(),outside=r.create(other);const delivered=await r.runtime.call(b.id,'sessions_post',{sessionId:a.id,text:'Use Sports',key:'one'});assert.equal(delivered.status,'accepted');await assert.rejects(r.runtime.call(a.id,'chat_post',{text:'Done',key:'before-ack'}),/inbox/);const inbox=await r.runtime.call(a.id,'sessions_inbox',{});assert.equal(inbox.items.length,1);await r.runtime.call(a.id,'sessions_ack',{messageId:delivered.messageId});assert.equal((await r.runtime.call(b.id,'sessions_post',{sessionId:a.id,text:'Use Sports',key:'one'})).status,'consumed');await assert.rejects(r.runtime.call(b.id,'sessions_post',{sessionId:a.id,text:'Different',key:'one'}),/different content/);await assert.rejects(r.runtime.call(b.id,'sessions_get',{sessionId:outside.id}),/not found/);});
test('old corrections cannot replace newer executions and clear revokes capabilities',async t=>{const r=setup(t),a=r.create(),b=r.create();await assert.rejects(r.runtime.call(a.id,'sessions_replace',{sessionId:b.id,revision:b.runtime.revision,key:'bad'}),/older/);r.messages.clear(bot);await assert.rejects(r.runtime.call(b.id,'chat_list',{}),/active/);});

// Worst case for the byte budgets: multibyte characters and characters JSON escapes.
const worst=(bytes)=>'é"\\\n😀'.repeat(Math.ceil(bytes/10)).slice(0,bytes);
const ref=(i)=>({kind:'execution',sessionId:`${'a'.repeat(23)}${i%10}`,firingId:'f'.repeat(24),triggerId:'t'.repeat(24),triggerName:worst(128),at:Date.now(),reason:worst(1024)});
const fail=(r,botId=bot,reason='spawn /usr/local/bin/codex EAGAIN',output='')=>{const s=r.create(botId);r.sessions.patch(s.id,{state:'failed',open:false,endedAt:Date.now(),reason,runnerOutput:output});return r.sessions.get(s.id);};
const lossless=(text)=>!text.includes('�');
test('execution summaries carry a compact origin, a short reason and the cause',async t=>{const r=setup(t),me=r.create(),failed=fail(r);r.sessions.patch(failed.id,{cause:'processes'});const got=await r.runtime.call(me.id,'sessions_get',{sessionId:failed.id});assert.equal(got.reason,'spawn /usr/local/bin/codex EAGAIN');assert.equal(got.cause,'processes');assert.deepEqual(got.trigger,{kind:'chat'});const long=fail(r,bot,worst(4000));const listed=(await r.runtime.call(me.id,'sessions_list',{})).items.find(i=>i.id===long.id);assert.ok(Buffer.byteLength(listed.reason)<=256&&lossless(listed.reason));const detailed=await r.runtime.call(me.id,'sessions_get',{sessionId:long.id});assert.ok(Buffer.byteLength(detailed.reason)<=1024&&Buffer.byteLength(detailed.reason)>256&&lossless(detailed.reason));});
test('failure-origin rows fit a page and a single read trims listed failures to 8 KiB',async t=>{const r=setup(t),me=r.create();for(let i=0;i<25;i++){const s=r.sessions.create(bot,{kind:'failure',failures:Array.from({length:20},(_,j)=>ref(j)),overflow:3},{agentId:'fake',modelId:null,signIn:{kind:'none'},approvalMode:'autonomous',instructions:'',context:'',maxTurnMs:10000});r.runtime.register(s.id);r.sessions.patch(s.id,{state:'failed',open:false,endedAt:Date.now(),reason:worst(1024)});}let page=await r.runtime.call(me.id,'sessions_list',{limit:25});const rows=[];for(;;){assert.ok(Buffer.byteLength(JSON.stringify(page))<=8192);if(page.nextCursor)assert.ok(page.items.length>=5);rows.push(...page.items);if(!page.nextCursor)break;page=await r.runtime.call(me.id,'sessions_list',{limit:25,cursor:page.nextCursor});}assert.equal(rows.filter(i=>i.trigger.kind==='failure').length,25);const row=rows.find(i=>i.trigger.kind==='failure');assert.deepEqual(row.trigger,{kind:'failure',failureCount:23});const got=await r.runtime.call(me.id,'sessions_get',{sessionId:row.id});assert.ok(Buffer.byteLength(JSON.stringify(got))<=8192);assert.ok(got.failures.length>0&&got.failures.length<20);assert.equal(got.failures.length+got.failuresOmitted,23);});
test('runner output reads tail first, continues to the start and is scoped to ended executions of this bot',async t=>{const r=setup(t),me=r.create();const output=`start\n${worst(20000)}\nError: spawn /usr/local/bin/codex EAGAIN`;const failed=fail(r,bot,'x',output);let page=await r.runtime.call(me.id,'sessions_output',{sessionId:failed.id});assert.match(page.text,/EAGAIN$/);assert.ok(Buffer.byteLength(page.text)<=6144);assert.ok(Buffer.byteLength(JSON.stringify(page))<=8192);const parts=[page.text];while(page.nextCursor){page=await r.runtime.call(me.id,'sessions_output',{sessionId:failed.id,cursor:page.nextCursor});assert.ok(lossless(page.text));parts.unshift(page.text);}assert.equal(parts.join(''),output);assert.ok(parts.length>3);await assert.rejects(r.runtime.call(me.id,'sessions_output',{sessionId:r.create().id}),/has not ended/);const outside=fail(r,other,'x','secret output');await assert.rejects(r.runtime.call(me.id,'sessions_output',{sessionId:outside.id}),(e)=>/Execution not found/.test(e.message));await assert.rejects(r.runtime.call(me.id,'sessions_output',{sessionId:'b'.repeat(24)}),(e)=>/Execution not found/.test(e.message));const first=await r.runtime.call(me.id,'sessions_output',{sessionId:failed.id});const forged=first.nextCursor.replace(/.$/,(c)=>c==='0'?'1':'0');await assert.rejects(r.runtime.call(me.id,'sessions_output',{sessionId:failed.id,cursor:forged}),/Invalid cursor/);const sibling=fail(r,bot,'x',output);await assert.rejects(r.runtime.call(me.id,'sessions_output',{sessionId:sibling.id,cursor:first.nextCursor}),/another query/);const empty=fail(r,bot,'x','');assert.deepEqual(await r.runtime.call(me.id,'sessions_output',{sessionId:empty.id}),{sessionId:empty.id,state:'failed',text:'',nextCursor:null,truncated:false});});
test('briefings list recent failures and unhealthy triggers within the budget',async t=>{const r=setup(t);const old=fail(r);r.sessions.patch(old.id,{endedAt:Date.now()-2*86_400_000});const recent=fail(r);r.triggers.push({id:'t'.repeat(24),name:'Gitea poll',health:{state:'failed',error:'condition exited 1: tea: command not found',cause:null}},{id:'u'.repeat(24),name:'Fine',health:{state:'healthy',error:null}});const me=r.create();const context=JSON.parse(r.runtime.briefing(me.id).split('\n').at(-1));assert.deepEqual(context.recentFailures.map(f=>f.id),[recent.id]);assert.equal(context.recentFailures[0].reason,'spawn /usr/local/bin/codex EAGAIN');assert.deepEqual(context.unhealthyTriggers,[{id:'t'.repeat(24),name:'Gitea poll',state:'failed',error:'condition exited 1: tea: command not found',cause:null}]);assert.match(r.runtime.briefing(me.id),/sessions_output/);});
test('briefing trims messages, then triggers, then failures, then executions, with ten worst-case entries each',async t=>{const r=setup(t);for(let i=0;i<10;i++)r.messages.post(bot,'user',worst(1500),null,'m'+i);for(let i=0;i<10;i++)fail(r,bot,worst(1024));for(let i=0;i<10;i++)r.triggers.push({id:String(i).repeat(24),name:worst(128),health:{state:i%2?'blocked':'failed',error:worst(1024),cause:i%2?'processes':null}});for(let i=0;i<5;i++)r.create(bot,worst(1500));const me=r.create(bot,'Current task');const briefing=r.runtime.briefing(me.id),line=briefing.split('\n').at(-1),context=JSON.parse(line);assert.ok(line.startsWith('{"executionId":'));assert.ok(Buffer.byteLength(line)<=8192);assert.equal(context.recentMessages.items.length,1);assert.ok(context.recentFailures.length<=5&&context.unhealthyTriggers.length<=5);for(const f of context.recentFailures)assert.ok(Buffer.byteLength(f.reason)<=256&&lossless(f.reason));for(const g of context.unhealthyTriggers)assert.ok(Buffer.byteLength(g.error)<=256&&lossless(g.error));assert.equal(context.triggerMessage.text,'Current task');if(context.unhealthyTriggers.length<5)assert.equal(context.recentFailures.length+context.otherExecutions.length>0,true);if(context.recentFailures.length<5)assert.equal(context.unhealthyTriggers.length,0);if(context.otherExecutions.length<5)assert.equal(context.recentFailures.length,0);});

test('the briefing claims no Terminay authority only for an execution without the terminay server', async t => {
	const r = setup(t);
	const me = r.create();
	const without = r.runtime.briefing(me.id);
	assert.match(without, /You have no Terminay workspace\/project\/terminal authority/);
	const withTerminay = r.runtime.briefing(me.id, true);
	assert.doesNotMatch(withTerminay, /no Terminay workspace/);
	assert.match(withTerminay, /`terminay` MCP server, with full control/);
	assert.match(withTerminay, /never tell them you cannot or to ask Pixel/);
});

test('the briefing counts only active peers, reports queued work and asks the agent to decide', async (t) => {
	const r = setup(t);
	const running = r.create(bot, 'Monitor an issue');
	const waiting = r.create(bot, 'Needs an answer');
	r.sessions.patch(waiting.id, { state: 'needs-you' });
	const revoked = r.create(bot, 'Replaced work');
	r.runtime.revoke(revoked.id);
	for (let i = 0; i < 6; i++) {
		const queued = r.create(bot, `Queued ${i}`);
		r.sessions.patch(queued.id, { state: 'queued' });
	}
	const me = r.create(bot, 'Pick up another issue');
	const text = r.runtime.briefing(me.id);
	const context = JSON.parse(text.split('\n').at(-1));
	assert.equal(context.totalOtherExecutions, 2);
	assert.equal(context.queuedExecutions, 6);
	assert.deepEqual(
		context.otherExecutions.map((e) => e.id).sort(),
		[running.id, waiting.id].sort(),
	);
	assert.equal('coordinationOnly' in context, false);
	assert.match(text, /currently 2 other active executions/);
	assert.match(
		text,
		/sessions_stop.*sessions_post.*sessions_replace.*leave it running/,
	);
	assert.match(text, /desktop and browser are shared/);
	assert.match(text, /re-check with sessions_list or events_next/);
	assert.doesNotMatch(text, /work_acquire|work lease|shared work/);
	const alone = r.create(other, 'First task');
	assert.match(
		r.runtime.briefing(alone.id),
		/currently 0 other active executions/,
	);
});

// A reply's execution: its trigger message is a reply in `rootId`'s thread.
const replyExecution=(r,rootId,text='and the logs?')=>{const message=r.messages.post(bot,'user',text,null,Math.random().toString(),[],[],rootId);const record=r.sessions.create(bot,{kind:'chat',messageId:message.id},{agentId:'fake',modelId:null,signIn:{kind:'none'},approvalMode:'autonomous',instructions:'',context:'',maxTurnMs:10000});r.runtime.register(record.id);r.sessions.patch(record.id,{state:'running'});return r.sessions.get(record.id);};
const contextOf=(r,id)=>JSON.parse(r.runtime.briefing(id).split('\n').at(-1));

test('chat_post and chat_list take a threadId scoped to the calling bot', async t => {
	const r = setup(t), me = r.create();
	const root = r.messages.post(bot, 'user', 'Deploy please', null, 'root');
	const posted = await r.runtime.call(me.id, 'chat_post', { text: 'Done', key: 'k', threadId: root.id });
	assert.equal(posted.threadId, root.id);
	assert.equal(r.messages.get(bot, posted.messageId).threadId, root.id);
	assert.ok(!(await r.runtime.call(me.id, 'chat_list', {})).items.some((m) => m.id === posted.messageId));
	const thread = await r.runtime.call(me.id, 'chat_list', { threadId: root.id });
	assert.deepEqual(thread.items.map((m) => m.id), [posted.messageId]);
	assert.equal((await r.runtime.call(me.id, 'chat_get', { messageId: root.id })).message.thread.replyCount, 1);
	const foreign = r.messages.post(other, 'user', 'Elsewhere', null, 'f');
	await assert.rejects(r.runtime.call(me.id, 'chat_post', { text: 'x', key: 'f', threadId: foreign.id }), /Thread not found/);
	await assert.rejects(r.runtime.call(me.id, 'chat_list', { threadId: foreign.id }), /Thread not found/);
	assert.equal(r.messages.count(other), 1);
});

test('a reply execution is briefed with its thread; a top-level one is not', async t => {
	const r = setup(t);
	const root = r.messages.post(bot, 'bot', 'Build is green', 'a'.repeat(24), 'root');
	r.messages.post(bot, 'bot', 'Logs attached', 'a'.repeat(24), 'r1', [], [], root.id);
	const me = replyExecution(r, root.id);
	const briefing = r.runtime.briefing(me.id), context = contextOf(r, me.id);
	assert.equal(context.triggerMessage.message.threadId, root.id);
	assert.equal(context.thread.rootId, root.id);
	assert.deepEqual(context.thread.root, { author: 'bot', excerpt: 'Build is green' });
	assert.equal(context.thread.replyCount, 2);
	assert.equal(context.thread.latestReplies.length, 2);
	assert.match(briefing, /passing that threadId to chat_post/);
	assert.equal(contextOf(r, r.create().id).thread, undefined);
});

test('thread context trims first and keeps the root id within the budget', async t => {
	const r = setup(t);
	for (let i = 0; i < 10; i++) r.messages.post(bot, 'user', worst(1500), null, 'm' + i);
	const root = r.messages.post(bot, 'user', worst(4000), null, 'root');
	// Active executions with long prompts put the briefing under pressure.
	for (let i = 0; i < 5; i++) r.create(bot, worst(1500));
	for (let i = 0; i < 200; i++) r.messages.post(bot, i % 2 ? 'bot' : 'user', worst(1500), i % 2 ? 'a'.repeat(24) : null, 'r' + i, [], [], root.id);
	const me = replyExecution(r, root.id);
	const line = r.runtime.briefing(me.id).split('\n').at(-1), context = JSON.parse(line);
	assert.ok(Buffer.byteLength(line) <= 8192);
	assert.equal(context.thread.rootId, root.id);
	assert.equal(context.thread.replyCount, 201);
	assert.ok(lossless(context.thread.root.excerpt));
	assert.equal(context.triggerMessage.text, 'and the logs?');
	assert.ok(context.thread.latestReplies.length < 4, "the budget is under pressure");
	// Recent messages are trimmed only once the thread context is spent.
	if (context.recentMessages.items.length < 4) {
		assert.equal(context.thread.latestReplies.length, 0);
		assert.ok(Buffer.byteLength(context.thread.root.excerpt) <= 256);
	}
});

test('short thread context costs no recent messages', async t => {
	const r = setup(t);
	for (let i = 0; i < 10; i++) r.messages.post(bot, 'user', worst(1500), null, 'm' + i);
	const root = r.messages.post(bot, 'user', worst(900), null, 'root');
	for (let i = 0; i < 4; i++) r.messages.post(bot, 'bot', worst(300), 'a'.repeat(24), 'r' + i, [], [], root.id);
	const plain = contextOf(r, r.create(bot, 'Current task').id);
	const threaded = contextOf(r, replyExecution(r, root.id, 'Current task').id);
	// Thread replies go first: the threaded briefing keeps no fewer recent messages than it can.
	assert.ok(threaded.thread.latestReplies.length < 4 || threaded.recentMessages.items.length === plain.recentMessages.items.length);
	if (threaded.recentMessages.items.length < plain.recentMessages.items.length) {
		assert.equal(threaded.thread.latestReplies.length, 0);
		assert.ok(Buffer.byteLength(threaded.thread.root.excerpt) <= 256);
	}
});
