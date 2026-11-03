import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {BotDeletions} from '../dist/botService/deletions.js';
import {botFailure} from '../dist/botService/failure.js';
import {BotError,BotImageBuildError} from '../dist/botService/store.js';
import {EngineCommandError} from '../dist/botService/process.js';
import {runtime,until} from './fixtures/bot-test-runtime.mjs';

const pin={version:2,kind:'podman',address:'unix:///tmp/podman.sock',identity:'original',connection:false};
function directory(t){const root=mkdtempSync(join(tmpdir(),'bot-recovery-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
async function setup(t){const root=mkdtempSync(join(tmpdir(),'bot-recovery-'));const r=await runtime(root);t.after(async()=>{await r.service.shutdown();await r.kill();rmSync(root,{recursive:true,force:true});});const bot=await r.service.save({name:'Recovery',agentId:'fake.agent',signIn:{kind:'token',environmentVariable:'FAKE_KEY'}});return {...r,root,bot};}

test('engine and image failures have actionable messages and structured causes without daemon diagnostics',()=>{
 for(const code of ['not-running','engine-changed','permission-denied','not-installed']){
  const failure=botFailure(new EngineCommandError(code,'secret daemon details'));
  assert.equal(failure.details.reason,code);assert.ok(!failure.message.includes('secret'));assert.notEqual(failure.message,'query failed');
 }
 assert.equal(botFailure(new BotImageBuildError()).details.reason,'image-build-failed');
 assert.equal(botFailure(new BotError('validation','invalid bot')).code,'validation');
 assert.equal(botFailure(new Error('secret')),undefined);
});

test('pending deletion survives restart, preserves home choice, and cannot follow a reset or a new endpoint',t=>{
 const path=join(directory(t),'deletions.json');let pending=new BotDeletions(path, 'server');
 pending.begin('abc123def456',false,pin);pending.begin('abc123def456',true,{...pin,identity:'reset'});
 pending=new BotDeletions(path, 'server');assert.equal(pending.list()[0].deleteHome,false);
 assert.equal(pending.matches('abc123def456',pin),true);assert.equal(new BotDeletions(path,'other-server').matches('abc123def456',pin),false);
 assert.equal(pending.matches('abc123def456',{...pin,identity:'reset'}),false);
 assert.equal(pending.matches('abc123def456',{...pin,address:'unix:///tmp/other.sock'}),false);
 pending.complete('abc123def456');assert.equal(new BotDeletions(path, 'server').list().length,0);
});

test('chat fails early with the real engine cause and a redacted durable runner diagnostic',async t=>{
 const r=await setup(t);let prepared=0;r.hooks.driver=async()=>{throw new EngineCommandError('engine-changed','secret');};r.environment.prepareSession=async()=>{prepared++;};
 const {sessionId}=await r.service.send(r.bot.id,'normal');await until(r.service,'changed',()=>r.sessions.get(sessionId).state==='failed');
 const record=r.sessions.get(sessionId);assert.match(record.reason,/identity changed/);assert.match(record.runnerOutput,/Bot execution failed/);assert.ok(!record.runnerOutput.includes('secret'));assert.equal(prepared,0);
});

test('missing image preparation precedes adapter readiness for chat',async t=>{
 const r=await setup(t);let prepared=false;r.environment.prepareSession=async()=>{prepared=true;};r.hooks.agents.botAgentStatus=async()=>({available:prepared,value:{state:'ready'}});
 const {sessionId}=await r.service.send(r.bot.id,'normal');await until(r.service,'changed',()=>r.sessions.get(sessionId).state==='completed');assert.ok(prepared);
});

test('confirmed deletion removes local records and messages during an engine outage with an explicit warning',async t=>{
 const r=await setup(t);const first=await r.service.send(r.bot.id,'normal');await until(r.service,'changed',()=>r.sessions.get(first.sessionId).state==='completed');
 const pending=new BotDeletions(join(r.root,'deletions.json'), 'server');
 r.hooks.deletion={begin:(id,home)=>pending.begin(id,home,pin),cleanup:async()=>false};
 await assert.rejects(r.service.remove(r.bot.id,true,false),/confirmation/);
 const result=await r.service.remove(r.bot.id,true,true);assert.match(result.warning,/Removal is pending/);
 assert.equal(r.bots.list().length,0);assert.equal(r.sessions.list(r.bot.id).length,0);assert.equal(r.service.messages.list(r.bot.id).total,0);assert.equal(pending.list()[0].deleteHome,true);
});
