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
		async query(operation,payload){calls.push({kind:'query',operation,payload});return operation===PROJECT_ENVIRONMENT_OPERATIONS.resolveOptions?{options:[{value:'image-1',label:'Debian'}]}:{revision:2,providers:[{providerId:'demo/provider',displayName:'Demo',profileForm:{id:'demo.profile',title:'Demo connection',submitLabel:'Save',sections:[{id:'main',title:'Connection',fields:[{id:'host',label:'Host',type:'text',required:true}]}]},browseForm:{id:'demo.browse',title:'Browse Terminay VMs',submitLabel:'Add',sections:[{id:'vms',title:'VMs',fields:[{id:'machineId',label:'VM',type:'select',required:true}]}]}}],profiles:[{id:'profile-1',providerId:'demo/provider',name:'Demo',endpointSummary:'example.test',initialValues:{host:'example.test'}}],environments:[{id:'terminay:this-server',providerId:'terminay:this-server',providerLabel:'This server',name:'This server',endpointSummary:'Local to Test',status:'ready',referencedProjectCount:1,isThisServer:true}]};},
		async command(operation,payload){calls.push({kind:'command',operation,payload});return {operationId:'op-1',state:'succeeded',projectId:'project-1'};},
	});
	const snapshot=await client.snapshot();
	assert.equal(snapshot.environments[0].isThisServer,true);
	assert.equal(snapshot.providers[0].profileForm.sections[0].fields[0].id,'host');
	assert.equal(snapshot.providers[0].browseForm.title,'Browse Terminay VMs');
	assert.deepEqual(snapshot.profiles[0].initialValues,{host:'example.test'});
	await client.createProject({environmentId:'ssh:one',viewId:'view-1',root:'/work'});
	await client.removeEnvironment('ssh:stale');
	const options=await client.resolveOptions({providerId:'demo/provider',profileId:'profile-1',sourceId:'demo/images',query:'deb',values:{architecture:'amd64'}});
	assert.equal(options.options[0].label,'Debian');
	assert.deepEqual(calls.map(call=>call.operation),['project-environments.snapshot','project-environments.create-project','project-environments.remove-connection','project-environments.resolve-options']);
	assert.equal(calls[1].payload.environmentId,'ssh:one');
	assert.deepEqual(calls[2].payload,{environmentId:'ssh:stale'});
	assert.deepEqual(calls[3].payload,{providerId:'demo/provider',sourceId:'demo/images',profileId:'profile-1',query:'deb',values:{architecture:'amd64'}});
});

test('project environment client accepts extension status cards without optional facts or actions', async () => {
	const client=new ProjectEnvironmentsClient({
		async query(){return {revision:3,providers:[],profiles:[],environments:[{
			id:'puzed:vm-1',providerId:'puzed',providerLabel:'Puzed',name:'Puzed VM',endpointSummary:'Provisioning',status:'provisioning',referencedProjectCount:0,
			statusCard:{id:'puzed-provisioning',title:'Puzed VM',summary:'The VM is still provisioning.',tone:'neutral'},
		}]};},
		async command(){return null;},
	});
	const [environment]=(await client.snapshot()).environments;
	assert.deepEqual(environment.statusCard?.facts,[]);
	assert.deepEqual(environment.statusCard?.actions,[]);
});

test('extension client binds preview confirmation to exact digest and revision', async () => {
	const calls=[];
	const client=new ExtensionsClient({
		async query(operation,payload){calls.push({kind:'query',operation,payload});return operation==='extensions.preview-install'?{previewDigest:'digest',packageName:'demo',exactVersion:'1.2.3',registryIntegrity:'sha512-ok',official:false,permissions:['network'],provenance:'verified'}:{authorityLabel:'Production',revision:4,catalogue:[{extensionId:'demo.ext',packageName:'demo',displayName:'Demo',description:'Demo provider',official:false}],extensions:[]};},
		async command(operation,payload){calls.push({kind:'command',operation,payload});return {authorityLabel:'Production',revision:5,catalogue:[],extensions:[]};},
		async commandWithBody(operation,payload,body){calls.push({kind:'binary',operation,payload,body:[...body]});return {previewDigest:'uploaded-digest',packageName:'demo-local',exactVersion:'1.0.0',registryIntegrity:'sha512-local',source:'uploaded',filename:'demo-local.tgz',official:false,permissions:[],providerIds:[],dependencies:[],audit:{}};},
	});
	const preview=await client.previewInstall('demo@1.2.3');
	assert.equal(preview.version,'1.2.3');
	await client.install(preview.previewDigest,4);
	assert.equal(calls[1].payload.confirmation,true);
	assert.equal(calls[1].payload.expectedRevision,4);
	assert.match(calls[1].payload.idempotencyKey,/^ui-/);
	const uploaded=await client.previewPackageFile('demo-local.tgz',Uint8Array.of(1,2));
	assert.equal(uploaded.source,'uploaded');assert.equal(uploaded.filename,'demo-local.tgz');assert.equal(calls.at(-1).operation,EXTENSION_OPERATIONS.previewPackageFile);
});

test('clients reject unbounded or malformed server DTOs', async () => {
	const environments=new ProjectEnvironmentsClient({query:async()=>({revision:0,environments:[{id:'x',providerId:'x',providerLabel:'x',name:'x',endpointSummary:'',status:'secret-leak',referencedProjectCount:0}]}),command:async()=>null});
	await assert.rejects(environments.snapshot(),/snapshot|summary/);
	const extensions=new ExtensionsClient({query:async()=>({revision:0,extensions:[],catalogue:new Array(513).fill({})}),command:async()=>null});
	await assert.rejects(extensions.list(),/exceeds/);
});

test('extension client never presents an enabled unhosted extension as installed', async () => {
	const client=new ExtensionsClient({
		async query(){return {authorityLabel:'Production',revision:4,catalogue:[],extensions:[{extensionId:'dev.example.pending',packageName:'pending-extension',displayName:'Pending extension',description:'',official:false,enabled:true,compatible:true,activeVersion:'1.0.0',runtimeState:'activation-required',failureMessage:'Host has not started'}]};},
		async command(){return null;},
	});
	const extension=(await client.list()).extensions[0];
	assert.equal(extension.state,'pending');
	assert.equal(extension.failureMessage,'Host has not started');
});
