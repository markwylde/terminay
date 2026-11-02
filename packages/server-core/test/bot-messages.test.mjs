import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {BotMessageStore} from '../dist/botService/messages.js';
const bot='abc123def456',other='abc123def457';
function setup(t){const root=mkdtempSync(join(tmpdir(),'bot-log-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,store:new BotMessageStore(root)};}
test('communication persists independently with idempotent posts and revision-checked edits',t=>{
 const {root,store}=setup(t);const first=store.post(bot,'user','Open BBC',null,'post-1');
 assert.equal(store.post(bot,'user','Open BBC',null,'post-1').id,first.id);
 assert.throws(()=>store.post(bot,'user','Changed',null,'post-1'),/different content/);
 assert.throws(()=>store.edit(bot,first.id,0,'Changed'),/changed/);
 store.edit(bot,first.id,1,'Open Sports');const restored=new BotMessageStore(root);assert.equal(restored.get(bot,first.id).text,'Open Sports');assert.equal(restored.get(bot,first.id).revision,2);
 restored.edit(bot,first.id,2,null);assert.equal(restored.count(bot),0);assert.throws(()=>restored.get(bot,first.id),/not found/);
});
test('snapshot pages remain stable across concurrent posts and reject cross-scope cursors',t=>{
 const {store}=setup(t);const initial=[];for(let i=0;i<31;i++)initial.push(store.post(bot,'user',`Message ${i}`,null,`key-${i}`));
 const page=store.list(bot,{limit:10});store.post(bot,'bot','New arrival','a'.repeat(24),'reply');const read=[...page.items];let cursor=page.nextCursor;
 assert.throws(()=>store.list(other,{cursor}),/cursor/i);assert.throws(()=>store.list(bot,{cursor,search:'different'}),/query/);assert.throws(()=>store.list(bot,{cursor:cursor+'x'}),/cursor/i);assert.throws(()=>store.list(bot,{limit:100}),/limit/);
 while(cursor){const next=store.list(bot,{cursor,limit:10});assert.equal(next.total,31);read.push(...next.items);cursor=next.nextCursor;}
 assert.equal(new Set(read.map(m=>m.id)).size,31);assert.deepEqual(read.map(m=>m.id),initial.reverse().map(m=>m.id));
 store.clear(bot);assert.throws(()=>store.list(bot,{cursor:page.nextCursor}),/expired/);
});
test('UTF-8 detail slices and summary/event results obey byte budgets',t=>{
 const {store}=setup(t);const body='😀\n"\\'.repeat(4000);const message=store.post(bot,'user',body,null,'long');
 let text='',cursor;do{const page=store.detail(bot,message.id,cursor);assert.ok(Buffer.byteLength(JSON.stringify(page))<=8192);assert.ok(!page.text.includes('\uFFFD'));text+=page.text;cursor=page.nextCursor;}while(cursor);assert.equal(text,body);
 assert.ok(Buffer.byteLength(JSON.stringify(store.list(bot)))<=8192);
 const old=store.detail(bot,message.id).nextCursor;store.edit(bot,message.id,1,'Changed');assert.throws(()=>store.detail(bot,message.id,old),/changed/);
});
test('events wait on demand, cancel, report epoch gaps and persist cursors',async t=>{
 const {root,store}=setup(t);const cursor=store.eventCursor(bot);const wait=store.waitEvents(bot,cursor,10,2000);store.post(bot,'user','Hello',null,'one');const page=await wait;assert.equal(page.items[0].type,'message.posted');
 assert.equal(new BotMessageStore(root).events(bot,cursor).items.length,1);assert.equal(store.events(bot,page.nextCursor).items.length,0);
 const abort=new AbortController();const cancelled=store.waitEvents(bot,page.nextCursor,10,2000,abort.signal);abort.abort();await assert.rejects(cancelled);
 store.clear(bot);assert.equal(store.events(bot,page.nextCursor).gap,true);
});
test('attachments survive store restart and disappear with message deletion',t=>{
 const {root,store}=setup(t);const png=Buffer.from('89504e470d0a1a0a','hex');const attachment=store.putAttachment(bot,'screen.png',png);assert.equal(store.putAttachment(bot,'screen.png',png).id,attachment.id);
 const message=store.post(bot,'bot','Screenshot','a'.repeat(24),'image',[attachment]);assert.deepEqual(new BotMessageStore(root).attachment(bot,attachment.id).bytes,png);assert.throws(()=>store.attachment(other,attachment.id),/not found/);store.edit(bot,message.id,1,null);assert.throws(()=>store.attachment(bot,attachment.id),/not found/);
});
test('retained event gaps require resync and snapshot edits preserve earlier pages',t=>{
 const {store}=setup(t);const first=store.post(bot,'user','oldest',null,'oldest');store.post(bot,'user','newest',null,'newest');const page=store.list(bot,{limit:1});store.edit(bot,first.id,1,'revised');assert.equal(store.list(bot,{cursor:page.nextCursor,limit:1}).items[0].excerpt,'oldest');
 const cursor=store.eventCursor(bot);for(let n=0;n<2001;n++)store.emitEvent(bot,'execution.changed','a'.repeat(24),n);assert.equal(store.events(bot,cursor).gap,true);assert.throws(()=>store.list(bot,{cursor:page.nextCursor+'corrupt'}),/cursor/i);
});
test('shared attachment references survive deletion of one message',t=>{const {store}=setup(t);const image=store.putAttachment(bot,'same.png',Buffer.from('89504e470d0a1a0a','hex'));const a=store.post(bot,'bot','one','a'.repeat(24),'one',[image]);store.post(bot,'bot','two','b'.repeat(24),'two',[image]);store.edit(bot,a.id,1,null);assert.equal(store.attachment(bot,image.id).bytes.length,8);});
test('execution pagination retains imported records with tied sequence values',t=>{const {store}=setup(t);const records=Array.from({length:35},(_,n)=>({id:(35-n).toString(16).padStart(24,'0'),order:0,state:'completed'}));let cursor;const seen=[];do{const page=store.pageRecords(bot,'executions','all',records,cursor,10);seen.push(...page.items.map(row=>row.id));cursor=page.nextCursor;}while(cursor);assert.deepEqual(seen,records.map(row=>row.id));assert.equal(new Set(seen).size,35);});
