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

async function eventually(read, message = 'condition did not become true') {
  const deadline = Date.now() + 250;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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

test('profile mutation persists safe edited values through the profile service', async () => {
  const subject = fixture();
  const now = Date.now();
  const operations = createProjectEnvironmentOperationHandlers({ repository:subject.repository, workspace:subject.workspace, thisServerRoot:()=>'/home/server', onChanged:(event)=>subject.events.push(event), providers:{ async createProfile(providerId) { return { profile:{ id:'profile-a',providerId,name:'Example',endpointSummary:'example.test',activeRevision:1,recommendedRevision:1,revisions:{'1':{revision:1,createdAt:now,configuration:{host:'example.test','api-key':'must-not-return'},secretReferences:['api-key=vault:key']}},archived:false } }; }, async updateProfile(profile, values) { return { profile:{ ...profile, name:String(values['display-name'] ?? profile.name), endpointSummary:String(values.host ?? profile.endpointSummary), activeRevision:2, recommendedRevision:2, revisions:{ ...profile.revisions, '2':{revision:2,createdAt:now + 1,configuration:{host:String(values.host ?? 'example.test')},secretReferences:['api-key=vault:key']} } } }; } } });
  await subject.repository.load();
  const request={envelope:{type:'command',commandId:'profile-command',correlationId:'profile-command',operation:'project-environments.create-profile',payload:{providerId:'ssh:provider',values:{password:'never-return-this'}}},body:new Uint8Array(),context:{connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:manage'],signal:new AbortController().signal,expectedRevision:0}};
  const response=await operations.commands['project-environments.create-profile'](request);
  assert.equal(response.revision,1);
  assert.equal(subject.repository.state.revision,1);
  assert.deepEqual(subject.events,[{revision:1}]);
  assert.equal(JSON.stringify(response).includes('never-return-this'),false);
  const beforeEdit = await operations.queries['project-environments.snapshot']({envelope:{type:'query',queryId:'before-edit',operation:'project-environments.snapshot',payload:{}},body:new Uint8Array(),context:{...request.context,permissions:['environments:read']}});
  assert.deepEqual(beforeEdit.profiles[0].initialValues,{host:'example.test'});
	assert.equal(JSON.stringify(beforeEdit).includes('must-not-return'), false);
  await operations.commands['project-environments.update-profile']({envelope:{type:'command',commandId:'profile-edit',correlationId:'profile-edit',operation:'project-environments.update-profile',payload:{profileId:'profile-a',values:{'display-name':'Edited',host:'edited.test'}}},body:new Uint8Array(),context:{...request.context,expectedRevision:1}});
  const afterEdit = await operations.queries['project-environments.snapshot']({envelope:{type:'query',queryId:'after-edit',operation:'project-environments.snapshot',payload:{}},body:new Uint8Array(),context:{...request.context,permissions:['environments:read']}});
  assert.equal(afterEdit.profiles[0].name,'Edited');
  assert.deepEqual(afterEdit.profiles[0].initialValues,{host:'edited.test'});
  await assert.rejects(() => operations.commands['project-environments.create-profile']({...request,envelope:{...request.envelope,commandId:'stale'},context:{...request.context,expectedRevision:0}}),/revision changed/);
});

test('a stale unreferenced connection can be forgotten locally without touching provider infrastructure', async () => {
  const subject = fixture();
  await subject.repository.load();
  const now = Date.now();
  await subject.repository.commit(0, (state) => ({
    ...state,
	profiles: {
		...state.profiles,
		'profile-a': {
			id: 'profile-a', providerId: 'com.puzed.platform/vm', name: 'Old Puzed', endpointSummary: 'example.test',
			activeRevision: 1, recommendedRevision: 1,
			revisions: { '1': { revision: 1, createdAt: now, configuration: {}, secretReferences: [] } },
			archived: false,
		},
	},
    environments: {
      ...state.environments,
      'puzed:stale': {
        id: 'puzed:stale', providerId: 'com.puzed.platform/vm', profileId: 'profile-a',
        pinnedRevision: 1, name: 'old-vm', endpointSummary: 'Puzed VM',
        declaredCapabilities: ['terminal', 'filesystem'], availableCapabilities: [],
        status: 'connecting', operationReferences: ['old-operation'], projectReferenceCount: 0,
        archived: false, builtIn: false, providerState: { machineId: 'deleted-remotely' },
        providerRevision: 1,
      },
    },
    operations: {
      ...state.operations,
      'old-operation': { id: 'old-operation', providerId: 'com.puzed.platform/vm', environmentId: 'puzed:stale', kind: 'create', state: 'pending', providerState: {}, createdAt: now, updatedAt: now, revision: 1 },
    },
  }));
  const response = await subject.command('project-environments.remove-connection', { environmentId: 'puzed:stale' }, 'forget-stale');
  assert.equal(response.result.state, 'succeeded');
  assert.equal(subject.repository.state.environments['puzed:stale'], undefined);
  assert.equal(subject.repository.state.operations['old-operation'], undefined);
  await assert.rejects(
    () => subject.command('project-environments.remove-connection', { environmentId: 'terminay:this-server' }, 'forget-server'),
    /cannot be removed/,
  );
});

test('removing an unreferenced provider forgets its local connections without deleting a remote VM', async () => {
  const subject = fixture();
  await subject.repository.load();
  const now = Date.now();
  await subject.repository.commit(0, (state) => ({
    ...state,
    profiles: { ...state.profiles, 'profile-a': {
      id: 'profile-a', providerId: 'com.puzed.platform/vm', name: 'Puzed', endpointSummary: 'example.test',
      activeRevision: 1, recommendedRevision: 1,
      revisions: { '1': { revision: 1, createdAt: now, configuration: {}, secretReferences: [] } }, archived: false,
    } },
    environments: { ...state.environments, 'puzed:stale': {
      id: 'puzed:stale', providerId: 'com.puzed.platform/vm', profileId: 'profile-a', pinnedRevision: 1,
      name: 'old-vm', endpointSummary: 'Puzed VM', declaredCapabilities: ['terminal', 'filesystem'], availableCapabilities: [],
      status: 'connecting', operationReferences: [], projectReferenceCount: 0, archived: false, builtIn: false,
      providerState: { machineId: 'remote-vm-must-not-be-deleted' }, providerRevision: 1,
    } },
  }));
  const providerCalls = [];
  const operations = createProjectEnvironmentOperationHandlers({
    repository: subject.repository, workspace: subject.workspace, thisServerRoot: () => '/home/server',
    providers: { async removeProfile(profile) { providerCalls.push(profile.id); } },
    providerRuntime: { async invokeProvider(invocation) { throw new Error(`remote lifecycle must not run: ${invocation.callback}`); } },
  });
  const response = await operations.commands['project-environments.remove-profile']({
    envelope: { type: 'command', commandId: 'remove-provider', correlationId: 'remove-provider', operation: 'project-environments.remove-profile', payload: { profileId: 'profile-a' } },
    body: new Uint8Array(), context: { connectionId: 'c', clientId: 'client-a', authScope: 'admin', permissions: ['environments:manage'], signal: new AbortController().signal, expectedRevision: 1 },
  });
  assert.equal(response.result.state, 'succeeded');
  assert.equal(subject.repository.state.profiles['profile-a'], undefined);
  assert.equal(subject.repository.state.environments['puzed:stale'], undefined);
  assert.deepEqual(providerCalls, ['profile-a']);
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
  // The server invokes this lifecycle hook immediately after extensions are
  // activated. Recovery must not depend on a renderer querying the snapshot.
  await resumedOperations.recoverPending({...context,expectedRevision:undefined});
  assert.equal(resumed,true); assert.equal(restarted.state.operations['create-cloud'].state,'succeeded'); assert.equal(restarted.state.environments['env:create-cloud'].status,'ready'); assert.equal(restarted.state.environments['env:create-cloud'].defaultRoot,'/work');
  const snapshot=await resumedOperations.queries['project-environments.snapshot']({envelope:{type:'query',queryId:'q',operation:'project-environments.snapshot',payload:{}},body:new Uint8Array(),context:{...context,expectedRevision:undefined}});
  assert.equal(JSON.stringify(snapshot).includes('privateOpaque'),false); assert.deepEqual(calls,['testProfile','createEnvironment','resumeOperation']);
  const optionResult=await resumedOperations.queries['project-environments.resolve-options']({envelope:{type:'query',queryId:'options',operation:'project-environments.resolve-options',payload:{providerId:'com.example/cloud',sourceId:'sizes',values:{}}},body:new Uint8Array(),context:{...context,expectedRevision:undefined}});assert.deepEqual(optionResult,{options:[{id:'small',label:'Small'}]});
  const action=await resumedOperations.commands['project-environments.invoke-action']({envelope:{type:'command',commandId:'power-off',correlationId:'power-off',operation:'project-environments.invoke-action',payload:{environmentId:'env:create-cloud',actionId:'stop'}},body:new Uint8Array(),context:{...context,expectedRevision:undefined}});assert.equal(action.result.state,'succeeded');assert.equal(restarted.state.environments['env:create-cloud'].status,'offline');assert.equal(JSON.stringify(action).includes('machineId'),false);
  assert.equal(calls.includes('getStatus'),true);
  assert.equal(calls.at(-1),'invokeAction');
});

test('snapshots return before durable provisioning recovery while scheduling only one provider side effect', async()=>{
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
  assert.equal(subject.repository.state.environments['env:create-cloud'].status,'provisioning');
  await eventually(()=>subject.repository.state.environments['env:create-cloud'].status==='ready');
  assert.equal(maximumActive,1);
  assert.equal(resumes,1);
  assert.equal(subject.repository.state.environments['env:create-cloud'].status,'ready');
});

test('recovery gives the newest durable VM operation a turn before stale SSH retries', async()=>{
  const subject=fixture(); await subject.repository.load();
  const now=Date.now();
  await subject.repository.commit(0,(state)=>({...state,
    environments:{...state.environments,
      'puzed:old':{id:'puzed:old',providerId:'com.example.cloud/vm',pinnedRevision:1,name:'old',endpointSummary:'Cloud VM',declaredCapabilities:['terminal','filesystem'],availableCapabilities:[],status:'connecting',operationReferences:['old-operation'],projectReferenceCount:0,archived:false,builtIn:false,providerState:{machineId:'old'},providerRevision:1},
      'puzed:new':{id:'puzed:new',providerId:'com.example.cloud/vm',pinnedRevision:1,name:'new',endpointSummary:'Cloud VM',declaredCapabilities:['terminal','filesystem'],availableCapabilities:[],status:'provisioning',operationReferences:['new-operation'],projectReferenceCount:0,archived:false,builtIn:false,providerState:{machineId:'new'},providerRevision:1},
    },
    operations:{...state.operations,
      'old-operation':{id:'old-operation',providerId:'com.example.cloud/vm',environmentId:'puzed:old',kind:'create',state:'pending',providerState:{machineId:'old'},createdAt:now,updatedAt:now,revision:1},
      'new-operation':{id:'new-operation',providerId:'com.example.cloud/vm',environmentId:'puzed:new',kind:'create',state:'pending',providerState:{machineId:'new'},createdAt:now+1,updatedAt:now+1,revision:1},
    },
  }));
  const calls=[];
  const providerRuntime={async invokeProvider(invocation){
    if(invocation.callback!=='resumeOperation') throw new Error(`unexpected ${invocation.callback}`);
    const machineId=invocation.request.providerState.machineId; calls.push(machineId);
    if(machineId==='old') throw new Error('old SSH endpoint is unavailable');
    return {state:'ready',providerState:{machineId:'new'},status:{state:'available',defaultRoot:'/home/vms',revision:1}};
  }};
  const operations=createProjectEnvironmentOperationHandlers({repository:subject.repository,workspace:subject.workspace,thisServerRoot:()=>'/home/server',providerDefinitions:()=>[],providerRuntime});
  const context={connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:read','environments:manage'],signal:new AbortController().signal,expectedRevision:undefined};
  await operations.recoverPending(context);
  assert.deepEqual(calls,['new','old']);
  assert.equal(subject.repository.state.operations['old-operation'].state,'pending');
});

test('provisioning recovery rebases a provider result after a concurrent registry mutation', async()=>{
  const subject=fixture(); await subject.repository.load(); let injected=false;
  const providerDefinitions=()=>[{providerId:'com.example.cloud/vm',displayName:'Cloud VM',capabilities:['terminal','filesystem'],createForm:{id:'create',title:'Create',sections:[],submitLabel:'Create'}}];
  const providerRuntime={async invokeProvider(invocation){
    if(invocation.callback==='testProfile')return [];
    if(invocation.callback==='createEnvironment')return {state:'pending',operationId:'job-1',providerState:{machineId:'vm-1'},progress:{operationId:'job-1',title:'Creating',resumable:true,stages:[{id:'create',label:'Creating',state:'active'}]}};
    if(invocation.callback==='resumeOperation'){
      if(!injected){injected=true;await subject.repository.commit(subject.repository.state.revision,(state)=>({...state}));}
      return {state:'ready',providerState:{machineId:'vm-1',sshRevision:3},status:{state:'available',defaultRoot:'/work',revision:1}};
    }
    if(invocation.callback==='getStatus')return {state:'available',defaultRoot:'/work',revision:1};
    throw new Error(`unexpected ${invocation.callback}`);
  }};
  const operations=createProjectEnvironmentOperationHandlers({repository:subject.repository,workspace:subject.workspace,thisServerRoot:()=>'/home/server',providerDefinitions,providerRuntime});
  const context={connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:read','environments:manage'],signal:new AbortController().signal,expectedRevision:undefined};
  await operations.commands['project-environments.create']({envelope:{type:'command',commandId:'create-cloud',correlationId:'create-cloud',operation:'project-environments.create',payload:{providerId:'com.example.cloud/vm',values:{name:'VM'}}},body:new Uint8Array(),context});
  await operations.queries['project-environments.snapshot']({envelope:{type:'query',queryId:'snapshot',operation:'project-environments.snapshot',payload:{}},body:new Uint8Array(),context});
  await eventually(()=>subject.repository.state.environments['env:create-cloud'].status==='ready');
  assert.equal(injected,true);
  assert.equal(subject.repository.state.environments['env:create-cloud'].status,'ready');
  assert.equal(subject.repository.state.environments['env:create-cloud'].providerState.sshRevision,3);
  assert.equal(subject.repository.state.operations['create-cloud'].state,'succeeded');
});

test('a provisioning environment projects a safe status-card action without leaving its durable operation', async()=>{
  const subject=fixture(); await subject.repository.load(); const calls=[];
  const providerDefinitions=()=>[{providerId:'com.example.cloud/vm',displayName:'Cloud VM',capabilities:['terminal','filesystem'],createForm:{id:'create',title:'Create',sections:[],submitLabel:'Create'}}];
  const trustState={machineId:'vm-1',trustChallenge:{state:'trust-required',challengeId:'opaque-challenge',fingerprint:'SHA256:fixture'}};
  const providerRuntime={async invokeProvider(invocation){calls.push(invocation.callback);if(invocation.callback==='testProfile')return [];if(invocation.callback==='createEnvironment'||invocation.callback==='resumeOperation')return {state:'pending',operationId:'provider-job-1',providerState:trustState,progress:{operationId:'provider-job-1',title:'Awaiting host trust',resumable:true,stages:[{id:'trust',label:'Approve SSH host key',state:'active'}]}};if(invocation.callback==='getStatus')return {state:'connecting',revision:1,card:{id:'host-trust',title:'Approve SSH host key',summary:'Confirm the host key before opening the project.',tone:'warning',facts:[{label:'Host key',value:'SHA256:fixture'}],actions:[{id:'trust-host',label:'Trust host key',kind:'primary'}]}};if(invocation.callback==='invokeAction')return {state:'complete',providerState:{machineId:'vm-1'},status:{state:'available',revision:2,defaultRoot:'/work'}};throw new Error(`unexpected ${invocation.callback}`);}};
  const operations=createProjectEnvironmentOperationHandlers({repository:subject.repository,workspace:subject.workspace,thisServerRoot:()=>'/home/server',providerDefinitions,providerRuntime});
  const context={connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:read','environments:manage'],signal:new AbortController().signal,expectedRevision:0};
  await operations.commands['project-environments.create']({envelope:{type:'command',commandId:'create-cloud',correlationId:'create-cloud',operation:'project-environments.create',payload:{providerId:'com.example.cloud/vm',values:{name:'VM'}}},body:new Uint8Array(),context});
  await eventually(async()=>{
    const candidate=await operations.queries['project-environments.snapshot']({envelope:{type:'query',queryId:'snapshot',operation:'project-environments.snapshot',payload:{}},body:new Uint8Array(),context:{...context,expectedRevision:undefined}});
    return candidate.environments.find((value)=>value.id==='env:create-cloud')?.statusCard?.id === 'host-trust' ? candidate : false;
  });
  const snapshot=await operations.queries['project-environments.snapshot']({envelope:{type:'query',queryId:'snapshot-final',operation:'project-environments.snapshot',payload:{}},body:new Uint8Array(),context:{...context,expectedRevision:undefined}});
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

test('snapshot projects a provider-scoped browse form without executable code', async () => {
  const subject=fixture();
  const operations=createProjectEnvironmentOperationHandlers({repository:subject.repository,workspace:subject.workspace,thisServerRoot:()=>'/home/server',providerDefinitions:()=>[{providerId:'com.puzed.platform/vm',displayName:'Puzed VM',capabilities:['terminal','filesystem'],createForm:{id:'create',title:'Create',sections:[],submitLabel:'Create'},browseForm:{id:'browse',title:'Browse Terminay VMs',sections:[],submitLabel:'Add or update connection'}}]});
  const response=await operations.queries['project-environments.snapshot']({envelope:{type:'query',queryId:'q',operation:'project-environments.snapshot',payload:{}},body:new Uint8Array(),context:{connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:read'],signal:new AbortController().signal}});
  assert.equal(response.providers[1].browseForm.title,'Browse Terminay VMs');
  assert.equal(JSON.stringify(response).includes('entrypoint'),false);
});

test('selecting a tagged VM updates only that connection and leaves the provider and siblings unchanged', async () => {
  const subject=fixture(); await subject.repository.load();
  const now=Date.now();
  await subject.repository.commit(0,(state)=>({
    ...state,
    profiles:{...state.profiles,'profile-a':{id:'profile-a',providerId:'com.puzed.platform/vm',name:'Home lab',endpointSummary:'https://platform.test',activeRevision:1,recommendedRevision:1,revisions:{'1':{revision:1,createdAt:now,configuration:{'base-url':'https://platform.test'},secretReferences:[]}},archived:false}},
    environments:{...state.environments,
      'puzed:one':{id:'puzed:one',providerId:'com.puzed.platform/vm',profileId:'profile-a',pinnedRevision:1,name:'first-vm',endpointSummary:'Puzed VM',declaredCapabilities:['terminal','filesystem'],availableCapabilities:['terminal','filesystem'],status:'ready',operationReferences:[],projectReferenceCount:0,archived:false,builtIn:false,providerState:{machineId:'vm-1',displayName:'first-vm'},providerRevision:1},
      'puzed:two':{id:'puzed:two',providerId:'com.puzed.platform/vm',profileId:'profile-a',pinnedRevision:1,name:'second-vm',endpointSummary:'Puzed VM',declaredCapabilities:['terminal','filesystem'],availableCapabilities:['terminal','filesystem'],status:'ready',operationReferences:[],projectReferenceCount:0,archived:false,builtIn:false,providerState:{machineId:'vm-2',displayName:'second-vm'},providerRevision:1},
    },
  }));
  const sibling=structuredClone(subject.repository.state.environments['puzed:two']);
  const profile=structuredClone(subject.repository.state.profiles['profile-a']);
  const providerRuntime={async invokeProvider(invocation){
    if(invocation.callback==='testProfile')return [];
    if(invocation.callback==='createEnvironment')return {state:'ready',providerState:{machineId:invocation.request.values.machineId,displayName:'first-vm-updated',bindingId:'binding-1'},status:{state:'available',defaultRoot:'/work',revision:4}};
    throw new Error(`unexpected ${invocation.callback}`);
  }};
  const operations=createProjectEnvironmentOperationHandlers({repository:subject.repository,workspace:subject.workspace,thisServerRoot:()=>'/home/server',providerDefinitions:()=>[{providerId:'com.puzed.platform/vm',displayName:'Puzed VM',capabilities:['terminal','filesystem'],createForm:{id:'create',title:'Create',sections:[],submitLabel:'Create'},browseForm:{id:'browse',title:'Browse Terminay VMs',sections:[],submitLabel:'Add'}}],providerRuntime});
  await operations.commands['project-environments.create']({envelope:{type:'command',commandId:'select-vm-1',correlationId:'select-vm-1',operation:'project-environments.create',payload:{providerId:'com.puzed.platform/vm',profileId:'profile-a',values:{machineId:'vm-1'}}},body:new Uint8Array(),context:{connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:manage'],signal:new AbortController().signal,expectedRevision:1}});
  assert.equal(subject.repository.state.environments['puzed:one'].name,'first-vm-updated');
  assert.equal(subject.repository.state.environments['puzed:one'].id,'puzed:one');
  assert.equal(subject.repository.state.environments['puzed:one'].pinnedRevision,1);
  assert.deepEqual(subject.repository.state.environments['puzed:two'],sibling);
  assert.deepEqual(subject.repository.state.profiles['profile-a'],profile);
  assert.equal(Object.keys(subject.repository.state.environments).filter((id)=>id!=='terminay:this-server').length,2);
});

test('two projects can be created from one ready connection without changing the provider or connection', async () => {
  const subject=fixture(); await subject.repository.load();
  const now=Date.now();
  await subject.repository.commit(0,(state)=>({
    ...state,
    profiles:{...state.profiles,'profile-a':{id:'profile-a',providerId:'com.puzed.platform/vm',name:'Home lab',endpointSummary:'https://platform.test',activeRevision:1,recommendedRevision:1,revisions:{'1':{revision:1,createdAt:now,configuration:{},secretReferences:[]}},archived:false}},
    environments:{...state.environments,'puzed:one':{id:'puzed:one',providerId:'com.puzed.platform/vm',profileId:'profile-a',pinnedRevision:1,name:'first-vm',endpointSummary:'Puzed VM',declaredCapabilities:['terminal','filesystem'],availableCapabilities:['terminal','filesystem'],status:'ready',operationReferences:[],projectReferenceCount:0,archived:false,builtIn:false,providerState:{machineId:'vm-1'},providerRevision:1}},
  }));
  const before=structuredClone(subject.repository.state.environments['puzed:one']);
  const profile=structuredClone(subject.repository.state.profiles['profile-a']);
  const operations=createProjectEnvironmentOperationHandlers({repository:subject.repository,workspace:subject.workspace,thisServerRoot:()=>'/home/server',providers:{ async validateRoot() { return '/work'; } }});
  const context={connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:manage','workspace:write'],signal:new AbortController().signal};
  const viewId=subject.workspace.state.viewOrder[0];
  const command=(commandId)=>operations.commands['project-environments.create-project']({envelope:{type:'command',commandId,correlationId:commandId,operation:'project-environments.create-project',payload:{environmentId:'puzed:one',viewId}},body:new Uint8Array(),context});
  const first=await command('project-a');
  const second=await command('project-b');
  assert.notEqual(first.result.projectId,second.result.projectId);
  assert.equal(subject.workspace.state.projects[first.result.projectId].projectEnvironmentId,'puzed:one');
  assert.equal(subject.workspace.state.projects[second.result.projectId].projectEnvironmentId,'puzed:one');
  assert.deepEqual(subject.repository.state.environments['puzed:one'],before);
  assert.deepEqual(subject.repository.state.profiles['profile-a'],profile);
});
