import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectEnvironmentRepository, WorkspaceStore, createInitialWorkspace,
  createProjectEnvironmentOperationHandlers,
} from '../dist/index.js';

function fixture() {
  let persisted;
  const repository = new ProjectEnvironmentRepository({ async load() { return persisted; }, async commit(state) { persisted = structuredClone(state); } }, 'server-a');
  const workspace = new WorkspaceStore(createInitialWorkspace('server-a'));
  const events = [];
  const operations = createProjectEnvironmentOperationHandlers({ repository, workspace, thisServerRoot: () => '/home/server', onChanged: (event) => events.push(event) });
  const context = { connectionId:'connection-a', clientId:'client-a', authScope:'admin', permissions:['environments:read','environments:manage','workspace:write'], signal:new AbortController().signal };
  const query = (operation, payload={}, override={}) => operations.queries[operation]({ envelope:{type:'query',queryId:'q',operation,payload}, body:new Uint8Array(), context:{...context,...override} });
  const command = (operation, payload, commandId='command-a', override={}) => operations.commands[operation]({ envelope:{type:'command',commandId,correlationId:commandId,operation,payload}, body:new Uint8Array(), context:{...context,...override} });
  return { repository, workspace, events, query, command };
}

test('snapshot is bounded metadata and requires environments:read', async () => {
  const subject = fixture();
  const snapshot = await subject.query('project-environments.snapshot');
  assert.equal(snapshot.revision, 0);
  assert.deepEqual(snapshot.providers, [{providerId:'terminay:this-server',displayName:'This server',capabilities:['terminal','filesystem']}]);
  assert.deepEqual(snapshot.environments, [{ id:'terminay:this-server', providerId:'terminay:this-server', providerLabel:'This Terminay Server', name:'This server', endpointSummary:'Local to this Terminay Server', status:'ready', referencedProjectCount:0, isThisServer:true }]);
  assert.equal(JSON.stringify(snapshot).includes('secretReferences'), false);
  await assert.rejects(() => subject.query('project-environments.snapshot', {}, { permissions:[] }), /environments:read/);
});

