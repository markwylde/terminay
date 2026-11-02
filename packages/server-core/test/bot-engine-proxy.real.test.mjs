import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { create as tar } from 'tar';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { startEngineProxy } from '../../../docker/terminay-bot/bin/terminay-engine-proxy.mjs';

const exec = promisify(execFile);
const rawSocket = process.env.BOT_PROXY_REAL_ENGINE_SOCKET;
const compose = process.env.BOT_PROXY_COMPOSE_BIN;
function request(socketPath, method, path, payload, raw = false) {
	return new Promise((resolve, reject) => {
		const r = http.request({ socketPath, path, method, headers: payload ? {'content-type':'application/json'} : {}, agent:false }, async response => {
			const chunks=[]; for await (const c of response) chunks.push(c);
			const body=Buffer.concat(chunks).toString();
			if (response.statusCode >= 400) return reject(new Error(`Engine status ${response.statusCode}: ${body.slice(0,256)}`));
			resolve(raw ? body : body ? JSON.parse(body) : null);
		});r.setTimeout(10000,()=>r.destroy(new Error(`Engine request deadline: ${method} ${path.split('?')[0]}`)));r.once('error',reject);r.end(payload ? JSON.stringify(payload) : undefined);
	});
}
test('real Compose and native Podman use API attribution; another bot can control the workload', { skip: !rawSocket || !compose, timeout:120000 }, async t => {
	const root=await mkdtemp(join(tmpdir(),'proxy-real-'));
	const serverId=`proxy-verification-${process.pid}`;
	const image=process.env.BOT_PROXY_TEST_IMAGE ?? 'localhost/terminay-bot:local';
	const proxies=[], projects=[], native=[], images=[];
	t.after(async()=>{
		for (const p of projects) await exec(compose,['-p',p.name,'-f',p.file,'down','-v','--remove-orphans','--timeout','1'],{env:p.env,timeout:30000,killSignal:'SIGKILL'}).catch(()=>{});
		for (const id of native) await request(rawSocket,'DELETE',`/containers/${id}?force=1`).catch(()=>{});
		for (const tag of images) await request(rawSocket,'DELETE',`/images/${encodeURIComponent(tag)}?force=1`).catch(()=>{});
		for (const p of proxies) await p.close();
		await rm(root,{recursive:true,force:true});
	});
	for (const [n,botId] of [[1,'proxytest001'],[2,'proxytest002']]) {
		const socketPath=join(root,`bot-${n}.sock`);
		proxies.push(await startEngineProxy({rawSocket,socketPath,serverId,botId,uid:process.getuid(),gid:process.getgid()}));
		const file=join(root,`compose-${n}.json`);
		await writeFile(file,JSON.stringify({services:{worker:{image,pull_policy:'never',entrypoint:['sh','-c','printf "proxy-log-ok\\n"; exec sleep 600'],labels:{'purpose':'terminay-proxy-test'},volumes:['data:/work']}},volumes:{data:{}}}));
		projects.push({name:`terminay-proxy-${process.pid}-${n}`,file,botId,socketPath,env:{...process.env,DOCKER_HOST:`unix://${socketPath}`}});
	}
	console.log('Compose up for two bot identities');
	await Promise.all(projects.map(p=>exec(compose,['-p',p.name,'-f',p.file,'up','-d'],{env:p.env,timeout:60000,killSignal:'SIGKILL'})));
	console.log('Compose started; inspect attribution and execute');
	for (const p of projects) {
		console.log('Inspect project',p.name);
		const filters=encodeURIComponent(JSON.stringify({label:[`com.docker.compose.project=${p.name}`]}));
		const containers=await request(rawSocket,'GET',`/containers/json?all=1&filters=${filters}`);
		assert.equal(containers.length,1);
		p.id=containers[0].Id;
		assert.equal(containers[0].Labels['terminay.bot'],p.botId);
		assert.equal(containers[0].Labels['terminay.server'],serverId);
		assert.equal(containers[0].Labels['com.docker.compose.project'],p.name);
		for (const [resource,items] of [['networks',await request(rawSocket,'GET',`/networks?filters=${filters}`)],['volumes',(await request(rawSocket,'GET',`/volumes?filters=${filters}`)).Volumes]]) {
			assert.ok(items.length>0,resource);
			assert.ok(items.every(item=>item.Labels['terminay.bot']===p.botId),resource);
		}
		console.log('Compose exec',p.name);
		const {stdout}=await exec(compose,['-p',p.name,'-f',p.file,'exec','-T','worker','printf','proxy-exec-ok'],{env:p.env,timeout:10000,killSignal:'SIGKILL'});
		assert.equal(stdout,'proxy-exec-ok');
		assert.match(await request(p.socketPath,'GET',`/containers/${p.id}/logs?stdout=1&stderr=1&tail=10`,undefined,true),/proxy-log-ok/);
	}
	console.log('Cross-bot stop');
	await request(projects[1].socketPath,'POST',`/containers/${projects[0].id}/stop?t=1`);
	const first=await request(rawSocket,'GET',`/containers/${projects[0].id}/json`);
	assert.equal(first.State.Running,false); assert.equal(first.Config.Labels['terminay.bot'],projects[0].botId);
	console.log('Native Podman create');
	if (process.env.BOT_PROXY_PODMAN_BIN) {
		const {stdout}=await exec(process.env.BOT_PROXY_PODMAN_BIN,['--remote','--url',`unix://${projects[1].socketPath}`,'create','--pull=never','--entrypoint','sleep',image,'600'],{timeout:10000,killSignal:'SIGKILL'});
		const id=stdout.trim();native.push(id);
		assert.equal((await request(rawSocket,'GET',`/containers/${id}/json`)).Config.Labels['terminay.bot'],projects[1].botId);
	}
	const remaining=await request(rawSocket,'GET',`/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({label:[`terminay.server=${serverId}`]}))}`);
	assert.equal(remaining.length,process.env.BOT_PROXY_PODMAN_BIN?3:2);
	console.log('Stream Docker build context and progress through proxy');
	const context=join(root,'context');await mkdir(context);
	await writeFile(join(context,'Dockerfile'),`FROM ${image}\nCOPY marker /proxy-verification-marker\n`);
	await writeFile(join(context,'marker'),serverId);
	const tag=`localhost/terminay-proxy-verification-${process.pid}`;images.push(tag);
	await new Promise((resolve,reject)=>{
		const build=http.request({socketPath:projects[0].socketPath,path:`/build?t=${encodeURIComponent(tag)}&rm=1&pull=0`,method:'POST',headers:{'content-type':'application/x-tar'},agent:false},async response=>{
			try {
				let output='';for await(const chunk of response)output+=chunk.toString();
				assert.equal(response.statusCode,200);
				for(const line of output.trim().split('\n')){const item=JSON.parse(line);assert.equal(item.error,undefined);assert.equal(item.errorDetail,undefined);}
				resolve();
			}catch(error){reject(error);}
		});build.setTimeout(30000,()=>build.destroy(new Error('Build stream deadline')));build.on('error',reject);
		tar({cwd:context},['Dockerfile','marker']).on('error',reject).pipe(build);
	});
	assert.ok((await request(rawSocket,'GET',`/images/${encodeURIComponent(tag)}/json`)).Id);
});
