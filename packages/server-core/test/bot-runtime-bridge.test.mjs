import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {rmSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import {openBotRuntimeBridge} from '../dist/botService/runtimeBridge.js';
import test from 'node:test';
const relay=fileURLToPath(new URL('./fixtures/bot-relay-host.py',import.meta.url));
const adapter=fileURLToPath(new URL('../../../docker/terminay-bot/bin/terminay-bot-mcp',import.meta.url));
test('private MCP relay serves only scoped tools, preserves framing, redacts token and cleans up', {timeout:15000},async t=>{
 const sid=randomBytes(12).toString('hex'),socket='/tmp/terminay-mcp-'+sid+'.sock';t.after(()=>rmSync(socket,{force:true}));let child,active=true,ownsWork=false,unbound=false,calls=0;const killed=[];
 const runtime={bindSecret:(id,token)=>{assert.equal(id,sid);assert.equal(token.length,64);return()=>unbound=true;},assert:id=>{assert.equal(id,sid);if(!active)throw Error('revoked');},assertWork:id=>{assert.equal(id,sid);if(!ownsWork)throw Error('work unavailable');},call:async(id,name,args)=>{assert.equal(id,sid);assert.equal(name,'chat_list');calls++;return {items:[],echo:args};}};
 const driver={execStream:(_container,command)=>{assert.equal(command[0],'terminay-run');child=spawn('python3',[relay,sid],{stdio:['pipe','pipe','pipe']});return child;},exec:async(_container,command,options)=>{if(command[0]==='/usr/local/bin/terminay-bot-mcp'){const probe=spawn('python3',[adapter,'--check-runtime'],{env:{...process.env,...options.env},stdio:['ignore','pipe','pipe']});let stderr='';probe.stderr.on('data',b=>stderr+=b);const [code]=await once(probe,'close');assert.equal(code,0,stderr);return '';}killed.push(command);if(child.exitCode===null){const close=once(child,'close');child.stdin.end();await close;}return '';}};
 const bridge=await openBotRuntimeBridge(driver,'abc123def456',sid,runtime);t.after(()=>bridge.close());
 const environment=Object.fromEntries(bridge.servers[0].env.map(e=>[e.name,e.value]));
 const client=spawn('python3',[adapter],{env:{...process.env,...environment},stdio:['pipe','pipe','pipe']});t.after(()=>client.kill());
 const lines=createInterface({input:client.stdout});const iterator=lines[Symbol.asyncIterator]();
 const request=async(id,method,params={})=>{const wire=JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n';client.stdin.write(wire.slice(0,11));client.stdin.write(wire.slice(11));const response=await iterator.next();assert.equal(response.done,false);return JSON.parse(response.value);};
 const initialized=await request(1,'initialize',{protocolVersion:'2025-03-26',clientInfo:{name:'test',version:'1'},capabilities:{}});assert.equal(initialized.result.serverInfo.name,'terminay-bot-runtime');
 const catalog=await request(2,'tools/list');assert.ok(catalog.result.tools.some(tool=>tool.name==='chat_post'));assert.equal(catalog.result.tools.filter(tool=>tool.name.startsWith('triggers_')).length,8);assert.ok(catalog.result.tools.some(tool=>tool.name==='triggers_create'));assert.ok(!catalog.result.tools.some(tool=>/terminal|project/.test(tool.name)));
 const called=await request(3,'tools/call',{name:'chat_list',arguments:{limit:3}});assert.deepEqual(JSON.parse(called.result.content[0].text),{items:[],echo:{limit:3}});assert.equal(calls,1);
 const token=environment.TERMINAY_RUNTIME_TOKEN;const wrapped=bridge.wrapCredential({environment:{},redact:value=>value,stream:()=>({push:value=>value,finish:()=>''}),release:()=>{}});assert.equal(wrapped.redact('token='+token),'token=[redacted]');const redactor=wrapped.stream();assert.equal(redactor.push('🙂'+token.slice(0,10))+redactor.push(token.slice(10)+'✨')+redactor.finish(),'🙂[redacted]✨');
 const guard=readFileSync(new URL('../../../docker/terminay-bot/bin/terminay-shell-env',import.meta.url),'utf8').replace('/usr/local/bin/terminay-bot-mcp',`python3 '${adapter}'`);
 const shell=async()=>{const child=spawn('/bin/bash',['-c',guard+'\nprintf guarded-ok'],{env:{...process.env,...environment},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.resume();const [code]=await once(child,'close');return {code,output};};
 assert.notEqual((await shell()).code,0);ownsWork=true;assert.deepEqual(await shell(),{code:0,output:'guarded-ok'});
 active=false;const revoked=await request(4,'tools/list');assert.ok(revoked.error);await bridge.close();assert.equal(unbound,true);assert.ok(killed.some(command=>command[1]==='--kill'&&command[2]==='mcp-'+sid));client.stdin.end();lines.close();
});

test('relay startup stderr is bounded, redacted and survives cleanup failure', async () => {
 const {EventEmitter}=await import('node:events');const {PassThrough}=await import('node:stream');
 const stream=new EventEmitter();stream.stdin=new PassThrough();stream.stdout=new PassThrough();stream.stderr=new PassThrough();let killed=false;stream.kill=()=>{killed=true;};
 const diagnostics=[];
 const runtime={bindSecret:()=>()=>{},sanitizeSecrets:(_id,text)=>text.replaceAll('secret-value','[redacted]')};
 const driver={execStream:()=>{setImmediate(()=>{stream.stderr.write('failed to bind: secret-value');stream.emit('close',1);});return stream;},exec:async()=>{throw new Error('secondary cleanup failure');}};
 await assert.rejects(openBotRuntimeBridge(driver,'abc123def456','a'.repeat(24),runtime,value=>diagnostics.push(value)),/relay closed before readiness: failed to bind: \[redacted\]/);
 assert.equal(killed,true);assert.equal(diagnostics.length,1);assert.ok(!diagnostics[0].includes('secret-value'));
});