test('snapshot exposes validated declarative provider contributions without executable code', async () => {
  const subject=fixture();
  const operations=createProjectEnvironmentOperationHandlers({repository:subject.repository,workspace:subject.workspace,thisServerRoot:()=>'/home/server',providerDefinitions:()=>[{providerId:'com.example.ssh/connection',displayName:'SSH',description:'Connect',capabilities:['terminal','filesystem'],profileForm:{id:'ssh-profile',title:'SSH profile',sections:[],submitLabel:'Save'}}]});
  const response=await operations.queries['project-environments.snapshot']({envelope:{type:'query',queryId:'q',operation:'project-environments.snapshot',payload:{}},body:new Uint8Array(),context:{connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:read'],signal:new AbortController().signal}});
  assert.deepEqual(response.providers[1],{providerId:'com.example.ssh/connection',displayName:'SSH',description:'Connect',capabilities:['terminal','filesystem'],profileForm:{id:'ssh-profile',title:'SSH profile',sections:[],submitLabel:'Save'}});
  assert.equal(JSON.stringify(response).includes('entrypoint'),false);
});

test('createProject validates This server root then commits one immutable workspace binding', async () => {
  const subject = fixture(); await subject.repository.load();
  const viewId = subject.workspace.state.viewOrder[0];
  const response = await subject.command('project-environments.create-project', { environmentId:'terminay:this-server', viewId }, 'create-one');
  assert.equal(response.result.state, 'succeeded');
  const project = subject.workspace.state.projects[response.result.projectId];
  assert.equal(project.root, '/home/server');
  assert.equal(project.rootOrigin, 'environment-default');
  assert.equal(project.name, 'Project 1');
  assert.equal(project.projectEnvironmentId, 'terminay:this-server');
  assert.equal(project.environmentRevision, 1);
  assert.deepEqual(subject.events, [{revision:0}]);
});

test('createProject never falls back for unknown or unavailable providers and permission denial is pre-mutation', async () => {
  const subject = fixture(); await subject.repository.load(); const viewId=subject.workspace.state.viewOrder[0]; const before=subject.workspace.state;
  await assert.rejects(() => subject.command('project-environments.create-project', {environmentId:'ssh:missing',viewId}), /unavailable/);
  await assert.rejects(() => subject.command('project-environments.create-project', {environmentId:'terminay:this-server',viewId}, 'denied', {permissions:['environments:read']}), /environments:manage/);
  assert.deepEqual(subject.workspace.state, before);
});

test('profile mutation uses one checked repository revision and publishes one change', async () => {
  const subject = fixture();
  const now = Date.now();
  const operations = createProjectEnvironmentOperationHandlers({ repository:subject.repository, workspace:subject.workspace, thisServerRoot:()=>'/home/server', onChanged:(event)=>subject.events.push(event), providers:{ async createProfile(providerId) { return { profile:{ id:'profile-a',providerId,name:'Example',endpointSummary:'example.test',activeRevision:1,recommendedRevision:1,revisions:{'1':{revision:1,createdAt:now,configuration:{host:'example.test'},secretReferences:['vault:key']}},archived:false } }; } } });
  await subject.repository.load();
  const request={envelope:{type:'command',commandId:'profile-command',correlationId:'profile-command',operation:'project-environments.create-profile',payload:{providerId:'ssh:provider',values:{password:'never-return-this'}}},body:new Uint8Array(),context:{connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:manage'],signal:new AbortController().signal,expectedRevision:0}};
  const response=await operations.commands['project-environments.create-profile'](request);
  assert.equal(response.revision,1);
  assert.equal(subject.repository.state.revision,1);
  assert.deepEqual(subject.events,[{revision:1}]);
  assert.equal(JSON.stringify(response).includes('never-return-this'),false);
  await assert.rejects(() => operations.commands['project-environments.create-profile']({...request,envelope:{...request.envelope,commandId:'stale'},context:{...request.context,expectedRevision:0}}),/revision changed/);
});

test('provider provisioning persists opaque state, resumes after restart, refreshes status, and never projects provider state', async()=>{
  let persisted; const backend={async load(){return persisted},async commit(state){persisted=structuredClone(state)}};
  const repository=new ProjectEnvironmentRepository(backend,'server-a'); const workspace=new WorkspaceStore(createInitialWorkspace('server-a')); const calls=[];
  let resumed=false;
  const providerRuntime={async invokeProvider(invocation){calls.push(invocation.callback);if(invocation.callback==='testProfile')return [];if(invocation.callback==='resolveOptions')return {options:[{id:'small',label:'Small'}]};if(invocation.callback==='createEnvironment')return {state:'pending',operationId:'provider-job-1',providerState:{machineId:'vm-1',privateOpaque:'kept-server-side'},progress:{operationId:'provider-job-1',title:'Creating',resumable:true,stages:[{id:'create',label:'Creating',state:'active'}]}};if(invocation.callback==='resumeOperation'){resumed=true;return {state:'ready',providerState:{machineId:'vm-1',privateOpaque:'updated'},status:{state:'available',defaultRoot:'/work',revision:2}}}if(invocation.callback==='getStatus')return {state:'available',defaultRoot:'/work',revision:2};if(invocation.callback==='invokeAction')return {state:'complete',providerState:{machineId:'vm-1',power:'off'},status:{state:'unavailable',revision:3}};throw new Error(`unexpected ${invocation.callback}`)}};
  const providers=()=>[{providerId:'com.example/cloud',displayName:'Cloud',capabilities:['terminal','filesystem'],createForm:{id:'create',title:'Create',sections:[],submitLabel:'Create'}}];
  const operations=createProjectEnvironmentOperationHandlers({repository,workspace,thisServerRoot:()=>'/home/server',providerDefinitions:providers,providerRuntime});
  const context={connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:read','environments:manage'],signal:new AbortController().signal,expectedRevision:0};
  const created=await operations.commands['project-environments.create']({envelope:{type:'command',commandId:'create-cloud',correlationId:'create-cloud',operation:'project-environments.create',payload:{providerId:'com.example/cloud',values:{name:'VM'}}},body:new Uint8Array(),context});
  assert.equal(created.result.state,'pending'); assert.equal(repository.state.operations['create-cloud'].providerOperationId,'provider-job-1'); assert.equal(repository.state.environments['env:create-cloud'].status,'provisioning');
  const restarted=new ProjectEnvironmentRepository(backend,'server-a'); await restarted.load();
  const resumedOperations=createProjectEnvironmentOperationHandlers({repository:restarted,workspace,thisServerRoot:()=>'/home/server',providerDefinitions:providers,providerRuntime});
  const snapshot=await resumedOperations.queries['project-environments.snapshot']({envelope:{type:'query',queryId:'q',operation:'project-environments.snapshot',payload:{}},body:new Uint8Array(),context:{...context,expectedRevision:undefined}});
  assert.equal(resumed,true); assert.equal(restarted.state.operations['create-cloud'].state,'succeeded'); assert.equal(restarted.state.environments['env:create-cloud'].status,'ready'); assert.equal(restarted.state.environments['env:create-cloud'].defaultRoot,'/work');
  assert.equal(JSON.stringify(snapshot).includes('privateOpaque'),false); assert.deepEqual(calls,['testProfile','createEnvironment','resumeOperation','getStatus']);
  const optionResult=await resumedOperations.queries['project-environments.resolve-options']({envelope:{type:'query',queryId:'options',operation:'project-environments.resolve-options',payload:{providerId:'com.example/cloud',sourceId:'sizes',values:{}}},body:new Uint8Array(),context:{...context,expectedRevision:undefined}});assert.deepEqual(optionResult,{options:[{id:'small',label:'Small'}]});
  const action=await resumedOperations.commands['project-environments.invoke-action']({envelope:{type:'command',commandId:'power-off',correlationId:'power-off',operation:'project-environments.invoke-action',payload:{environmentId:'env:create-cloud',actionId:'stop'}},body:new Uint8Array(),context:{...context,expectedRevision:undefined}});assert.equal(action.result.state,'succeeded');assert.equal(restarted.state.environments['env:create-cloud'].status,'offline');assert.equal(JSON.stringify(action).includes('machineId'),false);
  assert.deepEqual(calls,['testProfile','createEnvironment','resumeOperation','getStatus','resolveOptions','invokeAction']);
});

test('concurrent snapshots serialize durable provisioning recovery before provider side effects', async()=>{
  const subject=fixture(); await subject.repository.load(); let active=0; let maximumActive=0; let resumes=0;
  const providerDefinitions=()=>[{providerId:'com.example.cloud/vm',displayName:'Cloud VM',capabilities:['terminal','filesystem'],createForm:{id:'create',title:'Create',sections:[],submitLabel:'Create'}}];
  const providerRuntime={async invokeProvider(invocation){
    if(invocation.callback==='testProfile')return [];
    if(invocation.callback==='createEnvironment')return {state:'pending',operationId:'job-1',providerState:{machineId:'vm-1'},progress:{operationId:'job-1',title:'Creating',resumable:true,stages:[{id:'create',label:'Creating',state:'active'}]}};
    if(invocation.callback==='resumeOperation'){resumes+=1;active+=1;maximumActive=Math.max(maximumActive,active);await new Promise((resolve)=>setTimeout(resolve,15));active-=1;return {state:'ready',providerState:{machineId:'vm-1'},status:{state:'available',defaultRoot:'/work',revision:1}};}
    if(invocation.callback==='getStatus')return {state:'available',defaultRoot:'/work',revision:1};
    throw new Error(`unexpected ${invocation.callback}`);
  }};
  const operations=createProjectEnvironmentOperationHandlers({repository:subject.repository,workspace:subject.workspace,thisServerRoot:()=>'/home/server',providerDefinitions,providerRuntime});
  const context={connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:read','environments:manage'],signal:new AbortController().signal,expectedRevision:undefined};
  await operations.commands['project-environments.create']({envelope:{type:'command',commandId:'create-cloud',correlationId:'create-cloud',operation:'project-environments.create',payload:{providerId:'com.example.cloud/vm',values:{name:'VM'}}},body:new Uint8Array(),context});
  const request=()=>operations.queries['project-environments.snapshot']({envelope:{type:'query',queryId:`snapshot-${Math.random()}`,operation:'project-environments.snapshot',payload:{}},body:new Uint8Array(),context});
  await Promise.all([request(),request()]);
  assert.equal(maximumActive,1);
  assert.equal(resumes,1);
  assert.equal(subject.repository.state.environments['env:create-cloud'].status,'ready');
});

test('a provisioning environment projects a safe status-card action without leaving its durable operation', async()=>{
  const subject=fixture(); await subject.repository.load(); const calls=[];
  const providerDefinitions=()=>[{providerId:'com.example.cloud/vm',displayName:'Cloud VM',capabilities:['terminal','filesystem'],createForm:{id:'create',title:'Create',sections:[],submitLabel:'Create'}}];
  const trustState={machineId:'vm-1',trustChallenge:{state:'trust-required',challengeId:'opaque-challenge',fingerprint:'SHA256:fixture'}};
  const providerRuntime={async invokeProvider(invocation){calls.push(invocation.callback);if(invocation.callback==='testProfile')return [];if(invocation.callback==='createEnvironment'||invocation.callback==='resumeOperation')return {state:'pending',operationId:'provider-job-1',providerState:trustState,progress:{operationId:'provider-job-1',title:'Awaiting host trust',resumable:true,stages:[{id:'trust',label:'Approve SSH host key',state:'active'}]}};if(invocation.callback==='getStatus')return {state:'connecting',revision:1,card:{id:'host-trust',title:'Approve SSH host key',summary:'Confirm the host key before opening the project.',tone:'warning',facts:[{label:'Host key',value:'SHA256:fixture'}],actions:[{id:'trust-host',label:'Trust host key',kind:'primary'}]}};if(invocation.callback==='invokeAction')return {state:'complete',providerState:{machineId:'vm-1'},status:{state:'available',revision:2,defaultRoot:'/work'}};throw new Error(`unexpected ${invocation.callback}`);}};
  const operations=createProjectEnvironmentOperationHandlers({repository:subject.repository,workspace:subject.workspace,thisServerRoot:()=>'/home/server',providerDefinitions,providerRuntime});
  const context={connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:read','environments:manage'],signal:new AbortController().signal,expectedRevision:0};
  await operations.commands['project-environments.create']({envelope:{type:'command',commandId:'create-cloud',correlationId:'create-cloud',operation:'project-environments.create',payload:{providerId:'com.example.cloud/vm',values:{name:'VM'}}},body:new Uint8Array(),context});
  const snapshot=await operations.queries['project-environments.snapshot']({envelope:{type:'query',queryId:'snapshot',operation:'project-environments.snapshot',payload:{}},body:new Uint8Array(),context:{...context,expectedRevision:undefined}});
  const environment=snapshot.environments.find((value)=>value.id==='env:create-cloud');
  assert.equal(environment.status,'connecting');
  assert.deepEqual(environment.statusCard.actions,[{id:'trust-host',label:'Trust host key',kind:'primary'}]);
  assert.equal(subject.repository.state.operations['create-cloud'].state,'running');
  await operations.commands['project-environments.invoke-action']({envelope:{type:'command',commandId:'trust-host',correlationId:'trust-host',operation:'project-environments.invoke-action',payload:{environmentId:'env:create-cloud',actionId:'trust-host'}},body:new Uint8Array(),context:{...context,expectedRevision:undefined}});
  assert.equal(subject.repository.state.environments['env:create-cloud'].status,'ready');
  assert.equal(subject.repository.state.operations['create-cloud'].state,'succeeded');
  assert.equal(calls.includes('getStatus'),true);
});

test('environment creation preserves explicit public provider validation feedback', async()=>{
  const subject=fixture(); await subject.repository.load();
  const providerDefinitions=()=>[{providerId:'com.puzed.platform/vm',displayName:'Puzed VM',capabilities:['terminal','filesystem'],createForm:{id:'create',title:'Create',sections:[],submitLabel:'Create'}}];
  const providerRuntime={async invokeProvider(invocation){if(invocation.callback==='testProfile')return [{message:'Puzed request failed (400).'}];throw new Error(`unexpected ${invocation.callback}`);}};
  const operations=createProjectEnvironmentOperationHandlers({repository:subject.repository,workspace:subject.workspace,thisServerRoot:()=>'/home/server',providerDefinitions,providerRuntime});
  const request={envelope:{type:'command',commandId:'create-puzed',correlationId:'create-puzed',operation:'project-environments.create',payload:{providerId:'com.puzed.platform/vm',values:{name:'VM'}}},body:new Uint8Array(),context:{connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:manage'],signal:new AbortController().signal,expectedRevision:0}};
  await assert.rejects(() => operations.commands['project-environments.create'](request), /Puzed request failed \(400\)\./);
  assert.equal(Object.keys(subject.repository.state.environments).length,1);
});

test('Puzed VM creation preserves its bounded public rejection instead of a generic provider failure', async()=>{
  const subject=fixture(); await subject.repository.load();
  const providerDefinitions=()=>[{providerId:'com.puzed.platform/vm',displayName:'Puzed VM',capabilities:['terminal','filesystem'],createForm:{id:'create',title:'Create',sections:[],submitLabel:'Create'}}];
  const providerRuntime={async invokeProvider(invocation){if(invocation.callback==='testProfile')return [];throw new Error('Puzed rejected VM creation (HTTP 409, bridge_worker_mismatch).');}};
  const operations=createProjectEnvironmentOperationHandlers({repository:subject.repository,workspace:subject.workspace,thisServerRoot:()=>'/home/server',providerDefinitions,providerRuntime});
  const request={envelope:{type:'command',commandId:'create-puzed-rejected',correlationId:'create-puzed-rejected',operation:'project-environments.create',payload:{providerId:'com.puzed.platform/vm',values:{name:'VM'}}},body:new Uint8Array(),context:{connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:manage'],signal:new AbortController().signal,expectedRevision:0}};
  const before=structuredClone(subject.repository.state);
  await assert.rejects(() => operations.commands['project-environments.create'](request), /Puzed rejected VM creation \(HTTP 409, bridge_worker_mismatch\)\./);
  assert.deepEqual(subject.repository.state,before);
});
