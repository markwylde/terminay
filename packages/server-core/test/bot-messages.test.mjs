import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
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
 const {root,store}=setup(t);const first=store.post(bot,'user','oldest',null,'oldest');store.post(bot,'user','newest',null,'newest');const page=store.list(bot,{limit:1});store.edit(bot,first.id,1,'revised');assert.equal(store.list(bot,{cursor:page.nextCursor,limit:1}).items[0].excerpt,'oldest');
 const cursor=store.eventCursor(bot);
 // Seed valid retained history from a real event shape. Only the boundary
 // append needs a durable mutation; thousands of fsyncs add no gap coverage.
 store.emitEvent(bot,'execution.changed','a'.repeat(24),0);
 const path=join(root,bot,'messages.json');
 const state=JSON.parse(readFileSync(path,'utf8'));
 const event=state.events.at(-1);
 state.events=Array.from({length:2000},(_,n)=>({...event,sequence:event.sequence+n,revision:n}));
 state.sequence=state.events.at(-1).sequence;
 writeFileSync(path,JSON.stringify(state));
 const retained=new BotMessageStore(root);
 assert.equal(retained.events(bot,cursor).gap,false,'the cursor immediately before retained history is still valid');
 retained.emitEvent(bot,'execution.changed','a'.repeat(24),2000);
 assert.equal(retained.events(bot,cursor).gap,true);
 const reopened=new BotMessageStore(root);
 assert.equal(reopened.events(bot,cursor).gap,true,'retention survives reopening');
 const persisted=JSON.parse(readFileSync(path,'utf8'));
 assert.equal(persisted.events.length,2000);
 assert.equal(persisted.events.at(-1).revision,2000);
 assert.equal(reopened.get(bot,first.id).text,'revised');
 assert.equal(reopened.list(bot,{cursor:page.nextCursor,limit:1}).items[0].excerpt,'oldest');
 assert.throws(()=>reopened.list(bot,{cursor:page.nextCursor+'corrupt'}),/cursor/i);
});
test('shared attachment references survive deletion of one message',t=>{const {store}=setup(t);const image=store.putAttachment(bot,'same.png',Buffer.from('89504e470d0a1a0a','hex'));const a=store.post(bot,'bot','one','a'.repeat(24),'one',[image]);store.post(bot,'bot','two','b'.repeat(24),'two',[image]);store.edit(bot,a.id,1,null);assert.equal(store.attachment(bot,image.id).bytes.length,8);});
test('execution pagination retains imported records with tied sequence values',t=>{const {store}=setup(t);const records=Array.from({length:35},(_,n)=>({id:(35-n).toString(16).padStart(24,'0'),order:0,state:'completed'}));let cursor;const seen=[];do{const page=store.pageRecords(bot,'executions','all',records,cursor,10);seen.push(...page.items.map(row=>row.id));cursor=page.nextCursor;}while(cursor);assert.deepEqual(seen,records.map(row=>row.id));assert.equal(new Set(seen).size,35);});

test('backward slices read immutable text from the end on UTF-8 boundaries',t=>{const {store}=setup(t);const text='a'+'😀é'.repeat(5000)+'z';let page=store.sliceTextBackward(bot,'output','s1',text,{},undefined,100);assert.ok(page.text.endsWith('z')&&Buffer.byteLength(page.text)<=100);const parts=[page.text];while(page.nextCursor){page=store.sliceTextBackward(bot,'output','s1',text,{},page.nextCursor,100);assert.ok(!page.text.includes('�'));parts.unshift(page.text);}assert.equal(parts.join(''),text);const first=store.sliceTextBackward(bot,'output','s1',text,{},undefined,100);assert.throws(()=>store.sliceTextBackward(bot,'output','s1',text+'more',{},first.nextCursor,100),/changed/);assert.throws(()=>store.sliceTextBackward(other,'output','s1',text,{},first.nextCursor,100),/Invalid cursor/);assert.throws(()=>store.sliceTextBackward(bot,'output','s2',text,{},first.nextCursor,100),/another query/);});

