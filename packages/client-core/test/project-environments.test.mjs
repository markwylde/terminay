import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTENSION_OPERATIONS, ExtensionsClient, PROJECT_ENVIRONMENT_OPERATIONS, ProjectEnvironmentsClient } from '../dist/index.js';

test('all project environment and extension client operations obey the wire grammar',()=>{
	const operationPattern=/^[a-z][a-z0-9._:-]{0,255}$/;
	for(const operation of [...Object.values(PROJECT_ENVIRONMENT_OPERATIONS),...Object.values(EXTENSION_OPERATIONS)]) assert.match(operation,operationPattern,operation);
});

test('project environment client uses fixed operations and parses safe summaries', async () => {
	const calls=[];
	const client=new ProjectEnvironmentsClient({
		async query(operation,payload){calls.push({kind:'query',operation,payload});return {revision:2,providers:[{providerId:'demo/provider',displayName:'Demo',profileForm:{id:'demo.profile',title:'Demo connection',submitLabel:'Save',sections:[{id:'main',title:'Connection',fields:[{id:'host',label:'Host',type:'text',required:true}]}]}}],environments:[{id:'terminay:this-server',providerId:'terminay:this-server',providerLabel:'This server',name:'This server',endpointSummary:'Local to Test',status:'ready',referencedProjectCount:1,isThisServer:true}]};},
		async command(operation,payload){calls.push({kind:'command',operation,payload});return {operationId:'op-1',state:'succeeded',projectId:'project-1'};},
	});
	const snapshot=await client.snapshot();
	assert.equal(snapshot.environments[0].isThisServer,true);
	assert.equal(snapshot.providers[0].profileForm.sections[0].fields[0].id,'host');
	await client.createProject({environmentId:'ssh:one',viewId:'view-1',root:'/work'});
	assert.deepEqual(calls.map(call=>call.operation),['project-environments.snapshot','project-environments.create-project']);
	assert.equal(calls[1].payload.environmentId,'ssh:one');
});

test('extension client binds preview confirmation to exact digest and revision', async () => {
	const calls=[];
	const client=new ExtensionsClient({
		async query(operation,payload){calls.push({kind:'query',operation,payload});return operation==='extensions.preview-install'?{previewDigest:'digest',packageName:'demo',exactVersion:'1.2.3',registryIntegrity:'sha512-ok',official:false,permissions:['network'],provenance:'verified'}:{authorityLabel:'Production',revision:4,catalogue:[{extensionId:'demo.ext',packageName:'demo',displayName:'Demo',description:'Demo provider',official:false}],extensions:[]};},
		async command(operation,payload){calls.push({kind:'command',operation,payload});return {authorityLabel:'Production',revision:5,catalogue:[],extensions:[]};},
	});
	const preview=await client.previewInstall('demo@1.2.3');
	assert.equal(preview.version,'1.2.3');
	await client.install(preview.previewDigest,4);
	assert.equal(calls[1].payload.confirmation,true);
	assert.equal(calls[1].payload.expectedRevision,4);
	assert.match(calls[1].payload.idempotencyKey,/^ui-/);
});

test('clients reject unbounded or malformed server DTOs', async () => {
	const environments=new ProjectEnvironmentsClient({query:async()=>({revision:0,environments:[{id:'x',providerId:'x',providerLabel:'x',name:'x',endpointSummary:'',status:'secret-leak',referencedProjectCount:0}]}),command:async()=>null});
	await assert.rejects(environments.snapshot(),/snapshot|summary/);
	const extensions=new ExtensionsClient({query:async()=>({revision:0,extensions:[],catalogue:new Array(513).fill({})}),command:async()=>null});
	await assert.rejects(extensions.list(),/exceeds/);
});