const png=(n=0)=>Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from([n])]);
function clocked(t){const root=mkdtempSync(join(tmpdir(),'bot-log-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const clock={now:1000};return {root,clock,store:new BotMessageStore(root,()=>clock.now)};}
test('user uploads stage images that a post consumes atomically and retry-safely',t=>{
 const {store}=clocked(t);const a=store.stage(bot,'a.png',png(1)),b=store.stage(bot,'b.png',png(2));
 assert.match(a.token,/^[a-f0-9]{24}$/);assert.deepEqual(a.attachment,{name:'a.png',mime:'image/png',size:9});
 const message=store.post(bot,'user','',null,'send-1',[],[a.token,b.token]);assert.deepEqual(message.attachments.map(x=>x.name),['a.png','b.png']);assert.equal(message.text,'');
 assert.equal(store.post(bot,'user','',null,'send-1',[],[a.token,b.token]).id,message.id,'replay after consumption returns the original');assert.equal(store.count(bot),1);
 assert.throws(()=>store.post(bot,'user','',null,'send-2',[],[a.token]),/no longer available/,'consumed token');
 assert.deepEqual(store.attachment(bot,message.attachments[0].id).bytes,png(1));
});
test('invalid, foreign or repeated tokens refuse the whole post and keep valid tokens usable',t=>{
 const {store}=clocked(t);const good=store.stage(bot,'ok.png',png(1)),foreign=store.stage(other,'x.png',png(2));
 assert.throws(()=>store.post(bot,'user','hi',null,'k1',[],[good.token,foreign.token]),/no longer available/);
 assert.throws(()=>store.post(bot,'user','hi',null,'k2',[],[good.token,good.token]),/twice/);
 assert.throws(()=>store.post(bot,'user','hi',null,'k3',[],['f'.repeat(24)]),/no longer available/);
 assert.throws(()=>store.post(bot,'user','hi',null,'k4',[],Array.from({length:5},()=>good.token)),/four/);
 assert.equal(store.count(bot),0);assert.equal(store.post(bot,'user','hi',null,'k5',[],[good.token]).attachments.length,1);
});
test('identical bytes under two names stay two attachments',t=>{
 const {store}=clocked(t);const a=store.stage(bot,'first.png',png(7)),b=store.stage(bot,'second.png',png(7));
 const m=store.post(bot,'user','',null,'same',[],[a.token,b.token]);assert.deepEqual(m.attachments.map(x=>x.name),['first.png','second.png']);assert.equal(m.attachments[0].id,m.attachments[1].id);
});
test('staged images expire lazily, survive prune while live, and clear discards staging',t=>{
 const {root,clock,store}=clocked(t);const live=store.stage(bot,'live.png',png(1));store.pruneAttachments(bot);
 assert.equal(readdirSync(join(root,bot,'attachments')).length,1,'prune keeps live staging');
 clock.now+=15*60*1000+1;store.post(bot,'user','text only',null,'tick');assert.equal(readdirSync(join(root,bot,'attachments')).length,0,'a post discards expired staging');
 assert.throws(()=>store.post(bot,'user','',null,'late',[],[live.token]),/no longer available/);
 const staged=store.stage(bot,'c.png',png(3));store.clear(bot);assert.throws(()=>store.post(bot,'user','',null,'after-clear',[],[staged.token]),/no longer available/);
 const restarted=store.stage(bot,'r.png',png(4));const reopened=new BotMessageStore(root,()=>clock.now);reopened.count(bot);assert.equal(readdirSync(join(root,bot,'attachments')).length,0,'load prunes orphaned staging');void restarted;
});
test('a failed persist leaves tokens usable',t=>{
 const {store}=clocked(t);const a=store.stage(bot,'a.png',png(1));const save=store.save;store.save=()=>{throw new Error('disk full');};
 assert.throws(()=>store.post(bot,'user','',null,'f1',[],[a.token]),/disk full/);store.save=save;assert.equal(store.post(bot,'user','',null,'f2',[],[a.token]).attachments.length,1);
});
test('staged blobs count toward the bot storage bound',t=>{
 const {store}=clocked(t);const big=n=>Buffer.concat([png(n),Buffer.alloc(2*1024*1024-9,n)]);
 for(let n=0;n<32;n++)store.stage(bot,`${n}.png`,big(n));assert.throws(()=>store.stage(bot,'over.png',big(99)),/64 MiB/);
});
